import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildHtml } from '../build.js';
import { resolveConfig } from '../config.js';
import { InputError } from '../errors.js';
import { parseRepositoryLocator, RepositoryResolver } from '../repository.js';

const env = { SOURCE_DATE_EPOCH: '1750000000' };
const log = { warn: (): void => {}, info: (): void => {}, debug: (): void => {} };

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeRepository(t: TestContext): { root: string; url: string; commit: string; input: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-repository-test-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); });
  git(['init', '--quiet'], root);
  fs.mkdirSync(path.join(root, 'templates', 'corporate', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'logos', 'nested'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'templates', 'corporate', 'template.html'),
    '<!doctype html><html><head></head><body><p>Repository template</p><img data-pfpdf-slot="logo" src="assets/default.svg"><main data-pfpdf-slot="content"></main></body></html>',
  );
  fs.writeFileSync(path.join(root, 'templates', 'corporate', 'style.css'), '');
  fs.writeFileSync(path.join(root, 'templates', 'corporate', 'vivliostyle.css'), '');
  fs.writeFileSync(path.join(root, 'templates', 'corporate', 'assets', 'default.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(root, 'logos', 'nested', 'override.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  commitFixture(root);
  const inputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-repository-input-'));
  t.after(() => { fs.rmSync(inputDir, { recursive: true, force: true }); });
  const input = path.join(inputDir, 'document.md');
  fs.writeFileSync(input, '---\ntitle: Repository test\n---\nbody\n');
  return { root, url: pathToFileURL(root).href, commit: git(['rev-parse', 'HEAD'], root), input };
}

function commitFixture(root: string): void {
  git(['add', '.'], root);
  git(['-c', 'user.name=pfpdf test', '-c', 'user.email=pfpdf@example.invalid', 'commit', '--quiet', '-m', 'fixture'], root);
}

test('repository locator parses subdirectories and revisions and rejects traversal', () => {
  const parsed = parseRepositoryLocator(
    'git::https://example.com/assets.git//templates/nested/report?ref=v1.2.3',
  );
  assert.equal(parsed.url, 'https://example.com/assets.git');
  assert.equal(parsed.subpath, 'templates/nested/report');
  assert.equal(parsed.ref, 'v1.2.3');
  assert.throws(
    () => parseRepositoryLocator('git::https://example.com/assets.git//templates/../secret?ref=v1'),
    InputError,
  );
  assert.throws(
    () => parseRepositoryLocator('git::https://token@example.com/assets.git//templates/report?ref=v1'),
    InputError,
  );
  assert.throws(
    () => parseRepositoryLocator('git::https://example.com/assets.git//templates/report?ref=--help'),
    InputError,
  );
});

test('template and logo can be selected from repository subpaths', async (t) => {
  const fixture = makeRepository(t);
  const template = `git::${fixture.url}//templates/corporate?ref=${fixture.commit}`;
  const logo = `git::${fixture.url}//logos/nested/override.svg?ref=${fixture.commit}`;
  const config = resolveConfig([
    '--input', fixture.input,
    '--output', 'x.pdf',
    '--template', template,
    '--logo', logo,
  ], process.cwd());
  const result = await buildHtml(config, env, log);
  assert.match(result.html, /Repository template/);
  assert.match(result.html, /override\.svg/);
  assert.doesNotMatch(result.html, /default\.svg/);
});

test('repository template uses its own nested default logo', async (t) => {
  const fixture = makeRepository(t);
  const template = `git::${fixture.url}//templates/corporate?ref=${fixture.commit}`;
  const config = resolveConfig([
    '--input', fixture.input,
    '--output', 'x.pdf',
    '--template', template,
  ], process.cwd());
  const result = await buildHtml(config, env, log);
  assert.match(result.html, /default\.svg/);
});

const rootSuffixes = ['', '//', '//.'];

test('only template locators accept a repository root without a file path', () => {
  for (const suffix of rootSuffixes) {
    const locator = `git::https://example.com/assets.git${suffix}?ref=v1`;
    assert.throws(
      () => resolveConfig(['--input', 'x.md', '--output', 'x.pdf', '--logo', locator], process.cwd()),
      (error: unknown) => error instanceof InputError && error.message.startsWith('--logo: repository path'),
    );
  }
  for (const subpath of ['/', 'templates/.', 'templates/../..', 'templates//report', 'templates/']) {
    assert.throws(
      () => parseRepositoryLocator(`git::https://example.com/assets.git//${subpath}`, 'template'),
      /repository path must be a normalized relative path/,
    );
  }
});

test('repository root template locators load the chosen revision and its relative assets', async (t) => {
  const fixture = makeRepository(t);
  const rootTemplate = (marker: string): string =>
    `<!doctype html><html><head></head><body><p>${marker}</p><img data-pfpdf-slot="logo" src="assets/root-logo.svg"><main data-pfpdf-slot="content"></main></body></html>`;
  const templatePath = path.join(fixture.root, 'template.html');
  fs.writeFileSync(templatePath, rootTemplate('Pinned root template'));
  fs.writeFileSync(path.join(fixture.root, 'style.css'), '');
  fs.writeFileSync(path.join(fixture.root, 'vivliostyle.css'), '');
  fs.writeFileSync(path.join(fixture.root, 'unreferenced.txt'), 'Unused file');
  fs.mkdirSync(path.join(fixture.root, 'assets'));
  fs.writeFileSync(path.join(fixture.root, 'assets', 'root-logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  commitFixture(fixture.root);
  const pinned = git(['rev-parse', 'HEAD'], fixture.root);
  fs.writeFileSync(templatePath, rootTemplate('HEAD root template'));
  commitFixture(fixture.root);
  const head = git(['rev-parse', 'HEAD'], fixture.root);

  for (const suffix of rootSuffixes) {
    for (const ref of ['', pinned]) {
      const locator = `git::${fixture.url}${suffix}${ref === '' ? '' : `?ref=${ref}`}`;
      const warnings: string[] = [];
      const config = resolveConfig([
        '--input', fixture.input, '--output', 'x.pdf', '--template', locator,
      ], process.cwd());
      const result = await buildHtml(config, env, { ...log, warn: (message) => { warnings.push(message); } });
      const marker = ref === '' ? 'HEAD root template' : 'Pinned root template';
      assert.ok(result.html.includes(marker), locator);
      assert.match(result.html, /assets\/\d+\/root-logo\.svg/);
      const files = result.manifest.list().map(([, file]) => file.split(path.sep));
      assert.ok(files.some((parts) => parts.at(-1) === 'root-logo.svg'), locator);
      assert.ok(files.every((parts) => !parts.includes('.git') && !parts.includes('unreferenced.txt')), locator);
      assert.deepEqual(warnings.filter((message) => message.includes('repository source is not pinned')),
        ref === '' ? [`repository source is not pinned; resolved ${fixture.url} HEAD to ${head}`] : []);
    }
  }
});

const automaticAddress = 'example.com/assets.git';
const sshUrl = `ssh://git@${automaticAddress}`;
const httpsUrl = `https://${automaticAddress}`;

test('a bare repository address shares the explicit syntax for paths and refs', () => {
  assert.deepEqual(parseRepositoryLocator(`git::${automaticAddress}?ref=main`, 'template'), {
    original: `git::${automaticAddress}?ref=main`, url: sshUrl, fallbackUrl: httpsUrl, subpath: '.', ref: 'main',
  });
  for (const suffix of rootSuffixes) {
    const source = `git::${automaticAddress}${suffix}?ref=v1`;
    assert.equal(parseRepositoryLocator(source, 'template').subpath, '.');
    assert.throws(() => parseRepositoryLocator(source, 'logo'), /repository path/);
  }
  assert.equal(parseRepositoryLocator(`git::${automaticAddress}//logos/x.svg?ref=v1`, 'logo').subpath, 'logos/x.svg');
  assert.equal(parseRepositoryLocator(`git::${sshUrl}`, 'template').fallbackUrl, undefined);
  assert.equal(parseRepositoryLocator('git::ssh://servant@[::1]:2121/assets.git', 'template').url,
    'ssh://servant@[::1]:2121/assets.git');
  for (const bad of [
    './assets.git', 'assets/other.git', 'localhost/assets.git', '127.0.0.1/assets.git',
    'example.com', 'example.com:22/assets.git', '[::1]/assets.git', 'example.com:assets.git',
    'git@example.com/assets.git', 'user:secret@example.com/assets.git', 'example.com/../assets.git',
    'example.com/assets.git//../logo.svg', 'example.com/assets.git?ref=--help',
    'example.com/assets.git#main', 'example.com/space here.git',
  ]) {
    assert.throws(() => parseRepositoryLocator(`git::${bad}`, 'template'), InputError, bad);
  }
});

interface TraceEvent {
  event: string;
  sid?: string;
  argv?: string[];
  param?: string;
  value?: string;
}

function withRewrites(t: TestContext, primary: string, fallback: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-repository-transport-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); });
  const trace = path.join(root, 'trace.jsonl');
  const gitConfig = path.join(root, 'gitconfig');
  fs.writeFileSync(gitConfig, '');
  const testEnv = {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: `url.${primary}.insteadOf`,
    GIT_CONFIG_VALUE_0: sshUrl,
    GIT_CONFIG_KEY_1: `url.${fallback}.insteadOf`,
    GIT_CONFIG_VALUE_1: httpsUrl,
    GIT_ASKPASS: 'unwanted-interactive-prompt',
    GIT_TRACE2_EVENT: trace,
    GIT_TRACE2_ENV_VARS: 'GIT_TERMINAL_PROMPT,GIT_ASKPASS,SSH_ASKPASS_REQUIRE,GCM_INTERACTIVE',
  };
  const events = (): TraceEvent[] => fs.readFileSync(trace, 'utf8').trim().split('\n')
    .map((line) => JSON.parse(line) as TraceEvent);
  const fetches = (): Array<string | undefined> => events().filter((event) =>
    event.event === 'start' && event.argv?.[3] === 'fetch').map((event) => event.argv?.at(-1));
  return { root, testEnv, events, fetches };
}

