import test from 'node:test';
import assert from 'node:assert/strict';
import { toHtml } from 'hast-util-to-html';
import { buildDocumentBody } from '../markdown.js';
import { ResourceManifest } from '../resources.js';
import type { SlideOptions } from '../slides.js';

async function render(content: string, overrides: Partial<SlideOptions> = {}) {
  const body = await buildDocumentBody([
    { content, name: 'slides.md', path: '/virtual/slides.md', lineOffset: 0 },
  ], new ResourceManifest(), [], {
    warn: () => {}, slides: { toc: true, sectionCovers: false, ...overrides },
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
