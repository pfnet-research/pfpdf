/** ResourceResolver: maps local files to deterministic logical asset URLs. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TokenType, tokenize, type CSSToken } from '@csstools/css-tokenizer';
import type { Element, Root as HastRoot } from 'hast';
import { visit } from 'unist-util-visit';
import { InputError } from './errors.js';

/** Fetch-role attributes shared by Markdown and template HTML processing. */
export const FETCH_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  img: ['src'],
  script: ['src'],
  link: ['href'],
  source: ['src'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  embed: ['src'],
  object: ['data'],
  input: ['src'],
  image: ['href'],
  use: ['href'],
};

const FETCH_LINK_RELS = new Set([
  'stylesheet', 'icon', 'preload', 'modulepreload', 'manifest', 'apple-touch-icon', 'mask-icon',
]);

function relationValues(element: Element): string[] {
  const rel = element.properties?.rel;
  return Array.isArray(rel) ? rel.map(String) : typeof rel === 'string' ? rel.split(/\s+/) : [];
}

export function isStylesheetLink(element: Element): boolean {
  return relationValues(element).some((value) => value.toLowerCase() === 'stylesheet');
}

export function isFetchAttribute(element: Element, attribute: string): boolean {
  if (element.tagName === 'link' && attribute === 'href') {
    return relationValues(element).some((value) => FETCH_LINK_RELS.has(value.toLowerCase()));
  }
  if (element.tagName === 'input' && attribute === 'src') {
    return typeof element.properties?.type === 'string' && element.properties.type.toLowerCase() === 'image';
  }
  return true;
}

export class ResourceManifest {
  /** logical URL path (relative to document.html) -> absolute file path */
  private readonly entries = new Map<string, string>();
  private readonly byFile = new Map<string, string>();
  private counter = 0;

  /** Register a local file and return its logical relative URL. */
  add(absPath: string): string {
    const canonical = canonicalize(absPath);
    const existing = this.byFile.get(canonical);
    if (existing !== undefined) return existing;
    this.counter += 1;
    const id = String(this.counter).padStart(4, '0');
    const base = encodeURIComponent(path.basename(absPath));
    const logical = `assets/${id}/${base}`;
    this.entries.set(logical, canonical);
    this.byFile.set(canonical, logical);
    return logical;
  }

  /** Register a file under an explicit logical path (bundled assets). */
  addExplicit(logical: string, absPath: string): string {
    const canonical = canonicalize(absPath);
    const previous = this.entries.get(logical);
    if (previous !== undefined && previous !== canonical) {
      throw new InputError(`logical resource path is already registered: ${logical}`);
    }
    this.entries.set(logical, canonical);
    return logical;
  }

  get(logical: string): string | undefined {
    return this.entries.get(logical);
  }

  list(): Array<[string, string]> {
    return [...this.entries.entries()];
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.entries);
  }
}

export interface ElementResourceRewriteContext {
  baseDir: string;
  manifest: ResourceManifest;
  sourceName: string;
  sourceSeparator?: string;
  generatedCssPrefix: string;
  generatedCssName?: () => string;
  include?: (element: Element) => boolean;
  skipFetch?: (element: Element, attribute: string, value: string) => boolean;
  rewriteStylesheet?: (absolutePath: string) => string;
  mapError?: (error: unknown) => Error;
}

/** Rewrite all fetch and CSS-bearing attributes with one DOM traversal. */
export function rewriteElementResources(
  root: HastRoot,
  context: ElementResourceRewriteContext,
): Array<[string, string]> {
  const generatedCss: Array<[string, string]> = [];
  let generatedCssCount = 0;
  visit(root, 'element', (element: Element) => {
    if (context.include && !context.include(element)) return;
    try {
      rewriteFetchAttributes(element, context, () => {
        generatedCssCount++;
        return context.generatedCssName?.() ??
          `generated/${context.generatedCssPrefix}-${generatedCssCount}.css`;
      }, generatedCss);
      rewriteElementCss(element, context);
    } catch (error) {
      throw context.mapError?.(error) ?? error;
    }
  });
  return generatedCss;
}

