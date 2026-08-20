import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHtml } from '../build.js';
import { resolveConfig } from '../config.js';

const env = { SOURCE_DATE_EPOCH: '1750000000' };
const log = { warn: (): void => {}, info: (): void => {}, debug: (): void => {} };

test('custom template logo src is the default and can be overridden or disabled', async () => {
  const inputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-default-logo-input-'));
  const input = path.join(inputDir, 'document.md');
  fs.writeFileSync(input, '---\ntitle: T\n---\nbody\n');
  const tplDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-default-logo-template-'));
  fs.mkdirSync(path.join(tplDir, 'assets', 'brand'), { recursive: true });
  fs.writeFileSync(path.join(tplDir, 'assets', 'brand', 'default.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(
    path.join(tplDir, 'template.html'),
    '<!doctype html><html><head></head><body><img class="brand" data-pfpdf-slot="logo" src="assets/brand/default.svg"><main data-pfpdf-slot="content"></main></body></html>',
  );
  fs.writeFileSync(path.join(tplDir, 'style.css'), '');
  fs.writeFileSync(path.join(tplDir, 'vivliostyle.css'), '');
  const base = ['--input', input, '--output', 'x.pdf', '--template', tplDir];

  const automatic = await buildHtml(resolveConfig(base, process.cwd()), env, log);
  assert.match(automatic.html, /default\.svg/);
  assert.match(automatic.html, /alt=""/);

  const disabled = await buildHtml(
    resolveConfig([...base, '--no-logo'], process.cwd()),
    env,
    log,
  );
  assert.doesNotMatch(disabled.html, /class="brand"/);

  const override = path.join(tplDir, 'override.png');
  fs.writeFileSync(override, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const overridden = await buildHtml(
    resolveConfig([...base, '--logo', override], process.cwd()),
    env,
    log,
  );
  assert.match(overridden.html, /override\.png/);
  assert.doesNotMatch(overridden.html, /default\.svg/);
});
