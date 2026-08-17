import type { APIRoute } from 'astro';
import { SITE_URL } from '../lib/site-config.mjs';
import { listTemplates } from '../lib/gallery';
import { listChapters } from '../lib/docs';

export const GET: APIRoute = async () => {
  const paths = ['', 'gallery/'];
  for (const template of listTemplates()) {
    paths.push(`gallery/${template}/`);
  }
  // `docs/` is only a redirect to the first chapter, so it is not listed.
  for (const chapter of await listChapters('en')) {
    paths.push(`docs/${chapter.slug}/`);
  }

  const urls = paths
    .map((path) => {
      const enUrl = new URL(path, SITE_URL).href;
      const jaUrl = new URL(`ja/${path}`, SITE_URL).href;
      const alternates = [
        `    <xhtml:link rel="alternate" hreflang="en" href="${enUrl}"/>`,
        `    <xhtml:link rel="alternate" hreflang="ja" href="${jaUrl}"/>`,
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${enUrl}"/>`,
      ].join('\n');
      return [enUrl, jaUrl]
        .map((loc) => `  <url>\n    <loc>${loc}</loc>\n${alternates}\n  </url>`)
        .join('\n');
    })
    .join('\n');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    urls,
    '</urlset>',
    '',
  ].join('\n');
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
