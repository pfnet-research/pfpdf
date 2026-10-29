/** Semantic DPUB footnotes: Vivliostyle places each note at its first reference. */
import type { Element, ElementContent, Root } from 'hast';
import { visit } from 'unist-util-visit';
import type { IdAllocator } from './markdown.js';

interface Note {
  body: Element;
  number: number;
  id: string;
  references: Array<{ id: string; occurrence: number }>;
}

function generated(element: Element, property: string): boolean {
  return Object.hasOwn(element.properties ?? {}, property);
}

function backLabel(number: number, occurrence: number, japanese: boolean): string {
  return japanese
    ? `参照 ${number}${occurrence > 1 ? `（${occurrence} 回目）` : ''} に戻る`
    : `Back to reference ${number}${occurrence > 1 ? `-${occurrence}` : ''}`;
}

export function preparePageFootnotes(roots: Root[], allocator: IdAllocator, lang: string): void {
  const japanese = lang === 'ja' || lang.startsWith('ja-');
  let nextNumber = 1;
  for (const root of roots) {
    const sections = root.children.filter((node): node is Element =>
      node.type === 'element' && generated(node, 'dataFootnotes'));
    const definitions = new Map<string, Element>();
    for (const section of sections) {
      visit(section, 'element', (element: Element) => {
        element.properties ??= {};
        if (element.tagName === 'li' && typeof element.properties.id === 'string') {
          definitions.set(element.properties.id, element);
        }
      });
    }
    if (definitions.size === 0) continue;
    const notes = new Map<string, Note>();
    const idMap = new Map<string, string>();
    const backReferences = new Map<string, { number: number; occurrence: number }>();
    visit(root, 'element', (reference: Element) => {
      reference.properties ??= {};
      if (!generated(reference, 'dataFootnoteRef')) return;
      const href = reference.properties.href;
      const oldId = reference.properties.id;
      if (typeof href !== 'string' || typeof oldId !== 'string') return;
      const oldTarget = href.slice(1);
      const definition = definitions.get(oldTarget);
      if (!definition) return;
      let note = notes.get(oldTarget);
      if (!note) {
        const number = nextNumber++;
        note = { body: definition, number, id: allocator.allocate(`pfpdf-footnote-${number}`), references: [] };
        notes.set(oldTarget, note);
        idMap.set(oldTarget, note.id);
      }
      const occurrence = note.references.length + 1;
      const id = allocator.allocate(`pfpdf-footnote-ref-${note.number}-${occurrence}`);
      note.references.push({ id, occurrence });
      idMap.set(oldId, id);
      backReferences.set(id, { number: note.number, occurrence });
      reference.properties.id = id;
      reference.properties.href = `#${note.id}`;
      reference.properties.role = 'doc-noteref';
      reference.properties.ariaLabel = `${japanese ? '脚注' : 'Footnote'} ${note.number}`;
      delete reference.properties.ariaDescribedBy;
      reference.children = [{ type: 'text', value: String(note.number) }];
    });
    visit(root, 'element', (element: Element) => {
      element.properties ??= {};
      const href = element.properties.href;
      if (typeof href === 'string' && href.startsWith('#')) {
        const target = idMap.get(href.slice(1));
        if (target) element.properties.href = `#${target}`;
      }
      if (generated(element, 'dataFootnoteBackref')) {
        element.properties.role = 'doc-backlink';
        const target = String(element.properties.href).slice(1);
        const ref = backReferences.get(target);
        if (ref) element.properties.ariaLabel = backLabel(ref.number, ref.occurrence, japanese);
      }
    });
    root.children = root.children.filter((node) => !sections.includes(node as Element));
    for (const note of notes.values()) {
      const children = note.body.children;
      const marker: Element = {
        type: 'element', tagName: 'span',
        properties: { className: ['pfpdf-page-footnote-number'], ariaHidden: 'true' },
        children: [{ type: 'text', value: `${note.number}. ` }],
      };
      const first = children.find((child) => child.type === 'element');
      if (first?.type === 'element' && first.tagName === 'p') first.children.unshift(marker);
      else children.unshift({ type: 'element', tagName: 'p', properties: {}, children: [marker] });
      const aside: ElementContent = {
        type: 'element', tagName: 'aside',
        properties: { id: note.id, role: 'doc-footnote', className: ['pfpdf-page-footnote'], ariaLabel: `${japanese ? '脚注' : 'Footnote'} ${note.number}` },
        children,
      };
      root.children.push(aside);
    }
  }
}
