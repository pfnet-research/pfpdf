import { InputError } from './errors.js';

export const FONT_SIZE_PROPERTY = '--pfpdf-font-size';

export function requireFontSize(value: unknown, source: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new InputError(`${source}: expected a positive number of points without a unit, such as 18 or 18.5`);
  }
  return value;
}
