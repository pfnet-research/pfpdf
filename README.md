# pfpdf

pfpdf is a command-line tool that converts Markdown documents into PDFs with
support for Japanese typesetting. Use it to create technical reports and manuals
with cover pages, tables of contents, equations, and highlighted code.

[日本語](README.ja.md) · [Website](https://pfpdf.preferred.tech/) · [Tutorial](docs/tutorial.en/01_getting-started.md)

<p>
  <a href="https://pfpdf.preferred.tech/gallery/pfn/"><img src="docs/readme/pfn-cover.en.webp" width="30%" alt="A blue cover rendered with the pfn template"></a>
  <a href="https://pfpdf.preferred.tech/gallery/pfn/"><img src="docs/readme/pfn-math.en.webp" width="30%" alt="Equations and a Mermaid diagram rendered with the pfn template"></a>
  <a href="https://pfpdf.preferred.tech/gallery/notebook/"><img src="docs/readme/notebook-code.en.webp" width="30%" alt="A table and highlighted TypeScript code rendered with the notebook template"></a>
</p>

From left: a cover and a body page from the `pfn` template, followed by a table
and code from `notebook`. The [template gallery](https://pfpdf.preferred.tech/gallery/)
shows sample output from all seven bundled templates.

## Create your first PDF

You need Node.js 22.12.0 or later and npm. The `npx` command below downloads and
runs pfpdf.

Save the following as `document.md`. The settings between `---` delimiters
(front matter) specify the title, template, and document language.

```markdown
---
title: Technical report
template: pfn
lang: en
---

# Overview

This PDF is generated with **pfpdf**.
```

Run this command in the directory containing `document.md`:

```bash
npx @pfnet-research/pfpdf@latest --input document.md --output document.pdf
```

The first run needs an internet connection to fetch the npm package and Chromium,
the browser used for PDF rendering. The browser download can be several hundred
megabytes; later runs reuse the cached browser. Rendering uses
[Vivliostyle CLI](https://github.com/vivliostyle/vivliostyle-cli).

Open `document.pdf` to check the result: it contains a cover with the title, a
table of contents, and the body text.

For CI or saved build instructions, pin the package version by replacing `@latest`
with a version such as `@0.2.1`.

## Combine chapters

To write chapters in separate files, put them in a directory such as `chapters/`
and pass that directory to `--input`:

```bash
npx @pfnet-research/pfpdf@latest --input chapters --output report.pdf
```

pfpdf combines `.md` files directly inside the directory in filename order; the
extension must be lowercase. Use names such as `00_title.md`, `01_intro.md`, and
`02_results.md` to set the reading order. Put front matter at the top of the first
file only. See
[document structure](docs/tutorial.en/02_document-structure.md) for links between
chapters, page breaks, and image paths.

## Templates and Markdown

Set `template` in the front matter to choose a design. To try another design for
one conversion, add an option such as `--template notebook` to the command;
command-line arguments override front matter.

The templates come with their default fonts, including Japanese fonts. For custom
templates, logos, or local fonts, see
[templates and assets](docs/tutorial.en/06_templates-and-assets.md).

Use the following tutorial sections as you add content:

| Content | Support and examples |
| --- | --- |
| Tables and task lists | [GitHub Flavored Markdown (GFM)](docs/tutorial.en/03_gfm.md), including strikethrough and emphasis next to Japanese full-width punctuation. |
| Equations, code, and diagrams | [TeX math, syntax highlighting, and Mermaid](docs/tutorial.en/05_math-and-code.md), with bundled rendering assets. |
| Citations and references | [BibTeX bibliographies](docs/tutorial.en/03_gfm.md#39-bibtex-bibliographies), with numbered citations linked to reference entries. |

## Environments and troubleshooting

CI tests PDF generation with a real browser in four environments:

- macOS aarch64 (Apple Silicon)
- Linux x86_64
- Windows x86_64
- Linux aarch64

Linux also needs system libraries for Chromium. If conversion fails, run the
environment check:

```bash
npx @pfnet-research/pfpdf@latest --doctor
```

The check reports problems with Node.js, the browser, and fonts, along with
suggested fixes. See [troubleshooting](docs/tutorial.en/08_troubleshooting.md) for
Linux setup and other conversion errors.

## Input documents

Use pfpdf only with trusted documents. It renders input HTML and executes scripts
as-is, with access to local files readable by pfpdf and to external URLs.

Remote images and other external resources must be available during conversion.
The [security policy](SECURITY.md) describes the trust model and how to report
vulnerabilities.

## Documentation and development

| Document | Japanese | English |
| --- | --- | --- |
| Tutorial: usage and document examples | [Japanese](docs/tutorial.ja/) | [English](docs/tutorial.en/) |
| Design: specification and design decisions | [Japanese](docs/design.ja/) | [English](docs/design.en/) |

The Japanese documents are the source for the specification and usage; the English
documents are translations. Each GitHub Release includes all four PDFs. To build
them locally or contribute changes, follow the setup instructions in
[Contributing](CONTRIBUTING.md), then run `make docs`.

See the [CLI reference](docs/tutorial.en/07_cli-and-renderers.md) for all options.

## License

pfpdf's code is released under the [MIT License](LICENSE). Dependencies and bundled
assets have their own licenses, including AGPL-3.0 for Vivliostyle CLI. See
[third-party licenses](THIRD_PARTY_LICENSES.md) for the list.
