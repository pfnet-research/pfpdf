/** TemplateResolver and HtmlDocumentBuilder: DOM slot contract (design 4.5.1). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromHtml } from 'hast-util-from-html';
import { toHtml } from 'hast-util-to-html';
import { visit } from 'unist-util-visit';
import type { Root as HastRoot, Element, ElementContent } from 'hast';
import { InputError, RuntimeError } from './errors.js';
import {
  type ResourceManifest,
  rewriteElementResources,
  rewriteCss,
} from './resources.js';
import type { Metadata, NormalizedTitle } from './input.js';
import type { DocumentBody, TocEntry } from './markdown.js';

const SLOTS = new Set(['content', 'title', 'author', 'series', 'date', 'confidential', 'toc', 'logo']);

export interface Template {
  dir: string;
  htmlPath: string;
  stylePath: string;
  vivliostylePath: string;
  bundled: boolean;
  repositoryRoot?: string | undefined;
}

export interface PreparedTemplate extends Template {
  root: HastRoot;
  reservedIds: string[];
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function resourcePath(...parts: string[]): string {
  return path.join(packageRoot, 'resources', ...parts);
}

export function resolveTemplate(
  template:
    { kind: 'bundled'; name: string } |
    { kind: 'custom'; dir: string } |
    { kind: 'repository'; locator: string },
  templateDirAbs: string | null,
  repositoryRoot?: string,
): PreparedTemplate {
  if (template.kind === 'repository') {
    throw new RuntimeError('repository template must be checked out before template resolution');
  }
  const bundled = template.kind === 'bundled';
  const dir = bundled ? resourcePath('templates', template.name) : templateDirAbs!;
  const err = bundled
    ? (msg: string) => new RuntimeError(`bundled template is broken: ${msg}`)
    : (msg: string) => new InputError(msg);
  try {
    if (!fs.statSync(dir).isDirectory()) throw new Error('not a directory');
  } catch {
    throw err(`template directory not found: ${dir}`);
  }
  const files = { htmlPath: 'template.html', stylePath: 'style.css', vivliostylePath: 'vivliostyle.css' };
  const resolved: Record<string, string> = {};
  for (const [key, name] of Object.entries(files)) {
    const p = path.join(dir, name);
    let valid = false;
    try {
      valid = fs.statSync(p).isFile();
      if (valid) fs.accessSync(p, fs.constants.R_OK);
    } catch {
      valid = false;
    }
    if (!valid) {
      throw err(`template file missing: ${p}`);
    }
    resolved[key] = p;
  }
  const resolvedTemplate: Template = {
    dir,
    bundled,
    htmlPath: resolved.htmlPath!,
    stylePath: resolved.stylePath!,
    vivliostylePath: resolved.vivliostylePath!,
    repositoryRoot,
  };
  const source = readTemplateText(resolvedTemplate, resolvedTemplate.htmlPath);
  const root = fromHtml(source) as unknown as HastRoot;
  validateTemplate(root, resolvedTemplate);
  const reservedIds: string[] = [];
  visit(root, 'element', (element: Element) => {
    const id = element.properties?.id;
    if (typeof id === 'string') reservedIds.push(id);
  });
  return { ...resolvedTemplate, root, reservedIds };
}

interface SlotMap {
  [slot: string]: Element;
}

function propertyToAttribute(prop: string): string {
  if (prop.startsWith('data')) {
    return 'data-' + prop.slice(4).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()).replace(/^-/, '');
  }
  return prop.toLowerCase();
}

function validateTemplate(root: HastRoot, tpl: Template): { slots: SlotMap; html: Element; head: Element; body: Element } {
  const err = tpl.bundled
    ? (msg: string) => new RuntimeError(`bundled template is broken: ${msg}`)
    : (msg: string) => new InputError(`template: ${msg}`);

  const slots: SlotMap = {};
  let html: Element | null = null;
  let head: Element | null = null;
  let body: Element | null = null;
  const walk = (nodes: ElementContent[] | HastRoot['children']): void => {
    for (const node of nodes) {
      if (node.type !== 'element') continue;
      const element = node;
      if (element.tagName === 'html') html = html ?? element;
      if (element.tagName === 'head') head = head ?? element;
      if (element.tagName === 'body') body = body ?? element;
      for (const key of Object.keys(element.properties ?? {})) {
        const attr = propertyToAttribute(key);
        if (attr === 'data-pfpdf-slot') {
          const name = String(element.properties![key]);
          if (!SLOTS.has(name)) throw err(`unknown slot: ${name}`);
          if (slots[name]) throw err(`duplicate slot: ${name}`);
          if (name === 'logo' && element.tagName !== 'img') throw err('logo slot must be an <img> element');
          slots[name] = element;
        }
      }
      walk(element.children);
    }
  };
  walk(root.children);

  if (!html || !head || !body) throw err('template.html must explicitly declare html, head, and body');
  if (!slots.content) throw err('required slot "content" is missing');
  return { slots, html, head, body };
}

function text(value: string): ElementContent {
  return { type: 'text', value };
}

function el(tagName: string, properties: Record<string, unknown>, children: ElementContent[]): Element {
  return { type: 'element', tagName, properties: properties as Element['properties'], children };
}

/** Title children: text plus permitted <br> elements. */
function titleChildren(title: NormalizedTitle): ElementContent[] {
  const out: ElementContent[] = [];
  for (let i = 0; i < title.lines.length; i++) {
    if (i > 0) out.push(el('br', {}, []));
    const line = title.lines[i]!;
    if (line !== '') out.push(text(line));
  }
  return out;
}

