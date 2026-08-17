/** OutputCommitter: PDF structural validation, metadata, atomic commit. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { InputError, RuntimeError } from './errors.js';
import type { Metadata } from './input.js';

export interface CommitOptions {
  rendererOutput: string;
  finalOutput: string;
  metadata: Metadata;
  /** Unix seconds from SOURCE_DATE_EPOCH, or null for the process start instant. */
  sourceDateEpoch: number | null;
  processStart: Date;
  /** Absolute renderer-phase deadline in milliseconds since Unix epoch. */
  deadline: number;
  warn: (msg: string) => void;
  /** Last fallible work before the atomic rename (for example workspace cleanup). */
  beforeCommit?: () => void;
}

export function validateOutputPath(outputAbs: string, inputAbs: string): void {
  if (!/\.pdf$/i.test(outputAbs)) {
    throw new InputError(`output must have a .pdf extension: ${outputAbs}`);
  }
  let inputReal: string | null = null;
  try {
    inputReal = fs.realpathSync(inputAbs);
  } catch {
    inputReal = null;
  }
  let outSt: fs.Stats | null = null;
  try {
    outSt = fs.lstatSync(outputAbs);
  } catch {
    outSt = null;
  }
  if (outSt !== null && !outSt.isFile() && !outSt.isSymbolicLink()) {
    throw new InputError(`existing output is neither a regular file nor a symlink: ${outputAbs}`);
  }
  if (inputReal !== null) {
    let outputReal: string | null = null;
    try {
      outputReal = fs.realpathSync(outputAbs);
    } catch {
      outputReal = null;
    }
    if (outputReal !== null && outputReal === inputReal) {
      throw new InputError('output must not overwrite the input');
    }
  }
}

export function ensureOutputParent(outputAbs: string): void {
  const parent = path.dirname(outputAbs);
  let st: fs.Stats | null = null;
  try {
    st = fs.statSync(parent);
  } catch {
    st = null;
  }
  if (st === null) {
    try {
      fs.mkdirSync(parent, { recursive: true });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOTDIR' || code === 'EEXIST') {
        throw new InputError(`output parent is not a directory: ${parent}`);
      }
      throw new RuntimeError(`cannot create output directory ${parent}: ${(e as Error).message}`);
    }
    return;
  }
  if (!st.isDirectory()) {
    throw new InputError(`output parent is not a directory: ${parent}`);
  }
}

function checkHeaderTrailer(tmpPath: string): void {
  const fd = fs.openSync(tmpPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(Math.min(16, size));
    fs.readSync(fd, head, 0, head.length, 0);
    const headStr = head.toString('latin1');
    if (!headStr.startsWith('%PDF-1.') && !headStr.startsWith('%PDF-2.')) {
      throw new RuntimeError('renderer output does not start with a PDF header');
    }
    const tailLen = Math.min(1024, size);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    const tailStr = tail.toString('latin1');
    const idx = tailStr.lastIndexOf('%%EOF');
    if (idx < 0) throw new RuntimeError('renderer output has no %%EOF trailer');
    const after = tailStr.slice(idx + 5);
    if (!/^[\r\n \t]*$/.test(after)) {
      throw new RuntimeError('unexpected bytes after the final %%EOF marker');
    }
  } finally {
    fs.closeSync(fd);
  }
}

async function structuralCheckAndPostprocess(tmpPath: string, opts: CommitOptions): Promise<void> {
  assertBeforeDeadline(opts.deadline);
  checkHeaderTrailer(tmpPath);
  const bytes = fs.readFileSync(tmpPath);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch (e) {
    throw new RuntimeError(`PDF structural check failed: ${(e as Error).message}`);
  }
  assertBeforeDeadline(opts.deadline);
  if (doc.isEncrypted) throw new RuntimeError('renderer output is encrypted');
  const pages = doc.getPageCount();
  if (pages < 1) throw new RuntimeError('renderer output has no pages');

  // Metadata: title from the plain-text title, author verbatim, /Lang, timestamps.
  const plainTitle = opts.metadata.title.plainText;
  doc.setTitle(plainTitle);
  if (opts.metadata.author !== null) {
    doc.setAuthor(opts.metadata.author);
  } else if (doc.context.trailerInfo.Info !== undefined) {
    const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
    info.delete(PDFName.of('Author'));
  }
  const ts = opts.sourceDateEpoch !== null ? new Date(opts.sourceDateEpoch * 1000) : opts.processStart;
  doc.setCreationDate(ts);
  doc.setModificationDate(ts);
  doc.setProducer('pfpdf');
  doc.catalog.set(PDFName.of('Lang'), PDFString.of(opts.metadata.lang));
  const xmp = buildXmpMetadata({
    title: plainTitle,
    author: opts.metadata.author,
    lang: opts.metadata.lang,
    timestamp: ts,
  });
  const metadataStream = doc.context.stream(Buffer.from(xmp, 'utf8'), {
    Type: 'Metadata',
    Subtype: 'XML',
  });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(metadataStream));

  const updated = await doc.save({ useObjectStreams: false });
  assertBeforeDeadline(opts.deadline);
  fs.writeFileSync(tmpPath, updated);

  // Re-verify the final byte stream after the rewrite.
  try {
    const redoc = await PDFDocument.load(fs.readFileSync(tmpPath), { updateMetadata: false });
    if (redoc.getPageCount() < 1) throw new Error('no pages');
  } catch (e) {
    throw new RuntimeError(`post-processed PDF failed structural re-check: ${(e as Error).message}`);
  }
}

