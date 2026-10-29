import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

test('every file loses its own front matter while only the first configures the document', (t) => {
  const dir = fixture(t);
  const result = resolveInput(dir, null, env, noop);
  assert.equal(result.metadata.title.plainText, 'Collected notes');
  assert.equal(result.metadata.lang, 'en', 'ignored language metadata must not leak into language inference');
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

test('later metadata never supplies missing first-file metadata', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, '01_first.md'), '# First\n');
  assert.throws(() => resolveInput(dir, null, env, noop), /title is required/);
  const result = resolveInput(dir, 'CLI title', env, noop);
  assert.ok(Object.values(result.config).every((value) => value === null), JSON.stringify(result.config));
  assert.deepEqual(result.bibliography, []);
  assert.equal(result.metadata.lang, 'en');
});

test('ignored metadata still validates syntax, known values, and unknown-key policy', (t) => {
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
  const second = path.join(dir, '02_second.md');
  fs.writeFileSync(second, '---\ntoc: false\ncustom: true\n---\n# Second\n');
  const call = (args: string[]) => spawnSync(process.execPath, [cli, '--input', dir, ...args], { encoding: 'utf8', env, timeout: 30000, shell: false });
  const effective = call(['--print-effective-config', '--toc']);
  assert.equal(effective.status, 0, effective.stderr);
  const config = JSON.parse(effective.stdout) as { config: { toc: unknown; template: unknown } };
  assert.deepEqual(config.config.toc, { value: true, source: 'cli' });
  assert.deepEqual(config.config.template, { value: { kind: 'bundled', name: 'academic' }, source: 'front-matter' });
  assert.match(effective.stderr, /02_second\.md: unknown front matter key: custom/);
  const strict = call(['--print-effective-config', '--strict-front-matter']);
  assert.equal(strict.status, 2, strict.stderr);
  assert.equal(strict.stdout, '');
  const doctor = call(['--doctor', '--strict-front-matter', '--browser-path', path.join(dir, 'missing-browser')]);
  assert.equal(doctor.status, 1, doctor.stderr);
  const checks = (JSON.parse(doctor.stdout) as { checks: Array<{ id: string; status: string; message: string }> }).checks;
  assert.equal(checks.find((check) => check.id === 'input')!.status, 'fail');
  assert.match(checks.find((check) => check.id === 'input')!.message, /02_second\.md: unknown front matter key: custom/);
});

test('directory input with independently maintained front matter produces a complete PDF', { skip: process.env.RUN_E2E !== '1' }, (t) => {
  const dir = fixture(t);
  const output = path.join(dir, 'combined.pdf');
  const browser = process.env.BROWSER_PATH ? ['--browser-path', process.env.BROWSER_PATH] : [];
  const result = spawnSync(process.execPath, [cli, '--input', dir, '--output', output, '--title', 'CLI collection', '--no-logo', ...browser], { encoding: 'utf8', env, timeout: 330000, shell: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(output).subarray(0, 5).toString(), '%PDF-');
  const text = spawnSync('pdftotext', [output, '-'], { encoding: 'utf8' });
  if (text.status === 0) {
    for (const word of ['CLI collection', 'First', 'Second body.', 'Third body.']) assert.ok(text.stdout.includes(word), word);
    assert.doesNotMatch(text.stdout, /Ignored title/);
  }
});
