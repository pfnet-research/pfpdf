import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { resolveInput, readFrontMatterConfig } from '../input.js';
import { resolveConfig } from '../config.js';
import { buildHtml } from '../build.js';
import { InputError } from '../errors.js';

const env = { ...process.env, SOURCE_DATE_EPOCH: '0' };
const noop = (): void => {};
const cli = fileURLToPath(new URL('../launcher.js', import.meta.url));
function fixture(t: test.TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-per-file-front-matter-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(dir, '01_first.md'), '---\ntitle: Collected notes\ntemplate: academic\ntoc: false\nlogo: assets/logo.svg\nbibliography: references.bib\n---\n# First\n\n[Second](02_second.md#second)\n');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  fs.writeFileSync(path.join(dir, 'references.bib'), '@book{first,title={First},author={Alice},year={2026}}');
  fs.writeFileSync(path.join(dir, '02_second.md'), '\uFEFF---\r\ntitle: Ignored title\r\ntemplate: pfn\r\ntoc: true\r\nlogo: missing.svg\r\nbibliography: absent.bib\r\nlang: ja\r\n---\r\n# Second\r\n\r\nSecond body.\r\n');
  fs.writeFileSync(path.join(dir, '03_plain.md'), '# Third\n\nThird body.\n');
  return dir;
}

test('every file loses its front matter and each key retains its earliest supplied value', (t) => {
  const dir = fixture(t);
  const result = resolveInput(dir, null, env, noop);
  assert.equal(result.metadata.title.plainText, 'Collected notes');
  assert.equal(result.metadata.lang, 'ja', 'later values supply keys absent from earlier files');
  assert.equal(result.config.template, 'academic');
  assert.equal(result.config.toc, false);
  assert.equal(result.config.logo?.kind, 'local');
  assert.deepEqual(result.bibliography.map((file) => file.path), [path.join(dir, 'references.bib')]);
  assert.deepEqual(result.files.map((file) => file.name), ['01_first.md', '02_second.md', '03_plain.md']);
  assert.deepEqual(result.files.map((file) => file.lineOffset), [7, 8, 0]);
  assert.equal(result.files[1]!.content, '# Second\r\n\r\nSecond body.\r\n');
  assert.deepEqual(readFrontMatterConfig(dir, noop), result.config);
  assert.equal(resolveInput(dir, 'CLI title', env, noop).metadata.title.plainText, 'CLI title');
});

test('later metadata supplies document settings and title even when the first file has no front matter', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, '01_first.md'), '# First\n');
  fs.writeFileSync(path.join(dir, '02_second.md'), '---\ntitle: Later title\nauthor: Later author\nseries: Later series\ndate: Later date\npage_size: A5\nconfidential: true\nlang: ja\ndir: ltr\ntemplate: pfn\ntoc: false\ncover: false\nlogo: assets/logo.svg\nbibliography: references.bib\n---\n# Second\n');
  const inherited = resolveInput(dir, null, env, noop);
  assert.equal(inherited.metadata.title.plainText, 'Later title');
  assert.deepEqual(inherited.metadata.author, ['Later author']);
  assert.equal(inherited.metadata.series, 'Later series');
  assert.equal(inherited.metadata.date, 'Later date');
  assert.equal(inherited.metadata.pageSize.css, '148mm 210mm');
  assert.equal(inherited.metadata.confidential, true);
  assert.equal(inherited.metadata.lang, 'ja');
  assert.equal(inherited.metadata.dir, 'ltr');
  assert.equal(inherited.config.template, 'pfn');
  assert.equal(inherited.config.toc, false);
  assert.equal(inherited.config.cover, false);
  assert.deepEqual(inherited.config.logo, { kind: 'local', path: 'assets/logo.svg', absPath: path.join(dir, 'assets/logo.svg') });
  assert.deepEqual(inherited.bibliography.map((file) => file.path), [path.join(dir, 'references.bib')]);
  assert.deepEqual(readFrontMatterConfig(dir, noop), inherited.config);
  const result = resolveInput(dir, 'CLI title', env, noop);
  assert.equal(result.metadata.title.plainText, 'CLI title');
  assert.deepEqual(result.config, inherited.config);
});

