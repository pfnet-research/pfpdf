/** Internal Docker entry point. This is not part of the public CLI contract. */
import fs from 'node:fs';
import path from 'node:path';
import { AssetServer } from './assetserver.js';
import { ResourceManifest } from './resources.js';
import { renderWithAssetServer } from './renderer.js';
import { RuntimeError, exitCodeOf } from './errors.js';

interface InternalJob {
  schemaVersion: 1;
  timeoutMs: number;
  outputPath: string;
  diagnosticsPath: string;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  browserPath: string;
  browserSandbox: boolean;
  manifest: Record<string, string>;
  generated: Record<string, string>;
}

export async function internalRenderMain(jobPath: string): Promise<number> {
  try {
    const job = readJob(jobPath);
    if (process.env.HOME) fs.mkdirSync(process.env.HOME, { recursive: true, mode: 0o700 });
    const manifest = new ResourceManifest();
    for (const [logical, file] of Object.entries(job.manifest)) manifest.addExplicit(logical, file);
    const generated = new Map<string, Buffer>();
    for (const [logical, file] of Object.entries(job.generated)) {
      generated.set(logical, fs.readFileSync(file));
    }
    const server = new AssetServer(manifest, generated);
    const controller = new AbortController();
    const abort = (): void => {
      controller.abort();
    };
    process.once('SIGINT', abort);
    process.once('SIGTERM', abort);
    try {
      const deadline = Date.now() + job.timeoutMs;
      await renderWithAssetServer(server, {
        outputPath: job.outputPath,
        deadline,
        browserPath: job.browserPath,
        browserSandbox: job.browserSandbox,
        logLevel: job.logLevel,
        diagnosticsPath: job.diagnosticsPath,
        warn: (message) => process.stderr.write(`pfpdf: warn: ${message}\n`),
        info: (message) => {
          if (job.logLevel === 'info' || job.logLevel === 'debug') {
            process.stderr.write(`pfpdf: info: ${message}\n`);
          }
        },
        signal: controller.signal,
      }, controller);
      return 0;
    } finally {
      process.removeListener('SIGINT', abort);
      process.removeListener('SIGTERM', abort);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`pfpdf: internal renderer error: ${message}\n`);
    return exitCodeOf(e);
  }
}

function readJob(jobPath: string): InternalJob {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  } catch (e) {
    throw new RuntimeError(`cannot read internal render job: ${(e as Error).message}`);
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) throw new RuntimeError('invalid internal render job schema');
  const timeoutMs = parsed.timeoutMs;
  if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) {
    throw new RuntimeError('invalid internal render timeout');
  }
  const outputPath = absoluteString(parsed.outputPath, 'outputPath');
  const diagnosticsPath = absoluteString(parsed.diagnosticsPath, 'diagnosticsPath');
  const browserPath = absoluteString(parsed.browserPath, 'browserPath');
  if (typeof parsed.browserSandbox !== 'boolean') {
    throw new RuntimeError('invalid internal render browserSandbox');
  }
  const logLevel = parsed.logLevel;
  if (logLevel !== 'error' && logLevel !== 'warn' && logLevel !== 'info' && logLevel !== 'debug') {
    throw new RuntimeError('invalid internal render log level');
  }
  return {
    schemaVersion: 1,
    timeoutMs,
    outputPath,
    diagnosticsPath,
    browserPath,
    browserSandbox: parsed.browserSandbox,
    logLevel,
    manifest: stringRecord(parsed.manifest, 'manifest'),
    generated: stringRecord(parsed.generated, 'generated'),
  };
}

function absoluteString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.includes('\0') || !path.isAbsolute(value)) {
    throw new RuntimeError(`invalid internal render ${name}`);
  }
  return value;
}

function stringRecord(value: unknown, name: string): Record<string, string> {
  if (!isRecord(value)) throw new RuntimeError(`invalid internal render ${name}`);
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, item] of Object.entries(value)) {
    if (key === '' || key.includes('\0') || typeof item !== 'string' || item.includes('\0') || !path.isAbsolute(item)) {
      throw new RuntimeError(`invalid internal render ${name} entry`);
    }
    result[key] = item;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
