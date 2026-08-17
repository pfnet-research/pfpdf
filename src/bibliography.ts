/** BibTeX parsing and CSL formatting, isolated from the Markdown pipeline. */
import { Cite, plugins, type CslItem } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-csl';
import { fromHtml } from 'hast-util-from-html';
import type { Element, Root as HastRoot } from 'hast';
import { InputError } from './errors.js';
import type { BibliographyFile } from './input.js';

export interface CitationCluster {
  id: string;
  keys: string[];
  sourceName: string;
  line: number;
}

export interface PreparedBibliography {
  entryOrder: string[];
  entries: Map<string, Element>;
}

function parseBib(content: string, source: string): CslItem[] {
  try {
    return new Cite(content).data;
  } catch (e) {
    throw new InputError(`${source}: invalid BibTeX: ${(e as Error).message}`);
  }
}

function validateItemIds(items: CslItem[], source: string): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (typeof item.id !== 'string' || item.id === '') {
      throw new InputError(`${source}: BibTeX entry has no citation key`);
    }
    ids.push(item.id);
  }
  return ids;
}

function entryElement(html: string, key: string): Element {
  const root = fromHtml(html, { fragment: true }) as HastRoot;
  const element = root.children.find((child): child is Element => child.type === 'element');
  if (element === undefined) {
    throw new InputError(`bibliography formatter returned no HTML for key ${JSON.stringify(key)}`);
  }
  return element;
}

/**
 * Parse all databases and run one citeproc session for the complete document.
 * Citation display nodes are built later, after final HTML IDs are allocated.
 */
export function prepareBibliography(
  files: BibliographyFile[],
  clusters: CitationCluster[],
): PreparedBibliography | null {
  if (clusters.length === 0 && files.length === 0) return null;
  if (files.length === 0) {
    const first = clusters[0]!;
    throw new InputError(`${first.sourceName}:${first.line}: \\cite requires bibliography front matter`);
  }

  const ownerByKey = new Map<string, string>();
  for (const file of files) {
    const ids = validateItemIds(parseBib(file.content, file.path), file.path);
    for (const id of ids) {
      const previous = ownerByKey.get(id);
      if (previous !== undefined) {
        throw new InputError(
          `duplicate bibliography key ${JSON.stringify(id)} in ${previous} and ${file.path}`,
        );
      }
      ownerByKey.set(id, file.path);
    }
  }

  if (clusters.length === 0) return null;

  for (const cluster of clusters) {
    for (const key of cluster.keys) {
      if (!ownerByKey.has(key)) {
        throw new InputError(
          `${cluster.sourceName}:${cluster.line}: bibliography key not found: ${JSON.stringify(key)}`,
        );
      }
    }
  }

  // Parse the concatenated database again so @string and crossref may cross file boundaries.
  const combined = files.map((file) => file.content).join('\n');
  const data = parseBib(combined, files.map((file) => file.path).join(', ')).map((item) => {
    const clean = { ...item };
    delete clean['_graph'];
    return clean;
  });

  try {
    const config = plugins.config.get('@csl');
    const engine = config.engine(data, 'vancouver', 'en-US', 'html');
    const citations = clusters.map((cluster) => ({
      citationID: cluster.id,
      citationItems: cluster.keys.map((id) => ({ id })),
      properties: { noteIndex: 0 },
    }));
    engine.rebuildProcessorState(citations, 'html', []);
    const result = engine.makeBibliography();
    if (result === false) throw new Error('selected CSL style has no bibliography');
    const [params, bodies] = result;
    if (params.bibliography_errors.length > 0) {
      throw new Error(`CSL bibliography errors: ${JSON.stringify(params.bibliography_errors)}`);
    }
    if (params.entry_ids.length !== bodies.length) {
      throw new Error('CSL entry IDs and rendered entries have different lengths');
    }
    const entryOrder: string[] = [];
    const entries = new Map<string, Element>();
    for (let i = 0; i < bodies.length; i++) {
      const key = params.entry_ids[i]?.[0];
      if (key === undefined) throw new Error(`CSL entry ${i + 1} has no ID`);
      entryOrder.push(key);
      entries.set(key, entryElement(bodies[i]!, key));
    }
    return { entryOrder, entries };
  } catch (e) {
    if (e instanceof InputError) throw e;
    throw new InputError(`cannot format bibliography: ${(e as Error).message}`);
  }
}
