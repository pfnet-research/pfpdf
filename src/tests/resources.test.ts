import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fromHtml } from 'hast-util-from-html';
import { toHtml } from 'hast-util-to-html';
import type { Root as HastRoot } from 'hast';
import { InputError } from '../errors.js';
import {
  ResourceManifest,
  rewriteCss,
  rewriteCssText,
  rewriteElementResources,
} from '../resources.js';

function fixture(): { dir: string; manifest: ResourceManifest } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-css-'));
  fs.writeFileSync(path.join(dir, 'image name).png'), Buffer.from([1]));
  fs.writeFileSync(path.join(dir, 'nested.css'), '.nested { background: url("image name).png") }');
  return { dir, manifest: new ResourceManifest() };
}

test('CSS rewriting follows tokens and handles escaped URL characters', () => {
  const { dir, manifest } = fixture();
  const css = '.x { custom: myurl(missing.png); background: u\\72l(image\\ name\\).png) }';
  const rewritten = rewriteCssText(css, dir, manifest);
  assert.match(rewritten, /myurl\(missing\.png\)/);
  assert.match(rewritten, /url\("assets\/0001\/image%20name\)\.png"\)/);
  assert.equal(manifest.list().length, 1);
});

test('top-level local CSS imports are inlined and nested at-keywords are not mistaken for imports', () => {
  const { dir, manifest } = fixture();
  const main = path.join(dir, 'main.css');
  fs.writeFileSync(main, '@import "nested.css" print;\n.x { --text: "@import missing.css;"; }');
  const rewritten = rewriteCss(main, manifest, () => '');
  assert.match(rewritten, /@media print/);
  assert.match(rewritten, /@import missing\.css/);
  assert.match(rewritten, /assets\/0001\/image%20name\)\.png/);
});

test('the same stylesheet can be imported under different media conditions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-css-'));
  fs.writeFileSync(path.join(dir, 'shared.css'), '.shared { color: red }');
  const main = path.join(dir, 'main.css');
  fs.writeFileSync(main, '@import "shared.css" screen;\n@import "shared.css" print;');
  const rewritten = rewriteCss(main, new ResourceManifest(), () => '');
  assert.match(rewritten, /@media screen/);
  assert.match(rewritten, /@media print/);
  assert.equal((rewritten.match(/\.shared \{ color: red \}/g) ?? []).length, 2);
});

test('invalid CSS and unsupported modern local import qualifiers fail clearly', () => {
  const { dir, manifest } = fixture();
  assert.throws(() => rewriteCssText('.x { background: url("unterminated) }', dir, manifest), InputError);
  const main = path.join(dir, 'main.css');
  fs.writeFileSync(main, '@import "nested.css" layer(theme);');
  assert.throws(() => rewriteCss(main, manifest, () => ''), /layer\(\) or supports\(\)/);
});

test('shared element rewriter gives Markdown and template contexts identical results', () => {
  const { dir } = fixture();
  fs.writeFileSync(path.join(dir, 'plain.png'), Buffer.from([1]));
  const source = '<img src="plain.png" srcset="plain.png 1x, image%20name).png 2x" style="background:url(plain.png)"><link rel="stylesheet" href="nested.css">';
  const rewrite = (sourceName: string): { html: string; css: Array<[string, string]>; files: string[] } => {
    const root = fromHtml(source, { fragment: true }) as unknown as HastRoot;
    const manifest = new ResourceManifest();
    const css = rewriteElementResources(root, {
      baseDir: dir,
      manifest,
      sourceName,
      generatedCssPrefix: 'shared',
    });
    return { html: toHtml(root as never), css, files: manifest.list().map(([, file]) => file) };
  };
  assert.deepEqual(rewrite('document'), rewrite('template'));
});
