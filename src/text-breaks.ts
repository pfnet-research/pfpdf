import type { Element, ElementContent, Root as HastRoot, Text } from 'hast';

export const WORD_BREAK_THRESHOLD = 16;
const MIN_FRAGMENT_LENGTH = 4;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const EXCLUDED_TAGS = new Set([
  'pre', 'code', 'kbd', 'samp', 'script', 'style', 'textarea', 'svg', 'math',
]);
const EXCLUDED_CLASSES = new Set([
  'pfpdf-math-src', 'pfpdf-math-inline', 'pfpdf-math-display',
]);
const BREAK_TAGS = new Set(['br', 'wbr']);
const REPLACED_TAGS = new Set([
  'audio', 'canvas', 'embed', 'iframe', 'img', 'input', 'object', 'select', 'video',
]);
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'details', 'dialog',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'html', 'li',
  'main', 'nav', 'ol', 'p', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'ul',
]);

const URL_SYMBOLS = new Set("!#$%&'*+,-./:;=?@[\\]_~");
const CJK = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
const WORD = /[\p{Letter}\p{Mark}\p{Number}]/u;
const LOWER = /\p{Lowercase_Letter}/u;
const UPPER = /\p{Uppercase_Letter}/u;
const LETTER = /\p{Letter}/u;
const NUMBER = /\p{Number}/u;

interface GraphemeRef {
  value: string;
  node: Text;
  offset: number;
  parent: Element | HastRoot;
}

interface PathState {
  cuts: number;
  priority: number;
  squareSum: number;
  positionSum: number;
  previous: number;
}

function classNames(element: Element): string[] {
  const value = element.properties?.className;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' ? value.split(/\s+/) : [];
}

function isContentEditable(element: Element): boolean {
  const value = element.properties?.contentEditable ?? element.properties?.contenteditable;
  return value === true || value === '' || (typeof value === 'string' && value.toLowerCase() !== 'false');
}

function isExcluded(element: Element): boolean {
  return EXCLUDED_TAGS.has(element.tagName)
    || classNames(element).some((name) => EXCLUDED_CLASSES.has(name))
    || isContentEditable(element);
}

function isRunGrapheme(value: string): boolean {
  if (value === '\u200b' || value === '\u00ad' || /\s/u.test(value)) return false;
  if (CJK.test(value)) return false;
  return WORD.test(value) || URL_SYMBOLS.has(value);
}

function isHex(value: string | undefined): boolean {
  return value !== undefined && /^[0-9a-f]$/iu.test(value);
}

function isForbiddenBoundary(values: string[], position: number): boolean {
  // Keep %HH percent-encoded octets and the two colons in IPv6's :: together.
  if (values[position - 1] === '%' && isHex(values[position]) && isHex(values[position + 1])) return true;
  if (values[position - 2] === '%' && isHex(values[position - 1]) && isHex(values[position])) return true;
  if (values[position - 1] === ':' && values[position] === ':') return true;
  // Keep the punctuation in :// together. A preferred break remains after the second slash.
  if (values[position - 1] === ':' && values[position] === '/') return true;
  if (values[position - 2] === ':' && values[position - 1] === '/' && values[position] === '/') return true;
  return false;
}

/** Lower values are preferred; every non-forbidden grapheme boundary is a fallback. */
export function breakPriority(values: string[], position: number): number | null {
  if (position <= 0 || position >= values.length || isForbiddenBoundary(values, position)) return null;
  const before = values[position - 1]!;
  const after = values[position]!;
  if ('/?&#;='.includes(before)) return 0;
  if ('.@:-_~+,'.includes(before)) return 1;
  if ((LOWER.test(before) && UPPER.test(after))
    || (LETTER.test(before) && NUMBER.test(after))
    || (NUMBER.test(before) && LETTER.test(after))
    || (UPPER.test(before) && UPPER.test(after) && LETTER.test(values[position + 1] ?? '') && LOWER.test(values[position + 1] ?? ''))) {
    return 2;
  }
  return 3;
}

function compareState(left: PathState, right: PathState): number {
  return left.priority - right.priority
    || left.cuts - right.cuts
    || left.squareSum - right.squareSum
    || left.positionSum - right.positionSum;
}

