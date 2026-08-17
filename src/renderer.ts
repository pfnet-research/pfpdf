/** Renderers: LocalRenderer (Vivliostyle CLI child process) and DockerRenderer. */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { StringDecoder } from 'node:string_decoder';
import { InputError, RuntimeError } from './errors.js';
import { validateLogicalPath, writeLogicalFile } from './workspace.js';
import { AssetServer } from './assetserver.js';
import type { ResourceManifest } from './resources.js';

export interface RenderJob {
  documentUrl: string;
  outputPath: string;
  deadline: number;
  browserPath: string | null;
  logLevel: string;
  diagnosticsPath: string;
  /** Child cwd, kept outside the output subtree for Vivliostyle path checks. */
  processCwd?: string | undefined;
  /** Docker's standard seccomp profile cannot run Chromium's nested sandbox. */
  browserSandbox?: boolean;
  warn: (msg: string) => void;
  info: (msg: string) => void;
  signal?: AbortSignal | undefined;
}

export interface RenderResult {
  outputPath: string;
  byteSize: number;
  elapsedMs: number;
}

export interface DocumentRenderJob extends Omit<RenderJob, 'documentUrl'> {
  renderer: 'local' | 'docker';
  dockerImage: string | null;
  manifest: ResourceManifest;
  generated: Map<string, Buffer>;
  workspaceDir: string;
  controller: AbortController;
}

