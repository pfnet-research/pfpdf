/** Markdown pipeline: GFM + CJK-friendly + math + pfpdf directives -> hast. */
import path from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import { toHtml } from 'hast-util-to-html';
import { visit } from 'unist-util-visit';
import type { Root as HastRoot, Element, ElementContent } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import { lowlight, hasLanguage } from './highlight.js';
import { renderMathToHast } from './math.js';
import { InputError, RuntimeError } from './errors.js';
import {
  prepareBibliography,
  type CitationCluster,
} from './bibliography.js';
import {
  renderBibliography,
  transformCitationSyntax,
  type CitationNode,
} from './citations.js';
import {
  type ResourceManifest,
  rewriteElementResources,
} from './resources.js';
import type { BibliographyFile, SourceFile } from './input.js';
import { insertWordBreakOpportunities } from './text-breaks.js';
import { renderMermaidToHast } from './mermaid.js';

export interface TocEntry {
  depth: number;
  id: string;
  /** hast children of the heading, cloned for the ToC link. */
  text: string;
}

export interface DocumentBody {
  /** One <section> element per source file. */
  sections: Element[];
  toc: TocEntry[];
  generatedCss: Array<[string, string]>;
  generatedFiles: Array<[string, string]>;
}

function parserFor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkCjkFriendly)
    .use(remarkMath, { singleDollarTextMath: true });
}

