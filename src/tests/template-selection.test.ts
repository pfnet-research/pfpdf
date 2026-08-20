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

function config(args: string[]): ReturnType<typeof resolveConfig> {
  return resolveConfig(args, process.cwd());
}

test('front matter selects a bundled template and CLI overrides it', async () => {
  const input = makeDoc('---\ntitle: T\ntemplate: pfn\n---\nbody\n');

  const fromDocument = await buildHtml(
    config(['--input', input, '--output', 'x.pdf']),
    env,
    log,
  );
  assert.match(fromDocument.html, /pfn-cover/);

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

test('--template with a path overrides a front matter bundled template', async () => {
  const input = makeDoc('---\ntitle: T\ntemplate: pfn\n---\nbody\n');
  const templateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-template-selection-custom-'));
  fs.writeFileSync(
    path.join(templateDir, 'template.html'),
    '<!doctype html><html><head></head><body><p>Custom marker</p><main data-pfpdf-slot="content"></main></body></html>',
  );
  fs.writeFileSync(path.join(templateDir, 'style.css'), '');
  fs.writeFileSync(path.join(templateDir, 'vivliostyle.css'), '');

  const result = await buildHtml(
    config(['--input', input, '--output', 'x.pdf', '--template', templateDir]),
    env,
    log,
  );
  assert.match(result.html, /Custom marker/);
  assert.doesNotMatch(result.html, /pfn-cover/);
});

test('front matter toc and logo affect the rendered document and remain CLI-overridable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-document-config-'));
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(path.join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(input, [
    '---',
    'title: T',
    'template: pfn',
    'toc: false',
    'logo: logo.svg',
    '---',
    '# Heading',
  ].join('\n'));

  const fromDocument = await buildHtml(
    config(['--input', input, '--output', 'x.pdf']),
    env,
    log,
  );
  assert.match(fromDocument.html, /logo\.svg/);
  assert.doesNotMatch(fromDocument.html, /pfpdf-toc-list/);

  const overridden = await buildHtml(
    config(['--input', input, '--output', 'x.pdf', '--toc', '--no-logo']),
    env,
    log,
  );
  assert.doesNotMatch(overridden.html, /logo\.svg/);
  assert.match(overridden.html, /pfpdf-toc-list/);
});
