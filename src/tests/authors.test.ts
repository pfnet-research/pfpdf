/** Browser/PDF regression matrix; uses the exact document graph passed to Vivliostyle. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { getInstalledBrowsers } from '@puppeteer/browsers';
import type * as Puppeteer from 'puppeteer-core';
import { AssetServer } from '../assetserver.js';
import { buildHtml } from '../build.js';
import { BUNDLED_TEMPLATE_NAMES } from '../bundled-templates.js';
import { resolveConfig } from '../config.js';
import { renderLocal, resolveVivliostyleCli } from '../renderer.js';
import { commitOutput } from '../output.js';
import { PDFDocument } from 'pdf-lib';
import { resolveInput } from '../input.js';

const enabled = process.env.RUN_E2E === '1';
const log = { warn: (): void => {}, info: (): void => {}, debug: (): void => {} };

async function installedBrowserPath(): Promise<string> {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  if (process.platform === 'linux' && process.arch === 'arm64' && fs.existsSync('/usr/bin/chromium')) {
    return '/usr/bin/chromium';
  }
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches')
    : process.platform === 'win32' ? process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
      : process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
  for (const cacheDir of [path.join(base, 'vivliostyle', 'browsers'), '/opt/puppeteer']) {
    const candidates = await getInstalledBrowsers({ cacheDir });
    if (candidates[0]) return candidates[0].executablePath;
  }
  throw new Error('the renderer did not install a browser; set BROWSER_PATH for layout checks');
}

function authorDoc(t: TestContext, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-authors-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(input, content);
  return input;
}

test('every bundled template renders an ordered author byline with explicit line breaks', async (t) => {
  const input = authorDoc(t, '---\ntitle: Authors\nauthor:\n  - Alice & Bob\n  - 山田 太郎\n  - "Carol\\nExample Institute"\n  - "<br>literal"\n---\n# Body\n');
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    const { html, generated } = await buildHtml(resolveConfig(['--input', input, '--output', 'x.pdf', '--template', template], process.cwd()), { SOURCE_DATE_EPOCH: '0' }, log);
    assert.match(html, /class="[^"]*pfpdf-authors"/u, template);
    assert.match(html, /<span class="pfpdf-author">Alice &#x26; Bob<\/span>, <span class="pfpdf-author">山田 太郎<\/span>, <span class="pfpdf-author">Carol<br>Example Institute<\/span>, <span class="pfpdf-author">&#x3C;br>literal<\/span>/u, template);
    assert.match(generated.get('generated/style.css')!.toString(), /\.pfpdf-authors\s*\{[^}]*overflow-wrap:\s*anywhere/s, template);
  }
});

test('empty author metadata removes the author slot in all bundled templates', async (t) => {
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    const input = authorDoc(t, '---\ntitle: Authors\nauthor: []\n---\nbody\n');
    const { html } = await buildHtml(resolveConfig(['--input', input, '--output', 'x.pdf', '--template', template], process.cwd()), { SOURCE_DATE_EPOCH: '0' }, log);
    assert.doesNotMatch(html, /class="[^"]*pfpdf-authors"/, template);
    assert.doesNotMatch(html, /class="pfpdf-author"/, template);
  }
});

test('multiple-author bylines wrap within all bundled templates and survive PDF output', { skip: !enabled }, async (t) => {
  const require = createRequire(resolveVivliostyleCli());
  const puppeteer = require('puppeteer-core') as typeof Puppeteer;
  let browser: Puppeteer.Browser | undefined;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-e2e-authors-'));
  t.after(async () => {
    await browser?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const names = ['Alice Smith', '山田 太郎', 'Carol\nExample Institute', 'LongUnbrokenAuthorName'.repeat(6)];
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    await t.test(template, async () => {
      const input = path.join(dir, `${template}.md`);
      const rendered = path.join(dir, `${template}-rendered.pdf`);
      const output = path.join(dir, `${template}.pdf`);
      fs.writeFileSync(input, `---\ntitle: Multiple authors\nlang: en\nauthor: ${JSON.stringify(names)}\n---\n# Body\nAuthor layout regression.\n`);
      const config = resolveConfig(['--input', input, '--output', output, '--template', template, '--no-toc'], dir);
      const built = await buildHtml(config, { SOURCE_DATE_EPOCH: '0' }, log);
      assert.equal(built.generated.get('document.html')?.toString('utf8'), built.html);
      const server = new AssetServer(built.manifest, built.generated);
      await server.start();
      try {
        await renderLocal({
          documentUrl: server.documentUrl, outputPath: rendered, deadline: Date.now() + 120_000,
          browserPath: process.env.BROWSER_PATH ?? null, logLevel: 'error',
          diagnosticsPath: path.join(dir, `${template}.log`),
          processCwd: dir, warn: log.warn, info: log.info,
        });
        await server.waitUntilReady(Date.now() + 10_000);
        await commitOutput({
          rendererOutput: rendered, finalOutput: output, metadata: resolveInput(input, null, { SOURCE_DATE_EPOCH: '0' }, log.warn).metadata,
          sourceDateEpoch: 0, processStart: new Date(0), deadline: Date.now() + 10_000, warn: log.warn,
        });
        const pdf = await PDFDocument.load(fs.readFileSync(output), { updateMetadata: false });
        assert.equal(pdf.getAuthor(), names.map((name) => name.replace(/\s+/g, ' ')).join(', '));
        const extracted = spawnSync('pdftotext', [output, '-'], { encoding: 'utf8' });
        if (extracted.error === undefined) {
          assert.equal(extracted.status, 0, extracted.stderr);
          const compactText = extracted.stdout.replace(/\s+/g, '');
          for (const name of names) {
            if (process.platform !== 'win32' || /^[\x00-\x7F]*$/.test(name)) {
              // Parallel cover/date columns can interleave in PDF text extraction.
              assert.ok(name.split('\n').every((line) => compactText.includes(line.replace(/\s+/g, ''))), `PDF missing author text ${name}`);
            }
          }
        }
        browser ??= await puppeteer.launch({ executablePath: await installedBrowserPath(), headless: true });
        const page = await browser.newPage();
        try {
          await page.setViewport({ width: 816, height: 1056 });
          await page.goto(server.documentUrl, { waitUntil: 'networkidle0' });
          await page.evaluate(() => document.fonts.ready);
          const layout = await page.evaluate(() => {
            const byline = document.querySelector('.pfpdf-authors')!;
            const box = byline.getBoundingClientRect();
            const spans = Array.from(byline.querySelectorAll('.pfpdf-author'));
            const rects = spans.flatMap((span) => {
              const range = document.createRange();
              range.selectNodeContents(span);
              return Array.from(range.getClientRects(), (rect) => ({ left: rect.left, right: rect.right }));
            });
            const longNameRange = document.createRange();
            longNameRange.selectNodeContents(spans[3]!);
            return {
              names: spans.map((span) => span.textContent),
              breaks: byline.querySelectorAll('br').length,
              left: box.left, right: box.right,
              align: getComputedStyle(byline).textAlign,
              rects,
              longNameLines: longNameRange.getClientRects().length,
            };
          });
          assert.deepEqual(layout.names, names.map((name) => name.replace(/\n/g, '')));
          assert.equal(layout.breaks, 1, 'only the intentional newline creates a break');
          assert.notEqual(layout.align, 'justify', 'bylines must not stretch author names across a line');
          assert.ok(layout.longNameLines > 1, 'long unbroken names must wrap');
          for (const rect of layout.rects) {
            assert.ok(rect.left >= layout.left - 1 && rect.right <= layout.right + 1, `${template}: author text overflows the byline`);
          }
        } finally {
          await page.close();
        }
      } finally {
        await server.stop();
      }
    });
  }
});
