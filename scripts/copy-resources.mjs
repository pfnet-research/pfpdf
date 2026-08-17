// Copy vendored assets (fonts, highlight.js theme) into resources/.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// highlight.js theme
const hljsCss = require.resolve('highlight.js/styles/github.css');
copy(hljsCss, path.join(root, 'resources', 'vendor', 'hljs-github.css'));

// Bundled fonts: @fontsource CSS + WOFF2 files. The pinned Chromium supports
// WOFF2, so omit duplicate WOFF sources from the distributed resources.
const fontsDest = path.join(root, 'resources', 'fonts');
fs.rmSync(fontsDest, { recursive: true, force: true });
fs.mkdirSync(path.join(fontsDest, 'files'), { recursive: true });

const fontSpecs = [
  { pkg: '@fontsource/noto-sans-jp', css: ['400.css', '700.css'] },
  { pkg: '@fontsource/noto-sans', css: ['400.css', '700.css'] },
  { pkg: '@fontsource/noto-sans-arabic', css: ['arabic-400.css', 'arabic-700.css'] },
  { pkg: '@fontsource/noto-sans-armenian', css: ['armenian-400.css', 'armenian-700.css'] },
  { pkg: '@fontsource/noto-sans-bengali', css: ['bengali-400.css', 'bengali-700.css'] },
  { pkg: '@fontsource/noto-sans-ethiopic', css: ['ethiopic-400.css', 'ethiopic-700.css'] },
  { pkg: '@fontsource/noto-sans-georgian', css: ['georgian-400.css', 'georgian-700.css'] },
  { pkg: '@fontsource/noto-sans-gujarati', css: ['gujarati-400.css', 'gujarati-700.css'] },
  { pkg: '@fontsource/noto-sans-gurmukhi', css: ['gurmukhi-400.css', 'gurmukhi-700.css'] },
  { pkg: '@fontsource/noto-sans-hebrew', css: ['hebrew-400.css', 'hebrew-700.css'] },
  { pkg: '@fontsource/noto-sans-kannada', css: ['kannada-400.css', 'kannada-700.css'] },
  { pkg: '@fontsource/noto-sans-khmer', css: ['khmer-400.css', 'khmer-700.css'] },
  { pkg: '@fontsource/noto-sans-kr', css: ['korean-400.css', 'korean-700.css'] },
  { pkg: '@fontsource/noto-sans-lao', css: ['lao-400.css', 'lao-700.css'] },
  { pkg: '@fontsource/noto-sans-malayalam', css: ['malayalam-400.css', 'malayalam-700.css'] },
  { pkg: '@fontsource/noto-sans-myanmar', css: ['myanmar-400.css', 'myanmar-700.css'] },
  { pkg: '@fontsource/noto-sans-sinhala', css: ['sinhala-400.css', 'sinhala-700.css'] },
  { pkg: '@fontsource/noto-sans-tamil', css: ['tamil-400.css', 'tamil-700.css'] },
  { pkg: '@fontsource/noto-sans-telugu', css: ['telugu-400.css', 'telugu-700.css'] },
  { pkg: '@fontsource/noto-sans-thai', css: ['thai-400.css', 'thai-700.css'] },
  { pkg: '@fontsource/noto-serif-jp', css: ['400.css', '700.css'] },
  { pkg: '@fontsource/noto-serif', css: ['400.css', '700.css'] },
  { pkg: '@fontsource/noto-naskh-arabic', css: ['arabic-400.css', 'arabic-700.css'] },
  { pkg: '@fontsource/noto-serif-armenian', css: ['armenian-400.css', 'armenian-700.css'] },
  { pkg: '@fontsource/noto-serif-bengali', css: ['bengali-400.css', 'bengali-700.css'] },
  { pkg: '@fontsource/noto-serif-devanagari', css: ['devanagari-400.css', 'devanagari-700.css'] },
  { pkg: '@fontsource/noto-serif-ethiopic', css: ['ethiopic-400.css', 'ethiopic-700.css'] },
  { pkg: '@fontsource/noto-serif-georgian', css: ['georgian-400.css', 'georgian-700.css'] },
  { pkg: '@fontsource/noto-serif-gujarati', css: ['gujarati-400.css', 'gujarati-700.css'] },
  { pkg: '@fontsource/noto-serif-gurmukhi', css: ['gurmukhi-400.css', 'gurmukhi-700.css'] },
  { pkg: '@fontsource/noto-serif-hebrew', css: ['hebrew-400.css', 'hebrew-700.css'] },
  { pkg: '@fontsource/noto-serif-kannada', css: ['kannada-400.css', 'kannada-700.css'] },
  { pkg: '@fontsource/noto-serif-khmer', css: ['khmer-400.css', 'khmer-700.css'] },
  { pkg: '@fontsource/noto-serif-kr', css: ['korean-400.css', 'korean-700.css'] },
  { pkg: '@fontsource/noto-serif-lao', css: ['lao-400.css', 'lao-700.css'] },
  { pkg: '@fontsource/noto-serif-malayalam', css: ['malayalam-400.css', 'malayalam-700.css'] },
  { pkg: '@fontsource/noto-serif-myanmar', css: ['myanmar-400.css', 'myanmar-700.css'] },
  { pkg: '@fontsource/noto-serif-sinhala', css: ['sinhala-400.css', 'sinhala-700.css'] },
  { pkg: '@fontsource/noto-serif-tamil', css: ['tamil-400.css', 'tamil-700.css'] },
  { pkg: '@fontsource/noto-serif-telugu', css: ['telugu-400.css', 'telugu-700.css'] },
  { pkg: '@fontsource/noto-serif-thai', css: ['thai-400.css', 'thai-700.css'] },
  { pkg: '@fontsource/noto-sans-mono', css: ['400.css', '700.css'] },
  { pkg: '@fontsource/noto-sans-symbols-2', css: ['symbols-400.css', 'math-400.css'] },
  { pkg: '@fontsource/noto-emoji', css: ['emoji-400.css'] },
];
for (const spec of fontSpecs) {
  const pkgDir = path.dirname(require.resolve(`${spec.pkg}/package.json`));
  for (const cssName of spec.css) {
    const cssPath = path.join(pkgDir, cssName);
    if (!fs.existsSync(cssPath)) continue;
    const css = fs.readFileSync(cssPath, 'utf8').replace(
      /,\s*url\(\.\/files\/[^)]+\.woff\) format\('woff'\)/g,
      '',
    );
    const outName = `${spec.pkg.split('/')[1]}-${cssName}`;
    fs.writeFileSync(path.join(fontsDest, outName), css);
    for (const m of css.matchAll(/url\(\.\/files\/([^)]+)\)/g)) {
      const file = m[1];
      const src = path.join(pkgDir, 'files', file);
      if (fs.existsSync(src)) copy(src, path.join(fontsDest, 'files', file));
    }
  }
}

console.log('resources copied');
