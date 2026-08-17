// Keep the source and published dependency locks byte-identical.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageLock = fs.readFileSync(path.join(root, 'package-lock.json'));
const shrinkwrapPath = path.join(root, 'npm-shrinkwrap.json');
if (!fs.existsSync(shrinkwrapPath)) {
  console.error('npm-shrinkwrap.json is required in published packages');
  process.exit(1);
}
const shrinkwrap = fs.readFileSync(shrinkwrapPath);
if (!packageLock.equals(shrinkwrap)) {
  console.error('npm-shrinkwrap.json must be regenerated from package-lock.json');
  process.exit(1);
}