/** Select a renderer adapter; both consume the same prepared document graph. */
export async function renderDocument(job: DocumentRenderJob): Promise<RenderResult> {
  if (job.renderer === 'docker') {
    return renderDocker({
      ...job,
      documentUrl: '',
      browserPath: null,
      manifestEntries: job.manifest.list(),
    });
  }
  const server = new AssetServer(job.manifest, job.generated);
  // Vivliostyle uses its cwd as the context for remote URL inputs. Keep that
  // context beside the output subtree so Windows never compares paths across
  // the checkout drive and the temporary-workspace drive.
  const processCwd = path.join(job.workspaceDir, 'vivliostyle-context');
  try {
    fs.mkdirSync(processCwd, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new RuntimeError(`cannot create Vivliostyle context directory: ${(error as Error).message}`);
  }
  return renderWithAssetServer(server, { ...job, processCwd }, job.controller);
}

/** Coordinate server readiness, renderer completion, abort, and cleanup. */
export async function renderWithAssetServer(
  server: AssetServer,
  job: Omit<RenderJob, 'documentUrl'>,
  controller: AbortController,
): Promise<RenderResult> {
  await server.start();
  try {
    const renderPromise = renderLocal({ ...job, documentUrl: server.documentUrl });
    try {
      const [result] = await Promise.all([renderPromise, server.waitUntilReady(job.deadline)]);
      return result;
    } catch (error) {
      controller.abort();
      try {
        await renderPromise;
      } catch {
        // Preserve the first renderer/readiness failure.
      }
      throw error;
    }
  } finally {
    await server.stop();
  }
}

export function rendererChildEnv(): NodeJS.ProcessEnv {
  return process.env;
}

export function resolveVivliostyleCli(): string {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('@vivliostyle/cli/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { bin?: Record<string, string> | string };
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.vivliostyle;
  if (!bin) throw new RuntimeError('cannot locate the Vivliostyle CLI entry point');
  return path.join(path.dirname(pkgPath), bin);
}

export async function renderLocal(job: RenderJob): Promise<RenderResult> {
  const started = Date.now();
  const cliPath = resolveVivliostyleCli();
  if (job.browserPath !== null) {
    let st: fs.Stats;
    try {
      st = fs.statSync(job.browserPath);
    } catch {
      throw new InputError(`browser not found: ${job.browserPath}`);
    }
    if (!st.isFile()) throw new InputError(`browser path is not a regular file: ${job.browserPath}`);
    try {
      fs.accessSync(job.browserPath, fs.constants.X_OK);
    } catch {
      throw new InputError(`browser is not executable: ${job.browserPath}`);
    }
  }

  const remaining = job.deadline - Date.now();
  if (remaining <= 0) throw new RuntimeError('render deadline exceeded before renderer start');
  const timeoutSec = Math.max(1, Math.ceil(remaining / 1000));

  const args = [
    cliPath,
    'build',
    job.documentUrl,
    '-o',
    job.outputPath,
    '--timeout',
    String(timeoutSec),
    '--log-level',
    job.logLevel === 'debug' ? 'debug' : 'info',
  ];
  if (job.browserSandbox !== false) args.push('--sandbox');
  if (job.browserPath !== null) {
    args.push('--executable-browser', job.browserPath);
  }

  job.info(`starting Vivliostyle CLI (timeout ${timeoutSec}s)`);
  const processResult = await runBoundedProcess(process.execPath, args, {
    deadline: job.deadline,
    signal: job.signal,
    cwd: job.processCwd,
    startError: 'failed to start Vivliostyle CLI',
    streamOutput: job.logLevel === 'debug' || job.logLevel === 'info',
    onTimeout: () => {
      job.warn('render timeout reached; terminating renderer');
    },
  });

  try {
    fs.writeFileSync(job.diagnosticsPath, processResult.output, { mode: 0o600 });
  } catch {
    // diagnostics are best effort
  }

  if (processResult.code === null) {
    const summary = processResult.stopReason === 'signal'
      ? 'renderer interrupted by a signal'
      : 'renderer timed out or was terminated by a signal';
    throw new RuntimeError(processFailureMessage(summary, processResult.output));
  }
  if (processResult.code !== 0) {
    throw new RuntimeError(processFailureMessage(
      `Vivliostyle CLI failed with exit code ${processResult.code}`,
      processResult.output,
    ));
  }
  const st = validateRendererOutput(job.outputPath);
  return { outputPath: job.outputPath, byteSize: st.size, elapsedMs: Date.now() - started };
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  if (pid <= 0) return;
  try {
    if (process.platform !== 'win32') process.kill(-pid, signal);
    else process.kill(pid, signal);
  } catch {
    // already gone
  }
}

const MAX_DIAGNOSTIC_BYTES = 8 * 1024 * 1024;
const STOP_GRACE_MS = 5000;
const STOP_FALLBACK_MS = 10000;

export interface BoundedProcessOptions {
  deadline: number;
  signal?: AbortSignal | undefined;
  cwd?: string | undefined;
  startError: string;
  streamOutput?: boolean;
  onTimeout?: () => void;
}

export interface BoundedProcessResult {
  code: number | null;
  stopReason: 'timeout' | 'signal' | null;
  output: Buffer;
}

/** Keep a bounded child process's diagnostics attached to the user-visible failure. */
export function processFailureMessage(summary: string, output: Buffer | string): string {
  const diagnostics = (typeof output === 'string' ? output : output.toString('utf8')).trimEnd();
  return diagnostics.trim() === '' ? summary : `${summary}\n\n${diagnostics}`;
}

export async function runBoundedProcess(
  command: string,
  args: string[],
  options: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
  const remaining = options.deadline - Date.now();
  if (remaining <= 0) throw new RuntimeError('render deadline exceeded before child process start');
  const child = spawn(command, args, {
    shell: false,
    cwd: options.cwd,
    env: rendererChildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const record = (decoder: StringDecoder, chunk: Buffer): void => {
    if (totalBytes < MAX_DIAGNOSTIC_BYTES) {
      chunks.push(chunk.subarray(0, MAX_DIAGNOSTIC_BYTES - totalBytes));
    }
    totalBytes += chunk.length;
    if (options.streamOutput) {
      const decoded = decoder.write(chunk);
      if (decoded !== '') process.stderr.write(decoded);
    }
  };
  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');
  child.stdout.on('data', (chunk: Buffer) => {
    record(stdoutDecoder, chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    record(stderrDecoder, chunk);
  });
  child.stdout.on('end', () => {
    flushDecoder(stdoutDecoder, options.streamOutput === true);
  });
  child.stderr.on('end', () => {
    flushDecoder(stderrDecoder, options.streamOutput === true);
  });

  let stopReason: BoundedProcessResult['stopReason'] = null;
  const code = await new Promise<number | null>((resolve, reject) => {
    let settled = false;
    let forceTimer: NodeJS.Timeout | null = null;
    let fallbackTimer: NodeJS.Timeout | null = null;
    const cleanup = (): void => {
      clearTimeout(deadlineTimer);
      if (forceTimer) clearTimeout(forceTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const stop = (reason: 'timeout' | 'signal'): void => {
      if (settled || stopReason !== null) return;
      stopReason = reason;
      if (reason === 'timeout') options.onTimeout?.();
      signalProcess(child.pid ?? -1, 'SIGTERM');
      forceTimer = setTimeout(() => {
        signalProcess(child.pid ?? -1, 'SIGKILL');
      }, STOP_GRACE_MS);
      fallbackTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      }, STOP_FALLBACK_MS);
    };
    const deadlineTimer = setTimeout(() => {
      stop('timeout');
    }, remaining);
    const onAbort = (): void => {
      stop('signal');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) stop('signal');
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new RuntimeError(`${options.startError}: ${error.message}`));
    });
    child.once('close', (exitCode, exitSignal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(exitSignal !== null || stopReason !== null ? null : (exitCode ?? 1));
    });
  });
  if (totalBytes > MAX_DIAGNOSTIC_BYTES) {
    chunks.push(Buffer.from(
      `\n[pfpdf] diagnostics truncated; ${totalBytes - MAX_DIAGNOSTIC_BYTES} bytes omitted\n`,
    ));
  }
  return { code, stopReason, output: Buffer.concat(chunks) };
}

function flushDecoder(decoder: StringDecoder, stream: boolean): void {
  if (!stream) return;
  const decoded = decoder.end();
  if (decoded !== '') process.stderr.write(decoded);
}

export interface DockerRenderJob extends RenderJob {
  dockerImage: string | null;
  manifestEntries: Array<[string, string]>;
  generated: Map<string, Buffer>;
  workspaceDir: string;
}

export const DEFAULT_DOCKER_IMAGE = 'ghcr.io/pfnet-research/pfpdf:0.1.0';
export const DOCKER_PROTOCOL = '1';

export function validateDockerImageReference(image: string): void {
  if (image === '' || image.startsWith('-') || /[\0\r\n]/.test(image)) {
    throw new InputError(`invalid Docker image reference: ${JSON.stringify(image)}`);
  }
}

export async function renderDocker(job: DockerRenderJob): Promise<RenderResult> {
  const started = Date.now();
  const image = job.dockerImage ?? DEFAULT_DOCKER_IMAGE;
  validateDockerImageReference(image);
  const inspected = await dockerCommand(
    ['image', 'inspect', '--format', '{{.Id}}\t{{index .Config.Labels "jp.preferred.pfpdf.renderer-protocol"}}', image],
    job,
  );
  if (inspected.code !== 0) {
    const pulled = await dockerCommand(['pull', image], job);
    if (pulled.code !== 0) {
      throw new RuntimeError(processFailureMessage(`cannot pull Docker image ${image}`, pulled.output));
    }
  }
  const finalInspect = inspected.code === 0
    ? inspected
    : await dockerCommand(
      ['image', 'inspect', '--format', '{{.Id}}\t{{index .Config.Labels "jp.preferred.pfpdf.renderer-protocol"}}', image],
      job,
    );
  if (finalInspect.code !== 0) {
    throw new RuntimeError(processFailureMessage(`cannot inspect Docker image ${image}`, finalInspect.output));
  }
  const verifiedImageId = parseDockerImageInspection(finalInspect.output, image, job.dockerImage !== null);

  const generatedRoot = path.join(job.workspaceDir, 'docker-generated');
  fs.mkdirSync(generatedRoot, { recursive: true, mode: 0o700 });
  const generatedFiles: Record<string, string> = {};
  for (const [logical, content] of job.generated) {
    writeLogicalFile(generatedRoot, logical, content);
    generatedFiles[logical] = `/work/docker-generated/${logical}`;
  }
  const manifest: Record<string, string> = {};
  const mountArgs: string[] = [];
  for (let i = 0; i < job.manifestEntries.length; i++) {
    const [logical, hostPath] = job.manifestEntries[i]!;
    validateLogicalPath(logical);
    const target = `/pfpdf-assets/${String(i + 1).padStart(4, '0')}`;
    manifest[logical] = target;
    mountArgs.push('--mount', dockerMount({ type: 'bind', source: hostPath, target, readonly: true }));
  }
  const timeoutMs = job.deadline - Date.now();
  if (timeoutMs <= 0) throw new RuntimeError('render deadline exceeded before Docker start');
  const internalJob = {
    schemaVersion: 1,
    timeoutMs,
    outputPath: '/work/renderer-output/output.pdf',
    diagnosticsPath: '/work/renderer-diagnostics.log',
    logLevel: job.logLevel,
    browserPath: '/usr/bin/chromium',
    browserSandbox: false,
    manifest,
    generated: generatedFiles,
  };
  const jobPath = path.join(job.workspaceDir, 'docker-job.json');
  fs.writeFileSync(jobPath, JSON.stringify(internalJob), { mode: 0o600 });

  const containerName = `pfpdf-${crypto.randomBytes(8).toString('hex')}`;
  const args = [
    'run', '--rm', '--init', '--name', containerName, '--read-only', '--shm-size', '1g',
    '--tmpfs', '/tmp:rw,exec,nosuid,size=2g',
    '--mount', dockerMount({ type: 'bind', source: job.workspaceDir, target: '/work', readonly: false }),
    ...mountArgs,
  ];
  if (typeof process.getuid === 'function' && typeof process.getgid === 'function') {
    args.push('--user', `${process.getuid()}:${process.getgid()}`, '--env', 'HOME=/tmp/home');
  }
  args.push(verifiedImageId, '--internal-render-job', '/work/docker-job.json');
  const argvBytes = args.reduce((sum, value) => sum + Buffer.byteLength(value) + 1, 0);
  if (argvBytes > 128 * 1024) {
    throw new InputError(`Docker renderer argument list is too large (${argvBytes} bytes)`);
  }
  job.info(`starting Docker renderer ${verifiedImageId}`);
  let result: DockerCommandResult;
  try {
    result = await dockerCommand(args, job);
  } catch (e) {
    await removeDockerContainer(containerName);
    throw e;
  }
  try {
    fs.writeFileSync(
      path.join(job.workspaceDir, 'docker-diagnostics.log'),
      result.output,
      { mode: 0o600 },
    );
  } catch {
    // diagnostics are best effort
  }
  if (result.code !== 0) {
    await removeDockerContainer(containerName);
    throw new RuntimeError(processFailureMessage(
      `Docker renderer failed with exit code ${result.code}`,
      result.output,
    ));
  }
  const st = validateRendererOutput(job.outputPath);
  return { outputPath: job.outputPath, byteSize: st.size, elapsedMs: Date.now() - started };
}

export function parseDockerImageInspection(output: string, image: string, configured: boolean): string {
  const [imageId, protocol = ''] = output.trim().split('\t');
  if (!/^sha256:[0-9a-f]{64}$/i.test(imageId ?? '')) {
    throw new RuntimeError(`Docker returned an invalid content ID for image ${image}`);
  }
  if (protocol !== DOCKER_PROTOCOL) {
    const message = `Docker image protocol mismatch: expected ${DOCKER_PROTOCOL}, got ${protocol || 'missing'}`;
    if (!configured) throw new RuntimeError(`default ${message}`);
    throw new InputError(message);
  }
  return imageId!;
}

/** Best-effort cleanup with a fresh deadline because the render deadline has normally expired. */
async function removeDockerContainer(containerName: string): Promise<void> {
  const child = spawn('docker', ['rm', '--force', containerName], {
    shell: false,
    env: rendererChildEnv(),
    stdio: 'ignore',
  });
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish();
    }, 10000);
    child.once('error', finish);
    child.once('close', finish);
  });
}

