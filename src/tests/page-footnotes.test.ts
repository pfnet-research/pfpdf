import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { toHtml } from 'hast-util-to-html';
import { effectiveConfigJson, resolveConfig } from '../config.js';
import { readFrontMatterConfig, resolveInput, type SourceFile } from '../input.js';
import { buildDocumentBody } from '../markdown.js';
import { buildHtml } from '../build.js';
import { BUNDLED_TEMPLATE_NAMES } from '../bundled-templates.js';
import { ResourceManifest } from '../resources.js';
import { InputError } from '../errors.js';
import { footnotePdfPages } from './footnote-pdf.js';

const env = { SOURCE_DATE_EPOCH: '0' };
const log = { warn: (): void => {}, info: (): void => {}, debug: (): void => {} };
const enabled = process.env.RUN_E2E === '1';
const cli = fileURLToPath(new URL('../launcher.js', import.meta.url));
const browser = process.env.BROWSER_PATH ? ['--browser-path', process.env.BROWSER_PATH] : [];

function fixture(t: test.TestContext): { dir: string; input: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-page-footnotes-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, input: path.join(dir, 'doc.md') };
}

function dom(html: string): { window: { document: Document; close: () => void } } {
  return new JSDOM(html) as unknown as { window: { document: Document; close: () => void } };
}

function source(content: string, name: string): SourceFile {
  return { path: `/virtual/${name}`, name, content, lineOffset: 0 };
}

test('page footnotes have no mode option and unknown front matter follows normal validation', (t) => {
  const { dir, input } = fixture(t);
  const config = resolveConfig(['--input', input, '--output', path.join(dir, 'out.pdf')], dir);
  const effective = JSON.parse(effectiveConfigJson(config)) as { config: Record<string, unknown> };
  assert.equal(Object.hasOwn(effective.config, 'footnotes'), false);
  for (const value of ['page', 'endnotes']) {
    assert.throws(() => resolveConfig(['--doctor', '--footnotes', value], dir), /unknown option: --footnotes/);
    fs.writeFileSync(input, `---\ntitle: Notes\nfootnotes: ${value}\n---\nText[^n].\n\n[^n]: Note.\n`);
    const warnings: string[] = [];
    const settings = readFrontMatterConfig(input, (message) => { warnings.push(message); });
    assert.equal(Object.hasOwn(settings, 'footnotes'), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /footnotes/);
    assert.equal(Object.hasOwn(resolveInput(input, null, env, log.warn).config, 'footnotes'), false);
    assert.throws(() => readFrontMatterConfig(input, log.warn, { strictFrontMatter: true }), InputError);
  }
});