function buildXmpMetadata(options: {
  title: string;
  author: string | null;
  lang: string;
  timestamp: Date;
}): string {
  const title = xmlEscape(options.title);
  const lang = xmlEscape(options.lang);
  const timestamp = options.timestamp.toISOString();
  const creator = options.author === null
    ? ''
    : `<dc:creator><rdf:Seq><rdf:li>${xmlEscape(options.author)}</rdf:li></rdf:Seq></dc:creator>`;
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>
${creator}<dc:language><rdf:Bag><rdf:li>${lang}</rdf:li></rdf:Bag></dc:language>
<xmp:CreateDate>${timestamp}</xmp:CreateDate><xmp:ModifyDate>${timestamp}</xmp:ModifyDate>
<xmp:CreatorTool>pfpdf</xmp:CreatorTool><pdf:Producer>pfpdf</pdf:Producer>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function assertBeforeDeadline(deadline: number): void {
  if (Date.now() > deadline) throw new RuntimeError('render deadline exceeded during PDF validation');
}

export async function commitOutput(opts: CommitOptions): Promise<number> {
  const dir = path.dirname(opts.finalOutput);
  const tmpName = `.pfpdf-${crypto.randomBytes(8).toString('hex')}.tmp`;
  const tmpPath = path.join(dir, tmpName);
  try {
    fs.copyFileSync(opts.rendererOutput, tmpPath, fs.constants.COPYFILE_EXCL);
  } catch (e) {
    throw new RuntimeError(`cannot copy renderer output to temporary output in ${dir}: ${(e as Error).message}`);
  }
  try {
    // Windows requires a writable handle for FlushFileBuffers/fsync.
    const copiedFd = fs.openSync(tmpPath, 'r+');
    try {
      fs.fsyncSync(copiedFd);
    } finally {
      fs.closeSync(copiedFd);
    }

    await structuralCheckAndPostprocess(tmpPath, opts);
    assertBeforeDeadline(opts.deadline);

    // Inherit the mode of an existing regular file; otherwise 0666 & ~umask.
    let mode: number | null = null;
    try {
      const existing = fs.lstatSync(opts.finalOutput);
      if (existing.isFile()) mode = existing.mode & 0o7777;
    } catch {
      mode = null;
    }
    if (mode === null) {
      // Node provides no read-only umask API; this CLI does not mutate it or run worker threads.
      // oxlint-disable-next-line typescript/no-deprecated -- process.umask() is safe in this context.
      const umask = process.umask();
      mode = 0o666 & ~umask;
    }
    const finalFd = fs.openSync(tmpPath, 'r+');
    try {
      fs.chmodSync(tmpPath, mode);
      fs.fsyncSync(finalFd);
    } finally {
      fs.closeSync(finalFd);
    }
    const size = fs.statSync(tmpPath).size;
    opts.beforeCommit?.();
    assertBeforeDeadline(opts.deadline);
    fs.renameSync(tmpPath, opts.finalOutput);
    // Best-effort directory flush on POSIX.
    if (process.platform !== 'win32') {
      try {
        const dirFd = fs.openSync(dir, 'r');
        try {
          fs.fsyncSync(dirFd);
        } finally {
          fs.closeSync(dirFd);
        }
      } catch {
        opts.warn('output committed but the directory entry could not be flushed to disk');
      }
    }
    return size;
  } catch (e) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // keep going; the temp file has an unpredictable name
    }
    if (e instanceof InputError || e instanceof RuntimeError) throw e;
    throw new RuntimeError(`cannot commit output ${opts.finalOutput}: ${(e as Error).message}`);
  }
}
