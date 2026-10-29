import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFrontMatterConfig, resolveInput, parsePageSize, validateTitle } from '../input.js';
import { InputError } from '../errors.js';

const noop = (): void => {};

function tmpFile(content: string, name = 'doc.md'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-test-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

test('front matter parses scalars and document configuration', () => {
  const p = tmpFile('---\ntitle: Hello\nauthor: Alice\nseries: Example Reports\ntemplate: pfn\ntoc: false\nlogo: assets/logo.svg\nconfidential: true\n---\n\n# Hi\n');
  const r = resolveInput(p, null, { SOURCE_DATE_EPOCH: '1750000000' }, noop);
  assert.deepEqual(r.metadata.title, { lines: ['Hello'], plainText: 'Hello' });
  assert.deepEqual(r.metadata.author, ['Alice']);
  assert.equal(r.metadata.series, 'Example Reports');
  assert.equal(r.config.template, 'pfn');
  assert.equal(r.config.toc, false);
  assert.deepEqual(r.config.logo, {
    kind: 'local',
    path: 'assets/logo.svg',
    absPath: path.join(path.dirname(p), 'assets', 'logo.svg'),
  });
  assert.deepEqual(readFrontMatterConfig(p), r.config);
  assert.equal(r.metadata.confidential, true);
  assert.match(r.files[0]!.content, /# Hi/);
});

test('front matter template must name a bundled template', () => {
  for (const value of ['false', 'missing']) {
    const p = tmpFile(`---\ntitle: T\ntemplate: ${value}\n---\nbody\n`);
    assert.throws(() => resolveInput(p, null, {}, noop), InputError);
    assert.throws(() => readFrontMatterConfig(p), InputError);
  }
});

test('front matter toc and logo validate types and repository boundaries', () => {
  const disabled = resolveInput(
    tmpFile('---\ntitle: T\ntoc: true\nlogo: false\n---\nbody\n'),
    null,
    { SOURCE_DATE_EPOCH: '0' },
    noop,
  );
  assert.equal(disabled.config.toc, true);
  assert.deepEqual(disabled.config.logo, { kind: 'none' });
  for (const field of ['toc: yes', 'logo: true', 'logo: ""']) {
    assert.throws(
      () => resolveInput(tmpFile(`---\ntitle: T\n${field}\n---\nbody\n`), null, {}, noop),
      InputError,
    );
  }
  assert.throws(
    () => resolveInput(
      tmpFile('---\ntitle: T\nlogo: git::https://example.com/assets.git//logo.svg\n---\n'),
      null,
      {},
      noop,
    ),
    InputError,
  );
});

test('missing title is code 2', () => {
  const p = tmpFile('---\nauthor: A\n---\n\nbody\n');
  assert.throws(() => resolveInput(p, null, {}, noop), InputError);
});

test('--title satisfies the requirement', () => {
  const p = tmpFile('# Hi\n');
  const r = resolveInput(p, 'CLI Title', { SOURCE_DATE_EPOCH: '0' }, noop);
  assert.deepEqual(r.metadata.title, { lines: ['CLI Title'], plainText: 'CLI Title' });
});

test('--title does not hide an invalid front matter title', () => {
  const p = tmpFile('---\ntitle: false\n---\nbody\n');
  assert.throws(() => resolveInput(p, 'CLI Title', {}, noop), InputError);
});

test('unknown front matter keys warn once each and do not affect metadata or configuration', () => {
  const p = tmpFile('---\ntitle: Example\nauthor: Alice\ntags: [documentation, example]\nstatus: draft\npage_szie: A5\nstrictFrontMatter: true\n---\n# Body\n');
  const warnings: string[] = [];
  const result = resolveInput(p, null, { SOURCE_DATE_EPOCH: '0' }, (msg) => warnings.push(msg));
  assert.equal(result.metadata.title.plainText, 'Example');
  assert.deepEqual(result.metadata.author, ['Alice']);
  assert.equal(result.metadata.pageSize.css, '210mm 297mm');
  assert.deepEqual(result.config, { template: null, toc: null, cover: null, logo: null });
  assert.equal(result.files[0]!.content, '# Body\n');
  assert.equal(result.files[0]!.lineOffset, 8);
  assert.deepEqual(warnings, ['tags', 'status', 'page_szie', 'strictFrontMatter'].map(
    (key) => `${p}: unknown front matter key: ${key}; ignored`,
  ));
  const configWarnings: string[] = [];
  assert.deepEqual(readFrontMatterConfig(p, (msg) => configWarnings.push(msg)), result.config);
  assert.deepEqual(configWarnings, warnings);
});

test('strict front matter rejects unknown keys for input and configuration diagnostics', () => {
  const p = tmpFile('---\ntitle: A\nbogus: x\n---\n');
  const options = { strictFrontMatter: true };
  const warnings: string[] = [];
  const warn = (msg: string): void => { warnings.push(msg); };
  assert.throws(
    () => resolveInput(p, null, {}, warn, options),
    { name: 'InputError', exitCode: 2, message: `${p}: unknown front matter key: bogus` },
  );
  assert.throws(() => readFrontMatterConfig(p, warn, options), InputError);
  assert.deepEqual(warnings, []);
  const valid = tmpFile('---\ntitle: A\n---\n');
  assert.equal(resolveInput(valid, null, { SOURCE_DATE_EPOCH: '0' }, noop, options).metadata.title.plainText, 'A');
});

test('duplicate keys and malformed YAML remain errors in both front matter modes', () => {
  for (const strictFrontMatter of [false, true]) {
    for (const yaml of [
      'title: A\ntitle: B',
      'title: A\ntags: a\ntags: b',
      'title: A\ntags: [unclosed',
      '- title: A',
    ]) {
      const p = tmpFile(`---\n${yaml}\n---\n`);
      assert.throws(() => resolveInput(p, null, {}, noop, { strictFrontMatter }), InputError);
      assert.throws(() => readFrontMatterConfig(p, noop, { strictFrontMatter }), InputError);
    }
  }
});

test('known front matter values stay validated in both modes, including CLI overrides', () => {
  for (const strictFrontMatter of [false, true]) {
    for (const yaml of [
      'title: false', 'title: "<b>bad</b>"', 'title: T\nauthor: [false]',
      'title: T\npage_size: B4', 'title: T\nconfidential: yes',
      'title: T\nlang: invalid_tag', 'title: T\ndir: LTR',
      'title: T\ntemplate: missing', 'title: T\ntoc: yes',
      'title: T\nlogo: true', 'title: T\nbibliography: []',
    ]) {
      const p = tmpFile(`---\n${yaml}\n---\n`);
      assert.throws(() => resolveInput(p, 'CLI Title', {}, noop, { strictFrontMatter }), InputError);
    }
  }
});

test('unclosed front matter rejected', () => {
  assert.throws(() => resolveInput(tmpFile('---\ntitle: A\n'), null, {}, noop), InputError);
});

test('metadata fields still require their documented scalar types', () => {
  assert.throws(() => resolveInput(tmpFile('---\ntitle: A\ndir:\n  - a\n---\n'), null, {}, noop), InputError);
  assert.throws(() => resolveInput(tmpFile('---\ntitle: A\nseries: 42\n---\n'), null, {}, noop), InputError);
});

test('directory input sorts by name and strips later front matter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-test-'));
  fs.writeFileSync(path.join(dir, '01_b.md'), '# B\n');
  fs.writeFileSync(path.join(dir, '00_a.md'), '---\ntitle: T\n---\n# A\n');
  const r = resolveInput(dir, null, { SOURCE_DATE_EPOCH: '0' }, noop);
  assert.deepEqual(r.files.map((f) => f.name), ['00_a.md', '01_b.md']);

  fs.writeFileSync(path.join(dir, '02_c.md'), '---\ntitle: X\n---\n# C\n');
  const combined = resolveInput(dir, null, { SOURCE_DATE_EPOCH: '0' }, noop);
  assert.equal(combined.metadata.title.plainText, 'T');
  assert.equal(combined.files[2]!.content, '# C\n');
  assert.equal(combined.files[2]!.lineOffset, 3);
});

