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

Select one with `--template` or the `PFPDF_TEMPLATE` environment variable.

If you are unsure which template to choose, use `default` for general-purpose documents. Choose `compact` for short handouts or reference memos, `book` for long documents read chapter by chapter, `notebook` for approachable teaching materials, and `pfn` for branded official documents. The `academic` template suits papers and survey reports, while `technical` suits design documents and API specifications.

To make chapter boundaries clear, `book` starts a new page at every H1, even for short chapters. If you want to keep the page count down, use `default` or `compact`.

Bundled templates never add strings you did not specify, such as publication names, document types, brand names, or table-of-contents titles. To display a series name across all templates, set `series` in the front matter. Its position and typeface vary by template, and when it is omitted the display area itself is removed.

```bash
npx pfpdf@latest --input docs --output docs.pdf --template pfn
```

## 6.2 Injecting a logo

Templates do not include a logo image. If you want a logo on the cover and elsewhere, point `--logo` or the `PFPDF_LOGO` environment variable at a logo file you hold the rights to.

```bash
npx pfpdf@latest --input docs --output docs.pdf \
  --template pfn --logo assets/logo.png
```

- A relative logo path is resolved against the current directory
- If no logo is specified, the logo area is simply not displayed; no broken-image placeholder is left behind
- If specifying the logo for every run in a repository is tedious, record `--logo` in a Makefile or CI workflow, or set `PFPDF_LOGO`
- To temporarily skip the logo in an environment where `PFPDF_LOGO` is set, pass `--no-logo`

```make
docs.pdf: $(wildcard docs/*.md)
	npx --yes pfpdf@0.1.0 --input docs --output $@ \
	  --template pfn --logo assets/logo.png
```

## 6.3 Custom templates

If the bundled templates do not meet your needs, point `--template-dir` to a directory containing these three files:

```text
my-template/
  template.html
  style.css
  vivliostyle.css
```

```bash
npx pfpdf@latest --input docs --output docs.pdf --template-dir my-template
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

If you pass `--logo` but the template has no `logo` slot, pfpdf raises an error rather than silently ignoring the option. If no logo is specified, the `logo` slot itself is removed from the output; the same applies to the `author` and `series` slots when those values are not specified. If there is no `toc` slot, the table of contents is inserted at the beginning of `content`.

## 6.4 Local assets

Reference local files such as images and stylesheets with paths relative to the Markdown file (see Chapter 02). Paths may contain spaces and non-ASCII characters. Conversion also works with a read-only input directory.

## 6.5 Fonts

pfpdf includes redistributable Japanese fonts, including Noto Sans CJK JP, and its templates use those fonts by default. Ordinary documents therefore do not depend on system font discovery. Custom or raw CSS can still request an OS-specific family, however, and pfpdf cannot prevent local Chromium from discovering it. Use the Docker renderer when builds must be strictly isolated from host fonts.

### Using host fonts

To use fonts installed on the OS, opt in explicitly.

```bash
# Search the OS standard font directories
npx pfpdf@latest --input docs --output docs.pdf --host-fonts

# Add only specific directories (also works without --host-fonts)
npx pfpdf@latest --input docs --output docs.pdf --font-dir ~/my-fonts
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
