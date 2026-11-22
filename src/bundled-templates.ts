import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

interface TemplateManifest {
  templates?: unknown;
  slideTemplates?: unknown;
}

const manifestPath = fileURLToPath(
  new URL('../resources/templates/manifest.json', import.meta.url),
);

function isTemplateNameList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(
    (name: unknown): name is string =>
      typeof name === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(name),
  );
}

function readBundledTemplateNames(): { documents: readonly string[]; slides: readonly string[] } {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as TemplateManifest;
  if (
    !isTemplateNameList(parsed.templates) ||
    !isTemplateNameList(parsed.slideTemplates) ||
    new Set([...parsed.templates, ...parsed.slideTemplates]).size !== parsed.templates.length + parsed.slideTemplates.length
  ) {
    throw new Error('bundled template manifest is invalid');
  }
  return { documents: Object.freeze([...parsed.templates]), slides: Object.freeze([...parsed.slideTemplates]) };
}

const names = readBundledTemplateNames();

/** Document templates: the gallery, the documentation builds, and the document contract tests use these. */
export const BUNDLED_TEMPLATE_NAMES = names.documents;
/** Slide templates are selected the same way but follow the slide contract. */
export const BUNDLED_SLIDE_TEMPLATE_NAMES = names.slides;

export function isBundledTemplate(name: string): boolean {
  return names.documents.includes(name) || names.slides.includes(name);
}
