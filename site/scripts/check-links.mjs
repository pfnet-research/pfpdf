import fs from 'node:fs';
import path from 'node:path';

// Post-build verification that the site is base-path independent:
//   1. no root-relative URLs remain in any HTML / CSS file except 404.html
//   2. every relative link / asset reference resolves to a file in dist
// This backs the "deploy anywhere" requirement from HOMEPAGE_PLAN §13.

const distRoot = process.argv[2];
if (distRoot === undefined) {
  throw new Error('usage: node scripts/check-links.mjs DIST_DIR');
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(filePath);
    } else {
      yield filePath;
    }
  }
}

const errors = [];

function checkUrl(url, filePath) {
  if (
    url === ''
    || url.startsWith('#')
    || url.startsWith('http://')
    || url.startsWith('https://')
    || url.startsWith('mailto:')
    || url.startsWith('data:')
  ) {
    return;
  }
  const relativePath = path.relative(distRoot, filePath);
  if (url.startsWith('/')) {
    if (relativePath !== '404.html') {
      errors.push(`${relativePath}: root-relative URL survived post-processing: ${url}`);
    }
    return;
  }
  const pathname = url.replace(/[#?].*$/, '');
  if (pathname === '') {
    return;
  }
  const resolved = path.resolve(path.dirname(filePath), decodeURIComponent(pathname));
  const candidates = pathname.endsWith('/')
    ? [path.join(resolved, 'index.html')]
    : [resolved, path.join(resolved, 'index.html')];
  if (!candidates.some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())) {
    errors.push(`${relativePath}: broken link: ${url}`);
  }
}

let checked = 0;
for (const filePath of walk(distRoot)) {
  if (filePath.endsWith('.html')) {
    const html = fs.readFileSync(filePath, 'utf8');
    for (const match of html.matchAll(/\s(?:href|src|poster)="([^"]*)"/g)) {
      checkUrl(match[1], filePath);
      checked += 1;
    }
    for (const match of html.matchAll(/\ssrcset="([^"]*)"/g)) {
      for (const candidate of match[1].split(',')) {
        const url = candidate.trim().split(/\s+/)[0];
        checkUrl(url, filePath);
        checked += 1;
      }
    }
  } else if (filePath.endsWith('.css')) {
    const css = fs.readFileSync(filePath, 'utf8');
    for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
      checkUrl(match[2], filePath);
      checked += 1;
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`checked ${checked} references, all resolve\n`);
