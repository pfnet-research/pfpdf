import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from '../config.js';
import { browserFailureDetail, runDoctor } from '../doctor.js';

const cliPath = fileURLToPath(new URL('../launcher.js', import.meta.url));

const launchFailures = [
  ['Running as root without --no-sandbox is not supported.', /root execution refused/],
  ['Failed to move to new namespace: Operation not permitted', /user namespace or AppArmor restriction/],
  ['AppArmor policy denied user namespace creation', /user namespace or AppArmor restriction/],
  ['No usable sandbox!', /browser sandbox unavailable/],
  ['error while loading shared libraries: libnss3.so: cannot open shared object file', /missing shared library/],
  ['spawn browser ENOENT', /browser executable could not be started/],
  ['exec format error', /browser executable could not be started/],
  ['Permission denied', /browser executable could not be started/],
  ['browser launch timed out', /browser launch or conversion timed out/],
  ['unexpected renderer failure XYZ', /unexpected renderer failure XYZ/],
] as const;

for (const [stderr, category] of launchFailures) {
  test(`browser diagnostics retain the cause: ${stderr}`, () => {
    const child = spawnSync(process.execPath, ['-e', 'process.stderr.write(process.argv[1]); process.exit(7)', stderr], {
      shell: false, encoding: 'utf8', timeout: 5000,
    });
    const detail = browserFailureDetail(child, false);
    assert.match(detail, /conversion exited with 7/);
    assert.match(detail, category);
    assert.ok(detail.endsWith(stderr), detail);
  });
}

test('browser diagnostics retain bounded stderr from both ends, including Unicode', () => {
  const stderr = `start\n${'あ'.repeat(5000)}\nend`;
  const child = spawnSync(process.execPath, ['-e', 'process.stderr.write(process.argv[1]); process.exit(1)', stderr], {
    shell: false, encoding: 'utf8', timeout: 5000,
  });
  const detail = browserFailureDetail(child, false);
  const excerpt = detail.split('\nstderr:\n')[1]!;
  assert.ok(Buffer.byteLength(excerpt) <= 4096, Buffer.byteLength(excerpt).toString());
  assert.ok(excerpt.startsWith('start\n'));
  assert.ok(excerpt.endsWith('\nend'));
  assert.match(excerpt, /stderr truncated/);
});

test('browser diagnostics distinguish timeout, signal, process errors, and missing PDF', () => {
  const timeout = spawnSync(process.execPath, ['-e', "process.stderr.write('before timeout'); setInterval(() => {}, 1000)"], {
    shell: false, encoding: 'utf8', timeout: 1000,
  });
  assert.match(browserFailureDetail(timeout, false), /browser check timed out/);
  assert.match(browserFailureDetail(timeout, false), /before timeout/);

  if (process.platform !== 'win32') {
    const signal = spawnSync(process.execPath, ['-e', "process.stderr.write('before signal'); process.kill(process.pid, 'SIGTERM')"], {
      shell: false, encoding: 'utf8', timeout: 5000,
    });
    assert.match(browserFailureDetail(signal, false), /terminated by signal SIGTERM/);
    assert.match(browserFailureDetail(signal, false), /before signal/);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-doctor-missing-'));
  try {
    const missing = spawnSync(path.join(dir, 'absent'), [], { shell: false, encoding: 'utf8' });
    assert.match(browserFailureDetail(missing, false), /browser check process failed:.*ENOENT/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const overflow = spawnSync(process.execPath, ['-e', "process.stderr.write('x'.repeat(100000))"], {
    shell: false, encoding: 'utf8', timeout: 5000, maxBuffer: 1000,
  });
  assert.match(browserFailureDetail(overflow, false), /captured output limit/);
  assert.equal(browserFailureDetail({ status: 0, signal: null, stderr: '' }, false),
    'conversion exited with 0 but did not produce a PDF');
});

test('doctor keeps browser stderr inside one JSON result and cleans the isolated workspace', {
  skip: process.platform === 'win32' ? 'POSIX executable fixture' : false,
}, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-doctor-fixture-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const browser = path.join(dir, 'browser');
  const record = path.join(dir, 'args.json');
  fs.writeFileSync(browser, `#!${process.execPath}\n`
    + `require('node:fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv, cwd: process.cwd() }));\n`
    + "process.stderr.write('Running as root without --no-sandbox is not supported.\\n'); process.exit(1);\n", { mode: 0o700 });
  const child = spawnSync(process.execPath, [cliPath, '--doctor', '--browser-path', browser], {
    shell: false, encoding: 'utf8', timeout: 20000,
  });
  assert.equal(child.status, 1, child.stderr);
  assert.equal(child.stdout.trim().split('\n').length, 1);
  const report = JSON.parse(child.stdout) as { schemaVersion: number; status: string; checks: Array<{ id: string; status: string; message: string }> };
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.status, 'fail');
  const check = report.checks.find((item) => item.id === 'browser')!;
  assert.equal(check.status, 'fail');
  assert.match(check.message, /root execution refused/);
  assert.match(check.message, /Running as root without --no-sandbox is not supported/);
  assert.equal(child.stderr, '');
  const { args, cwd } = JSON.parse(fs.readFileSync(record, 'utf8')) as { args: string[]; cwd: string };
  const profile = args.find((arg) => arg.startsWith('--user-data-dir='));
  assert.ok(profile, JSON.stringify(args));
  assert.equal(fs.existsSync(profile.slice('--user-data-dir='.length)), false);
  assert.equal(fs.existsSync(cwd), false);
  assert.equal(fs.existsSync(path.dirname(cwd)), false);
});

test('doctor probes an explicit CLI with a one-off build', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-doctor-vivliostyle-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const selected = path.join(dir, 'selected.cjs');
  const record = path.join(dir, 'invocation.json');
  fs.writeFileSync(selected, `
    require('node:fs').writeFileSync(${JSON.stringify(record)},
      JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));
    console.error('selected CLI browser diagnostic');
    process.exitCode = 1;
  `);
  const child = spawnSync(process.execPath, [
    cliPath, '--doctor', '--vivliostyle-cli', 'selected.cjs',
    '--browser-path', process.execPath,
  ], { cwd: dir, encoding: 'utf8', timeout: 20000 });
  assert.equal(child.status, 1, child.stderr);
  const report = JSON.parse(child.stdout) as {
    schemaVersion: number;
    checks: Array<{ id: string; status: string; message: string }>;
  };
  const checks = new Map(report.checks.map((check) => [check.id, check]));
  assert.equal(report.schemaVersion, 2);
  assert.equal(checks.get('vivliostyle-cli')?.status, 'pass');
  assert.match(checks.get('browser')!.message, /selected CLI browser diagnostic/);
  const invocation = JSON.parse(fs.readFileSync(record, 'utf8')) as { cwd: string; args: string[] };
  assert.equal(path.basename(invocation.cwd), 'vivliostyle-context');
  assert.equal(invocation.args[0], 'build');
  assert.ok(invocation.args.includes('--executable-browser'));
  assert.ok(!invocation.args.includes('--build-daemon'));
});