test('page footnotes use document-wide numbers, unique IDs, localized labels and all backlinks', async () => {
  const markdown = '# Heading\n\nFirst[^same]. Again[^same].\n\n[^same]: Note with **emphasis** and a [link](https://example.com).\n\n    Second paragraph.\n\n    ```text\n    note code\n    ```\n';
  const body = await buildDocumentBody([
    source('<div id="pfpdf-footnote-1"></div>\n\n' + markdown, 'a.md'),
    source(markdown, 'b.md'),
  ], new ResourceManifest(), [], { warn: log.warn, lang: 'ja-JP' });
  const parsed = dom(body.sections.map((section) => toHtml(section as never)).join(''));
  const doc = parsed.window.document;
  assert.equal(doc.querySelector('[data-footnotes]'), null);
  assert.equal(doc.querySelector('#footnote-label'), null);
  assert.equal(doc.querySelectorAll('h2').length, 0);
  const references = Array.from(doc.querySelectorAll('[data-footnote-ref]'));
  assert.deepEqual(references.map((reference) => reference.textContent), ['1', '1', '2', '2']);
  assert.deepEqual(references.map((reference) => reference.getAttribute('aria-label')), ['脚注 1', '脚注 1', '脚注 2', '脚注 2']);
  assert.ok(references.every((reference) => reference.getAttribute('role') === 'doc-noteref'));
  assert.ok(references.every((reference) => !reference.hasAttribute('aria-describedby')));
  const notes = Array.from(doc.querySelectorAll('aside[role="doc-footnote"]'));
  assert.equal(notes.length, 2);
  assert.equal(notes[0]!.id, 'pfpdf-footnote-1-2', 'authored IDs must not collide with generated note IDs');
  assert.deepEqual(notes.map((note) => note.getAttribute('aria-label')), ['脚注 1', '脚注 2']);
  const backrefs = Array.from(doc.querySelectorAll('[data-footnote-backref]'));
  assert.deepEqual(backrefs.map((ref) => ref.getAttribute('aria-label')), [
    '参照 1 に戻る', '参照 1（2 回目） に戻る', '参照 2 に戻る', '参照 2（2 回目） に戻る',
  ]);
  for (const link of [...references, ...backrefs]) assert.ok(doc.getElementById(link.getAttribute('href')!.slice(1)));
  const ids = Array.from(doc.querySelectorAll('[id]')).map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const note of notes) {
    assert.equal(note.querySelector('strong')!.textContent, 'emphasis');
    assert.equal(note.querySelector('a[href="https://example.com"]')!.textContent, 'link');
    assert.match(note.textContent, /Second paragraph\./);
    assert.match(note.querySelector('pre code')!.textContent, /note code/);
  }
  assert.deepEqual(body.toc.map((entry) => entry.text), ['Heading', 'Heading']);
  parsed.window.close();
});

test('default page footnotes integrate with the exact renderer HTML without an endnote heading', async (t) => {
  const { dir, input } = fixture(t);
  fs.writeFileSync(input, '---\ntitle: Notes\nlang: fr\n---\n# Heading\n\nText[^n].\n\n[^n]: Note body.\n');
  const config = resolveConfig(['--input', input, '--output', path.join(dir, 'out.pdf')], dir);
  const page = await buildHtml(config, env, log);
  assert.equal(page.generated.get('document.html')!.toString(), page.html);
  assert.match(page.html, /role="doc-footnote"/);
  assert.match(page.html, /aria-label="Footnote 1"/);
  assert.match(page.html, /aria-label="Back to reference 1"/);
  assert.doesNotMatch(page.html, /data-footnotes/);
  assert.doesNotMatch(page.html, /id="footnote-label"/);
  assert.match(page.html, /id="pfpdf-footnote-1"/);
});

test('page conversion preserves unrelated raw HTML carrying footnote-like attributes', async () => {
  const raw = '<section data-footnotes><p>Authored heading</p><ol><li id="manual-note">Authored content</li></ol></section>\n\n';
  for (const markdown of [raw, raw + 'Text[^n].\n\n[^n]: Generated note.\n']) {
    const body = await buildDocumentBody([source(markdown, 'a.md')], new ResourceManifest(), [], { warn: log.warn });
    const html = body.sections.map((section) => toHtml(section as never)).join('');
    assert.match(html, /<li id="manual-note">Authored content<\/li>/);
    assert.match(html, /Authored heading/);
  }
  const referenced = '<p>Call<a data-footnote-ref href="#manual-note" id="manual-reference">9</a></p>\n\n'
    + '<section data-footnotes><p>Authored heading</p><ol><li id="manual-note">Referenced body</li><li id="unreferenced">Retained body</li></ol><p>Authored footer</p></section>\n';
  const body = await buildDocumentBody([source(referenced, 'b.md')], new ResourceManifest(), [], { warn: log.warn });
  const html = body.sections.map((section) => toHtml(section as never)).join('');
  assert.match(html, /Authored heading/);
  assert.match(html, /Authored footer/);
  assert.match(html, /<li id="unreferenced">Retained body<\/li>/);
  assert.equal((html.match(/Referenced body/g) ?? []).length, 1);
});