interface DockerCommandResult { code: number; output: string }

async function dockerCommand(args: string[], job: RenderJob): Promise<DockerCommandResult> {
  const result = await runBoundedProcess('docker', args, {
    deadline: job.deadline,
    signal: job.signal,
    startError: 'failed to start Docker',
  });
  if (result.code === null) {
    const summary = result.stopReason === 'signal'
      ? 'Docker renderer interrupted by a signal'
      : 'Docker renderer timed out';
    throw new RuntimeError(processFailureMessage(summary, result.output));
  }
  return { code: result.code, output: result.output.toString('utf8') };
}

export function dockerMount(options: { type: 'bind'; source: string; target: string; readonly: boolean }): string {
  const fields = [`type=${options.type}`, `source=${options.source}`, `target=${options.target}`];
  if (options.readonly) fields.push('readonly');
  return fields.map((field) => csvField(field)).join(',');
}

function csvField(value: string): string {
  return /[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function validateRendererOutput(outputPath: string): fs.Stats {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(outputPath);
  } catch {
    throw new RuntimeError('renderer reported success but produced no output');
  }
  if (!st.isFile() || st.isSymbolicLink()) throw new RuntimeError('renderer output is not a regular file');
  if (st.size < 32) throw new RuntimeError('renderer output is too small to be a PDF');
  return st;
}
