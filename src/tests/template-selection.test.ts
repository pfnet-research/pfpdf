import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHtml } from '../build.js';
import { resolveConfig } from '../config.js';
import { InputError } from '../errors.js';

const log = { warn: (): void => {}, info: (): void => {}, debug: (): void => {} };
const env = { SOURCE_DATE_EPOCH: '1750000000' };

function makeDoc(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-template-selection-'));
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(input, content);
  return input;
}

function config(args: string[], processEnv: Record<string, string> = {}): ReturnType<typeof resolveConfig> {
  return resolveConfig(args, processEnv, process.cwd());
}

test('front matter selects a bundled template and external settings override it', async () => {
  const input = makeDoc('---\ntitle: T\ntemplate: pfn\n---\nbody\n');

  const fromDocument = await buildHtml(
    config(['--input', input, '--output', 'x.pdf']),
    env,
    log,
  );
  assert.match(fromDocument.html, /pfn-cover/);

  const fromEnvironment = await buildHtml(
    config(['--input', input, '--output', 'x.pdf'], { PFPDF_TEMPLATE: 'compact' }),
    env,
    log,
  );
  assert.match(fromEnvironment.html, /compact-header/);
  assert.doesNotMatch(fromEnvironment.html, /pfn-cover/);

  const fromCli = await buildHtml(
    config(['--input', input, '--output', 'x.pdf', '--template', 'book']),
    env,
    log,
  );
  assert.match(fromCli.html, /book-cover/);
  assert.doesNotMatch(fromCli.html, /pfn-cover/);
});

test('CLI template does not hide an invalid front matter template', async () => {
  const input = makeDoc('---\ntitle: T\ntemplate: missing\n---\nbody\n');
  await assert.rejects(
    buildHtml(
      config(['--input', input, '--output', 'x.pdf', '--template', 'book']),
      env,
      log,
    ),
    InputError,
  );
});

test('--template-dir overrides a front matter bundled template', async () => {
  const input = makeDoc('---\ntitle: T\ntemplate: pfn\n---\nbody\n');
  const templateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-template-selection-custom-'));
  fs.writeFileSync(
    path.join(templateDir, 'template.html'),
    '<!doctype html><html><head></head><body><p>Custom marker</p><main data-pfpdf-slot="content"></main></body></html>',
  );
  fs.writeFileSync(path.join(templateDir, 'style.css'), '');
  fs.writeFileSync(path.join(templateDir, 'vivliostyle.css'), '');

  const result = await buildHtml(
    config(['--input', input, '--output', 'x.pdf', '--template-dir', templateDir]),
    env,
    log,
  );
  assert.match(result.html, /Custom marker/);
  assert.doesNotMatch(result.html, /pfn-cover/);
});
