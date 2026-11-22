import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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

test('default CLI resolution uses the pfpdf installation from another npm project', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-npm-project-'));
  t.after(() => { fs.rmSync(cwd, { recursive: true, force: true }); });
  const otherCli = path.join(cwd, 'node_modules', '@vivliostyle', 'cli');
  fs.mkdirSync(otherCli, { recursive: true });
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"private":true}');
  fs.writeFileSync(path.join(otherCli, 'package.json'), '{"bin":{"vivliostyle":"other.cjs"}}');
  fs.writeFileSync(path.join(otherCli, 'other.cjs'), '');
  const child = spawnSync(process.execPath, [
    '--input-type=module', '-e',
    `import { resolveVivliostyleCli } from ${JSON.stringify(new URL('../renderer.js', import.meta.url).href)};
     console.log(resolveVivliostyleCli());`,
  ], { cwd, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), resolveVivliostyleCli());
});

test('an explicit CLI must be a readable regular file', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-cli-path-'));
  t.after(() => { fs.rmSync(cwd, { recursive: true, force: true }); });
  const cli = path.join(cwd, 'selected cli.cjs');
  assert.throws(() => resolveVivliostyleCli(cli), /--vivliostyle-cli.*ENOENT/);
  assert.throws(() => resolveVivliostyleCli(cwd), /--vivliostyle-cli.*regular file/);
  fs.writeFileSync(cli, '');
  assert.equal(resolveVivliostyleCli(cli), cli);
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

test('standalone discovery uses the advertised CLI and preserves output on failure', {
  skip: !supportsDaemon,
  timeout: 20000,
}, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfd-'));
  const socketDir = fs.mkdtempSync(path.join(fs.realpathSync(dir), 's-'));
  const socketPath = path.join(socketDir, 'd.sock');
  fs.symlinkSync(socketDir, path.join(dir, 'alias'));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(dir, 'context-')));
  const cliPath = path.join(dir, 'selected.cjs');
  const outputPath = path.join(dir, 'out.pdf');
  fs.writeFileSync(path.join(dir, 'input.md'), '# Persistent build\n\nBody text.');
  fs.writeFileSync(outputPath, 'existing PDF');
  fs.writeFileSync(cliPath, `
    console.error(process.cwd(), ...process.argv.slice(2));
    process.exitCode = 1;
  `);
  let replyVersion = 1;
  let respond = true;
  const daemon = net.createServer((socket) => {
    let request = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      request = Buffer.concat([request, chunk]);
      if (request.length < 4 || request.length < 4 + request.readUInt32BE()) return;
      assert.deepEqual(JSON.parse(request.subarray(4).toString()), { type: 'describe', version: 1 });
      if (!respond) return;
      const reply = Buffer.from(JSON.stringify({ type: 'session', version: replyVersion, cliPath, cwd }));
      const header = Buffer.alloc(4);
      header.writeUInt32BE(reply.length);
      socket.write(header);
      setImmediate(() => { socket.end(reply); });
    });
  });
  t.after(() => {
    daemon.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const convert = async (timeout = '5000') => {
    const result = await runBoundedProcess(process.execPath, [
      launcher, '--input', 'input.md', '--output', 'out.pdf', '--vivliostyle-daemon', 'alias/d.sock',
      '--render-timeout-ms', timeout, '--log-level', 'error',
    ], { cwd: dir, deadline: Date.now() + 10000, startError: 'cannot start pfpdf' });
    assert.equal(result.code, 1, result.output.toString());
    assert.equal(fs.readFileSync(outputPath, 'utf8'), 'existing PDF');
    return result.output.toString();
  };
  assert.match(await convert(), /daemon discovery failed[\s\S]*ENOENT/);
  daemon.listen(socketPath);
  await once(daemon, 'listening');
  fs.chmodSync(socketPath, 0o666);
  assert.match(await convert(), /expected an owner-only Unix socket/);
  fs.chmodSync(socketPath, 0o600);
  fs.chmodSync(dir, 0o777);
  try {
    const shared = await convert();
    if (process.platform === 'darwin') {
      assert.match(shared, /unsafe ancestor of the daemon socket directory/);
    } else {
      assert.ok(shared.includes(`--build-daemon ${socketPath}`), shared);
    }
  } finally {
    fs.chmodSync(dir, 0o700);
  }
  const discovered = await convert();
  assert.ok(discovered.includes(`${cwd} build http://127.0.0.1:`), discovered);
  assert.ok(discovered.includes(`--build-daemon ${socketPath}`), discovered);
  replyVersion = 2;
  assert.match(await convert(), /incompatible daemon session protocol/);
  replyVersion = 1;
  respond = false;
  assert.match(await convert('1000'), /discovery timed out|render deadline exceeded/);
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
    daemon.once('connection', (connection) => {
      connection.once('data', () => { sendSession(connection, cli, context); });
    });
    t.after(() => {
      daemon.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    daemon.listen(daemonSocket);
    await once(daemon, 'listening');
    fs.chmodSync(daemonSocket, 0o600);
    fs.writeFileSync(cli, `
      import { createConnection } from 'node:net';
      const [, , , url, ...args] = process.argv;
      process.on('SIGTERM', () => {
        setTimeout(async () => {
          const body = await (await fetch(url)).text();
          console.error(body);
          socket.end(url);
        }, ${stop === 'signal' ? 5500 : 0});
      });
      const socket = createConnection(args[args.indexOf('--build-daemon') + 1]);
      socket.on('connect', () => socket.write('http ready'));
    `);
    const controller = new AbortController();
    const diagnosticsPath = path.join(dir, 'renderer.log');
    const rendered = renderDocument({
      manifest: new ResourceManifest(),
      generated: new Map([['document.html', Buffer.from('assets still available during cancellation')]]),
      workspaceDir: dir, outputPath: path.join(dir, 'output.pdf'), diagnosticsPath,
      controller, signal: controller.signal, standaloneSocket: daemonSocket,
      deadline: Date.now() + (stop === 'timeout' ? 2000 : 15000), browserPath: null, logLevel: 'error',
      warn: () => {}, info: () => {},
    });
    const failure = assert.rejects(rendered, stop === 'timeout'
      ? /(?:timed out|deadline exceeded)[\s\S]*assets still available during cancellation/
      : /interrupted[\s\S]*assets still available during cancellation/);
    const [discovery] = await once(daemon, 'connection', { signal: AbortSignal.timeout(5000) }) as [net.Socket];
    t.after(() => { discovery.destroy(); });
    const [connection] = await once(daemon, 'connection', { signal: AbortSignal.timeout(5000) }) as [net.Socket];
    t.after(() => { connection.destroy(); });
    const [ready] = await once(connection, 'data', { signal: AbortSignal.timeout(5000) }) as [Buffer];
    assert.equal(ready.toString(), 'http ready');
    const url = once(connection, 'data', { signal: AbortSignal.timeout(10000) }) as Promise<[Buffer]>;
    if (stop === 'signal') controller.abort();
    const [address] = await url;
    await failure;
    assert.match(fs.readFileSync(diagnosticsPath, 'utf8'), /assets still available during cancellation/);
    await assert.rejects(fetch(address.toString('utf8')));
  });
}

function sendSession(socket: net.Socket, cliPath: string, cwd: string): void {
  const reply = Buffer.from(JSON.stringify({ type: 'session', version: 1, cliPath, cwd }));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(reply.length);
  socket.end(Buffer.concat([header, reply]));
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  for (const mode of ['default', 'external', 'persistent'] as const) {
    test(`two ${signal} signals during ${mode} conversion`, { skip: !supportsDaemon, timeout: 15000 }, async (t) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-signal-'));
      t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
      const cli = path.join(dir, 'client.cjs');
      const output = path.join(dir, 'out.pdf');
      fs.writeFileSync(path.join(dir, 'input.md'), '# Interrupted conversion');
      fs.writeFileSync(output, 'existing PDF');
      const renderer = mode === 'default' ? resolveVivliostyleCli() : cli;
      fs.writeFileSync(cli, `
        if (process.argv[1] === __filename) {
          const timer = setTimeout(() => process.exit(2), 10000);
          process.once('SIGTERM', () => {
            process.stderr.write('renderer received cancellation\\n');
            setTimeout(() => { clearTimeout(timer); process.exit(1); }, 1000);
          });
          process.kill(process.ppid, ${JSON.stringify(signal)});
        } else if (process.argv[1] === ${JSON.stringify(launcher)}) {
          const childProcess = require('node:child_process');
          const spawn = childProcess.spawn;
          childProcess.spawn = (command, args, options) => {
            if (args[0] === ${JSON.stringify(renderer)}) args = [__filename, ...args.slice(1)];
            return spawn(command, args, options);
          };
          require('node:module').syncBuiltinESMExports();
        }
      `);
      let args: string[];
      if (mode === 'persistent') {
        const socketPath = path.join(dir, 'daemon.sock');
        const daemon = net.createServer((connection) => {
          connection.once('data', () => { sendSession(connection, cli, fs.realpathSync(dir)); });
        });
        t.after(() => { daemon.close(); });
        daemon.listen(socketPath);
        await once(daemon, 'listening');
        fs.chmodSync(socketPath, 0o600);
        args = ['--vivliostyle-daemon', socketPath];
      } else {
        args = mode === 'external' ? ['--vivliostyle-cli', cli] : [];
      }
      const child = spawn(process.execPath, [
        launcher, '--input', 'input.md', '--output', output, '--log-level', 'info', ...args,
      ], {
        cwd: dir,
        env: mode === 'default' ? {
          ...process.env, NODE_OPTIONS: `--require "${cli}"`,
        } : process.env,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      t.after(() => { child.kill('SIGKILL'); });
      const closed = new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, terminationSignal) => { resolve([code, terminationSignal]); });
      });
      let stderr = '';
      let sentAgain = false;
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (!sentAgain && stderr.includes('renderer received cancellation')) {
          sentAgain = true;
          child.kill(signal);
        }
      });
      const [code, terminationSignal] = await closed;
      assert.ok(sentAgain, stderr);
      if (mode === 'persistent') {
        assert.equal(code, 1, stderr);
        assert.equal(terminationSignal, null);
        assert.match(stderr, /renderer interrupted by a signal/);
      } else {
        assert.equal(code, null, stderr);
        assert.equal(terminationSignal, signal);
      }
      assert.equal(fs.readFileSync(output, 'utf8'), 'existing PDF');
    });
  }
}