/** Spec 3.3.3 slug algorithm. */
export function slugify(text: string): string {
  let s = text.normalize('NFC').toLowerCase();
  // remove control characters and ASCII punctuation except '_' and '-'
  s = Array.from(s)
    .filter((ch) => {
      const cp = ch.codePointAt(0)!;
      if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return false;
      if (cp < 0x80 && /[!-,./:-@[-^`{-~]/.test(ch)) return false;
      return true;
    })
    .join('');
  s = s.replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
  if (s === '') return 'section';
  return s;
}

export class IdAllocator {
  private readonly used = new Set<string>();
  private readonly cursor = new Map<string, number>();

  reserve(id: string): void {
    this.used.add(id);
  }

  has(id: string): boolean {
    return this.used.has(id);
  }

  allocate(base: string): string {
    if (!this.used.has(base)) {
      this.used.add(base);
      return base;
    }
    let n = this.cursor.get(base) ?? 2;
    while (this.used.has(`${base}-${n}`)) n++;
    this.cursor.set(base, n + 1);
    const id = `${base}-${n}`;
    this.used.add(id);
    return id;
  }
}

function fileAnchor(index: number): string {
  return `pfpdf-file-${String(index + 1).padStart(4, '0')}`;
}

export interface ParsedSource {
  file: SourceFile;
  mdast: MdastRoot;
  markdownHeadingPositions: Set<string>;
  citations: CitationCluster[];
  bibliographyMarkers: number;
}

function positionKey(node: { position?: Element['position'] }): string | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return typeof start === 'number' && typeof end === 'number' ? `${start}:${end}` : null;
}

/** Detect top-level thematic breaks written exactly as `___`. */
function markPageBreaks(file: SourceFile, tree: MdastRoot): void {
  const lines = file.content.split(/\r\n|\n/);
  const children = tree.children;
  for (let i = 0; i < children.length; i++) {
    const node = children[i]!;
    if (node.type !== 'thematicBreak' || !node.position) continue;
    const line = lines[node.position.start.line - 1];
    if (line === '___') {
      (node as unknown as { data: unknown }).data = {
        hName: 'div',
        hProperties: { className: ['pfpdf-page-break-marker'] },
      };
    }
  }
}

export async function buildDocumentBody(
  files: SourceFile[],
  manifest: ResourceManifest,
  reservedIds: string[],
  opts: { warn: (msg: string) => void; bibliography?: BibliographyFile[] },
): Promise<DocumentBody> {
  const parses = parseSources(files);
  const clusters = parses.flatMap((parse) => parse.citations);
  const markerCount = parses.reduce((sum, parse) => sum + parse.bibliographyMarkers, 0);
  if (markerCount > 1) throw new InputError('\\printbibliography may appear only once');
  if (markerCount > 0 && clusters.length === 0) {
    throw new InputError('\\printbibliography requires at least one citation');
  }
  const bibliography = prepareBibliography(opts.bibliography ?? [], clusters);
  const sectionsRaw = await convertSourcesToHast(parses);
  const allocator = createIdAllocator(reservedIds, sectionsRaw.length);
  reserveExplicitIds(sectionsRaw, allocator);
  if (bibliography !== null) {
    renderBibliography(sectionsRaw, clusters, bibliography, allocator, markerCount === 1);
  }
  const toc = assignHeadingIds(parses, sectionsRaw, allocator);
  await renderMermaidCodeBlocks(parses, sectionsRaw);
  const generatedCss = rewriteSourceLinks(parses, sectionsRaw, manifest);
  const generatedFiles = externalizeMermaidSvgs(sectionsRaw);
  await decorateSources(parses, sectionsRaw, opts.warn);
  const sections = assembleSections(sectionsRaw);
  return { sections, toc, generatedCss, generatedFiles };
}

export function parseSources(files: SourceFile[]): ParsedSource[] {
  return files.map((file) => {
    const processor = parserFor();
    const mdast = processor.parse(file.content);
    markPageBreaks(file, mdast);
    const transformed = transformCitationSyntax(file, mdast);
    const markdownHeadingPositions = new Set<string>();
    visit(mdast, 'heading', (heading) => {
      const key = positionKey(heading);
      if (key !== null) markdownHeadingPositions.add(key);
    });
    return {
      file,
      mdast,
      markdownHeadingPositions,
      citations: transformed.citations,
      bibliographyMarkers: transformed.bibliographyMarkers,
    };
  });
}

async function convertSourcesToHast(parses: ParsedSource[]): Promise<HastRoot[]> {
  const roots: HastRoot[] = [];
  for (const parse of parses) {
    roots.push((await unified()
      .use(remarkRehype, {
        allowDangerousHtml: true,
        handlers: {
          inlineMath: (_state: unknown, node: { value: string; position?: unknown }) =>
            mathPlaceholder(node.value, false, node.position),
          math: (_state: unknown, node: { value: string; position?: unknown }) =>
            mathPlaceholder(node.value, true, node.position),
          pfpdfCitation: (_state: unknown, node: CitationNode) => ({
            type: 'element',
            tagName: 'span',
            properties: { 'data-pfpdf-citation': node.clusterId },
            children: [],
          }),
          pfpdfBibliographyMarker: () => ({
            type: 'element',
            tagName: 'div',
            properties: { 'data-pfpdf-bibliography-marker': '' },
            children: [],
          }),
        },
      } as never)
      .use(rehypeRaw)
      .run(parse.mdast)) as HastRoot);
  }
  return roots;
}

function createIdAllocator(reservedIds: string[], fileCount: number): IdAllocator {
  const allocator = new IdAllocator();
  for (const id of reservedIds) allocator.reserve(id);
  for (let i = 0; i < fileCount; i++) allocator.reserve(fileAnchor(i));
  return allocator;
}

export function reserveExplicitIds(sectionsRaw: HastRoot[], allocator: IdAllocator): void {
  for (const hast of sectionsRaw) {
    visit(hast, 'element', (el: Element) => {
      const id = el.properties?.id;
      if (typeof id !== 'string') return;
      allocator.reserve(id);
    });
  }
}

export function assignHeadingIds(
  parses: ParsedSource[],
  sectionsRaw: HastRoot[],
  allocator: IdAllocator,
): TocEntry[] {
  const toc: TocEntry[] = [];
  for (let i = 0; i < sectionsRaw.length; i++) {
    const hast = sectionsRaw[i]!;
    const parsed = parses[i]!;
    visit(hast, 'element', (el: Element) => {
      const m = /^h([1-6])$/.exec(el.tagName);
      if (!m) return;
      const key = positionKey(el);
      if (key === null || !parsed.markdownHeadingPositions.has(key)) return;
      if (el.properties && typeof el.properties.id === 'string') {
        toc.push({ depth: Number(m[1]), id: el.properties.id, text: elementText(el) });
        return;
      }
      const text = elementText(el);
      const id = allocator.allocate(slugify(text));
      el.properties = { ...el.properties, id };
      toc.push({ depth: Number(m[1]), id, text });
    });
  }
  return toc;
}

function rewriteSourceLinks(
  parses: ParsedSource[],
  sectionsRaw: HastRoot[],
  manifest: ResourceManifest,
): Array<[string, string]> {
  const fileIndexByName = new Map<string, number>();
  for (let i = 0; i < parses.length; i++) fileIndexByName.set(parses[i]!.file.name, i);
  const generatedCss: Array<[string, string]> = [];
  let generatedCssCount = 0;

  // URL rewriting: fetch-role resources and navigation links.
  for (let i = 0; i < parses.length; i++) {
    const hast = sectionsRaw[i]!;
    const file = parses[i]!.file;
    const base = path.dirname(file.path);
    generatedCss.push(...rewriteElementResources(hast, {
      baseDir: base,
      manifest,
      sourceName: file.name,
      generatedCssPrefix: 'document',
      generatedCssName: () => `generated/document-${++generatedCssCount}.css`,
    }));
    visit(hast, 'element', (el: Element) => {
      if (el.tagName === 'a') {
        const href = el.properties?.href;
        if (typeof href !== 'string' || href === '' || hasUrlSchemeOrNetworkPath(href) || href.startsWith('#')) return;
        const hash = href.indexOf('#');
        const clean = hash < 0 ? href : href.slice(0, hash);
        const fragment = hash < 0 ? null : href.slice(hash + 1);
        if (clean.toLowerCase().endsWith('.md')) {
          let targetName: string;
          try {
            targetName = path.posix.normalize(decodeURIComponent(clean));
          } catch {
            return;
          }
          const idx = fileIndexByName.get(targetName);
          if (idx === undefined) return;
          if (fragment !== null) {
            el.properties!.href = `#${fragment}`;
          } else {
            el.properties!.href = `#${fileAnchor(idx)}`;
          }
        }
      }
    });
  }
  return generatedCss;
}

