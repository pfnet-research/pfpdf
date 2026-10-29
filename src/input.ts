/** InputResolver: input file discovery, UTF-8 validation, front matter. */
import fs from 'node:fs';
import path from 'node:path';
import { fromHtml } from 'hast-util-from-html';
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml';
import { BUNDLED_TEMPLATE_NAMES } from './bundled-templates.js';
import type { FrontMatterConfig } from './config.js';
import { InputError } from './errors.js';
import { inferDocumentLanguage } from './language.js';
import { inferDocumentTitle } from './infer-title.js';

export interface SourceFile {
  /** Absolute path. */
  path: string;
  /** File name relative to the input base (basename for directory input). */
  name: string;
  /** Markdown content with front matter removed. */
  content: string;
  /** 1-origin line offset added by a stripped front matter block. */
  lineOffset: number;
}

export interface Metadata {
  title: NormalizedTitle;
  /** Ordered author names; newlines are intentional display breaks within a name. */
  author: string[] | null;
  series: string | null;
  /** Display date string: explicit front matter value or a generated one. */
  date: string | null;
  confidential: boolean;
  pageSize: PageSize;
  lang: string;
  dir: 'ltr' | 'rtl' | 'auto';
}

export interface NormalizedTitle {
  /** Display text lines; explicit titles decode entities and permitted <br>. */
  lines: string[];
  /** Plain-text form used by PDF metadata. */
  plainText: string;
}

export interface PageSize { css: string }

export interface ResolvedInput {
  files: SourceFile[];
  metadata: Metadata;
  bibliography: BibliographyFile[];
  /** Document settings selected in front matter, before CLI overrides. */
  config: FrontMatterConfig;
}

export interface BibliographyFile {
  /** Absolute path, resolved relative to the front matter source. */
  path: string;
  /** Path exactly as written in front matter. */
  declaredPath: string;
  /** UTF-8 content captured at the input boundary. */
  content: string;
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function decodeUtf8(filePath: string, buf: Buffer): string {
  let start = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) start = 3;
  try {
    return utf8Decoder.decode(buf.subarray(start));
  } catch {
    throw new InputError(`${filePath}: invalid UTF-8 byte sequence`);
  }
}

function listMarkdownFiles(dir: string): string[] {
  let entries: fs.Dirent<Buffer>[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true, encoding: 'buffer' });
  } catch (e) {
    throw new InputError(`cannot read input directory ${dir}: ${(e as Error).message}`);
  }
  const names: Array<{ text: string; bytes: Buffer }> = [];
  for (const entry of entries) {
    let name: string;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(entry.name);
    } catch {
      throw new InputError('input directory contains a file name that is not valid UTF-8');
    }
    if (!name.endsWith('.md')) continue;
    const full = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch (e) {
      throw new InputError(`cannot stat ${full}: ${(e as Error).message}`);
    }
    if (!st.isFile()) continue;
    names.push({ text: name, bytes: Buffer.from(entry.name) });
  }
  if (names.length === 0) {
    throw new InputError(`no *.md files found in ${dir}`);
  }
  // Byte-wise sort of UTF-8 names, locale independent.
  names.sort((a, b) => a.bytes.compare(b.bytes));
  return names.map((item) => item.text);
}

interface FrontMatter {
  raw: Map<string, unknown>;
  lineCount: number;
}

export interface FrontMatterOptions {
  /** Reject unknown keys instead of warning and ignoring them. */
  strictFrontMatter?: boolean;
}

const ALLOWED_KEYS = new Set([
  'title', 'author', 'series', 'date', 'page_size', 'confidential', 'lang', 'dir',
  'bibliography', 'template', 'toc', 'cover', 'logo',
]);

interface SourceLine {
  text: string;
  /** Byte-for-byte offset immediately after this line's terminator. */
  end: number;
  eol: string;
}

function sourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const re = /\r\n|\n/g;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    lines.push({ text: text.slice(start, match.index), end: re.lastIndex, eol: match[0] });
    start = re.lastIndex;
  }
  lines.push({ text: text.slice(start), end: text.length, eol: '' });
  return lines;
}

