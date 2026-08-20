/**
 * End-to-end PDF smoke test. Requires a Chromium download on first run, so it
 * only runs when RUN_E2E=1 (see npm run test:e2e).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const enabled = process.env.RUN_E2E === '1';
const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'launcher.js');
const browserArgs = process.env.BROWSER_PATH
  ? ['--browser-path', process.env.BROWSER_PATH]
  : [];

function visibleRowsInPbm(pbm: Buffer, maxYRatio: number): number {
  const firstNewline = pbm.indexOf(0x0a);
  const secondNewline = pbm.indexOf(0x0a, firstNewline + 1);
  assert.equal(pbm.subarray(0, firstNewline).toString('ascii'), 'P4');
  const dimensions = pbm.subarray(firstNewline + 1, secondNewline).toString('ascii').trim().split(/\s+/);
  assert.equal(dimensions.length, 2);
  const width = Number(dimensions[0]);
  const height = Number(dimensions[1]);
  assert.ok(Number.isInteger(width) && Number.isInteger(height));
  const stride = Math.ceil(width / 8);
  const dataOffset = secondNewline + 1;
  assert.ok(pbm.length >= dataOffset + stride * height);

  let occupiedRows = 0;
  const maxY = Math.floor(height * maxYRatio);
  for (let y = 0; y < maxY; y++) {
    let blackPixels = 0;
    const rowStart = dataOffset + y * stride;
    for (let x = 0; x < stride; x++) {
      let value = pbm[rowStart + x]!;
      while (value !== 0) {
        blackPixels += value & 1;
        value >>>= 1;
      }
    }
    if (blackPixels >= 4) occupiedRows++;
  }
  return occupiedRows;
}

test('builds a PDF from Japanese Markdown', { skip: !enabled }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-e2e-'));
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(
    input,
    '---\ntitle: E2E テスト\nauthor: pfpdf\n---\n\n# 日本語見出し\n\n本文です。これは**「重要」**です。αβγ🙂\n\nالعربية · Հայերեն · বাংলা · አማርኛ · ქართული · ગુજરાતી · ਪੰਜਾਬੀ · עברית\n\nಕನ್ನಡ · ខ្មែរ · 한국어 · ລາວ · മലയാളം · မြန်မာ · සිංහල · தமிழ் · తెలుగు · ไทย\n\n$E=mc^2$\n\n___\n\n## 第 2 章\n\n完了。\n',
  );
  const output = path.join(dir, 'doc.pdf');
  const res = spawnSync(
    process.execPath,
    [cliPath, ...browserArgs, '--input', input, '--output', output, '--render-timeout-ms', '600000'],
    { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1750000000' }, timeout: 660000 },
  );
  assert.equal(res.status, 0, res.stderr);
  const bytes = fs.readFileSync(output);
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');

  // If pdftotext is available, confirm text extraction. PDFs printed by
  // Chromium on Windows can expose CJK glyphs as replacement characters to
  // Poppler even when the bundled CJK font is embedded in the PDF.
  // Keep the Japanese extraction assertion on the other supported platforms;
  // the pdffonts checks below cover the Windows CJK font selection.
  const p2t = spawnSync('pdftotext', [output, '-'], { encoding: 'utf8' });
  if (p2t.error === undefined && p2t.status === 0) {
    assert.match(p2t.stdout, /E2E/);
    if (process.platform !== 'win32') assert.match(p2t.stdout, /日本語見出し/);
  }

  // If pdffonts is available, confirm extended Unicode did not select a host font.
  const fonts = spawnSync('pdffonts', [output], { encoding: 'utf8' });
  if (fonts.error === undefined && fonts.status === 0) {
    assert.match(fonts.stdout, /NotoSansJP/);
    assert.match(fonts.stdout, /NotoSans-Regular/);
    for (const family of [
      'NotoSansArabic',
      'NotoSansArmenian',
      'NotoSansBengali',
      'NotoSansEthiopic',
      'NotoSansGeorgian',
      'NotoSansGujarati',
      'NotoSansGurmukhi',
      'NotoSansHebrew',
      'NotoSansKannada',
      'NotoSansKhmer',
      'NotoSansKR',
      'NotoSansLao',
      'NotoSansMalayalam',
      'NotoSansMyanmar',
      'NotoSansSinhala',
      'NotoSansTamil',
      'NotoSansTelugu',
      'NotoSansThai',
    ]) {
      assert.match(fonts.stdout, new RegExp(`${family}(?:Thin|ExtraLight)?-Regular`));
    }
    assert.match(fonts.stdout, /NotoEmoji-Regular/);
    assert.doesNotMatch(
      fonts.stdout,
      /Hiragino|Meiryo|MS.?Gothic|AppleColorEmoji|Segoe|Arial|Liberation|DejaVu|Times|Courier/i,
    );
  }
});

test('book template uses bundled serif fonts for multilingual text', { skip: !enabled }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-e2e-serif-'));
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(
    input,
    '---\ntitle: Serif coverage\n---\n\n# Multilingual\n\nالعربية · Հայերեն · বাংলা · हिन्दी · አማርኛ · ქართული · ગુજરાતી · ਪੰਜਾਬੀ · עברית\n\nಕನ್ನಡ · ខ្មែរ · 한국어 · ລາວ · മലയാളം · မြန်မာ · සිංහල · தமிழ் · తెలుగు · ไทย\n',
  );
  const output = path.join(dir, 'doc.pdf');
  const render = spawnSync(
    process.execPath,
    [cliPath, ...browserArgs, '--input', input, '--output', output, '--template', 'book', '--no-toc', '--render-timeout-ms', '600000'],
    { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1750000000' }, timeout: 660000 },
  );
  assert.equal(render.status, 0, render.stderr);

  const fonts = spawnSync('pdffonts', [output], { encoding: 'utf8' });
  if (fonts.error === undefined && fonts.status === 0) {
    for (const family of [
      'NotoNaskhArabic',
      'NotoSerifArmenian',
      'NotoSerifBengali',
      'NotoSerifDevanagari',
      'NotoSerifEthiopic',
      'NotoSerifGeorgian',
      'NotoSerifGujarati',
      'NotoSerifGurmukhi',
      'NotoSerifHebrew',
      'NotoSerifKannada',
      'NotoSerifKhmer',
      'NotoSerifKR',
      'NotoSerifLao',
      'NotoSerifMalayalam',
      'NotoSerifMyanmar',
      'NotoSerifSinhala',
      'NotoSerifTamil',
      'NotoSerifTelugu',
      'NotoSerifThai',
    ]) {
      assert.match(fonts.stdout, new RegExp(`${family}(?:Thin|ExtraLight)?-Regular`));
    }
    assert.doesNotMatch(
      fonts.stdout,
      /Hiragino|Meiryo|MS.?Gothic|AppleColorEmoji|Segoe|Arial|Liberation|DejaVu|Times|Courier/i,
    );
  }
});

test('rendered math contains visible glyphs, not only rule geometry', { skip: !enabled }, (t) => {
  const probe = spawnSync('pdftoppm', ['-v'], { encoding: 'utf8' });
  if (probe.error !== undefined) {
    t.skip(`pdftoppm is unavailable: ${probe.error.message}`);
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-e2e-math-'));
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(
    input,
    '---\ntitle: Math visibility\n---\n\n$$\n\\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi} + \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$\n',
  );
  const output = path.join(dir, 'doc.pdf');
  const render = spawnSync(
    process.execPath,
    [cliPath, ...browserArgs, '--input', input, '--output', output, '--no-toc', '--render-timeout-ms', '600000'],
    { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1750000000' }, timeout: 660000 },
  );
  assert.equal(render.status, 0, render.stderr);

  const raster = spawnSync(
    'pdftoppm',
    ['-f', '2', '-l', '2', '-r', '144', '-mono', '-singlefile', output],
    { encoding: null, maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(raster.status, 0, raster.stderr?.toString());
  assert.ok(Buffer.isBuffer(raster.stdout));
  assert.ok(visibleRowsInPbm(raster.stdout, 0.75) >= 30, 'rendered formula has too few visible glyph rows');
});

test('renders Mermaid fences to the PDF and rejects invalid diagrams', { skip: !enabled }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-e2e-mermaid-'));
  const input = path.join(dir, 'doc.md');
  const output = path.join(dir, 'valid.pdf');
  fs.writeFileSync(
    input,
    '---\ntitle: Mermaid visibility\n---\n\n```mermaid\nflowchart LR\n  InputNode[Markdown input] --> OutputNode[Rendered diagram]\n```\n',
  );
  const render = spawnSync(
    process.execPath,
    [cliPath, ...browserArgs, '--input', input, '--output', output, '--no-toc', '--render-timeout-ms', '600000'],
    { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1750000000' }, timeout: 660000 },
  );
  assert.equal(render.status, 0, render.stderr);
  assert.equal(fs.readFileSync(output).subarray(0, 5).toString('latin1'), '%PDF-');
  const extracted = spawnSync('pdftotext', [output, '-'], { encoding: 'utf8' });
  if (extracted.error === undefined && extracted.status === 0) {
    assert.match(extracted.stdout, /Markdown input/);
    assert.match(extracted.stdout, /Rendered diagram/);
    assert.doesNotMatch(extracted.stdout, /flowchart LR/);
  }

  fs.writeFileSync(input, '---\ntitle: Invalid Mermaid\n---\n\n```mermaid\nflowchart LR\n  A -- broken\n```\n');
  const invalidOutput = path.join(dir, 'invalid.pdf');
  fs.writeFileSync(invalidOutput, 'EXISTING');
  const invalid = spawnSync(
    process.execPath,
    [cliPath, ...browserArgs, '--input', input, '--output', invalidOutput, '--no-toc', '--render-timeout-ms', '60000'],
    { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1750000000' }, timeout: 70000 },
  );
  assert.equal(invalid.status, 2, invalid.stderr);
  assert.match(invalid.stderr, /doc\.md:\d+: Mermaid rendering failed/);
  assert.equal(fs.readFileSync(invalidOutput, 'utf8'), 'EXISTING');
});

test('builds linked BibTeX citations and bibliography text', { skip: !enabled }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-e2e-bib-'));
  const input = path.join(dir, 'doc.md');
  const bib = path.join(dir, 'references.bib');
  fs.writeFileSync(
    bib,
    '@article{citationjs2019, author={Willighagen, Lars G.}, title={Citation.js bibliography smoke marker}, journal={PeerJ Computer Science}, year={2019}}\n',
  );
  fs.writeFileSync(
    input,
    '---\ntitle: Bibliography E2E\nbibliography: references.bib\n---\n\n# Body\n\nCited work\\cite{citationjs2019}.\n\n# References\n\n\\printbibliography\n',
  );
  const output = path.join(dir, 'doc.pdf');
  const render = spawnSync(
    process.execPath,
    [cliPath, ...browserArgs, '--input', input, '--output', output, '--no-toc', '--render-timeout-ms', '600000'],
    { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1750000000' }, timeout: 660000 },
  );
  assert.equal(render.status, 0, render.stderr);
  const bytes = fs.readFileSync(output);
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  const text = spawnSync('pdftotext', [output, '-'], { encoding: 'utf8' });
  if (text.error === undefined && text.status === 0) {
    assert.match(text.stdout, /Citation\.js bibliography smoke marker/);
    assert.match(text.stdout, /References/);
  }
});

test('BibTeX parse failure preserves an existing output', { skip: !enabled }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-e2e-bib-error-'));
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(path.join(dir, 'broken.bib'), '@article{broken, title={Unclosed}');
  fs.writeFileSync(
    input,
    '---\ntitle: Broken bibliography\nbibliography: broken.bib\n---\n\nCite\\cite{broken}.\n',
  );
  const output = path.join(dir, 'doc.pdf');
  fs.writeFileSync(output, 'EXISTING');
  const result = spawnSync(process.execPath, [cliPath, ...browserArgs, '--input', input, '--output', output], {
    encoding: 'utf8',
    env: { ...process.env, SOURCE_DATE_EPOCH: '1750000000' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid BibTeX/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'EXISTING');
});

test('failed build keeps the existing output and exits non-zero', { skip: !enabled }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-e2e-'));
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(input, '# no title here\n');
  const output = path.join(dir, 'doc.pdf');
  fs.writeFileSync(output, 'EXISTING');
  const res = spawnSync(process.execPath, [cliPath, ...browserArgs, '--input', input, '--output', output], {
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.equal(res.status, 2);
  assert.equal(fs.readFileSync(output, 'utf8'), 'EXISTING');
});

test('registered readiness rejection fails rendering with code 1', { skip: !enabled }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-e2e-readiness-'));
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(
    input,
    '---\ntitle: readiness failure\n---\n\n<script>window.pfpdf.registerReady(Promise.reject(new Error("expected readiness rejection")))</script>\n',
  );
  const output = path.join(dir, 'doc.pdf');
  fs.writeFileSync(output, 'EXISTING');
  const result = spawnSync(
    process.execPath,
    [cliPath, ...browserArgs, '--input', input, '--output', output, '--render-timeout-ms', '60000'],
    { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '0' }, timeout: 70000 },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /expected readiness rejection/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'EXISTING');
});
