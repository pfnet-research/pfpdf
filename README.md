# pfpdf

A command-line tool that turns Markdown documents into print-quality PDFs with
first-class support for Japanese typesetting. It supports GitHub Flavored
Markdown (GFM), cover pages, tables of contents, page breaks, math, code
highlighting, and raw HTML. Rendering uses the
[Vivliostyle CLI](https://github.com/vivliostyle/vivliostyle-cli) and Chromium.

Japanese README: [README.ja.md](README.ja.md)

The official website (template gallery and tutorial) is published with GitHub
Pages from this repository. The `docs` branch is a generated deployment
artifact (a single orphan commit force-pushed by the Pages workflow); do not
edit it or base work on it.

## Quick start

With Node.js and npm installed, no installation step is needed:

```bash
npx @pfnet-research/pfpdf@latest --input document.md --output document.pdf
```

When you pass a directory, pfpdf combines the `*.md` files directly inside it
into a single PDF, ordered by filename:

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf
```

Pin the version in CI and long-lived documentation:

```bash
npx --yes @pfnet-research/pfpdf@0.1.0 --input docs --output docs.pdf
```

> **First run:** pfpdf automatically downloads Chromium for PDF rendering. The
> download may be several hundred megabytes. Subsequent runs use the cached
> browser, and documents that rely only on built-in features such as math and
> code highlighting can then be converted offline.

## Features

- **GFM Markdown** — use standard GitHub syntax for tables, task lists,
  strikethrough, autolinks, nested lists, and more
- **Japanese-friendly emphasis** — `これは**「重要」**です` renders as `<strong>`
  even with adjacent full-width punctuation
- **Math and code highlighting** — `$...$` / `$$...$$` and fenced code blocks
  work with bundled assets
- **BibTeX bibliographies** — point to `.bib` files in front matter and use
  `\cite{key}` for numbered citations, a formatted reference list, and internal
  PDF links; see the [bibliography tutorial](docs/tutorial.en/03_gfm.md#39-bibtex-bibliographies)
- **Raw HTML** — inline and block HTML pass through for trusted documents
- **Templates and logo injection** — a research-oriented `academic`, a
  long-form `book`, a space-efficient `compact`, a neutral `default`, a warm
  and casual `notebook`, a corporate `pfn`, and a dense, code-first `technical`
  template are bundled; select one in front matter and override it from the
  CLI when needed. Logos are never bundled and are injected with
  `--logo PATH` or `PFPDF_LOGO` (when omitted, the logo area is hidden)
- **Redistributable bundled fonts** — no dependency on OS fonts by default;
  host fonts are an explicit opt-in via `--host-fonts` / `--font-dir`
- **Managed rendering** — uses the bundled Vivliostyle CLI and its standard
  browser management, with an optional explicit browser path

## Supported environments

| OS / architecture | Support level |
|---|---|
| macOS aarch64 (Apple Silicon) | Primary |
| Linux x86_64 | Primary |
| Windows x86_64 | Additional |
| Linux aarch64 | Additional |

CI verifies PDF generation with a real browser in all four environments. The
minimum Node.js version and the pinned Vivliostyle CLI, browser, and font
versions are recorded in `package.json` and `package-lock.json`.

On Linux, Chromium requires additional system libraries. See the
[tutorial troubleshooting chapter](docs/tutorial.en/08_troubleshooting.md) and
run:

```bash
npx @pfnet-research/pfpdf@latest --doctor
```

## Trust model (important)

pfpdf converts **trusted documents of your own**.

- Raw HTML and `<script>` elements run as-is in the browser during conversion;
  pfpdf does not sanitize or sandbox them
- Documents can reference any local file readable by the pfpdf process and may
  access remote resources
- Do not convert Markdown from untrusted sources
- You are responsible for the availability and reproducibility of remote
  resources

See [SECURITY.md](SECURITY.md) and the
[design security chapter](docs/design.en/08_security.md).

## Documentation

The Japanese documents are canonical; English translations mirror the same
structure.

| Document | Japanese | English |
|---|---|---|
| Tutorial | [docs/tutorial.ja/](docs/tutorial.ja/) | [docs/tutorial.en/](docs/tutorial.en/) |
| Design | [docs/design.ja/](docs/design.ja/) | [docs/design.en/](docs/design.en/) |

PDF versions are attached to each GitHub Release. To build them locally, run
`make docs`.

## License

New pfpdf code is distributed under the [MIT License](LICENSE). Licenses for
bundled and dependent third-party software—including Vivliostyle CLI under
AGPL-3.0, MathJax, highlight.js, and the bundled fonts—are listed in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and
[SECURITY.md](SECURITY.md) for vulnerability reporting.
