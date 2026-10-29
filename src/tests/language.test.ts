import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inferDocumentLanguage } from '../language.js';
import { resolveInput, type SourceFile } from '../input.js';

const file = (content: string): SourceFile => ({ path: '/virtual/doc.md', name: 'doc.md', content, lineOffset: 0 });

test('omitted language classifies prose as Japanese or English', () => {
  for (const [content, expected] of [
    ['これは日本語の文書です。API と TypeScript を説明します。', 'ja'],
    ['# Overview\n\nThis is an English report.', 'en'],
    ['漢字資料', 'ja'], ['カタカナ', 'ja'], ['あ', 'ja'],
    ['English prose with one Japanese name 山田太郎.', 'en'],
    ['English prose '.repeat(100) + 'A Japanese example: これは例です。', 'en'],
    ['これは本文です。\n\n```ts\n' + 'const longIdentifier = 0;\n'.repeat(100) + '```', 'ja'],
    ['English body.\n\n```text\n' + 'これは日本語です。'.repeat(100) + '\n```', 'en'],
    ['English body with `これは例です` and $これは数式です$.', 'en'],
    ['English body.\n\n<div>これは例です。これは例です。</div>', 'en'],
    ['これは本文です。https://example.com/' + 'long-url/'.repeat(100), 'ja'],
    ['[これは本文です](https://example.com/' + 'long-url/'.repeat(100) + ')', 'ja'],
    ['English body[^n].\n\n[^n]: An English note.', 'en'],
    ['123 !?', 'en'], ['', 'en'],
  ] as const) {
    assert.equal(inferDocumentLanguage([file(content)], 'Title'), expected, content);
  }
  assert.equal(inferDocumentLanguage([file('')], '日本語の表題'), 'ja');
  assert.equal(inferDocumentLanguage([file('English body')], '日本語の表題'), 'en');
  assert.equal(inferDocumentLanguage([file('# Intro'), file('これは本文です。'.repeat(30))], 'Title'), 'ja');
});

test('input resolution uses inferred language for dates and explicit BCP 47 tags always win', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-language-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const input = path.join(dir, 'doc.md');
  for (const [lang, body, expected, date] of [
    ['', 'English report.', 'en', '1970-01-01'],
    ['', 'これは日本語の本文です。', 'ja', '1970 年 1 月 1 日'],
    ['lang: EN-us\n', 'これは日本語の本文です。', 'en-US', '1970-01-01'],
    ['lang: JA-jp\n', 'English report.', 'ja-JP', '1970 年 1 月 1 日'],
    ['lang: fr\n', 'これは日本語の本文です。', 'fr', '1970-01-01'],
  ]) {
    fs.writeFileSync(input, `---\ntitle: Title\nauthor: 日本語の著者\n${lang}---\n${body}`);
    const result = resolveInput(input, null, { SOURCE_DATE_EPOCH: '0', LANG: 'de_DE' }, () => {});
    assert.equal(result.metadata.lang, expected);
    assert.equal(result.metadata.date, date);
  }
});
