import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

interface TemplateManifest {
  templates?: unknown;
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

function readBundledTemplateNames(): readonly string[] {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as TemplateManifest;
  if (
    !isTemplateNameList(parsed.templates) ||
    new Set(parsed.templates).size !== parsed.templates.length
  ) {
    throw new Error('bundled template manifest is invalid');
  }
  return Object.freeze([...parsed.templates] as string[]);
}

export const BUNDLED_TEMPLATE_NAMES = readBundledTemplateNames();
