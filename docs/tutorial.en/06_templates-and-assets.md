# 6. Templates, Logos, Assets, and Fonts

## 6.1 Bundled templates

pfpdf ships with seven bundled templates.

| template | Description |
|---|---|
| `academic` | A restrained design for papers and research reports, with a Noto Serif JP serif body and an emphasis on tables, math, and figure captions |
| `book` | A calm design for tutorials, textbooks, and long manuals meant to be read chapter by chapter |
| `compact` | A design for meeting materials, internal memos, and short reports that keeps page counts low, with no standalone cover page, narrow margins, and a two-column table of contents |
| `default` | A neutral, general-purpose design and the default choice |
| `notebook` | A warm, casual design for notes, planners, and booklets |
| `pfn` | A design for corporate documents. No logo is bundled; you supply one yourself |
| `technical` | A dense design for technical documents that lays out code, tables, and long identifiers for readability |

Normally, select a template by writing `template` in the front matter of the first Markdown file.

```md
---
title: Quarterly Report
template: pfn
---
```

Pass `--template` when you temporarily want a different appearance. The CLI selection overrides front matter.

If you are unsure which template to choose, use `default` for general-purpose documents. Choose `compact` for short handouts or reference memos, `book` for long documents read chapter by chapter, `notebook` for approachable teaching materials, and `pfn` for branded official documents. The `academic` template suits papers and survey reports, while `technical` suits design documents and API specifications.

To make chapter boundaries clear, `book` starts a new page at every H1, even for short chapters. If you want to keep the page count down, use `default` or `compact`.

Bundled templates never add strings you did not specify, such as publication names, document types, brand names, or table-of-contents titles. To display a series name across all templates, set `series` in the front matter. Its position and typeface vary by template, and when it is omitted the display area itself is removed.

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --template pfn
```

Front matter can select bundled templates only. CLI `--template SOURCE` and environment variable `PFPDF_TEMPLATE` use a bundled preset on an exact preset-name match and otherwise treat the value as a local directory or Git locator. Use `--template-preset` / `PFPDF_TEMPLATE_PRESET` to explicitly require a preset. The complete template precedence is the built-in `default`, front matter, environment variables, then CLI arguments.

## 6.2 Injecting a logo

Bundled templates include no logo image. To put one on the cover or elsewhere, select a local file or Git locator you have the rights to use with `--logo` / `PFPDF_LOGO`. A custom template can have a default logo by putting a template-relative path in the `src` of its `logo` slot.

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --template pfn --logo assets/logo.png
```

- A relative logo path is resolved against the current directory
- Without an explicit logo, the template's default `src` is used. If it has none, the logo area itself is removed, leaving no broken-image placeholder
- If specifying the logo for every run in a repository is tedious, record `--logo` in a Makefile or CI workflow, or set `PFPDF_LOGO`
- To temporarily skip an environment or template default logo, pass `--no-logo`

```make
docs.pdf: $(wildcard docs/*.md)
	npx --yes @pfnet-research/pfpdf@0.1.0 --input docs --output $@ \
	  --template pfn --logo assets/logo.png
```

## 6.3 Custom templates

If the bundled templates do not meet your needs, point `--template` to a directory containing these three files:

```text
my-template/
  template.html
  style.css
  vivliostyle.css
```

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --template ./my-template
```

- Custom templates are treated as trusted local code and can run raw HTML and scripts
- The template format carries no compatibility guarantee across versions. To preserve a document's appearance, pin the pfpdf version
- `template.html` must be an HTML document and must specify exactly one insertion point for the body via `data-pfpdf-slot="content"`
- You may also place zero or one of each of the optional slots `title`, `author`, `series`, `date`, `confidential`, `toc`, and `logo`. Unknown slots, duplicate slots, and a missing required `content` slot are errors
- When the table of contents spans multiple pages, a continuation label appropriate to the document language is shown in the running header. To change where it appears in a custom template, reference the `pfpdf-toc-continuation` named string, set by `.pfpdf-toc-continuation-marker` inside the table of contents, from a paged media margin box
- Processed `data-pfpdf-slot` attributes are removed from the assembled HTML. Other trusted attributes are preserved

A minimal `template.html` looks like this. Metadata is inserted safely as child nodes of the slot elements, not by string substitution.

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"></head>
  <body>
    <header>
      <img data-pfpdf-slot="logo">
      <p data-pfpdf-slot="series"></p>
      <h1 data-pfpdf-slot="title"></h1>
    </header>
    <nav data-pfpdf-slot="toc"></nav>
    <main data-pfpdf-slot="content"></main>
  </body>
</html>
```