function tocLabel(lang: string): string {
  return lang === 'ja' || lang.startsWith('ja-') ? '目次' : 'Contents';
}

function tocContinuationLabel(lang: string): string {
  return lang === 'ja' || lang.startsWith('ja-') ? '目次（続き）' : 'Contents (continued)';
}

function tocElement(toc: TocEntry[], lang: string): Element {
  const label = tocLabel(lang);
  const list = el('ol', { className: ['pfpdf-toc-list'] }, []);
  for (const entry of toc) {
    (list.children).push(
      el('li', { className: [`pfpdf-toc-depth-${entry.depth}`] }, [
        el('a', { href: `#${entry.id}` }, [
          el('span', { className: ['pfpdf-toc-label'] }, [
            el('span', { className: ['pfpdf-toc-text'] }, [text(entry.text)]),
          ]),
        ]),
      ]),
    );
  }
  return el('nav', { className: ['pfpdf-toc'], role: 'doc-toc' }, [
    el('h2', { className: ['pfpdf-toc-title'] }, [text(label)]),
    el('span', {
      ariaHidden: 'true',
      className: ['pfpdf-toc-continuation-marker'],
    }, [text(tocContinuationLabel(lang))]),
    list,
  ]);
}

function tocContinuationReset(): Element {
  return el('span', {
    ariaHidden: 'true',
    className: ['pfpdf-toc-continuation-marker', 'pfpdf-toc-continuation-reset'],
  }, []);
}

export interface BuildOptions {
  metadata: Metadata;
  body: DocumentBody;
  template: PreparedTemplate;
  manifest: ResourceManifest;
  logo: { kind: 'template' | 'none' } | { kind: 'file'; absPath: string };
  toc: boolean;
  fontFaceCss: string;
  warn: (msg: string) => void;
}

