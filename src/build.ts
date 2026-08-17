/** End-to-end build pipeline: input -> HTML -> renderer -> committed PDF. */
import path from 'node:path';
import type { Config } from './config.js';
import { RuntimeError } from './errors.js';
import { resolveInput, parseSourceDateEpoch, type Metadata } from './input.js';
import { buildDocumentBody } from './markdown.js';
import { ResourceManifest } from './resources.js';
import { resolveTemplate, buildDocumentHtml, type PreparedTemplate } from './template.js';
import { resolveFonts } from './fonts.js';
import { Workspace } from './workspace.js';
import { renderDocument } from './renderer.js';
import { validateOutputPath, ensureOutputParent, commitOutput } from './output.js';

export interface Logger {
  warn: (msg: string) => void;
  info: (msg: string) => void;
  debug: (msg: string) => void;
}

export interface BuildResult {
  outputPath: string;
  byteSize: number;
  elapsedMs: number;
}

interface PreparedDocument {
  html: string;
  metadata: Metadata;
  manifest: ResourceManifest;
  generated: Map<string, Buffer>;
  fontWarnings: string[];
}

async function prepareDocument(
  config: Config,
  env: Record<string, string | undefined>,
  log: Logger,
  processStart = new Date(),
  preparedTemplate?: PreparedTemplate,
): Promise<PreparedDocument> {
  const input = resolveInput(config.inputAbs!, config.title.value, env, log.warn, processStart);
  const template = preparedTemplate ?? resolveTemplate(config.template.value, config.templateDirAbs);
  const manifest = new ResourceManifest();
  const fonts = resolveFonts(manifest, config.fontDirsAbs, config.hostFonts.value);
  for (const warning of fonts.warnings) log.warn(warning);
  for (const diagnostic of fonts.diagnostics) log.debug(diagnostic);
  const body = await buildDocumentBody(input.files, manifest, template.reservedIds, {
    warn: log.warn,
    bibliography: input.bibliography,
  });
  const document = buildDocumentHtml({
    metadata: input.metadata,
    body,
    template,
    manifest,
    logoAbs: config.logoAbs,
    toc: config.toc.value,
    fontFaceCss: fonts.css,
    warn: log.warn,
  });
  const generated = new Map<string, Buffer>([['document.html', Buffer.from(document.html, 'utf8')]]);
  for (const [logical, content] of [...body.generatedCss, ...document.generatedCss]) {
    generated.set(logical, Buffer.from(content, 'utf8'));
  }
  for (const [logical, content] of body.generatedFiles) {
    generated.set(logical, Buffer.from(content, 'utf8'));
  }
  return { html: document.html, metadata: input.metadata, manifest, generated, fontWarnings: fonts.warnings };
}

/**
 * Build the document HTML without rendering. Used by tests to inspect the
 * exact byte stream served to the renderer.
 */
export async function buildHtml(
  config: Config,
  env: Record<string, string | undefined>,
  log: Logger,
  preparedTemplate?: PreparedTemplate,
): Promise<{
  html: string;
  manifest: ResourceManifest;
  generated: Map<string, Buffer>;
  fontWarnings: string[];
}> {
  const { html, manifest, generated, fontWarnings } = await prepareDocument(
    config, env, log, new Date(), preparedTemplate,
  );
  return { html, manifest, generated, fontWarnings };
}

export async function runBuild(
  config: Config,
  env: Record<string, string | undefined>,
  log: Logger,
): Promise<BuildResult> {
  const started = Date.now();
  const processStart = new Date();
  const sourceDateEpoch = parseSourceDateEpoch(env['SOURCE_DATE_EPOCH']);

  validateOutputPath(config.outputAbs!, config.inputAbs!);

  const { html, metadata, manifest, generated } = await prepareDocument(config, env, log, processStart);

  ensureOutputParent(config.outputAbs!);

  const workspace = Workspace.create();
  try {
    workspace.writeFile('document.html', html);
    workspace.writeFile('manifest.json', JSON.stringify(manifest.toJSON(), null, 2));
    for (const [logical, content] of generated) {
      if (logical.startsWith('generated/')) workspace.writeFile(logical, content);
    }

    const abortController = new AbortController();
    let interruptedBy: NodeJS.Signals | null = null;
    const interrupt = (signal: NodeJS.Signals): void => {
      interruptedBy = signal;
      abortController.abort();
    };
    const onSigint = (): void => {
      interrupt('SIGINT');
    };
    const onSigterm = (): void => {
      interrupt('SIGTERM');
    };
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    try {
      if (interruptedBy !== null) throw new RuntimeError(`build interrupted by ${String(interruptedBy)}`);
      const rendererOutput = path.join(workspace.rendererOutputDir, 'output.pdf');
      const deadline = Date.now() + config.renderTimeoutMs.value;
      const job = {
        outputPath: rendererOutput,
        deadline,
        browserPath: config.browserPathAbs,
        logLevel: config.logLevel.value,
        diagnosticsPath: workspace.filePath('renderer-diagnostics.log'),
        warn: log.warn,
        info: log.info,
        signal: abortController.signal,
      };
      await renderDocument({
        ...job,
        renderer: config.renderer.value,
        dockerImage: config.dockerImage.value,
        manifest,
        generated,
        workspaceDir: workspace.dir,
        controller: abortController,
      });
      if (interruptedBy !== null) throw new RuntimeError(`build interrupted by ${String(interruptedBy)}`);
      const size = await commitOutput({
        rendererOutput,
        finalOutput: config.outputAbs!,
        metadata,
        sourceDateEpoch,
        processStart,
        deadline,
        warn: log.warn,
        beforeCommit: () => {
          if (!config.keepWorkDir.value && !workspace.cleanup(false, log.warn)) {
            throw new RuntimeError('cannot remove the temporary workspace before output commit');
          }
          if (interruptedBy !== null) throw new RuntimeError(`build interrupted by ${interruptedBy}`);
        },
      });
      return { outputPath: config.outputAbs!, byteSize: size, elapsedMs: Date.now() - started };
    } finally {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
    }
  } finally {
    workspace.cleanup(config.keepWorkDir.value, log.warn);
  }
}
