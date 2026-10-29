import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';
import { BUNDLED_TEMPLATE_NAMES } from '../bundled-templates.js';

const enabled = process.env.RUN_E2E === '1';
const cli = fileURLToPath(new URL('../launcher.js', import.meta.url));
const browser = process.env.BROWSER_PATH ? ['--browser-path', process.env.BROWSER_PATH] : [];
type ParsedHtml = { window: { document: Document; close: () => void } };

function fixture(t: test.TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-title-layout-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

async function convert(input: string, output: string, expected: string, template: string, cover: boolean): Promise<string> {
  const result = spawnSync(process.execPath, [cli, '--input', input, '--output', output,
    '--template', template, '--no-logo', '--no-toc', '--keep-work-dir',
    ...(cover ? [] : ['--no-cover']), ...browser], {
    encoding: 'utf8', timeout: 330_000, shell: false,
    env: { ...process.env, SOURCE_DATE_EPOCH: '0' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  const workspace = /workspace kept at (.+?);/.exec(result.stderr)?.[1];
  assert.ok(workspace, result.stderr);
  try {
    const html = fs.readFileSync(path.join(workspace, 'document.html'), 'utf8');
    const dom = new JSDOM(html) as unknown as ParsedHtml;
    try {
      const doc = dom.window.document;
      assert.equal(doc.title, expected);
      const header = doc.querySelector('body > header');
      if (cover) {
        const coverTitle = header?.querySelector('h1, .pfn-cover-center > strong > span');
        assert.equal(coverTitle?.textContent, expected, template);
        assert.equal(coverTitle?.querySelector('br'), null, 'inferred titles stay on one text line');
      } else { assert.equal(header, null); }
    } finally { dom.window.close(); }
    const bytes = fs.readFileSync(output);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    assert.equal(pdf.getTitle(), expected, template);
    const extracted = spawnSync('pdftotext', [output, '-'], { encoding: 'utf8' });
    if (extracted.error === undefined) {
      assert.equal(extracted.status, 0, extracted.stderr);
      assert.match(extracted.stdout, /BODYMARK/);
    }
    if (process.env.PFPDF_QA_DIR) {
      fs.mkdirSync(process.env.PFPDF_QA_DIR, { recursive: true });
      fs.copyFileSync(output, path.join(process.env.PFPDF_QA_DIR, path.basename(output)));
      fs.writeFileSync(path.join(process.env.PFPDF_QA_DIR, `${path.basename(output, '.pdf')}.html`), html);
    }
    return html;
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}

test('inferred H1 titles reach covers, body headings and PDF metadata in every template', { skip: !enabled }, async (t) => {
  const dir = fixture(t);
  const input = path.join(dir, 'memo.md');
  fs.writeFileSync(input, '# 週次 **報告** `API` &amp; PDF\n\nBODYMARK 日本語の本文です。\n');
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    await t.test(template, async () => {
      const html = await convert(input, path.join(dir, `${template}-title.pdf`), '週次 報告 API & PDF', template, true);
      const dom = new JSDOM(html) as unknown as ParsedHtml;
      try {
        const headings = dom.window.document.querySelectorAll('.pfpdf-source-file h1');
        assert.equal(headings.length, 1);
        assert.equal(headings[0]!.textContent, '週次 報告 API & PDF');
        assert.equal(headings[0]!.querySelector('strong')?.textContent, '報告');
        assert.equal(headings[0]!.querySelector('code')?.textContent, 'API');
      } finally { dom.window.close(); }
    });
  }
});

test('file and directory fallback titles survive coverless PDF conversion', { skip: !enabled }, async (t) => {
  const dir = fixture(t);
  const file = path.join(dir, '日本語 &amp; notes.md');
  fs.writeFileSync(file, 'BODYMARK Heading-free body.\n');
  await convert(file, path.join(dir, 'filename-title.pdf'), '日本語 &amp; notes', 'default', false);
  const collection = path.join(dir, '日本語のノート集');
  fs.mkdirSync(collection);
  fs.writeFileSync(path.join(collection, '00_intro.md'), '## A lower-level heading\n\nBODYMARK Preface.\n');
  fs.writeFileSync(path.join(collection, '01_notes.md'), 'BODYMARK Heading-free notes.\n');
  await convert(collection, path.join(dir, 'directory-title.pdf'), '日本語のノート集', 'default', false);
  fs.writeFileSync(path.join(collection, '01_notes.md'), 'Later Setext heading\n====================\n\nBODYMARK Notes.\n');
  const html = await convert(collection, path.join(dir, 'directory-h1-title.pdf'), 'Later Setext heading', 'default', false);
  const dom = new JSDOM(html) as unknown as ParsedHtml;
  try {
    assert.equal(dom.window.document.querySelector('.pfpdf-source-file h1')?.textContent, 'Later Setext heading');
  } finally { dom.window.close(); }
});
