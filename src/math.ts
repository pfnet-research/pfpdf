/** MathJax server-side rendering of TeX to SVG. */
import { fromHtml } from 'hast-util-from-html';
import type { ElementContent } from 'hast';

interface MathResult {
  nodes: ElementContent[];
  error: string | null;
}

interface MathDocument {
  convert: (tex: string, options: { display: boolean }) => unknown;
  adaptor: { outerHTML: (node: unknown) => string };
}

let mathDocumentPromise: Promise<MathDocument> | null = null;

function init(): Promise<MathDocument> {
  mathDocumentPromise ??= createMathDocument();
  return mathDocumentPromise;
}

async function createMathDocument(): Promise<MathDocument> {
  const { mathjax } = await import('mathjax-full/js/mathjax.js');
  const { TeX } = await import('mathjax-full/js/input/tex.js');
  const { SVG } = await import('mathjax-full/js/output/svg.js');
  const { liteAdaptor } = await import('mathjax-full/js/adaptors/liteAdaptor.js');
  const { RegisterHTMLHandler } = await import('mathjax-full/js/handlers/html.js');
  const { AllPackages } = await import('mathjax-full/js/input/tex/AllPackages.js');
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({ packages: AllPackages });
  // Paged renderers clone SVG into page-area DOMs.  Fragment-based glyph
  // caches (<use href="#...">) can then point at definitions outside the
  // clone and render as empty shapes.  Inline every glyph path so the final
  // document remains self-contained after pagination.
  const svg = new SVG({ fontCache: 'none' });
  const doc = mathjax.document('', { InputJax: tex, OutputJax: svg });
  return {
    convert: (t: string, options: { display: boolean }): unknown => doc.convert(t, options) as unknown,
    adaptor: { outerHTML: (node: unknown) => adaptor.outerHTML(node as never) },
  };
}

export async function renderMathToHast(tex: string, display: boolean): Promise<MathResult> {
  const doc = await init();
  const node = doc.convert(tex, { display });
  const html = doc.adaptor.outerHTML(node);
  const errMatch = /data-mjx-error="([^"]*)"/.exec(html);
  if (errMatch) {
    return { nodes: [], error: decodeEntities(errMatch[1]!) };
  }
  const root = fromHtml(html, { fragment: true }) as unknown as { children: ElementContent[] };
  return { nodes: root.children, error: null };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
