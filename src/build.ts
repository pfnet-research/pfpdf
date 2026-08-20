/** End-to-end build pipeline: input -> HTML -> renderer -> committed PDF. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyFrontMatterConfig, type Config } from './config.js';
import { RuntimeError } from './errors.js';
import {
  resolveInput,
  parseSourceDateEpoch,
  type Metadata,
  type ResolvedInput,
} from './input.js';
import { buildDocumentBody } from './markdown.js';
import { ResourceManifest } from './resources.js';
import { resolveTemplate, buildDocumentHtml, type PreparedTemplate } from './template.js';
import { resolveFonts } from './fonts.js';
import { Workspace } from './workspace.js';
import { renderDocument } from './renderer.js';
import { validateOutputPath, ensureOutputParent, commitOutput } from './output.js';
import { RepositoryResolver } from './repository.js';

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

interface PreparedBoundaries {
  template?: PreparedTemplate | undefined;
  input?: ResolvedInput | undefined;
}

interface PrepareOptions {
  processStart?: Date;
  prepared?: PreparedBoundaries;
  repositoryResolver: RepositoryResolver;
}

export async function prepareConfiguredTemplate(
  config: Config,
  resolver: RepositoryResolver,
): Promise<PreparedTemplate> {
  if (config.template.value.kind !== 'repository') {
    return resolveTemplate(config.template.value, config.templateDirAbs);
  }
  const resolved = await resolver.resolve(config.template.value.locator, 'template');
  return resolveTemplate(
    { kind: 'custom', dir: resolved.path },
    resolved.path,
    resolved.repositoryRoot,
  );
}

export async function prepareConfiguredLogo(
  config: Config,
  resolver: RepositoryResolver,
): Promise<{ kind: 'template' | 'none' } | { kind: 'file'; absPath: string }> {
  switch (config.logo.value.kind) {
    case 'template':
    case 'none':
      return { kind: config.logo.value.kind };
    case 'local':
      return { kind: 'file', absPath: config.logoAbs! };
    case 'repository': {
      const resolved = await resolver.resolve(config.logo.value.locator, 'logo');
      return { kind: 'file', absPath: resolved.path };
    }
  }
}

async function prepareDocument(
  config: Config,
  env: Record<string, string | undefined>,
  log: Logger,
  options: PrepareOptions,
): Promise<PreparedDocument> {
  const processStart = options.processStart ?? new Date();
  const prepared = options.prepared;
  const input = prepared?.input ?? resolveInput(
    config.inputAbs!,
    config.title.value,
    env,
    log.warn,
    processStart,
  );
  const documentConfig = applyFrontMatterConfig(config, input.config);
  const repositoryResolver = options.repositoryResolver;
  const template = prepared?.template ?? await prepareConfiguredTemplate(documentConfig, repositoryResolver);
  const logo = await prepareConfiguredLogo(documentConfig, repositoryResolver);
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
    logo,
    toc: documentConfig.toc.value,
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
  preparedInput?: ResolvedInput,
): Promise<{
  html: string;
  manifest: ResourceManifest;
  generated: Map<string, Buffer>;
  fontWarnings: string[];
}> {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-sources-'));
  const repositoryResolver = new RepositoryResolver(sourceRoot, log.warn, log.info, env);
  try {
    const { html, manifest, generated, fontWarnings } = await prepareDocument(config, env, log, {
      prepared: { template: preparedTemplate, input: preparedInput },
      repositoryResolver,
    });
    return { html, manifest, generated, fontWarnings };
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
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
  const workspace = Workspace.create();
  try {
    const repositoryResolver = new RepositoryResolver(
      workspace.filePath('repositories'),
      log.warn,
      log.info,
      env,
    );
    const { html, metadata, manifest, generated } = await prepareDocument(config, env, log, {
      processStart,
      repositoryResolver,
    });

    ensureOutputParent(config.outputAbs!);

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