function rewriteFetchAttributes(
  element: Element,
  context: ElementResourceRewriteContext,
  nextCssName: () => string,
  generatedCss: Array<[string, string]>,
): void {
  const attributes = FETCH_ATTRIBUTES[element.tagName];
  if (!attributes) return;
  const sourcePrefix = context.sourceName + (context.sourceSeparator ?? ': ');
  for (const attribute of attributes) {
    const value = element.properties?.[attribute];
    if (typeof value !== 'string' || !isFetchAttribute(element, attribute)) continue;
    if (context.skipFetch?.(element, attribute, value)) continue;
    const source = `${sourcePrefix}<${element.tagName}> ${attribute}`;
    const resolved = resolveFetchUrl(value, context.baseDir, source);
    if (resolved.kind !== 'local') continue;
    if (element.tagName === 'link' && attribute === 'href' && isStylesheetLink(element)) {
      const logical = nextCssName();
      const css = context.rewriteStylesheet
        ? context.rewriteStylesheet(resolved.absPath)
        : rewriteCss(resolved.absPath, context.manifest, () => '');
      generatedCss.push([logical, css]);
      element.properties![attribute] = logical;
    } else {
      element.properties![attribute] = context.manifest.add(resolved.absPath) + resolved.suffix;
    }
  }
  const srcSet = element.properties?.srcSet;
  if (typeof srcSet === 'string') {
    element.properties!.srcSet = rewriteSrcset(
      srcSet,
      context.baseDir,
      context.manifest,
      `${sourcePrefix}srcset URL`,
    );
  }
}

function rewriteElementCss(element: Element, context: ElementResourceRewriteContext): void {
  const style = element.properties?.style;
  if (typeof style === 'string') {
    element.properties!.style = rewriteCssText(style, context.baseDir, context.manifest);
  }
  if (element.tagName !== 'style') return;
  for (const child of element.children) {
    if (child.type === 'text') child.value = rewriteCssText(child.value, context.baseDir, context.manifest);
  }
}

function canonicalize(absPath: string): string {
  let real: string;
  try {
    real = fs.realpathSync(absPath);
  } catch {
    throw new InputError(`resource not found: ${absPath}`);
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(real);
  } catch {
    throw new InputError(`resource not readable: ${absPath}`);
  }
  if (!st.isFile()) {
    throw new InputError(`resource is not a regular file: ${absPath}`);
  }
  try {
    fs.accessSync(real, fs.constants.R_OK);
  } catch {
    throw new InputError(`resource not readable: ${absPath}`);
  }
  return real;
}

/**
 * Rewrite url() and @import references inside a CSS file, resolving local
 * relative URLs against the CSS file's own directory. Imports are inlined so
 * all generated CSS remains renderer-neutral.
 */
export function rewriteCss(
  cssPath: string,
  manifest: ResourceManifest,
  emitGenerated: (name: string, content: string) => string,
  visited: Set<string> = new Set(),
  /* Generated CSS is served from generated/, one level below document.html. */
  urlPrefix = '../',
): string {
  let canonical: string;
  let src: string;
  try {
    canonical = fs.realpathSync(cssPath);
    const st = fs.statSync(canonical);
    if (!st.isFile()) throw new Error('not a regular file');
    src = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(canonical));
  } catch (e) {
    throw new InputError(`cannot read stylesheet ${cssPath}: ${(e as Error).message}`);
  }
  if (visited.has(canonical)) return '';
  visited.add(canonical);
  try {
    return rewriteCssSource(src, path.dirname(canonical), manifest, {
      emitGenerated,
      visited,
      urlPrefix,
    });
  } finally {
    visited.delete(canonical);
  }
}

/** Rewrite a CSS fragment embedded in HTML. */
export function rewriteCssText(css: string, baseDir: string, manifest: ResourceManifest): string {
  return rewriteCssSource(css, baseDir, manifest, {
    emitGenerated: () => '',
    visited: new Set(),
    urlPrefix: '',
  });
}

interface CssRewriteOptions {
  emitGenerated: (name: string, content: string) => string;
  visited: Set<string>;
  urlPrefix: string;
}

function rewriteCssSource(
  src: string,
  dir: string,
  manifest: ResourceManifest,
  options: CssRewriteOptions,
): string {
  const { emitGenerated, visited, urlPrefix } = options;
  const errors: Error[] = [];
  const tokens = tokenize({ css: src }, { onParseError: (error) => errors.push(error) });
  if (errors.length > 0) {
    const first = errors[0] as Error & { sourceStart?: number };
    const at = first.sourceStart === undefined ? '' : ` at offset ${first.sourceStart}`;
    throw new InputError(`invalid CSS${at}: ${first.message}`);
  }

  const replacements: CssReplacement[] = [];
  let curlyDepth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token[0] === TokenType.OpenCurly) {
      curlyDepth++;
      continue;
    }
    if (token[0] === TokenType.CloseCurly) {
      curlyDepth = Math.max(0, curlyDepth - 1);
      continue;
    }
    if (
      curlyDepth === 0 &&
      token[0] === TokenType.AtKeyword &&
      token[4].value.toLowerCase() === 'import'
    ) {
      const parsed = parseImport(tokens, i, src);
      const resolved = resolveFetchUrl(parsed.target, dir, `CSS @import ${JSON.stringify(parsed.target)}`);
      if (resolved.kind === 'local') {
        const imported = rewriteCss(resolved.absPath, manifest, emitGenerated, visited, urlPrefix);
        const marked = `/* pfpdf: inlined @import ${cssEscapeComment(parsed.target)} */\n${imported}\n`;
        replacements.push({
          start: token[2],
          end: tokens[parsed.semicolon]![3] + 1,
          text: wrapImportedCss(marked, parsed.qualifiers),
        });
      }
      i = parsed.semicolon;
      continue;
    }

    const parsedUrl = parseUrlToken(tokens, i);
    if (parsedUrl === null) continue;
    const resolved = resolveFetchUrl(parsedUrl.target, dir, `CSS url() ${JSON.stringify(parsedUrl.target)}`);
    if (resolved.kind === 'local') {
      replacements.push({
        start: token[2],
        end: tokens[parsedUrl.endToken]![3] + 1,
        text: `url("${urlPrefix}${manifest.add(resolved.absPath)}${resolved.suffix}")`,
      });
    }
    i = parsedUrl.endToken;
  }

  let out = '';
  let offset = 0;
  for (const replacement of replacements) {
    if (replacement.start < offset) continue;
    out += src.slice(offset, replacement.start) + replacement.text;
    offset = replacement.end;
  }
  return out + src.slice(offset);
}

