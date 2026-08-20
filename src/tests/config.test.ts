import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  applyFrontMatterConfig,
  effectiveConfigJson,
  resolveConfig,
  validateConfigForMode,
} from '../config.js';
import { InputError } from '../errors.js';

const cwd = '/tmp';

test('built-in configuration defaults are stable', () => {
  const config = resolveConfig(['--input', 'a.md', '--output', 'a.pdf'], cwd);
  assert.deepEqual(config.template, {
    value: { kind: 'bundled', name: 'default' },
    source: 'default',
  });
  assert.deepEqual(config.toc, { value: true, source: 'default' });
  assert.deepEqual(config.logo, { value: { kind: 'template' }, source: 'default' });
});

test('front matter document configuration applies over defaults', () => {
  const base = resolveConfig(['--input', 'a.md', '--output', 'a.pdf'], cwd);
  const resolved = applyFrontMatterConfig(base, {
    template: 'pfn',
    toc: false,
    logo: { kind: 'local', path: 'assets/logo.svg', absPath: '/docs/assets/logo.svg' },
  });
  assert.deepEqual(resolved.template, {
    value: { kind: 'bundled', name: 'pfn' },
    source: 'front-matter',
  });
  assert.deepEqual(resolved.toc, { value: false, source: 'front-matter' });
  assert.deepEqual(resolved.logo, {
    value: { kind: 'local', path: 'assets/logo.svg' },
    source: 'front-matter',
  });
  assert.equal(resolved.logoAbs, '/docs/assets/logo.svg');
});

test('CLI document configuration overrides front matter', () => {
  const cli = resolveConfig([
    '--input', 'a.md', '--output', 'a.pdf', '--template', 'compact', '--toc', '--no-logo',
  ], cwd);
  const resolved = applyFrontMatterConfig(cli, {
    template: 'pfn',
    toc: false,
    logo: { kind: 'local', path: 'assets/logo.svg', absPath: '/docs/assets/logo.svg' },
  });
  assert.strictEqual(resolved.template, cli.template);
  assert.strictEqual(resolved.toc, cli.toc);
  assert.strictEqual(resolved.logo, cli.logo);
});

test('front matter can explicitly disable the logo', () => {
  const config = applyFrontMatterConfig(
    resolveConfig(['--input', 'a.md', '--output', 'a.pdf'], cwd),
    { template: null, toc: null, logo: { kind: 'none' } },
  );
  assert.deepEqual(config.logo, { value: { kind: 'none' }, source: 'front-matter' });
  assert.equal(config.logoAbs, null);
});

test('effective configuration uses schema version 5 and records front matter', () => {
  const config = applyFrontMatterConfig(
    resolveConfig(['--input', 'a.md', '--output', 'a.pdf'], cwd),
    { template: null, toc: false, logo: null },
  );
  const result = JSON.parse(effectiveConfigJson(config)) as {
    schemaVersion: number;
    config: { toc: { source: string } };
  };
  assert.equal(result.schemaVersion, 5);
  assert.equal(result.config.toc.source, 'front-matter');
});

test('positive and negative option pairs conflict', () => {
  assert.throws(
    () => resolveConfig(['--input', 'a.md', '--output', 'a.pdf', '--toc', '--no-toc'], cwd),
    InputError,
  );
  assert.throws(
    () => resolveConfig(['--input', 'a.md', '--output', 'a.pdf', '--logo', 'x', '--no-logo'], cwd),
    InputError,
  );
});

test('repeated scalar options are rejected and font directories may repeat', () => {
  assert.throws(
    () => resolveConfig(['--input', 'a.md', '--input', 'a.md', '--output', 'a.pdf'], cwd),
    InputError,
  );
  const config = resolveConfig([
    '--input', 'a.md', '--output', 'a.pdf', '--font-dir', 'x', '--font-dir', 'y',
  ], cwd);
  assert.deepEqual(config.fontDirs.value, ['x', 'y']);
  assert.equal(config.fontDirs.source, 'cli');
});

