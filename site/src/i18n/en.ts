export const en = {
  siteName: 'pfpdf',
  tagline: 'Print-quality PDFs from Markdown',
  description:
    'pfpdf is a command-line tool that turns Markdown into print-quality PDFs. It supports GFM, math, code highlighting, BibTeX citations, and cover pages, and typesets Japanese documents with Vivliostyle and Chromium.',
  nav: { gallery: 'Gallery', docs: 'Docs', github: 'GitHub' },
  langSwitch: { label: '日本語', title: 'Read this page in Japanese' },
  theme: { toggle: 'Toggle dark mode' },
  hero: {
    subcopy:
      'pfpdf typesets Japanese documents with Vivliostyle and Chromium. It supports GFM, math, code highlighting, BibTeX citations, and cover pages.',
    installNote: 'You need Node.js 22.12.0 or later and npm. npx fetches and runs pfpdf without a separate pfpdf installation.',
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
        title: 'GitHub Flavored Markdown (GFM)',
        body: 'Supports tables, task lists, strikethrough, autolinks, nested lists, and other GitHub Markdown syntax.',
      },
      {
        title: 'Japanese-friendly emphasis',
        body: '`これは**「重要」**です` renders as strong emphasis even next to full-width punctuation.',
      },
      {
        title: 'Math and code highlighting',
        body: 'Supports inline and display math, plus syntax highlighting for fenced code blocks. The required assets are bundled.',
      },
      {
        title: 'BibTeX bibliographies',
        body: 'Specify .bib files in front matter and use \\cite{key} to generate numbered citations and a reference list.',
      },
      {
        title: '7 templates with optional logos',
        body: 'Choose from templates for papers and documents centered on code. Logos are not bundled; specify yours with --logo PATH.',
      },
      {
        title: 'Redistributable bundled fonts',
        body: 'Bundled templates use bundled fonts by default. --host-fonts adds OS fonts to the search.',
      },
      {
        title: 'Automatic browser download',
        body: 'By default, the bundled Vivliostyle CLI downloads and manages Chromium. Use --browser-path to select an existing compatible browser.',
      },
      {
        title: 'PDF generation tested in 4 environments',
        body: 'CI verifies PDF generation with a real browser on macOS (Arm64), Linux (x64 and Arm64), and Windows (x64).',
      },
    ],
  },
  teaser: {
    title: 'Seven templates, one command away',
    body: 'Each template renders the same sample document, so you can compare layouts, covers, and information per page side by side.',
    cta: 'Browse the template gallery',
  },
  quickStart: {
    title: 'Quick start',
    steps: [
      { title: 'Write Markdown', body: 'Write Markdown in a .md file. Optionally set the title, author, and template in front matter at the start of the file.' },
      { title: 'Run npx @pfnet-research/pfpdf', body: 'Set --input to the .md file and --output to the path where you want to save the PDF, then run the command.' },
      { title: 'Get a print-quality PDF', body: 'By default, the PDF includes a cover page, table of contents, and page numbers. Check the file at the location you set with --output.' },
    ],
    directoryNote: 'Pass a directory to --input to combine the .md files directly inside it into one PDF in filename order. The second example pins the version for CI:',
    chromiumNote:
      'The first run requires an internet connection; downloading Chromium for PDF rendering may transfer several hundred MB. Once npm packages and the browser are cached, documents using only bundled features can be converted offline. On Linux, install the OS shared libraries required by Chromium.',
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
      'In each language, all seven bundled templates render the same sample document, so you can compare layouts, covers, and information per page. Switch templates with --template NAME.',
    pages: (n: number) => `${n} pages`,
    sampleTabs: { en: 'English sample', ja: 'Japanese sample' },
    jaShowcase: 'The Japanese sample shows how pfpdf typesets mixed Japanese and English text and handles emphasis.',
    downloadEn: 'Download sample PDF (EN)',
    downloadJa: 'Download sample PDF (JA)',
    cliLabel: 'Render your document with this template:',
    prev: 'Previous template',
    next: 'Next template',
    tutorialLink: 'Learn more in the tutorial: Templates, Logos, Assets, and Fonts',
    lightbox: { close: 'Close', prev: 'Previous page', next: 'Next page' },
    pageAlt: (template: string, lang: string, page: number) =>
      `${template} template (${lang === 'ja' ? 'Japanese' : 'English'} sample) — page ${page}`,
  },
  templateDescriptions: {
    academic: 'papers and research reports',
    book: 'long documents and books',
    compact: 'space-efficient',
    default: 'neutral',
    notebook: 'warm and casual',
    pfn: 'corporate documents',
    technical: 'dense layout for documents centered on code',
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
    body: 'Use the home page or template gallery to find what you need.',
    home: 'Go to the home page',
    gallery: 'Browse the template gallery',
  },
};