async function decorateSources(
  parses: ParsedSource[],
  sectionsRaw: HastRoot[],
  warn: (message: string) => void,
): Promise<void> {
  for (let i = 0; i < parses.length; i++) {
    const section = sectionsRaw[i]!;
    const file = parses[i]!.file;
    decorateCompactTableCells(section);
    await renderMathPlaceholders(section, file);
    highlightCodeBlocks(section, file, warn);
    insertWordBreakOpportunities(section);
  }
}

async function renderMermaidCodeBlocks(parses: ParsedSource[], sectionsRaw: HastRoot[]): Promise<void> {
  let diagramIndex = 0;
  for (let sectionIndex = 0; sectionIndex < sectionsRaw.length; sectionIndex++) {
    const hast = sectionsRaw[sectionIndex]!;
    const file = parses[sectionIndex]!.file;
    const targets: Array<{ element: Element; index: number; parent: Element | HastRoot; source: string }> = [];
    visit(hast, 'element', (element: Element, index, parent) => {
      if (element.tagName !== 'pre' || typeof index !== 'number' || parent === undefined) return;
      if (element.children.length !== 1) return;
      const code = element.children[0];
      if (code?.type !== 'element' || code.tagName !== 'code') return;
      const classes = code.properties?.className;
      if (!Array.isArray(classes) || !classes.includes('language-mermaid')) return;
      const source = code.children.length === 1 && code.children[0]?.type === 'text'
        ? code.children[0].value
        : null;
      if (source !== null) targets.push({ element, index, parent, source });
    });
    for (const target of targets) {
      const code = target.element.children[0] as Element;
      const line = (code.position?.start.line ?? target.element.position?.start.line ?? 1) + file.lineOffset;
      diagramIndex++;
      let children: ElementContent[];
      try {
        children = await renderMermaidToHast(target.source, `pfpdf-mermaid-${diagramIndex}`);
      } catch (error) {
        if (error instanceof RuntimeError) throw error;
        throw new InputError(`${file.name}:${line}: Mermaid rendering failed: ${(error as Error).message}`);
      }
      const diagram: Element = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['pfpdf-mermaid'] },
        children,
        position: target.element.position,
      };
      (target.parent.children as ElementContent[])[target.index] = diagram;
    }
  }
}

