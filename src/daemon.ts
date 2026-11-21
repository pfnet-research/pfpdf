/** Discover the CLI and build directory of an owner-only Vivliostyle daemon. */
import fs from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import path from 'node:path';
import { RuntimeError } from './errors.js';

const protocolVersion = 1;
const maxSessionBytes = 64 * 1024;

interface DaemonSession {
  socketPath: string;
  cliPath: string;
  cwd: string;
}

export async function describeDaemon(
  socketPath: string,
  deadline: number,
  signal?: AbortSignal,
): Promise<DaemonSession> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new RuntimeError('render deadline exceeded before daemon discovery');
  const timeout = AbortSignal.timeout(remaining);
  const discoverySignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  let socket: Socket | undefined;
  let directoryFd: number | undefined;
  try {
    discoverySignal.throwIfAborted();
    const directory = fs.realpathSync(path.dirname(socketPath));
    const name = path.basename(socketPath);
    const address = path.join(directory, name);
    const maxPathBytes = process.platform === 'darwin' ? 103 : 107;
    if (Buffer.byteLength(address) > maxPathBytes) {
      throw new Error(`socket path exceeds ${maxPathBytes} bytes`);
    }
    // Linux can connect relative to an open directory. On macOS, verify the
    // ancestors protect the directory entry from replacement.
    let connectPath = address;
    if (process.platform === 'linux' && fs.existsSync('/proc/self/fd') &&
      (fs.lstatSync(directory).mode & 0o400) !== 0) {
      directoryFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      const pinnedPath = `/proc/self/fd/${directoryFd}/${name}`;
      if (Buffer.byteLength(pinnedPath) <= maxPathBytes) connectPath = pinnedPath;
    }
    if (connectPath === address) {
      validateSocketAncestors(directory);
    }
    const directoryInfo = connectPath === address || directoryFd === undefined
      ? fs.lstatSync(directory)
      : fs.fstatSync(directoryFd);
    validateOwnerSocket(directoryInfo, connectPath);
    socket = createConnection({ path: connectPath, signal: discoverySignal });
    const request = Buffer.from(JSON.stringify({ type: 'describe', version: protocolVersion }));
    const header = Buffer.alloc(4);
    header.writeUInt32BE(request.length);
    socket.write(Buffer.concat([header, request]));
    const reply = await readSessionFrame(socket);
    discoverySignal.throwIfAborted();
    return parseSession(reply, address);
  } catch (error) {
    const detail = signal?.aborted === true ? 'discovery interrupted'
      : timeout.aborted ? 'discovery timed out'
        : (error as Error).message;
    throw new RuntimeError(`--vivliostyle-daemon: ${socketPath}: ${detail}`);
  } finally {
    socket?.destroy();
    if (directoryFd !== undefined) fs.closeSync(directoryFd);
  }
}

function validateSocketAncestors(directory: string): void {
  const uid = process.getuid?.();
  const { root } = path.parse(directory);
  let ancestor = root;
  for (const segment of path.relative(root, directory).split(path.sep)) {
    // Validate from the root down. A shared directory must protect its entries
    // against replacement by users who own neither the directory nor an entry.
    const info = fs.lstatSync(ancestor);
    const replaceableEntries = (info.mode & 0o022) !== 0 && (info.mode & 0o1000) === 0;
    if (!info.isDirectory() || (info.uid !== uid && info.uid !== 0) || replaceableEntries) {
      throw new Error(`unsafe ancestor of the daemon socket directory: ${ancestor}`);
    }
    ancestor = path.join(ancestor, segment);
  }
}

function validateOwnerSocket(directory: fs.Stats, socketPath: string): void {
  if (!directory.isDirectory() || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) {
    throw new Error('expected a socket directory accessible only to its owner');
  }
  const entry = fs.lstatSync(socketPath);
  if (!entry.isSocket() || entry.uid !== directory.uid || (entry.mode & 0o077) !== 0) {
    throw new Error('expected an owner-only Unix socket owned by the current user');
  }
}

function parseSession(reply: unknown, socketPath: string): DaemonSession {
  if (reply === null || typeof reply !== 'object') throw new Error('unexpected daemon session reply');
  if ('type' in reply && reply.type === 'result' && 'error' in reply && typeof reply.error === 'string') {
    throw new Error(`incompatible daemon: ${reply.error}`);
  }
  if (!('type' in reply) || reply.type !== 'session' ||
    !('version' in reply) || reply.version !== protocolVersion) {
    throw new Error(`incompatible daemon session protocol (expected version ${protocolVersion})`);
  }
  if (!('cliPath' in reply) || typeof reply.cliPath !== 'string' || !path.isAbsolute(reply.cliPath) ||
    !('cwd' in reply) || typeof reply.cwd !== 'string' || !path.isAbsolute(reply.cwd)) {
    throw new Error('daemon session must supply absolute CLI and working directory paths');
  }
  if (!fs.statSync(reply.cliPath).isFile()) throw new Error('daemon CLI is not a regular file');
  fs.accessSync(reply.cliPath, fs.constants.R_OK);
  if (!fs.statSync(reply.cwd).isDirectory()) throw new Error('daemon working directory is not a directory');
  fs.accessSync(reply.cwd, fs.constants.X_OK);
  return { socketPath, cliPath: reply.cliPath, cwd: reply.cwd };
}

async function readSessionFrame(socket: Socket): Promise<unknown> {
  const frame = Buffer.allocUnsafe(4 + maxSessionBytes);
  let received = 0;
  for await (const chunk of socket as AsyncIterable<Buffer>) {
    received += chunk.copy(frame, received);
    if (received < 4) continue;
    const size = frame.readUInt32BE();
    if (size === 0 || size > maxSessionBytes) throw new Error('invalid daemon session frame length');
    if (received >= 4 + size) {
      return JSON.parse(frame.toString('utf8', 4, 4 + size)) as unknown;
    }
  }
  throw new Error('daemon connection closed before sending a session');
}
