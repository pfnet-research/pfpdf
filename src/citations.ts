/** TeX-style citation syntax and semantic HAST rendering. */
import type { Element, ElementContent, Root as HastRoot } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import { InputError } from './errors.js';
import type { CitationCluster, PreparedBibliography } from './bibliography.js';
import type { SourceFile } from './input.js';

export interface CitationNode {
  type: 'pfpdfCitation';
  clusterId: string;
  keys: string[];
  position?: MdastRoot['position'];
}

interface IdAllocatorLike {
  allocate(base: string): string;
}

interface MutableMdastParent {
  type: string;
  children: MutableMdastNode[];
}

interface MutableMdastNode {
  type: string;
  value?: string;
  position?: MdastRoot['position'];
  children?: MutableMdastNode[];
  clusterId?: string;
  keys?: string[];
}

export function transformCitationSyntax(
  file: SourceFile,
  tree: MdastRoot,
): { citations: CitationCluster[]; bibliographyMarkers: number } {
  const citations: CitationCluster[] = [];
  let bibliographyMarkers = 0;
  let clusterNumber = 0;
  const root = tree as unknown as MutableMdastParent;

  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i]!;
    if (child.type !== 'paragraph' || child.children?.length !== 1) continue;
    const only = child.children[0]!;
    if (only.type !== 'text' || typeof only.value !== 'string' || only.value.trim() !== '\\printbibliography') {
      continue;
    }
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    const raw = typeof start === 'number' && typeof end === 'number'
      ? file.content.slice(start, end).trim()
      : only.value.trim();
    if (raw !== '\\printbibliography') continue;
    root.children[i] = { type: 'pfpdfBibliographyMarker', position: child.position };
    bibliographyMarkers++;
  }

  const walk = (parent: MutableMdastParent, inHeading: boolean, inLink: boolean): void => {
    let rawHtmlDepth = 0;
    for (let i = 0; i < parent.children.length; i++) {
      const node = parent.children[i]!;
      if (node.type === 'html' && typeof node.value === 'string') {
        rawHtmlDepth = Math.max(0, rawHtmlDepth + inlineHtmlDepthDelta(node.value));
        continue;
      }
      if (rawHtmlDepth > 0) continue;
      const heading = inHeading || node.type === 'heading';
      const link = inLink || node.type === 'link' || node.type === 'linkReference';
      if (node.type === 'text' && typeof node.value === 'string') {
        const replacements = splitCitationText(file, node, () => {
          clusterNumber++;
          const sourceId = Buffer.from(file.name, 'utf8').toString('base64url');
          return `pfpdf-citation-${sourceId}-${clusterNumber}`;
        });
        if (replacements.citations.length > 0 && (heading || link)) {
          const line = (node.position?.start.line ?? 1) + file.lineOffset;
          throw new InputError(
            `${file.name}:${line}: citations are not allowed in ${heading ? 'headings' : 'links'}`,
          );
        }
        if (replacements.nodes !== null) {
          parent.children.splice(i, 1, ...replacements.nodes);
          i += replacements.nodes.length - 1;
          citations.push(...replacements.citations);
        }
        continue;
      }
      if (node.children !== undefined) walk(node as MutableMdastParent, heading, link);
    }
  };
  walk(root, false, false);
  return { citations, bibliographyMarkers };
}

function inlineHtmlDepthDelta(value: string): number {
  const voidElements = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
    'param', 'source', 'track', 'wbr',
  ]);
  let delta = 0;
  const tagPattern = /<\s*(\/)?\s*([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(value)) !== null) {
    const name = match[2]!.toLowerCase();
    if (match[1] !== undefined) delta--;
    else if (!voidElements.has(name) && !/\/\s*>$/.test(match[0])) delta++;
  }
  return delta;
}

