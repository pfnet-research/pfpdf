import fs from 'node:fs';
import path from 'node:path';
import type { Locale } from '../i18n';

export interface GalleryImage {
  file: string;
  width: number;
  height: number;
}

export interface GalleryPage {
  page: number;
  thumb: GalleryImage;
  full: GalleryImage;
}

export interface GallerySample {
  template: string;
  language: Locale;
  pageCount: number;
  pdf: string;
  pages: GalleryPage[];
}

/** The landing-page illustration: the same cover, rendered without `confidential`. */
export interface HeroSample {
  language: Locale;
  template: string;
  cover: GalleryImage;
}

const repoRoot = path.resolve(process.cwd(), '..');

/** Template order is the manifest order (the single source of truth). */
export function listTemplates(): string[] {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'resources', 'templates', 'manifest.json'), 'utf8'),
  );
  return manifest.templates as string[];
}

export function loadSample(template: string, language: Locale): GallerySample {
  const indexPath = path.join(
    process.cwd(), 'public', 'assets', 'gallery', template, language, 'index.json',
  );
  return JSON.parse(fs.readFileSync(indexPath, 'utf8')) as GallerySample;
}

export function loadHero(language: Locale): HeroSample {
  const indexPath = path.join(process.cwd(), 'public', 'assets', 'hero', language, 'index.json');
  return JSON.parse(fs.readFileSync(indexPath, 'utf8')) as HeroSample;
}

/** The Markdown the hero illustration is rendered from, shown beside it. */
export function loadHeroSource(language: Locale): string {
  const name = language === 'ja' ? 'hero.md' : 'hero.en.md';
  return fs.readFileSync(path.join(repoRoot, 'docs', 'template-preview', name), 'utf8').trimEnd();
}

/** Root-relative URL of the hero cover image. */
export function heroImageUrl(language: Locale, file: string): string {
  return `/assets/hero/${language}/${file}`;
}

/** Root-relative URL of a gallery page image. */
export function imageUrl(template: string, language: Locale, file: string): string {
  return `/assets/gallery/${template}/${language}/${file}`;
}

/** Root-relative URL of a downloadable sample PDF. */
export function pdfUrl(template: string, language: Locale): string {
  return `/gallery/${template}/sample.${language}.pdf`;
}
