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

test('effective configuration uses schema version 4', () => {
  const config = resolveConfig(['--input', 'a.md', '--output', 'a.pdf'], {}, cwd);
  const result = JSON.parse(effectiveConfigJson(config)) as { schemaVersion: number };
  assert.equal(result.schemaVersion, 4);
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

test('template source and explicit preset are exclusive per source', () => {
  assert.throws(() => resolveConfig(['--template', 'a', '--template-preset', 'book', '--input', 'x.md', '--output', 'y.pdf'], {}, cwd), InputError);
  assert.throws(() => resolveConfig(['--input', 'x.md', '--output', 'y.pdf'], { PFPDF_TEMPLATE: './default', PFPDF_TEMPLATE_PRESET: 'default' }, cwd), InputError);
});

test('repository template and logo settings are parsed as logical selections', () => {
  const templateLocator = 'git::https://example.com/assets.git//templates/report?ref=v1.0.0';
  const logoLocator = 'git::ssh://git@example.com/assets.git//logos/main.svg?ref=0123456789abcdef';
  const c = resolveConfig([
    '--input', 'x.md', '--output', 'y.pdf',
    '--template', templateLocator,
    '--logo', logoLocator,
  ], {}, cwd);
  assert.deepEqual(c.template.value, { kind: 'repository', locator: templateLocator });
  assert.deepEqual(c.logo.value, { kind: 'repository', locator: logoLocator });
  assert.equal(c.logoAbs, null);
});

test('explicit template preset and logo disable alternatives are mutually exclusive', () => {
  const locator = 'git::https://example.com/assets.git//templates/report?ref=v1';
  assert.throws(
    () => resolveConfig([
      '--input', 'x.md', '--output', 'y.pdf', '--template-preset', 'default',
      '--template', locator,
    ], {}, cwd),
    InputError,
  );
  assert.throws(
    () => resolveConfig([
      '--input', 'x.md', '--output', 'y.pdf', '--logo', locator, '--no-logo',
    ], {}, cwd),
    InputError,
  );
});

test('logo defaults to the template and --no-logo is an explicit state', () => {
  const automatic = resolveConfig(['--input', 'x.md', '--output', 'y.pdf'], {}, cwd);
  assert.deepEqual(automatic.logo, { value: { kind: 'template' }, source: 'default' });
  const disabled = resolveConfig(['--input', 'x.md', '--output', 'y.pdf', '--no-logo'], {}, cwd);
  assert.deepEqual(disabled.logo, { value: { kind: 'none' }, source: 'cli' });
});

test('CLI template overrides the environment template setting', () => {
  const c = resolveConfig(['--input', 'x.md', '--output', 'y.pdf', '--template-preset', 'pfn'], { PFPDF_TEMPLATE: './default' }, cwd);
  assert.deepEqual(c.template.value, { kind: 'bundled', name: 'pfn' });
});

test('--template uses an exact preset match and otherwise treats the value as a path', () => {
  const preset = resolveConfig(['--input', 'x.md', '--output', 'y.pdf', '--template', 'default'], {}, cwd);
  assert.deepEqual(preset.template.value, { kind: 'bundled', name: 'default' });
  const pathSelection = resolveConfig(['--input', 'x.md', '--output', 'y.pdf', '--template', './default'], {}, cwd);
  assert.deepEqual(pathSelection.template.value, { kind: 'custom', dir: './default' });
  assert.equal(pathSelection.templateDirAbs, path.join(cwd, 'default'));
});

test('--template-preset rejects non-preset names instead of treating them as paths', () => {
  assert.throws(
    () => resolveConfig(['--input', 'x.md', '--output', 'y.pdf', '--template-preset', './default'], {}, cwd),
    InputError,
  );
});

test('removed template and logo source-specific options are rejected', () => {
  for (const option of ['--template-dir', '--template-repository', '--logo-repository']) {
    assert.throws(
      () => resolveConfig(['--input', 'x.md', '--output', 'y.pdf', option, 'value'], {}, cwd),
      InputError,
    );
  }
});

test('environment template and logo sources use the same classification rules', () => {
  const local = resolveConfig(
    ['--input', 'x.md', '--output', 'y.pdf'],
    { PFPDF_TEMPLATE: './default', PFPDF_LOGO: './logo.svg' },
    cwd,
  );
  assert.deepEqual(local.template.value, { kind: 'custom', dir: './default' });
  assert.deepEqual(local.logo.value, { kind: 'local', path: './logo.svg' });
  const preset = resolveConfig(
    ['--input', 'x.md', '--output', 'y.pdf'],
    { PFPDF_TEMPLATE_PRESET: 'default' },
    cwd,
  );
  assert.deepEqual(preset.template.value, { kind: 'bundled', name: 'default' });
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
