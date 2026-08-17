import { defineConfig } from 'astro/config';
import { SITE_URL } from './src/lib/site-config.mjs';
import { remarkTutorialLinks } from './src/lib/remark-tutorial-links.mjs';

// `base` is deliberately not used: pages link with root-relative URLs in
// source, and scripts/relativize-links.mjs turns them into page-relative URLs
// after the build so the output works under any base path.
export default defineConfig({
  site: SITE_URL,
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  markdown: {
    remarkPlugins: [remarkTutorialLinks],
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});