function splitCitationText(
  file: SourceFile,
  node: MutableMdastNode,
  nextId: () => string,
): { nodes: MutableMdastNode[] | null; citations: CitationCluster[] } {
  const value = node.value ?? '';
  if (!value.includes('\\cite{')) return { nodes: null, citations: [] };
  const startOffset = node.position?.start.offset;
  const endOffset = node.position?.end.offset;
  const raw = typeof startOffset === 'number' && typeof endOffset === 'number'
    ? file.content.slice(startOffset, endOffset)
    : value;
  const escapeFlags: boolean[] = [];
  const rawPattern = /(\\+)cite\{/g;
  let rawMatch: RegExpExecArray | null;
  while ((rawMatch = rawPattern.exec(raw)) !== null) {
    escapeFlags.push(rawMatch[1]!.length % 2 === 0);
  }

  const output: MutableMdastNode[] = [];
  const citations: CitationCluster[] = [];
  let search = 0;
  let emitted = 0;
  let occurrence = 0;
  while (true) {
    const command = value.indexOf('\\cite{', search);
    if (command < 0) break;
    const escaped = escapeFlags[occurrence] ?? false;
    occurrence++;
    if (escaped) {
      search = command + '\\cite{'.length;
      continue;
    }
    const close = value.indexOf('}', command + '\\cite{'.length);
    const line = (node.position?.start.line ?? 1) + file.lineOffset;
    if (close < 0) throw new InputError(`${file.name}:${line}: unclosed \\cite command`);
    const body = value.slice(command + '\\cite{'.length, close);
    const keys = parseCitationKeys(file.name, line, body);
    if (command > emitted) output.push({ type: 'text', value: value.slice(emitted, command) });
    const id = nextId();
    const citation: CitationCluster = { id, keys, sourceName: file.name, line };
    output.push({ type: 'pfpdfCitation', clusterId: id, keys, position: node.position });
    citations.push(citation);
    emitted = close + 1;
    search = close + 1;
  }
  if (citations.length === 0) return { nodes: null, citations: [] };
  if (emitted < value.length) output.push({ type: 'text', value: value.slice(emitted) });
  return { nodes: output, citations };
}

function parseCitationKeys(sourceName: string, line: number, body: string): string[] {
  if (body.includes('{')) {
    throw new InputError(`${sourceName}:${line}: nested braces in \\cite are not supported`);
  }
  const keys = body.split(',').map((key) => key.trim());
  const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_:.#$%&+?<>~/-]*$/;
  if (keys.some((key) => !keyPattern.test(key))) {
    throw new InputError(`${sourceName}:${line}: invalid or empty bibliography key in \\cite`);
  }
  if (new Set(keys).size !== keys.length) {
    throw new InputError(`${sourceName}:${line}: duplicate bibliography key in one \\cite`);
  }
  return keys;
}

function addClass(element: Element, name: string): void {
  const className = element.properties?.className;
  const classes = Array.isArray(className)
    ? className
    : typeof className === 'string'
      ? [className]
      : [];
  element.properties = { ...element.properties, className: [...classes, name] };
}

export function renderBibliography(
  roots: HastRoot[],
  clusters: CitationCluster[],
  prepared: PreparedBibliography,
  allocator: IdAllocatorLike,
  hasMarker: boolean,
): void {
  const refsId = allocator.allocate('refs');
  const entryIdByKey = new Map<string, string>();
  const numberByKey = new Map<string, number>();
  for (let i = 0; i < prepared.entryOrder.length; i++) {
    const key = prepared.entryOrder[i]!;
    const encoded = Buffer.from(key, 'utf8').toString('base64url');
    entryIdByKey.set(key, allocator.allocate(`pfpdf-bib-${encoded}`));
    numberByKey.set(key, i + 1);
  }

  const clusterById = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const backlinksByKey = new Map<string, Array<{ id: string; label: string }>>();
  const markerLocations: Array<{ children: ElementContent[]; index: number }> = [];
  const walk = (children: ElementContent[]): void => {
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (child.type !== 'element') continue;
      const citationId = child.properties?.['data-pfpdf-citation'] ?? child.properties?.dataPfpdfCitation;
      if (typeof citationId === 'string') {
        const cluster = clusterById.get(citationId);
        if (cluster === undefined) throw new InputError(`internal citation cluster not found: ${citationId}`);
        children[i] = citationElement(cluster, entryIdByKey, numberByKey, backlinksByKey, allocator);
        continue;
      }
      const marker = child.properties?.['data-pfpdf-bibliography-marker'] ??
        child.properties?.dataPfpdfBibliographyMarker;
      if (marker !== undefined) {
        markerLocations.push({ children, index: i });
        continue;
      }
      walk(child.children);
    }
  };
  for (const root of roots) walk(root.children as ElementContent[]);

  const container = bibliographyElement(prepared, entryIdByKey, backlinksByKey, refsId);
  if (hasMarker) {
    const markerLocation = markerLocations[0];
    if (markerLocation === undefined) throw new InputError('internal bibliography marker was not rendered');
    markerLocation.children[markerLocation.index] = container;
  } else {
    const last = roots.at(-1);
    if (last === undefined) throw new InputError('cannot append bibliography to an empty document');
    (last.children as ElementContent[]).push(container);
  }
}