function buildPathStates(values: string[]): Array<PathState | undefined> {
  const states = Array.from({ length: values.length + 1 }, (): PathState | undefined => undefined);
  states[0] = { cuts: 0, priority: 0, squareSum: 0, positionSum: 0, previous: -1 };
  for (let end = MIN_FRAGMENT_LENGTH; end <= values.length; end++) {
    const startMin = Math.max(0, end - WORD_BREAK_THRESHOLD);
    const startMax = end - MIN_FRAGMENT_LENGTH;
    for (let start = startMin; start <= startMax; start++) {
      const previous = states[start];
      const priority = start > 0 ? breakPriority(values, start) : 0;
      if (previous === undefined || priority === null) continue;
      const segmentLength = end - start;
      const candidate: PathState = {
        cuts: previous.cuts + (start > 0 ? 1 : 0),
        priority: previous.priority + priority,
        squareSum: previous.squareSum + segmentLength * segmentLength,
        positionSum: previous.positionSum + start,
        previous: start,
      };
      const current = states[end];
      if (current === undefined || compareState(candidate, current) < 0) states[end] = candidate;
    }
  }
  return states;
}

function selectExactThresholdBreak(values: string[]): number {
  let best = MIN_FRAGMENT_LENGTH;
  for (let position = MIN_FRAGMENT_LENGTH + 1; position <= values.length - MIN_FRAGMENT_LENGTH; position++) {
    const priority = breakPriority(values, position);
    const bestPriority = breakPriority(values, best);
    if (priority !== null && (bestPriority === null || priority < bestPriority
      || (priority === bestPriority && Math.abs(values.length - 2 * position) < Math.abs(values.length - 2 * best)))) best = position;
  }
  return best;
}

/** Select deterministic semantic break positions in O(n * WORD_BREAK_THRESHOLD). */
export function selectWordBreaks(values: string[]): number[] {
  const length = values.length;
  if (length < WORD_BREAK_THRESHOLD) return [];

  const states = buildPathStates(values);

  let final = states[length];
  if (final === undefined) {
    // This can only occur when future protected sequences grow beyond the maximum segment.
    // Fall back to safe grapheme boundaries while retaining the hard maximum.
    const cuts: number[] = [];
    for (let position = WORD_BREAK_THRESHOLD; position < length; position += WORD_BREAK_THRESHOLD) cuts.push(position);
    return cuts;
  }

  if (length === WORD_BREAK_THRESHOLD && final.cuts === 0) {
    return [selectExactThresholdBreak(values)];
  }

  const cuts: number[] = [];
  let cursor = length;
  while (cursor > 0) {
    final = states[cursor]!;
    if (final.previous > 0) cuts.push(final.previous);
    cursor = final.previous;
  }
  return cuts.reverse();
}

function replaceTextNode(parent: Element | HastRoot, node: Text, offsets: number[]): void {
  const index = parent.children.indexOf(node);
  if (index < 0) return;
  const replacements: ElementContent[] = [];
  let start = 0;
  for (const offset of offsets) {
    if (offset < start || offset >= node.value.length) continue;
    if (offset > start) replacements.push({ ...node, value: node.value.slice(start, offset) });
    replacements.push({ type: 'element', tagName: 'wbr', properties: {}, children: [] });
    start = offset;
  }
  if (replacements.length === 0) return;
  if (start < node.value.length) replacements.push({ ...node, value: node.value.slice(start) });
  parent.children.splice(index, 1, ...replacements as typeof parent.children);
}

/** Insert wbr elements into visible long runs without changing text or properties. */
export function insertWordBreakOpportunities(root: HastRoot): void {
  let run: GraphemeRef[] = [];
  const insertions = new Map<Text, { parent: Element | HastRoot; offsets: Set<number> }>();

  const flush = (): void => {
    if (run.length >= WORD_BREAK_THRESHOLD) {
      const cuts = selectWordBreaks(run.map((item) => item.value));
      for (const cut of cuts) {
        const target = run[cut]!;
        const entry = insertions.get(target.node) ?? { parent: target.parent, offsets: new Set<number>() };
        entry.offsets.add(target.offset);
        insertions.set(target.node, entry);
      }
    }
    run = [];
  };

  const walk = (parent: Element | HastRoot): void => {
    for (const child of parent.children) {
      if (child.type === 'text') {
        for (const part of segmenter.segment(child.value)) {
          if (!isRunGrapheme(part.segment)) {
            flush();
            continue;
          }
          run.push({ value: part.segment, node: child, offset: part.index, parent });
        }
        continue;
      }
      if (child.type !== 'element') {
        flush();
        continue;
      }
      if (isExcluded(child) || BREAK_TAGS.has(child.tagName) || REPLACED_TAGS.has(child.tagName)) {
        flush();
        continue;
      }
      if (BLOCK_TAGS.has(child.tagName)) {
        flush();
        walk(child);
        flush();
      } else {
        walk(child);
      }
    }
  };

  walk(root);
  flush();
  for (const [node, entry] of insertions) {
    replaceTextNode(entry.parent, node, [...entry.offsets].sort((a, b) => a - b));
  }
}