export function buildDocumentHtml(opts: BuildOptions): { html: string; generatedCss: Array<[string, string]> } {
  const { metadata, template } = opts;
  const root = template.root;
  const { slots, html, head, body: htmlBody } = validateTemplate(root, template);
  const templateElements = new Set<Element>();
  visit(root, 'element', (element: Element) => {
    templateElements.add(element);
  });

  html.properties = { ...html.properties, lang: metadata.lang, dir: metadata.dir };

  // <title>: plain text with permitted breaks collapsed to spaces.
  const plainTitle = metadata.title.plainText
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let titleEl: Element | null = null;
  visit(root, 'element', (e: Element) => {
    if (e.tagName === 'title' && !titleEl) titleEl = e;
  });
  if (titleEl) (titleEl as Element).children = [text(plainTitle)];
  else (head.children).unshift(el('title', {}, [text(plainTitle)]));

  // Slot: title
  if (slots.title) slots.title.children = titleChildren(metadata.title);

  // Slot: author
  if (slots.author) {
    if (metadata.author === null) removeElement(root, slots.author);
    else slots.author.children = [text(metadata.author)];
  }

  // Slot: series
  if (slots.series) {
    if (metadata.series === null) removeElement(root, slots.series);
    else slots.series.children = [text(metadata.series)];
  }

  // Slot: date
  if (slots.date) {
    slots.date.children = [text(metadata.date ?? '')];
  }

  // Slot: confidential
  if (slots.confidential) {
    if (!metadata.confidential) removeElement(root, slots.confidential);
    else slots.confidential.children = [text('Confidential')];
  }

  // Slot: logo
  let injectedLogoLogical: string | null = null;
  if (opts.logo.kind === 'file') {
    if (!slots.logo) {
      throw new InputError('an explicit logo was given but the template has no logo slot');
    }
    injectedLogoLogical = opts.manifest.add(opts.logo.absPath);
    slots.logo.properties = { ...slots.logo.properties, src: injectedLogoLogical };
    if (slots.logo.properties.alt === undefined) slots.logo.properties.alt = '';
  } else if (slots.logo) {
    const defaultSource = slots.logo.properties?.src;
    if (opts.logo.kind === 'none' || typeof defaultSource !== 'string' || defaultSource === '') {
      removeElement(root, slots.logo);
    } else {
      slots.logo.properties = { ...slots.logo.properties };
      if (slots.logo.properties.alt === undefined) slots.logo.properties.alt = '';
    }
  }

  // Slot: toc / content
  const tocEl = opts.toc && opts.body.toc.length > 0 ? tocElement(opts.body.toc, metadata.lang) : null;
  if (slots.toc) {
    if (tocEl) slots.toc.children = [tocEl];
    else removeElement(root, slots.toc);
  }
  const content = slots.content!;
  content.children = tocEl && slots.toc
    ? [tocContinuationReset(), ...opts.body.sections]
    : [...opts.body.sections];
  if (tocEl && !slots.toc) {
    content.children.unshift(tocEl, tocContinuationReset());
  }

  // Rewrite template-relative resource URLs. Elements inserted from Markdown
  // were already processed against their source file directories.
  const generatedCss = rewriteElementResources(root, {
    baseDir: template.dir,
    manifest: opts.manifest,
    sourceName: 'template',
    sourceSeparator: ' ',
    generatedCssPrefix: 'template',
    include: (element) => templateElements.has(element),
    skipFetch: (element, attribute, value) =>
      element === slots.logo && attribute === 'src' && value === injectedLogoLogical,
    rewriteStylesheet: (absolutePath) => rewriteTemplateCss(template, absolutePath, opts.manifest),
    mapError: (error) => template.bundled && error instanceof InputError
      ? new RuntimeError(`bundled template is broken: ${error.message}`)
      : error as Error,
  });

  // Base stylesheets: fonts, highlight theme, template styles, page size.
  const hljsCss = require_resolve_css();
  let hljsLogical: string;
  try {
    hljsLogical = opts.manifest.addExplicit('vendor/hljs.css', hljsCss);
  } catch (e) {
    throw new RuntimeError(`bundled highlight stylesheet is broken: ${(e as Error).message}`);
  }
  generatedCss.push(['generated/fonts.css', opts.fontFaceCss]);
  generatedCss.push(['generated/style.css', rewriteTemplateCss(template, template.stylePath, opts.manifest)]);
  generatedCss.push(['generated/vivliostyle.css', rewriteTemplateCss(template, template.vivliostylePath, opts.manifest)]);
  const pageCss = `@page { size: ${metadata.pageSize.css}; }\n` +
    `.pfpdf-toc-continuation-marker { display: block; height: 0; overflow: hidden; ` +
    `string-set: pfpdf-toc-continuation content(); width: 0; }\n` +
    `[data-pfpdf-page-break] { break-before: page; height: 0; margin: 0; padding: 0; }\n` +
    `.pfpdf-mermaid { break-inside: avoid; margin: 1.25em auto; text-align: center; }\n` +
    `.pfpdf-mermaid img { display: inline-block; height: auto; max-width: 100%; }\n`;
  generatedCss.push(['generated/page.css', pageCss]);

  const headExtra: ElementContent[] = [
    el('script', {}, [text(readinessInitScript())]),
    // oxlint-disable-next-line unicorn/text-encoding-identifier-case -- HTML requires the utf-8 label.
    el('meta', { charSet: 'utf-8' }, []),
    el('link', { rel: 'stylesheet', href: 'generated/fonts.css' }, []),
    el('link', { rel: 'stylesheet', href: hljsLogical }, []),
    el('link', { rel: 'stylesheet', href: 'generated/style.css' }, []),
    el('link', { rel: 'stylesheet', href: 'generated/vivliostyle.css' }, []),
    el('link', { rel: 'stylesheet', href: 'generated/page.css' }, []),
    el('meta', { name: 'referrer', content: 'no-referrer' }, []),
  ];
  // Drop a template-supplied charset meta to avoid duplicates.
  head.children = [
    ...headExtra,
    ...(head.children).filter(
      (n) => !(n.type === 'element' && n.tagName === 'meta' && n.properties?.charSet !== undefined),
    ),
  ];

  (htmlBody.children).push(
    el('img', {
      alt: '',
      hidden: true,
      'data-pfpdf-readiness-gate': '',
    }, []),
    el('script', {}, [text(readinessFinishScript())]),
  );

  // Remove slot attributes from the final document.
  visit(root, 'element', (e: Element) => {
    if (!e.properties) return;
    for (const key of Object.keys(e.properties)) {
      if (propertyToAttribute(key) === 'data-pfpdf-slot') delete e.properties[key];
    }
  });

  const html5 = toHtml(root as never, { allowDangerousHtml: true });
  return { html: html5, generatedCss };
}