test('bibliography paths resolve from the front matter Markdown directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-test-'));
  fs.mkdirSync(path.join(dir, 'bib'));
  fs.writeFileSync(path.join(dir, 'bib', 'a.bib'), '@book{a,title={A}}\n');
  fs.writeFileSync(path.join(dir, 'b.bib'), '@book{b,title={B}}\n');
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(input, [
    '---',
    'title: T',
    'bibliography:',
    '  - bib/a.bib',
    '  - b.bib',
    '---',
    'body',
  ].join('\n'));
  const resolved = resolveInput(input, null, { SOURCE_DATE_EPOCH: '0' }, noop);
  assert.deepEqual(resolved.bibliography.map((file) => file.path), [
    path.join(dir, 'bib', 'a.bib'),
    path.join(dir, 'b.bib'),
  ]);
  assert.equal(resolved.bibliography[0]!.declaredPath, 'bib/a.bib');
  assert.match(resolved.bibliography[0]!.content, /@book/);
});

test('bibliography front matter validates type, path, extension, and UTF-8', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-test-'));
  const input = (value: string): string => {
    const file = path.join(dir, `doc-${Math.random()}.md`);
    fs.writeFileSync(file, `---\ntitle: T\nbibliography: ${value}\n---\nbody\n`);
    return file;
  };
  assert.throws(() => resolveInput(input('[]'), null, {}, noop), InputError);
  assert.throws(() => resolveInput(input('42'), null, {}, noop), InputError);
  assert.throws(() => resolveInput(input('missing.bib'), null, {}, noop), InputError);
  fs.writeFileSync(path.join(dir, 'wrong.txt'), 'x');
  assert.throws(() => resolveInput(input('wrong.txt'), null, {}, noop), InputError);
  fs.mkdirSync(path.join(dir, 'directory.bib'));
  assert.throws(() => resolveInput(input('directory.bib'), null, {}, noop), InputError);
  fs.writeFileSync(path.join(dir, 'bad.bib'), Buffer.from([0xff, 0xfe]));
  assert.throws(() => resolveInput(input('bad.bib'), null, {}, noop), InputError);
});

