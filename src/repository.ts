/** Resolve trusted files and directories from explicitly selected Git repositories. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { InputError, RuntimeError } from './errors.js';

export interface RepositoryLocator {
  original: string;
  url: string;
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

export function parseRepositoryLocator(value: string, source = 'repository source'): RepositoryLocator {
  if (!value.startsWith('git::')) {
    throw new InputError(`${source}: expected git::URL//PATH?ref=REVISION`);
  }
  if (value.includes('\0')) throw new InputError(`${source}: NUL character is not allowed`);
  const address = value.slice('git::'.length);
  const queryAt = address.indexOf('?');
  const packageAndPath = queryAt < 0 ? address : address.slice(0, queryAt);
  const query = queryAt < 0 ? '' : address.slice(queryAt + 1);
  const schemeAt = packageAndPath.indexOf('://');
  if (schemeAt < 0) {
    throw new InputError(`${source}: repository URL must use https://, ssh://, or file://`);
  }
  const separatorAt = packageAndPath.indexOf('//', schemeAt + 3);
  if (separatorAt < 0) {
    throw new InputError(`${source}: repository path is required after //`);
  }
  const urlText = packageAndPath.slice(0, separatorAt);
  const subpath = packageAndPath.slice(separatorAt + 2);
  validateRepositoryUrl(urlText, source);
  validateRepositorySubpath(subpath, source);
  const ref = parseRepositoryRef(query, source);
  return { original: value, url: urlText, subpath, ref };
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

  async resolve(locatorText: string, role: 'template' | 'logo'): Promise<ResolvedRepositoryPath> {
    const option = `--${role}`;
    const locator = parseRepositoryLocator(locatorText, option);
    const key = `${locator.url}\0${locator.ref ?? ''}`;
    let pending = this.checkouts.get(key);
    if (!pending) {
      pending = this.checkout(locator);
      this.checkouts.set(key, pending);
    }
    const checkout = await pending;
    const selected = path.resolve(checkout.root, ...locator.subpath.split('/'));
    const rootPrefix = checkout.root.endsWith(path.sep) ? checkout.root : checkout.root + path.sep;
    if (!selected.startsWith(rootPrefix)) {
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
    const fetchRef = locator.ref ?? 'HEAD';
    await runGit([
      '-C', destination, 'fetch', '--quiet', '--depth=1', '--no-tags',
      '--no-recurse-submodules', 'origin', fetchRef,
    ], this.env, this.timeoutMs);
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
      this.warn(`repository source is not pinned; resolved ${locator.url} HEAD to ${commit}`);
    }
    this.info(`resolved repository ${locator.url} at ${commit}`);
    return { root: fs.realpathSync(destination), commit };
  }
}

async function runGit(
  args: string[],
  env: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<string> {
    return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child;
    try {
      child = spawn('git', args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...env, GIT_TERMINAL_PROMPT: '0' },
      });
    } catch (error) {
      reject(new RuntimeError(`cannot start git: ${(error as Error).message}`));
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill('SIGKILL');
      settled = true;
      reject(new RuntimeError(`git command timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
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
        const detail = stderr.trim() || `exit code ${String(code)}${signal ? `, signal ${signal}` : ''}`;
        reject(new RuntimeError(`git command failed: ${detail}`));
      }
    });
  });
}
