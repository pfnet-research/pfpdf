import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { toHtml } from 'hast-util-to-html';
import { buildDocumentBody, slugify } from '../markdown.js';
import { ResourceManifest } from '../resources.js';
import { InputError } from '../errors.js';
import type { BibliographyFile, SourceFile } from '../input.js';

const noop = (): void => {};

function src(content: string, name = 'doc.md'): SourceFile {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-md-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return { path: p, name, content, lineOffset: 0 };
}

async function render(content: string): Promise<string> {
  const body = await buildDocumentBody([src(content)], new ResourceManifest(), [], { warn: noop });
  return body.sections.map((s) => toHtml(s as never)).join('');
}

const bibliography: BibliographyFile[] = [{
  path: '/virtual/references.bib',
  declaredPath: 'references.bib',
  content: [
    '@article{smith2024, title={First Study}, author={Smith, Alice}, year={2024}, journal={Journal A}}',
    '@book{tanaka2025, title={Second Book}, author={Tanaka, Taro}, year={2025}, publisher={Press}}',
  ].join('\n'),
}];

async function renderWithBibliography(content: string, bib = bibliography): Promise<string> {
  const body = await buildDocumentBody([src(content)], new ResourceManifest(), [], {
    warn: noop,
    bibliography: bib,
  });
  return body.sections.map((section) => toHtml(section as never)).join('');
}

async function renderFilesWithBibliography(contents: string[]): Promise<string> {
  const files = contents.map((content, index) => src(content, `${index + 1}.md`));
  const body = await buildDocumentBody(files, new ResourceManifest(), [], {
    warn: noop,
    bibliography,
  });
  return body.sections.map((section) => toHtml(section as never)).join('');
}

test('TeX-style citations render linked numeric clusters and a bibliography', async () => {
  const html = await renderWithBibliography(
    '先行研究\\cite{smith2024,tanaka2025}と再引用\\cite{smith2024}。\n\n' +
    '# 参考文献\n\n\\printbibliography\n',
  );
  assert.match(html, /pfpdf-citation/);
  assert.match(html, />1<\/a>, <a[^>]+>2<\/a>/);
  assert.match(html, /role="doc-biblioref"/);
  assert.match(html, /id="refs"[^>]+role="doc-bibliography"/);
  assert.match(html, /First Study/);
  assert.match(html, /Second Book/);
  assert.equal((html.match(/pfpdf-bibliography-entry/g) ?? []).length, 2);
  assert.equal((html.match(/role="doc-backlink"/g) ?? []).length, 3);
});

test('citation clusters follow CSL citation-number order on repeat citation', async () => {
  const html = await renderWithBibliography(
    'First\\cite{smith2024,tanaka2025}; reversed source order\\cite{tanaka2025,smith2024}.\n',
  );
  const clusters = html.match(/<span class="pfpdf-citation">.*?<\/span>/g) ?? [];
  assert.equal(clusters.length, 2);
  assert.match(clusters[1]!, />1<\/a>, <a[^>]+>2<\/a>/);
});

test('bibliography IDs avoid collisions with author-provided HTML IDs', async () => {
  const html = await renderWithBibliography(
    '<div id="pfpdf-bib-c21pdGgyMDI0"></div>\n\nText\\cite{smith2024}.\n',
  );
  assert.match(html, /href="#pfpdf-bib-c21pdGgyMDI0-2"/);
  assert.match(html, /id="pfpdf-bib-c21pdGgyMDI0-2"/);
});

test('bibliography appends at the document end when no marker is present', async () => {
  const html = await renderWithBibliography('Text\\cite{tanaka2025}.\n');
  assert.match(html, /<\/p><div id="refs"/);
  assert.doesNotMatch(html, /First Study/);
  assert.match(html, /Second Book/);
});

