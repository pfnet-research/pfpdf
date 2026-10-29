import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
