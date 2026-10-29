import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import { toHtml } from 'hast-util-to-html';
import { buildDocumentBody } from '../markdown.js';
import { ResourceManifest } from '../resources.js';
import type { SourceFile } from '../input.js';
import { buildHtml } from '../build.js';
import { resolveConfig } from '../config.js';
import { BUNDLED_TEMPLATE_NAMES } from '../bundled-templates.js';

const log = { warn: (): void => {}, info: (): void => {}, debug: (): void => {} };
const fixturePath = new URL('../../src/tests/fixtures/japanese-soft-breaks.json', import.meta.url);
const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Array<{ name: string; markdown: string; gfm: string; ja: string }>;
const source = (content: string): SourceFile => ({ path: '/virtual/doc.md', name: 'doc.md', content, lineOffset: 0 });

class GfmAdapter {
  async render(markdown: string): Promise<string> {
    const parser = unified().use(remarkParse).use(remarkGfm);
    const tree = await unified().use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).run(parser.parse(markdown));
    return toHtml(tree);
  }
}

test('Japanese soft-break fixtures preserve the pinned GFM adapter and non-Japanese output', async () => {
  for (const fixture of fixtures) {
    assert.equal(await new GfmAdapter().render(fixture.markdown), fixture.gfm, fixture.name);
    for (const lang of ['ja', 'ja-JP', 'en', 'zh']) {
      const body = await buildDocumentBody([source(fixture.markdown)], new ResourceManifest(), [], { warn: log.warn, lang });
      const html = toHtml({ type: 'root', children: body.sections[0]!.children } as never);
      assert.equal(html, lang.startsWith('ja') ? fixture.ja : fixture.gfm, `${fixture.name}/${lang}`);
    }
  }
});

test('soft-break joining preserves headings, math, code, attributes, and source positions', async () => {
  const content = '日本語\n見出し\n---\n\n本文\n$日本語$\n続き\n\n```text\n本文\n続き\n```\n\n[本文\n続き](https://example.test/本文)\n';
  const body = await buildDocumentBody([source(content)], new ResourceManifest(), [], { warn: log.warn, lang: 'ja' });
  const baseline = await buildDocumentBody([source(content)], new ResourceManifest(), [], { warn: log.warn, lang: 'en' });
  assert.deepEqual(body.toc, baseline.toc);
  assert.equal(body.toc[0]!.text, '日本語\n見出し');
  const html = toHtml(body.sections[0]! as never);
  assert.match(html, /pfpdf-math-inline/);
  assert.match(html, /<pre><code[^>]*>本文\n続き\n<\/code>/);
  assert.match(html, /<a href="https:\/\/example.test\/%E6%9C%AC%E6%96%87">本文続き<\/a>/);
  const paragraph = body.sections[0]!.children.find((node) => node.type === 'element' && node.tagName === 'p');
  assert.equal(paragraph?.position?.start.line, 5);
});

test('exact renderer HTML joins inferred Japanese prose across all bundled templates', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-soft-breaks-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const input = path.join(dir, 'doc.md');
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    fs.writeFileSync(input, '---\ntitle: Soft breaks\n---\n日本語の本文です。\n次の行も日本語です。\n');
    const built = await buildHtml(resolveConfig(['--input', input, '--output', path.join(dir, 'out.pdf'), '--template', template], dir), { SOURCE_DATE_EPOCH: '0' }, log);
    assert.match(built.html, /<html lang="ja"/);
    assert.equal(built.generated.get('document.html')!.toString(), built.html);
    assert.match(built.html, /<p>日本語の本文です。次の行も日本語です。<\/p>/);
  }
});