test('citation parsing preserves escapes and ignores code, HTML, and math', async () => {
  const html = await renderWithBibliography([
    'Literal \\\\cite{missing}.',
    '',
    'Code `\\cite{missing}`.',
    '',
    '<code>\\cite{missing}</code>',
    '',
    'Active \\cite{smith2024}.',
  ].join('\n'));
  assert.match(html, /Literal \\cite\{missing\}/);
  assert.match(html, /<code>\\cite\{missing\}<\/code>/);
  assert.equal((html.match(/class="pfpdf-citation"/g) ?? []).length, 1);
  const math = await renderWithBibliography('Math $\\cite{missing}$.\n');
  assert.doesNotMatch(math, /class="pfpdf-citation"/);
});

test('citation parsing handles block contexts and preserves document-wide source order', async () => {
  const html = await renderFilesWithBibliography([
    [
      '```tex',
      '\\cite{missing}',
      '```',
      '',
      '    \\cite{missing}',
      '',
      '<div>\\cite{missing}</div>',
      '',
      '> Quote \\cite{tanaka2025}.',
    ].join('\n'),
    '- List **item \\cite{smith2024}**.\n',
  ]);
  assert.equal((html.match(/class="pfpdf-citation"/g) ?? []).length, 2);
  assert.match(html, /Quote <span class="pfpdf-citation">\[<a[^>]+>1<\/a>/);
  assert.match(html, /<strong>item <span class="pfpdf-citation">\[<a[^>]+>2<\/a>/);
  assert.match(html, /<code class="language-tex hljs">/);
  assert.ok((html.match(/\\cite\{missing\}/g) ?? []).length >= 2);
});

test('citation errors fail before rendering', async () => {
  await assert.rejects(render('Text\\cite{smith2024}.\n'), /requires bibliography front matter/);
  await assert.rejects(renderWithBibliography('Text\\cite{missing}.\n'), /key not found/);
  await assert.rejects(renderWithBibliography('Text\\cite{smith2024,smith2024}.\n'), /duplicate bibliography key/);
  await assert.rejects(renderWithBibliography('Text\\cite{}.\n'), /invalid or empty/);
  await assert.rejects(renderWithBibliography('Text\\cite{smith2024\n'), /unclosed/);
  await assert.rejects(renderWithBibliography('# Heading \\cite{smith2024}\n'), /not allowed in headings/);
  await assert.rejects(renderWithBibliography('[link \\cite{smith2024}](https://example.com)\n'), /not allowed in links/);
  await assert.rejects(renderWithBibliography('\\printbibliography\n'), /at least one citation/);
  await assert.rejects(
    renderWithBibliography('Text\\cite{smith2024}.\n\n\\printbibliography\n\n\\printbibliography\n'),
    /only once/,
  );
  await assert.rejects(
    renderWithBibliography('No citations.\n', [{
      path: '/virtual/broken.bib',
      declaredPath: 'broken.bib',
      content: '@article{broken, title={Unclosed}',
    }]),
    /invalid BibTeX/,
  );
});

test('duplicate bibliography keys across files are rejected', async () => {
  const duplicate: BibliographyFile[] = [
    bibliography[0]!,
    {
      path: '/virtual/more.bib',
      declaredPath: 'more.bib',
      content: '@misc{smith2024, title={Duplicate}}',
    },
  ];
  await assert.rejects(renderWithBibliography('Text\\cite{smith2024}.\n', duplicate), /duplicate bibliography key/);
});

test('GFM basics: table, strikethrough, task list, autolink', async () => {
  const html = await render(
    '| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~ visit https://example.com\n\n- [x] done\n',
  );
  assert.match(html, /<table>/);
  assert.match(html, /<del>gone<\/del>/);
  assert.match(html, /<a href="https:\/\/example.com">/);
  assert.match(html, /checkbox/);
});

test('table cells with up to four graphemes receive compact wrapping', async () => {
  const html = await render(
    '| A | ID | status | decorated | empty |\n|---|---|---|---|---|\n| B | 状態 | 進行中 | **long text** | |\n',
  );
  assert.match(html, /<th class="pfpdf-table-cell-compact">A<\/th>/);
  assert.match(html, /<th class="pfpdf-table-cell-compact">ID<\/th>/);
  assert.match(html, /<td class="pfpdf-table-cell-compact">状態<\/td>/);
  assert.match(html, /<td class="pfpdf-table-cell-compact">進行中<\/td>/);
  assert.match(html, /<td class="pfpdf-table-cell-min-4"><strong>long text<\/strong><\/td>/);
  assert.match(html, /<td><\/td>/);
});

test('tables with eight or more columns receive a content-agnostic density class', async () => {
  const html = await render(
    '| A | B | C | D | E | F | G | H |\n|---|---|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |\n',
  );
  assert.match(html, /<table class="pfpdf-table-many-columns">/);
});

test('compact table decoration preserves author classes in raw HTML', async () => {
  const html = await render('<table><tr><td class="important">四文字分</td><td class="long">五文字以上</td></tr></table>\n');
  assert.match(html, /<td class="important pfpdf-table-cell-compact">四文字分<\/td>/);
  assert.match(html, /<td class="long pfpdf-table-cell-min-4">五文字以上<\/td>/);
});

test('CJK-friendly strong emphasis', async () => {
  const html = await render(
    'これは**重要**です。\n\nこれは**「強調表示」**の例です。\n\nこれは**重要な点。**続きのテキスト\n\nここは**（重要事項）**です。\n',
  );
  const strongCount = (html.match(/<strong>/g) ?? []).length;
  assert.equal(strongCount, 4, html);
});

test('math is rendered to SVG at build time', async () => {
  const html = await render('inline $E=mc^2$ and\n\n$$\nx^2\n$$\n');
  assert.match(html, /pfpdf-math-inline/);
  assert.match(html, /pfpdf-math-display/);
  assert.match(html, /<svg/);
  assert.match(html, /<path[^>]+d="/);
  assert.doesNotMatch(html, /<use\b/);
  assert.doesNotMatch(html, /(?:xlink:)?href="#MJX-/);
});

test('Mermaid fences become build-time SVG and are not syntax-highlighted', async () => {
  const body = await buildDocumentBody(
    [src('```mermaid\nflowchart LR\n  A[Input] --> B{Ready?}\n```\n')],
    new ResourceManifest(), [], { warn: noop },
  );
  const html = body.sections.map((section) => toHtml(section as never)).join('');
  assert.match(html, /<div class="pfpdf-mermaid"><img src="generated\/mermaid-0001\.svg"/);
  assert.doesNotMatch(html, /<svg/);
  assert.doesNotMatch(html, /<pre>|language-mermaid|hljs/);
  assert.equal(body.generatedFiles.length, 1);
  const svg = body.generatedFiles[0]![1];
  assert.match(svg, /<svg[^>]+id="pfpdf-mermaid-1"/);
  assert.match(svg, /aria-roledescription="flowchart-v2"/);
  assert.match(svg, />Input</);
  assert.match(svg, />Ready\?</);
  const markerId = /<marker id="([^"]+)"/.exec(svg)?.[1];
  assert.ok(markerId);
  assert.match(svg, new RegExp(`marker-end="url\\(#${markerId}\\)"`));
});

test('non-Mermaid code blocks are unaffected', async () => {
  const html = await render('```text\nflowchart LR\n  A --> B\n```\n');
  assert.match(html, /<pre><code class="language-text hljs">/);
  assert.doesNotMatch(html, /pfpdf-mermaid/);
});

test('invalid Mermaid fails with a source location and code 2', async () => {
  await assert.rejects(
    buildDocumentBody([src('```mermaid\nflowchart LR\n  A -- broken\n```\n')], new ResourceManifest(), [], { warn: noop }),
    (error: unknown) => error instanceof InputError
      && error.exitCode === 2
      && /doc\.md:1: Mermaid rendering failed/.test(error.message),
  );
});

test('multiple Mermaid diagram types receive deterministic unique SVG ids', async () => {
  const content = [
    '```mermaid', 'flowchart LR', '  accTitle: Example flowchart',
    '  accDescr: A connects to B', '  A --> B', '```', '',
    '```mermaid', 'sequenceDiagram', '  Alice->>Bob: Hello', '```',
  ].join('\n');
  const build = () => buildDocumentBody([src(content)], new ResourceManifest(), [], { warn: noop });
  const first = await build();
  const second = await build();
  assert.deepEqual(second.generatedFiles, first.generatedFiles);
  assert.match(toHtml(first.sections[0] as never), /alt="Example flowchart — A connects to B"/);
  assert.deepEqual(first.generatedFiles.map(([name]) => name), [
    'generated/mermaid-0001.svg', 'generated/mermaid-0002.svg',
  ]);
  const svgs = first.generatedFiles.map(([, svg]) => svg);
  assert.match(svgs[0]!, /id="pfpdf-mermaid-1"/);
  assert.match(svgs[0]!, /aria-roledescription="flowchart-v2"/);
  assert.match(svgs[1]!, /id="pfpdf-mermaid-2"/);
  assert.match(svgs[1]!, /aria-roledescription="sequence"/);
  for (const svg of svgs) {
    const ids = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
    for (const match of svg.matchAll(/\saria-labelledby="([^"]+)"/g)) {
      for (const reference of match[1]!.split(/\s+/)) assert.ok(ids.has(reference), reference);
    }
  }
});

test('TeX errors fail the build with code 2', async () => {
  await assert.rejects(render('bad $\\frac{$ math\n'), InputError);
});

test('single-line ___ becomes a page break; --- stays a thematic break', async () => {
  const html = await render('a\n\n___\n\nb\n\n---\n\nc\n');
  assert.match(html, /data-pfpdf-page-break/);
  assert.match(html, /<hr>/);
});

test('page-break directive works with CRLF input', async () => {
  const html = await render('a\r\n\r\n___\r\n\r\nb\r\n');
  assert.match(html, /data-pfpdf-page-break/);
});

test('leading/trailing/consecutive page breaks collapse', async () => {
  const html = await render('___\n\na\n\n___\n\n___\n\nb\n\n___\n');
  const breaks = (html.match(/data-pfpdf-page-break/g) ?? []).length;
  assert.equal(breaks, 1, html);
});

test('heading ids are slugified and deduplicated', async () => {
  const body = await buildDocumentBody(
    [src('# Setup\n\n## Setup\n\n## 日本語 見出し\n')],
    new ResourceManifest(),
    [],
    { warn: noop },
  );
  assert.deepEqual(
    body.toc.map((t) => t.id),
    ['setup', 'setup-2', '日本語-見出し'],
  );
});

test('cross-file links rewrite to anchors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-md-'));
  const write = (name: string, content: string): SourceFile => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, content);
    return { path: p, name, content, lineOffset: 0 };
  };
  const a = write('00_a.md', 'see [chapter b](01_b.md) and [detail](01_b.md#detail)\n');
  const b = write('01_b.md', '# Detail\n');
  const body = await buildDocumentBody([a, b], new ResourceManifest(), [], { warn: noop });
  const html = body.sections.map((s) => toHtml(s as never)).join('');
  assert.match(html, /href="#pfpdf-file-0002"/);
  assert.match(html, /href="#detail"/);

  const localOnly = write('02_local.md', '[unresolved local target](#detail)\n');
  const unresolved = await buildDocumentBody([a, b, localOnly], new ResourceManifest(), [], { warn: noop });
  assert.match(toHtml(unresolved.sections[2] as never), /href="#detail"/);
});

