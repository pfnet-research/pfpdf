import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUNDLED_TEMPLATE_NAMES } from '../bundled-templates.js';
import { resolveConfig } from '../config.js';
import { buildHtml } from '../build.js';
import { InputError } from '../errors.js';
import { resolveTemplate, resourcePath } from '../template.js';

const log = { warn: (): void => {}, info: (): void => {}, debug: (): void => {} };
const env = { SOURCE_DATE_EPOCH: '1750000000' };

function makeDoc(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-tpl-'));
  const p = path.join(dir, 'doc.md');
  fs.writeFileSync(p, content);
  return p;
}

function config(args: string[]): ReturnType<typeof resolveConfig> {
  return resolveConfig(args, {}, process.cwd());
}

function bundledCss(template: string, file: 'style.css' | 'vivliostyle.css'): string {
  const common = file === 'style.css' ? 'common.css' : 'common-vivliostyle.css';
  return [
    fs.readFileSync(resourcePath('templates', common), 'utf8'),
    fs.readFileSync(resourcePath('templates', template, file), 'utf8'),
  ].join('\n');
}

test('bundled template manifest matches resource directories', () => {
  const directories = fs.readdirSync(resourcePath('templates'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual([...BUNDLED_TEMPLATE_NAMES].sort(), directories);
});

test('bundled templates import the shared structural styles before local rules', () => {
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    const style = fs.readFileSync(resourcePath('templates', template, 'style.css'), 'utf8');
    const pagedStyle = fs.readFileSync(resourcePath('templates', template, 'vivliostyle.css'), 'utf8');
    assert.match(style, /^@import (?:url\()?['"]\.\.\/common\.css['"]\)?;/m, template);
    assert.match(pagedStyle, /^@import ['"]\.\.\/common-vivliostyle\.css['"];/, template);
  }
});

test('shared styles own the bundled-template baseline and expose customization variables', () => {
  const common = fs.readFileSync(resourcePath('templates', 'common.css'), 'utf8');
  const paged = fs.readFileSync(resourcePath('templates', 'common-vivliostyle.css'), 'utf8');
  assert.match(common, /--pfpdf-font-sans:[^;]*Noto Sans Symbols 2[^;]*Noto Emoji/);
  assert.match(common, /--pfpdf-font-serif:[^;]*Noto Naskh Arabic[^;]*Noto Serif Thai/);
  assert.match(common, /--pfpdf-font-code:\s*var\(--pfpdf-font-mono\)/);
  assert.match(common, /p,\s*li,\s*dd\s*\{[^}]*text-align:\s*justify;[^}]*text-justify:\s*inter-character/s);
  assert.match(common, /pre\s*\{[^}]*border-radius:\s*3pt[^}]*line-height:\s*1\.5[^}]*overflow-x:\s*auto[^}]*padding:\s*0\.8em 1em[^}]*text-align:\s*start/s);
  assert.match(common, /pre\s*>\s*code\s*\{[^}]*background:\s*transparent[^}]*display:\s*block[^}]*padding:\s*0[^}]*word-break:\s*normal/s);
  assert.match(common, /:not\(pre\) > code\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*word-break:\s*break-word/s);
  assert.match(common, /\.pfpdf-toc-depth-6\s*\{[^}]*var\(--pfpdf-toc-indent-step\)/s);
  assert.match(paged, /@page\s*\{[^}]*font-family:\s*var\(--pfpdf-font-heading,/s);
  assert.match(paged, /caption,[\s\S]*thead\s*\{[^}]*break-after:\s*avoid/s);

  const academic = fs.readFileSync(resourcePath('templates', 'academic', 'style.css'), 'utf8');
  const compact = fs.readFileSync(resourcePath('templates', 'compact', 'style.css'), 'utf8');
  assert.match(academic, /--pfpdf-font-body:\s*var\(--pfpdf-font-serif\)/);
  assert.match(academic, /--pfpdf-toc-indent-step:\s*1\.1em/);
  assert.match(compact, /--pfpdf-toc-indent-step:\s*1em/);
});

