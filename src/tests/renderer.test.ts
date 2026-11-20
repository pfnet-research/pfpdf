import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  processFailureMessage,
  renderDocument,
  resolveVivliostyleCli,
  runBoundedProcess,
} from '../renderer.js';
import { ResourceManifest } from '../resources.js';

const supportsDaemon = process.platform === 'linux' || process.platform === 'darwin';
const launcher = fileURLToPath(new URL('../launcher.js', import.meta.url));

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

test('persistent conversion uses the selected CLI, a fixed cwd, and the usual input and output paths', {
  skip: !supportsDaemon,
}, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-renderer-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const daemonDir = path.join(dir, 'render session');
  const context = path.join(daemonDir, 'context');
  const socket = path.join(daemonDir, 'daemon.sock');
  const output = path.join(dir, 'out.pdf');
  const selectedCli = path.join(dir, 'selected cli.cjs');
  fs.mkdirSync(context, { recursive: true });
  fs.writeFileSync(path.join(dir, 'input.md'), '# Persistent build\n\nBody text.');
  fs.writeFileSync(output, 'existing PDF');
  fs.writeFileSync(selectedCli, `
    const { createConnection } = require('node:net');
    const args = process.argv.slice(2);
    require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, 'invocation.json'))},
      JSON.stringify({ cwd: process.cwd(), args }));
    createConnection(args[args.indexOf('--build-daemon') + 1]).on('error', (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  `);
  const conversion = (cli: string, daemon: string): SpawnSyncReturns<string> =>
    spawnSync(process.execPath, [
      launcher, '--input', 'input.md', '--output', 'out.pdf',
      '--vivliostyle-cli', cli, '--vivliostyle-daemon-dir', daemon,
    ], { cwd: dir, encoding: 'utf8', timeout: 15000 });

  const failure = conversion('./selected cli.cjs', './render session');
  assert.equal(failure.status, 1, failure.stderr);
  assert.match(failure.stderr, /Vivliostyle CLI failed[\s\S]*ENOENT/);
  const invocation = JSON.parse(fs.readFileSync(path.join(dir, 'invocation.json'), 'utf8')) as {
    cwd: string;
    args: string[];
  };
  assert.equal(invocation.cwd, fs.realpathSync(context));
  const [command, url, outputFlag, intermediate, ...flags] = invocation.args;
  assert.equal(command, 'build');
  assert.match(url!, /^http:\/\/127\.0\.0\.1:\d+\/document\.html$/);
  assert.equal(outputFlag, '-o');
  assert.ok(path.isAbsolute(intermediate!));
  assert.equal(path.basename(path.dirname(intermediate!)), 'renderer-output');
  assert.deepEqual(flags, [
    '--timeout', flags[1], '--log-level', 'info', '--sandbox', '--build-daemon', socket,
  ]);
  assert.match(flags[1]!, /^\d+$/);
  assert.equal(fs.existsSync(path.dirname(path.dirname(intermediate!))), false);

  fs.writeFileSync(socket, 'not a socket');
  for (const [cli, daemon, error] of [
    ['missing.js', daemonDir, /--vivliostyle-cli.*ENOENT/],
    [daemonDir, daemonDir, /--vivliostyle-cli.*regular file/],
    [selectedCli, 'missing', /--vivliostyle-daemon-dir.*context.*ENOENT/],
    [selectedCli, daemonDir, /--vivliostyle-daemon-dir.*daemon\.sock.*Unix socket/],
  ] as const) {
    const result = conversion(cli, daemon);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, error);
  }
  fs.rmdirSync(context);
  fs.writeFileSync(context, 'not a directory');
  const invalidContext = conversion(selectedCli, daemonDir);
  assert.equal(invalidContext.status, 2, invalidContext.stderr);
  assert.match(invalidContext.stderr, /--vivliostyle-daemon-dir.*context.*expected a directory/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'existing PDF');
});

