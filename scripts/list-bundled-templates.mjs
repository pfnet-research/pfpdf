import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'resources', 'templates', 'manifest.json');
const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const templates = parsed.templates;

if (
  !Array.isArray(templates) ||
  templates.length === 0 ||
  templates.some((name) => typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name)) ||
  new Set(templates).size !== templates.length
) {
  throw new Error('bundled template manifest is invalid');
}

if (process.argv[2] === '--make') {
  process.stdout.write(`${templates.join(' ')}\n`);
} else if (process.argv.length === 2) {
  process.stdout.write(`${templates.join('\n')}\n`);
} else {
  throw new Error('usage: node scripts/list-bundled-templates.mjs [--make]');
}
