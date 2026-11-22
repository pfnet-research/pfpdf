/** Slide structure layered over the existing Markdown and resource pipeline. */
import type { Root as MdastRoot, RootContent } from 'mdast';
import type { Root, Element, ElementContent } from 'hast';
import { visit } from 'unist-util-visit';
import type { SourceFile } from './input.js';
import { createMarkdownParser } from './markdown-parser.js';
import type { IdAllocator, ParsedSource } from './markdown.js';

export interface SlideOptions {
  toc: boolean;
  sectionCovers: boolean;
  lang?: string;
}

// Region names belong to templates. Only `talk` (speaker notes) and `body`
// (return to the slide body) have a meaning here.
const directive = /^ {0,3}::: ([a-z][a-z-]*)[ \t]*$/;
const regionComment = /^pfpdf-region:([a-z][a-z-]*)$/;

/** Split top-level paragraph directives without changing source coordinates. */
export function prepareSlideDirectives(file: SourceFile, tree: MdastRoot): void {
  const expanded: RootContent[] = [];
  const sourceLines = file.content.split(/\r?\n/);
  for (const node of tree.children) {
    if (node.type !== 'paragraph' || node.position?.start.offset === undefined || node.position.end.offset === undefined) {
      expanded.push(node);
      continue;
    }
    const start = node.position.start.offset;
    const source = file.content.slice(start, node.position.end.offset);
    const lines = source.split('\n');
    let cursor = start;
    let chunk = start;
    const append = (end: number): void => {
      if (end <= chunk) return;
      const fragment = createMarkdownParser().parse(file.content.slice(chunk, end));
      const prefix = file.content.slice(0, chunk);
      const lineOffset = prefix.split('\n').length - 1;
      const columnOffset = chunk - (prefix.lastIndexOf('\n') + 1);
      visit(fragment, (child) => {
        if (!child.position) return;
        for (const point of [child.position.start, child.position.end]) {
          if (point.line === 1) point.column += columnOffset;
          point.line += lineOffset;
          if (point.offset !== undefined) point.offset += chunk;
        }
      });
      expanded.push(...fragment.children);
    };
    for (const line of lines) {
      const match = directive.exec(line.replace(/\r$/, ''));
      if (match) {
        append(cursor);
        expanded.push({ type: 'html', value: `<!--pfpdf-region:${match[1]}-->` });
        chunk = cursor + line.length + 1;
      }
      cursor += line.length + 1;
    }
    append(node.position.end.offset);
  }
  // Speaker notes do not participate in bibliography, resources, or rendering.
  let talk = false;
  tree.children = expanded.filter((node) => {
    const marker = node.type === 'html' ? /^<!--pfpdf-region:([a-z-]+)-->$/.exec(node.value) : null;
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
    if (name === undefined) { target.children.push(child); continue; }
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
        if (key !== 'layout' && key !== 'slide') slide.properties[`data-pfpdf-${key}`] = value;
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
        Object.assign(modifiers, parseSlideOptions(node));
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

function parseSlideOptions(node: ElementContent): Record<string, string> {
  const result: Record<string, string> = {};
  if (node.type === 'comment') {
    for (const match of node.value.matchAll(/([a-z][a-z-]*)=([a-z0-9-]+)/g)) result[match[1]!] = match[2]!;
  }
  return result;
}
