declare module 'svgdom' {
  export function setFontFamilyMappings(map: Record<string, string>): unknown;
  export function getFonts(): Record<string, unknown>;
  export class Node {
    readonly nodeType: number;
    readonly parentNode: Node | null;
  }
  export class Element extends Node {}
  export class SVGGraphicsElement extends Element {}
}
