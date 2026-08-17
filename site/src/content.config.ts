import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// The tutorial trees in docs/ are the single source of truth; the site reads
// them in place and never copies or edits them. 00_title.md is the PDF cover
// page and is not published on the web.
const tutorialSchema = z.object({}).passthrough();

const tutorialEn = defineCollection({
  loader: glob({ pattern: '0[1-9]_*.md', base: '../docs/tutorial.en' }),
  schema: tutorialSchema,
});

const tutorialJa = defineCollection({
  loader: glob({ pattern: '0[1-9]_*.md', base: '../docs/tutorial.ja' }),
  schema: tutorialSchema,
});

export const collections = { tutorialEn, tutorialJa };