test('earlier false values and bibliography lists stay whole while later files supply missing keys', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, '01_first.md'), '---\ntitle: Earlier title\ntoc: false\ncover: false\nconfidential: false\nlogo: false\nbibliography: [references.bib]\n---\n# First\n');
  fs.writeFileSync(path.join(dir, '02_second.md'), '---\ntitle: Later title\nauthor: Later author\ntemplate: book\ntoc: true\ncover: true\nconfidential: true\nlogo: missing.svg\nbibliography: [absent.bib, missing.bib]\n---\n# Second\n');
  const result = resolveInput(dir, null, env, noop);
  assert.equal(result.metadata.title.plainText, 'Earlier title');
  assert.deepEqual(result.metadata.author, ['Later author']);
  assert.equal(result.metadata.confidential, false);
  assert.equal(result.config.template, 'book');
  assert.equal(result.config.toc, false);
  assert.equal(result.config.cover, false);
  assert.deepEqual(result.config.logo, { kind: 'none' });
  assert.deepEqual(result.bibliography.map((file) => file.declaredPath), ['references.bib']);
  assert.deepEqual(readFrontMatterConfig(dir, noop), result.config);
});

test('selected missing assets fail while valid later values cannot hide them', async (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, '01_first.md'), '---\ntitle: Earlier title\nlogo: missing.svg\n---\n# First\n');
  fs.writeFileSync(path.join(dir, '02_second.md'), '---\nlogo: assets/logo.svg\n---\n# Second\n');
  const config = resolveConfig(['--input', dir, '--output', path.join(dir, 'out.pdf')], dir);
  await assert.rejects(buildHtml(config, env, { warn: noop, info: noop, debug: noop }), /missing\.svg/);
  await buildHtml(resolveConfig(['--input', dir, '--output', path.join(dir, 'out.pdf'), '--no-logo'], dir), env, { warn: noop, info: noop, debug: noop });
  fs.writeFileSync(path.join(dir, '01_first.md'), '---\ntitle: Earlier title\nbibliography: absent.bib\n---\n# First\n');
  fs.writeFileSync(path.join(dir, '02_second.md'), '---\nbibliography: references.bib\n---\n# Second\n');
  assert.throws(() => resolveInput(dir, null, env, noop), /cannot read bibliography .*absent\.bib/);
});

test('all metadata validates syntax, overridden known values, and unknown-key policy', (t) => {
  const dir = fixture(t);
  const second = path.join(dir, '02_second.md');
  for (const yaml of ['title: false', 'title: ""', 'title: "<b>bad</b>"', 'lang: invalid_tag', 'dir: LTR', 'toc: yes', 'cover: yes', 'logo: true', 'bibliography: []', 'bibliography: missing.txt', 'bibliography: [missing.bib, ./missing.bib]', 'title: T\ntitle: U', 'tags: [unclosed']) {
    fs.writeFileSync(second, `---\n${yaml}\n---\n# Second\n`);
    for (const strictFrontMatter of [false, true]) {
      for (const run of [() => resolveInput(dir, 'CLI title', env, noop, { strictFrontMatter }), () => readFrontMatterConfig(dir, noop, { strictFrontMatter })]) {
        assert.throws(run, (error: unknown) => error instanceof InputError && error.message.includes(second), yaml);
      }
    }
  }
  fs.writeFileSync(second, '---\ntitle: T\ncustom: true\n---\n# Second\n');
  const warnings: string[] = [];
  resolveInput(dir, null, env, (msg) => { warnings.push(msg); });
  assert.deepEqual(warnings, [`${second}: unknown front matter key: custom; ignored`]);
  assert.throws(() => resolveInput(dir, null, env, noop, { strictFrontMatter: true }), /unknown front matter key: custom/);
  fs.writeFileSync(second, '---\ntitle: unfinished\n');
  assert.throws(() => readFrontMatterConfig(dir, noop), /front matter is not closed/);
});

test('renderer HTML retains headings and file links without exposing ignored metadata', async (t) => {
  const dir = fixture(t);
  const warnings: string[] = [];
  fs.appendFileSync(path.join(dir, '02_second.md'), '\r\n```unknown-highlighter\r\ntext\r\n```\r\n');
  const result = await buildHtml(resolveConfig(['--input', dir, '--output', path.join(dir, 'out.pdf'), '--toc', '--no-logo'], dir), env,
    { warn: (msg): void => { warnings.push(msg); }, info: noop, debug: noop });
  assert.equal(result.generated.get('document.html')!.toString(), result.html);
  assert.match(result.html, /href="#second"/);
  assert.match(result.html, /id="second"/);
  assert.match(result.html, /id="pfpdf-file-0003"/);
  assert.match(result.html, /academic-cover/);
  assert.match(result.html, /Collected notes/);
  assert.doesNotMatch(result.html, /Ignored title|missing\.svg|absent\.bib/);
  assert.ok(warnings.some((warning) => warning.includes('02_second.md:13:')), warnings.join('\n'));
});