interface CssReplacement { start: number; end: number; text: string }

interface ParsedUrl { target: string; endToken: number }

function parseUrlToken(tokens: CSSToken[], index: number): ParsedUrl | null {
  const token = tokens[index]!;
  if (token[0] === TokenType.URL) {
    return { target: token[4].value, endToken: index };
  }
  if (token[0] !== TokenType.Function || token[4].value.toLowerCase() !== 'url') return null;
  let i = skipCssTrivia(tokens, index + 1);
  const value = tokens[i];
  if (value?.[0] !== TokenType.String) throw new InputError('invalid quoted url() in CSS');
  const target = value[4].value;
  i = skipCssTrivia(tokens, i + 1);
  if (tokens[i]?.[0] !== TokenType.CloseParen) throw new InputError('invalid quoted url() in CSS');
  return { target, endToken: i };
}

function parseImport(
  tokens: CSSToken[],
  index: number,
  src: string,
): { target: string; qualifiers: string; semicolon: number } {
  let i = skipCssTrivia(tokens, index + 1);
  let target: string;
  let targetEnd: number;
  const token = tokens[i];
  if (token?.[0] === TokenType.String || token?.[0] === TokenType.URL) {
    target = token[4].value;
    targetEnd = i;
  } else {
    const parsed = parseUrlToken(tokens, i);
    if (parsed === null) throw new InputError('invalid @import rule in CSS');
    target = parsed.target;
    targetEnd = parsed.endToken;
  }

  let roundDepth = 0;
  let squareDepth = 0;
  for (i = targetEnd + 1; i < tokens.length; i++) {
    const type = tokens[i]![0];
    if (type === TokenType.Function || type === TokenType.OpenParen) {
      roundDepth++;
    } else if (type === TokenType.CloseParen) {
      roundDepth--;
    } else if (type === TokenType.OpenSquare) {
      squareDepth++;
    } else if (type === TokenType.CloseSquare) {
      squareDepth--;
    } else if (type === TokenType.Semicolon && roundDepth === 0 && squareDepth === 0) {
      return {
        target,
        qualifiers: src.slice(tokens[targetEnd]![3] + 1, tokens[i]![2]).trim(),
        semicolon: i,
      };
    } else if (type === TokenType.EOF || type === TokenType.OpenCurly || type === TokenType.CloseCurly) {
      break;
    }
    if (roundDepth < 0 || squareDepth < 0) break;
  }
  throw new InputError('invalid or unterminated @import rule in CSS');
}

function skipCssTrivia(tokens: CSSToken[], index: number): number {
  let cursor = index;
  while (tokens[cursor]?.[0] === TokenType.Whitespace || tokens[cursor]?.[0] === TokenType.Comment) cursor++;
  return cursor;
}

/** Preserve the media part of a local import. Modern layer/supports import qualifiers are rejected explicitly. */
function wrapImportedCss(css: string, qualifiers: string): string {
  if (qualifiers === '') return css;
  const qualifierTokens = tokenize({ css: qualifiers });
  const first = qualifierTokens[skipCssTrivia(qualifierTokens, 0)];
  if (
    (first?.[0] === TokenType.Ident && first[4].value.toLowerCase() === 'layer') ||
    (first?.[0] === TokenType.Function && ['layer', 'supports'].includes(first[4].value.toLowerCase()))
  ) {
    throw new InputError('local CSS @import with layer() or supports() qualifiers is not supported');
  }
  return `@media ${qualifiers} {\n${css}}\n`;
}

