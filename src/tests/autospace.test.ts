import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildHtml } from '../build.js';
import { resolveConfig } from '../config.js';
import { BUNDLED_TEMPLATE_NAMES } from '../bundled-templates.js';
import { AssetServer } from '../assetserver.js';
import { renderLocal } from '../renderer.js';
import { openTestBrowser, pdfLineWidths } from './browser.js';

const log = { warn: (): void => {}, info: (): void => {}, debug: (): void => {} };
const env = { SOURCE_DATE_EPOCH: '0' };
const sample = '和文QWERTY123和文';
const source = [
  '---', 'title: Japanese spacing', 'lang: ja', '---', '',
  `<p id="auto" style="text-align:start"><span>${sample}</span></p>`, '',
  `<p id="none" style="text-align:start;text-autospace:no-autospace"><span>${sample}</span></p>`, '',
  '<p id="explicit">和文 QWERTY123 和文</p>', '',
  '<p id="explicit-none" style="text-autospace:no-autospace">和文 QWERTY123 和文</p>', '',
  `<p id="english" lang="en">${sample}</p>`, '',
  `<p id="english-none" lang="en" style="text-autospace:no-autospace">${sample}</p>`, '',
  `<p lang="en"><span id="nested-ja" lang="ja">${sample}</span></p>`, '',
  `<p lang="en"><span id="nested-ja-none" lang="ja" style="text-autospace:no-autospace">${sample}</span></p>`, '',
  '<p id="punctuation">和文、。「続き」</p>', '',
  '<p id="punctuation-none" style="text-autospace:no-autospace">和文、。「続き」</p>', '',
  '<p id="linked">和文<a href="https://example.test/和文">English</a>和文</p>', '',
  '<p id="linked-none" style="text-autospace:no-autospace">和文<a href="https://example.test/和文">English</a>和文</p>', '',
  '<p><code id="code">和文English123和文</code><kbd id="kbd">和文English</kbd><samp id="samp">和文123</samp></p>', '',
  '和文$x$和文', '',
].join('\n');

test('bundled CSS defines a Japanese-only, overridable autospace policy without editing text', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-autospace-html-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(input, source);
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    const built = await buildHtml(resolveConfig(['--input', input, '--output', path.join(dir, 'out.pdf'), '--template', template, '--no-toc'], dir), env, log);
    assert.equal(built.generated.get('document.html')!.toString(), built.html);
    assert.ok(built.html.includes(sample));
    assert.match(built.generated.get('generated/style.css')!.toString(), /text-autospace:\s*normal/);
  }
});

