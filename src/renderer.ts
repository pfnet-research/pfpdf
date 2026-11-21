/** Vivliostyle CLI renderer and bounded child-process coordination. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { StringDecoder } from 'node:string_decoder';
import { InputError, RuntimeError } from './errors.js';
import { AssetServer } from './assetserver.js';
import { describeDaemon } from './daemon.js';
import type { ResourceManifest } from './resources.js';

export interface RenderJob {
  documentUrl: string;
  outputPath: string;
  deadline: number;
  browserPath: string | null;
  logLevel: string;
  diagnosticsPath: string;
  vivliostyleCli?: string | undefined;
  daemonSocket?: string | undefined;
  standaloneSocket?: string | undefined;
  /** Child cwd, kept outside the output subtree for Vivliostyle path checks. */
  processCwd?: string | undefined;
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
  manifest: ResourceManifest;
  generated: Map<string, Buffer>;
  workspaceDir: string;
  controller: AbortController;
}

/** Serve the prepared document graph and render it with Vivliostyle. */
export async function renderDocument(job: DocumentRenderJob): Promise<RenderResult> {
  const server = new AssetServer(job.manifest, job.generated);
  if (job.processCwd !== undefined || job.standaloneSocket !== undefined) {
    return renderWithAssetServer(server, job, job.controller);
  }
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
      } catch (renderError) {
        if ((job.daemonSocket !== undefined || job.standaloneSocket !== undefined) && error instanceof Error &&
          renderError instanceof RenderProcessError && error !== renderError) {
          throw new RenderProcessError(error.message, renderError.diagnostics);
        }
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

export function resolveVivliostyleCli(override: string | null = null): string {
  if (override !== null) {
    try {
      if (!fs.statSync(override).isFile()) throw new Error('expected a regular file');
      fs.accessSync(override, fs.constants.R_OK);
    } catch (error) {
      throw new InputError(`--vivliostyle-cli: ${override}: ${(error as Error).message}`);
    }
    return override;
  }
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('@vivliostyle/cli/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { bin?: Record<string, string> | string };
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.vivliostyle;
  if (!bin) throw new RuntimeError('cannot locate the Vivliostyle CLI entry point');
  return path.join(path.dirname(pkgPath), bin);
}

export function validateDaemonContext(dir: string): string {
  const context = path.join(dir, 'context');
  try {
    if (!fs.statSync(context).isDirectory()) throw new Error('expected a directory');
    fs.accessSync(context, fs.constants.X_OK);
  } catch (error) {
    throw new InputError(`--vivliostyle-daemon-dir: ${context}: ${(error as Error).message}`);
  }
  return context;
}

export function validateDaemonSocket(dir: string, allowMissing = false): string {
  const socket = path.join(dir, 'daemon.sock');
  try {
    const stat = fs.lstatSync(socket, { throwIfNoEntry: !allowMissing });
    if (stat !== undefined && !stat.isSocket()) throw new Error('expected a Unix socket');
  } catch (error) {
    throw new InputError(`--vivliostyle-daemon-dir: ${socket}: ${(error as Error).message}`);
  }
  return socket;
}

export async function renderLocal(job: RenderJob): Promise<RenderResult> {
  const started = Date.now();
  let session: Awaited<ReturnType<typeof describeDaemon>> | undefined;
  if (job.standaloneSocket !== undefined) {
    try {
      session = await describeDaemon(job.standaloneSocket, job.deadline, job.signal);
    } catch (error) {
      const diagnostics = Buffer.from(`${(error as Error).message}\n`);
      writeDiagnostics(job.diagnosticsPath, diagnostics);
      throw new RenderProcessError('Vivliostyle daemon discovery failed', diagnostics);
    }
  }
  const cliPath = session?.cliPath ?? job.vivliostyleCli ?? resolveVivliostyleCli();
  const daemonSocket = job.standaloneSocket ?? job.daemonSocket;
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
  args.push('--sandbox');
  if (job.browserPath !== null) {
    args.push('--executable-browser', job.browserPath);
  }
  if (daemonSocket !== undefined) {
    args.push('--build-daemon', daemonSocket);
  }

  job.info(`starting Vivliostyle CLI (timeout ${timeoutSec}s)`);
  const processResult = await runBoundedProcess(process.execPath, args, {
    deadline: job.deadline,
    signal: job.signal,
    cwd: session?.cwd ?? job.processCwd,
    daemonClient: daemonSocket !== undefined,
    startError: 'failed to start Vivliostyle CLI',
    streamOutput: job.logLevel === 'debug' || job.logLevel === 'info',
    onTimeout: () => {
      job.warn('render timeout reached; terminating renderer');
    },
  });

  writeDiagnostics(job.diagnosticsPath, processResult.output);

  if (processResult.code === null) {
    const summary = processResult.stopReason === 'signal'
      ? 'renderer interrupted by a signal'
      : 'renderer timed out or was terminated by a signal';
    throw new RenderProcessError(summary, processResult.output);
  }
  if (processResult.code !== 0) {
    throw new RenderProcessError(
      `Vivliostyle CLI failed with exit code ${processResult.code}`,
      processResult.output,
    );
  }
  let st: fs.Stats;
  try {
    st = validateRendererOutput(job.outputPath);
  } catch (error) {
    throw new RenderProcessError((error as Error).message, processResult.output);
  }
  return { outputPath: job.outputPath, byteSize: st.size, elapsedMs: Date.now() - started };
}

function writeDiagnostics(destination: string, output: Buffer): void {
  try {
    fs.writeFileSync(destination, output, { mode: 0o600 });
  } catch {
    // diagnostics are best effort
  }
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
// Vivliostyle's daemon client can take up to 12 seconds to cancel.
const DAEMON_STOP_GRACE_MS = 13000;
const DAEMON_STOP_FALLBACK_MS = 15000;

export interface BoundedProcessOptions {
  deadline: number;
  signal?: AbortSignal | undefined;
  cwd?: string | undefined;
  daemonClient?: boolean;
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

class RenderProcessError extends RuntimeError {
  constructor(summary: string, readonly diagnostics: Buffer) {
    super(processFailureMessage(summary, diagnostics));
  }
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
      }, options.daemonClient === true ? DAEMON_STOP_GRACE_MS : STOP_GRACE_MS);
      fallbackTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        if (options.daemonClient === true) {
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
        }
        resolve(null);
      }, options.daemonClient === true ? DAEMON_STOP_FALLBACK_MS : STOP_FALLBACK_MS);
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