function renderPdf(input: string, output: string, template: string): { html: string; workspace: string } {
  const result = spawnSync(process.execPath, [cli, '--input', input, '--output', output, '--template', template, '--no-toc', '--keep-work-dir', ...browser], {
    encoding: 'utf8', timeout: 330000, env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(output).subarray(0, 5).toString(), '%PDF-');
  if (process.env.PFPDF_QA_DIR) {
    fs.mkdirSync(process.env.PFPDF_QA_DIR, { recursive: true });
    fs.copyFileSync(output, path.join(process.env.PFPDF_QA_DIR, path.basename(output)));
  }
  const workspace = /workspace kept at (.+?);/.exec(result.stderr)?.[1];
  assert.ok(workspace, result.stderr);
  return { html: fs.readFileSync(path.join(workspace, 'document.html'), 'utf8'), workspace };
}

test('all templates place notes at the bottom of their first-reference page', { skip: !enabled }, async (t) => {
  const { dir, input } = fixture(t);
  fs.writeFileSync(input, '---\ntitle: Note placement\nlang: en\nconfidential: true\n---\n# Reference page\n\nFIRSTREF text[^shared]. Repeat[^shared].\n\n___\n\n# Later page\n\nLATERREF reused[^shared] and another note[^other].\n\n[^shared]: NOTEONE body of the first note.\n\n[^other]: NOTETWO body of the second note.\n');
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    const output = path.join(dir, `${template}.pdf`);
    const { html, workspace } = renderPdf(input, output, template);
    try {
      assert.match(html, /role="doc-footnote"/);
      const pages = await footnotePdfPages(input, output, template, html);
      const first = pages.findIndex((page) => page.words.some((word) => word.text === 'FIRSTREF'));
      const later = pages.findIndex((page) => page.words.some((word) => word.text === 'LATERREF'));
      assert.ok(first >= 0 && later > first, template);
      const firstNote = pages[first]!.words.find((word) => word.text === 'NOTEONE');
      const secondNote = pages[later]!.words.find((word) => word.text === 'NOTETWO');
      assert.ok(firstNote && secondNote, `${template}: a note is missing on its first-reference page`);
      assert.ok(firstNote.y > pages[first]!.height * 0.7, `${template}: first note is not at the page bottom`);
      assert.ok(secondNote.y > pages[later]!.height * 0.7, `${template}: second note is not at the page bottom`);
      assert.equal(pages.flatMap((page) => page.words).filter((word) => word.text === 'NOTEONE').length, 1, 'repeated notes are printed once');
      assert.ok(pages.flatMap((page) => page.words).map((word) => word.text).join('').toLowerCase().includes('confidential'), template);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }
});

test('long page footnotes retain paragraphs, code, links and overflow onto later pages', { skip: !enabled }, async (t) => {
  const { dir, input } = fixture(t);
  const longText = 'A long footnote continues without losing content. '.repeat(200);
  fs.writeFileSync(input, `---\ntitle: Long note\nlang: en\n---\n# Reference page\n\nFIRSTREF body[^long].\n\n[^long]: LONGSTART ${longText}\n\n    Another paragraph with a [link](https://example.com).\n\n    \`\`\`text\n    CODEMARK\n    \`\`\`\n\n    LONGEND\n`);
  for (const template of ['default', 'compact']) {
    const output = path.join(dir, `${template}-long.pdf`);
    const { html, workspace } = renderPdf(input, output, template);
    try {
      assert.match(html, /CODEMARK/);
      assert.match(html, /href="https:\/\/example.com"/);
      const pages = await footnotePdfPages(input, output, template, html);
      const start = pages.findIndex((page) => page.words.some((word) => word.text === 'LONGSTART'));
      const end = pages.findIndex((page) => page.words.some((word) => word.text === 'LONGEND'));
      const reference = pages.findIndex((page) => page.words.some((word) => word.text === 'FIRSTREF'));
      assert.equal(start, reference, `${template}: the long note must begin on its reference page`);
      assert.ok(start >= 0 && end > start, `${template}: long note must span pages`);
      assert.ok(pages.flatMap((page) => page.words).some((word) => word.text === 'CODEMARK'), template);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }
});
