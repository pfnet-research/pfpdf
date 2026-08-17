import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';

const [pdfPath, outputDir] = process.argv.slice(2);
if (pdfPath === undefined || outputDir === undefined || process.argv.length !== 4) {
  throw new Error('usage: node scripts/render-template-preview-images.mjs PDF OUTPUT_DIR');
}

const pdf = await PDFDocument.load(fs.readFileSync(pdfPath));
const pageCount = pdf.getPageCount();
const templateName = path.basename(path.dirname(pdfPath));
const minimumPageCount = templateName === 'compact' ? 4 : 5;
if (pageCount < minimumPageCount) {
  throw new Error(`template preview must have at least ${minimumPageCount} pages, got ${pageCount}: ${pdfPath}`);
}

function extractPageText(page) {
  const result = spawnSync(
    'pdftotext',
    ['-f', String(page), '-l', String(page), pdfPath, '-'],
    { encoding: 'utf8', shell: false },
  );
  if (result.error !== undefined) {
    throw new Error(`Poppler tools are required to inspect template previews: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`pdftotext failed for page ${page}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

if (templateName === 'compact') {
  const firstPageText = extractPageText(1);
  if (
    !firstPageText.includes('pfpdf Template Series')
    || !firstPageText.includes('1. 文字と段落')
    || !firstPageText.includes('6.1.1.1.1.1 見出しレベル 6')
  ) {
    throw new Error(`compact preview must place its series, full-depth contents, and body on page 1: ${pdfPath}`);
  }
} else {
  const firstContentsPage = extractPageText(2);
  const continuedContentsPage = extractPageText(3);
  const firstBodyPage = extractPageText(4);
  if (!firstContentsPage.includes('目次') || !firstContentsPage.includes('1. 文字と段落')) {
    throw new Error(`template preview contents did not start on page 2: ${pdfPath}`);
  }
  if (
    !continuedContentsPage.includes('目次（続き）')
    || !continuedContentsPage.includes('6.1.1.1.1.1 見出しレベル 6')
  ) {
    throw new Error(`template preview contents did not continue onto page 3: ${pdfPath}`);
  }
  if (!firstBodyPage.includes('1. 文字と段落') || firstBodyPage.includes('目次（続き）')) {
    throw new Error(`template preview body did not start cleanly on page 4: ${pdfPath}`);
  }
}

for (let page = 1; page <= pageCount; page++) {
  const text = extractPageText(page);
  const compactText = text.replaceAll(/\s/g, '').toLowerCase();
  if (!compactText.includes('confidential')) {
    throw new Error(`confidential label is missing from ${templateName} page ${page}: ${pdfPath}`);
  }
  if (templateName === 'pfn' && page > 1) {
    if (!text.includes('pfpdf テンプレート確認')) {
      throw new Error(`pfn running header is missing from page ${page}: ${pdfPath}`);
    }
  }
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
const pageNumberWidth = Math.max(2, String(pageCount).length);
for (let page = 1; page <= pageCount; page++) {
  const prefix = path.join(outputDir, `page-${String(page).padStart(pageNumberWidth, '0')}`);
  const result = spawnSync(
    'pdftoppm',
    ['-f', String(page), '-l', String(page), '-r', '120', '-png', '-singlefile', pdfPath, prefix],
    { encoding: 'utf8', shell: false },
  );
  if (result.error !== undefined) {
    throw new Error(`Poppler tools are required to render template preview images: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`pdftoppm failed for page ${page}: ${result.stderr.trim()}`);
  }
}

process.stdout.write(`${pdfPath}: rendered all ${pageCount} pages\n`);