export type ResolvedFetchUrl =
  | { kind: 'none' | 'remote' }
  | { kind: 'local'; absPath: string; suffix: string };

/** Classify a fetch-role URL and resolve local paths without double decoding. */
export function resolveFetchUrl(url: string, baseDir: string, source = 'URL'): ResolvedFetchUrl {
  validateUrlText(url, source);
  if (url === '' || url.startsWith('#')) return { kind: 'none' };
  if (url.startsWith('//')) {
    try {
      new URL(`http:${url}`);
    } catch {
      throw new InputError(`${source}: invalid network-path URL`);
    }
    return { kind: 'remote' };
  }
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    if (scheme === 'http' || scheme === 'https' || scheme === 'data') {
      try {
        new URL(url);
      } catch {
        throw new InputError(`${source}: invalid ${scheme}: URL`);
      }
      return { kind: 'remote' };
    }
    if (scheme !== 'file') {
      throw new InputError(`${source}: unsupported fetch URL scheme: ${scheme}`);
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new InputError(`${source}: invalid file: URL`);
    }
    const suffix = parsed.search + parsed.hash;
    parsed.search = '';
    parsed.hash = '';
    try {
      return { kind: 'local', absPath: fileURLToPath(parsed), suffix };
    } catch (e) {
      throw new InputError(`${source}: invalid file: URL: ${(e as Error).message}`);
    }
  }
  const [clean, suffix] = splitQueryFragment(url);
  return { kind: 'local', absPath: resolveUrlPath(clean, baseDir, source), suffix };
}

/** Rewrite local URLs in a srcset value while preserving remote and data URLs. */
export function rewriteSrcset(
  srcset: string,
  baseDir: string,
  manifest: ResourceManifest,
  source = 'srcset URL',
): string {
  const candidates: string[] = [];
  let cursor = 0;
  while (cursor < srcset.length) {
    while (cursor < srcset.length && /[\t\n\f\r ,]/.test(srcset[cursor]!)) cursor++;
    if (cursor >= srcset.length) break;
    const start = cursor;
    const dataUrl = srcset.slice(cursor, cursor + 5).toLowerCase() === 'data:';
    while (
      cursor < srcset.length &&
      !/[\t\n\f\r ]/.test(srcset[cursor]!) &&
      (dataUrl || srcset[cursor] !== ',')
    ) cursor++;
    const url = srcset.slice(start, cursor);
    while (cursor < srcset.length && /[\t\n\f\r ]/.test(srcset[cursor]!)) cursor++;
    const descriptorStart = cursor;
    while (cursor < srcset.length && srcset[cursor] !== ',') cursor++;
    const descriptor = srcset.slice(descriptorStart, cursor).trim();
    if (cursor < srcset.length) cursor++;
    const resolved = resolveFetchUrl(url, baseDir, source);
    const rewritten = resolved.kind === 'local'
      ? manifest.add(resolved.absPath) + resolved.suffix
      : url;
    candidates.push(descriptor === '' ? rewritten : `${rewritten} ${descriptor}`);
  }
  return candidates.join(', ');
}

/** Decode a URL path one component at a time. */
export function decodeUrlPath(urlPath: string, source = 'URL'): string {
  validateUrlText(urlPath, source);
  return urlPath
    .split('/')
    .map((component) => decodeUrlComponent(component, source))
    .join('/');
}

export function decodeUrlComponent(component: string, source = 'URL'): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(component);
  } catch {
    throw new InputError(`${source}: invalid percent encoding`);
  }
  if (decoded.includes('\0') || decoded.includes('/') || (process.platform === 'win32' && decoded.includes('\\'))) {
    throw new InputError(`${source}: encoded path separator or NUL is not allowed`);
  }
  return decoded;
}

function resolveUrlPath(urlPath: string, baseDir: string, source: string): string {
  const decoded = decodeUrlPath(urlPath, source);
  if (process.platform === 'win32' && decoded.includes('\\')) {
    throw new InputError(`${source}: backslash is not a URL path separator`);
  }
  return path.resolve(baseDir, decoded);
}

export function validateUrlText(url: string, source = 'URL'): void {
  if (/\0|[\u0001-\u001F\u007F-\u009F]/.test(url)) {
    throw new InputError(`${source}: control characters are not allowed`);
  }
  if (/%(?![0-9A-Fa-f]{2})/.test(url)) {
    throw new InputError(`${source}: invalid percent encoding`);
  }
}

export function splitQueryFragment(url: string): [string, string] {
  const match = /^([^?#]*)([?#].*)?$/.exec(url)!;
  return [match[1]!, match[2] ?? ''];
}

function cssEscapeComment(s: string): string {
  return s.replace(/\*\//g, '*\\/');
}
