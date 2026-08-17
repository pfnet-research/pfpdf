/** highlight.js integration via lowlight (build-time highlighting). */
import { createLowlight, all } from 'lowlight';

export const lowlight = createLowlight(all);

export function hasLanguage(lang: string): boolean {
  return lowlight.registered(lang);
}
