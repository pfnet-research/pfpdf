/** Join only source soft breaks between Japanese characters in prose. */
import type { Root, Node, Parent, Text } from 'mdast';
import { visit } from 'unist-util-visit';
import type { SourceFile } from './input.js';

const JAPANESE = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\u3001-\u303f\uff01-\uff60\uffe0-\uffe6]/u;
const INLINE = new Set(['emphasis', 'strong', 'delete', 'link', 'linkReference']);

interface Character {
  node: Text;
  value: string;
  offset: number;
  length: number;
  soft: boolean;
}

function escaped(source: string, offset: number): boolean {
  let slashes = 0;
  let cursor = offset;
  while (cursor > 0 && source[--cursor] === '\\') slashes++;
  return slashes % 2 === 1;
}

function softBreaks(file: SourceFile, node: Text): boolean[] {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return [];
  const source = file.content.slice(start, end);
  const result: boolean[] = [];
  // Character references may decode to a newline too. They are authored
  // whitespace, not source wrapping, and must retain their semantics.
  const tokens = /\r\n|\r|\n|&#(?:0*(?:10|13)(?!\d)|[xX]0*[aAdD](?![0-9a-fA-F]));?|&NewLine;/g;
  for (const match of source.matchAll(tokens)) {
    const index = match.index;
    if (match[0].startsWith('&') && escaped(source, index)) continue;
    const physical = /^[\r\n]/.test(match[0]);
    // The Markdown parser strips trailing spaces from soft breaks. Keep that
    // authored separator; continuation indentation is structural instead.
    const explicitSpace = /[ \t]/.test(file.content[start + index - 1] ?? '');
    result.push(physical && !explicitSpace);
  }
  const count = node.value.match(/\r\n|\r|\n/g)?.length ?? 0;
  return result.length === count ? result : [];
}

export function joinJapaneseSoftBreaks(file: SourceFile, tree: Root): void {
  visit(tree, 'paragraph', (paragraph) => {
    let rawHtml = false;
    visit(paragraph, 'html', () => { rawHtml = true; });
    // Raw HTML may establish white-space: pre or another authored context.
    if (rawHtml) return;
    let run: Character[] = [];
    const cuts = new Map<Text, Array<{ offset: number; length: number }>>();
    const flush = (): void => {
      for (let i = 1; i + 1 < run.length; i++) {
        const current = run[i]!;
        if (!current.soft || !JAPANESE.test(run[i - 1]!.value) || !JAPANESE.test(run[i + 1]!.value)) continue;
        const offsets = cuts.get(current.node) ?? [];
        offsets.push({ offset: current.offset, length: current.length });
        cuts.set(current.node, offsets);
      }
      run = [];
    };
    const walk = (parent: Parent): void => {
      for (const child of parent.children as Node[]) {
        if (child.type === 'text') {
          const node = child as Text;
          const flags = softBreaks(file, node);
          let newline = 0;
          for (const part of node.value.matchAll(/\r\n|[\s\S]/gu)) {
            const isNewline = /^[\r\n]/.test(part[0]);
            run.push({ node, value: isNewline ? '\n' : part[0], offset: part.index, length: part[0].length,
              soft: isNewline ? flags[newline++] === true : false });
          }
        } else if (INLINE.has(child.type) && 'children' in child) {
          walk(child as Parent);
        } else {
          // Hard breaks, inline code/math, HTML, images, and references are
          // boundaries. Their content and adjacent spacing stay untouched.
          flush();
        }
      }
    };
    walk(paragraph);
    flush();
    for (const [node, offsets] of cuts) {
      let start = 0;
      let value = '';
      for (const cut of offsets) {
        value += node.value.slice(start, cut.offset);
        start = cut.offset + cut.length;
      }
      node.value = value + node.value.slice(start);
    }
  });
}