function parseFrontMatter(
  filePath: string,
  text: string,
  warn: (msg: string) => void,
  options: FrontMatterOptions,
): { fm: FrontMatter | null; body: string } {
  const lines = sourceLines(text);
  if (lines[0]!.text !== '---') return { fm: null, body: text };
  let closed = -1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.text;
    if (line === '---' || line === '...') {
      closed = i;
      break;
    }
  }
  if (closed < 0) {
    throw new InputError(`${filePath}: front matter is not closed with --- or ...`);
  }
  const yaml = text.slice(lines[0]!.end, lines[closed]!.end - lines[closed]!.eol.length - lines[closed]!.text.length);
  let parsed: unknown;
  try {
    parsed = loadYaml(yaml, { schema: JSON_SCHEMA });
  } catch (e) {
    throw new InputError(`${filePath}: invalid front matter: ${(e as Error).message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InputError(`${filePath}: front matter must be a mapping`);
  }
  const raw = new Map<string, unknown>(Object.entries(parsed));
  for (const key of raw.keys()) {
    if (ALLOWED_KEYS.has(key)) continue;
    const message = `${filePath}: unknown front matter key: ${key}`;
    if (options.strictFrontMatter) throw new InputError(message);
    warn(`${message}; ignored`);
    raw.delete(key);
  }
  const body = text.slice(lines[closed]!.end);
  return { fm: { raw, lineCount: closed + 1 }, body };
}

function discoverInputFiles(inputAbs: string): { paths: string[]; inputName: string } {
  let st: fs.Stats;
  try {
    st = fs.statSync(inputAbs);
  } catch {
    throw new InputError(`input not found: ${inputAbs}`);
  }

  if (st.isDirectory()) {
    return {
      paths: listMarkdownFiles(inputAbs).map((n) => path.join(inputAbs, n)),
      inputName: path.basename(path.resolve(inputAbs)),
    };
  }
  if (st.isFile()) {
    if (!inputAbs.endsWith('.md')) {
      throw new InputError(`input file must have a lowercase .md extension: ${inputAbs}`);
    }
    return { paths: [inputAbs], inputName: path.basename(inputAbs).slice(0, -3) };
  }
  throw new InputError(`input is neither a regular file nor a directory: ${inputAbs}`);
}

function readInputFile(filePath: string): string {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch (e) {
    throw new InputError(`cannot read input file ${filePath}: ${(e as Error).message}`);
  }
  return decodeUtf8(filePath, buf);
}

function resolveFrontMatterConfig(
  raw: Map<string, unknown>,
  frontMatterPath: string,
): FrontMatterConfig {
  const value = raw.get('template');
  let template: string | null = null;
  if (value !== undefined && typeof value !== 'string') {
    throw new InputError('front matter template: expected a string');
  }
  if (typeof value === 'string' && !BUNDLED_TEMPLATE_NAMES.includes(value)) {
    throw new InputError(`front matter template: unknown bundled template: ${value}`);
  }
  if (typeof value === 'string') template = value;

  const tocValue = raw.get('toc');
  if (tocValue !== undefined && typeof tocValue !== 'boolean') {
    throw new InputError('front matter toc: expected a YAML boolean');
  }
  const coverValue = raw.get('cover');
  if (coverValue !== undefined && typeof coverValue !== 'boolean') {
    throw new InputError('front matter cover: expected a YAML boolean');
  }

  const logoValue = raw.get('logo');
  let logo: FrontMatterConfig['logo'] = null;
  if (logoValue === false) {
    logo = { kind: 'none' };
  } else if (typeof logoValue === 'string') {
    if (logoValue === '' || logoValue.includes('\0')) {
      throw new InputError('front matter logo: empty paths and NUL are not allowed');
    }
    if (logoValue.startsWith('git::')) {
      throw new InputError('front matter logo: Git repository sources require --logo');
    }
    logo = {
      kind: 'local',
      path: logoValue,
      absPath: path.isAbsolute(logoValue)
        ? path.normalize(logoValue)
        : path.resolve(path.dirname(frontMatterPath), logoValue),
    };
  } else if (logoValue !== undefined) {
    throw new InputError('front matter logo: expected a path string or false');
  }
  return { template, toc: tocValue ?? null, cover: coverValue ?? null, logo };
}

/** Read document configuration for configuration diagnostics. */
export function readFrontMatterConfig(
  inputAbs: string,
  warn: (msg: string) => void = (msg) => { process.stderr.write(`pfpdf: warn: ${msg}\n`); },
  options: FrontMatterOptions = {},
): FrontMatterConfig {
  const input = readSourceFiles(inputAbs, warn, options);
  return resolveFrontMatterConfig(input.raw, input.keySources.get('logo') ?? input.files[0]!.path);
}

/** Strip every file independently; the earliest value for each key is retained. */
function readSourceFiles(
  inputAbs: string,
  warn: (msg: string) => void,
  options: FrontMatterOptions,
): { files: SourceFile[]; raw: Map<string, unknown>; keySources: Map<string, string>; inputName: string } {
  const raw = new Map<string, unknown>();
  const keySources = new Map<string, string>();
  const { paths, inputName } = discoverInputFiles(inputAbs);
  const files = paths.map((filePath) => {
    const parsed = parseFrontMatter(filePath, readInputFile(filePath), warn, options);
    if (parsed.fm !== null) {
      try {
        validateFrontMatterValues(parsed.fm.raw, filePath);
      } catch (error) {
        if (error instanceof InputError) throw new InputError(`${filePath}: ${error.message}`);
        throw error;
      }
      for (const [key, value] of parsed.fm.raw) {
        if (raw.has(key)) continue;
        raw.set(key, value);
        keySources.set(key, filePath);
      }
    }
    return {
      path: filePath,
      name: path.basename(filePath),
      content: parsed.body,
      lineOffset: parsed.fm?.lineCount ?? 0,
    };
  });
  return { files, raw, keySources, inputName };
}

/** Validate every block, including unselected values, without opening assets. */
function validateFrontMatterValues(raw: Map<string, unknown>, filePath: string): void {
  for (const key of ['title', 'series', 'date', 'page_size', 'lang', 'dir']) {
    const value = raw.get(key);
    if (value !== undefined && typeof value !== 'string') throw new InputError(`front matter ${key}: expected a string`);
  }
  if (raw.has('title')) validateTitle(raw.get('title') as string);
  normalizeAuthors(raw.get('author'));
  const confidential = raw.get('confidential');
  if (confidential !== undefined && typeof confidential !== 'boolean') throw new InputError('front matter confidential: expected a YAML boolean');
  if (raw.has('page_size')) parsePageSize(raw.get('page_size') as string);
  if (raw.has('lang')) canonicalizeLang(raw.get('lang') as string);
  const dir = raw.get('dir');
  if (dir !== undefined && dir !== 'ltr' && dir !== 'rtl' && dir !== 'auto') throw new InputError(`front matter dir: expected ltr / rtl / auto, got ${JSON.stringify(dir)}`);
  resolveFrontMatterConfig(raw, filePath);
  bibliographyPaths(raw.get('bibliography'), filePath);
}

const PAGE_SIZE_KEYWORDS: Record<string, string> = {
  a3: '297mm 420mm',
  a4: '210mm 297mm',
  a5: '148mm 210mm',
  'jis-b4': '257mm 364mm',
  'jis-b5': '182mm 257mm',
  'iso-b4': '250mm 353mm',
  'iso-b5': '176mm 250mm',
  letter: '8.5in 11in',
  legal: '8.5in 14in',
};

export function parsePageSize(value: string): PageSize {
  const kw = PAGE_SIZE_KEYWORDS[value.toLowerCase()];
  if (kw !== undefined) return { css: kw };
  const m = /^([0-9]+(?:\.[0-9]+)?)(mm|cm|in|pt)[ \t\n\f\r]+([0-9]+(?:\.[0-9]+)?)(mm|cm|in|pt)$/.exec(value);
  if (!m) throw new InputError(`page_size: invalid value ${JSON.stringify(value)}`);
  if (Number(m[1]) <= 0 || Number(m[3]) <= 0) {
    throw new InputError('page_size: each side must be positive');
  }
  return { css: `${m[1]}${m[2]} ${m[3]}${m[4]}` };
}

/** Validate a title: text, character references, and bare <br> tags only. */
export function validateTitle(title: string): void {
  if (title === '') throw new InputError('title must be a non-empty string');
  if (/[\r\n]/.test(title)) {
    throw new InputError('title: line breaks are not allowed; use <br> instead');
  }
  const tagRe = /<[^>]*>?/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(title)) !== null) {
    const tag = m[0];
    if (/^<br\s*\/?>$/i.test(tag)) continue;
    // A bare "<" followed by non-tag text is fine (e.g. "x < y").
    if (!/^<[a-zA-Z/!]/.test(tag)) continue;
    throw new InputError(`title: HTML other than <br> is not allowed: ${tag}`);
  }
}

/** Validate and normalize a title once at the input boundary. */
export function normalizeTitle(title: string): NormalizedTitle {
  validateTitle(title);
  const lines = title.split(/<br\s*\/?>/i).map((part) => {
    const root = fromHtml(part, { fragment: true }) as unknown as {
      children: Array<{ type: string; value?: string; children?: unknown[] }>;
    };
    let line = '';
    const walk = (nodes: typeof root.children): void => {
      for (const node of nodes) {
        if (node.type === 'text') line += node.value ?? '';
        else if (node.children) walk(node.children as typeof root.children);
      }
    };
    walk(root.children);
    return line;
  });
  return { lines, plainText: lines.join('\n') };
}

/** Author text is the primary format; lists are an undocumented compatibility fallback. */
export function normalizeAuthors(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' && !Array.isArray(value)) {
    throw new InputError('front matter author: expected a string or an array of author-name strings');
  }
  const names: unknown[] = typeof value === 'string' ? [value] : value;
  if (names.length === 0 || (typeof value === 'string' && value.trim() === '')) return null;
  return names.map((name, index) => {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new InputError(`front matter author[${index}]: expected a non-empty author-name string`);
    }
    return name.replace(/\r\n?/g, '\n').trim();
  });
}

function validateOverriddenTitle(title: string | null): void {
  if (title !== null) {
    // Preserve validation of front matter hidden by a CLI override.
    normalizeTitle(title);
  }
}

function formatDisplayDate(lang: string, d: { y: number; m: number; d: number }): string {
  if (lang === 'ja' || lang.startsWith('ja-')) {
    return `${d.y} 年 ${d.m} 月 ${d.d} 日`;
  }
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(d.y, 4)}-${pad(d.m, 2)}-${pad(d.d, 2)}`;
}

export function parseSourceDateEpoch(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  if (!/^[0-9]+$/.test(value) || value.length > 13) {
    throw new InputError(`SOURCE_DATE_EPOCH: expected a non-negative decimal integer, got ${JSON.stringify(value)}`);
  }
  const seconds = BigInt(value);
  if (seconds > 8_640_000_000_000n) {
    throw new InputError('SOURCE_DATE_EPOCH: value out of range');
  }
  return Number(seconds);
}

export function resolveInput(
  inputAbs: string,
  cliTitle: string | null,
  env: Record<string, string | undefined>,
  warn: (msg: string) => void,
  options: FrontMatterOptions & { processStart?: Date } = {},
): ResolvedInput {
  const processStart = options.processStart ?? new Date();
  const { files, raw, keySources, inputName } = readSourceFiles(inputAbs, warn, options);

  const bibliography = resolveBibliographyFiles(raw.get('bibliography'), keySources.get('bibliography') ?? files[0]!.path);
  const config = resolveFrontMatterConfig(raw, keySources.get('logo') ?? files[0]!.path);

  const requireString = (key: string): string | null => {
    const v = raw.get(key);
    if (v === undefined) return null;
    if (typeof v !== 'string') throw new InputError(`front matter ${key}: expected a string`);
    return v;
  };

  const frontMatterTitle = requireString('title');
  // An overridden front matter title is still validated; otherwise the
  // selected front matter value is validated once below.
  if (cliTitle !== null) validateOverriddenTitle(frontMatterTitle);
  const rawTitle = cliTitle ?? frontMatterTitle;
  const title = rawTitle === null ? inferDocumentTitle(files, inputName) : normalizeTitle(rawTitle);

  const author = normalizeAuthors(raw.get('author'));
  const series = requireString('series');
  const explicitDate = requireString('date');

  const confidentialRaw = raw.get('confidential');
  if (confidentialRaw !== undefined && typeof confidentialRaw !== 'boolean') {
    throw new InputError('front matter confidential: expected a YAML boolean');
  }
  const confidential = confidentialRaw === true;

  const pageSizeRaw = requireString('page_size');
  const pageSize = pageSizeRaw === null ? parsePageSize('A4') : parsePageSize(pageSizeRaw);

  const lang = canonicalizeLang(requireString('lang') ?? inferDocumentLanguage(files, title.plainText));

  const dirRaw = requireString('dir') ?? 'auto';
  if (dirRaw !== 'ltr' && dirRaw !== 'rtl' && dirRaw !== 'auto') {
    throw new InputError(`front matter dir: expected ltr / rtl / auto, got ${dirRaw}`);
  }

  const epoch = parseSourceDateEpoch(env['SOURCE_DATE_EPOCH']);
  if (epoch === null) {
    warn('SOURCE_DATE_EPOCH is not set; this build is not reproducible');
  }

  let date: string | null;
  if (explicitDate !== null) {
    date = explicitDate;
  } else if (epoch !== null) {
    const d = new Date(epoch * 1000);
    date = formatDisplayDate(lang, {
      y: d.getUTCFullYear(),
      m: d.getUTCMonth() + 1,
      d: d.getUTCDate(),
    });
  } else {
    const d = processStart;
    date = formatDisplayDate(lang, { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
  }

  return {
    files,
    bibliography,
    config,
    metadata: {
      title,
      author,
      series,
      date,
      confidential,
      pageSize,
      lang,
      dir: dirRaw,
    },
  };
}

function bibliographyPaths(value: unknown, frontMatterPath: string): string[] {
  if (value === undefined) return [];
  const declared = typeof value === 'string'
    ? [value]
    : Array.isArray(value) && value.every((item) => typeof item === 'string')
      ? value
      : null;
  if (declared === null || declared.length === 0) {
    throw new InputError('front matter bibliography: expected a string or non-empty string list');
  }
  const seen = new Set<string>();
  for (const declaredPath of declared) {
    if (declaredPath === '' || declaredPath.includes('\0')) {
      throw new InputError('front matter bibliography: empty paths and NUL are not allowed');
    }
    if (!declaredPath.toLowerCase().endsWith('.bib')) {
      throw new InputError(`front matter bibliography: expected a .bib file: ${declaredPath}`);
    }
    const absolute = path.resolve(path.dirname(frontMatterPath), declaredPath);
    if (seen.has(absolute)) {
      throw new InputError(`front matter bibliography: duplicate path: ${declaredPath}`);
    }
    seen.add(absolute);
  }
  return declared;
}

function resolveBibliographyFiles(value: unknown, frontMatterPath: string): BibliographyFile[] {
  const baseDir = path.dirname(frontMatterPath);
  const files: BibliographyFile[] = [];
  for (const declaredPath of bibliographyPaths(value, frontMatterPath)) {
    const absolute = path.isAbsolute(declaredPath)
      ? path.normalize(declaredPath)
      : path.resolve(baseDir, declaredPath);
    let st: fs.Stats;
    try {
      st = fs.statSync(absolute);
    } catch (e) {
      throw new InputError(`cannot read bibliography ${absolute}: ${(e as Error).message}`);
    }
    if (!st.isFile()) throw new InputError(`bibliography is not a regular file: ${absolute}`);
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(absolute);
    } catch (e) {
      throw new InputError(`cannot read bibliography ${absolute}: ${(e as Error).message}`);
    }
    files.push({ path: absolute, declaredPath, content: decodeUtf8(absolute, buffer) });
  }
  return files;
}

function canonicalizeLang(tag: string): string {
  try {
    return Intl.getCanonicalLocales(tag)[0]!;
  } catch {
    throw new InputError(`front matter lang: not a well-formed BCP 47 language tag: ${tag}`);
  }
}
