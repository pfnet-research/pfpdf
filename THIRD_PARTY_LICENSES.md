# Third-party licenses

pfpdf bundles or depends on the following third-party software. Versions are
pinned in `package-lock.json`.

| Component | Role | License | Source |
|---|---|---|---|
| Vivliostyle CLI (`@vivliostyle/cli`) | PDF rendering (child process) | AGPL-3.0 | https://github.com/vivliostyle/vivliostyle-cli |
| Chromium | Browser engine managed by Vivliostyle CLI | BSD-3-Clause and others | https://www.chromium.org/ |
| MathJax (`mathjax-full`) | TeX math rendering (build-time SVG) | Apache-2.0 | https://github.com/mathjax/MathJax-src |
| Mermaid / isomorphic-mermaid | Mermaid diagram rendering (build-time SVG) | MIT | https://github.com/mermaid-js/mermaid / https://github.com/tani/isomorphic-mermaid |
| highlight.js / lowlight | Code highlighting | BSD-3-Clause / MIT | https://github.com/highlightjs/highlight.js |
| Noto Sans JP (`@fontsource/noto-sans-jp`) | Bundled Japanese font | SIL OFL 1.1 | https://fonts.google.com/noto |
| Noto Sans (`@fontsource/noto-sans`) | Bundled multilingual fallback font | SIL OFL 1.1 | https://fonts.google.com/noto |
| Noto Sans script fonts (`@fontsource/noto-sans-{arabic,armenian,bengali,ethiopic,georgian,gujarati,gurmukhi,hebrew,kannada,khmer,kr,lao,malayalam,myanmar,sinhala,tamil,telugu,thai}`) | Bundled script-specific fallback fonts | SIL OFL 1.1 | https://fonts.google.com/noto |
| Noto Serif JP (`@fontsource/noto-serif-jp`) | Bundled Japanese serif font | SIL OFL 1.1 | https://fonts.google.com/noto |
| Noto Serif (`@fontsource/noto-serif`) | Bundled multilingual serif fallback font | SIL OFL 1.1 | https://fonts.google.com/noto |
| Noto Serif script fonts (`@fontsource/noto-serif-{armenian,bengali,devanagari,ethiopic,georgian,gujarati,gurmukhi,hebrew,kannada,khmer,kr,lao,malayalam,myanmar,sinhala,tamil,telugu,thai}`) | Bundled script-specific serif fallback fonts | SIL OFL 1.1 | https://fonts.google.com/noto |
| Noto Naskh Arabic (`@fontsource/noto-naskh-arabic`) | Bundled Arabic serif fallback font | SIL OFL 1.1 | https://fonts.google.com/noto |
| Noto Sans Mono (`@fontsource/noto-sans-mono`) | Bundled monospace font | SIL OFL 1.1 | https://fonts.google.com/noto |
| Noto Sans Symbols 2 (`@fontsource/noto-sans-symbols-2`) | Bundled symbol fallback font | SIL OFL 1.1 | https://fonts.google.com/noto |
| Noto Emoji (`@fontsource/noto-emoji`) | Bundled monochrome emoji fallback font | SIL OFL 1.1 | https://fonts.google.com/noto |
| unified / remark / rehype ecosystem | Markdown / HTML processing | MIT | https://unifiedjs.com/ |
| remark-cjk-friendly | CJK-friendly emphasis delimiters | MIT | https://github.com/tats-u/markdown-cjk-friendly |
| pdf-lib | PDF structural validation and metadata | MIT | https://github.com/Hopding/pdf-lib |
| Citation.js (`@citation-js/core`, `@citation-js/plugin-bibtex`, `@citation-js/plugin-csl`) | BibTeX / BibLaTeX parsing and CSL integration | MIT | https://github.com/citation-js/citation-js |
| citeproc-js (`citeproc`) | CSL citation and bibliography formatting | CPAL-1.0 OR AGPL-1.0 | https://github.com/Juris-M/citeproc-js |
| NLM/Vancouver CSL style (bundled by Citation.js) | Numeric bibliography style | CC BY-SA 3.0 | https://github.com/citation-style-language/styles |

Notes:

- Vivliostyle CLI is invoked as a separate child process; pfpdf itself is MIT.
- The bundled fonts are redistributed unmodified under the SIL Open Font
  License 1.1. The OFL permits embedding in documents.
- No logos or non-redistributable assets are bundled.