test('unresolved navigation links are left to the renderer', async () => {
  const html = await render('[missing](other.md) [fragment](#nope) [file](image-source.txt)\n');
  assert.match(html, /href="other.md"/);
  assert.match(html, /href="#nope"/);
  assert.match(html, /href="image-source.txt"/);
});

test('raw HTML headings keep explicit ids but are not added to the Markdown ToC', async () => {
  const body = await buildDocumentBody(
    [src('# Markdown heading\n\n<h1 id="raw-heading">Raw heading</h1>\n')],
    new ResourceManifest(),
    [],
    { warn: noop },
  );
  assert.deepEqual(body.toc.map((entry) => entry.text), ['Markdown heading']);
  const html = toHtml(body.sections[0] as never);
  assert.match(html, /<h1 id="markdown-heading">Markdown heading<\/h1>/);
  assert.match(html, /<h1 id="raw-heading">Raw heading<\/h1>/);
});

test('local images register in the manifest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-md-'));
  fs.writeFileSync(path.join(dir, 'pic.png'), Buffer.from([0x89, 0x50]));
  const p = path.join(dir, 'doc.md');
  const content = '![alt](pic.png)\n';
  fs.writeFileSync(p, content);
  const manifest = new ResourceManifest();
  const body = await buildDocumentBody(
    [{ path: p, name: 'doc.md', content, lineOffset: 0 }],
    manifest,
    [],
    { warn: noop },
  );
  const html = toHtml(body.sections[0] as never);
  assert.match(html, /src="assets\/0001\/pic.png"/);
  assert.equal(manifest.list().length, 1);
});

