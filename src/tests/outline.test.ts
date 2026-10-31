import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { BUNDLED_TEMPLATE_NAMES } from '../bundled-templates.js';
import { buildHtml } from '../build.js';
import { resolveConfig } from '../config.js';

const log = { warn: (): void => {}, info: (): void => {}, debug: (): void => {} };
const env = { SOURCE_DATE_EPOCH: '0' };

// F skips h2 and h3, so it becomes a child of the nearest shallower heading E.
const source = '---\ntitle: T\nlang: ja\n---\n\n# A\n\n## B\n\n### C\n\n## D\n\n# E\n\n#### F\n';
const outline = '<nav class="pfpdf-outline" epub:type="toc" hidden><ol>' +
  '<li><a href="#a">A</a><ol>' +
  '<li><a href="#b">B</a><ol><li><a href="#c">C</a></li></ol></li>' +
  '<li><a href="#d">D</a></li></ol></li>' +
  '<li><a href="#e">E</a><ol><li><a href="#f">F</a></li></ol></li>' +
  '</ol></nav>';

test('PDF outline nests headings by level in every bundled template, with or without the visible toc', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-outline-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(input, source);
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    for (const toc of ['--toc', '--no-toc']) {
      const args = ['--input', input, '--output', path.join(dir, 'out.pdf'), '--template', template, toc];
      const { html } = await buildHtml(resolveConfig(args, dir), env, log);
      assert.ok(html.includes(outline), `${template} ${toc}`);
      // The outline follows the sections, and the visible toc keeps its flat, depth-classed list.
      assert.ok(html.indexOf(outline) > html.indexOf('id="f"'), `${template} ${toc}`);
      if (toc === '--toc') assert.match(html, /<li class="pfpdf-toc-depth-2"><a href="#b">/, template);
    }
  }
});

test('documents without headings get no outline', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-outline-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(input, '---\ntitle: T\n---\n\nbody\n');
  const { html } = await buildHtml(resolveConfig(['--input', input, '--output', path.join(dir, 'out.pdf')], dir), env, log);
  assert.doesNotMatch(html, /pfpdf-outline/);
});

test('PDF bookmarks remain nested and unprinted when custom template CSS displays nav elements', {
  skip: process.env.RUN_E2E !== '1',
}, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-outline-pdf-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const input = path.join(dir, 'doc.md');
  const output = path.join(dir, 'doc.pdf');
  fs.writeFileSync(input, '---\ntitle: Outline test\n---\n\n# OutlineRoot\n\n## OutlineChild\n\n#### OutlineSkipped\n\n# OutlineLast\n');
  fs.writeFileSync(path.join(dir, 'template.html'), '<!doctype html><html><head></head><body><main data-pfpdf-slot="content"></main></body></html>');
  fs.writeFileSync(path.join(dir, 'style.css'), 'nav { display: block; }');
  fs.writeFileSync(path.join(dir, 'vivliostyle.css'), '@page { margin: 20mm; }');
  const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'launcher.js');
  const args = [cli, '--input', input, '--output', output, '--template', dir, '--no-toc'];
  if (process.env.BROWSER_PATH) args.push('--browser-path', process.env.BROWSER_PATH);
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '0' }, timeout: 330000,
  });
  assert.equal(result.status, 0, result.stderr);

  const pdf = await PDFDocument.load(fs.readFileSync(output));
  const bookmarks: Array<[number, string]> = [];
  const walk = (parent: PDFDict, depth: number): void => {
    let node = parent.lookup(PDFName.of('First'));
    while (node instanceof PDFDict) {
      const title = node.lookup(PDFName.of('Title'));
      assert.ok(title instanceof PDFHexString || title instanceof PDFString);
      bookmarks.push([depth, title.decodeText()]);
      walk(node, depth + 1);
      node = node.lookup(PDFName.of('Next'));
    }
  };
  walk(pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict), 1);
  assert.deepEqual(bookmarks, [[1, 'OutlineRoot'], [2, 'OutlineChild'], [3, 'OutlineSkipped'], [1, 'OutlineLast']]);

  const extracted = spawnSync('pdftotext', [output, '-'], { encoding: 'utf8' });
  const textToolMissing = Boolean(extracted.error && 'code' in extracted.error && extracted.error.code === 'ENOENT');
  await t.test('outline labels are printed only in the document body', {
    skip: textToolMissing ? 'pdftotext is unavailable' : false,
  }, () => {
    assert.equal(extracted.status, 0, extracted.stderr);
    for (const [, title] of bookmarks) {
      assert.equal(extracted.stdout.split(title).length - 1, 1, `${title} must appear only in the document body`);
    }
  });
});