test('doctor distinguishes a stopped daemon, incompatible protocol, and a successful describe check', {
  skip: process.platform !== 'linux' && process.platform !== 'darwin',
}, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-doctor-daemon-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const socketPath = path.join(dir, 'daemon.sock');
  const advertisedCli = path.join(dir, 'cli.cjs');
  fs.writeFileSync(advertisedCli, 'throw new Error("doctor must only use describe");');
  const config = resolveConfig(['--doctor', '--vivliostyle-daemon', socketPath], dir);
  const check = async () => {
    const { exitCode, json } = await runDoctor(config);
    const report = JSON.parse(json) as {
      checks: Array<{ id: string; status: string; message: string }>;
    };
    const checks = new Map(report.checks.map((entry) => [entry.id, entry]));
    return { exitCode, checks, socket: checks.get('vivliostyle-daemon-socket')! };
  };
  const stopped = await check();
  assert.equal(stopped.exitCode, 1);
  assert.equal(stopped.socket.status, 'fail');
  assert.match(stopped.socket.message, /ENOENT/);

  let version = 2;
  const daemon = net.createServer((connection) => {
    connection.once('data', () => {
      const reply = Buffer.from(JSON.stringify({ type: 'session', version, cliPath: advertisedCli, cwd: dir }));
      const header = Buffer.alloc(4);
      header.writeUInt32BE(reply.length);
      connection.end(Buffer.concat([header, reply]));
    });
  });
  t.after(() => { daemon.close(); });
  daemon.listen(socketPath);
  await once(daemon, 'listening');
  fs.chmodSync(socketPath, 0o600);
  const incompatible = await check();
  assert.equal(incompatible.exitCode, 1);
  assert.equal(incompatible.socket.status, 'fail');
  assert.match(incompatible.socket.message, /incompatible daemon session protocol/);
  assert.equal(incompatible.checks.get('vivliostyle-cli')?.status, 'not-run');

  version = 1;
  const compatible = await check();
  assert.equal(compatible.exitCode, 0);
  assert.equal(compatible.socket.status, 'pass');
  assert.match(compatible.socket.message, /connection and protocol only/);
  assert.equal(compatible.checks.get('vivliostyle-cli')?.message, advertisedCli);
  assert.equal(compatible.checks.get('browser')?.status, 'not-run');
});