test('automatic SSH success is shared between template and logo without trying HTTPS', async (t) => {
  const fixture = makeRepository(t);
  const testGit = withRewrites(t, fixture.url, pathToFileURL(path.join(fixture.root, 'unavailable')).href);
  const locator = `git::${automaticAddress}`;
  const config = resolveConfig([
    '--input', fixture.input, '--output', 'x.pdf',
    '--template', `${locator}//templates/corporate?ref=${fixture.commit}`,
    '--logo', `${locator}//logos/nested/override.svg?ref=${fixture.commit}`,
  ], process.cwd());
  const result = await buildHtml(config, testGit.testEnv, log);
  assert.match(result.html, /Repository template/);
  assert.match(result.html, /override\.svg/);
  assert.deepEqual(testGit.fetches(), [fixture.commit]);
});

test('automatic fetch tries HTTPS after SSH failure and avoids prompts', async (t) => {
  const fixture = makeRepository(t);
  const testGit = withRewrites(t, pathToFileURL(path.join(fixture.root, 'unavailable')).href, fixture.url);
  const messages: string[] = [];
  const resolver = new RepositoryResolver(path.join(testGit.root, 'checkouts'), log.warn,
    (message) => { messages.push(message); }, testGit.testEnv);
  const resolved = await resolver.resolve(`git::${automaticAddress}//templates/corporate?ref=${fixture.commit}`, 'template');
  assert.equal(resolved.commit, fixture.commit);
  const logo = await resolver.resolve(`git::${automaticAddress}//logos/nested/override.svg?ref=${fixture.commit}`, 'logo');
  assert.equal(logo.repositoryRoot, resolved.repositoryRoot);
  assert.deepEqual(testGit.fetches(), [fixture.commit, fixture.commit]);
  assert.match(messages.join('\n'), /SSH URL failed .*trying the HTTPS URL/);
  assert.ok(messages.includes(`resolved repository ${httpsUrl} at ${fixture.commit}`));
  const events = testGit.events();
  for (const { sid } of events.filter((event) => event.event === 'start' && event.argv?.[3] === 'fetch')) {
    assert.ok(sid);
    const observed = new Map(events.filter((event) => event.event === 'def_param' && event.sid === sid)
      .map((event) => [event.param, event.value]));
    assert.equal(observed.get('GIT_TERMINAL_PROMPT'), '0');
    assert.equal(observed.get('GIT_ASKPASS') ?? '', '');
    assert.equal(observed.get('SSH_ASKPASS_REQUIRE'), 'never');
    assert.equal(observed.get('GCM_INTERACTIVE'), '0');
  }
});

