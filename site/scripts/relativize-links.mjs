import fs from 'node:fs';
import path from 'node:path';

// Rewrites root-relative URLs ("/gallery/...") in the built HTML / CSS into
// URLs relative to each page, so the site works under any base path or domain
// (GitHub Pages project page today, custom domain later). Absolute URLs
// (canonical / hreflang / og:url, external links) are left untouched, and
// 404.html is skipped because it is served at arbitrary depths and must keep
// absolute URLs.

const distRoot = process.argv[2];
if (distRoot === undefined) {
  throw new Error('usage: node scripts/relativize-links.mjs DIST_DIR');
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

function toRelative(url, pageDirUrl) {
  if (!url.startsWith('/') || url.startsWith('//')) {
    return url;
  }
  const match = url.match(/^([^#?]*)([#?].*)?$/);
  const [, pathname, suffix = ''] = match;
  let relative = path.posix.relative(pageDirUrl, pathname);
  if (pathname.endsWith('/') && relative !== '' && !relative.endsWith('/')) {
    relative += '/';
  }
  if (relative === '') {
    relative = './';
  }
  return relative + suffix;
}

function rewriteHtml(html, pageDirUrl) {
  return html
    .replaceAll(/(\s(?:href|src|poster)=")([^"]*)(")/g, (_, before, url, after) =>
      `${before}${toRelative(url, pageDirUrl)}${after}`)
    .replaceAll(/(\ssrcset=")([^"]*)(")/g, (_, before, value, after) => {
      const rewritten = value
        .split(',')
        .map((candidate) => {
          const trimmed = candidate.trim();
          const [url, ...rest] = trimmed.split(/\s+/);
          return [toRelative(url, pageDirUrl), ...rest].join(' ');
        })
        .join(', ');
      return `${before}${rewritten}${after}`;
    });
}

function rewriteCssUrls(css, fileDirUrl) {
  return css.replaceAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_, quote, url) =>
    `url(${quote}${toRelative(url, fileDirUrl)}${quote})`);
}

let rewritten = 0;
for (const filePath of walk(distRoot)) {
  const relativePath = path.relative(distRoot, filePath);
  if (relativePath === '404.html') {
    continue;
  }
  const fileDirUrl = `/${path.posix.dirname(relativePath.split(path.sep).join('/'))}`.replace(/\/\.$/, '/');
  if (filePath.endsWith('.html')) {
    const html = fs.readFileSync(filePath, 'utf8');
    const output = rewriteHtml(html, fileDirUrl.endsWith('/') ? fileDirUrl : `${fileDirUrl}/`);
    if (output !== html) {
      fs.writeFileSync(filePath, output);
      rewritten += 1;
    }
  } else if (filePath.endsWith('.css')) {
    const css = fs.readFileSync(filePath, 'utf8');
    const output = rewriteCssUrls(css, fileDirUrl.endsWith('/') ? fileDirUrl : `${fileDirUrl}/`);
    if (output !== css) {
      fs.writeFileSync(filePath, output);
      rewritten += 1;
    }
  }
}
process.stdout.write(`relativized links in ${rewritten} files\n`);