test('Japanese autospace changes HTML and final PDF geometry across all seven templates', { skip: process.env.RUN_E2E !== '1' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-autospace-pdf-'));
  const qa = process.env.PFPDF_QA_DIR;
  if (qa) fs.mkdirSync(qa, { recursive: true });
  let browser: Awaited<ReturnType<typeof openTestBrowser>> | undefined;
  t.after(async () => { await browser?.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const pdfTextHelp = spawnSync('pdftotext', ['-h'], { encoding: 'utf8' });
  const hasPdfText = pdfTextHelp.error === undefined;
  // Xpdf and Poppler share this executable name, but only Poppler advertises
  // bbox-layout. Keep portable PDF text checks when that optional mode is absent.
  const hasBboxLayout = hasPdfText && /^\s*-bbox-layout(?:\s|$)/m.test(pdfTextHelp.stdout + '\n' + pdfTextHelp.stderr);
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    await t.test(template, async () => {
      const input = path.join(dir, 'doc.md');
      const output = path.join(dir, `${template}.pdf`);
      fs.writeFileSync(input, source);
      const built = await buildHtml(resolveConfig(['--input', input, '--output', output, '--template', template, '--no-toc'], dir), env, log);
      const server = new AssetServer(built.manifest, built.generated);
      await server.start();
      try {
        await renderLocal({ documentUrl: server.documentUrl, outputPath: output, deadline: Date.now() + 120000,
          browserPath: process.env.BROWSER_PATH ?? null, logLevel: 'error', diagnosticsPath: path.join(dir, 'renderer.log'),
          processCwd: dir, warn: log.warn, info: log.info });
        await server.waitUntilReady(Date.now() + 10000);
        assert.equal(fs.readFileSync(output).subarray(0, 5).toString(), '%PDF-');
        if (qa) fs.copyFileSync(output, path.join(qa, `${template}.pdf`));
        browser ??= await openTestBrowser();
        const page = await browser.newPage();
        try {
          await page.goto(server.documentUrl, { waitUntil: 'networkidle0' });
          await page.evaluate(() => document.fonts.ready);
          const layout = await page.evaluate(() => {
            const measure = (id: string): number => {
              const node = document.getElementById(id)!;
              const range = document.createRange(); range.selectNodeContents(node);
              return range.getBoundingClientRect().width;
            };
            const policy = (id: string): string => getComputedStyle(document.getElementById(id)!).getPropertyValue('text-autospace');
            const auto = document.getElementById('auto')!;
            const selection = window.getSelection()!; selection.selectAllChildren(auto);
            return {
              width: Object.fromEntries(['auto', 'none', 'english', 'english-none', 'nested-ja', 'nested-ja-none', 'explicit', 'explicit-none', 'punctuation', 'punctuation-none', 'linked', 'linked-none'].map(id => [id, measure(id)])),
              policy: Object.fromEntries(['auto', 'english', 'nested-ja', 'code', 'kbd', 'samp'].map(id => [id, policy(id)])),
              text: auto.textContent, copied: selection.toString(),
              href: document.querySelector('#linked a')!.getAttribute('href'),
              math: getComputedStyle(document.querySelector('.pfpdf-math-inline')!).getPropertyValue('text-autospace'),
            };
          });
          assert.ok(layout.width.auto! > layout.width.none! + 0.5, JSON.stringify(layout));
          // Language can change localized serif glyph metrics; compare controls
          // with the same language so the measurement isolates spacing.
          assert.ok(Math.abs(layout.width.english! - layout.width['english-none']!) < 0.5);
          assert.ok(layout.width['nested-ja']! > layout.width['nested-ja-none']! + 0.5);
          assert.ok(Math.abs(layout.width.explicit! - layout.width['explicit-none']!) < 0.5);
          assert.ok(Math.abs(layout.width.punctuation! - layout.width['punctuation-none']!) < 0.5);
          assert.ok(layout.width.linked! > layout.width['linked-none']! + 0.5);
          assert.equal(layout.text, sample); assert.equal(layout.copied, sample);
          assert.equal(layout.href, 'https://example.test/和文');
          assert.match(layout.policy.auto!, /normal/);
          assert.match(layout.policy['nested-ja']!, /normal/);
          for (const id of ['english', 'code', 'kbd', 'samp']) assert.equal(layout.policy[id], 'no-autospace');
          assert.equal(layout.math, 'no-autospace');
        } finally { await page.close(); }
        if (hasPdfText) {
          const extracted = spawnSync('pdftotext', [output, '-'], { encoding: 'utf8' });
          assert.equal(extracted.status, 0, extracted.stderr);
          assert.match(extracted.stdout, /QWERTY123/);
        }
        if (hasBboxLayout) {
          const bbox = spawnSync('pdftotext', ['-bbox-layout', output, '-'], { encoding: 'utf8' });
          assert.equal(bbox.status, 0, bbox.stderr);
          const widths = pdfLineWidths(bbox.stdout, 'QWERTY123');
          assert.ok(widths.length >= 2, bbox.stdout);
          assert.ok(widths[0]! > widths[1]! + 0.3, `PDF autospace did not increase text width: ${JSON.stringify(widths)}`);
        }
      } finally { await server.stop(); }
    });
  }
});
