/** Slide structure layered over the existing Markdown and resource pipeline. */
import type { Heading, Paragraph, PhrasingContent, Root as MdastRoot, RootContent, Text } from 'mdast';
import type { Point } from 'unist';
import type { Root, Element, ElementContent } from 'hast';
import type { SourceFile } from './input.js';
import { InputError } from './errors.js';
import type { IdAllocator, ParsedSource } from './markdown.js';

export interface SlideOptions {
  toc: boolean;
  sectionCovers: boolean;
  lang?: string;
}

// Region names belong to templates. Only `talk` (speaker notes) and `body`
// (return to the slide body) have a meaning here.
const directive = /^ {0,3}::: ([a-z][a-z0-9-]*)[ \t]*$/;
const regionComment = /^pfpdf-region:([a-z][a-z0-9-]*)$/;

/**
 * Split a paragraph or Setext heading at lines that hold only `::: name`.
 * The parsed inline nodes are reused, so references, footnotes, and code
 * spans keep the meaning they have in the whole document.
 */
function splitAtDirectives(file: SourceFile, node: Paragraph | Heading): RootContent[] {
  const result: RootContent[] = [];
  let children: PhrasingContent[] = [];
  const flush = (): void => {
    if (children.some((child) => child.type !== 'text' || child.value.trim() !== '')) result.push({ ...node, children });
    children = [];
  };
  const point = (offset: number): Point => {
    const before = file.content.slice(0, offset);
    return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n'), offset };
  };
  let lineStart = true;
  for (const [index, child] of node.children.entries()) {
    if (child.type !== 'text') {
      children.push(child);
      lineStart = child.type === 'break';
      continue;
    }
    const lines = child.value.split(/\r?\n/);
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    const breaks = start === undefined || end === undefined ? [] : [...file.content.slice(start, end).matchAll(/\r?\n/g)];
    // Later passes read source text through positions, so each piece keeps its own.
    const pushLines = (from: number, to: number): void => {
      const value = lines.slice(from, to).join('\n');
      if (value === '') return;
      const piece: Text = { type: 'text', value };
      if (start !== undefined && end !== undefined && breaks.length === lines.length - 1) {
        const last = breaks[to - 1];
        piece.position = {
          start: point(from === 0 ? start : start + breaks[from - 1]!.index + breaks[from - 1]![0].length),
          end: point(last === undefined ? end : start + last.index),
        };
      }
      children.push(piece);
    };
    let from = 0;
    for (const [i, line] of lines.entries()) {
      const wholeLine = (i > 0 || lineStart) && (i < lines.length - 1 || index === node.children.length - 1);
      const name = wholeLine ? directive.exec(line)?.[1] : undefined;
      if (name === undefined) continue;
      pushLines(from, i);
      flush();
      result.push({ type: 'html', value: `<!--pfpdf-region:${name}-->` });
      from = i + 1;
    }
    if (from === 0) children.push(child);
    else pushLines(from, lines.length);
    lineStart = child.value.endsWith('\n');
  }
  if (result.length === 0) return [node];
  flush();
  return result;
}

/** Turn standalone top-level `::: name` lines into region markers. */
export function prepareSlideDirectives(file: SourceFile, tree: MdastRoot): void {
  const sourceLines = file.content.split(/\r?\n/);
  // Only a Setext heading can span lines; an ATX heading is never a directive.
  const expanded = tree.children.flatMap((node) => node.type === 'paragraph'
    || (node.type === 'heading' && node.position?.start.line !== node.position?.end.line)
    ? splitAtDirectives(file, node) : [node]);
  // Speaker notes do not participate in bibliography, resources, or rendering.
  let talk = false;
  tree.children = expanded.filter((node) => {
    const marker = node.type === 'html' ? /^<!--pfpdf-region:([a-z0-9-]+)-->$/.exec(node.value) : null;
    if (marker) {
      talk = marker[1] === 'talk';
      return !talk;
    }
    if (isSlideBoundary(node, sourceLines)) talk = false;
    return !talk;
  });
}

function isSlideBoundary(node: RootContent, sourceLines: string[]): boolean {
  const line = sourceLines[(node.position?.start.line ?? 0) - 1];
  if (node.type === 'thematicBreak') {
    return line !== undefined && /^_{3,}$/.test(line);
  }
  if (node.type !== 'heading' || node.depth > 2) return false;
  return line !== undefined && /^ {0,3}#{1,2}(?:\s|$)/.test(line);
}

