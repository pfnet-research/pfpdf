import test from 'node:test';
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

function makeRepository(): { root: string; url: string; commit: string; input: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-repository-test-'));
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
  git(['add', '.'], root);
  git(['-c', 'user.name=pfpdf test', '-c', 'user.email=pfpdf@example.invalid', 'commit', '--quiet', '-m', 'fixture'], root);
  const inputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-repository-input-'));
  const input = path.join(inputDir, 'document.md');
  fs.writeFileSync(input, '---\ntitle: Repository test\n---\nbody\n');
  return { root, url: pathToFileURL(root).href, commit: git(['rev-parse', 'HEAD'], root), input };
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

test('template and logo can be selected from repository subpaths', async () => {
  const fixture = makeRepository();
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

test('repository template uses its own nested default logo', async () => {
  const fixture = makeRepository();
  const template = `git::${fixture.url}//templates/corporate?ref=${fixture.commit}`;
  const config = resolveConfig([
    '--input', fixture.input,
    '--output', 'x.pdf',
    '--template', template,
  ], process.cwd());
  const result = await buildHtml(config, env, log);
  assert.match(result.html, /default\.svg/);
});
