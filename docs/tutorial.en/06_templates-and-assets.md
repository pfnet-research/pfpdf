# 6. Templates, Logos, Assets, and Fonts

<style>
@media print {
  h2[id="61-bundled-templates"] + p + table :is(th, td):first-child { min-width: 8em; }
}
</style>

## 6.1 Bundled templates

pfpdf ships with seven bundled templates. Choose one based on its uses and features.

| Template | Main uses | Features |
|---|---|---|
| `academic` | Papers, research reports, survey reports | A restrained design with serif body text in Noto Serif JP and an emphasis on tables, math, and figure captions |
| `book` | Tutorials, textbooks, long manuals | A calm design for reading chapter by chapter |
| `compact` | Meeting materials, internal memos, short reports and handouts, reference memos | A design that keeps page counts low with no standalone cover page, narrow margins, and a two-column table of contents |
| `default` | General-purpose documents | A neutral design and the default template |
| `notebook` | Notes, planners, booklets, approachable teaching materials | A warm, casual design |
| `pfn` | Corporate documents, branded official documents | No logo image is bundled; you supply one yourself |
| `technical` | Technical documents, design documents, API specifications | A dense design that lays out code, tables, and long identifiers for readability |

To make chapter boundaries clear, `book` is designed to start each H1 on a new page, even for short chapters. In the current version, displaying the table of contents disables this automatic page break for H1s in the first Markdown file. To reduce the page count, use `default` or `compact`.

Normally, select a template by writing `template` in Markdown front matter. With multiple files, the first supplied value is used.

```md
---
title: Quarterly Report
template: pfn
---
```

Pass `--template` when you temporarily want a different appearance. The CLI selection overrides front matter.

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --template pfn
```

Front matter can select bundled templates only. CLI `--template SOURCE` treats an exact match for a bundled preset name as that preset, and any other value as a local directory or Git locator. Use `--template-preset` to explicitly select a bundled preset. The built-in `default` is overridden by front matter, which is overridden by CLI arguments.

Bundled templates never add strings you did not specify, such as publication names, document types, brand names, or table-of-contents titles. To display a series name across all bundled templates, set `series` in the front matter. Its position and typeface vary by template. If `series` is omitted, its display area is removed.

To omit the cover, use front matter `cover: false` or CLI `--no-cover`. `--cover` overrides a front-matter setting that hides the cover. Cover visibility is independent of the table-of-contents settings `toc` / `--no-toc`.

```bash
pfpdf --input report.md --output report.pdf --no-cover --no-toc
```

When the cover is hidden, `compact` omits the leading document header. The author, date, series name, and logo on the cover are hidden, while PDF metadata and the template's Confidential and series text in running headers and footers are preserved.

To control cover visibility in a custom template, put the entire cover in an element marked `data-pfpdf-slot="cover"`. Keep the `content` / `toc` slots and custom running elements outside `cover`. This setting does not change the display of a custom template without a `cover` slot.

## 6.2 Specifying a logo

Bundled templates include no logo image. Normally, select a local file you have the rights to use in Markdown front matter. Relative paths are based on the parent directory of the Markdown file that first supplies `logo`.

```md
---
title: Quarterly Report
template: pfn
logo: assets/logo.png
---
```

`logo: false` hides the logo, including any template default. Use CLI `--logo` to retrieve a logo from a Git locator or to temporarily override the selection.

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --template pfn --logo assets/logo.png
```

- A relative logo path specified on the CLI is resolved against the current directory
- Without an explicit logo, the template's default `src` is used. If it has none, the logo area itself is removed, leaving no broken-image placeholder
- To temporarily skip a front matter or template default logo, pass `--no-logo`
- If you consistently use a logo managed in a repository, record `--logo` in a Makefile or CI workflow

```make
docs.pdf: $(wildcard docs/*.md)
	npx --yes @pfnet-research/pfpdf@0.4.0 --input docs --output $@ \
	  --template pfn --logo assets/logo.png
```