test('non-.md single file rejected', () => {
  const p = tmpFile('# Hi\n', 'doc.markdown');
  assert.throws(() => resolveInput(p, 'T', {}, noop), InputError);
});

test('invalid UTF-8 rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-test-'));
  const p = path.join(dir, 'bad.md');
  fs.writeFileSync(p, Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]));
  assert.throws(() => resolveInput(p, 'T', {}, noop), InputError);
});

test('page_size keywords and dimensions', () => {
  assert.equal(parsePageSize('A4').css, '210mm 297mm');
  assert.equal(parsePageSize('letter').css, '8.5in 11in');
  assert.equal(parsePageSize('182mm 257mm').css, '182mm 257mm');
  assert.equal(parsePageSize('0.001mm 2001mm').css, '0.001mm 2001mm');
  assert.throws(() => parsePageSize('B4'), InputError);
  assert.throws(() => parsePageSize('0mm 297mm'), InputError);
  assert.throws(() => parsePageSize('-10mm 20mm'), InputError);
  assert.throws(() => parsePageSize('1e3mm 20mm'), InputError);
});

test('title validation permits only <br>', () => {
  validateTitle('Plain title');
  validateTitle('Line 1<br>Line 2');
  validateTitle('x < y');
  assert.throws(() => {
    validateTitle('<b>bold</b>');
  }, InputError);
  assert.throws(() => {
    validateTitle('');
  }, InputError);
  assert.throws(() => {
    validateTitle('line 1\nline 2');
  }, InputError);
});

test('title normalization decodes entities and preserves display lines once', () => {
  const input = tmpFile('---\ntitle: A &amp; B<br>第二行<br><br>end\n---\n');
  const result = resolveInput(input, null, { SOURCE_DATE_EPOCH: '0' }, noop);
  assert.deepEqual(result.metadata.title, {
    lines: ['A & B', '第二行', '', 'end'],
    plainText: 'A & B\n第二行\n\nend',
  });
});

test('SOURCE_DATE_EPOCH controls the display date', () => {
  const p = tmpFile('---\ntitle: T\nlang: ja\n---\nbody\n');
  const r = resolveInput(p, null, { SOURCE_DATE_EPOCH: '1750000000' }, noop);
  assert.equal(r.metadata.date, '2025 年 6 月 15 日');
});

test('invalid SOURCE_DATE_EPOCH is an error', () => {
  const p = tmpFile('---\ntitle: T\n---\nbody\n');
  assert.throws(() => resolveInput(p, null, { SOURCE_DATE_EPOCH: 'soon' }, noop), InputError);
  assert.throws(() => resolveInput(p, null, { SOURCE_DATE_EPOCH: '8640000000001' }, noop), InputError);
});

