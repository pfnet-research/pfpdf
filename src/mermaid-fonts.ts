/**
 * Text metrics for build-time Mermaid layout.
 *
 * svgdom measures SVG text with fontkit, but it ships only Open Sans and maps
 * one font file per family. Japanese labels therefore fall back to the Open
 * Sans .notdef advance and the layout reserves too little width. The bundled
 * Noto Sans JP ships as unicode-range subsets in `resources/fonts`, so this
 * module exposes them to svgdom as one fontkit-compatible font that picks the
 * subset per code point. It reads only shipped files: the layout stays
 * deterministic and independent of host fonts and browsers (DD-28).
 */
import fs from 'node:fs';
import path from 'node:path';
import { openSync, type Font } from 'fontkit';
import { Element, SVGGraphicsElement, getFonts, setFontFamilyMappings } from 'svgdom';
import { RuntimeError } from './errors.js';
import { resourcePath } from './template.js';

/** Family name used for both Mermaid layout and the generated SVG. */
export const MERMAID_MEASURE_FAMILY = 'Noto Sans JP';

/** Shipped @font-face list for the measurement font (scripts/copy-resources.mjs). */
const MEASURE_CSS = 'noto-sans-jp-400.css';

interface Subset {
  file: string;
  ranges: Array<[number, number]>;
  font?: Font;
}

interface MeasureGlyph {
  advanceWidth: number;
}

/** Duck-typed subset of Font that svgdom's textBBox reads. */
class SubsetFont {
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
  readonly xHeight: number;
  readonly capHeight: number;

  constructor(private readonly subsets: Subset[], private readonly base: Font) {
    this.unitsPerEm = base.unitsPerEm;
    this.ascent = base.ascent;
    this.descent = base.descent;
    this.lineGap = base.lineGap;
    this.xHeight = base.xHeight;
    this.capHeight = base.capHeight;
  }

  /** Lays out runs that share a subset so kerning inside a run is kept. */
  layout(text: string): { glyphs: MeasureGlyph[] } {
    const glyphs: MeasureGlyph[] = [];
    let run = '';
    let runFont: Font | undefined;
    const flush = (): void => {
      if (run === '') return;
      const font = runFont ?? this.base;
      const scale = this.unitsPerEm / font.unitsPerEm;
      for (const glyph of font.layout(run).glyphs) glyphs.push({ advanceWidth: glyph.advanceWidth * scale });
      run = '';
    };
    for (const char of text) {
      const font = this.fontFor(char.codePointAt(0)!);
      if (font !== runFont) {
        flush();
        runFont = font;
      }
      run += char;
    }
    flush();
    return { glyphs };
  }

  private fontFor(codePoint: number): Font | undefined {
    for (const subset of this.subsets) {
      if (!subset.ranges.some(([start, end]) => codePoint >= start && codePoint <= end)) continue;
      subset.font ??= openFont(subset.file);
      if (subset.font.hasGlyphForCodePoint(codePoint)) return subset.font;
    }
    return undefined;
  }
}

function openFont(file: string): Font {
  try {
    return openSync(file) as Font;
  } catch (e) {
    throw new RuntimeError(`bundled Mermaid font is broken: ${file}: ${(e as Error).message}`);
  }
}

function parseRanges(value: string): Array<[number, number]> {
  return value.split(',').map((part) => {
    const [start, end] = part.trim().replace(/^U\+/i, '').split('-');
    const first = Number.parseInt(start!, 16);
    return [first, end === undefined ? first : Number.parseInt(end, 16)];
  });
}

/**
 * Reads the subsets from the shipped `resources/fonts` CSS rather than from
 * @fontsource, which is a build-time dependency only.
 */
