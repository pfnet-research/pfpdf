import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';
import { BUNDLED_TEMPLATE_NAMES } from '../bundled-templates.js';
import { buildHtml } from '../build.js';
import { resolveConfig, applyFrontMatterConfig, effectiveConfigJson } from '../config.js';
import { resolveInput } from '../input.js';
import { InputError } from '../errors.js';

const log = { warn: (): void => {}, info: (): void => {}, debug: (): void => {} };
const env = { ...process.env, SOURCE_DATE_EPOCH: '0' };
const cli = fileURLToPath(new URL('../launcher.js', import.meta.url));
function fixture(t: test.TestContext): { dir: string; input: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-cover-toggle-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(input, '---\ntitle: Cover title\nauthor: QA Author\nseries: QA Series\ndate: QA Date\nconfidential: true\nlang: en\ncover: false\n---\n# Body heading\n\nBody marker.\n');
  return { dir, input };
}

test('cover is a document setting with CLI precedence and independent TOC control', async (t) => {
  const { dir, input } = fixture(t);
  const base = resolveConfig(['--input', input, '--output', path.join(dir, 'out.pdf')], dir);
  assert.deepEqual(base.cover, { value: true, source: 'default' });
  const fromDocument = applyFrontMatterConfig(base, resolveInput(input, null, env, log.warn).config);
  assert.deepEqual(fromDocument.cover, { value: false, source: 'front-matter' });
  const fromCli = applyFrontMatterConfig(resolveConfig(['--input', input, '--output', 'out.pdf', '--cover', '--no-toc'], dir), resolveInput(input, null, env, log.warn).config);
  assert.deepEqual(fromCli.cover, { value: true, source: 'cli' });
  assert.equal(fromCli.toc.value, false);
  assert.deepEqual((JSON.parse(effectiveConfigJson(fromDocument)) as { config: { cover: unknown } }).config.cover, fromDocument.cover);
  assert.throws(() => resolveConfig(['--doctor', '--cover', '--no-cover'], dir), InputError);
  assert.throws(() => resolveConfig(['--doctor', '--no-cover', '--no-cover'], dir), InputError);
  fs.writeFileSync(input, '---\ntitle: T\ncover: yes\n---\nbody\n');
  await assert.rejects(buildHtml(resolveConfig(['--input', input, '--output', 'out.pdf', '--cover'], dir), env, log), /front matter cover: expected a YAML boolean/);
});

test('all bundled covers can be removed while retaining running metadata and independently selected contents', async (t) => {
  const { dir, input } = fixture(t);
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    for (const cover of [true, false]) {
      for (const toc of [true, false]) {
      const config = resolveConfig(['--input', input, '--output', 'out.pdf', '--template', template, cover ? '--cover' : '--no-cover', toc ? '--toc' : '--no-toc'], dir);
      const built = await buildHtml(config, env, log);
      assert.equal(built.generated.get('document.html')!.toString(), built.html);
      const dom = new JSDOM(built.html) as unknown as { window: { document: Document; close: () => void } };
      const doc = dom.window.document;
      assert.equal(doc.querySelectorAll('body > header').length, cover ? 1 : 0, template);
      assert.equal(doc.querySelectorAll('.pfpdf-toc-list').length, toc ? 1 : 0, template);
      assert.equal(doc.querySelector('title')!.textContent, 'Cover title', template);
      assert.equal(doc.querySelectorAll('.pfpdf-authors').length, cover ? 1 : 0, template);
      if (!cover) {
        assert.ok(doc.querySelector('.pfpdf-running-metadata'), template);
        assert.match(doc.querySelector('.pfpdf-running-metadata')!.textContent, /QA Series/);
        assert.match(doc.querySelector('.pfpdf-running-metadata')!.textContent, /Confidential/);
        assert.doesNotMatch(doc.body.textContent, /QA Author|QA Date/);
      }
      dom.window.close();
      }
    }
  }
});

