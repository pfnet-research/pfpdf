import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fromHtml } from 'hast-util-from-html';
import { visit } from 'unist-util-visit';
import type { Root, Element } from 'hast';
import { buildHtml, runBuild } from '../build.js';
import { resolveConfig } from '../config.js';
import { InputError, RuntimeError } from '../errors.js';
import { ResourceManifest, rewriteElementResources } from '../resources.js';
import { renderDocument } from '../renderer.js';

const log = { warn: (): void => {}, info: (): void => {}, debug: (): void => {} };
const env = { SOURCE_DATE_EPOCH: '0' };
const validImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="8" height="8"%3E%3Crect width="8" height="8" fill="blue"/%3E%3C/svg%3E';

function fixture(body: string): { dir: string; input: string; output: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-image-diagnostic-'));
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(input, `---\ntitle: Image diagnostic\nlang: en\n---\n\n${body}\n`);
  return { dir, input, output: path.join(dir, 'out.pdf') };
}

test('static empty Markdown image destinations fail at their original source line', async (t) => {
  for (const body of ['![caption]()', '![caption][ref]\n\n[ref]: <>']) {
    const f = fixture(body);
    t.after(() => { fs.rmSync(f.dir, { recursive: true, force: true }); });
    await assert.rejects(buildHtml(resolveConfig(['--input', f.input, '--output', f.output], f.dir), env, log),
      (error: unknown) => error instanceof InputError && error.message.includes(`${f.input}:6:`)
        && error.message.includes('image destination is empty'));
  }
});

test('missing local images report the original file, line, destination, and resolved path', async (t) => {
  const f = fixture('![caption](assets/missing.png)');
  t.after(() => { fs.rmSync(f.dir, { recursive: true, force: true }); });
  await assert.rejects(buildHtml(resolveConfig(['--input', f.input, '--output', f.output], f.dir), env, log),
    (error: unknown) => error instanceof InputError && error.message.includes(`${f.input}:6:`)
      && error.message.includes('"assets/missing.png"')
      && error.message.includes(path.join(f.dir, 'assets', 'missing.png')));
});

