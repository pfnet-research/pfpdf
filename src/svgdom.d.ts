declare module 'svgdom' {
  export function setFontFamilyMappings(map: Record<string, string>): unknown;
  export function getFonts(): Record<string, unknown>;
  export class Element {}
  export class SVGGraphicsElement extends Element {}
}