type SlideElement = Element & { properties: NonNullable<Element['properties']> };

function el(tagName: string, className: string, children: ElementContent[] = []): SlideElement {
  return { type: 'element', tagName, properties: { className: [className] }, children };
}
function classes(node: Element, name: string): void {
  node.properties ??= {};
  const old = node.properties.className;
  node.properties.className = [...(Array.isArray(old) ? old : []), name];
}
function significant(node: ElementContent): boolean {
  return node.type !== 'comment' && (node.type !== 'text' || node.value.trim() !== '');
}
function text(node: Element): string {
  return node.children.map((child) => child.type === 'text' ? child.value : child.type === 'element' ? text(child) : '').join('');
}

/**
 * Wrap each named region. Adjacent regions with one name share a group, so a
 * template can place them side by side without knowing the name in advance.
 */
function buildSlideBody(children: ElementContent[]): Element {
  const body = el('div', 'pfpdf-slide-body');
  let target = body;
  for (const child of children) {
    const name = child.type === 'comment' ? regionComment.exec(child.value.trim())?.[1] : undefined;
    if (name === undefined) {
      // Page footnotes belong to the slide, not to the region that happens to be last.
      const names = child.type === 'element' ? child.properties?.className : undefined;
      const footnote = Array.isArray(names) && names.includes('pfpdf-page-footnote');
      (footnote ? body : target).children.push(child);
      continue;
    }
    if (name === 'body') { target = body; continue; }
    target = el('div', 'pfpdf-slide-region');
    target.properties['data-pfpdf-region'] = name;
    const previous = body.children.at(-1);
    const run = previous?.type === 'element' ? previous.properties ?? {} : {};
    if (run['data-pfpdf-regions'] === name) {
      const group = previous as Element;
      group.children.push(target);
      run['data-pfpdf-count'] = String(group.children.length);
    } else if (run['data-pfpdf-region'] === name) {
      const group = el('div', 'pfpdf-slide-regions', [previous as Element, target]);
      group.properties['data-pfpdf-regions'] = name;
      group.properties['data-pfpdf-count'] = '2';
      body.children[body.children.length - 1] = group;
    } else {
      body.children.push(target);
    }
  }
  return body;
}

export function assembleSlides(
  parses: ParsedSource[], roots: Root[], allocator: IdAllocator, options: SlideOptions,
): Element[] {
  const slides: Element[] = [];
  const groups: Element[] = [];
  let pendingGroups: Element[] = [];

  for (const [fileIndex, root] of roots.entries()) {
    const source = parses[fileIndex]!;
    const sourceLines = source.file.content.split(/\r?\n/);
    const boundaries = new Map(source.mdast.children.filter((node) => isSlideBoundary(node, sourceLines))
      .map((node) => [node.position?.start.offset, node.type === 'heading' ? node.depth : 0]));
    let title: Element | undefined;
    let children: ElementContent[] = [];
    let modifiers: Record<string, string> = {};
    let fileAnchored = false;
    const flush = (): void => {
      // A page without a title or content exists only when its layout is named.
      if (!title && !children.some((child) => significant(child)) && modifiers.layout === undefined) {
        children = [];
        return;
      }
      const slide = el('section', 'pfpdf-slide');
      fileAnchored = anchorFile(slide, fileIndex, fileAnchored);
      // Templates give the layout name and every other key their meaning.
      slide.properties['data-pfpdf-slide'] = modifiers.layout ?? 'content';
      for (const [key, value] of Object.entries(modifiers)) {
        if (key !== 'layout') slide.properties[`data-pfpdf-${key}`] = value;
      }
      const body = buildSlideBody(children);
      for (const heading of pendingGroups) {
        classes(heading, 'pfpdf-slide-group-anchor');
        slide.children.push(heading);
      }
      pendingGroups = [];
      if (title) { classes(title, 'pfpdf-slide-title'); slide.children.push(title); }

      slide.children.push(body);
      slides.push(slide);
      title = undefined;
      children = [];
      modifiers = {};
    };
    for (const node of root.children as ElementContent[]) {
      const boundary = boundaries.get(node.position?.start.offset);
      if (node.type === 'element' && boundary === 1) {
        flush();
        groups.push(node);
        if (options.sectionCovers) {
          const slide = el('section', 'pfpdf-slide', [node]);
          slide.properties['data-pfpdf-slide'] = 'section';
          classes(node, 'pfpdf-slide-title');
          fileAnchored = anchorFile(slide, fileIndex, fileAnchored);
          slides.push(slide);
        } else { pendingGroups.push(node); }
      } else if (node.type === 'element' && boundary === 2) {
        flush();
        title = node;
      } else if (node.type === 'element' && Array.isArray(node.properties?.className)
        && node.properties?.className?.includes('pfpdf-page-break-marker')) { flush(); }
      else if (isSlideOptions(node, children)) {
        Object.assign(modifiers, parseSlideOptions(node, source.file));
      } else { children.push(node); }
    }
    flush();
    // Keep source-file navigation valid even for files containing only a group.
    if (!fileAnchored && pendingGroups.length) {
      const anchor = el('span', 'pfpdf-slide-file-anchor');
      anchor.properties.id = `pfpdf-file-${String(fileIndex + 1).padStart(4, '0')}`;
      pendingGroups[0]!.children.unshift(anchor);
    }
  }
  return finishSlides(slides, groups, pendingGroups, allocator, options);
}

