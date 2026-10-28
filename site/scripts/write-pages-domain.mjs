import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SITE_URL } from '../src/lib/site-config.mjs';

// Branch-based Pages publishing stores its custom domain in the output root.
// Regenerate it on every build because deployment replaces the entire branch.
const url = new URL(SITE_URL);
const cnamePath = path.join(process.argv[2] ?? 'dist', 'CNAME');
if (url.hostname === 'github.io' || url.hostname.endsWith('.github.io')) {
  rmSync(cnamePath, { force: true });
} else {
  writeFileSync(cnamePath, `${url.hostname}\n`);
}