test('both failed transports produce safe diagnoses without leaking stderr', async (t) => {
  const fixture = makeRepository(t);
  const marker = 'never-show-this-helper-secret';
  const testGit = withRewrites(t, pathToFileURL(path.join(fixture.root, marker, 'ssh')).href,
    pathToFileURL(path.join(fixture.root, marker, 'https')).href);
  const resolver = new RepositoryResolver(path.join(testGit.root, 'checkouts'), log.warn, log.info, testGit.testEnv);
  await assert.rejects(resolver.resolve(`git::${automaticAddress}?ref=${fixture.commit}`, 'template'), (error: unknown) =>
    error instanceof Error && /repository fetch failed: SSH URL: .*, HTTPS URL: /.test(error.message) && !error.message.includes(marker));
  assert.deepEqual(testGit.fetches(), [fixture.commit, fixture.commit]);
});

test('an explicit URL is tried once even when the other transport has the revision', async (t) => {
  const fixture = makeRepository(t);
  for (const url of [sshUrl, httpsUrl]) {
    const missing = pathToFileURL(path.join(fixture.root, 'unavailable')).href;
    const testGit = url === sshUrl ? withRewrites(t, missing, fixture.url) : withRewrites(t, fixture.url, missing);
    const resolver = new RepositoryResolver(path.join(testGit.root, 'checkouts'), log.warn, log.info, testGit.testEnv);
    await assert.rejects(resolver.resolve(`git::${url}?ref=${fixture.commit}`, 'template'), /git fetch failed|not accessible/);
    assert.deepEqual(testGit.fetches(), [fixture.commit]);
  }
});

