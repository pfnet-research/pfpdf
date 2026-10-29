import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { buildHtml } from '../build.js';
import { resolveConfig } from '../config.js';
import { InputError } from '../errors.js';
import { inferDocumentTitle } from '../infer-title.js';
import { resolveInput } from '../input.js';

const env = { ...process.env, SOURCE_DATE_EPOCH: '0' };
const noop = (): void => {};
const log = { warn: noop, info: noop, debug: noop };
const cli = fileURLToPath(new URL('../launcher.js', import.meta.url));
type ParsedHtml = { window: { document: Document; close: () => void } };

function directory(t: test.TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-title-inference-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

function document(t: test.TestContext, content: string, name = 'memo.md'): string {
  const input = path.join(directory(t), name);
  fs.writeFileSync(input, content);
  return input;
}

function title(input: string, cliTitle: string | null = null): string {
  return resolveInput(input, cliTitle, env, noop).metadata.title.plainText;
}

test('CLI and the first explicit front matter title precede H1s across all input files', (t) => {
  const dir = directory(t);
  fs.writeFileSync(path.join(dir, '00_heading.md'), '# Earlier Markdown heading\n');
  fs.writeFileSync(path.join(dir, '01_metadata.md'), '---\ntitle: "First &amp; title<br>Second line"\n---\n# Another heading\n');
  fs.writeFileSync(path.join(dir, '02_metadata.md'), '---\ntitle: Later explicit title\n---\n# Last heading\n');
  assert.deepEqual(resolveInput(dir, null, env, noop).metadata.title, {
    lines: ['First & title', 'Second line'], plainText: 'First & title\nSecond line',
  });
  assert.deepEqual(resolveInput(dir, 'CLI &amp; title<br>Tail', env, noop).metadata.title, {
    lines: ['CLI & title', 'Tail'], plainText: 'CLI & title\nTail',
  });
});

test('invalid explicit titles remain errors even when H1s or higher-priority titles exist', (t) => {
  const dir = directory(t);
  const selected = path.join(dir, '00_first.md');
  const shadowed = path.join(dir, '01_second.md');
  for (const invalid of ['false', 'null', '""', '"<b>bad</b>"']) {
    fs.writeFileSync(selected, `---\ntitle: ${invalid}\n---\n# Usable heading\n`);
    fs.writeFileSync(shadowed, '---\ntitle: Later valid title\n---\n# Later heading\n');
    for (const cliTitle of [null, 'CLI title']) {
      assert.throws(() => resolveInput(dir, cliTitle, env, noop),
        (error: unknown) => error instanceof InputError && error.message.includes(selected), invalid);
    }
    fs.writeFileSync(selected, '---\ntitle: Earlier valid title\n---\n# Usable heading\n');
    fs.writeFileSync(shadowed, `---\ntitle: ${invalid}\n---\n# Later heading\n`);
    for (const cliTitle of [null, 'CLI title']) {
      assert.throws(() => resolveInput(dir, cliTitle, env, noop),
        (error: unknown) => error instanceof InputError && error.message.includes(shadowed), invalid);
    }
  }
  const input = document(t, '# Usable heading\n');
  for (const invalid of ['', '<b>bad</b>']) assert.throws(() => title(input, invalid), InputError);
});

test('only top-level Markdown H1s supply inferred titles', (t) => {
  const content = [
    '## Not an H1', '', '> # Quoted H1', '', '- # Listed H1', '',
    '```md', '# Fenced H1', '```', '', '    # Indented code H1', '',
    '<div>', '# Raw HTML block H1', '</div>', '',
    '[^note]:', '    # Footnote definition H1', '',
    '# [^note]', '', '# <script>Hidden</script><style>Hidden</style><template>Hidden</template>', '',
    '# <!-- Comment-only heading -->', '', '#', '', '# Selected H1 ###', '', '# Later H1', '',
  ].join('\n');
  const input = document(t, content);
  const result = resolveInput(input, null, env, noop);
  assert.equal(result.metadata.title.plainText, 'Selected H1');
  assert.equal(result.files[0]!.content, content, 'inferring a title must not remove body headings');
  assert.equal(result.files[0]!.lineOffset, 0);
});

test('the first nonempty H1 follows input byte order and accepts Setext syntax', (t) => {
  const dir = directory(t);
  fs.writeFileSync(path.join(dir, '00_empty.md'), '# <br>\n\n# <!-- Empty -->\n');
  fs.writeFileSync(path.join(dir, '02_setext.md'), 'Setext title\n============\n\n# Later ATX title\n');
  fs.writeFileSync(path.join(dir, '10_later.md'), '# A later file title\n');
  const result = resolveInput(dir, null, env, noop);
  assert.equal(result.metadata.title.plainText, 'Setext title');
  assert.deepEqual(result.files.map((file) => file.name), ['00_empty.md', '02_setext.md', '10_later.md']);
});

test('inferred inline text uses parsed GFM, CJK, code, math and image labels literally', (t) => {
  const input = document(t, '# これは**「重要」**です *emphasis* ~~removed~~ [label](https://example.test/ignored) `<br>&amp;` $\\frac{x}{y}$ ![alt &amp; &lt;br&gt;](image.svg)\n');
  assert.deepEqual(resolveInput(input, null, env, noop).metadata.title, {
    lines: ['これは「重要」です emphasis removed label <br>&amp; \\frac{x}{y} alt & <br>'],
    plainText: 'これは「重要」です emphasis removed label <br>&amp; \\frac{x}{y} alt & <br>',
  });
  const references = document(t, '# [Linked label][link] ![Reference alt][image]\n\n[link]: https://example.test/target\n[image]: image.svg\n');
  assert.equal(title(references), 'Linked label Reference alt');
});

test('HTML fragments omit script, style, template and comments without decoding literal text twice', (t) => {
  const input = document(t, '# <script>throw new Error("not title text")</script><style>.hidden{}</style><template>Hidden title</template><!-- Hidden -->Visible <span>text</span><br>&amp;amp; &lt;br&gt;\n');
  assert.deepEqual(resolveInput(input, null, env, noop).metadata.title, {
    lines: ['Visible text &amp; <br>'], plainText: 'Visible text &amp; <br>',
  });
  const unclosed = document(t, '# <script>Hidden to the end of the heading\n\n# Next usable heading\n');
  assert.equal(title(unclosed), 'Next usable heading');
});

test('multiline Setext text, hard breaks and math become one trimmed line', (t) => {
  const input = document(t, 'Alpha  \r\nBeta $x\r\n+y$\r\n===\r\n');
  assert.deepEqual(resolveInput(input, null, env, noop).metadata.title, {
    lines: ['Alpha Beta x +y'], plainText: 'Alpha Beta x +y',
  });
});

test('filename fallback preserves Japanese names, dotted stems and literal entities', (t) => {
  for (const [name, expected] of [
    ['日本語の資料.md', '日本語の資料'], ['report.v1.md', 'report.v1'],
    ['literal &amp;.md', 'literal &amp;'], ['.md', 'document'],
  ] as const) {
    assert.equal(title(document(t, '## Only an H2\n', name)), expected, name);
  }
  if (process.platform !== 'win32') {
    assert.equal(title(document(t, '', 'literal <br> &amp;.md')), 'literal <br> &amp;');
  }
  assert.deepEqual(inferDocumentTitle([], ''), { lines: ['document'], plainText: 'document' });
  assert.deepEqual(inferDocumentTitle([], ' \r\n\t '), { lines: ['document'], plainText: 'document' });
});

test('directory fallback uses the input directory name even when it contains only one file', (t) => {
  const dir = path.join(directory(t), '日本語のノート集');
  fs.mkdirSync(dir);
  const input = path.join(dir, 'chapter.md');
  fs.writeFileSync(input, '## Only an H2\n');
  assert.equal(title(dir), '日本語のノート集');
  assert.equal(title(input), 'chapter');
  fs.writeFileSync(path.join(dir, 'other.md'), 'Plain body without an H1.\n');
  assert.equal(title(dir), '日本語のノート集');
});

test('fallback text supplies language and generated date only when prose supplies no language', (t) => {
  for (const [name, content, lang, date] of [
    ['日本語の表題.md', '', 'ja', '1970 年 1 月 1 日'],
    ['English title.md', '', 'en', '1970-01-01'],
    ['memo.md', '# `日本語の表題`\n', 'ja', '1970 年 1 月 1 日'],
    ['memo.md', '---\nlang: en\n---\n# `日本語の表題`\n', 'en', '1970-01-01'],
    ['日本語の表題.md', 'English prose takes priority over the inferred filename title.\n', 'en', '1970-01-01'],
  ] as const) {
    const result = resolveInput(document(t, content, name), null, env, noop);
    assert.equal(result.metadata.lang, lang, name + content);
    assert.equal(result.metadata.date, date, name + content);
  }
});

test('the exact renderer HTML preserves literal inferred text and the original formatted body heading', async (t) => {
  const input = document(t, '# **これは重要。** [Link](https://example.test/path) `<br>&amp;` $x_1$ ![Alt &amp; text](pixel.svg)\n');
  fs.writeFileSync(path.join(path.dirname(input), 'pixel.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>');
  const result = await buildHtml(resolveConfig(['--input', input, '--output', path.join(path.dirname(input), 'out.pdf')], path.dirname(input)), env, log);
  assert.equal(result.generated.get('document.html')!.toString('utf8'), result.html);
  // JSDOM's default parsing executes no authored scripts and fetches no resources.
  const dom = new JSDOM(result.html) as unknown as ParsedHtml;
  try {
    const doc = dom.window.document;
    const expected = 'これは重要。 Link <br>&amp; x_1 Alt & text';
    assert.equal(doc.title, expected);
    const cover = doc.querySelector('body > header h1')!;
    assert.equal(cover.textContent, expected);
    assert.equal(cover.querySelector('br'), null, 'literal inline-code <br> must not become a title line break');
    assert.equal(cover.querySelector('script'), null);
    const headings = doc.querySelectorAll('.pfpdf-source-file h1');
    assert.equal(headings.length, 1, 'the inferred heading remains in the body');
    assert.equal(headings[0]!.querySelector('strong')!.textContent, 'これは重要。');
    assert.equal(headings[0]!.querySelector('a')!.getAttribute('href'), 'https://example.test/path');
    assert.equal(headings[0]!.querySelector('code')!.textContent, '<br>&amp;');
    assert.ok(headings[0]!.querySelector('.pfpdf-math-inline'));
    assert.equal(headings[0]!.querySelector('img')!.getAttribute('alt'), 'Alt & text');
  } finally {
    dom.window.close();
  }
});

test('the exact renderer HTML also treats a filename fallback as literal text', async (t) => {
  const name = process.platform === 'win32' ? 'literal &amp;.md' : 'literal <br> &amp;.md';
  const input = document(t, '', name);
  const result = await buildHtml(resolveConfig(['--input', input, '--output', path.join(path.dirname(input), 'out.pdf')], path.dirname(input)), env, log);
  assert.equal(result.generated.get('document.html')!.toString('utf8'), result.html);
  const dom = new JSDOM(result.html) as unknown as ParsedHtml;
  try {
    const expected = name.slice(0, -3);
    assert.equal(dom.window.document.title, expected);
    const cover = dom.window.document.querySelector('body > header h1')!;
    assert.equal(cover.textContent, expected);
    assert.equal(cover.querySelector('br'), null);
  } finally {
    dom.window.close();
  }
});

test('untitled input remains valid in doctor and effective-config JSON without a browser', (t) => {
  const input = document(t, '# Inferred heading\n');
  const call = (args: string[]) => spawnSync(process.execPath, [cli, '--input', input, ...args], {
    encoding: 'utf8', env, timeout: 30_000, shell: false,
  });
  const effective = call(['--print-effective-config']);
  assert.equal(effective.status, 0, effective.stderr);
  assert.equal(effective.stdout.trim().split('\n').length, 1);
  const config = JSON.parse(effective.stdout) as { schemaVersion: number; config: { title: unknown } };
  assert.equal(config.schemaVersion, 5);
  const overridden = call(['--print-effective-config', '--title', 'CLI title']);
  assert.equal(overridden.status, 0, overridden.stderr);
  assert.deepEqual((JSON.parse(overridden.stdout) as { config: { title: unknown } }).config.title, { value: 'CLI title', source: 'cli' });
  const doctor = call(['--doctor', '--browser-path', path.join(path.dirname(input), 'missing-browser')]);
  assert.equal(doctor.status, 1, doctor.stderr);
  assert.equal(doctor.stdout.trim().split('\n').length, 1);
  const checks = (JSON.parse(doctor.stdout) as { checks: Array<{ id: string; status: string }> }).checks;
  assert.equal(checks.find((check) => check.id === 'input')?.status, 'pass');
  assert.equal(checks.filter((check) => check.status === 'fail').length, 1, 'only the intentionally absent browser should fail');
});
