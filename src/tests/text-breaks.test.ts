import test from 'node:test';
import assert from 'node:assert/strict';
import { toHtml } from 'hast-util-to-html';
import type { Root, ElementContent } from 'hast';
import {
  WORD_BREAK_THRESHOLD,
  breakPriority,
  insertWordBreakOpportunities,
  selectWordBreaks,
} from '../text-breaks.js';

const graphemes = (value: string): string[] =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map((part) => part.segment);

function segmentLengths(value: string, cuts: number[]): number[] {
  const values = graphemes(value);
  const boundaries = [0, ...cuts, values.length];
  return boundaries.slice(1).map((end, index) => end - boundaries[index]!);
}

function root(children: ElementContent[]): Root {
  return { type: 'root', children };
}

test('word-break selection fixes the 15/16/17/31/32/33 grapheme boundaries', () => {
  for (const length of [15, 16, 17, 31, 32, 33]) {
    const value = 'a'.repeat(length);
    const cuts = selectWordBreaks(graphemes(value));
    assert.equal(cuts.length === 0, length < WORD_BREAK_THRESHOLD, `${String(length)}: ${String(cuts)}`);
    assert.ok(segmentLengths(value, cuts).every((part) => part <= WORD_BREAK_THRESHOLD), `${String(length)}: ${String(cuts)}`);
    assert.ok(segmentLengths(value, cuts).every((part) => part >= 4), `${String(length)}: ${String(cuts)}`);
  }
});

test('semantic candidates outrank fallback and protected URL sequences stay intact', () => {
  const url = graphemes('https://example.com/very/long/path?query=value');
  const cuts = selectWordBreaks(url);
  assert.ok(cuts.every((cut) => breakPriority(url, cut)! < 3), String(cuts));
  assert.equal(breakPriority(graphemes('https://x'), 6), null);
  assert.equal(breakPriority(graphemes('https://x'), 8), 0);
  assert.equal(breakPriority(graphemes('a%20b'), 2), null);
  assert.equal(breakPriority(graphemes('a%20b'), 3), null);
  assert.equal(breakPriority(graphemes('a::b'), 2), null);
});

test('camel-case and letter-number transitions are semantic candidates', () => {
  assert.equal(breakPriority(graphemes('lowerUpper'), 5), 2);
  assert.equal(breakPriority(graphemes('ABCamel'), 2), 2);
  assert.equal(breakPriority(graphemes('name123'), 4), 2);
  assert.equal(breakPriority(graphemes('123name'), 3), 2);
});

test('underscore boundaries outrank fewer arbitrary cuts', () => {
  const value = graphemes('preview_renderer_keeps_long_identifiers_visible_123456789');
  const cuts = selectWordBreaks(value);
  assert.ok(cuts.length > 3, String(cuts));
  assert.ok(cuts.every((cut) => value[cut - 1] === '_'), String(cuts));
  assert.ok(segmentLengths(value.join(''), cuts).every((part) => part <= WORD_BREAK_THRESHOLD));
});

test('HAST transform crosses inline elements and preserves grapheme clusters', () => {
  const tree = root([{
    type: 'element', tagName: 'p', properties: {}, children: [
      { type: 'text', value: `abcdefe\u0301` },
      { type: 'element', tagName: 'em', properties: {}, children: [{ type: 'text', value: 'hijklmnopq' }] },
      { type: 'text', value: ' 👨‍👩‍👧‍👦' },
    ],
  }]);
  insertWordBreakOpportunities(tree);
  const html = toHtml(tree as never);
  assert.match(html, /<wbr>/);
  assert.equal(html.replaceAll('<wbr>', '').replaceAll('<p>', '').replaceAll('</p>', '').replaceAll('<em>', '').replaceAll('</em>', ''), `abcdefe\u0301hijklmnopq 👨‍👩‍👧‍👦`);
  assert.ok(html.includes('é'));
  assert.ok(html.includes('👨‍👩‍👧‍👦'));
});

test('HAST transform is idempotent and respects existing breaks', () => {
  const tree = root([{
    type: 'element', tagName: 'p', properties: {}, children: [
      { type: 'text', value: 'abcdefghijklmnop' },
      { type: 'element', tagName: 'wbr', properties: {}, children: [] },
      { type: 'text', value: 'qrstuvwxyzabcdef' },
    ],
  }]);
  insertWordBreakOpportunities(tree);
  const once = toHtml(tree as never);
  insertWordBreakOpportunities(tree);
  assert.equal(toHtml(tree as never), once);
  assert.equal((once.match(/<wbr>/g) ?? []).length, 3, once);
});

test('HAST transform excludes preserved and replaced contexts', () => {
  const excluded = ['pre', 'code', 'kbd', 'samp', 'script', 'style', 'textarea', 'svg', 'math'];
  const children: ElementContent[] = excluded.map((tagName) => ({
    type: 'element', tagName, properties: {}, children: [{ type: 'text', value: 'abcdefghijklmnopq' }],
  }));
  children.push({
    type: 'element', tagName: 'div', properties: { contentEditable: 'true' },
    children: [{ type: 'text', value: 'abcdefghijklmnopq' }],
  });
  children.push({
    type: 'element', tagName: 'span', properties: { className: ['pfpdf-math-inline'] },
    children: [{ type: 'text', value: 'abcdefghijklmnopq' }],
  });
  children.push({
    type: 'element', tagName: 'p', properties: {}, children: [
      { type: 'text', value: 'abcdefgh' },
      { type: 'element', tagName: 'img', properties: { src: 'x' }, children: [] },
      { type: 'text', value: 'ijklmnop' },
    ],
  });
  const tree = root(children);
  insertWordBreakOpportunities(tree);
  assert.doesNotMatch(toHtml(tree as never), /<wbr>/);
});

test('explicit break characters, br, and block boundaries terminate runs', () => {
  const tree = root([{
    type: 'element', tagName: 'div', properties: {}, children: [
      { type: 'element', tagName: 'p', properties: {}, children: [
        { type: 'text', value: 'abcdefgh\u200bijklmnop' },
        { type: 'element', tagName: 'br', properties: {}, children: [] },
        { type: 'text', value: 'abcdefgh\u00adijklmnop' },
      ] },
      { type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: 'abcdefgh' }] },
      { type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: 'ijklmnop' }] },
    ],
  }]);
  insertWordBreakOpportunities(tree);
  assert.doesNotMatch(toHtml(tree as never), /<wbr>/);
});

test('text splits preserve source positions and never leave empty text nodes', () => {
  const position = {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 18, offset: 17 },
  };
  const tree = root([{
    type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: 'abcdefghijklmnopq', position }],
  }]);
  insertWordBreakOpportunities(tree);
  const paragraph = tree.children[0];
  assert.equal(paragraph?.type, 'element');
  if (paragraph?.type !== 'element') return;
  const texts = paragraph.children.filter((child) => child.type === 'text');
  assert.ok(texts.every((text) => text.value !== '' && text.position === position));
});

test('long-run selection remains bounded and complete', () => {
  const values = graphemes('a'.repeat(100_000));
  const cuts = selectWordBreaks(values);
  assert.ok(cuts.length > 0);
  assert.ok(segmentLengths(values.join(''), cuts).every((part) => part <= WORD_BREAK_THRESHOLD));
});
