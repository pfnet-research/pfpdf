import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  processFailureMessage,
  resolveVivliostyleCli,
  runBoundedProcess,
} from '../renderer.js';

test('pinned Vivliostyle CLI entry point resolves to a file', () => {
  assert.equal(fs.statSync(resolveVivliostyleCli()).isFile(), true);
});

test('bounded child process classifies timeout and abort consistently', async () => {
  const timeout = await runBoundedProcess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { deadline: Date.now() + 100, startError: 'cannot start test child' },
  );
  assert.equal(timeout.code, null);
  assert.equal(timeout.stopReason, 'timeout');

  const controller = new AbortController();
  const aborted = runBoundedProcess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { deadline: Date.now() + 5000, signal: controller.signal, startError: 'cannot start test child' },
  );
  controller.abort();
  const abortResult = await aborted;
  assert.equal(abortResult.code, null);
  assert.equal(abortResult.stopReason, 'signal');
});

test('bounded child process captures output and exit status', async () => {
  const result = await runBoundedProcess(
    process.execPath,
    ['-e', "process.stdout.write('out'); process.stderr.write('err')"],
    { deadline: Date.now() + 5000, startError: 'cannot start test child' },
  );
  assert.equal(result.code, 0);
  assert.match(result.output.toString('utf8'), /out/);
  assert.match(result.output.toString('utf8'), /err/);
});

test('bounded child process uses the requested working directory', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-renderer-cwd-'));
  const result = await runBoundedProcess(
    process.execPath,
    ['-e', 'process.stdout.write(process.cwd())'],
    { deadline: Date.now() + 5000, cwd, startError: 'cannot start test child' },
  );
  assert.equal(result.code, 0);
  assert.equal(fs.realpathSync(result.output.toString('utf8')), fs.realpathSync(cwd));
});

test('child process failures retain captured diagnostics', () => {
  assert.equal(
    processFailureMessage('renderer failed', Buffer.from('browser launch failed\n')),
    'renderer failed\n\nbrowser launch failed',
  );
  assert.equal(processFailureMessage('renderer failed', ' \n'), 'renderer failed');
});