function externalizeMermaidSvgs(sectionsRaw: HastRoot[]): Array<[string, string]> {
  const generatedFiles: Array<[string, string]> = [];
  let diagramIndex = 0;
  for (const section of sectionsRaw) {
    visit(section, 'element', (element: Element) => {
      const classes = element.properties?.className;
      if (element.tagName !== 'div' || !Array.isArray(classes) || !classes.includes('pfpdf-mermaid')) return;
      const svg = element.children.length === 1 && element.children[0]?.type === 'element'
        && element.children[0].tagName === 'svg'
        ? element.children[0]
        : null;
      if (svg === null) return;
      diagramIndex++;
      const logical = `generated/mermaid-${String(diagramIndex).padStart(4, '0')}.svg`;
      generatedFiles.push([logical, toHtml(svg as never)]);
      element.children = [{
        type: 'element',
        tagName: 'img',
        properties: { src: logical, alt: mermaidAccessibleLabel(svg) },
        children: [],
      }];
    });
  }
  return generatedFiles;
}

function mermaidAccessibleLabel(svg: Element): string {
  const direct = svg.properties?.ariaLabel ?? svg.properties?.['aria-label'];
  const directText = propertyStrings(direct).join(' ').trim();
  if (directText !== '') return directText;
  const references = [
    ...propertyStrings(svg.properties?.ariaLabelledBy ?? svg.properties?.['aria-labelledby']),
    ...propertyStrings(svg.properties?.ariaDescribedBy ?? svg.properties?.['aria-describedby']),
  ];
  if (references.length === 0) return 'Mermaid diagram';
  const labels = new Map<string, string>();
  visit(svg, 'element', (element: Element) => {
    const id = element.properties?.id;
    if (typeof id === 'string') labels.set(id, elementText(element).trim());
  });
  const text = references.flatMap((value) => value.split(/\s+/))
    .map((id) => labels.get(id)).filter(Boolean).join(' — ');
  return text === '' ? 'Mermaid diagram' : text;
}

function propertyStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function decorateCompactTableCells(hast: HastRoot): void {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  visit(hast, 'element', (el: Element) => {
    if (el.tagName === 'table') {
      const firstRow = findFirstTableRow(el.children);
      if (firstRow !== null) {
        const columns = firstRow.children.filter(
          (child): child is Element => child.type === 'element' && (child.tagName === 'th' || child.tagName === 'td'),
        ).length;
        if (columns >= 8) addClass(el, 'pfpdf-table-many-columns');
      }
      return;
    }
    if (el.tagName !== 'th' && el.tagName !== 'td') return;
    const text = elementText(el).trim();
    if (text === '') return;
    let length = 0;
    for (const _segment of segmenter.segment(text)) {
      length++;
      if (length > 4) break;
    }
    addClass(el, length <= 4 ? 'pfpdf-table-cell-compact' : 'pfpdf-table-cell-min-4');
  });
}

function findFirstTableRow(children: ElementContent[]): Element | null {
  for (const child of children) {
    if (child.type !== 'element') continue;
    if (child.tagName === 'tr') return child;
    const nested = findFirstTableRow(child.children);
    if (nested !== null) return nested;
  }
  return null;
}

function addClass(el: Element, name: string): void {
  const className = el.properties?.className;
  const classes = Array.isArray(className)
    ? className
    : typeof className === 'string'
      ? [className]
      : [];
  el.properties = { ...el.properties, className: [...classes, name] };
}

function assembleSections(sectionsRaw: HastRoot[]): Element[] {
  return sectionsRaw.map((hast, i) => ({
    type: 'element',
    tagName: 'section',
    properties: { id: fileAnchor(i), className: ['pfpdf-source-file'] },
    children: collapsePageBreaks(hast.children as ElementContent[]),
  }));
}

