import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toHtml } from 'hast-util-to-html';
import { buildHtml } from '../build.js';
import { resolveConfig } from '../config.js';
import { buildDocumentBody } from '../markdown.js';
import { ResourceManifest } from '../resources.js';
import type { SlideOptions } from '../slides.js';

async function render(content: string, overrides: Partial<SlideOptions> = {}, lang?: string) {
  const body = await buildDocumentBody([
    { content, name: 'slides.md', path: '/virtual/slides.md', lineOffset: 0 },
  ], new ResourceManifest(), [], {
    warn: () => {}, ...(lang === undefined ? {} : { lang }), slides: { toc: true, sectionCovers: false, ...overrides },
  });
  return { ...body, html: body.sections.map((section) => toHtml(section as never)).join('') };
}

test('groups create linked agendas and second-level headings start slides', async () => {
  const body = await render('# Methods\n\n## Conditions\n\nText\n\n## Procedure\n\nSteps\n\n# Results\n\n## Comparison\n\nResult');
  assert.equal(body.slideCount, 4);
  assert.match(body.html, /data-pfpdf-slide="agenda"/);
  assert.match(body.html, /href="#methods"/);
  assert.match(body.html, /id="methods" class="pfpdf-slide-group-anchor"/);
  assert.deepEqual(body.toc.map((entry) => entry.text), ['Methods', 'Conditions', 'Procedure', 'Results', 'Comparison']);
});

test('only top-level ATX headings and underscore breaks split pages', async () => {
  const body = await render('___\n\n## First\n\n### Subheading\n\n> ## Quoted\n\n```md\n## Code\n::: column\n```\n\n___\n\n___\n\n## Second\n\nSetext\n------\n\n___');
  assert.equal(body.slideCount, 2);
  assert.doesNotMatch(body.html, /data-pfpdf-slide="agenda"/);
  assert.match(body.html, /<h3[^>]*>Subheading/);
});

test('adjacent regions with one name share a group, and speaker-only resources are removed', async () => {
  const body = await render('## Comparison\n\n::: column\nLeft text\n\n::: column\n### Right\n\nRight text\n\n::: note\nVisible note\n\n::: talk\n![secret](missing.png)\n\n## Next\n\nOrdinary body');
  assert.equal(body.slideCount, 2);
  assert.match(body.html, /data-pfpdf-slide="content"/);
  assert.match(body.html, /class="pfpdf-slide-regions" data-pfpdf-regions="column" data-pfpdf-count="2"/);
  assert.equal((body.html.match(/class="pfpdf-slide-region" data-pfpdf-region="column"/g) ?? []).length, 2);
  assert.match(body.html, /<\/div><\/div><div class="pfpdf-slide-region" data-pfpdf-region="note">/);
  assert.match(body.html, /Visible note/);
  assert.doesNotMatch(body.html, /secret|missing|pfpdf-region:/);
  assert.doesNotMatch(toHtml(body.sections[1]! as never), /pfpdf-slide-region/);
});

test('templates own region names, and body content separates groups', async () => {
  const body = await render('## Custom\n\n::: side-bar\nOne\n\n::: main\nTwo\n\n::: card\nA\n\n::: body\nBetween\n\n::: card\nB');
  assert.match(body.html, /data-pfpdf-region="side-bar"/);
  assert.match(body.html, /data-pfpdf-region="main"/);
  assert.equal((body.html.match(/data-pfpdf-region="card"/g) ?? []).length, 2);
  assert.doesNotMatch(body.html, /pfpdf-slide-regions/);
  assert.match(body.html, /<p>Between<\/p>/);
});

test('every per-slide key reaches the template, and a named layout keeps an empty page', async () => {
  const body = await render('<!-- pfpdf:layout=blank -->\n\n___\n\n## Split\n\n<!-- pfpdf:layout=split band=off audience=client accent-color=blue -->\n\n::: left\nLeft\n\n::: right\nRight\n\n## Last\n\nLast');
  assert.equal(body.slideCount, 3);
  assert.match(body.html, /data-pfpdf-slide="blank"/);
  assert.match(body.html, /data-pfpdf-slide="split" data-pfpdf-band="off" data-pfpdf-audience="client" data-pfpdf-accent-color="blue"/);
  assert.match(body.html, /data-pfpdf-region="left"/);
  assert.doesNotMatch(toHtml(body.sections[2]! as never), /data-pfpdf-audience|data-pfpdf-band/);
});

test('agendas paginate five groups at a time and optional section covers count', async () => {
  const source = Array.from({ length: 7 }, (_, i) => `# Group ${i + 1}\n\n## Slide ${i + 1}\n\nText`).join('\n\n');
  const body = await render(source, { sectionCovers: true });
  assert.equal(body.slideCount, 16);
  assert.equal((body.html.match(/data-pfpdf-slide="agenda"/g) ?? []).length, 2);
  assert.equal((body.html.match(/data-pfpdf-slide="section"/g) ?? []).length, 7);
  assert.match(body.html, /start="6"/);
  const noToc = await render(source, { toc: false });
  assert.equal(noToc.slideCount, 7);
});

