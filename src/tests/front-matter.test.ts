import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildHtml } from '../build.js';
import { resolveConfig } from '../config.js';
import { InputError } from '../errors.js';

const cliPath = fileURLToPath(new URL('../launcher.js', import.meta.url));
const env = { ...process.env, SOURCE_DATE_EPOCH: '0' };

function fixture(t: test.TestContext): { dir: string; input: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-front-matter-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const input = path.join(dir, 'doc.md');
  fs.writeFileSync(input, '---\ntitle: Example\nauthor: Alice\ntemplate: pfn\ntoc: false\ntags: [documentation, example]\nstatus: draft\n---\n# Shared document\n');
  return { dir, input };
}

function cli(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8', env, shell: false, timeout: 30_000,
  });
}

test('conversion prepares the renderer HTML with unknown keys and honors strict mode', async (t) => {
  const { dir, input } = fixture(t);
  const args = ['--input', input, '--output', path.join(dir, 'doc.pdf'), '--title', 'CLI Title', '--toc', '--no-logo'];
  const warnings: string[] = [];
  const log = { warn: (msg: string): void => { warnings.push(msg); }, info: (): void => {}, debug: (): void => {} };
  const result = await buildHtml(resolveConfig(args, dir), env, log);
  assert.equal(result.generated.get('document.html')!.toString('utf8'), result.html);
  assert.match(result.html, /CLI Title/);
  assert.match(result.html, /pfn-cover/);
  assert.match(result.html, /pfpdf-toc-list/);
  assert.match(result.html, /Shared document/);
  assert.doesNotMatch(result.html, /documentation|draft/);
  assert.equal(warnings.filter((msg) => msg.includes('unknown front matter key:')).length, 2);
  await assert.rejects(buildHtml(resolveConfig([...args, '--strict-front-matter'], dir), env, log), InputError);

  const output = path.join(dir, 'doc.pdf');
  fs.writeFileSync(output, 'EXISTING');
  const strict = cli([...args, '--strict-front-matter']);
  assert.equal(strict.status, 2, strict.stderr);
  assert.equal(strict.stdout, '');
  assert.match(strict.stderr, /unknown front matter key: tags/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'EXISTING');
});

test('effective configuration warns on stderr, keeps JSON clean, and supports strict mode', (t) => {
  const { input } = fixture(t);
  const args = ['--input', input, '--print-effective-config', '--toc'];
  const result = cli(args);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout) as { config: Record<string, unknown> };
  assert.deepEqual(json.config.strictFrontMatter, { value: false, source: 'default' });
  assert.deepEqual(json.config.template, { value: { kind: 'bundled', name: 'pfn' }, source: 'front-matter' });
  assert.deepEqual(json.config.toc, { value: true, source: 'cli' });
  assert.deepEqual(Object.keys(json.config).filter((key) => key === 'tags' || key === 'status'), []);
  assert.equal(result.stderr.match(/pfpdf: warn: .*unknown front matter key:/g)?.length, 2);
  assert.equal(result.stdout.trim().split('\n').length, 1);

  const quiet = cli([...args, '--log-level', 'error']);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(quiet.stderr, '');
  const strict = cli([...args, '--strict-front-matter']);
  assert.equal(strict.status, 2, strict.stderr);
  assert.equal(strict.stdout, '');
  assert.match(strict.stderr, /unknown front matter key: tags/);
});

test('doctor reports unknown keys as input warnings or strict validation failures', (t) => {
  const { dir, input } = fixture(t);
  // An absent browser makes this input diagnostic independent of browser installs.
  const args = ['--doctor', '--input', input, '--browser-path', path.join(dir, 'missing-browser')];
  const parse = (stdout: string): Array<{ id: string; status: string; message: string }> =>
    (JSON.parse(stdout) as { checks: Array<{ id: string; status: string; message: string }> }).checks;
  const result = cli(args);
  assert.equal(result.status, 1, result.stderr); // Only the browser check fails.
  assert.equal(parse(result.stdout).find((check) => check.id === 'input')?.status, 'warning');
  assert.equal(parse(result.stdout).filter((check) => check.status === 'fail').length, 1);
  assert.equal(result.stderr.match(/pfpdf: warn: .*unknown front matter key:/g)?.length, 2);
  assert.equal(result.stdout.trim().split('\n').length, 1);

  const strict = cli([...args, '--strict-front-matter']);
  assert.equal(strict.status, 1, strict.stderr); // Doctor uses its existing diagnostic exit code.
  const check = parse(strict.stdout).find((item) => item.id === 'input');
  assert.equal(check?.status, 'fail');
  assert.match(check.message, /unknown front matter key: tags/);
  assert.doesNotMatch(strict.stderr, /pfpdf: warn: .*unknown front matter key:/);
});