test('fetch URLs handle percent encoding, file URLs, srcset, and inline CSS', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-md-'));
  const names = ['space name.png', 'file-url.png', 'style.png', 'sheet.png'];
  for (const name of names) fs.writeFileSync(path.join(dir, name), Buffer.from([1]));
  fs.writeFileSync(path.join(dir, 'nested.css'), '.x { background: url("sheet.png") }');
  const p = path.join(dir, 'doc.md');
  const content = [
    '![space](space%20name.png)',
    `<img src="${pathToFileURL(path.join(dir, 'file-url.png')).href}">`,
    '<img srcset="data:image/png;base64,AAAA 1x, space%20name.png 2x">',
    '<div style="background: url(style.png)"></div>',
    '<style>.y { background-image: url(style.png) }</style>',
    '<link rel="stylesheet" href="nested.css">',
  ].join('\n\n');
  fs.writeFileSync(p, content);
  const manifest = new ResourceManifest();
  const body = await buildDocumentBody(
    [{ path: p, name: 'doc.md', content, lineOffset: 0 }],
    manifest,
    [],
    { warn: noop },
  );
  const html = toHtml(body.sections[0] as never);
  assert.match(html, /space%20name\.png/);
  assert.match(html, /data:image\/png;base64,AAAA 1x, assets\//);
  assert.match(html, /background: url\(&#x22;assets\//);
  assert.equal(body.generatedCss.length, 1);
  assert.match(body.generatedCss[0]![1], /\.\.\/assets\//);
  assert.equal(manifest.list().length, 4);
});

test('invalid fetch URLs fail while trusted embedded documents pass through', async () => {
  await assert.rejects(render('![bad](bad%zz.png)\n'), InputError);
  await assert.rejects(render('<img src="blob:https://example.com/id">\n'), InputError);
  const html = await render('<script type="module">import "./x.js"</script>\n<iframe srcdoc="<p>x</p>"></iframe>\n');
  assert.match(html, /type="module"/);
  assert.match(html, /srcdoc=/);
});

test('encoded Markdown file links resolve by decoded exact file name', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-md-'));
  const write = (name: string, content: string): SourceFile => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, content);
    return { path: p, name, content, lineOffset: 0 };
  };
  const a = write('00_a.md', '[next](01%20b.md#heading)\n');
  const b = write('01 b.md', '# Heading\n');
  const body = await buildDocumentBody([a, b], new ResourceManifest(), [], { warn: noop });
  assert.match(toHtml(body.sections[0] as never), /href="#heading"/);
});