To provide a default logo, set the `logo` slot to something such as `src="assets/brand/logo.svg"`. `--logo` overrides that `src` with either a local path or Git locator. If an explicit logo is selected for a template that has no `logo` slot, pfpdf raises an error rather than silently ignoring it. When neither a default `src` nor an explicit logo exists, the `logo` slot itself is removed; the same applies to the `author` and `series` slots when those values are not specified. If there is no `toc` slot, the table of contents is inserted at the beginning of `content`.

## 6.4 Git repository sources

A template or logo can be retrieved directly from a subdirectory or file in a Git repository. `//` separates the repository URL from its internal path, and `ref` selects the revision.

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --template 'git::https://github.com/example/pdf-assets.git//templates/corporate?ref=0123456789abcdef0123456789abcdef01234567'
```

This example overrides the default with a logo from another repository.

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --template pfn \
  --logo 'git::ssh://git@example.com/pdf-assets.git//logos/brand/main.svg?ref=v2.0.0'
```

- `PATH` is relative to the repository root, so nested paths such as `templates/brand/print` and `logos/brand/main.svg` work
- A revision can be a branch, tag, or commit. Omitting it fetches remote `HEAD` with a warning. Pin a full commit hash in CI
- Private repositories authenticate through a Git credential helper or SSH agent. Do not embed a token or password in the URL
- Submodules are not fetched. A repository template remains trusted code that can run raw HTML and scripts
- For repeated offline builds, clone the repository ahead of time and pass a local path through `--template` or `--logo`

## 6.5 Local assets

Reference local files such as images and stylesheets with paths relative to the Markdown file (see Chapter 02). Paths may contain spaces and non-ASCII characters. Conversion also works with a read-only input directory.

## 6.6 Fonts

pfpdf includes redistributable Japanese fonts, including Noto Sans CJK JP, and its templates use those fonts by default. Ordinary documents therefore do not depend on system font discovery. Custom or raw CSS can still request an OS-specific family, however, and pfpdf cannot prevent Chromium from discovering it. Documents that require reproducibility should not request OS-specific families from custom or raw CSS.

### Using host fonts

To use fonts installed on the OS, opt in explicitly.

```bash
# Search the OS standard font directories
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --host-fonts

# Add only specific directories (also works without --host-fonts)
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --font-dir ~/my-fonts
```

- `--font-dir` can be specified multiple times
- The corresponding environment variables are `PFPDF_HOST_FONTS=true` and `PFPDF_FONT_DIRS` (entries separated by the OS path separator)
- The CLI's `--no-host-fonts` overrides the environment variable
- The CLI's `--no-font-dirs` clears the environment variable's list of additional directories. It cannot be combined with `--font-dir`
- Specifying font directories only adds available `@font-face` declarations. To actually use a family, request it via `font-family` in a custom template or in the document's CSS. Merely adding a directory never changes the body font automatically

### Caveats for host fonts

- Being technically able to reference a font and being allowed to embed it in a distributed PDF are separate matters. You are responsible for checking each font's license terms
- Fonts determined to prohibit embedding are excluded from the candidates, and if CSS requests such a font and no fallback is possible, that is an input error. Unused candidates and fonts whose restrictions cannot be determined from the file format produce warnings
- The same inspection applies to local and `data:` fonts referenced directly via CSS URLs. `local()` produces a warning because the actual file cannot be identified in advance, so you must verify the usage and embedding rights yourself. For strict builds, use URLs of font files that can be inspected
- Output that uses host fonts depends on the OS and on font updates, so identical appearance across environments is not guaranteed