test('renderer HTML preserves image source context while raw images await registered readiness', async (t) => {
  const f = fixture('<img id="later" alt="scripted">\n\n<img src="broken.png" alt="corrupt">');
  t.after(() => { fs.rmSync(f.dir, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(f.dir, 'broken.png'), 'not an image');
  const built = await buildHtml(resolveConfig(['--input', f.input, '--output', f.output], f.dir), env, log);
  assert.equal(built.generated.get('document.html')!.toString(), built.html);
  const root = fromHtml(built.html) as unknown as Root;
  const images: Element[] = [];
  visit(root, 'element', (element) => { if (element.tagName === 'img') images.push(element); });
  assert.equal(images[0]!.properties!.dataPfpdfImageSource, `${f.input}:6`);
  assert.equal(images[0]!.properties!.dataPfpdfImageDestination, '(src not specified)');
  assert.equal(images[1]!.properties!.dataPfpdfImageSource, `${f.input}:8`);
  assert.equal(images[1]!.properties!.dataPfpdfImageDestination, 'broken.png');
  assert.match(String(images[1]!.properties!.src), /^assets\/\d+\/broken\.png$/);
});

test('template HTML images have their own source file and line', () => {
  const root = fromHtml('<p>Before</p>\n<img src="https://example.invalid/image.png">', { fragment: true }) as unknown as Root;
  rewriteElementResources(root, { baseDir: '/tmp', sourceName: '/template/template.html',
    manifest: new ResourceManifest(), generatedCssPrefix: 'test', annotateImages: true });
  const image = root.children[2] as Element;
  assert.equal(image.properties!['data-pfpdf-image-source'], '/template/template.html:2');
  assert.equal(image.properties!['data-pfpdf-image-destination'], 'https://example.invalid/image.png');
});

test('srcset resource failures retain the referring source and declared destination', async (t) => {
  const f = fixture('<img srcset="missing.png 1x" alt="missing">');
  t.after(() => { fs.rmSync(f.dir, { recursive: true, force: true }); });
  await assert.rejects(buildHtml(resolveConfig(['--input', f.input, '--output', f.output], f.dir), env, log),
    (error: unknown) => error instanceof InputError && error.message.includes(`${f.input}:6:`)
      && error.message.includes('missing.png 1x'));
});

test('image readiness diagnostics identify corrupt, empty, missing-src, HTTP and network failures', { skip: process.env.RUN_E2E !== '1' }, async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/drop.png') { request.socket.destroy(); return; }
    response.writeHead(404); response.end('not found');
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  t.after(() => { server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const remote = `http://127.0.0.1:${address.port}`;
  for (const [name, body, reason] of [
    ['corrupt', '![corrupt](broken.png)', /cannot be decoded or loaded|image load failed/],
    ['data', '<img src="data:image/png;base64,bm90LWltYWdl">', /cannot be decoded or loaded|image load failed/],
    ['empty', '<img src="">', /image destination is empty/],
    ['missing-src', '<img alt="caption">', /image src is not specified/],
    ['http', `![remote](${remote}/missing.png)`, /cannot be decoded or loaded|image load failed/],
    ['network', `![remote](${remote}/drop.png)`, /cannot be decoded or loaded|image load failed/],
  ] as const) {
    await t.test(name, async () => {
      const f = fixture(body);
      try {
        fs.writeFileSync(path.join(f.dir, 'broken.png'), 'invalid image bytes');
        fs.writeFileSync(f.output, 'OLD OUTPUT');
        const browser = process.env.BROWSER_PATH ? ['--browser-path', process.env.BROWSER_PATH] : [];
        await assert.rejects(runBuild(resolveConfig(['--input', f.input, '--output', f.output, ...browser], f.dir), env, log),
          (error: unknown) => error instanceof RuntimeError && error.message.includes(`${f.input}:6:`)
            && reason.test(error.message) && error.message.includes('destination'));
        assert.equal(fs.readFileSync(f.output, 'utf8'), 'OLD OUTPUT');
      } finally {
        fs.rmSync(f.dir, { recursive: true, force: true });
      }
    });
  }
});

test('scripted images, picture sources, and image-free documents still produce PDFs', { skip: process.env.RUN_E2E !== '1' }, async () => {
  for (const body of [
    '# No images\n\nText.',
    `<img id="later" alt="scripted">\n\n<script>window.pfpdf.registerReady(new Promise(resolve => { setTimeout(() => { document.getElementById('later').src = ${JSON.stringify(validImage)}; resolve(); }, 20); }));</script>`,
    '<picture><source srcset="picture.svg"><img alt="picture source only"></picture>',
    '<picture><source srcset="picture.svg"><img src="" alt="empty fallback"></picture>',
  ]) {
    const f = fixture(body);
    try {
      fs.writeFileSync(path.join(f.dir, 'picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>');
      const browser = process.env.BROWSER_PATH ? ['--browser-path', process.env.BROWSER_PATH] : [];
      await runBuild(resolveConfig(['--input', f.input, '--output', f.output, ...browser], f.dir), env, log);
      assert.equal(fs.readFileSync(f.output).subarray(0, 5).toString(), '%PDF-');
    } finally {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  }
});

test('corrupt generated image assets retain the original code-fence location', { skip: process.env.RUN_E2E !== '1' }, async (t) => {
  const f = fixture('```mermaid\nflowchart LR\n  A --> B\n```');
  t.after(() => { fs.rmSync(f.dir, { recursive: true, force: true }); });
  const built = await buildHtml(resolveConfig(['--input', f.input, '--output', f.output], f.dir), env, log);
  assert.equal(built.generated.get('document.html')!.toString(), built.html);
  built.generated.set('generated/mermaid-0001.svg', Buffer.from('not an SVG'));
  const controller = new AbortController();
  await assert.rejects(renderDocument({
    manifest: built.manifest, generated: built.generated, workspaceDir: f.dir, controller,
    outputPath: f.output, deadline: Date.now() + 60000, signal: controller.signal,
    browserPath: process.env.BROWSER_PATH ?? null, logLevel: 'error',
    diagnosticsPath: path.join(f.dir, 'renderer.log'), warn: log.warn, info: log.info,
  }), (error: unknown) => error instanceof RuntimeError && error.message.includes(`${f.input}:6:`)
    && error.message.includes('generated/mermaid-0001.svg'));
});