function loadSubsetFont(): SubsetFont {
  const fontsDir = resourcePath('fonts');
  const cssFile = path.join(fontsDir, MEASURE_CSS);
  let css: string;
  try {
    css = fs.readFileSync(cssFile, 'utf8');
  } catch (e) {
    throw new RuntimeError(`bundled Mermaid font resource is missing: ${cssFile}: ${(e as Error).message}`);
  }
  const subsets: Subset[] = [];
  for (const [face] of css.matchAll(/@font-face\s*\{[^}]*\}/g)) {
    const url = /src:\s*url\(([^)]+\.woff2)\)/.exec(face)?.[1];
    const ranges = /unicode-range:\s*([^;]+);/.exec(face)?.[1];
    if (url === undefined || ranges === undefined) continue;
    subsets.push({ file: path.join(fontsDir, url.replace(/^['"]|['"]$/g, '')), ranges: parseRanges(ranges) });
  }
  const latin = subsets.find((subset) => subset.file.endsWith('-latin-400-normal.woff2'));
  if (latin === undefined) throw new RuntimeError('bundled Mermaid font has no latin subset');
  latin.font = openFont(latin.file);
  return new SubsetFont(subsets, latin.font);
}

const TEXT_POSITION_ELEMENTS = new Set(['text', 'tspan']);
const TEXT_POSITION_ATTRIBUTES = new Set(['x', 'y', 'dx', 'dy']);
const DEFAULT_FONT_SIZE_PX = 16;

interface SvgdomNode {
  nodeName: string;
  parentNode: SvgdomNode | null;
  style?: { fontSize?: string };
  getAttribute(name: string): string | null;
}

function fontSizePx(node: SvgdomNode, getAttribute: (this: SvgdomNode, name: string) => string | null): number {
  for (let current: SvgdomNode | null = node; current !== null; current = current.parentNode) {
    if (typeof current.getAttribute !== 'function') break;
    const inline = current.style?.fontSize;
    const value = inline !== undefined && inline !== '' ? inline : getAttribute.call(current, 'font-size');
    const size = Number.parseFloat(value ?? '');
    if (Number.isFinite(size) && size > 0) return size;
  }
  return DEFAULT_FONT_SIZE_PX;
}

function hasClass(node: SvgdomNode, name: string, getAttribute: (this: SvgdomNode, name: string) => string | null): boolean {
  return (getAttribute.call(node, 'class') ?? '').split(/\s+/).includes(name);
}

/** Mermaid's own `.node .label text { text-anchor: middle }` rule. */
function isNodeLabelText(node: SvgdomNode, getAttribute: (this: SvgdomNode, name: string) => string | null): boolean {
  let label = false;
  for (let current = node.parentNode; current !== null; current = current.parentNode) {
    if (typeof current.getAttribute !== 'function') break;
    if (!label) label = hasClass(current, 'label', getAttribute);
    else if (hasClass(current, 'node', getAttribute)) return true;
  }
  return false;
}

/**
 * svgdom measures text from attributes and inline style only, so two things
 * that a browser applies are missing during Mermaid layout:
 * - text positions are parsed with parseFloat, so multi-line `y="1em"` /
 *   `dy="1.1em"` rows are measured 1px apart and labels get the height of a
 *   single line. Resolve em lengths to px for these position attributes.
 * - Mermaid's stylesheet centers node labels; shapes that align the label
 *   from its measured box (cylinder and others) otherwise shift it left.
 * Only measurement reads go through this; the serialized SVG keeps
 * Mermaid's original attributes.
 */
function installTextLayoutResolver(): void {
  const proto = Element.prototype as unknown as { getAttribute: (this: SvgdomNode, name: string) => string | null };
  const getAttribute = proto.getAttribute;
  proto.getAttribute = function (this: SvgdomNode, name: string): string | null {
    const value = getAttribute.call(this, name);
    if (name === 'text-anchor' && value === null && this.nodeName === 'text' && isNodeLabelText(this, getAttribute)) {
      return 'middle';
    }
    if (value === null || !value.includes('em') || !TEXT_POSITION_ATTRIBUTES.has(name)) return value;
    if (!TEXT_POSITION_ELEMENTS.has(this.nodeName)) return value;
    const size = fontSizePx(this, getAttribute);
    return value.replace(/(-?[\d.]+)em\b/g, (_match, number: string) => String(Number.parseFloat(number) * size));
  };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Browsers return an SVGRect from getBBox(), but svgdom returns a Box that
 * also carries left/top. Mermaid shapes such as the cylinder offset labels by
 * `bbox.x - (bbox.left ?? 0)`, which only works with the browser shape.
 */
function installBrowserBBoxShape(): void {
  const proto = SVGGraphicsElement.prototype as unknown as { getBBox: (this: unknown) => Rect };
  const getBBox = proto.getBBox;
  proto.getBBox = function (this: unknown): Rect {
    const { x, y, width, height } = getBBox.call(this);
    return { x, y, width, height };
  };
}

let installed = false;

/** Registers the bundled Noto Sans JP with svgdom before the first Mermaid render. */
export function installMermaidTextMetrics(): void {
  if (installed) return;
  const font = loadSubsetFont();
  // svgdom selects the first listed family that has a mapping and then uses
  // the preloaded font object, so the mapped file name is never opened.
  // Mermaid measures many labels before their font-family is applied, and
  // svgdom then falls back to `sans-serif`; route that fallback to the same
  // font because every pfpdf diagram is drawn with the Noto Sans JP stack.
  const families = [MERMAID_MEASURE_FAMILY, 'sans-serif'];
  setFontFamilyMappings(Object.fromEntries(families.map((family) => [family, 'bundled-noto-sans-jp'])));
  const fonts = getFonts();
  for (const family of families) fonts[family] = font;
  installTextLayoutResolver();
  installBrowserBBoxShape();
  installed = true;
}
