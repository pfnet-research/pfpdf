---
title: pfpdf Tutorial
author: pfpdf maintainers
page_size: A4
lang: en
dir: ltr
---

# pfpdf Tutorial

This tutorial takes you from initial setup to generating PDFs from Markdown with pfpdf. Each chapter is also a working pfpdf input example: pass the entire directory to pfpdf to produce the PDF you are reading now.

```bash
npx pfpdf@latest --input docs/tutorial.en --output tutorial.en.pdf
```

## Chapters

| Chapter | Contents |
|---|---|
| 01 | Getting started: installation and your first PDF |
| 02 | Document structure: front matter and multiple files |
| 03 | Writing GFM |
| 04 | Raw HTML |
| 05 | Math and code highlighting |
| 06 | Templates, logos, assets, and fonts |
| 07 | CLI and renderers |
| 08 | Troubleshooting |

For the detailed specification and the reasoning behind major design decisions, see the English design documents in `docs/design.en/`. A Japanese version of this tutorial is available in `docs/tutorial.ja/`.
