declare module 'fontkit' {
  export interface Glyph {
    advanceWidth: number;
  }
  export interface Font {
    unitsPerEm: number;
    ascent: number;
    descent: number;
    lineGap: number;
    xHeight: number;
    capHeight: number;
    hasGlyphForCodePoint(codePoint: number): boolean;
    layout(text: string): { glyphs: Glyph[] };
  }
  export function openSync(filename: string): Font | { fonts: Font[] };
}
