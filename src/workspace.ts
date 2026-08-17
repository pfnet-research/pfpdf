/** Workspace: temporary build directory with secure creation and cleanup. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RuntimeError } from './errors.js';

export function validateLogicalPath(logical: string): void {
  if (
    logical === '' || path.isAbsolute(logical) ||
    logical.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new RuntimeError(`invalid logical asset path: ${logical}`);
  }
}

export function writeLogicalFile(root: string, logical: string, content: string | Buffer): string {
  validateLogicalPath(logical);
  const target = path.join(root, ...logical.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, content, { mode: 0o600 });
  return target;
}

export class Workspace {
  readonly dir: string;
  readonly rendererOutputDir: string;
  private removed = false;

  private constructor(dir: string) {
    this.dir = dir;
    this.rendererOutputDir = path.join(dir, 'renderer-output');
  }

  static create(): Workspace {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-'));
    fs.chmodSync(dir, 0o700);
    const ws = new Workspace(dir);
    fs.mkdirSync(ws.rendererOutputDir, { mode: 0o700 });
    return ws;
  }

  writeFile(name: string, content: string | Buffer): string {
    return writeLogicalFile(this.dir, name, content);
  }

  filePath(name: string): string {
    return path.join(this.dir, name);
  }

  cleanup(keep: boolean, warn: (msg: string) => void): boolean {
    if (this.removed) return true;
    if (keep) {
      warn(
        `workspace kept at ${this.dir}; it may contain input-derived secrets, delete it after inspection`,
      );
      return true;
    }
    try {
      fs.rmSync(this.dir, { recursive: true, force: true });
      this.removed = true;
      return true;
    } catch (e) {
      warn(`failed to remove workspace ${this.dir}: ${(e as Error).message}`);
      return false;
    }
  }
}
