import type { APIRoute } from 'astro';
import { SITE_URL } from '../lib/site-config.mjs';

export const GET: APIRoute = () => {
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml', SITE_URL).href}\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain' } });
};
