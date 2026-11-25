import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'resources', 'templates', 'manifest.json');
const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const args = process.argv.slice(2);
// --slides lists the templates that ship a slide variant.
const slides = args.includes('--slides');
const options = args.filter((arg) => arg !== '--slides');
const templates = slides ? parsed.slideVariants : parsed.templates;

if (
  !Array.isArray(templates) ||
  (!slides && templates.length === 0) ||
  templates.some((name) => typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name)) ||
  new Set(templates).size !== templates.length
) {
  throw new Error('bundled template manifest is invalid');
}

if (options.length === 1 && options[0] === '--make') {
  process.stdout.write(`${templates.join(' ')}\n`);
} else if (options.length === 0) {
  process.stdout.write(`${templates.join('\n')}\n`);
} else {
  throw new Error('usage: node scripts/list-bundled-templates.mjs [--make] [--slides]');
}