test('trusted raw HTML attributes are preserved', async () => {
  const html = await render('<div data-pfpdf-custom="yes"></div>\n<meta http-equiv="refresh" content="0">\n');
  assert.match(html, /data-pfpdf-custom="yes"/);
  assert.match(html, /http-equiv="refresh"/);
});

test('raw HTML passthrough keeps script and style', async () => {
  const html = await render('<div class="x"><script>1</script></div>\n');
  assert.match(html, /<script>/);
});

test('long visible runs receive word-break opportunities without changing attributes', async () => {
  const destination = 'https://example.com/a%20b?long=query#fragment';
  const html = await render([
    'abcdefghijklmno abcdefghijklmnop abcdefghijklmnopq',
    `[https://example.com/very/long/path?query=value](${destination})`,
    'mailAddress@example.invalid snake_case_identifier_123456 kebab-case-identifier camelCaseIdentifier123456',
    '<span data-long="abcdefghijklmnopq">abcdefgh<strong>ijklmnopq</strong></span>',
  ].join('\n\n'));
  assert.match(html, /abcdefghijklmno /);
  assert.doesNotMatch(html, /abcdefghijklmno<wbr>/);
  assert.match(html, /abcdefghijklmnopq?<wbr>|abcdefgh<wbr>ijklmnop/);
  assert.match(html, /<a href="https:\/\/example\.com\/a%20b\?long=query#fragment">[^<]*<wbr>/);
  assert.match(html, /data-long="abcdefghijklmnopq"/);
  assert.match(html, /<strong>[^<]*<wbr>|<wbr><strong>/);
});