function elementText(el: Element): string {
  let out = '';
  const walk = (nodes: ElementContent[]): void => {
    for (const n of nodes) {
      if (n.type === 'text') {
        out += n.value;
      } else if (n.type === 'element') {
        if (n.tagName === 'img') {
          const alt = n.properties?.alt;
          if (typeof alt === 'string') out += alt;
        } else {
          walk(n.children);
        }
      }
    }
  };
  walk(el.children);
  return out;
}

function hasUrlSchemeOrNetworkPath(url: string): boolean {
  return url.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
}

function mathPlaceholder(
  value: string,
  display: boolean,
  position: unknown,
): Element {
  const pos = position as { start?: { line?: number } } | undefined;
  return {
    type: 'element',
    tagName: display ? 'div' : 'span',
    properties: {
      className: ['pfpdf-math-src'],
      'data-display': display ? '1' : '0',
      'data-line': String(pos?.start?.line ?? 0),
    },
    children: [{ type: 'text', value }],
  };
}

async function renderMathPlaceholders(hast: HastRoot, file: SourceFile): Promise<void> {
  const targets: Element[] = [];
  visit(hast, 'element', (el: Element) => {
    const cls = el.properties?.className;
    if (Array.isArray(cls) && cls.includes('pfpdf-math-src')) targets.push(el);
  });
  for (const el of targets) {
    const tex = el.children[0]?.type === 'text' ? el.children[0].value : '';
    const display = (el.properties?.['data-display'] ?? el.properties?.dataDisplay) === '1';
    const line = Number(el.properties?.['data-line'] ?? el.properties?.dataLine ?? 0) + file.lineOffset;
    const rendered = await renderMathToHast(tex, display);
    if (rendered.error) {
      throw new InputError(`${file.name}:${line}: TeX error in math expression: ${rendered.error}`);
    }
    el.tagName = display ? 'div' : 'span';
    el.properties = { className: [display ? 'pfpdf-math-display' : 'pfpdf-math-inline'] };
    el.children = rendered.nodes;
  }
}

function highlightCodeBlocks(hast: HastRoot, file: SourceFile, warn: (msg: string) => void): void {
  visit(hast, 'element', (el: Element) => {
    if (el.tagName !== 'code') return;
    const cls = el.properties?.className;
    if (!Array.isArray(cls)) return;
    const langClass = cls.find((c) => typeof c === 'string' && c.startsWith('language-')) as
      | string
      | undefined;
    if (!langClass) return;
    const lang = langClass.slice('language-'.length);
    const code = el.children[0]?.type === 'text' ? el.children[0].value : null;
    if (code === null) return;
    if (!hasLanguage(lang)) {
      const line = (el.position?.start.line ?? 1) + file.lineOffset;
      warn(`${file.name}:${line}: unknown code block language "${lang}"; emitting plain text`);
      return;
    }
    const tree = lowlight.highlight(lang, code);
    el.children = tree.children as ElementContent[];
    el.properties!.className = [...cls, 'hljs'];
  });
}

function isPageBreakMarker(node: ElementContent): boolean {
  if (node.type !== 'element') return false;
  const cls = node.properties?.className;
  return Array.isArray(cls) && cls.includes('pfpdf-page-break-marker');
}

/**
 * Convert page-break markers into `data-pfpdf-page-break` divs, collapsing
 * consecutive directives and dropping ones at the document edges.
 */
function collapsePageBreaks(children: ElementContent[]): ElementContent[] {
  const out: ElementContent[] = [];
  let pending = false;
  for (const node of children) {
    if (isPageBreakMarker(node)) {
      pending = true;
      continue;
    }
    if (node.type === 'text' && node.value.trim() === '') {
      if (!pending) out.push(node);
      continue;
    }
    if (pending && out.length > 0) {
      out.push({
        type: 'element',
        tagName: 'div',
        properties: { 'data-pfpdf-page-break': '' },
        children: [],
      });
    }
    pending = false;
    out.push(node);
  }
  return out;
}
