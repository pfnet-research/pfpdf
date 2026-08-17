// Documentation policy checks (AGENTS.md rules).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;

// AGENTS.md must stay free of Japanese characters.
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
if (/[　-ヿ㐀-鿿＀-￯]/.test(agents)) {
  console.error('AGENTS.md contains Japanese characters');
  failed = true;
}

// docs/design.en and docs/tutorial.en must mirror the Japanese trees when present.
for (const name of ['design', 'tutorial']) {
  const ja = path.join(root, 'docs', `${name}.ja`);
  const en = path.join(root, 'docs', `${name}.en`);
  if (!fs.existsSync(en)) {
    console.warn(`warning: docs/${name}.en does not exist yet (translation pending)`);
    continue;
  }
  const jaFiles = fs.readdirSync(ja).filter((f) => f.endsWith('.md')).sort();
  const enFiles = fs.readdirSync(en).filter((f) => f.endsWith('.md')).sort();
  if (JSON.stringify(jaFiles) !== JSON.stringify(enFiles)) {
    console.error(`docs/${name}.en does not mirror docs/${name}.ja`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