test('word-break decoration leaves CJK prose and preserved raw HTML contexts unchanged', async () => {
  const value = 'abcdefghijklmnopq';
  const html = await render([
    'これは改行候補を追加しない通常の日本語本文です。',
    `<code>${value}</code><kbd>${value}</kbd><samp>${value}</samp>`,
    `<script>const longValue = '${value}'</script>`,
    `<style>.${value} { color: red }</style>`,
    `<textarea>${value}</textarea>`,
    `<svg><text>${value}</text></svg>`,
    `<div contenteditable="true">${value}</div>`,
    '`abcdefghijklmnopq` and $abcdefghijklmnopq$',
  ].join('\n\n'));
  assert.doesNotMatch(html, /日本語[^<]*<wbr>/);
  for (const tag of ['code', 'kbd', 'samp', 'script', 'style', 'textarea', 'svg']) {
    assert.doesNotMatch(html, new RegExp(`<${tag}[^>]*>[^]*?<wbr>`), tag);
  }
  assert.doesNotMatch(html, /contenteditable="true">[^<]*<wbr>/);
  assert.doesNotMatch(html, /pfpdf-math-(?:inline|display)[^>]*>[^]*?<wbr>/);
});

test('word-break decoration runs after heading and ToC text generation', async () => {
  const heading = 'VeryLongHeadingIdentifier123456789';
  const body = await buildDocumentBody([src(`# ${heading}\n\n# ${heading}\n`)], new ResourceManifest(), [], { warn: noop });
  assert.deepEqual(body.toc, [
    { depth: 1, id: heading.toLowerCase(), text: heading },
    { depth: 1, id: `${heading.toLowerCase()}-2`, text: heading },
  ]);
  const html = toHtml(body.sections[0] as never);
  assert.match(html, /<h1[^>]*>[^]*?<wbr>/);
  assert.match(html, new RegExp(`id="${heading.toLowerCase()}"`));
});

test('duplicate explicit ids pass through', async () => {
  const html = await render('<a id="x"></a><span id="x"></span>\n');
  assert.equal((html.match(/id="x"/g) ?? []).length, 2);
});

test('code blocks get highlighted; unknown language warns', async () => {
  const html = await render('```python\nprint(1)\n```\n');
  assert.match(html, /hljs/);
  const warnings: string[] = [];
  await buildDocumentBody(
    [src('```notalanguage\nx\n```\n')],
    new ResourceManifest(),
    [],
    { warn: (m) => warnings.push(m) },
  );
  assert.equal(warnings.length, 1);
});

test('slugify follows the spec', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify('日本語 見出し'), '日本語-見出し');
  assert.equal(slugify('!!!'), 'section');
  assert.equal(slugify('a_b-c'), 'a_b-c');
});
