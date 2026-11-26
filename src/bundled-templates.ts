import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

interface TemplateManifest {
  templates?: unknown;
  slideVariants?: unknown;
  slideTemplates?: unknown;
}

const manifestPath = fileURLToPath(
  new URL('../resources/templates/manifest.json', import.meta.url),
);

function isTemplateNameList(value: unknown, allowEmpty = false): value is string[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(
    (name: unknown): name is string =>
      typeof name === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(name),
  ) && new Set(value).size === value.length;
}

function readBundledTemplateNames(): {
  documents: readonly string[];
  slideVariants: readonly string[];
  slides: readonly string[];
} {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as TemplateManifest;
  if (
    !isTemplateNameList(parsed.templates) ||
    !isTemplateNameList(parsed.slideVariants, true) ||
    !isTemplateNameList(parsed.slideTemplates, true) ||
    parsed.slideVariants.some((name) => !(parsed.templates as string[]).includes(name)) ||
    parsed.slideTemplates.some((name) => (parsed.templates as string[]).includes(name))
  ) {
    throw new Error('bundled template manifest is invalid');
  }
  return {
    documents: Object.freeze([...parsed.templates]),
    slideVariants: Object.freeze([...parsed.slideVariants]),
    slides: Object.freeze([...parsed.slideTemplates]),
  };
}

const names = readBundledTemplateNames();

/** Document templates: the gallery, the documentation builds, and the document contract tests use these. */
export const BUNDLED_TEMPLATE_NAMES = names.documents;
/** Document templates that also ship `slides-template.html` and `slides-style.css` for `slides: true`. */
export const BUNDLED_SLIDE_VARIANT_NAMES = names.slideVariants;
/** Slide-only templates. They are selected the same way but follow the slide contract. */
export const BUNDLED_SLIDE_TEMPLATE_NAMES = names.slides;

/** Warnings for bundled templates that remain selectable only for compatibility. */
export const DEPRECATED_BUNDLED_TEMPLATES: ReadonlyMap<string, string> = new Map([
  ['slide-base', 'template slide-base is deprecated and will be removed in 0.7.0; '
    + 'omit the template to use the slide variant of default, or select another bundled template'],
]);

export function isBundledTemplate(name: string): boolean {
  return names.documents.includes(name) || names.slides.includes(name);
}