## 6.3 Custom templates

If the bundled templates do not meet your needs, use `--template` to specify your own template directory. Put these three files in it:

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
- You may also place zero or one of each optional slot: `cover`, `title`, `author`, `series`, `date`, `confidential`, `toc`, and `logo`. Unknown slots, duplicate slots, and a missing required `content` slot are errors
- When the table of contents spans multiple pages, a continuation label in the document's language is shown in the running header. To change its position in a custom template, reference the named string `pfpdf-toc-continuation` from a paged media margin box. The string is set by `.pfpdf-toc-continuation-marker` inside the table of contents
- Processed `data-pfpdf-slot` attributes are removed from the assembled HTML. Other attributes in the trusted input are preserved

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

To provide a default logo, add a `src` attribute to the `logo` slot, such as `src="assets/brand/logo.svg"`. This path is relative to the template directory. `--logo` overrides that `src` with either a local path or Git locator.

- If an explicit logo is selected for a template that has no `logo` slot, pfpdf raises an error rather than silently ignoring it
- When neither a default `src` nor an explicit logo exists, the `logo` slot itself is removed from the output
- If `author` or `series` is not specified, its corresponding slot is removed as well
- If there is no `toc` slot, the table of contents is inserted at the beginning of `content`

## 6.4 Git repository sources

A template can be retrieved directly from a subdirectory in a Git repository, and a logo from a file. `//` separates the repository URL from its internal path, and `ref` selects the revision.

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

- The path within the repository is relative to its root. It can specify a subdirectory such as `templates/brand/print` or a file such as `logos/brand/main.svg`
- A revision can be a branch, tag, or commit. Omitting it fetches remote `HEAD` with a warning. Pin a full commit hash in CI
- Private repositories authenticate through a Git credential helper or SSH agent. Do not embed a token or password in the URL
- Submodules are not fetched. A repository template remains trusted code that can run raw HTML and scripts
- For repeated offline builds, clone the repository ahead of time and pass a local path through `--template` or `--logo`

## 6.5 Local assets

Reference local files such as images and stylesheets with paths relative to the Markdown file's parent directory (see Chapter 2). Paths may contain spaces and Japanese characters. Conversion also works with a read-only input directory.

## 6.6 Fonts

pfpdf includes redistributable Japanese fonts, including Noto Sans JP, and its bundled templates explicitly select those fonts by default. Ordinary documents therefore do not depend on system font discovery.

If custom CSS or CSS written directly in the document requests an OS-specific font family, pfpdf cannot prevent Chromium from discovering it. For documents that require reproducibility, do not request these families.

### Using host fonts

To use fonts installed on the OS, enable them explicitly through the CLI.

```bash
# Search the OS standard font directories
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --host-fonts

# Add only specific directories (also works without --host-fonts)
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --font-dir ~/my-fonts
```

- `--font-dir` can be specified multiple times
- Specifying font directories adds available `@font-face` declarations. Select the family you want to use with `font-family` in a custom template or in the document's CSS. Adding a directory does not automatically change the body font

### Caveats for host fonts

- Being technically able to reference a font and being allowed to embed it in a distributed PDF are separate matters. You are responsible for checking each font's license terms
- When scanning font directories, pfpdf excludes fonts whose metadata indicates that embedding is prohibited and issues a warning. During these scans, it currently also excludes WOFF2 files and warns that it cannot inspect their metadata
- Chapter 4 of the design document requires an input error when CSS requests a font for which embedding is prohibited and no fallback is possible. It also requires inspection of local and `data:` fonts referenced directly through CSS URLs, and a warning for `local()` because the actual file cannot be identified in advance. The current implementation does not perform these checks or issue these warnings
- For fonts referenced directly from CSS, you must also verify the usage and embedding rights yourself. For strict builds, use URLs to font files you have inspected beforehand
- Output that uses host fonts depends on the OS and on font updates, so identical appearance across environments is not guaranteed
