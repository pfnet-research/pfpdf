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
import { parseRepositoryLocator } from '../repository.js';

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
