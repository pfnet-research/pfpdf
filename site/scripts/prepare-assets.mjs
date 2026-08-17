import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// Copies build outputs into public/ so Astro serves them verbatim:
//   ../build/site-assets/gallery/<t>/<lang>/*.webp -> public/assets/gallery/<t>/<lang>/
//   ../build/site-assets/gallery/<t>/<lang>/sample.<lang>.pdf -> public/gallery/<t>/
//   ../build/site-assets/hero/<lang>/ -> public/assets/hero/<lang>/
//   ../docs/tutorial.<lang>/assets/ -> public/assets/docs/<lang>/
// and composes public/ogp.png from three template cover images.

const siteRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const repoRoot = path.resolve(siteRoot, '..');
const assetsRoot = path.join(repoRoot, 'build', 'site-assets', 'gallery');
const heroRoot = path.join(repoRoot, 'build', 'site-assets', 'hero');
const publicRoot = path.join(siteRoot, 'public');

if (!fs.existsSync(assetsRoot)) {
  throw new Error(
    `missing ${assetsRoot}; run "make site-assets" at the repository root first`,
  );
}

fs.rmSync(path.join(publicRoot, 'assets'), { recursive: true, force: true });
fs.rmSync(path.join(publicRoot, 'gallery'), { recursive: true, force: true });

const templates = fs.readdirSync(assetsRoot).sort();
for (const template of templates) {
  for (const lang of ['ja', 'en']) {
    const sourceDir = path.join(assetsRoot, template, lang);
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`missing ${sourceDir}; re-run "make site-assets"`);
    }
    const imageDir = path.join(publicRoot, 'assets', 'gallery', template, lang);
    const pdfDir = path.join(publicRoot, 'gallery', template);
    fs.mkdirSync(imageDir, { recursive: true });
    fs.mkdirSync(pdfDir, { recursive: true });
    for (const file of fs.readdirSync(sourceDir)) {
      const source = path.join(sourceDir, file);
      if (file.endsWith('.pdf')) {
        fs.copyFileSync(source, path.join(pdfDir, file));
      } else if (file.endsWith('.webp') || file === 'index.json') {
        fs.copyFileSync(source, path.join(imageDir, file));
      }
    }
  }
}

for (const lang of ['ja', 'en']) {
  const sourceDir = path.join(heroRoot, lang);
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`missing ${sourceDir}; re-run "make site-assets"`);
  }
  const targetDir = path.join(publicRoot, 'assets', 'hero', lang);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of fs.readdirSync(sourceDir)) {
    fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
  }
}

for (const lang of ['ja', 'en']) {
  const source = path.join(repoRoot, 'docs', `tutorial.${lang}`, 'assets');
  const target = path.join(publicRoot, 'assets', 'docs', lang);
  fs.mkdirSync(target, { recursive: true });
  for (const file of fs.readdirSync(source)) {
    fs.copyFileSync(path.join(source, file), path.join(target, file));
  }
}

// OGP image: three covers side by side on a dark background.
const sharp = createRequire(path.join(siteRoot, 'package.json'))('sharp');
const OGP_WIDTH = 1200;
const OGP_HEIGHT = 630;
const coverTemplates = ['pfn', 'academic', 'technical'].filter((t) => templates.includes(t));
const coverHeight = 560;
const coverWidth = Math.round(coverHeight / Math.SQRT2);
const gap = Math.round((OGP_WIDTH - coverTemplates.length * coverWidth) / (coverTemplates.length + 1));
const composites = [];
for (const [index, template] of coverTemplates.entries()) {
  const indexJson = JSON.parse(
    fs.readFileSync(path.join(assetsRoot, template, 'ja', 'index.json'), 'utf8'),
  );
  const cover = path.join(assetsRoot, template, 'ja', indexJson.pages[0].full.file);
  composites.push({
    input: await sharp(cover).resize(coverWidth, coverHeight, { fit: 'fill' }).png().toBuffer(),
    left: gap + index * (coverWidth + gap),
    top: Math.round((OGP_HEIGHT - coverHeight) / 2),
  });
}
await sharp({
  create: { width: OGP_WIDTH, height: OGP_HEIGHT, channels: 3, background: { r: 16, g: 42, b: 44 } },
})
  .composite(composites)
  .png()
  .toFile(path.join(publicRoot, 'ogp.png'));

process.stdout.write(`prepared site assets for ${templates.length} templates\n`);
