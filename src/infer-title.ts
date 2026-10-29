/** Derive literal metadata text without changing authored Markdown. */
import { fromHtml } from 'hast-util-from-html';
import type { PhrasingContent } from 'mdast';
import type { NormalizedTitle, SourceFile } from './input.js';
import { createMarkdownParser } from './markdown-parser.js';

type FragmentNode = ReturnType<typeof fromHtml>['children'][number];

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function headingFragment(node: PhrasingContent): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'inlineMath':
      return escapeText(node.value);
    case 'image':
    case 'imageReference':
      return escapeText(node.alt ?? '');
    case 'break': return '<br>';
    case 'html': return node.value;
    case 'footnoteReference': return '';
    case 'delete':
    case 'emphasis':
    case 'strong':
    case 'link':
    case 'linkReference':
      return node.children.map(headingFragment).join('');
  }
}

function fragmentText(node: FragmentNode): string {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return '';
  if (['script', 'style', 'template'].includes(node.tagName)) return '';
  if (node.tagName === 'br') return ' ';
  if (node.tagName === 'img') {
    const alt = node.properties?.alt;
    return typeof alt === 'string' ? alt : '';
  }
  return node.children.map(fragmentText).join('');
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function inferDocumentTitle(files: SourceFile[], inputName: string): NormalizedTitle {
  const parser = createMarkdownParser();
  for (const file of files) {
    for (const node of parser.parse(file.content).children) {
      // Quotes, list items, code, raw HTML blocks and footnote definitions do
      // not supply the document's top-level Markdown title.
      if (node.type !== 'heading' || node.depth !== 1) continue;
      const fragment = fromHtml(node.children.map(headingFragment).join(''), { fragment: true });
      const text = singleLine(fragment.children.map(fragmentText).join(''));
      if (text !== '') return { lines: [text], plainText: text };
    }
  }
  const text = singleLine(inputName) || 'document';
  // Names and decoded heading text are literal text, not the restricted HTML
  // accepted by an explicit title. Do not decode entities or <br> twice.
  return { lines: [text], plainText: text };
}
