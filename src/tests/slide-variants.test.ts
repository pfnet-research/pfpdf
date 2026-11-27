import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { BUNDLED_SLIDE_VARIANT_NAMES, BUNDLED_TEMPLATE_NAMES } from '../bundled-templates.js';
import { resolveConfig } from '../config.js';
import { buildHtml } from '../build.js';
import { InputError } from '../errors.js';
import { resourcePath } from '../template.js';

const env = { SOURCE_DATE_EPOCH: '0' };

function recorder(): { warnings: string[]; log: { warn: (m: string) => void; info: () => void; debug: () => void } } {
  const warnings: string[] = [];
  return { warnings, log: { warn: (m: string) => { warnings.push(m); }, info: () => {}, debug: () => {} } };
}

function workspace(t: { after: (fn: () => void) => void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-slide-variants-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

const deck = '---\nslides: true\ntitle: Deck\nlang: en\n---\n# Group\n\n## First\n\n::: column\nA\n\n::: column\nB\n\n::: talk\nSECRET-TALK\n';
const doc = '---\ntitle: Doc\nlang: en\n---\n# Heading\n\nText\n';

async function build(dir: string, source: string, args: string[], log = recorder().log): Promise<{ html: string; generated: Map<string, Buffer> }> {
  const input = path.join(dir, `input-${Math.random().toString(36).slice(2)}.md`);
  fs.writeFileSync(input, source);
  return buildHtml(resolveConfig(['--input', input, '--output', 'out.pdf', ...args], dir), env, log);
}

function writeTemplate(dir: string, files: Record<string, string>): string {
  const root = path.join(dir, 'tpl');
  fs.mkdirSync(root, { recursive: true });
  const html = (marker: string): string =>
    `<!doctype html><html><head></head><body><header data-pfpdf-slot="cover" class="${marker}"><h1 data-pfpdf-slot="title"></h1></header><main data-pfpdf-slot="content"></main></body></html>`;
  const defaults: Record<string, string> = {
    'template.html': html('doc-cover'),
    'style.css': '@import "./theme.css";\n.doc-style { color: red; }\n',
    'vivliostyle.css': '.doc-paged { color: red; }\n',
    'theme.css': ':root { --shared-accent: #123456; }\n',
  };
  for (const [name, content] of Object.entries({ ...defaults, ...files })) {
    if (content === '') continue;
    fs.writeFileSync(path.join(root, name), content.replace('SLIDE_HTML', html('slide-cover')));
  }
  return root;
}

test('every bundled document template ships a slide variant listed in the manifest', () => {
  const withVariant = BUNDLED_TEMPLATE_NAMES.filter((name) =>
    fs.existsSync(resourcePath('templates', name, 'slides-template.html')));
  assert.deepEqual([...BUNDLED_SLIDE_VARIANT_NAMES].sort(), [...withVariant].sort());
  assert.deepEqual([...BUNDLED_SLIDE_VARIANT_NAMES].sort(), [...BUNDLED_TEMPLATE_NAMES].sort());
  for (const name of BUNDLED_SLIDE_VARIANT_NAMES) {
    const style = fs.readFileSync(resourcePath('templates', name, 'slides-style.css'), 'utf8');
    assert.match(style, /^@import "\.\.\/common\.css";\r?\n@import "\.\.\/common-slides\.css";/m, name);
    const html = fs.readFileSync(resourcePath('templates', name, 'slides-template.html'), 'utf8');
    assert.match(html, /data-pfpdf-slot="cover"/, name);
    assert.doesNotMatch(html, /data-pfpdf-slot="toc"/, name);
  }
});

test('slides without a template use the slide variant of default', async (t) => {
  const dir = workspace(t);
  const { warnings, log } = recorder();
  const slides = await build(dir, deck, [], log);
  assert.match(slides.html, /class="pfpdf-slide-cover"[^>]*data-pfpdf-slide="title"/);
  assert.doesNotMatch(slides.html, /class="pfpdf-cover"/);
  assert.doesNotMatch(slides.html, /SECRET-TALK/);
  assert.ok(!slides.generated.has('generated/vivliostyle.css'));
  assert.doesNotMatch(slides.html, /generated\/vivliostyle\.css/);
  assert.match(slides.generated.get('generated/style.css')!.toString(), /common-slides\.css/);
  assert.deepEqual(warnings, []);

  const document = await build(dir, doc, []);
  assert.match(document.html, /class="pfpdf-cover"/);
  assert.match(document.html, /generated\/vivliostyle\.css/);
  assert.doesNotMatch(document.generated.get('generated/style.css')!.toString(), /common-slides\.css/);
});

test('every bundled template selects its slide variant for slides and its document files otherwise', async (t) => {
  const dir = workspace(t);
  for (const name of BUNDLED_TEMPLATE_NAMES) {
    const slides = await build(dir, deck, ['--template', name]);
    assert.match(slides.generated.get('generated/style.css')!.toString(), /common-slides\.css/, name);
    assert.match(slides.html, /data-pfpdf-slide="title"/, name);
    const document = await build(dir, doc, ['--template', name]);
    assert.doesNotMatch(document.generated.get('generated/style.css')!.toString(), /common-slides\.css/, name);
  }
});

test('slide-base still builds but warns that it is deprecated', async (t) => {
  const dir = workspace(t);
  const preset = recorder();
  const slides = await build(dir, deck, ['--template-preset', 'slide-base'], preset.log);
  assert.match(slides.html, /data-pfpdf-slide="title"/);
  assert.equal(preset.warnings.filter((w) => /slide-base is deprecated.*0\.7\.0/.test(w)).length, 1);

  const frontMatter = recorder();
  await build(dir, deck.replace('slides: true', 'slides: true\ntemplate: slide-base'), [], frontMatter.log);
  assert.equal(frontMatter.warnings.filter((w) => /slide-base is deprecated/.test(w)).length, 1);
});

test('a custom template keeps document and slide files side by side', async (t) => {
  const dir = workspace(t);
  const template = writeTemplate(dir, {
    'slides-template.html': 'SLIDE_HTML',
    'slides-style.css': '@import "./theme.css";\n.slide-style { color: blue; }\n',
  });
  const slides = await build(dir, deck, ['--template', template]);
  assert.match(slides.html, /class="slide-cover"/);
  const style = slides.generated.get('generated/style.css')!.toString();
  assert.match(style, /--shared-accent: #123456/);
  assert.match(style, /\.slide-style/);
  assert.doesNotMatch(style, /\.doc-style/);
  assert.ok(!slides.generated.has('generated/vivliostyle.css'), 'slides-vivliostyle.css is optional');

  const document = await build(dir, doc, ['--template', template]);
  assert.match(document.html, /class="doc-cover"/);
  assert.match(document.generated.get('generated/style.css')!.toString(), /\.doc-style/);
  assert.match(document.generated.get('generated/vivliostyle.css')!.toString(), /\.doc-paged/);

  fs.writeFileSync(path.join(template, 'slides-vivliostyle.css'), '.slide-paged { color: blue; }\n');
  const paged = await build(dir, deck, ['--template', template]);
  assert.match(paged.generated.get('generated/vivliostyle.css')!.toString(), /\.slide-paged/);
});

test('a custom template without slide files is used as-is for slides', async (t) => {
  const dir = workspace(t);
  const template = writeTemplate(dir, {});
  const slides = await build(dir, deck, ['--template', template]);
  assert.match(slides.html, /class="doc-cover"/);
  assert.match(slides.generated.get('generated/vivliostyle.css')!.toString(), /\.doc-paged/);
});

test('an incomplete slide variant is an input error', async (t) => {
  const dir = workspace(t);
  const missingStyle = writeTemplate(dir, { 'slides-template.html': 'SLIDE_HTML' });
  await assert.rejects(build(dir, deck, ['--template', missingStyle]), (error: unknown) =>
    error instanceof InputError && /slides-style\.css/.test(error.message));
  fs.rmSync(path.join(missingStyle, 'slides-template.html'));
  fs.writeFileSync(path.join(missingStyle, 'slides-style.css'), '');
  await assert.rejects(build(dir, deck, ['--template', missingStyle]), (error: unknown) =>
    error instanceof InputError && /slides-template\.html \(required by slides-style\.css\)/.test(error.message));
  // Documents never read the slide files.
  await build(dir, doc, ['--template', missingStyle]);
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const browserArgs = process.env.BROWSER_PATH ? ['--browser-path', process.env.BROWSER_PATH] : [];

test('every bundled slide variant renders the sample deck on 16:9 pages without speaker notes', { skip: process.env.RUN_E2E !== '1' }, async (t) => {
  const dir = workspace(t);
  for (const name of BUNDLED_SLIDE_VARIANT_NAMES) {
    for (const input of ['slides.md', 'slides.en.md']) {
      const output = path.join(dir, `${name}-${input}.pdf`);
      const res = spawnSync(process.execPath, [
        path.join(repoRoot, 'dist', 'launcher.js'), ...browserArgs,
        '--input', path.join(repoRoot, 'docs', 'template-preview', input),
        '--output', output, '--template', name, '--render-timeout-ms', '600000',
      ], { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1750000000' }, timeout: 660000 });
      // pfpdf itself rejects a deck whose slides overflow onto extra pages.
      assert.equal(res.status, 0, `${name} ${input}: ${res.stderr}`);
      const pdf = await PDFDocument.load(fs.readFileSync(output), { updateMetadata: false });
      assert.equal(pdf.getPageCount(), 9, `${name} ${input}`);
      for (const page of pdf.getPages()) {
        const { width, height } = page.getSize();
        assert.deepEqual([Math.round(width), Math.round(height)], [960, 540], `${name} ${input}`);
      }
      const text = spawnSync('pdftotext', [output, '-'], { encoding: 'utf8' });
      if (text.error === undefined && text.status === 0) {
        assert.doesNotMatch(text.stdout, /TALK-MARKER/, `${name} ${input}`);
      }
    }
  }
});

test('a ### directly under a slide title becomes its subtitle', async (t) => {
  const dir = workspace(t);
  const source = '---\nslides: true\ntitle: Deck\nlang: en\ntoc: false\n---\n'
    + '## First\n\n### Sub one\n\nText\n\n'
    + '## Second\n\nText first\n\n### Heading two\n\n'
    + '## Third\n\n::: column\n### Heading three\n\nA\n';
  const { html } = await build(dir, source, []);
  assert.match(html, /<h3 id="[^"]*" class="pfpdf-slide-subtitle">Sub one<\/h3><div class="pfpdf-slide-body">/);
  assert.equal((html.match(/pfpdf-slide-subtitle/g) ?? []).length, 1);
  assert.match(html, /<h3 id="[^"]*">Heading two<\/h3>/);
  assert.match(html, /<h3 id="[^"]*">Heading three<\/h3>/);
  // Ordinary documents keep every ### as a heading.
  const document = await build(dir, '---\ntitle: Doc\nlang: en\n---\n## First\n\n### Sub one\n', []);
  assert.doesNotMatch(document.html, /pfpdf-slide-subtitle/);
});

test('front matter subtitle fills document and slide cover slots', async (t) => {
  const dir = workspace(t);
  const slides = await build(dir, deck.replace('title: Deck', 'title: Deck\nsubtitle: A <short> subtitle'), []);
  assert.match(slides.html, /class="pfpdf-slide-cover-subtitle">A &#x3C;short> subtitle<\/p>/);
  const plain = await build(dir, deck, []);
  assert.doesNotMatch(plain.html, /cover-subtitle/);
  const document = await build(dir, doc.replace('title: Doc', 'title: Doc\nsubtitle: Second line'), []);
  assert.match(document.html, /class="pfpdf-cover-subtitle">Second line<\/p>/);
});

test('font_size sets a body size in points and a slide may override it', async (t) => {
  const dir = workspace(t);
  const source = deck.replace('title: Deck', 'title: Deck\nfont_size: 20')
    .replace('## First\n', '## First\n\n<!-- pfpdf:font_size=18.5 audience=client -->\n')
    + '\n## Second\n\nOther text\n\n## Divider\n\n<!-- pfpdf:layout=section -->\n\nHand-made divider\n';
  const slides = await build(dir, source, []);
  assert.match(slides.html, /<body[^>]*style="--pfpdf-font-size: 20pt;"/);
  assert.match(slides.html, /<section[^>]*style="--pfpdf-font-size: 18.5pt;"[^>]*data-pfpdf-audience="client">/);
  assert.equal((slides.html.match(/<section[^>]*style="--pfpdf-font-size:/g) ?? []).length, 1);
  assert.doesNotMatch(slides.html, /data-pfpdf-font_size/);
  // Only the two regular slides, not the agenda or a page with layout=section, apply the size inline over template rules.
  const sizedBody = /class="pfpdf-slide-body" style="font-size: var\(--pfpdf-font-size\);"/g;
  assert.equal((slides.html.match(sizedBody) ?? []).length, 2);
  const local = await build(dir, source.replace('font_size: 20\n', ''), []);
  assert.equal((local.html.match(sizedBody) ?? []).length, 1);
  // Without a size, no rule overrides a template's own slide body size.
  const plain = await build(dir, deck, []);
  assert.doesNotMatch(plain.html, /--pfpdf-font-size/);
  assert.doesNotMatch(plain.generated.get('generated/slides.css')!.toString(), /--pfpdf-font-size/);

  const template = writeTemplate(dir, {
    'template.html': '<!doctype html><html><head></head><body style="color: #123; --pfpdf-font-size: 30pt"><main data-pfpdf-slot="content"></main></body></html>',
  });
  const document = await build(dir, doc.replace('title: Doc', 'title: Doc\nfont_size: 9.5'), ['--template', template]);
  assert.match(document.html, /<body[^>]*style="color: #123; --pfpdf-font-size: 30pt; --pfpdf-font-size: 9.5pt;"/);
  assert.match(document.html, /<section[^>]*style="font-size: var\(--pfpdf-font-size\);"/);
  assert.doesNotMatch(document.html, /<(?:nav|main)[^>]*style="font-size:/);
});

test('font_size rejects lengths and nonpositive or nonfinite values', async (t) => {
  const dir = workspace(t);
  for (const value of ['"20"', '0', '-1', '1e999', '18pt', '18px', 'large']) {
    await assert.rejects(build(dir, doc.replace('title: Doc', `title: Doc\nfont_size: ${value}`), []), (error: unknown) =>
      error instanceof InputError && /front matter font_size: expected a positive number of points without a unit/.test(error.message), value);
  }
  for (const value of ['0', '-1', '1e999', '18pt', '18px', 'large', '0x12']) {
    await assert.rejects(build(dir, deck.replace('## First\n', `## First\n\n<!-- pfpdf:font_size=${value} -->\n`), []),
      (error: unknown) => error instanceof InputError && /\.md:10: slide font_size: expected a positive number of points without a unit/.test(error.message), value);
  }
});

test('section covers are optional and do not affect normal documents', async (t) => {
  const dir = workspace(t);
  for (const [input, count] of [[deck, 0], [deck.replace('slides: true', 'slides: true\nsection_covers: true'), 1],
    [doc.replace('title: Doc', 'title: Doc\nsection_covers: true'), 0]] as const) {
    const { html } = await build(dir, input, []);
    assert.equal((html.match(/data-pfpdf-slide="section"/g) ?? []).length, count);
  }
});

test('the confidential body attribute is common to document and slide output, with or without a cover', async (t) => {
  const dir = workspace(t);
  for (const source of [doc, deck]) {
    for (const cover of [true, false]) {
      for (const confidential of [true, false]) {
        const { html } = await build(dir, source.replace('lang: en', `lang: en\ncover: ${cover}\nconfidential: ${confidential}`), []);
        assert.equal(/<body[^>]*\sdata-pfpdf-confidential(?:\s|=|>)/.test(html), confidential);
        assert.equal(/<div class="pfpdf-running-metadata" aria-hidden="true">/.test(html), confidential && !cover);
        assert.equal(/>(?:Confidential)<\/p>/.test(html), confidential);
      }
    }
  }
});

test('the paginated slide check warns about clipping, and a split slide fails the page count', { skip: process.env.RUN_E2E !== '1' }, (t) => {
  const dir = workspace(t);
  const template = writeTemplate(dir, {
    'slides-template.html': 'SLIDE_HTML',
    'slides-style.css': `
      [data-pfpdf-slide] { padding: 75pt 33pt 35pt; }
      [data-pfpdf-slide]::after { content: "footer"; position: absolute; left: 33pt; bottom: 13pt; }
    `,
    'slides-vivliostyle.css': '[data-pfpdf-slide] { break-inside: avoid; }',
  });
  const output = path.join(dir, 'deck.pdf');
  const renderDeck = (count: number, leadingSlide = '') => {
    const list = Array.from({ length: count }, (_, index) => `- ITEM-${index + 1}`).join('\n');
    const input = path.join(dir, 'slides.md');
    fs.writeFileSync(input, `---\nslides: true\ncover: false\ntoc: false\n---\n\n${leadingSlide}## Long list\n\n${list}\n\n## Next slide\n\nSome text.\n`);
    return spawnSync(process.execPath, [
      path.join(repoRoot, 'dist', 'launcher.js'), ...browserArgs,
      '--input', input, '--output', output, '--template', template,
    ], { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1750000000' }, timeout: 120000 });
  };
  const fits = renderDeck(14);
  assert.equal(fits.status, 0, fits.stderr);
  assert.doesNotMatch(fits.stderr, /may be clipped/);
  const firstPage = spawnSync('pdftotext', ['-f', '1', '-l', '1', output, '-'], { encoding: 'utf8' });
  if (firstPage.status === 0) {
    assert.match(firstPage.stdout, /\bITEM-14\b/);
    assert.match(firstPage.stdout, /footer/);
  }

  const clipped = renderDeck(16);
  assert.equal(clipped.status, 0, clipped.stderr);
  assert.match(clipped.stderr, /warn: the slide on page 1 extends outside the page and may be clipped/);

  const laterSlide = renderDeck(16, '## Previous slide\n\nSome text.\n\n');
  assert.equal(laterSlide.status, 0, laterSlide.stderr);
  assert.match(laterSlide.stderr, /warn: the slide on page 2 extends outside the page and may be clipped/);

  const previous = fs.readFileSync(output);
  const split = renderDeck(22);
  assert.equal(split.status, 1, split.stderr);
  assert.match(split.stderr, /slide pagination mismatch: expected 2 PDF pages/);
  assert.deepEqual(fs.readFileSync(output), previous);
});
