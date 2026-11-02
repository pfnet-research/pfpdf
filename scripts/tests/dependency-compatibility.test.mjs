import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

// Resolve through the real runtime parents, including nested dependencies.
const require = createRequire(import.meta.url);
const cli = createRequire(import.meta.resolve('@vivliostyle/cli'));
const arborist = createRequire(cli.resolve('@npmcli/arborist'));
const archiver = createRequire(cli.resolve('archiver'));
const workspaces = createRequire(arborist.resolve('@npmcli/map-workspaces'));
const { glob } = workspaces('glob');
const { Minimatch } = workspaces('minimatch');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-dependency-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, content = '') => {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  write('packages/a/package.json', '{"name":"fixture-a"}');
  write('packages/excluded/package.json', '{"name":"fixture-excluded"}');
  write('notes/keep.md', 'keep');
  write('notes/drop.md', 'drop');
  write('.ignore', 'notes/*\n!notes/keep.md\n');
  return { root, write };
}

test('runtime glob and minimatch trees support the oldest supported Node', () => {
  const lock = require('../../package-lock.json');
  const semver = arborist('semver');
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (entry.dev) continue;
    const updated = ['glob', 'minimatch', 'path-scurry', 'shelljs', 'fast-glob',
      'micromatch', '@isaacs/nonrecursive-glob-match'].some((pkg) => name.endsWith(`/${pkg}`));
    if (updated && entry.engines?.node) {
      assert.ok(semver.satisfies('22.12.0', entry.engines.node), `${name}: ${entry.engines.node}`);
    }
    if (name.endsWith('/glob')) assert.equal(entry.version, '14.0.2', name);
    if (name.endsWith('/minimatch')) assert.equal(entry.version, '11.0.1', name);
  }
});

test('cancelling the installed glob stops directory reads after rejection', async (t) => {
  const { root } = fixture(t);
  const controller = new AbortController();
  const reason = new Error('fixture cancellation');
  let reads = 0;
  const countedFs = {
    ...fs,
    readdir(...args) {
      reads += 1;
      if (reads === 1) controller.abort(reason);
      return fs.readdir(...args);
    },
  };
  await assert.rejects(glob('**', { cwd: root, signal: controller.signal, fs: countedFs }), reason);
  const atRejection = reads;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(atRejection, 1);
  assert.equal(reads, atRejection);
});

test('installed minimatch bounds optimization and supports Windows paths', () => {
  const matcher = new Minimatch(Array(8).fill('**/../a/b').join('/'), {
    optimizationLevel: 2, braceExpandMax: 32,
  });
  assert.equal(matcher.set.length, 32);
  const windows = new Minimatch('C:/packages/*/package.json', {
    platform: 'win32', windowsPathsNoEscape: true, nocase: true,
  });
  assert.equal(windows.match('c:\\packages\\a\\package.json'), true);
});

test('workspace discovery and ignore-walk retain inclusion and negation', async (t) => {
  const { root } = fixture(t);
  const map = await arborist('@npmcli/map-workspaces')({
    cwd: root, pkg: { workspaces: ['packages/*', '!packages/excluded'] },
  });
  assert.deepEqual([...map.keys()], ['fixture-a']);
  const pacote = createRequire(arborist.resolve('pacote'));
  const packlist = createRequire(pacote.resolve('npm-packlist'));
  const walk = packlist('ignore-walk');
  const files = await walk({ path: root });
  assert.ok(files.includes('notes/keep.md'));
  assert.ok(!files.includes('notes/drop.md'));
  assert.deepEqual(walk.sync({ path: root }), files);
});

test('archiver glob expansion and ZIP traversal retain filtering', async (t) => {
  const { root } = fixture(t);
  const utils = archiver('archiver-utils');
  assert.deepEqual(utils.file.expand({ cwd: root }, ['notes/*.md', '!notes/drop.md']), ['notes/keep.md']);
  const archive = cli('archiver')('zip');
  const entries = [];
  archive.on('entry', (entry) => entries.push(entry.name));
  archive.glob('**/*.md', { cwd: root, ignore: ['**/drop.md'] });
  const chunks = [];
  const read = (async () => { for await (const chunk of archive) chunks.push(chunk); })();
  await archive.finalize();
  await read;
  assert.deepEqual(entries, ['notes/keep.md']);
  assert.equal(Buffer.concat(chunks).subarray(0, 2).toString(), 'PK');
});

test('cacache traversal and press-ready executable lookup remain usable', async (t) => {
  const { root } = fixture(t);
  const cache = path.join(root, 'cache');
  const cacache = arborist('cacache');
  await cacache.put(cache, 'fixture', 'content');
  const result = await cacache.verify(cache);
  assert.equal(result.verifiedContent, 1);
  await cacache.rm.all(cache);
  const pressReady = createRequire(cli.resolve('press-ready'));
  const shell = pressReady('shelljs');
  // ShellJS uppercases PATH lookup results on Windows.
  const found = String(shell.which(process.execPath));
  assert.equal(process.platform === 'win32' ? found.toLowerCase() : found,
    process.platform === 'win32' ? process.execPath.toLowerCase() : process.execPath);
});
