import { fromHtml } from 'hast-util-from-html';
import type { Element, ElementContent, Root as HastRoot } from 'hast';
import type MermaidRuntime from 'isomorphic-mermaid';
import { RuntimeError } from './errors.js';

interface CssRuleLike {
  cssText: string;
}

/** Minimal constructable stylesheet API required by Mermaid 11.15+. */
class ServerCssStyleSheet {
  readonly cssRules: CssRuleLike[] = [];

  insertRule(rule: string, index = this.cssRules.length): number {
    this.cssRules.splice(index, 0, { cssText: rule });
    return index;
  }

  replaceSync(css: string): void {
    this.cssRules.splice(0, this.cssRules.length, { cssText: css });
  }
}

let runtimePromise: Promise<typeof MermaidRuntime> | null = null;
let renderQueue: Promise<unknown> = Promise.resolve();

async function loadRuntime(): Promise<typeof MermaidRuntime> {
  runtimePromise ??= import('isomorphic-mermaid')
    .then((module) => module.default)
    .catch((error: unknown) => {
      runtimePromise = null;
      throw new RuntimeError(`bundled Mermaid runtime failed to load: ${(error as Error).message}`);
    });
  return runtimePromise;
}

function installStyleSheetPolyfill(): void {
  if ('CSSStyleSheet' in globalThis) return;
  Object.defineProperty(globalThis, 'CSSStyleSheet', {
    configurable: true,
    writable: true,
    value: ServerCssStyleSheet,
  });
}

function normalizeGeneratedIds(svg: Element, rootId: string): void {
  const replacements = new Map<string, string>();
  let index = 0;
  const collect = (element: Element): void => {
    const value = element.properties?.id;
    if (typeof value === 'string' && value !== rootId && !replacements.has(value)) {
      index++;
      replacements.set(value, `${rootId}-element-${String(index).padStart(4, '0')}`);
    }
    for (const child of element.children) {
      if (child.type === 'element') collect(child);
    }
  };
  collect(svg);

  const entries = [...replacements.entries()];
  const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const replaceReferences = (value: string): string => {
    let result = value;
    for (let i = 0; i < entries.length; i++) {
      const [oldId] = entries[i]!;
      result = result.replaceAll(`url(#${oldId})`, `url(#__PFPDF_MERMAID_ID_${i}__)`);
      result = result.replace(
        new RegExp(`#${escapeRegExp(oldId)}(?=[^A-Za-z0-9_-]|$)`, 'g'),
        `#__PFPDF_MERMAID_ID_${i}__`,
      );
    }
    for (let i = 0; i < entries.length; i++) {
      result = result.replaceAll(`__PFPDF_MERMAID_ID_${i}__`, entries[i]![1]);
    }
    return result.replace(/\S+/g, (token) => replacements.get(token) ?? token);
  };
  const rewrite = (element: Element): void => {
    for (const [name, value] of Object.entries(element.properties ?? {})) {
      if (name === 'id' && typeof value === 'string') {
        element.properties![name] = replacements.get(value) ?? value;
      } else if (typeof value === 'string') {
        element.properties![name] = replaceReferences(value);
      } else if (Array.isArray(value)) {
        element.properties![name] = value.map(
          (item) => typeof item === 'string' ? replaceReferences(item) : item,
        );
      }
    }
    for (const child of element.children) {
      if (child.type === 'element') rewrite(child);
      else if (element.tagName === 'style' && child.type === 'text') child.value = replaceReferences(child.value);
    }
  };
  rewrite(svg);
}

async function render(source: string, id: string): Promise<Element> {
  installStyleSheetPolyfill();
  const mermaid = await loadRuntime();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    fontFamily: 'Noto Sans JP, Noto Sans, sans-serif',
    flowchart: { useMaxWidth: true },
    suppressErrorRendering: true,
    theme: 'default',
  });
  const { svg } = await mermaid.render(id, source);
  const root = fromHtml(svg, { fragment: true }) as HastRoot;
  const element = root.children.find(
    (node): node is Element => node.type === 'element' && node.tagName === 'svg',
  );
  if (element === undefined) throw new RuntimeError('bundled Mermaid runtime returned no SVG');
  normalizeGeneratedIds(element, id);
  return element;
}

/** Mermaid owns process-global DOM/config state, so serialize render calls. */
export function renderMermaidToHast(source: string, id: string): Promise<ElementContent[]> {
  const result = renderQueue.then(async () => [await render(source, id)] as ElementContent[]);
  renderQueue = result.then(() => null, () => null);
  return result;
}
