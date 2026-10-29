/**
 * ELK layout for build-time Mermaid.
 *
 * pfpdf lays out Mermaid diagrams with ELK unless a diagram selects another
 * layout through Mermaid's own configuration (front matter `config.layout` or
 * an init directive), following Mermaid's site config / diagram config
 * precedence. ELK is pure JavaScript, so the SVG is still generated in the
 * Markdown pipeline without a browser (DD-28).
 */
import elkLayouts from '@mermaid-js/layout-elk';
import { JSDOM } from 'jsdom';
import type MermaidRuntime from 'isomorphic-mermaid';
import type { LayoutData } from 'mermaid';

type LayoutLoader = Parameters<typeof MermaidRuntime.registerLayoutLoaders>[0][number];

/** Built-ins that the GWT-compiled ELK engine reads through `window`. */
const ELK_WINDOW_GLOBALS = ['Error', 'Math', 'Object', 'Array', 'String', 'Number', 'Date', 'JSON', 'RegExp'];

let parserWindow: unknown;

/**
 * ELK's adapter indexes nodes with plain objects. Inherited keys such as
 * `constructor` otherwise collide with its subgraph child arrays. Rename only
 * those layout IDs, preserving labels, DOM IDs, styles, and source text.
 */
function escapeElkIds(data: LayoutData): LayoutData {
  const used = new Set(data.nodes.map((node) => node.id));
  const replacements = new Map<string, string>();
  let index = 0;
  for (const id of used) {
    if (!Object.hasOwn(Object.prototype, id)) continue;
    let replacement: string;
    do {
      replacement = `pfpdf-elk-node-${++index}`;
    } while (used.has(replacement));
    replacements.set(id, replacement);
    used.add(replacement);
  }
  if (replacements.size === 0) return data;

  const replace = (id: string): string => replacements.get(id) ?? id;
  return {
    ...data,
    nodes: data.nodes.map((node) => ({
      ...node,
      id: replace(node.id),
      ...(node.parentId === undefined ? {} : { parentId: replace(node.parentId) }),
    })),
    edges: data.edges.map((edge) => ({
      ...edge,
      ...(edge.start === undefined ? {} : { start: replace(edge.start) }),
      ...(edge.end === undefined ? {} : { end: replace(edge.end) }),
      ...(edge.parentId === undefined ? {} : { parentId: replace(edge.parentId) }),
    })),
  };
}

/**
 * @mermaid-js/layout-elk bundles its own Mermaid rendering code, including a
 * DOMPurify instance that binds to `window` when the layout chunk is first
 * evaluated. isomorphic-mermaid sets `window` to the svgdom window, which
 * cannot parse HTML, so labels containing `<br/>` were sanitized to empty
 * strings. Evaluate the chunk with a jsdom window, as isomorphic-mermaid does
 * for Mermaid's own DOMPurify, and restore the svgdom window afterwards.
 */
function withParserWindow(load: LayoutLoader['loader']): LayoutLoader['loader'] {
  return async () => {
    const scope = globalThis as unknown as { window: unknown };
    const svgWindow = scope.window;
    parserWindow ??= new JSDOM('').window;
    scope.window = parserWindow;
    try {
      const renderer = await load();
      return {
        render: (data, ...args) => renderer.render(escapeElkIds(data), ...args),
      };
    } finally {
      scope.window = svgWindow;
    }
  };
}

let primed = false;

/**
 * The ELK renderer copies Mermaid's config into its bundled Mermaid only in
 * its prepare step, after subgraph titles of the first diagram were already
 * measured with that copy's defaults (HTML labels on). svgdom cannot measure
 * HTML, so the first diagram with a subgraph failed. Render one diagram
 * without subgraphs after initialize() so the copy holds pfpdf's config.
 */
export async function primeElkRenderer(mermaid: typeof MermaidRuntime): Promise<void> {
  if (primed) return;
  await mermaid.render('pfpdf-mermaid-elk-prime', 'flowchart LR\n  A --> B');
  primed = true;
}

/** Registers ELK layouts with the bundled Mermaid runtime. */
export function registerElkLayouts(mermaid: typeof MermaidRuntime): void {
  const svgWindow = (globalThis as unknown as { window?: Record<string, unknown> }).window;
  if (svgWindow !== undefined) {
    for (const name of ELK_WINDOW_GLOBALS) svgWindow[name] ??= (globalThis as Record<string, unknown>)[name];
  }
  mermaid.registerLayoutLoaders(elkLayouts.map((layout) => ({ ...layout, loader: withParserWindow(layout.loader) })));
}