test('effective config and doctor inspect later front matter using their normal JSON contracts', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, '01_first.md'), '---\ntitle: Earlier title\n---\n# First\n');
  const second = path.join(dir, '02_second.md');
  fs.writeFileSync(second, '---\ntemplate: pfn\ntoc: false\ncover: false\nlogo: false\ncustom: true\n---\n# Second\n');
  const call = (args: string[]) => spawnSync(process.execPath, [cli, '--input', dir, ...args], { encoding: 'utf8', env, timeout: 30000, shell: false });
  const effective = call(['--print-effective-config', '--toc']);
  assert.equal(effective.status, 0, effective.stderr);
  const config = JSON.parse(effective.stdout) as { config: { toc: unknown; cover: unknown; template: unknown } };
  assert.deepEqual(config.config.toc, { value: true, source: 'cli' });
  assert.deepEqual(config.config.cover, { value: false, source: 'front-matter' });
  assert.deepEqual(config.config.template, { value: { kind: 'bundled', name: 'pfn' }, source: 'front-matter' });
  assert.match(effective.stderr, /02_second\.md: unknown front matter key: custom/);
  const strict = call(['--print-effective-config', '--strict-front-matter']);
  assert.equal(strict.status, 2, strict.stderr);
  assert.equal(strict.stdout, '');
  const doctor = call(['--doctor', '--strict-front-matter', '--browser-path', path.join(dir, 'missing-browser')]);
  assert.equal(doctor.status, 1, doctor.stderr);
  const checks = (JSON.parse(doctor.stdout) as { checks: Array<{ id: string; status: string; message: string }> }).checks;
  assert.equal(checks.find((check) => check.id === 'input')!.status, 'fail');
  assert.match(checks.find((check) => check.id === 'input')!.message, /02_second\.md: unknown front matter key: custom/);
  const validDoctor = call(['--doctor', '--browser-path', path.join(dir, 'missing-browser')]);
  assert.equal(validDoctor.status, 1, validDoctor.stderr);
  const validChecks = (JSON.parse(validDoctor.stdout) as { checks: Array<{ id: string; status: string }> }).checks;
  assert.equal(validChecks.find((check) => check.id === 'input')!.status, 'warning');
});

test('directory input inherits later metadata in the exact renderer HTML and final PDF', { skip: process.env.RUN_E2E !== '1' }, async (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, '01_first.md'), '# First\n\n[Second](02_second.md#second)\n');
  fs.writeFileSync(path.join(dir, '02_second.md'), '\uFEFF---\r\ntitle: Later collection\r\nauthor: Later Author\r\nseries: Later Series\r\nconfidential: true\r\nlang: en\r\ntemplate: pfn\r\ncover: false\r\ntoc: false\r\nlogo: assets/logo.svg\r\nbibliography: [references.bib]\r\n---\r\n# Second\r\n\r\nSecond body.\r\n');
  fs.writeFileSync(path.join(dir, '03_plain.md'), '---\ntitle: Ignored title\nlogo: missing.svg\nbibliography: [absent.bib]\n---\n# Third\n\nThird body.\n');
  const output = path.join(dir, 'combined.pdf');
  const browser = process.env.BROWSER_PATH ? ['--browser-path', process.env.BROWSER_PATH] : [];
  const result = spawnSync(process.execPath, [cli, '--input', dir, '--output', output, '--no-logo', '--keep-work-dir', ...browser], { encoding: 'utf8', env, timeout: 330000, shell: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  const workspace = /workspace kept at (.+?);/.exec(result.stderr)?.[1];
  assert.ok(workspace, result.stderr);
  try {
    const html = fs.readFileSync(path.join(workspace, 'document.html'), 'utf8');
    assert.match(html, /<title>Later collection<\/title>/);
    assert.match(html, /pfpdf-no-cover/);
    assert.match(html, /Later Series/);
    assert.doesNotMatch(html, /Ignored title|missing\.svg|absent\.bib/);
    const bytes = fs.readFileSync(output);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    assert.equal(pdf.getTitle(), 'Later collection');
    assert.equal(pdf.getAuthor(), 'Later Author');
    const text = spawnSync('pdftotext', [output, '-'], { encoding: 'utf8' });
    if (text.status === 0) {
      for (const word of ['First', 'Second body.', 'Third body.']) assert.ok(text.stdout.includes(word), word);
      assert.doesNotMatch(text.stdout, /Ignored title/);
    }
    const qa = process.env.PFPDF_QA_DIR;
    if (qa) {
      fs.mkdirSync(qa, { recursive: true });
      fs.writeFileSync(path.join(qa, 'per-file-front-matter.html'), html);
      fs.copyFileSync(output, path.join(qa, 'per-file-front-matter.pdf'));
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