test('bundled font resources use complete Unicode ranges and WOFF2 only', () => {
  const fontsDir = resourcePath('fonts');
  const filesDir = path.join(fontsDir, 'files');
  const scriptSubsets = [
    ['noto-sans-arabic', 'arabic'],
    ['noto-sans-armenian', 'armenian'],
    ['noto-sans-bengali', 'bengali'],
    ['noto-sans-ethiopic', 'ethiopic'],
    ['noto-sans-georgian', 'georgian'],
    ['noto-sans-gujarati', 'gujarati'],
    ['noto-sans-gurmukhi', 'gurmukhi'],
    ['noto-sans-hebrew', 'hebrew'],
    ['noto-sans-kannada', 'kannada'],
    ['noto-sans-khmer', 'khmer'],
    ['noto-sans-kr', 'korean'],
    ['noto-sans-lao', 'lao'],
    ['noto-sans-malayalam', 'malayalam'],
    ['noto-sans-myanmar', 'myanmar'],
    ['noto-sans-sinhala', 'sinhala'],
    ['noto-sans-tamil', 'tamil'],
    ['noto-sans-telugu', 'telugu'],
    ['noto-sans-thai', 'thai'],
    ['noto-naskh-arabic', 'arabic'],
    ['noto-serif-armenian', 'armenian'],
    ['noto-serif-bengali', 'bengali'],
    ['noto-serif-devanagari', 'devanagari'],
    ['noto-serif-ethiopic', 'ethiopic'],
    ['noto-serif-georgian', 'georgian'],
    ['noto-serif-gujarati', 'gujarati'],
    ['noto-serif-gurmukhi', 'gurmukhi'],
    ['noto-serif-hebrew', 'hebrew'],
    ['noto-serif-kannada', 'kannada'],
    ['noto-serif-khmer', 'khmer'],
    ['noto-serif-kr', 'korean'],
    ['noto-serif-lao', 'lao'],
    ['noto-serif-malayalam', 'malayalam'],
    ['noto-serif-myanmar', 'myanmar'],
    ['noto-serif-sinhala', 'sinhala'],
    ['noto-serif-tamil', 'tamil'],
    ['noto-serif-telugu', 'telugu'],
    ['noto-serif-thai', 'thai'],
  ] as const;
  const fontFiles = fs.readdirSync(filesDir);
  assert.ok(fontFiles.length > 0);
  assert.ok(fontFiles.every((name) => name.endsWith('.woff2')));
  const japaneseCss = fs.readFileSync(path.join(fontsDir, 'noto-sans-jp-400.css'), 'utf8');
  assert.match(japaneseCss, /unicode-range:\s*U\+2015(?:,|;)/i);
  assert.doesNotMatch(japaneseCss, /format\(['"]woff['"]\)/);
  const serifCss = fs.readFileSync(path.join(fontsDir, 'noto-serif-400.css'), 'utf8');
  assert.match(serifCss, /font-family:\s*['"]Noto Serif['"]/);
  assert.doesNotMatch(serifCss, /format\(['"]woff['"]\)/);
  for (const [family, subset] of scriptSubsets) {
    for (const weight of [400, 700]) {
      const cssName = `${family}-${subset}-${weight}.css`;
      const css = fs.readFileSync(path.join(fontsDir, cssName), 'utf8');
      assert.match(css, new RegExp(`font-family: ['"]${family
        .split('-')
        .map((part) => part === 'kr' ? 'KR' : part[0]!.toUpperCase() + part.slice(1))
        .join(' ')}['"]`));
      assert.doesNotMatch(css, /format\(['"]woff['"]\)/);
    }
    assert.ok(!fs.existsSync(path.join(fontsDir, `${family}-latin-400.css`)));
  }
});

test('bundled templates expose one series slot and no fixed informational labels', () => {
  const forbidden = /RESEARCH REPORT|PFPDF ACADEMIC SERIES|LONG-FORM EDITION|NOTES & PLANS|TECHNICAL DOCUMENT|\bCONTENTS\b|content:\s*["'](?:目次|Abstract|Keywords|NOTE|TIP|WARNING|DANGER|作成者)/;
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    const dir = resourcePath('templates', template);
    const html = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
    const css = ['style.css', 'vivliostyle.css']
      .map((name) => fs.readFileSync(path.join(dir, name), 'utf8'))
      .join('\n');
    assert.equal((html.match(/data-pfpdf-slot="series"/g) ?? []).length, 1, template);
    assert.doesNotMatch(`${html}\n${css}`, forbidden, template);
  }
});

test('bundled templates use only bundled Noto families before generic fallbacks', () => {
  const hostFamilies = /Hiragino|ヒラギノ|Meiryo|メイリオ|ＭＳ|Andale|Consolas|Courier|Monaco/;
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    const style = bundledCss(template, 'style.css');
    const css = [style, bundledCss(template, 'vivliostyle.css')].join('\n');
    assert.doesNotMatch(css, hostFamilies, template);
    assert.match(style, /["']Noto Sans["']/, template);
    assert.match(style, /Noto Sans Arabic/, template);
    assert.match(style, /Noto Sans KR/, template);
    assert.match(style, /Noto Sans Thai/, template);
    assert.match(style, /Noto Sans Symbols 2/, template);
    assert.match(style, /Noto Emoji/, template);
    for (const match of css.matchAll(/font-family:\s*([^;]+);/g)) {
      const familyList = match[1]!;
      if (familyList.startsWith('var(')) continue;
      assert.match(familyList, /["']Noto Sans["']/, `${template}: ${familyList}`);
      assert.match(familyList, /Noto Sans Symbols 2/, `${template}: ${familyList}`);
      assert.match(familyList, /Noto Emoji/, `${template}: ${familyList}`);
    }
  }
});

test('bundled templates repeat an enabled confidential label on paged content', () => {
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    const dir = resourcePath('templates', template);
    const html = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
    const style = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
    const pagedStyle = fs.readFileSync(path.join(dir, 'vivliostyle.css'), 'utf8');
    assert.equal((html.match(/data-pfpdf-slot="confidential"/g) ?? []).length, 1, template);
    assert.match(style, /string-set:\s*pfpdf-confidential\s+(?:"[^"]*"\s+)?content\(\)/, template);
    assert.match(
      pagedStyle,
      /content:\s*(?:(?:"[^"]*"\s+)?string\(pfpdf-confidential\)|element\(pfn-confidential\))/,
      template,
    );
  }
});

test('pfn paged confidential labels match the cover badge and page-number position', () => {
  const dir = resourcePath('templates', 'pfn');
  const style = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
  const pagedStyle = fs.readFileSync(path.join(dir, 'vivliostyle.css'), 'utf8');
  assert.match(style, /\.pfn-confidential\s*\{[^}]*color:\s*#fff;[^}]*background-color:\s*#c00;[^}]*min-width:\s*7\.5em/s);
  assert.match(style, /body:has\(\.pfn-confidential\) \.pfn-running-confidential\s*\{[^}]*background-color:\s*#c00;[^}]*color:\s*#fff;[^}]*position:\s*running\(pfn-confidential\)/s);
  const pagedBadges = pagedStyle.match(/@bottom-left\s*\{[^}]*content:\s*element\(pfn-confidential\);[^}]*margin-bottom:\s*8mm;[^}]*vertical-align:\s*bottom;/gs);
  assert.equal(pagedBadges?.length, 3);
  // DD-31: CSS keeps a matching fallback for the SVG-owned backdrop.
  const layeredCover = /url\("\.\/cover-art\.svg"\)[^;]*,\s*linear-gradient\(135deg, #111b64 0%, #19438f 52%, #1b75b4 100%\)/;
  for (const sheet of [style, pagedStyle]) assert.match(sheet, layeredCover);
});

test('notebook paged confidential marker is conditional with its label', () => {
  const dir = resourcePath('templates', 'notebook');
  const style = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
  const pagedStyle = fs.readFileSync(path.join(dir, 'vivliostyle.css'), 'utf8');
  assert.match(style, /string-set:\s*pfpdf-confidential\s+"●\s+"\s+content\(\)/);
  assert.match(pagedStyle, /@bottom-left\s*\{[^}]*content:\s*string\(pfpdf-confidential\)/s);
  assert.doesNotMatch(pagedStyle, /@bottom-left\s*\{[^}]*content:\s*"●\s+"/s);
});

test('bundled templates use content-agnostic table cell wrapping', () => {
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    const style = bundledCss(template, 'style.css');
    assert.match(style, /th\s*,\s*td\s*\{[^}]*overflow-wrap:\s*anywhere/s, template);
    assert.match(style, /\.pfpdf-table-cell-compact\s*\{[^}]*white-space:\s*nowrap/s, template);
    assert.doesNotMatch(style, /\.pfpdf-table-cell-compact\s*\{[^}]*width:\s*1%/s, template);
    assert.match(style, /\.pfpdf-table-cell-min-4\s*\{\s*min-width:\s*4em/s, template);
    assert.doesNotMatch(style, /(?:th|td)(?:\[[^\]]+\]|:(?:first|last|nth)-child)[^{]*\{[^}]*white-space:\s*nowrap/s, template);
  }
});

test('bundled templates render task checkboxes without native disabled styling', () => {
  const common = fs.readFileSync(resourcePath('templates', 'common.css'), 'utf8');
  assert.match(common, /li\.task-list-item\s*\{[^}]*list-style:\s*none/s);
  assert.doesNotMatch(common, /ul\.contains-task-list(?:\s*,[^{}]*)?\s*\{[^}]*list-style:\s*none/s);

  for (const template of BUNDLED_TEMPLATE_NAMES) {
    const style = bundledCss(template, 'style.css');
    assert.match(style, /task-list-item > input\[type="checkbox"\],\s*li\.task-list-item > p > input\[type="checkbox"\]\s*\{[^}]*appearance:\s*none[^}]*opacity:\s*1/s, template);
    assert.match(style, /task-list-item > input\[type="checkbox"\]:checked,\s*li\.task-list-item > p > input\[type="checkbox"\]:checked\s*\{[^}]*background-image:\s*url\("data:image\/svg\+xml/s, template);
  }
});

test('deep heading markers distinguish levels in affected templates', () => {
  for (const template of ['academic', 'compact', 'notebook', 'pfn', 'technical']) {
    const style = fs.readFileSync(resourcePath('templates', template, 'style.css'), 'utf8');
    assert.match(style, /h5::before\s*\{[^}]*content:\s*"› "/s, template);
    assert.match(style, /h6::before\s*\{[^}]*content:\s*"– "/s, template);
  }
});

test('bundled templates decorate the localized continuation marker', () => {
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    const pagedStyle = fs.readFileSync(resourcePath('templates', template, 'vivliostyle.css'), 'utf8');
    assert.match(
      pagedStyle,
      /content:\s*string\(pfpdf-toc-continuation,\s*first-except\)/,
      template,
    );
  }
});

test('bundled templates split long highlighted code blocks across pages', () => {
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    const pagedStyle = bundledCss(template, 'vivliostyle.css');
    assert.match(pagedStyle, /pre\s*\{[^}]*break-inside:\s*auto;[^}]*orphans:\s*4;[^}]*widows:\s*4/s, template);
    assert.match(pagedStyle, /pre\s*\{[^}]*overflow:\s*visible/s, template);
    assert.match(pagedStyle, /pre code\.hljs\s*\{[^}]*display:\s*inline/s, template);
    assert.doesNotMatch(pagedStyle, /pre[^{}]*\{[^}]*break-inside:\s*avoid/s, template);
  }
});

test('compact and pfn details use a distinct left-edge treatment', () => {
  const compact = fs.readFileSync(resourcePath('templates', 'compact', 'style.css'), 'utf8');
  const pfn = fs.readFileSync(resourcePath('templates', 'pfn', 'style.css'), 'utf8');
  assert.match(compact, /details\s*\{[^}]*border-left:/s);
  assert.doesNotMatch(compact, /details\s*\{[^}]*(?:border-top|border-bottom):/s);
  assert.match(pfn, /details\s*\{[^}]*background:[^}]*border-left:/s);
});

test('template-specific finishing rules remain intentional', () => {
  const academic = fs.readFileSync(resourcePath('templates', 'academic', 'style.css'), 'utf8');
  const academicPaged = bundledCss('academic', 'vivliostyle.css');
  const book = fs.readFileSync(resourcePath('templates', 'book', 'style.css'), 'utf8');
  const bookEffective = bundledCss('book', 'style.css');
  const bookPaged = fs.readFileSync(resourcePath('templates', 'book', 'vivliostyle.css'), 'utf8');
  const defaultStyle = fs.readFileSync(resourcePath('templates', 'default', 'style.css'), 'utf8');
  const defaultPaged = bundledCss('default', 'vivliostyle.css');
  const notebook = fs.readFileSync(resourcePath('templates', 'notebook', 'style.css'), 'utf8');
  const notebookPaged = fs.readFileSync(resourcePath('templates', 'notebook', 'vivliostyle.css'), 'utf8');
  const pfn = fs.readFileSync(resourcePath('templates', 'pfn', 'style.css'), 'utf8');
  const pfnEffective = bundledCss('pfn', 'style.css');
  const pfnPaged = fs.readFileSync(resourcePath('templates', 'pfn', 'vivliostyle.css'), 'utf8');
  const technical = fs.readFileSync(resourcePath('templates', 'technical', 'style.css'), 'utf8');
  const technicalPaged = fs.readFileSync(resourcePath('templates', 'technical', 'vivliostyle.css'), 'utf8');

  assert.match(academic, /\.academic-cover-head\s*\{[^}]*border-bottom:\s*2\.2pt solid var\(--academic-color-accent\)/s);
  assert.match(academic, /\.academic-cover-head::after\s*\{[^}]*border-bottom:\s*0\.6pt solid var\(--academic-color-accent\)/s);
  assert.match(academic, /\.academic-cover-meta\s*\{[^}]*border-bottom:\s*2\.2pt solid var\(--academic-color-accent\)/s);
  assert.match(academic, /\.academic-cover-meta\s*\{[^}]*margin-top:\s*auto/s);
  assert.match(academic, /\.academic-cover-confidential\s*\{[^}]*align-self:\s*flex-start/s);
  assert.doesNotMatch(academic, /\.pfpdf-toc\s*\{[^}]*border-top:/s);
  assert.match(academicPaged, /@top-center\s*\{[^}]*border-bottom:\s*0\.4pt solid #aeb7bf;[^}]*margin-bottom:\s*5mm;[^}]*padding-bottom:\s*2mm/s);
  assert.match(academicPaged, /\.academic-content \.pfpdf-toc-continuation-reset \+ section > h1\s*\{[^}]*margin-top:\s*0/s);
  assert.match(academicPaged, /pre\s*\{[^}]*break-inside:\s*auto;[^}]*orphans:\s*4;[^}]*widows:\s*4/s);
  assert.match(academicPaged, /pre code\.hljs\s*\{[^}]*display:\s*inline/s);
  assert.match(book, /--pfpdf-font-body:\s*var\(--pfpdf-font-serif\)/);
  assert.match(bookEffective, /--pfpdf-font-serif:[^;]*"Noto Naskh Arabic"[^;]*"Noto Serif KR"[^;]*"Noto Serif Thai"/);
  assert.match(book, /table\s*\{[^}]*font-family:\s*var\(--pfpdf-font-heading\)/s);
  assert.match(book, /\.pfpdf-table-many-columns\s*\{[^}]*font-size:\s*0\.9em/s);
  assert.match(book, /\.book-content h5::before\s*\{[^}]*content:\s*"◆ "/s);
  assert.match(book, /\.book-content h6\s*\{[^}]*padding-left:\s*1\.25em/s);
  assert.match(book, /\.book-content h1::before\s*\{[^}]*padding-top:\s*18mm/s);
  assert.match(book, /\.book-cover-ornament\s*\{[^}]*display:\s*none/s);
  assert.match(book, /\.book-cover-main:has\(\.book-cover-confidential\) \.book-cover-ornament\s*\{[^}]*display:\s*block/s);
  assert.match(bookPaged, /@top-left\s*\{[^}]*border-bottom:\s*0\.4pt solid #b8aea0;[^}]*content:\s*"";[^}]*margin-bottom:\s*5mm;[^}]*padding-bottom:\s*2\.5mm/s);
  assert.match(bookPaged, /@top-right\s*\{[^}]*border-bottom:\s*0\.4pt solid #b8aea0;[^}]*content:\s*string\(pfpdf-toc-continuation,\s*first-except\);[^}]*font-size:\s*7\.5pt;[^}]*letter-spacing:\s*0\.06em;[^}]*margin-bottom:\s*5mm;[^}]*padding-bottom:\s*2\.5mm/s);
  assert.match(bookPaged, /\.book-content \.pfpdf-toc-continuation-reset \+ section > h1::before\s*\{[^}]*padding-top:\s*0/s);
  assert.match(defaultStyle, /\.pfpdf-cover\s*\{[^}]*align-items:\s*flex-start;[^}]*text-align:\s*start/s);
  assert.match(defaultStyle, /--pfpdf-color-accent:\s*#46515c/);
  assert.match(defaultStyle, /\.pfpdf-toc-title\s*\{[^}]*border-bottom:/s);
  assert.match(defaultStyle, /\.pfpdf-content h6\s*\{[^}]*margin:\s*0\.75em 0 0\.25em/s);
  assert.match(defaultPaged, /@top-right\s*\{[^}]*content:\s*string\(pfpdf-toc-continuation,\s*first-except\);[^}]*margin-bottom:\s*5mm;[^}]*padding-bottom:\s*2mm/s);
  assert.match(defaultPaged, /pre\s*\{[^}]*break-inside:\s*auto;[^}]*orphans:\s*4;[^}]*widows:\s*4/s);
  assert.match(defaultPaged, /pre code\.hljs\s*\{[^}]*display:\s*inline/s);
  assert.match(notebook, /thead tr\s*\{[^}]*background:\s*var\(--notebook-color-teal\)/s);
  assert.match(notebook, /\.pfpdf-toc\s*\{[^}]*box-decoration-break:\s*clone;[^}]*-webkit-box-decoration-break:\s*clone/s);
  assert.match(notebook, /blockquote\s*\{[^}]*border-radius:\s*0;/s);
  assert.match(notebook, /--pfpdf-task-indent:\s*1\.3em/);
  assert.match(bundledCss('notebook', 'style.css'), /ul\.contains-task-list\s*\{[^}]*padding-inline-start:\s*var\(--pfpdf-task-indent\)/s);
  assert.doesNotMatch(notebook, /ul\.contains-task-list\s*\{[^}]*(?:background|border-radius):/s);
  assert.match(notebook, /li\.task-list-item\s*\{[^}]*padding-left:\s*1\.35em;[^}]*text-indent:\s*-1\.35em/s);
  assert.match(notebookPaged, /@top-center\s*\{[^}]*content:\s*string\(pfpdf-toc-continuation,\s*first-except\);[^}]*margin-bottom:\s*8mm;[^}]*padding-bottom:\s*2mm/s);
  assert.match(bundledCss('notebook', 'vivliostyle.css'), /h1[\s\S]*h6\s*\{[^}]*break-after:\s*avoid;/s);
  assert.match(notebookPaged, /h1, h2, h3, h4, h5, h6\s*\{[^}]*break-inside:\s*avoid;/s);
  assert.match(pfn, /body>main\s*\{[^}]*overflow-wrap:\s*normal;[^}]*text-align:\s*start;[^}]*word-break:\s*normal/s);
  assert.doesNotMatch(pfn, /text-align:\s*justify/);
  assert.match(pfn, /pre\s*\{[^}]*background:\s*#0d1117;[^}]*color:\s*#c9d1d9/s);
  assert.doesNotMatch(pfn, /pre\s*\{[^}]*(?:border-radius|font-size|line-height|overflow|padding|text-align):/s);
  assert.doesNotMatch(pfn, /pre\s*>\s*code/);
  assert.match(pfnEffective, /pre code\.hljs\s*\{[^}]*padding:\s*0/s);
  assert.match(pfnEffective, /\.pfpdf-toc li\s*\{[^}]*break-inside:\s*avoid/s);
  assert.match(pfn, /\.pfpdf-toc a\s*\{[^}]*column-gap:\s*0\.75em;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) max-content;[^}]*white-space:\s*normal/s);
  assert.match(pfn, /\.pfpdf-toc-label\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*0/s);
  assert.match(pfn, /\.pfpdf-toc-label::after\s*\{[^}]*border-bottom:\s*1\.5px dotted #8b98a6;[^}]*flex:\s*1 0 2em/s);
  assert.match(pfn, /\.pfpdf-toc a::after\s*\{[^}]*content:\s*target-counter\(attr\(href url\), page\);[^}]*font-variant-numeric:\s*tabular-nums/s);
  assert.match(pfn, /article h4\s*\{[^}]*color:\s*#586b9a;[^}]*border-left:\s*3px solid #8190b7/s);
  assert.match(pfnPaged, /@top-left\s*\{[^}]*background-color:\s*#263c7f;[^}]*content:\s*'';[^}]*margin:\s*-3mm -1mm 7mm/s);
  assert.match(pfnPaged, /@top-right\s*\{[^}]*content:\s*string\(pfpdf-toc-continuation,\s*first-except\);[^}]*text-align:\s*right/s);
  assert.match(technical, /\.technical-cover\s*\{[^}]*min-height:\s*297mm/s);
  assert.doesNotMatch(technical, /\.pfpdf-toc\s*\{[^}]*border-top:/s);
  assert.match(technicalPaged, /@counter-style pfpdf-three-digit\s*\{[^}]*system:\s*numeric;[^}]*pad:\s*3 "0"/s);
  assert.match(technicalPaged, /@top-center\s*\{[^}]*border-bottom:\s*0\.5pt solid #aebbc4;[^}]*content:\s*string\(pfpdf-toc-continuation,\s*first-except\);[^}]*margin-bottom:\s*5mm;[^}]*padding-bottom:\s*2mm/s);
  assert.match(technicalPaged, /@bottom-right\s*\{[^}]*counter\(page, pfpdf-three-digit\)[^}]*font-variant-numeric:\s*tabular-nums/s);
  assert.match(technicalPaged, /\.technical-content \.pfpdf-toc-continuation-reset \+ section > h1\s*\{[^}]*margin-top:\s*0/s);
});

test('default template renders title, author, series, date, and content', async () => {
  const input = makeDoc('---\ntitle: My Title\nauthor: Alice\nseries: Example Reports\n---\n\n# Head\n\nbody text\n');
  const { html, generated } = await buildHtml(config(['--input', input, '--output', 'x.pdf']), env, log);
  assert.match(html, /<title>My Title<\/title>/);
  assert.match(html, /Alice/);
  assert.match(html, /Example Reports/);
  assert.doesNotMatch(html, /更新日|Updated/);
  assert.match(html, /body text/);
  assert.match(html, /pfpdf-file-0001/);
  assert.doesNotMatch(html, /data-pfpdf-slot/);
  assert.match(html, /lang="ja"/);
  assert.match(html, /registerReady/);
  assert.match(html, /readiness-gate\.svg/);
  assert.doesNotMatch(html, /readiness-ok|readiness-error/);
  assert.match(generated.get('generated/style.css')!.toString(), /Shared structural rules for bundled templates/);
  assert.match(generated.get('generated/vivliostyle.css')!.toString(), /Shared pagination safeguards/);
  assert.match(generated.get('generated/page.css')!.toString(), /\.pfpdf-mermaid img/);
  assert.doesNotMatch(generated.get('generated/style.css')!.toString(), /@import\s+["']\.\.\/common\.css/);
});

test('academic template renders its research-report structure', async () => {
  const input = makeDoc('---\ntitle: Experimental Results\nauthor: Alice\nseries: Example Reports\nconfidential: true\n---\n\n<div class="abstract">A concise summary.</div>\n\n# Results\n\n$$\nx^2\n$$\n');
  const { html, generated } = await buildHtml(
    config(['--input', input, '--output', 'x.pdf', '--template', 'academic']),
    env,
    log,
  );
  assert.match(html, /academic-cover/);
  assert.match(html, /Example Reports/);
  assert.doesNotMatch(html, /RESEARCH REPORT|PFPDF ACADEMIC SERIES/);
  assert.match(html, /Experimental Results/);
  assert.match(html, /A concise summary/);
  assert.match(html, /pfpdf-math-display/);
  assert.match(html, /Confidential/);
  assert.doesNotMatch(html, /data-pfpdf-slot/);
  assert.match(generated.get('generated/fonts.css')!.toString(), /font-family: 'Noto Serif JP'/);
  assert.match(generated.get('generated/fonts.css')!.toString(), /font-family: 'Noto Serif'/);
  assert.match(generated.get('generated/fonts.css')!.toString(), /font-family: 'Noto Naskh Arabic'/);
  assert.match(generated.get('generated/fonts.css')!.toString(), /font-family: 'Noto Serif KR'/);
  assert.match(generated.get('generated/fonts.css')!.toString(), /font-family: 'Noto Serif Thai'/);
  assert.match(generated.get('generated/fonts.css')!.toString(), /font-family: 'Noto Sans'/);
  assert.match(generated.get('generated/fonts.css')!.toString(), /font-family: 'Noto Sans Arabic'/);
  assert.match(generated.get('generated/fonts.css')!.toString(), /font-family: 'Noto Sans KR'/);
  assert.match(generated.get('generated/fonts.css')!.toString(), /font-family: 'Noto Sans Thai'/);
  assert.match(generated.get('generated/fonts.css')!.toString(), /font-family: 'Noto Sans Symbols 2'/);
  assert.match(generated.get('generated/fonts.css')!.toString(), /font-family: 'Noto Emoji'/);
  assert.match(generated.get('generated/style.css')!.toString(), /--pfpdf-font-body: var\(--pfpdf-font-serif\)/);
});

test('book template renders its long-form document structure', async () => {
  const input = makeDoc('---\ntitle: A Long Journey\nauthor: Alice\nseries: Example Reports\nconfidential: true\n---\n\n# Chapter One\n\nLong-form body text.\n');
  const { html } = await buildHtml(
    config(['--input', input, '--output', 'x.pdf', '--template', 'book']),
    env,
    log,
  );
  assert.match(html, /book-cover/);
  assert.match(html, /Example Reports/);
  assert.doesNotMatch(html, /LONG-FORM EDITION|>PFPDF</);
  assert.match(html, /A Long Journey/);
  assert.match(html, /Chapter One/);
  assert.match(html, /Confidential/);
  assert.doesNotMatch(html, /data-pfpdf-slot/);
});

test('compact template keeps metadata and contents in a space-efficient document header', async () => {
  const input = makeDoc('---\ntitle: Weekly Brief\nauthor: Alice\nseries: Example Reports\nconfidential: true\n---\n\n# Decisions\n\n| Item | Owner |\n|---|---|\n| Release | Alice |\n');
  const { html, generated } = await buildHtml(
    config(['--input', input, '--output', 'x.pdf', '--template', 'compact']),
    env,
    log,
  );
  assert.match(html, /compact-header/);
  assert.match(html, /Example Reports/);
  assert.doesNotMatch(html, />COMPACT</);
  assert.match(html, /Weekly Brief/);
  assert.match(html, /Release/);
  assert.match(html, /Confidential/);
  assert.doesNotMatch(html, /data-pfpdf-slot/);
  assert.match(generated.get('generated/style.css')!.toString(), /column-count: 2/);
  assert.doesNotMatch(generated.get('generated/style.css')!.toString(), /compact-header[^}]*break-after:\s*page/s);
});

test('toc appears by default and disappears with --no-toc', async () => {
  const input = makeDoc('---\ntitle: T\n---\n\n# A\n\n## B\n');
  const on = await buildHtml(config(['--input', input, '--output', 'x.pdf']), env, log);
  assert.match(on.html, /pfpdf-toc/);
  assert.match(on.html, /<h2 class="pfpdf-toc-title">目次<\/h2><span aria-hidden="true" class="pfpdf-toc-continuation-marker">目次（続き）<\/span><ol class="pfpdf-toc-list">/);
  assert.match(on.html, /<a href="#a"><span class="pfpdf-toc-label"><span class="pfpdf-toc-text">A<\/span><\/span><\/a>/);
  assert.match(on.html, /class="pfpdf-toc-continuation-marker pfpdf-toc-continuation-reset"/);
  assert.match(on.generated.get('generated/page.css')!.toString(), /string-set: pfpdf-toc-continuation content\(\)/);
  const off = await buildHtml(config(['--input', input, '--output', 'x.pdf', '--no-toc']), env, log);
  assert.doesNotMatch(off.html, /pfpdf-toc-list/);
  assert.doesNotMatch(off.html, /pfpdf-toc-title/);
});

test('toc title follows the document language', async () => {
  const input = makeDoc('---\ntitle: T\nlang: en-US\n---\n\n# A\n');
  const { html } = await buildHtml(config(['--input', input, '--output', 'x.pdf']), env, log);
  assert.match(html, /<h2 class="pfpdf-toc-title">Contents<\/h2>/);
  assert.match(html, />Contents \(continued\)<\/span>/);
});

test('confidential banner only when true', async () => {
  const yes = makeDoc('---\ntitle: T\nconfidential: true\n---\nbody\n');
  const no = makeDoc('---\ntitle: T\n---\nbody\n');
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    const y = await buildHtml(
      config(['--input', yes, '--output', 'x.pdf', '--template', template]),
      env,
      log,
    );
    assert.match(y.html, /Confidential/, template);
    const n = await buildHtml(
      config(['--input', no, '--output', 'x.pdf', '--template', template]),
      env,
      log,
    );
    assert.doesNotMatch(n.html, /Confidential/, template);
  }
});

test('logo slot: injected when given, removed when not, error without slot', async () => {
  const input = makeDoc('---\ntitle: T\n---\nbody\n');
  const logoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-logo-'));
  const logo = path.join(logoDir, 'logo.png');
  fs.writeFileSync(logo, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const withLogo = await buildHtml(config(['--input', input, '--output', 'x.pdf', '--logo', logo]), env, log);
  assert.match(withLogo.html, /logo\.png/);

  const without = await buildHtml(config(['--input', input, '--output', 'x.pdf']), env, log);
  assert.doesNotMatch(without.html, /pfpdf-cover-logo/);

  // custom template without a logo slot
  const tplDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-ctpl-'));
  fs.writeFileSync(
    path.join(tplDir, 'template.html'),
    '<!doctype html><html><head><meta charset="utf-8"></head><body><main data-pfpdf-slot="content"></main></body></html>',
  );
  fs.writeFileSync(path.join(tplDir, 'style.css'), '');
  fs.writeFileSync(path.join(tplDir, 'vivliostyle.css'), '');
  await assert.rejects(
    buildHtml(
      config(['--input', input, '--output', 'x.pdf', '--template-dir', tplDir, '--logo', logo]),
      env,
      log,
    ),
    InputError,
  );
});

test('custom template slot validation', async () => {
  const input = makeDoc('---\ntitle: T\n---\nbody\n');
  const make = (tpl: string): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-ctpl-'));
    fs.writeFileSync(path.join(d, 'template.html'), tpl);
    fs.writeFileSync(path.join(d, 'style.css'), '');
    fs.writeFileSync(path.join(d, 'vivliostyle.css'), '');
    return d;
  };
  // missing content slot
  await assert.rejects(
    buildHtml(config(['--input', input, '--output', 'x.pdf', '--template-dir', make('<!doctype html><html><head></head><body></body></html>')]), env, log),
    InputError,
  );
  // unknown slot
  await assert.rejects(
    buildHtml(config(['--input', input, '--output', 'x.pdf', '--template-dir', make('<!doctype html><html><head></head><body><div data-pfpdf-slot="bogus"></div><div data-pfpdf-slot="content"></div></body></html>')]), env, log),
    InputError,
  );
  // duplicate slot
  await assert.rejects(
    buildHtml(config(['--input', input, '--output', 'x.pdf', '--template-dir', make('<!doctype html><html><head></head><body><div data-pfpdf-slot="content"></div><div data-pfpdf-slot="content"></div></body></html>')]), env, log),
    InputError,
  );
  // valid minimal template works, toc goes into content head
  const doc = makeDoc('---\ntitle: T\n---\n# A\n');
  const ok = await buildHtml(
    config(['--input', doc, '--output', 'x.pdf', '--template-dir', make('<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><main data-pfpdf-slot="content"></main></body></html>')]),
    env,
    log,
  );
  assert.match(ok.html, /pfpdf-toc/);
  assert.match(ok.html, /lang="ja"/);

  const permissive = await buildHtml(
    config(['--input', input, '--output', 'x.pdf', '--template-dir', make('<html><head></head><body><a id="x" href="#missing">link</a><div id="x" data-pfpdf-custom="1"></div><main data-pfpdf-slot="content"></main></body></html>')]),
    env,
    log,
  );
  assert.match(permissive.html, /href="#missing"/);
  assert.match(permissive.html, /data-pfpdf-custom="1"/);
});

test('prepared template HTML is read and parsed only once per build', async () => {
  const input = makeDoc('---\ntitle: T\n---\nbody\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-prepared-template-'));
  fs.writeFileSync(
    path.join(dir, 'template.html'),
    '<!doctype html><html><head></head><body><main data-pfpdf-slot="content"></main></body></html>',
  );
  fs.writeFileSync(path.join(dir, 'style.css'), '');
  fs.writeFileSync(path.join(dir, 'vivliostyle.css'), '');
  const resolvedConfig = config(['--input', input, '--output', 'x.pdf', '--template-dir', dir]);
  const prepared = resolveTemplate(resolvedConfig.template.value, resolvedConfig.templateDirAbs);
  fs.rmSync(path.join(dir, 'template.html'));
  const result = await buildHtml(resolvedConfig, env, log, prepared);
  assert.match(result.html, /body/);
});

test('title <br> becomes an element, not text', async () => {
  const input = makeDoc('---\ntitle: "Line1<br>Line2"\n---\nbody\n');
  const { html } = await buildHtml(config(['--input', input, '--output', 'x.pdf']), env, log);
  assert.match(html, /<title>Line1 Line2<\/title>/);
  assert.match(html, /Line1<br>Line2/);
});

test('pfn template builds without a logo', async () => {
  const input = makeDoc('---\ntitle: T\nseries: Example Reports\n---\nbody\n');
  const { html } = await buildHtml(config(['--input', input, '--output', 'x.pdf', '--template', 'pfn']), env, log);
  assert.match(html, /body/);
  assert.match(html, /Example Reports/);
});

test('technical template renders its code-first document structure', async () => {
  const input = makeDoc('---\ntitle: API Reference\nauthor: Alice\nseries: Example Reports\nconfidential: true\n---\n\n# Endpoint\n\n```ts\nconst status = 200;\n```\n');
  const { html } = await buildHtml(
    config(['--input', input, '--output', 'x.pdf', '--template', 'technical']),
    env,
    log,
  );
  assert.match(html, /technical-cover/);
  assert.match(html, /Example Reports/);
  assert.doesNotMatch(html, /TECHNICAL DOCUMENT|>TECHNICAL<|>pfpdf</);
  assert.match(html, /API Reference/);
  assert.match(html, /const/);
  assert.match(html, /Confidential/);
  assert.doesNotMatch(html, /data-pfpdf-slot/);
});

test('notebook template renders its friendly document structure', async () => {
  const input = makeDoc('---\ntitle: Weekend Notes\nauthor: Alice\nseries: Example Reports\nconfidential: true\n---\n\n# Schedule\n\n- [ ] Bring a notebook\n');
  const { html } = await buildHtml(
    config(['--input', input, '--output', 'x.pdf', '--template', 'notebook']),
    env,
    log,
  );
  assert.match(html, /notebook-cover/);
  assert.match(html, /Example Reports/);
  assert.doesNotMatch(html, /NOTES &#x26; PLANS/);
  assert.match(html, /Weekend Notes/);
  assert.match(html, /Bring a notebook/);
  assert.match(html, /Confidential/);
  assert.doesNotMatch(html, /data-pfpdf-slot/);
});

test('all bundled templates support optional series without fixed template labels', async () => {
  const withSeries = makeDoc('---\ntitle: T\nseries: User Supplied Series\n---\nbody\n');
  const withoutSeries = makeDoc('---\ntitle: T\n---\nbody\n');
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    const withResult = await buildHtml(
      config(['--input', withSeries, '--output', 'x.pdf', '--template', template]),
      env,
      log,
    );
    assert.match(withResult.html, /User Supplied Series/, template);
    const withoutResult = await buildHtml(
      config(['--input', withoutSeries, '--output', 'x.pdf', '--template', template]),
      env,
      log,
    );
    assert.doesNotMatch(withoutResult.html, /User Supplied Series/, template);
  }
});

test('template asset paths cannot alias document logical asset ids', async () => {
  const inputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-tpl-input-'));
  fs.writeFileSync(path.join(inputDir, 'pic.png'), Buffer.from([1]));
  const input = path.join(inputDir, 'doc.md');
  fs.writeFileSync(input, '---\ntitle: T\n---\n\n![body](pic.png)\n');

  const tplDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-ctpl-'));
  fs.mkdirSync(path.join(tplDir, 'assets', '0013'), { recursive: true });
  const templateAsset = path.join(tplDir, 'assets', '0013', 'pic.png');
  fs.writeFileSync(templateAsset, Buffer.from([2]));
  fs.writeFileSync(
    path.join(tplDir, 'template.html'),
    '<!doctype html><html><head></head><body><img alt="template" src="assets/0013/pic.png"><main data-pfpdf-slot="content"></main></body></html>',
  );
  fs.writeFileSync(path.join(tplDir, 'style.css'), '');
  fs.writeFileSync(path.join(tplDir, 'vivliostyle.css'), '');

  const result = await buildHtml(
    config(['--input', input, '--output', 'x.pdf', '--template-dir', tplDir]),
    env,
    log,
  );
  const pictureEntries = result.manifest.list().filter(([logical]) => logical.endsWith('/pic.png'));
  assert.equal(pictureEntries.length, 2);
  const templateLogical = pictureEntries.find(([, file]) => file === fs.realpathSync(templateAsset))?.[0];
  assert.ok(templateLogical);
  assert.match(result.html, new RegExp(`alt="template" src="${templateLogical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
});
