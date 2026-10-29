/** Browser/PDF regression matrix; uses the exact document graph passed to Vivliostyle. */
import test from 'node:test';
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

test('GFM table alignment survives bundled template CSS in LTR/RTL HTML and PDFs', { skip: !enabled }, async (t) => {
  // Resolve automation from the pinned renderer, without another browser dependency.
  const require = createRequire(resolveVivliostyleCli());
  const puppeteer = require('puppeteer-core') as typeof Puppeteer;
  let browser: Puppeteer.Browser | undefined;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-e2e-table-alignment-'));
  t.after(async () => {
    await browser?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  for (const template of BUNDLED_TEMPLATE_NAMES) {
    for (const direction of ['ltr', 'rtl'] as const) {
      await t.test(`${template}: ${direction}`, async () => {
        const input = path.join(dir, `${template}-${direction}.md`);
        const output = path.join(dir, `${template}-${direction}.pdf`);
        const longText = 'Long wrapping text in this table cell must keep its column alignment. '.repeat(3);
        fs.writeFileSync(input, [
          '---', 'title: Table alignment', 'lang: en', `dir: ${direction}`, '---', '',
          '<style>table { table-layout: fixed; }</style>', '',
          '| HLFT | HCEN | HRGT | HDEF |', '| :--- | :---: | ---: | --- |',
          '| BLFT | BCEN | BRGT | BDEF |',
          `| ${longText} | ${longText} | ${longText} | ${longText} |`, '',
        ].join('\n'));
        const config = resolveConfig(['--input', input, '--output', output, '--template', template, '--no-toc'], dir);
        const built = await buildHtml(config, { SOURCE_DATE_EPOCH: '0' }, log);
        assert.equal(built.generated.get('document.html')?.toString('utf8'), built.html);
        const server = new AssetServer(built.manifest, built.generated);
        await server.start();
        try {
          await renderLocal({
            documentUrl: server.documentUrl, outputPath: output, deadline: Date.now() + 120_000,
            browserPath: process.env.BROWSER_PATH ?? null, logLevel: 'error',
            diagnosticsPath: path.join(dir, `${template}-${direction}.log`),
            processCwd: dir, warn: log.warn, info: log.info,
          });
          await server.waitUntilReady(Date.now() + 10_000);
          assert.equal(fs.readFileSync(output).subarray(0, 5).toString('latin1'), '%PDF-');
          const extracted = spawnSync('pdftotext', [output, '-'], { encoding: 'utf8' });
          if (extracted.error === undefined) {
            assert.equal(extracted.status, 0, extracted.stderr);
            for (const marker of ['HLFT', 'HCEN', 'HRGT', 'HDEF', 'BLFT', 'BCEN', 'BRGT', 'BDEF']) {
              assert.ok(extracted.stdout.includes(marker), `PDF missing ${marker}`);
            }
            assert.match(extracted.stdout, /wrapping/);
          }

          browser ??= await puppeteer.launch({ executablePath: await installedBrowserPath(), headless: true });
          const page = await browser.newPage();
          try {
            await page.goto(server.documentUrl, { waitUntil: 'networkidle0' });
            await page.evaluate(() => document.fonts.ready);
            const rows = await page.evaluate(() => Array.from(document.querySelectorAll('tr'), (row) =>
              Array.from(row.querySelectorAll('th,td'), (cell) => {
                const style = getComputedStyle(cell);
                const box = cell.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(cell);
                const text = range.getBoundingClientRect();
                return {
                  align: style.textAlign, direction: style.direction,
                  left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
                  right: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
                  textLeft: text.left, textRight: text.right,
                  textHeight: text.height, lineHeight: parseFloat(style.lineHeight),
                };
              })));
            assert.equal(rows.length, 3);
            for (const row of rows) {
              assert.deepEqual(row.map((cell) => cell.align), ['left', 'center', 'right', 'start']);
              assert.ok(row.every((cell) => cell.direction === direction));
            }
            for (const row of rows.slice(0, 2)) {
              for (const [index, cell] of row.entries()) {
                const alignment = index === 3 ? (direction === 'ltr' ? 'left' : 'right') : cell.align;
                const error = alignment === 'left' ? cell.textLeft - cell.left
                  : alignment === 'right' ? cell.textRight - cell.right
                    : (cell.textLeft + cell.textRight - cell.left - cell.right) / 2;
                assert.ok(Math.abs(error) < 1, `${template}/${direction} cell ${index}: ${error}px from ${alignment}`);
              }
            }
            assert.ok(rows[2]!.every((cell) => cell.textHeight > cell.lineHeight * 2), 'long cells must wrap');
          } finally {
            await page.close();
          }
        } finally {
          await server.stop();
        }
      });
    }
  }
});