function finishSlides(slides: Element[], groups: Element[], pendingGroups: Element[], allocator: IdAllocator, options: SlideOptions): Element[] {
  // Empty groups retain bookmark/link destinations without creating extra pages.
  if (pendingGroups.length && slides.length) {
    for (const heading of pendingGroups) { classes(heading, 'pfpdf-slide-group-anchor'); slides.at(-1)!.children.push(heading); }
  }
  if (!options.toc || groups.length === 0) return slides;
  const agendas = buildAgendas(groups, allocator, options.lang?.startsWith('ja') ?? true);
  if (slides.length === 0 && agendas.length > 0) {
    for (const heading of pendingGroups) { classes(heading, 'pfpdf-slide-group-anchor'); agendas[0]!.children.push(heading); }
  }
  return [...agendas, ...slides];
}

function buildAgendas(headings: Element[], allocator: IdAllocator, japanese: boolean): Element[] {
  const agendas: Element[] = [];
  for (let index = 0; index < headings.length; index += 5) {
    const title = el('h1', 'pfpdf-slide-title', [{ type: 'text', value: japanese ? '目次' : 'Agenda' }]);
    title.properties.id = allocator.allocate('pfpdf-slide-agenda');
    const list = el('ol', 'pfpdf-slide-agenda', headings.slice(index, index + 5).map((heading) => {
      const link = el('a', 'pfpdf-slide-agenda-link', [{ type: 'text', value: text(heading) }]);
      link.properties.href = `#${String(heading.properties?.id)}`;
      return el('li', 'pfpdf-slide-agenda-entry', [link]);
    }));
    list.properties.start = index + 1;
    const slide = el('section', 'pfpdf-slide', [title, el('div', 'pfpdf-slide-body', [list])]);
    slide.properties['data-pfpdf-slide'] = 'agenda';
    agendas.push(slide);
  }
  return agendas;
}

function anchorFile(slide: SlideElement, index: number, anchored: boolean): boolean {
  if (!anchored) slide.properties.id = `pfpdf-file-${String(index + 1).padStart(4, '0')}`;
  return true;
}

function isSlideOptions(node: ElementContent, children: ElementContent[]): boolean {
  return node.type === 'comment' && /^\s*pfpdf:/.test(node.value) && !children.some((child) => significant(child));
}

/** Read `key=value` tokens. Values pass through whole; templates give them meaning. */
function parseSlideOptions(node: ElementContent, file: SourceFile): Record<string, string> {
  const result: Record<string, string> = {};
  if (node.type !== 'comment') return result;
  for (const token of node.value.replace(/^\s*pfpdf:/, '').split(/\s+/).filter(Boolean)) {
    const match = /^([a-z][a-z0-9-]*)=(.+)$/.exec(token);
    // `slide` would collide with the attribute that carries the layout name.
    if (!match || match[1] === 'slide') {
      const line = (node.position?.start.line ?? 1) + file.lineOffset;
      throw new InputError(`${file.path}:${line}: invalid slide option: ${token} (expected key=value)`);
    }
    result[match[1]!] = match[2]!;
  }
  return result;
}
