import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { commitOutput, ensureOutputParent, validateOutputPath } from '../output.js';
import { InputError, RuntimeError } from '../errors.js';
import type { Metadata } from '../input.js';

const metadata: Metadata = {
  title: { lines: ['A & B', '第二行'], plainText: 'A & B\n第二行' },
  author: 'Alice',
  series: null,
  date: '2025-01-01',
  confidential: false,
  pageSize: { css: '210mm 297mm' },
  lang: 'ja',
  dir: 'auto',
};

async function minimalPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage();
  return document.save({ useObjectStreams: false });
}

function pageLessPdf(): Buffer {
  return rawPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [] /Count 0 >>',
  ]);
}

function encryptedPdf(): Buffer {
  return rawPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>',
    '<< /Filter /Standard /V 1 /R 2 /Length 40 /O <0000000000000000000000000000000000000000000000000000000000000000> /U <0000000000000000000000000000000000000000000000000000000000000000> /P -4 >>',
  ], '/Encrypt 4 0 R /ID [<00000000000000000000000000000000><00000000000000000000000000000000>]');
}

function rawPdf(objects: string[], trailerExtra = ''): Buffer {
  let source = '%PDF-1.7\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(source));
    source += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) source += `${String(offset).padStart(10, '0')} 00000 n \n`;
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source, 'latin1');
}

test('output path validation owns input/output identity checks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-output-path-'));
  const input = path.join(dir, 'input.md');
  fs.writeFileSync(input, '# input');
  assert.throws(() => {
    validateOutputPath(input, input);
  }, InputError);
  const alias = path.join(dir, 'alias.pdf');
  fs.symlinkSync(input, alias);
  assert.throws(() => {
    validateOutputPath(alias, input);
  }, InputError);
});

test('output commit validates, adds metadata, and atomically replaces a file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-output-'));
  const rendererOutput = path.join(dir, 'renderer.pdf');
  fs.writeFileSync(rendererOutput, await minimalPdf());
  const finalOutput = path.join(dir, 'final.pdf');
  fs.writeFileSync(finalOutput, 'old');
  const size = await commitOutput({
    rendererOutput,
    finalOutput,
    metadata,
    sourceDateEpoch: 1750000000,
    processStart: new Date(0),
    deadline: Date.now() + 10_000,
    warn: () => {},
  });
  assert.equal(size, fs.statSync(finalOutput).size);
  const result = await PDFDocument.load(fs.readFileSync(finalOutput), { updateMetadata: false });
  assert.equal(result.getTitle(), 'A & B\n第二行');
  assert.equal(result.getAuthor(), 'Alice');
  assert.equal(result.getPageCount(), 1);
  const serialized = fs.readFileSync(finalOutput).toString('utf8');
  assert.match(serialized, /<dc:title>/);
  assert.match(serialized, /A &amp; B/);
  assert.match(serialized, /<rdf:li>ja<\/rdf:li>/);
});

test('invalid renderer output and expired deadline preserve the existing output', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-output-'));
  const rendererOutput = path.join(dir, 'bad.pdf');
  fs.writeFileSync(rendererOutput, '%PDF-1.7\n%%EOF\n');
  const finalOutput = path.join(dir, 'final.pdf');
  fs.writeFileSync(finalOutput, 'old');
  const options = {
    rendererOutput,
    finalOutput,
    metadata,
    sourceDateEpoch: null,
    processStart: new Date(0),
    deadline: Date.now() + 10_000,
    warn: (): void => {},
  };
  await assert.rejects(commitOutput(options), RuntimeError);
  assert.equal(fs.readFileSync(finalOutput, 'utf8'), 'old');

  fs.writeFileSync(rendererOutput, await minimalPdf());
  await assert.rejects(commitOutput({ ...options, deadline: Date.now() - 1 }), RuntimeError);
  assert.equal(fs.readFileSync(finalOutput, 'utf8'), 'old');
});

test('truncated, page-less, and encrypted PDFs are rejected before commit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-output-faults-'));
  const rendererOutput = path.join(dir, 'renderer.pdf');
  const finalOutput = path.join(dir, 'final.pdf');
  const valid = Buffer.from(await minimalPdf());
  const fixtures = [
    ['truncated', valid.subarray(0, valid.length - 24)],
    ['page-less', pageLessPdf()],
    ['encrypted', encryptedPdf()],
  ] as const;
  for (const [name, fixture] of fixtures) {
    fs.writeFileSync(rendererOutput, fixture);
    fs.writeFileSync(finalOutput, 'old');
    await assert.rejects(commitOutput({
      rendererOutput,
      finalOutput,
      metadata,
      sourceDateEpoch: 0,
      processStart: new Date(0),
      deadline: Date.now() + 10_000,
      warn: () => {},
    }), RuntimeError, name);
    assert.equal(fs.readFileSync(finalOutput, 'utf8'), 'old');
  }
});

test('a pre-commit failure preserves the existing output', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-output-'));
  const rendererOutput = path.join(dir, 'renderer.pdf');
  fs.writeFileSync(rendererOutput, await minimalPdf());
  const finalOutput = path.join(dir, 'final.pdf');
  fs.writeFileSync(finalOutput, 'old');
  let called = false;
  await assert.rejects(
    commitOutput({
      rendererOutput,
      finalOutput,
      metadata,
      sourceDateEpoch: 0,
      processStart: new Date(0),
      deadline: Date.now() + 10_000,
      warn: () => {},
      beforeCommit: () => {
        called = true;
        throw new RuntimeError('cleanup failed');
      },
    }),
    /cleanup failed/,
  );
  assert.equal(called, true);
  assert.equal(fs.readFileSync(finalOutput, 'utf8'), 'old');
});

test('a regular file in the output parent path is an input error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-output-'));
  const file = path.join(dir, 'not-a-directory');
  fs.writeFileSync(file, 'x');
  assert.throws(() => {
    ensureOutputParent(path.join(file, 'result.pdf'));
  }, InputError);
});

test('an absent author removes renderer-provided author metadata', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-output-'));
  const renderer = await PDFDocument.create();
  renderer.addPage();
  renderer.setAuthor('renderer author');
  const rendererOutput = path.join(dir, 'renderer.pdf');
  fs.writeFileSync(rendererOutput, await renderer.save({ useObjectStreams: false }));
  const finalOutput = path.join(dir, 'final.pdf');
  await commitOutput({
    rendererOutput,
    finalOutput,
    metadata: { ...metadata, author: null },
    sourceDateEpoch: 0,
    processStart: new Date(0),
    deadline: Date.now() + 10_000,
    warn: () => {},
  });
  const result = await PDFDocument.load(fs.readFileSync(finalOutput), { updateMetadata: false });
  assert.equal(result.getAuthor(), undefined);
});
