import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  applyFrontMatterTemplate,
  effectiveConfigJson,
  resolveConfig,
  validateConfigForMode,
} from '../config.js';
import { InputError } from '../errors.js';

const cwd = '/tmp';

test('default template is the bundled default template', () => {
  const c = resolveConfig(['--input', 'a.md', '--output', 'a.pdf'], {}, cwd);
  assert.deepEqual(c.template.value, { kind: 'bundled', name: 'default' });
  assert.equal(c.template.source, 'default');
});

test('CLI overrides environment', () => {
  const c = resolveConfig(['--input', 'a.md', '--output', 'a.pdf', '--template', 'pfn'], { PFPDF_TEMPLATE: 'default' }, cwd);
  assert.deepEqual(c.template.value, { kind: 'bundled', name: 'pfn' });
  assert.equal(c.template.source, 'cli');
});

test('front matter template applies below environment and CLI', () => {
  const base = resolveConfig(['--input', 'a.md', '--output', 'a.pdf'], {}, cwd);
  const fromDocument = applyFrontMatterTemplate(base, 'pfn');
  assert.deepEqual(fromDocument.template, {
    value: { kind: 'bundled', name: 'pfn' },
    source: 'front-matter',
  });

  const fromEnvironment = resolveConfig(
    ['--input', 'a.md', '--output', 'a.pdf'],
    { PFPDF_TEMPLATE: 'book' },
    cwd,
  );
  assert.strictEqual(applyFrontMatterTemplate(fromEnvironment, 'pfn'), fromEnvironment);

  const fromCli = resolveConfig(
    ['--input', 'a.md', '--output', 'a.pdf', '--template', 'compact'],
    {},
    cwd,
  );
  assert.strictEqual(applyFrontMatterTemplate(fromCli, 'pfn'), fromCli);

  const effective = JSON.parse(effectiveConfigJson(fromDocument)) as {
    config: { template: { source: string } };
  };
  assert.equal(effective.config.template.source, 'front-matter');
});

test('environment applies when CLI is absent', () => {
  const c = resolveConfig(['--input', 'a.md', '--output', 'a.pdf'], { PFPDF_TOC: 'false' }, cwd);
  assert.equal(c.toc.value, false);
});

test('effective configuration uses schema version 3', () => {
  const config = resolveConfig(['--input', 'a.md', '--output', 'a.pdf'], {}, cwd);
  const result = JSON.parse(effectiveConfigJson(config)) as { schemaVersion: number };
  assert.equal(result.schemaVersion, 3);
});

test('positive/negative pair conflict is code 2', () => {
  assert.throws(
    () => resolveConfig(['--input', 'a.md', '--output', 'a.pdf', '--toc', '--no-toc'], {}, cwd),
    InputError,
  );
});

test('repeated option is rejected even with the same value', () => {
  assert.throws(
    () => resolveConfig(['--input', 'a.md', '--input', 'a.md', '--output', 'a.pdf'], {}, cwd),
    InputError,
  );
});

test('--font-dir may repeat; CLI replaces env list', () => {
  const c = resolveConfig(
    ['--input', 'a.md', '--output', 'a.pdf', '--font-dir', 'x', '--font-dir', 'y'],
    { PFPDF_FONT_DIRS: 'z' },
    cwd,
  );
  assert.deepEqual(c.fontDirs.value, ['x', 'y']);
  assert.equal(c.fontDirs.source, 'cli');
});

test('--no-font-dirs resets environment list', () => {
  const c = resolveConfig(['--input', 'a.md', '--output', 'a.pdf', '--no-font-dirs'], { PFPDF_FONT_DIRS: 'z' }, cwd);
  assert.deepEqual(c.fontDirs.value, []);
  assert.equal(c.fontDirs.source, 'cli');
});

test('template/template-dir exclusive per source', () => {
  assert.throws(() => resolveConfig(['--template', 'a', '--template-dir', 'b', '--input', 'x.md', '--output', 'y.pdf'], {}, cwd), InputError);
  assert.throws(() => resolveConfig(['--input', 'x.md', '--output', 'y.pdf'], { PFPDF_TEMPLATE: 'default', PFPDF_TEMPLATE_DIR: '/x' }, cwd), InputError);
});

test('CLI template overrides both env template settings', () => {
  const c = resolveConfig(['--input', 'x.md', '--output', 'y.pdf', '--template', 'pfn'], { PFPDF_TEMPLATE: 'default', PFPDF_TEMPLATE_DIR: '/x' }, cwd);
  assert.deepEqual(c.template.value, { kind: 'bundled', name: 'pfn' });
});

test('unknown option / positional / missing value are code 2', () => {
  assert.throws(() => resolveConfig(['--bogus'], {}, cwd), InputError);
  assert.throws(() => resolveConfig(['stray'], {}, cwd), InputError);
  assert.throws(() => resolveConfig(['--input'], {}, cwd), InputError);
});

test('mode flags are exclusive', () => {
  assert.throws(() => resolveConfig(['--doctor', '--version'], {}, cwd), InputError);
});

test('input-free modes validate an explicit title in their mode validation phase', () => {
  for (const mode of ['--help', '--version', '--print-effective-config', '--doctor']) {
    const config = resolveConfig([mode, '--title', '<b>bad</b>'], {}, cwd);
    assert.throws(() => {
      validateConfigForMode(config);
    }, InputError);
  }
  const convert = resolveConfig(
    ['--input', 'a.md', '--output', 'a.pdf', '--title', '<b>validated with input</b>'],
    {},
    cwd,
  );
  assert.doesNotThrow(() => {
    validateConfigForMode(convert);
  });
});

test('boolean env values are strict', () => {
  assert.throws(() => resolveConfig(['--input', 'a.md', '--output', 'a.pdf'], { PFPDF_TOC: 'yes' }, cwd), InputError);
});

test('render timeout bounds', () => {
  assert.throws(() => resolveConfig(['--input', 'a.md', '--output', 'a.pdf', '--render-timeout-ms', '500'], {}, cwd), InputError);
  assert.throws(() => resolveConfig(['--input', 'a.md', '--output', 'a.pdf', '--render-timeout-ms', '0'], {}, cwd), InputError);
  const c = resolveConfig(['--input', 'a.md', '--output', 'a.pdf', '--render-timeout-ms', '60000'], {}, cwd);
  assert.equal(c.renderTimeoutMs.value, 60000);
});

test('stdin/stdout paths rejected', () => {
  assert.throws(() => resolveConfig(['--input', '-', '--output', 'a.pdf'], {}, cwd), InputError);
});

test('empty PFPDF_FONT_DIRS component rejected', () => {
  assert.throws(
    () => resolveConfig(
      ['--input', 'a.md', '--output', 'a.pdf'],
      { PFPDF_FONT_DIRS: `a${path.delimiter}${path.delimiter}b` },
      cwd,
    ),
    InputError,
  );
});

test('empty path values are rejected instead of meaning unset or cwd', () => {
  assert.throws(
    () => resolveConfig(['--input', '', '--output', 'a.pdf'], {}, cwd),
    InputError,
  );
  assert.throws(
    () => resolveConfig(['--input', 'a.md', '--output', 'a.pdf'], { PFPDF_LOGO: '' }, cwd),
    InputError,
  );
  assert.throws(
    () => resolveConfig(['--input', 'a.md', '--output', 'a.pdf'], { PFPDF_FONT_DIRS: '' }, cwd),
    InputError,
  );
});