test('custom cover slots are optional and opt in to removal without changing the content contract', async (t) => {
  const { dir, input } = fixture(t);
  const custom = path.join(dir, 'custom');
  fs.mkdirSync(custom);
  fs.writeFileSync(path.join(custom, 'style.css'), '');
  fs.writeFileSync(path.join(custom, 'vivliostyle.css'), '');
  for (const hasCover of [true, false]) {
    fs.writeFileSync(path.join(custom, 'template.html'), '<!doctype html><html><head></head><body>' +
      (hasCover ? '<header data-pfpdf-slot="cover"><h1 data-pfpdf-slot="title"></h1></header>' : '<p>Unmarked custom content</p>') +
      '<main data-pfpdf-slot="content"></main></body></html>');
    const built = await buildHtml(resolveConfig(['--input', input, '--output', 'out.pdf', '--template', custom, '--no-cover'], dir), env, log);
    assert.doesNotMatch(built.html, /<header/);
    assert.match(built.html, /Body marker\./);
    if (!hasCover) assert.match(built.html, /Unmarked custom content/);
  }
  for (const nested of ['content', 'toc']) {
    fs.writeFileSync(path.join(custom, 'template.html'), '<!doctype html><html><head></head><body>' +
      `<header data-pfpdf-slot="cover"><div data-pfpdf-slot="${nested}"></div></header>` +
      (nested === 'toc' ? '<main data-pfpdf-slot="content"></main>' : '') + '</body></html>');
    await assert.rejects(buildHtml(resolveConfig(['--input', input, '--output', 'out.pdf', '--template', custom], dir), env, log), /cover slot must not contain the content or toc slot/);
  }
  fs.writeFileSync(path.join(custom, 'template.html'), '<!doctype html><html><head></head><body>' +
    '<header data-pfpdf-slot="cover"><h1 data-pfpdf-slot="title"></h1></header>' +
    '<p data-pfpdf-slot="series"></p><p data-pfpdf-slot="confidential"></p><main data-pfpdf-slot="content"></main></body></html>');
  const external = await buildHtml(resolveConfig(['--input', input, '--output', 'out.pdf', '--template', custom], dir), env, log);
  assert.match(external.html, /<p>QA Series<\/p><p>Confidential<\/p>/);
  assert.doesNotMatch(external.html, /class="pfpdf-running-metadata"/);
  fs.writeFileSync(path.join(custom, 'template.html'), '<!doctype html><html><head data-pfpdf-slot="cover"></head><body><main data-pfpdf-slot="content"></main></body></html>');
  await assert.rejects(buildHtml(resolveConfig(['--input', input, '--output', 'out.pdf', '--template', custom], dir), env, log), /cover slot must be a removable body element/);
});

test('cover settings are exposed through effective config and used during doctor input checks', (t) => {
  const { dir, input } = fixture(t);
  const call = (args: string[]) => spawnSync(process.execPath, [cli, '--input', input, ...args], { encoding: 'utf8', env, timeout: 30000, shell: false });
  const effective = call(['--print-effective-config']);
  assert.equal(effective.status, 0, effective.stderr);
  assert.deepEqual((JSON.parse(effective.stdout) as { config: { cover: unknown } }).config.cover, { value: false, source: 'front-matter' });
  const overridden = call(['--print-effective-config', '--cover']);
  assert.equal(overridden.status, 0, overridden.stderr);
  assert.deepEqual((JSON.parse(overridden.stdout) as { config: { cover: unknown } }).config.cover, { value: true, source: 'cli' });
  const doctor = call(['--doctor', '--browser-path', path.join(dir, 'missing-browser')]);
  assert.equal(doctor.status, 1, doctor.stderr);
  const checks = (JSON.parse(doctor.stdout) as { checks: Array<{ id: string; status: string }> }).checks;
  assert.equal(checks.find((check) => check.id === 'input')!.status, 'pass');
});

test('coverless documents omit disabled running metadata in every template', async (t) => {
  const { dir, input } = fixture(t);
  fs.writeFileSync(input, '---\ntitle: Cover title\ncover: false\nconfidential: false\n---\n# Body\n');
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    const built = await buildHtml(resolveConfig(['--input', input, '--output', 'out.pdf', '--template', template], dir), env, log);
    assert.doesNotMatch(built.html, /class="pfpdf-running-metadata"/);
    assert.doesNotMatch(built.html, />Confidential</);
  }
});

test('cover/contents PDF pagination works across all seven templates', { skip: process.env.RUN_E2E !== '1' }, async (t) => {
  const { dir, input } = fixture(t);
  const browser = process.env.BROWSER_PATH ? ['--browser-path', process.env.BROWSER_PATH] : [];
  const qaDir = process.env.PFPDF_COVER_QA_DIR;
  if (qaDir) fs.mkdirSync(qaDir, { recursive: true });
  for (const template of BUNDLED_TEMPLATE_NAMES) {
    for (const cover of [true, false]) {
      for (const toc of [true, false]) {
      await t.test(`${template} cover=${cover} toc=${toc}`, async () => {
        const name = `${template}-cover-${cover}-toc-${toc}`;
        const output = path.join(dir, `${name}.pdf`);
        const result = spawnSync(process.execPath, [cli, '--input', input, '--output', output, '--template', template, cover ? '--cover' : '--no-cover', toc ? '--toc' : '--no-toc', ...browser], { encoding: 'utf8', env, timeout: 330000, shell: false });
        assert.equal(result.status, 0, result.stderr);
        const bytes = fs.readFileSync(output);
        const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
        assert.equal(pdf.getTitle(), 'Cover title');
        assert.equal(pdf.getAuthor(), 'QA Author');
        assert.equal(pdf.getPageCount(), template === 'compact' ? 1 : 1 + Number(cover) + Number(toc), name);
        const first = spawnSync('pdftotext', ['-f', '1', '-l', '1', output, '-'], { encoding: 'utf8' });
        if (first.status === 0) {
          assert.match(first.stdout.replace(/\s+/g, ''), /Confidential/i, name);
          if (!cover && !toc) assert.match(first.stdout, /Body marker\./, `${name}: no empty first page`);
          if (!cover && toc) assert.match(first.stdout, /Contents/, name);
          if (!cover) assert.doesNotMatch(first.stdout, /QA Author|QA Date/, name);
        }
        if (qaDir) fs.copyFileSync(output, path.join(qaDir, `${name}.pdf`));
      });
      }
    }
  }
});
