import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';

// Converts the rendered template sample PDFs (Japanese and English) into the
// gallery assets consumed by site/: per-page WebP thumbnails, lightbox images,
// downloadable PDFs, and an index.json manifest per template and language.
// The cover of the separate hero document (no Confidential badge) is converted
// alongside them, for the landing page illustration.
//
// usage: node scripts/build-site-assets.mjs [--docs-root build/docs]
//          [--output build/site-assets] [--hero-template pfn]

const args = process.argv.slice(2);
function readOption(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = args[index + 1];
  if (value === undefined) {
    throw new Error(`missing value for ${name}`);
  }
  return value;
}

const docsRoot = readOption('--docs-root', 'build/docs');
const outputRoot = readOption('--output', 'build/site-assets');
const heroTemplate = readOption('--hero-template', 'pfn');
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// sharp is a devDependency of site/ (the site is an independent npm project);
// the root package must stay free of site-only dependencies.
const siteRequire = createRequire(path.join(repoRoot, 'site', 'package.json'));
let sharp;
try {
  sharp = siteRequire('sharp');
} catch {
  throw new Error('sharp is not installed; run "npm ci" inside site/ first');
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'resources', 'templates', 'manifest.json'), 'utf8'),
);
const templates = manifest.templates;
if (!Array.isArray(templates) || templates.length === 0) {
  throw new Error('bundled template manifest is empty or unreadable');
}

const LANGUAGES = [
  { code: 'ja', pdfName: 'sample.pdf', heroPdfName: 'hero.pdf' },
  { code: 'en', pdfName: 'sample.en.pdf', heroPdfName: 'hero.en.pdf' },
];
const THUMB_WIDTH = 480;
const FULL_WIDTH = 1500;

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', shell: false });
  if (result.error !== undefined) {
    throw new Error(`${command} is required to build site assets: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

async function buildLanguageAssets(template, language) {
  const pdfPath = path.join(docsRoot, 'templates', template, language.pdfName);
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`missing sample PDF (run "make docs-template-samples" first): ${pdfPath}`);
  }
  const pdf = await PDFDocument.load(fs.readFileSync(pdfPath));
  const pageCount = pdf.getPageCount();
  const minimumPageCount = template === 'compact' ? 4 : 5;
  if (pageCount < minimumPageCount) {
    throw new Error(`${template} ${language.code} sample must have at least ${minimumPageCount} pages, got ${pageCount}`);
  }

  const outputDir = path.join(outputRoot, 'gallery', template, language.code);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.copyFileSync(pdfPath, path.join(outputDir, `sample.${language.code}.pdf`));

  const masterDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-site-assets-'));
  const pages = [];
  try {
    const pageNumberWidth = Math.max(2, String(pageCount).length);
    for (let page = 1; page <= pageCount; page++) {
      const label = String(page).padStart(pageNumberWidth, '0');
      const masterPrefix = path.join(masterDir, `page-${label}`);
      run('pdftoppm', [
        '-f', String(page), '-l', String(page), '-r', '180', '-png', '-singlefile',
        pdfPath, masterPrefix,
      ]);
      const master = sharp(`${masterPrefix}.png`);
      const thumbName = `page-${label}.thumb.webp`;
      const fullName = `page-${label}.webp`;
      const thumb = await master
        .clone()
        .resize({ width: THUMB_WIDTH })
        .webp({ quality: 82 })
        .toFile(path.join(outputDir, thumbName));
      const full = await master
        .clone()
        .resize({ width: FULL_WIDTH, withoutEnlargement: true })
        .webp({ quality: 84 })
        .toFile(path.join(outputDir, fullName));
      pages.push({
        page,
        thumb: { file: thumbName, width: thumb.width, height: thumb.height },
        full: { file: fullName, width: full.width, height: full.height },
      });
    }
  } finally {
    fs.rmSync(masterDir, { recursive: true, force: true });
  }

  fs.writeFileSync(
    path.join(outputDir, 'index.json'),
    `${JSON.stringify({ template, language: language.code, pageCount, pdf: `sample.${language.code}.pdf`, pages }, null, 2)}\n`,
  );
  process.stdout.write(`${template}/${language.code}: ${pageCount} pages\n`);
}

async function buildHeroAsset(language) {
  const pdfPath = path.join(docsRoot, 'hero', language.heroPdfName);
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`missing hero PDF (run "make docs-hero-sample" first): ${pdfPath}`);
  }
  const outputDir = path.join(outputRoot, 'hero', language.code);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const masterDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-hero-asset-'));
  try {
    const masterPrefix = path.join(masterDir, 'cover');
    run('pdftoppm', ['-f', '1', '-l', '1', '-r', '180', '-png', '-singlefile', pdfPath, masterPrefix]);
    const cover = await sharp(`${masterPrefix}.png`)
      .resize({ width: FULL_WIDTH, withoutEnlargement: true })
      .webp({ quality: 84 })
      .toFile(path.join(outputDir, 'cover.webp'));
    fs.writeFileSync(
      path.join(outputDir, 'index.json'),
      `${JSON.stringify({
        language: language.code,
        template: heroTemplate,
        cover: { file: 'cover.webp', width: cover.width, height: cover.height },
      }, null, 2)}\n`,
    );
  } finally {
    fs.rmSync(masterDir, { recursive: true, force: true });
  }
  process.stdout.write(`hero/${language.code}: cover\n`);
}

for (const template of templates) {
  for (const language of LANGUAGES) {
    await buildLanguageAssets(template, language);
  }
}
for (const language of LANGUAGES) {
  await buildHeroAsset(language);
}
process.stdout.write(`site assets written to ${outputRoot}\n`);