for (const stop of ['signal', 'timeout'] as const) {
  test(`persistent renderer keeps serving assets until its client closes after ${stop}`, {
    skip: !supportsDaemon,
    timeout: 20000,
  }, async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-cancel-'));
    const daemonSocket = path.join(dir, 'daemon.sock');
    const context = path.join(dir, 'context');
    const cli = path.join(dir, 'client.mjs');
    fs.mkdirSync(context);
    const daemon = net.createServer();
    t.after(() => {
      daemon.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    daemon.listen(daemonSocket);
    await once(daemon, 'listening');
    fs.writeFileSync(cli, `
      import { createConnection } from 'node:net';
      const [, , , url, ...args] = process.argv;
      const socket = createConnection(args[args.indexOf('--build-daemon') + 1]);
      process.on('SIGTERM', () => {
        setTimeout(async () => {
          const body = await (await fetch(url)).text();
          console.error(body);
          socket.end(url);
        }, ${stop === 'signal' ? 5500 : 0});
      });
    `);
    const controller = new AbortController();
    const diagnosticsPath = path.join(dir, 'renderer.log');
    const rendered = renderDocument({
      manifest: new ResourceManifest(),
      generated: new Map([['document.html', Buffer.from('assets still available during cancellation')]]),
      workspaceDir: dir, outputPath: path.join(dir, 'output.pdf'), diagnosticsPath,
      controller, signal: controller.signal, processCwd: context, vivliostyleCli: cli, daemonSocket,
      deadline: Date.now() + (stop === 'timeout' ? 2000 : 15000), browserPath: null, logLevel: 'error',
      warn: () => {}, info: () => {},
    });
    const failure = assert.rejects(rendered, stop === 'timeout'
      ? /(?:timed out|deadline exceeded)[\s\S]*assets still available during cancellation/
      : /interrupted[\s\S]*assets still available during cancellation/);
    const [connection] = await once(daemon, 'connection', { signal: AbortSignal.timeout(5000) }) as [net.Socket];
    t.after(() => { connection.destroy(); });
    const url = once(connection, 'data', { signal: AbortSignal.timeout(10000) }) as Promise<[Buffer]>;
    if (stop === 'signal') controller.abort();
    const [address] = await url;
    await failure;
    assert.match(fs.readFileSync(diagnosticsPath, 'utf8'), /assets still available during cancellation/);
    await assert.rejects(fetch(address.toString('utf8')));
  });
}

test('a second SIGTERM during workspace cleanup preserves the interrupted conversion result', {
  skip: !supportsDaemon,
}, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-repeated-signal-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const tempDir = path.join(dir, 'tmp');
  const cli = path.join(dir, 'client.cjs');
  const driver = path.join(dir, 'driver.mjs');
  fs.mkdirSync(tempDir);
  fs.mkdirSync(path.join(dir, 'context'));
  fs.writeFileSync(path.join(dir, 'input.md'), '# Interrupted conversion');
  fs.writeFileSync(path.join(dir, 'out.pdf'), 'existing PDF');
  fs.writeFileSync(cli, `
    const timer = setInterval(() => {}, 1000);
    process.on('SIGTERM', () => clearInterval(timer));
    process.kill(process.ppid, 'SIGTERM');
  `);
  fs.writeFileSync(driver, `
    import fs from 'node:fs';
    import path from 'node:path';
    import { main } from ${JSON.stringify(new URL('../cli.js', import.meta.url).href)};
    const remove = fs.rmSync;
    fs.rmSync = (target, options) => {
      if (typeof target === 'string' && path.dirname(target) === ${JSON.stringify(tempDir)} &&
          fs.existsSync(path.join(target, 'renderer-diagnostics.log'))) {
        console.error('Sending SIGTERM during workspace cleanup');
        process.kill(process.pid, 'SIGTERM');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
      return remove(target, options);
    };
    process.exitCode = await main();
  `);
  const result = spawnSync(process.execPath, [
    driver, '--input', 'input.md', '--output', 'out.pdf',
    '--vivliostyle-cli', cli, '--vivliostyle-daemon-dir', '.',
  ], { cwd: dir, env: { ...process.env, TMPDIR: tempDir }, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 1, result.stderr || `terminated by ${result.signal}`);
  assert.match(result.stderr, /Sending SIGTERM during workspace cleanup/);
  assert.match(result.stderr, /renderer interrupted by a signal/);
  assert.deepEqual(fs.readdirSync(tempDir), []);
  assert.equal(fs.readFileSync(path.join(dir, 'out.pdf'), 'utf8'), 'existing PDF');
});
