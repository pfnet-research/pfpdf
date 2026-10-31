/**
 * Mermaid page-fit regression through the real renderer. Like e2e.test.ts it
 * needs a browser, so it only runs when RUN_E2E=1 (see npm run test:e2e).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { figureBoxes, type Box } from './pdf-figures.js';

const enabled = process.env.RUN_E2E === '1';
const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'launcher.js');
const browserArgs = process.env.BROWSER_PATH ? ['--browser-path', process.env.BROWSER_PATH] : [];

// Page area of the default template on A4 (resources/templates/default/vivliostyle.css).
const mm = 72 / 25.4;
const area = { left: 18 * mm, top: 24 * mm, right: 595.28 - 18 * mm, bottom: 841.89 - 24 * mm };
const tolerance = 1;

const steps = Array.from({ length: 16 }, (_, i) => `  S${i} --> S${i + 1}`);
const filler = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} fills the upper part of the page before the next diagram.`);
const source = [
  '---', 'title: Mermaid page fit', 'toc: false', '---', '',
  // With no preceding heading, the first diagram keeps its top margin.
  '```mermaid', 'flowchart TD', ...steps, '```', '',
  '# Pushed diagram', '', ...filler.flatMap((line) => [line, '']),
  '```mermaid', 'flowchart TD', ...steps, '```', '',
  '# Small diagram', '', '```mermaid', 'flowchart LR', '  A[Input] --> B[Output]', '```', '',
].join('\n');

function assertInsideArea(box: Box, label: string): void {
  assert.ok(box.left >= area.left - tolerance && box.right <= area.right + tolerance, `${label} is wider than the page area`);
  assert.ok(box.top >= area.top - tolerance && box.bottom <= area.bottom + tolerance,
    `${label} spans ${box.top.toFixed(1)}-${box.bottom.toFixed(1)}pt, outside the page area ` +
    `${area.top.toFixed(1)}-${area.bottom.toFixed(1)}pt`);
}

test('tall Mermaid diagrams fit one page area, and diagrams that fit keep their size', { skip: !enabled }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-e2e-mermaid-fit-'));
  const input = path.join(dir, 'doc.md');
  const output = path.join(dir, 'doc.pdf');
  fs.writeFileSync(input, source);
  const render = spawnSync(
    process.execPath,
    [cliPath, ...browserArgs, '--input', input, '--output', output, '--render-timeout-ms', '600000'],
    { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1750000000' }, timeout: 660000 },
  );
  try {
    assert.equal(render.status, 0, render.stderr);
    const pages = await figureBoxes(fs.readFileSync(output));
    const figures = pages.flatMap((box, index) => (box === null ? [] : [{ box, page: index + 1 }]));
    assert.equal(figures.length, 3, `expected one figure on each of three pages: ${JSON.stringify(pages)}`);
    const [tall, pushed, small] = figures as [typeof figures[0], typeof figures[0], typeof figures[0]];

    // The unscaled diagram is several page areas tall; it is scaled to one.
    assertInsideArea(tall.box, 'tall diagram');
    assert.ok(tall.box.bottom - tall.box.top > (area.bottom - area.top) * 0.8, 'tall diagram should use most of the page area');

    // The filler leaves too little room, so the diagram moves to a later page and still fits.
    assert.ok(pushed.page > tall.page + 1, 'diagram after the filler should start on a new page');
    assertInsideArea(pushed.box, 'pushed diagram');

    // A diagram that already fits keeps the body-width sizing it had before
    // the height limit: Mermaid SVGs are fitted to the body width.
    assertInsideArea(small.box, 'small diagram');
    const smallWidth = small.box.right - small.box.left;
    assert.ok(smallWidth > (area.right - area.left) * 0.85,
      `small diagram is ${smallWidth.toFixed(1)}pt wide; it should still fill the body width`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