function citationElement(
  cluster: CitationCluster,
  entryIdByKey: Map<string, string>,
  numberByKey: Map<string, number>,
  backlinksByKey: Map<string, Array<{ id: string; label: string }>>,
  allocator: IdAllocatorLike,
): Element {
  const children: ElementContent[] = [{ type: 'text', value: '[' }];
  const orderedKeys = [...cluster.keys].sort((left, right) => {
    return (numberByKey.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (numberByKey.get(right) ?? Number.MAX_SAFE_INTEGER);
  });
  for (let i = 0; i < orderedKeys.length; i++) {
    const key = orderedKeys[i]!;
    const entryId = entryIdByKey.get(key);
    const number = numberByKey.get(key);
    if (entryId === undefined || number === undefined) {
      throw new InputError(`internal bibliography entry not found: ${key}`);
    }
    if (i > 0) children.push({ type: 'text', value: ', ' });
    const anchorId = allocator.allocate(`${cluster.id}-${i + 1}`);
    children.push({
      type: 'element',
      tagName: 'a',
      properties: {
        id: anchorId,
        href: `#${entryId}`,
        className: ['pfpdf-citation-link'],
        role: 'doc-biblioref',
      },
      children: [{ type: 'text', value: String(number) }],
    });
    const backlinks = backlinksByKey.get(key) ?? [];
    backlinks.push({ id: anchorId, label: `${cluster.sourceName}:${cluster.line}` });
    backlinksByKey.set(key, backlinks);
  }
  children.push({ type: 'text', value: ']' });
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['pfpdf-citation'] },
    children,
  };
}

function bibliographyElement(
  prepared: PreparedBibliography,
  entryIdByKey: Map<string, string>,
  backlinksByKey: Map<string, Array<{ id: string; label: string }>>,
  refsId: string,
): Element {
  const entries: Element[] = [];
  for (const key of prepared.entryOrder) {
    const entry = prepared.entries.get(key);
    const entryId = entryIdByKey.get(key);
    if (entry === undefined || entryId === undefined) {
      throw new InputError(`internal rendered bibliography entry not found: ${key}`);
    }
    addClass(entry, 'pfpdf-bibliography-entry');
    entry.properties = { ...entry.properties, id: entryId };
    const backlinks = backlinksByKey.get(key) ?? [];
    if (backlinks.length > 0) entry.children.push(backlinksElement(backlinks));
    entries.push(entry);
  }
  return {
    type: 'element',
    tagName: 'div',
    properties: {
      id: refsId,
      className: ['pfpdf-bibliography', 'csl-bib-body'],
      role: 'doc-bibliography',
    },
    children: entries,
  };
}

function backlinksElement(backlinks: Array<{ id: string; label: string }>): Element {
  const children: ElementContent[] = [{ type: 'text', value: ' ' }];
  for (let i = 0; i < backlinks.length; i++) {
    if (i > 0) children.push({ type: 'text', value: ' ' });
    const backlink = backlinks[i]!;
    children.push({
      type: 'element',
      tagName: 'a',
      properties: {
        href: `#${backlink.id}`,
        className: ['pfpdf-bibliography-backlink'],
        ariaLabel: `Back to citation ${backlink.label}`,
        role: 'doc-backlink',
      },
      children: [{ type: 'text', value: '↩' }],
    });
  }
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['pfpdf-bibliography-backlinks'] },
    children,
  };
}
