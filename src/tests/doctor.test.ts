import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { browserFailureDetail } from '../doctor.js';

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
