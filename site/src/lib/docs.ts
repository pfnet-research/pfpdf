import { getCollection, render } from 'astro:content';
import { localeRoot, type Locale } from '../i18n';

export interface Chapter {
  id: string;
  slug: string;
  title: string;
  order: number;
  entry: Awaited<ReturnType<typeof getCollection>>[number];
}

/** `01_getting-started` -> slug `getting-started`, ordered by the number prefix. */
export async function listChapters(locale: Locale): Promise<Chapter[]> {
  const entries = await getCollection(locale === 'ja' ? 'tutorialJa' : 'tutorialEn');
  const chapters = await Promise.all(
    entries.map(async (entry) => {
      const match = entry.id.match(/^(\d+)_(.+)$/);
      if (match === null) {
        throw new Error(`unexpected tutorial id: ${entry.id}`);
      }
      const { headings } = await render(entry);
      const first = headings.find((heading) => heading.depth === 1);
      // Strip the "N. " chapter number from the PDF-oriented heading.
      const title = (first?.text ?? match[2]).replace(/^\d+\.\s*/, '');
      return { id: entry.id, slug: match[2], title, order: Number(match[1]), entry };
    }),
  );
  return chapters.sort((a, b) => a.order - b.order);
}

/**
 * Where "Docs" links land: the first chapter, not the chapter list. The list is
 * always present in the sidebar, so an index page would only add a click.
 */
export async function docsEntryPath(locale: Locale): Promise<string> {
  const [first] = await listChapters(locale);
  return `${localeRoot(locale)}docs/${first.slug}/`;
}
