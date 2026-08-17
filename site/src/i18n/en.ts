export const en = {
  siteName: 'pfpdf',
  tagline: 'Print-quality PDFs from Markdown',
  description:
    'pfpdf turns Markdown into print-quality PDFs with first-class Japanese typesetting. GFM, math, code highlighting, BibTeX, and cover pages — rendered by Vivliostyle and Chromium.',
  nav: { gallery: 'Gallery', docs: 'Docs', github: 'GitHub' },
  langSwitch: { label: '日本語', title: 'Read this page in Japanese' },
  theme: { toggle: 'Toggle dark mode' },
  hero: {
    subcopy:
      'First-class Japanese typesetting. GFM, math, code highlighting, BibTeX, and cover pages — rendered by Vivliostyle and Chromium.',
    installNote: 'No installation step needed — npx fetches and runs pfpdf directly.',
    getStarted: 'Get Started',
    browseTemplates: 'Browse Templates',
    viewOnGitHub: 'View on GitHub',
    inputLabel: 'document.md',
    outputLabel: 'document.pdf — rendered with the pfn template',
    copy: 'Copy',
    copied: 'Copied!',
  },
  features: {
    title: 'Features',
    items: [
      {
        title: 'GFM Markdown',
        body: 'Standard GitHub syntax for tables, task lists, strikethrough, autolinks, nested lists, and more.',
      },
      {
        title: 'Japanese-friendly emphasis',
        body: '`これは**「重要」**です` renders as strong emphasis even next to full-width punctuation.',
      },
      {
        title: 'Math and code highlighting',
        body: 'Inline and display math plus fenced code blocks work out of the box with bundled assets.',
      },
      {
        title: 'BibTeX bibliographies',
        body: 'Point front matter at .bib files and use \\cite{key} for numbered citations and a reference list.',
      },
      {
        title: '7 bundled templates + logo injection',
        body: 'From academic to technical. Logos are never bundled — inject yours with --logo PATH.',
      },
      {
        title: 'Redistributable bundled fonts',
        body: 'No dependency on OS fonts by default; host fonts are an explicit opt-in.',
      },
      {
        title: 'Local and Docker renderers',
        body: 'Local rendering is the default; CI systems can select the public Docker image explicitly.',
      },
      {
        title: 'CI-verified on 4 environments',
        body: 'PDF generation is verified with a real browser on macOS, Linux, and Windows.',
      },
    ],
  },
  teaser: {
    title: 'Seven templates, one command away',
    body: 'Every template renders the same sample document, so you can compare typography, covers, and density side by side.',
    cta: 'Browse the template gallery',
  },
  quickStart: {
    title: 'Quick start',
    steps: [
      { title: 'Write Markdown', body: 'A plain .md file with optional front matter for title, author, and template settings.' },
      { title: 'Run npx pfpdf', body: 'No install needed. Pass a directory to combine its Markdown files into a single PDF.' },
      { title: 'Get a print-quality PDF', body: 'Cover page, table of contents, page numbers, and typeset body — ready to print or share.' },
    ],
    directoryNote: 'Convert a directory of chapters at once, and pin the version in CI:',
    chromiumNote:
      'First run: pfpdf downloads Chromium for rendering (several hundred MB). Later runs use the cached browser and work offline for built-in features.',
  },
  footer: {
    docs: 'Docs',
    gallery: 'Gallery',
    github: 'GitHub',
    npm: 'npm',
    releases: 'Releases (PDF docs)',
    license: 'License',
    licenseNote:
      'pfpdf: MIT License. The Vivliostyle CLI dependency is AGPL-3.0; see THIRD_PARTY_LICENSES.md for the rest.',
    copyright: '© Preferred Networks, Inc.',
  },
  gallery: {
    title: 'Template gallery',
    intro:
      'All seven bundled templates render the same sample document (available in English and Japanese), so differences in typography, covers, and density are easy to compare. Switch templates with --template NAME.',
    pages: (n: number) => `${n} pages`,
    sampleTabs: { en: 'English sample', ja: 'Japanese sample' },
    jaShowcase: 'The Japanese sample doubles as a showcase of pfpdf’s Japanese typesetting.',
    downloadEn: 'Download sample PDF (EN)',
    downloadJa: 'Download sample PDF (JA)',
    cliLabel: 'Render your document with this template:',
    prev: 'Previous template',
    next: 'Next template',
    tutorialLink: 'Learn more in the tutorial: Templates, Logos, Assets, and Fonts',
    lightbox: { close: 'Close', prev: 'Previous page', next: 'Next page' },
    pageAlt: (template: string, lang: string, page: number) =>
      `${template} template (${lang} sample) — page ${page}`,
  },
  templateDescriptions: {
    academic: 'research-oriented',
    book: 'long-form',
    compact: 'space-efficient',
    default: 'neutral',
    notebook: 'warm and casual',
    pfn: 'corporate',
    technical: 'dense, code-first',
  } as Record<string, string>,
  docs: {
    title: 'Documentation',
    onThisPage: 'On this page',
    chapters: 'Chapters',
    prev: 'Previous',
    next: 'Next',
    editNote: 'This page is generated from the tutorial sources on GitHub.',
  },
  notFound: {
    title: 'Page not found',
    body: 'The page you were looking for does not exist.',
    home: 'Go to the top page',
    gallery: 'Browse the template gallery',
  },
};
