/** PDF coordinates when supported, with pinned renderer layout for Xpdf. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import type { CoreViewer } from '@vivliostyle/core';
import { buildHtml } from '../build.js';
import { resolveConfig } from '../config.js';
import { AssetServer } from '../assetserver.js';
import { openTestBrowser } from './browser.js';

export interface FootnoteWord { text: string; y: number }
export interface FootnotePage { height: number; words: FootnoteWord[] }

const help = spawnSync('pdftotext', ['-h'], { encoding: 'utf8' });
const hasTextTool = help.error === undefined;
const hasBbox = /(?:^|\s)-bbox(?:\s|$)/.test(help.stdout + help.stderr);
const log = { warn: (): void => {}, info: (): void => {}, debug: (): void => {} };

interface ViewerWindow extends Window {
  module: { exports: { CoreViewer: typeof CoreViewer } };
  footnoteViewer: CoreViewer;
}

async function viewerPages(input: string, template: string, toc: boolean): Promise<FootnotePage[]> {
  const built = await buildHtml(resolveConfig(['--input', input, '--output', path.join(path.dirname(input), 'viewer.pdf'),
    '--template', template, ...(toc ? [] : ['--no-toc'])], path.dirname(input)), { SOURCE_DATE_EPOCH: '0' }, log);
  built.generated.set('generated/footnote-viewer.html', Buffer.from('<!doctype html><html><body><div id="viewport"></div></body></html>'));
  const server = new AssetServer(built.manifest, built.generated);
  await server.start();
  const browser = await openTestBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(new URL('generated/footnote-viewer.html', server.documentUrl).href);
    const require = createRequire(import.meta.url);
    await page.addScriptTag({ content: 'var module={exports:{}};' + fs.readFileSync(require.resolve('@vivliostyle/core'), 'utf8') });
    await page.evaluate((url) => {
      const target = window as unknown as ViewerWindow;
      target.footnoteViewer = new target.module.exports.CoreViewer({ viewportElement: document.getElementById('viewport')! },
        { renderAllPages: true, autoResize: false, fitToScreen: false, zoom: 1 });
      target.footnoteViewer.loadDocument(url);
    }, server.documentUrl);
    await page.waitForFunction(() => (window as unknown as ViewerWindow).footnoteViewer.readyState === 'complete', { timeout: 120000 });
    // Core keeps non-current pages display:none in screen view. Reveal the
    // completed layout without changing page dimensions, zoom, or pagination.
    await page.addStyleTag({ content: '[data-vivliostyle-page-container]{display:block!important}' });
    return await page.evaluate(() => Array.from(document.querySelectorAll('[data-vivliostyle-page-container]'), (container) => {
      const bounds = container.getBoundingClientRect();
      const words: FootnoteWord[] = [];
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of node.textContent!.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
          words.push({ text: match[0], y: range.getBoundingClientRect().top - bounds.top });
        }
      }
      return { height: bounds.height, words };
    }));
  } finally {
    await browser.close();
    await server.stop();
  }
}

export async function footnotePdfPages(input: string, output: string, template: string, toc = false): Promise<FootnotePage[]> {
  if (hasBbox) {
    const extracted = spawnSync('pdftotext', ['-bbox', output, '-'], { encoding: 'utf8' });
    assert.equal(extracted.status, 0, extracted.stderr);
    return Array.from(extracted.stdout.matchAll(/<page width="[^"]+" height="([^"]+)">([\s\S]*?)<\/page>/g), (page) => ({
      height: Number(page[1]),
      words: Array.from(page[2]!.matchAll(/<word xMin="[^"]+" yMin="([^"]+)"[^>]*>([^<]*)<\/word>/g), (word) => ({ y: Number(word[1]), text: word[2]! })),
    }));
  }
  const pages = await viewerPages(input, template, toc);
  assert.ok(pages.length > 0 && pages.every((page) => page.height > 0), 'renderer pages must have physical dimensions');
  if (hasTextTool) {
    const extracted = spawnSync('pdftotext', [output, '-'], { encoding: 'utf8' });
    assert.equal(extracted.status, 0, extracted.stderr);
    // Xpdf has no coordinates. Still require final-PDF text on the same page
    // as each first reference, and all overflow/content markers to survive.
    const pdfPages = extracted.stdout.split('\f');
    for (const [index, page] of pages.entries()) {
      for (const word of page.words.filter((candidate) => /^(?:FIRSTREF|LATERREF|NOTEONE|NOTETWO|LONGSTART|LONGEND|CODEMARK|NOTEBODY)$/.test(candidate.text))) {
        assert.ok(pdfPages[index]?.includes(word.text), `PDF page ${index + 1} is missing ${word.text}`);
      }
    }
  }
  return pages;
}
