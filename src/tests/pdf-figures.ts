/**
 * Test helper: page-space bounds of tagged figures in a PDF.
 *
 * Chromium draws an `<img>` SVG inline in the page content inside `/Figure`
 * marked content. This follows only the content stream operators that matter
 * for geometry (graphics state, transformation, path construction and
 * painting, marked content) and returns, per page, the union of the painted
 * path points inside figures. Clipping-only paths and text are ignored; the
 * painted paths already outline a diagram.
 */
import { PDFArray, PDFDocument, PDFRawStream, PDFRef, decodePDFRawStream, type PDFPage } from 'pdf-lib';

export interface Box {
  left: number;
  /** Distance from the top edge of the page, in points. */
  top: number;
  right: number;
  bottom: number;
}

type Matrix = [number, number, number, number, number, number];

// Literal strings allow one level of nested parentheses, which is enough for
// the hex-encoded text Chromium writes; everything else is a single token.
const TOKEN = /%[^\r\n]*|\((?:\\.|[^\\()]|\((?:\\.|[^\\()])*\))*\)|<<|>>|<[\dA-Fa-f\s]*>|[[\]{}]|\/[^\s()<>[\]{}/%]*|[^\s()<>[\]{}/%]+/g;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function contentOf(page: PDFPage): string {
  const contents = page.node.Contents();
  const items = contents instanceof PDFArray ? contents.asArray() : contents === undefined ? [] : [contents];
  return items.map((item) => {
    const stream = item instanceof PDFRef ? page.doc.context.lookup(item) : item;
    if (!(stream instanceof PDFRawStream)) throw new Error('unsupported page content stream');
    return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  }).join('\n');
}

/** Coordinates drawn by each path construction operator. */
const PATH_POINTS: Record<string, (n: number[]) => number[]> = {
  m: (n) => n.slice(0, 2),
  l: (n) => n.slice(0, 2),
  c: (n) => n.slice(0, 6),
  v: (n) => n.slice(0, 4),
  y: (n) => n.slice(0, 4),
  re: (n) => [n[0]!, n[1]!, n[0]! + n[2]!, n[1]! + n[3]!],
};

class FigureTracer {
  box: Box | null = null;
  private ctm = IDENTITY;
  private readonly saved: Matrix[] = [];
  private readonly marked: boolean[] = [];
  private path: Array<[number, number]> = [];

  constructor(private readonly height: number) {}

  apply(operator: string, operands: string[]): void {
    const n = operands.filter((operand) => NUMBER.test(operand)).map(Number);
    const points = PATH_POINTS[operator];
    if (points !== undefined) this.addPoints(points(n));
    else if (PAINT.has(operator)) this.paint();
    else if (operator === 'n') this.path = [];
    else if (operator === 'q') this.saved.push(this.ctm);
    else if (operator === 'Q') this.ctm = this.saved.pop() ?? IDENTITY;
    else if (operator === 'cm') this.ctm = multiply(n.slice(-6) as Matrix, this.ctm);
    else if (operator === 'BDC' || operator === 'BMC') this.marked.push(operands.find((o) => o.startsWith('/')) === '/Figure');
    else if (operator === 'EMC') this.marked.pop();
  }

  private addPoints(coordinates: number[]): void {
    const [a, b, c, d, e, f] = this.ctm;
    for (let i = 0; i + 1 < coordinates.length; i += 2) {
      const x = coordinates[i]!;
      const y = coordinates[i + 1]!;
      this.path.push([a * x + c * y + e, this.height - (b * x + d * y + f)]);
    }
  }

  private paint(): void {
    if (this.marked.includes(true)) {
      for (const [x, top] of this.path) {
        const box = this.box ?? { left: x, top, right: x, bottom: top };
        this.box = {
          left: Math.min(box.left, x), top: Math.min(box.top, top),
          right: Math.max(box.right, x), bottom: Math.max(box.bottom, top),
        };
      }
    }
    this.path = [];
  }
}

function figureBox(page: PDFPage): Box | null {
  const tracer = new FigureTracer(page.getHeight());
  let operands: string[] = [];
  for (const [token] of contentOf(page).matchAll(TOKEN)) {
    if (token.startsWith('%')) continue;
    // Operators are bare words that are not numbers or the boolean/null keywords.
    if (/^[A-Za-z'"*]+$/.test(token) && !['true', 'false', 'null'].includes(token)) {
      tracer.apply(token, operands);
      operands = [];
    } else {
      operands.push(token);
    }
  }
  return tracer.box;
}

/** Figure bounds for every page; `null` for a page without a figure. */
export async function figureBoxes(pdf: Uint8Array): Promise<Array<Box | null>> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((page) => figureBox(page));
}
