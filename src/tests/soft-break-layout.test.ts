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
import { openTestBrowser } from './browser.js';

const log = { warn: (): void => {}, info: (): void => {}, debug: (): void => {} };
test('Japanese soft wrapping matches continuous prose in renderer layout and all template PDFs', { skip: process.env.RUN_E2E !== '1' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-soft-break-layout-'));
  const qa = process.env.PFPDF_QA_DIR;
  if (qa) fs.mkdirSync(qa, { recursive: true });
  let browser: Awaited<ReturnType<typeof openTestBrowser>> | undefined;
  t.after(async () => { await browser?.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    await t.test(template, async () => {
      const input = path.join(dir, 'doc.md');
      const output = path.join(dir, `${template}.pdf`);
      fs.writeFileSync(input, '---\ntitle: Soft break layout\nlang: ja\n---\n日本語\n日本語\n\n日本語日本語\n\n日本語 日本語\n');
      const built = await buildHtml(resolveConfig(['--input', input, '--output', output, '--template', template, '--no-toc'], dir), { SOURCE_DATE_EPOCH: '0' }, log);
      assert.equal(built.generated.get('document.html')!.toString(), built.html);
      const server = new AssetServer(built.manifest, built.generated); await server.start();
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
          const paragraphs = await page.evaluate(() => Array.from(document.querySelectorAll('.pfpdf-source-file p'), p => {
            const range = document.createRange(); range.selectNodeContents(p);
            return { text: p.textContent, width: range.getBoundingClientRect().width };
          }));
          assert.deepEqual(paragraphs.map(p => p.text), ['日本語日本語', '日本語日本語', '日本語 日本語']);
          assert.ok(Math.abs(paragraphs[0]!.width - paragraphs[1]!.width) < 0.5);
          assert.ok(paragraphs[2]!.width > paragraphs[0]!.width + 0.5);
        } finally { await page.close(); }
        const text = spawnSync('pdftotext', [output, '-'], { encoding: 'utf8' });
        if (text.status === 0 && process.platform !== 'win32') assert.match(text.stdout, /日本語日本語/);
      } finally { await server.stop(); }
    });
  }
});