function removeElement(root: HastRoot, target: Element): void {
  visit(root, 'element', (e: Element, index, parent) => {
    if (e === target && parent && typeof index === 'number') {
      (parent.children as ElementContent[]).splice(index, 1);
      return false;
    }
    return true;
  });
  // also handle direct children of root fragments
  const idx = (root.children as ElementContent[]).indexOf(target);
  if (idx >= 0) (root.children as ElementContent[]).splice(idx, 1);
}

function require_resolve_css(): string {
  return resourcePath('vendor', 'hljs-github.css');
}

function readinessInitScript(): string {
  return `(() => {
  'use strict';
  const locateRoot = () => {
    const here = new URL(location.href);
    const value = new URLSearchParams(here.hash.slice(1)).get('src');
    const source = value ? new URL(value, here) : here;
    return new URL('./', source);
  };
  const root = locateRoot();
  const previous = window.__pfpdfReadiness;
  if (previous) {
    previous.reset(root);
    return;
  }
  let state = { status: 'not-started', root, sealed: false, failure: null, pending: [] };
  const record = (reason) => {
    if (state.failure === null) {
      state.failure = reason instanceof Error ? reason : new Error(String(reason));
    }
  };
  const onError = (event) => {
    const target = event.target;
    if (target && target !== window) {
      const value = target.currentSrc || target.src || target.href;
      if (!value) return;
      try { if (!new URL(value, state.root).href.startsWith(state.root.href)) return; }
      catch { return; }
      record(new Error('local document resource failed to load'));
      return;
    }
    record(event.error || event.message || 'document script error');
  };
  const onRejection = (event) => record(event.reason || 'unhandled promise rejection');
  addEventListener('error', onError, true);
  addEventListener('unhandledrejection', onRejection);
  const api = Object.freeze({
    registerReady(value) {
      if (state.sealed) throw new Error('pfpdf.registerReady() was called after document parsing');
      try {
        state.pending.push(Promise.resolve(value));
      } catch (error) { record(error); }
    }
  });
  const runtime = Object.freeze({
    reset(nextRoot) {
      state = { status: 'waiting', root: nextRoot, sealed: false, failure: null, pending: [] };
    },
    async finish() {
      try {
        if (document.readyState === 'loading') {
          await new Promise((resolve) => addEventListener('DOMContentLoaded', resolve, { once: true }));
        }
        state.sealed = true;
        await Promise.all(state.pending);
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        await Promise.all(Array.from(document.images)
          .filter((image) => {
            if (image.hasAttribute('data-pfpdf-readiness-gate')) return false;
            if (image.currentSrc.startsWith('data:') || image.src.startsWith('data:')) return true;
            try { return new URL(image.currentSrc || image.src, state.root).href.startsWith(state.root.href); }
            catch { return false; }
          })
          .map((image) => image.decode()));
        if (state.failure !== null) throw state.failure;
        state.status = 'success';
      } catch (error) {
        state.status = 'failure';
        throw error;
      }
    }
  });
  window.pfpdf = api;
  window.__pfpdfReadiness = runtime;
  runtime.reset(root);
})();`;
}

function readinessFinishScript(): string {
  return `(() => {
  'use strict';
  const here = new URL(location.href);
  const value = new URLSearchParams(here.hash.slice(1)).get('src');
  const root = new URL('./', value ? new URL(value, here) : here);
  const runtime = window.__pfpdfReadiness;
  const gate = document.querySelector('[data-pfpdf-readiness-gate]');
  if (gate) gate.src = new URL('generated/readiness-gate.svg', root).href;
  const finish = runtime
    ? runtime.finish()
    : Promise.reject(new Error('pfpdf readiness runtime is unavailable'));
  const notify = (ok, error) => {
    const url = new URL('generated/readiness', root);
    url.searchParams.set('ok', ok ? '1' : '0');
    if (error) url.searchParams.set('message', String(error.message || error).slice(0, 512));
    return fetch(url, { cache: 'no-store' });
  };
  finish.then(
    () => notify(true),
    (error) => {
      console.error('[pfpdf readiness]', error);
      return notify(false, error);
    },
  );
})();`;
}

function readTemplateText(template: Template, file: string): string {
  try {
    const bytes = fs.readFileSync(file);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (e) {
    if (template.bundled) {
      throw new RuntimeError(`bundled template is broken: cannot read ${file}: ${(e as Error).message}`);
    }
    throw new InputError(`template: cannot read ${file}: ${(e as Error).message}`);
  }
}

function rewriteTemplateCss(template: Template, file: string, manifest: ResourceManifest): string {
  try {
    return rewriteCss(file, manifest, () => '');
  } catch (e) {
    if (template.bundled) {
      throw new RuntimeError(`bundled template stylesheet is broken: ${(e as Error).message}`);
    }
    if (e instanceof InputError) throw e;
    throw new InputError(`template stylesheet ${file}: ${(e as Error).message}`);
  }
}
