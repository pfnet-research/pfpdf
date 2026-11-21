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
    warn: () => {}, slides: { toc: true, sectionCovers: false, confidential: false, ...overrides },
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

test('named regions infer columns, preserve notes, and remove speaker-only resources', async () => {
  const body = await render('## Comparison\n\n::: column\nLeft text\n\n::: column\n### Right\n\nRight text\n\n::: note\nVisible note\n\n::: talk\n![secret](missing.png)\n\n## Next\n\nOrdinary body');
  assert.equal(body.slideCount, 2);
  assert.match(body.html, /data-pfpdf-slide="columns" data-pfpdf-columns="2"/);
  assert.match(body.html, /class="pfpdf-slide-note"/);
  assert.match(body.html, /Visible note/);
  assert.doesNotMatch(body.html, /secret|missing|pfpdf-region/);
  assert.doesNotMatch(toHtml(body.sections[1]! as never), /pfpdf-slide-column/);
});

test('explicit blank and per-slide modifiers survive and reset', async () => {
  const body = await render('<!-- pfpdf:layout=blank -->\n\n___\n\n## Split\n\n<!-- pfpdf:band=off split=half audience=client tone=gray align=bottom -->\n\n::: left\nLeft\n\n::: right\nRight\n\n## Last\n\n<!-- pfpdf:audience=none -->\n\nLast', { confidential: true });
  assert.equal(body.slideCount, 3);
  assert.match(body.html, /data-pfpdf-slide="blank"/);
  assert.match(body.html, /data-pfpdf-slide="split" data-pfpdf-band="off" data-pfpdf-split="half"/);
  assert.match(body.html, /data-pfpdf-audience="client"/);
  assert.match(body.html, /貴社内に限り/);
  assert.doesNotMatch(toHtml(body.sections[2]! as never), /data-pfpdf-audience|pfpdf-slide-audience|data-pfpdf-band/);
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

test('a misspelled region fails before speaker text can enter a slide', async () => {
  await assert.rejects(render('## First\n\n::: tal\nPrivate notes'), /unknown slide region: tal/);
});