test('a path or template error following a successful fetch does not try HTTPS', async (t) => {
  const fixture = makeRepository(t);
  fs.writeFileSync(path.join(fixture.root, 'templates', 'corporate', 'style.css'), '@import "./missing.css";');
  commitFixture(fixture.root);
  const pinned = git(['rev-parse', 'HEAD'], fixture.root);
  for (const [subpath, message] of [
    ['//missing', /path not found/],
    ['//logos', /template\.html/],
    ['//templates/corporate', /missing\.css/],
  ] as const) {
    const testGit = withRewrites(t, fixture.url, fixture.url);
    const config = resolveConfig([
      '--input', fixture.input, '--output', 'x.pdf',
      '--template', `git::${automaticAddress}${subpath}?ref=${pinned}`,
    ], process.cwd());
    await assert.rejects(buildHtml(config, testGit.testEnv, log), message);
    assert.deepEqual(testGit.fetches(), [pinned]);
  }
});

test('an automatic SSH timeout leaves time and an unlocked checkout for HTTPS', async (t) => {
  const fixture = makeRepository(t);
  const testGit = withRewrites(t, sshUrl, fixture.url);
  const timedOut = path.join(testGit.root, 'stall-ssh.cjs');
  // Git runs SSH in the checkout. A fetch stopped mid-transfer leaves this lock behind.
  fs.writeFileSync(timedOut, 'require("node:fs").writeFileSync(".git/shallow.lock", ""); setTimeout(() => {}, 10000);');
  const messages: string[] = [];
  const resolver = new RepositoryResolver(path.join(testGit.root, 'checkouts'), log.warn,
    (message) => { messages.push(message); }, {
      ...testGit.testEnv,
      GIT_SSH_VARIANT: 'simple',
      GIT_SSH_COMMAND: `"${process.execPath.replaceAll('\\', '/')}" "${timedOut.replaceAll('\\', '/')}"`,
    }, 4000);
  const result = await resolver.resolve(`git::${automaticAddress}//templates/corporate?ref=${fixture.commit}`, 'template');
  assert.equal(result.commit, fixture.commit);
  assert.deepEqual(testGit.fetches(), [fixture.commit, fixture.commit]);
  assert.ok(messages.includes('repository fetch from the SSH URL failed (git fetch timed out after 2000 ms); trying the HTTPS URL'));
});