test('front matter follows scalar types and preserves body line endings', () => {
  const numeric = tmpFile('---\ntitle: 123\n---\nbody\n');
  assert.throws(() => resolveInput(numeric, null, {}, noop), InputError);

  const p = tmpFile("---\r\ntitle: 'It''s fine' # comment\r\n---\r\n# Body\r\n");
  const r = resolveInput(p, null, { SOURCE_DATE_EPOCH: '0' }, noop);
  assert.deepEqual(r.metadata.title, { lines: ["It's fine"], plainText: "It's fine" });
  assert.equal(r.files[0]!.content, '# Body\r\n');
  const escaped = resolveInput(
    tmpFile('---\ntitle: "A\\x20B"\n---\n'),
    null,
    { SOURCE_DATE_EPOCH: '0' },
    noop,
  );
  assert.deepEqual(escaped.metadata.title, { lines: ['A B'], plainText: 'A B' });
  assert.throws(() => resolveInput(tmpFile('---\ntitle: a: b\n---\n'), null, {}, noop), InputError);
});

test('lang canonicalization and dir validation', () => {
  const p = tmpFile('---\ntitle: T\nlang: EN-us\ndir: ltr\n---\nbody\n');
  const r = resolveInput(p, null, { SOURCE_DATE_EPOCH: '0' }, noop);
  assert.equal(r.metadata.lang, 'en-US');
  assert.equal(r.metadata.dir, 'ltr');
  assert.throws(
    () => resolveInput(tmpFile('---\ntitle: T\ndir: LTR\n---\n'), null, {}, noop),
    InputError,
  );
  const extension = resolveInput(
    tmpFile('---\ntitle: T\nlang: zh-Hant-TW-u-ca-chinese-x-test\n---\n'),
    null,
    { SOURCE_DATE_EPOCH: '0' },
    noop,
  );
  assert.equal(extension.metadata.lang, 'zh-Hant-TW-u-ca-chinese-x-test');
  assert.equal(
    resolveInput(
      tmpFile('---\ntitle: T\nlang: iw-IL\n---\n'),
      null,
      { SOURCE_DATE_EPOCH: '0' },
      noop,
    ).metadata.lang,
    'he-IL',
  );
  for (const invalid of ['en-a', 'en-u-ca-u-nu-latn', 'en-abcde-ABCDE', 'x']) {
    assert.throws(
      () => resolveInput(tmpFile(`---\ntitle: T\nlang: ${invalid}\n---\n`), null, {}, noop),
      InputError,
    );
  }
});

test('author strings and lists normalize to ordered literal names', () => {
  for (const [yaml, expected] of [
    ['author: Alice', ['Alice']],
    ['author: "Smith, Alice"', ['Smith, Alice']],
    ['author: [Alice, 山田 太郎, "Research & Development"]', ['Alice', '山田 太郎', 'Research & Development']],
    ['author: |\n  Alice\n  Example Institute\n', ['Alice\nExample Institute']],
    ['author: "Alice<br>Bob &amp; Carol"', ['Alice<br>Bob &amp; Carol']],
    ['author: ["  Alice  ", "Bob\\r\\nExample Institute"]', ['Alice', 'Bob\nExample Institute']],
  ] as const) {
    const input = tmpFile(`---\ntitle: T\n${yaml}\n---\nbody\n`);
    assert.deepEqual(resolveInput(input, null, { SOURCE_DATE_EPOCH: '0' }, noop).metadata.author, expected);
  }
});

test('empty author strings and lists omit the byline while invalid entries remain input errors', () => {
  for (const yaml of ['', 'author: ""', 'author: "  "', 'author: []']) {
    const input = tmpFile(`---\ntitle: T\n${yaml}\n---\nbody\n`);
    assert.equal(resolveInput(input, null, { SOURCE_DATE_EPOCH: '0' }, noop).metadata.author, null);
  }
  for (const value of ['null', 'false', '42', '{}', '[Alice, null]', '[42]', '[{}]', '[[]]', '[""]', '["  "]']) {
    const input = tmpFile(`---\ntitle: T\nauthor: ${value}\n---\nbody\n`);
    assert.throws(() => resolveInput(input, null, {}, noop), { name: 'InputError', exitCode: 2 });
  }
});
