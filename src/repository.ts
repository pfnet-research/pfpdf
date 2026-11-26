/** Resolve trusted files and directories from explicitly selected Git repositories. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { InputError, RuntimeError } from './errors.js';

export interface RepositoryLocator {
  original: string;
  url: string;
  fallbackUrl?: string;
  subpath: string;
  ref: string | null;
}

export interface ResolvedRepositoryPath {
  path: string;
  repositoryRoot: string;
  commit: string;
  locator: RepositoryLocator;
}

const FETCH_TIMEOUT_MS = 300_000;
const AUTO_SSH_TIMEOUT_MS = 30_000;

type RepositoryRole = 'template' | 'logo';

export function parseRepositoryLocator(value: string, role?: RepositoryRole): RepositoryLocator {
  const source = role === undefined ? 'repository source' : `--${role}`;
  if (!value.startsWith('git::')) {
    const syntax = role === 'template' ? 'git::URL[//PATH][?ref=REVISION]' : 'git::URL//PATH[?ref=REVISION]';
    throw new InputError(`${source}: expected ${syntax}`);
  }
  if (value.includes('\0')) throw new InputError(`${source}: NUL character is not allowed`);
  const address = value.slice('git::'.length);
  const queryAt = address.indexOf('?');
  const packageAndPath = queryAt < 0 ? address : address.slice(0, queryAt);
  const query = queryAt < 0 ? '' : address.slice(queryAt + 1);
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(packageAndPath)?.[0];
  const separatorAt = packageAndPath.indexOf('//', scheme?.length ?? 0);
  if (separatorAt < 0 && role !== 'template') {
    throw new InputError(`${source}: repository path is required after //`);
  }
  const urlText = separatorAt < 0 ? packageAndPath : packageAndPath.slice(0, separatorAt);
  const rawSubpath = separatorAt < 0 ? '' : packageAndPath.slice(separatorAt + 2);
  const selectsRoot = role === 'template' && (rawSubpath === '' || rawSubpath === '.');
  const urls = scheme === undefined ? implicitRepositoryUrls(urlText, source) : { url: urlText };
  validateRepositoryUrl(urls.url, source);
  if (!selectsRoot) validateRepositorySubpath(rawSubpath, source);
  const subpath = selectsRoot ? '.' : rawSubpath;
  const ref = parseRepositoryRef(query, source);
  return { original: value, ...urls, subpath, ref };
}

function implicitRepositoryUrls(address: string, source: string): { url: string; fallbackUrl: string } {
  const [host = '', ...parts] = address.split('/');
  // A dotted DNS name with a repository path cannot be confused with a local
  // path or SCP-like Git syntax. Use an explicit URL for other SSH addresses.
  const dnsLabel = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
  const domain = new RegExp(`^(?:${dnsLabel}\\.)+[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$`);
  if (!domain.test(host) || host.length > 253 || parts.length === 0
      || parts.some((part) => !/^[A-Za-z0-9._~-]+$/.test(part) || part === '.' || part === '..')) {
    throw new InputError(`${source}: expected a dotted host and repository path, or an explicit https://, ssh://, or file:// URL`);
  }
  return { url: `ssh://git@${address}`, fallbackUrl: `https://${address}` };
}

function validateRepositoryUrl(urlText: string, source: string): void {
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    throw new InputError(`${source}: invalid repository URL`);
  }
  if (!['https:', 'ssh:', 'file:'].includes(url.protocol)) {
    throw new InputError(`${source}: repository URL must use https://, ssh://, or file://`);
  }
  if (url.password !== '' || (url.protocol === 'https:' && url.username !== '')) {
    throw new InputError(`${source}: credentials must not be embedded in the repository URL`);
  }
}

function parseRepositoryRef(query: string, source: string): string | null {
  const params = new URLSearchParams(query);
  for (const key of params.keys()) {
    if (key !== 'ref') throw new InputError(`${source}: unknown query parameter: ${key}`);
  }
  const refs = params.getAll('ref');
  if (refs.length > 1) throw new InputError(`${source}: ref may be specified only once`);
  const ref = refs[0] ?? null;
  if (ref === '') throw new InputError(`${source}: ref must not be empty`);
  if (ref?.includes('\0')) throw new InputError(`${source}: ref contains a NUL character`);
  if (ref?.startsWith('-')) throw new InputError(`${source}: ref must not start with '-'`);
  return ref;
}

function validateRepositorySubpath(subpath: string, source: string): void {
  if (
    subpath === '' || subpath.startsWith('/') || subpath.includes('\\') ||
    subpath.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new InputError(`${source}: repository path must be a normalized relative path`);
  }
}

interface Checkout {
  root: string;
  commit: string;
}

export class RepositoryResolver {
  private readonly checkouts = new Map<string, Promise<Checkout>>();
  private sequence = 0;

  constructor(
    private readonly root: string,
    private readonly warn: (message: string) => void,
    private readonly info: (message: string) => void,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly timeoutMs = FETCH_TIMEOUT_MS,
  ) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  }

  async resolve(locatorText: string, role: RepositoryRole): Promise<ResolvedRepositoryPath> {
    const option = `--${role}`;
    const locator = parseRepositoryLocator(locatorText, role);
    const key = `${locator.url}\0${locator.fallbackUrl ?? ''}\0${locator.ref ?? ''}`;
    let pending = this.checkouts.get(key);
    if (!pending) {
      pending = this.checkout(locator);
      this.checkouts.set(key, pending);
    }
    const checkout = await pending;
    const selected = path.resolve(checkout.root, ...locator.subpath.split('/'));
    const rootPrefix = checkout.root.endsWith(path.sep) ? checkout.root : checkout.root + path.sep;
    if (locator.subpath !== '.' && !selected.startsWith(rootPrefix)) {
      throw new InputError(`${option}: repository path escapes the checkout`);
    }
    let real: string;
    let stat: fs.Stats;
    try {
      real = fs.realpathSync(selected);
      stat = fs.statSync(real);
      fs.accessSync(real, fs.constants.R_OK);
    } catch {
      throw new InputError(`${option}: path not found or unreadable: ${locator.subpath}`);
    }
    if (!(real === checkout.root || real.startsWith(rootPrefix))) {
      throw new InputError(`${option}: selected path resolves outside the checkout`);
    }
    if (role === 'template' ? !stat.isDirectory() : !stat.isFile()) {
      throw new InputError(
        `${option}: selected path is not ${role === 'template' ? 'a directory' : 'a regular file'}: ${locator.subpath}`,
      );
    }
    return { path: real, repositoryRoot: checkout.root, commit: checkout.commit, locator };
  }

  private async checkout(locator: RepositoryLocator): Promise<Checkout> {
    this.sequence++;
    const destination = path.join(this.root, `git-${String(this.sequence).padStart(4, '0')}`);
    fs.mkdirSync(destination, { mode: 0o700 });
    await runGit(['init', '--quiet', destination], this.env, this.timeoutMs);
    await runGit(['-C', destination, 'remote', 'add', 'origin', locator.url], this.env, this.timeoutMs);
    const resolvedUrl = await this.fetch(destination, locator);
    await runGit(
      ['-C', destination, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'],
      this.env,
      this.timeoutMs,
    );
    const commit = (await runGit(
      ['-C', destination, 'rev-parse', 'HEAD'],
      this.env,
      this.timeoutMs,
    )).trim();
    if (locator.ref === null) {
      this.warn(`repository source is not pinned; resolved ${resolvedUrl} HEAD to ${commit}`);
    }
    this.info(`resolved repository ${resolvedUrl} at ${commit}`);
    return { root: fs.realpathSync(destination), commit };
  }
  private async fetch(destination: string, locator: RepositoryLocator): Promise<string> {
    const fetchArgs = [
      '-C', destination, 'fetch', '--quiet', '--depth=1', '--no-tags',
      '--no-recurse-submodules', 'origin', locator.ref ?? 'HEAD',
    ];
    if (locator.fallbackUrl === undefined) {
      await runGit(fetchArgs, this.env, this.timeoutMs, 'explicit');
      return locator.url;
    }

    const deadline = performance.now() + this.timeoutMs;
    // Keep time for the HTTPS attempt even when SSH cannot connect.
    const sshTimeout = Math.max(1, Math.min(AUTO_SSH_TIMEOUT_MS, Math.floor(this.timeoutMs / 2)));
    try {
      await runGit(fetchArgs, this.env, sshTimeout, 'automatic');
      return locator.url;
    } catch (sshError) {
      if (!(sshError instanceof GitFetchError)) throw sshError;
      this.info(`repository fetch from the SSH URL failed (${sshError.message}); trying the HTTPS URL`);
      const remaining = (): number => {
        const time = Math.floor(deadline - performance.now());
        if (time <= 0) throw new GitFetchError('repository fetch timed out');
        return time;
      };
      try {
        await runGit(['-C', destination, 'remote', 'set-url', 'origin', locator.fallbackUrl], this.env, remaining());
        await runGit(fetchArgs, this.env, remaining(), 'automatic');
        return locator.fallbackUrl;
      } catch (httpsError) {
        if (!(httpsError instanceof GitFetchError)) throw httpsError;
        throw new RuntimeError(`repository fetch failed: SSH URL: ${sshError.message}, HTTPS URL: ${httpsError.message}`);
      }
    }
  }
}

class GitFetchError extends RuntimeError {}

function fetchFailure(stderr: string, exit: string): GitFetchError {
  // Remote servers and credential helpers can print credentials in stderr.
  // Report known causes without copying their output into logs or --doctor.
  const causes: Array<[RegExp, string]> = [
    [/host key verification failed|remote host identification has changed/i, 'SSH host key verification failed'],
    [/authentication failed|permission denied|access denied|could not read username|terminal prompts disabled|returned error: (401|403)\b/i, 'authentication failed'],
    [/could not resolve (host|hostname)|name or service not known/i, 'hostname could not be resolved'],
    [/connection (timed out|refused|reset)|failed to connect|network is unreachable/i, 'network connection failed'],
    [/couldn.t find remote ref|reference is not a tree|not our ref/i, 'revision could not be fetched'],
    [/repository not found|does not appear to be a git repository|returned error: 404\b/i, 'repository not found or not accessible'],
    [/certificate problem|certificate verification failed/i, 'TLS certificate verification failed'],
  ];
  const cause = causes.find(([pattern]) => pattern.test(stderr))?.[1];
  return new GitFetchError(cause ?? `git fetch failed (${exit})`);
}

async function runGit(
  args: string[],
  env: Record<string, string | undefined>,
  timeoutMs: number,
  fetch?: 'explicit' | 'automatic',
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const separateSession = process.platform !== 'win32';
    let child;
    try {
      child = spawn('git', args, {
        shell: false,
        detached: separateSession,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...env,
          GIT_TERMINAL_PROMPT: '0',
          ...(fetch === 'automatic' ? { GIT_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never', GCM_INTERACTIVE: '0' } : {}),
        },
      });
    } catch (error) {
      reject(new RuntimeError(`cannot start git: ${(error as Error).message}`));
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        if (separateSession && child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // The process group may have already exited.
      }
      child.stdout.destroy();
      child.stderr.destroy();
      const message = `git ${fetch ? 'fetch' : 'command'} timed out after ${timeoutMs} ms`;
      reject(fetch ? new GitFetchError(message) : new RuntimeError(message));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8192); });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new RuntimeError(`cannot run git: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        const exit = signal ? `signal ${signal}` : `exit code ${String(code)}`;
        reject(fetch ? fetchFailure(stderr, exit) : new RuntimeError(`git command failed: ${stderr.trim() || exit}`));
      }
    });
  });
}