test('a group alone does not manufacture a page', async () => {
  const body = await render('# Empty group', { toc: false });
  assert.equal(body.slideCount, 0);
});


test('leading visual modifiers attach to the next title without an empty page', async () => {
  const body = await render('<!-- pfpdf:band=off -->\n\n## First\n\nText');
  assert.equal(body.slideCount, 1);
  assert.match(body.html, /data-pfpdf-band="off"/);
});

test('references and footnotes resolve against the whole document, inside and outside regions', async () => {
  const body = await render('## A\n\nSee [manual][ref] and a note[^1].\n\n::: column\nAlso [manual][ref].\n\n[ref]: https://example.com/\n\n[^1]: Footnote.');
  assert.equal((body.html.match(/<a href="https:\/\/example.com\/">manual<\/a>/g) ?? []).length, 2);
  assert.doesNotMatch(body.html, /\[manual\]|\[\^1\]/);
  assert.match(body.html, /<\/div>\s*<aside[^>]*class="pfpdf-page-footnote"/);
});

test('speaker notes stay private across Setext headings and code spans', async () => {
  const setext = await render('## A\n\nVisible\n\n::: talk\nSecret note\n---\n\n## B\n\nNext');
  assert.equal(setext.slideCount, 2);
  assert.doesNotMatch(setext.html, /Secret|:::/);
  const code = await render('## A\n\nVisible\n\n::: talk\nSecret `code\n::: body\nstill code` secret tail\n\n## B\n\nNext');
  assert.doesNotMatch(code.html, /[Ss]ecret|still code/);
  const shown = await render('## A\n\nShown `code\n::: talk\nstill code` tail\n\n## ::: talk');
  assert.match(shown.html, /<code>code ::: talk still code<\/code> tail/);
  assert.match(shown.html, /<h2[^>]*>::: talk<\/h2>/);
});

test('a region marker inside a paragraph keeps inline nodes and Japanese line joining', async () => {
  const body = await render('## A\n\n前の\n文です。\n::: card2\n**強調**の\n文です。  \n::: note\n注記です。', {}, 'ja');
  assert.match(body.html, /<p>前の文です。<\/p>/);
  assert.match(body.html, /data-pfpdf-region="card2">\s*<p><strong>強調<\/strong>の文です。<br>\s*<\/p>/);
  assert.match(body.html, /data-pfpdf-region="note">\s*<p>注記です。<\/p>/);
});

test('option values reach the template whole, and malformed options are errors', async () => {
  const body = await render('## A\n\n<!-- pfpdf:gap=1.5rem align=top_left ratio=2:1 span2=wide -->\n\nText');
  assert.match(body.html, /data-pfpdf-gap="1.5rem" data-pfpdf-align="top_left" data-pfpdf-ratio="2:1" data-pfpdf-span2="wide"/);
  await assert.rejects(render('## A\n\n<!-- pfpdf:layout=x wide -->\n\nText'), /slides\.md:3: invalid slide option: wide/);
  await assert.rejects(render('## A\n\n<!-- pfpdf:slide=x -->\n\nText'), /invalid slide option: slide=x/);
});

test('a content-only custom template and the bundled slide preset both build slides', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-slides-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const input = path.join(dir, 'deck.md');
  fs.writeFileSync(input, '---\nslides: true\ntitle: Deck\nlang: en\n---\n## First\n\nText\n');
  const custom = path.join(dir, 'custom');
  fs.mkdirSync(custom);
  fs.writeFileSync(path.join(custom, 'style.css'), '');
  fs.writeFileSync(path.join(custom, 'vivliostyle.css'), '');
  fs.writeFileSync(path.join(custom, 'template.html'), '<!doctype html><html><head></head><body><main data-pfpdf-slot="content"></main></body></html>');
  const log = { warn: (): void => {}, info: (): void => {}, debug: (): void => {} };
  const env = { ...process.env, SOURCE_DATE_EPOCH: '0' };
  const plain = await buildHtml(resolveConfig(['--input', input, '--output', 'out.pdf', '--template', custom], dir), env, log);
  assert.match(plain.html, /data-pfpdf-slide="content"/);
  assert.doesNotMatch(plain.html, /data-pfpdf-slide="title"/);
  const preset = await buildHtml(resolveConfig(['--input', input, '--output', 'out.pdf', '--template-preset', 'slide-base'], dir), env, log);
  assert.match(preset.html, /data-pfpdf-slide="title"/);
});
