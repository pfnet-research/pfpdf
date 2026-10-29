import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { BUNDLED_TEMPLATE_NAMES } from '../bundled-templates.js';
import { buildHtml } from '../build.js';
import { resolveConfig } from '../config.js';
import { footnotePdfPages } from './footnote-pdf.js';

const log = { warn: (): void => {}, info: (): void => {}, debug: (): void => {} };
const env = { SOURCE_DATE_EPOCH: '0' };
const content = (lang: string, japanese: boolean): string =>
  `---\ntitle: Note labels\n${lang ? `lang: ${lang}\n` : ''}---\n` +
  `# Chapter\n\n${japanese ? 'これは本文です。' : 'English body.'}[^note] Repeat[^note].\n\n[^note]: NOTEBODY text stays unchanged.\n`;

test('renderer HTML localizes footnote labels across all bundled templates without changing note structure', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-footnote-language-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const input = path.join(dir, 'doc.md');
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    let baseline: string[] | undefined;
    for (const [lang, japanese] of [['ja', true], ['ja-JP', true], ['en-US', false], ['fr', false], ['', true], ['', false]] as const) {
      fs.writeFileSync(input, content(lang, japanese));
      const result = await buildHtml(resolveConfig(['--input', input, '--output', path.join(dir, 'out.pdf'), '--template', template], dir), env, log);
      assert.equal(result.generated.get('document.html')!.toString(), result.html);
      const dom = new JSDOM(result.generated.get('document.html')!.toString()) as unknown as { window: { document: Document; close: () => void } };
      const doc = dom.window.document;
      assert.equal(doc.querySelector('#footnote-label'), null);
      assert.equal(doc.querySelector('[data-footnotes]'), null);
      const references = Array.from(doc.querySelectorAll('[role="doc-noteref"]'));
      assert.deepEqual(references.map((el) => el.getAttribute('aria-label')), japanese
        ? ['脚注 1', '脚注 1'] : ['Footnote 1', 'Footnote 1']);
      const backrefs = Array.from(doc.querySelectorAll('[data-footnote-backref]'));
      assert.deepEqual(backrefs.map((el) => el.getAttribute('aria-label')), japanese
        ? ['参照 1 に戻る', '参照 1（2 回目） に戻る']
        : ['Back to reference 1', 'Back to reference 1-2']);
      const note = doc.querySelector('aside[role="doc-footnote"]')!;
      assert.equal(note.getAttribute('aria-label'), japanese ? '脚注 1' : 'Footnote 1');
      assert.match(note.textContent, /NOTEBODY text stays unchanged\./);
      const links = Array.from(doc.querySelectorAll('[data-footnote-ref], [data-footnote-backref]')).map((el) => el.getAttribute('href')!);
      baseline ??= links;
      assert.deepEqual(links, baseline);
      for (const href of links) assert.ok(doc.getElementById(href.slice(1)), `${template}: ${href}`);
      assert.equal(doc.querySelectorAll('.pfpdf-toc-list a').length, 1);
      assert.equal(doc.querySelector('.pfpdf-toc-list')!.textContent, 'Chapter');
      dom.window.close();
    }
  }
});

test('PDF page footnotes follow inferred Japanese and English across templates', { skip: process.env.RUN_E2E !== '1' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-footnote-language-pdf-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const cli = fileURLToPath(new URL('../launcher.js', import.meta.url));
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    for (const japanese of [true, false]) {
      const input = path.join(dir, 'doc.md');
      const output = path.join(dir, `${template}-${japanese ? 'ja' : 'en'}.pdf`);
      fs.writeFileSync(input, content('', japanese));
      const browser = process.env.BROWSER_PATH ? ['--browser-path', process.env.BROWSER_PATH] : [];
      const result = spawnSync(process.execPath, [cli, '--input', input, '--output', output, '--template', template, ...browser], {
        encoding: 'utf8', env: { ...process.env, ...env }, timeout: 330000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readFileSync(output).subarray(0, 5).toString(), '%PDF-');
      const pages = await footnotePdfPages(input, output, template, true);
      const referencePage = pages.find((page) => page.words.some((word) => word.text === 'Repeat'));
      assert.ok(referencePage, `${template}: reference text is missing`);
      const note = referencePage.words.find((word) => word.text === 'NOTEBODY');
      assert.ok(note, `${template}: note is missing on its reference page`);
      assert.ok(note.y > referencePage.height * 0.7, `${template}: note is not at the page bottom`);
      for (const text of ['text', 'stays', 'unchanged.']) assert.ok(referencePage.words.some((word) => word.text === text));
    }
  }
});