test('template source and explicit preset are exclusive', () => {
  assert.throws(
    () => resolveConfig([
      '--template', 'a', '--template-preset', 'book', '--input', 'x.md', '--output', 'y.pdf',
    ], cwd),
    InputError,
  );
});

test('repository template and logo settings are parsed as logical selections', () => {
  const template = 'git::https://example.com/assets.git//templates/report?ref=v1.0.0';
  const logo = 'git::ssh://git@example.com/assets.git//logos/main.svg?ref=0123456789abcdef';
  const config = resolveConfig([
    '--input', 'x.md', '--output', 'y.pdf', '--template', template, '--logo', logo,
  ], cwd);
  assert.deepEqual(config.template.value, { kind: 'repository', locator: template });
  assert.deepEqual(config.logo.value, { kind: 'repository', locator: logo });
  assert.equal(config.logoAbs, null);
});

test('template and logo CLI selection variants remain distinct', () => {
  const preset = resolveConfig([
    '--input', 'x.md', '--output', 'y.pdf', '--template', 'default',
  ], cwd);
  assert.deepEqual(preset.template.value, { kind: 'bundled', name: 'default' });
  const custom = resolveConfig([
    '--input', 'x.md', '--output', 'y.pdf', '--template', './default', '--logo', './logo.svg',
  ], cwd);
  assert.deepEqual(custom.template.value, { kind: 'custom', dir: './default' });
  assert.equal(custom.templateDirAbs, path.join(cwd, 'default'));
  assert.deepEqual(custom.logo.value, { kind: 'local', path: './logo.svg' });
  assert.equal(custom.logoAbs, path.join(cwd, 'logo.svg'));
  assert.throws(
    () => resolveConfig([
      '--input', 'x.md', '--output', 'y.pdf', '--template-preset', './default',
    ], cwd),
    InputError,
  );
});

test('removed and unknown options are rejected', () => {
  for (const option of [
    '--template-dir', '--template-repository', '--logo-repository',
    '--no-host-fonts', '--no-font-dirs', '--managed-browser', '--no-keep-work-dir',
  ]) {
    assert.throws(
      () => resolveConfig(['--input', 'x.md', '--output', 'y.pdf', option], cwd),
      InputError,
    );
  }
  assert.throws(() => resolveConfig(['--bogus'], cwd), InputError);
  assert.throws(() => resolveConfig(['stray'], cwd), InputError);
  assert.throws(() => resolveConfig(['--input'], cwd), InputError);
});

test('mode flags are exclusive', () => {
  assert.throws(() => resolveConfig(['--doctor', '--version'], cwd), InputError);
});

test('input-free modes validate an explicit title in their mode validation phase', () => {
  for (const mode of ['--help', '--version', '--print-effective-config', '--doctor']) {
    const config = resolveConfig([mode, '--title', '<b>bad</b>'], cwd);
    assert.throws(() => { validateConfigForMode(config); }, InputError);
  }
  const convert = resolveConfig([
    '--input', 'a.md', '--output', 'a.pdf', '--title', '<b>validated with input</b>',
  ], cwd);
  assert.doesNotThrow(() => { validateConfigForMode(convert); });
});

test('render timeout bounds are validated', () => {
  assert.throws(() => resolveConfig([
    '--input', 'a.md', '--output', 'a.pdf', '--render-timeout-ms', '500',
  ], cwd), InputError);
  const config = resolveConfig([
    '--input', 'a.md', '--output', 'a.pdf', '--render-timeout-ms', '60000',
  ], cwd);
  assert.equal(config.renderTimeoutMs.value, 60000);
});

test('stdin, stdout, and empty paths are rejected', () => {
  assert.throws(() => resolveConfig(['--input', '-', '--output', 'a.pdf'], cwd), InputError);
  assert.throws(() => resolveConfig(['--input', '', '--output', 'a.pdf'], cwd), InputError);
  assert.throws(
    () => resolveConfig(['--input', 'a.md', '--output', 'a.pdf', '--logo', ''], cwd),
    InputError,
  );
});
