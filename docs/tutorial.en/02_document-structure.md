# 2. Document Structure

## 2.1 Front matter

Write document metadata and settings as YAML front matter at the top of a Markdown file. With multiple files, the first supplied value for each key takes precedence.

```md
---
title: Quarterly Report
author: Taro Yamada
series: Technical Report Series
template: pfn
toc: true
cover: true
logo: assets/logo.svg
date: 2026-08-01
page_size: A4
confidential: false
lang: en
dir: ltr
---
```

The following table lists eight metadata fields and the `template` / `toc` / `cover` / `logo` document settings. The `bibliography` key described in Chapter 03 is also accepted as a build input. Other keys produce warnings on stderr and are ignored by default. Duplicate keys, invalid YAML, and invalid types or values of known keys are errors.

For example, you can keep `tags` or `status` intended for other tools when building a PDF. Typos such as `page_szie` also produce warnings, so check that the intended settings took effect. To treat unknown keys as errors, pass the CLI flag `--strict-front-matter`.

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --strict-front-matter
```

The unknown-key warnings and strict validation also apply to `--print-effective-config --input docs` and `--doctor --input docs`. Since `--strict-front-matter` is a runtime setting, it cannot be set in front matter.

| Key | Type | Default | Description |
|---|---|---|---|
| `title` | string | inferred from H1, then input name | Document title. Explicit values can use `<br>` for line breaks |
| `subtitle` | string | none | Subtitle, shown below the title on the cover of every bundled template |
| `author` | string | none | Author name |
| `series` | string | none | Series name, shown as a primary label in every bundled template |
| `template` | bundled template name | `default` | Bundled template used for the document |
| `toc` | boolean | `true` | Whether to generate a table of contents |
| `cover` | boolean | `true` | Whether to display the cover or leading document header |
| `logo` | path string / `false` | template default | Cover logo. `false` displays no logo |
| `date` | string | run date | Date shown on the cover |
| `page_size` | keyword / dimensions | `A4` | Page size |
| `confidential` | boolean | `false` | When `true`, shows a Confidential mark on every page |
| `lang` | string (BCP 47 language tag) | `ja` / `en` inferred from prose | Document language. Used for the HTML `lang` attribute, typesetting, and font selection |
| `dir` | `ltr` / `rtl` / `auto` | `auto` | Text direction of the document. Used for the `dir` attribute of the HTML root element |

- Title precedence is `--title` → first front matter `title` in input order → first non-empty top-level H1 in input order → input name. Both `# Heading` and Setext H1s qualify; headings inside quotes, lists, code, raw HTML blocks, or footnote definitions do not. The body heading is retained
- pfpdf removes H1 formatting and flattens the title into one line, using link text, code / math source, and image alt text. Without an H1, it uses the filename without `.md` for a single file or the directory name for directory input. If the input name is empty or contains only whitespace and line breaks, it uses `document`. It does not reinterpret `<br>` or character references in inferred values
- An empty string, a value of an invalid type, or disallowed HTML in an explicit `title` causes an input error (exit code `2`), even when title inference or a CLI override is available
- Front matter `template` must be one of `academic` / `book` / `compact` / `default` / `notebook` / `pfn` / `technical`. The CLI's `--template` / `--template-preset` override front matter
- Relative `logo` paths are resolved from the directory containing the front matter Markdown. Front matter accepts only local files; use `--logo` for a Git repository source
- If `subtitle` or `series` is omitted, its display area is removed entirely. The bundled templates never fill it with a fixed publication name, document type, brand name, or boilerplate label
- To break the title across lines on the cover, use `<br>`, as in `title: "Long Title<br>Subtitle"`. The only HTML element allowed is an attribute-free `br` element, with spellings such as `<br>` / `<br/>` / `<BR />`
- The front matter is parsed as a YAML mapping. pfpdf uses only the keys in the table above and the `bibliography` key described in Chapter 03. Supply each key's value using the type listed in the table. You can write complex YAML values, but they are not used as metadata
- If the first line of a source file is `---`, pfpdf treats it as a front matter delimiter and requires a closing `---` or `...` in that file. Front matter is removed from the body of every file. To place a horizontal rule at the top of a file, use `***`
- The `page_size` keywords are `A3` / `A4` / `A5`, `JIS-B4` / `JIS-B5`, `ISO-B4` / `ISO-B5`, and `Letter` / `Legal`. The ambiguous `B4` / `B5` are not allowed. You can also specify an explicit width and height, such as `210mm 297mm`
- An explicit BCP 47 language tag such as `lang: en` / `lang: ja-JP` always wins. When omitted, pfpdf infers Japanese or English from prose across all input files without using the host locale. It counts kana, Han, and Latin characters and selects `ja` if any of the following conditions hold; otherwise it selects `en`
  - At least two hiragana are present and make up at least 1% of the counted characters
  - Kana is present, and the combined count of kana and Han characters is at least the count of Latin characters
  - Han characters outnumber Latin characters

  Code, math, raw HTML blocks, and URLs are excluded. If no counted prose characters remain, pfpdf uses the title. Specify `lang` for short or multilingual documents
- For right-to-left documents you can specify `dir: rtl`, and for left-to-right documents, `dir: ltr`. With `auto`, the browser determines the direction from the document content; it does not guess the direction from `lang` or the host locale alone
- If the leading language subtag of `lang` is `ja`, the automatically generated date uses Japanese formatting, as in `2026 年 8 月 3 日`; otherwise it uses the format `2026-08-03`. A `date` string written in the front matter is never rewritten

## 2.2 Combining multiple files

When the input is a directory, pfpdf combines the `*.md` files directly inside it in filename order.

- Every file may have front matter. Document-wide metadata and settings retain the first supplied value for each key in sort order; later files fill unset keys. A later file can supply `title` even if the first file has no front matter. To replace an existing value for one invocation, use its corresponding CLI option
- pfpdf searches for an H1 only if no file supplies an explicit `title`. A later file's explicit `title` overrides an earlier file's H1. Without an H1 either, it uses the input directory name rather than the first filename
- `false` also counts as a supplied value. A `bibliography` list is selected as one value and is never concatenated with later files' lists
- Front matter in every file is checked for valid YAML and valid types and values of known keys, regardless of which values are selected. Unknown keys produce warnings, or errors with `--strict-front-matter`. For unselected `logo` / `bibliography` values, pfpdf neither checks the referenced files' existence nor opens them. A selected relative path is resolved from the parent directory of the file that first supplies that key
- Only the lowercase `.md` extension is accepted
- Save files as UTF-8 (a leading BOM and CRLF line endings are accepted)
- Each file is parsed as independent Markdown. Code fences, lists, raw HTML blocks, and reference link definitions cannot continue into the next file. Keep each of these constructs within one file

## 2.3 Links between files

Relative links to Markdown files combined into the same document become internal PDF links when they contain no query string. Without a fragment, the link goes to the beginning of the target file. You can use either Markdown syntax or raw HTML `<a href>` elements.

```md
See [Chapter 03](03_gfm.md) for details.
```

To jump directly to a heading in another file, add the heading's ID as a fragment (the part of a URL after `#`). When the same heading appears more than once in the document, IDs for the second and later occurrences receive suffixes such as `-2` and `-3`. Use the actual generated ID in the link.

```md
See [the tables section](03_gfm.md#34-tables).
```

Links to headings within the same document also work.

```md
See [the front matter section](#21-front-matter).
```

Relative links with query strings, links to `.md` files outside the combined document, and links to other local files are passed to the renderer without rewriting. pfpdf does not check whether link targets or specified fragments exist, so provide references that can be opened in the PDF's viewing environment. Use HTTP(S) URLs for files that should remain accessible when you distribute the PDF. For a file on a specific computer, you can use an absolute `file:` URL.

## 2.4 Table of contents and page breaks

- A table of contents is generated by default. To disable it, use `toc: false` in front matter; use `--toc` / `--no-toc` for temporary overrides
- PDF bookmarks follow the same heading hierarchy as the table of contents. They remain even when `toc: false` omits the table of contents
- To force a page break, write `___` (three or more consecutive underscores) on a line by itself

```md
The chapter ends here.

___

A new page starts here.
```

`___` is a pfpdf extension. To produce a horizontal rule (thematic break), use `---` or `***`.

A page break starts the next block on a new page. Markers at the very beginning or end of the document are ignored. Consecutive `___` markers are collapsed into a single page break without creating blank pages.

## 2.5 Relative paths for images and other assets

With a Markdown file as input, relative paths are resolved from its parent directory. With a directory as input, they are resolved from the input directory, which directly contains all the Markdown files being combined.

```md
![Architecture diagram](assets/diagram.png)
```

By contrast, relative paths in CLI arguments such as `--input`, `--output`, and `--logo` are resolved from the directory in which you run `pfpdf`.

Local URLs written statically in Markdown, raw HTML, and CSS are resolved through the resource graph, which tracks resource references. Local paths that a script builds from strings at runtime are not automatically exposed. Declare resources with static `src` / `href` / CSS `url()`, or use HTTP(S) URLs.

Use `/` to separate path components in document URLs, regardless of OS. Write a Windows absolute path as a valid URL such as `file:///C:/docs/image.png`, and a UNC path as `file://server/share/...`. Only paths in CLI arguments may use the native path notation of the OS you are running on.

## 2.6 Slides

Set `slides: true` to produce PDF slides. The default aspect ratio is 16:9.

```markdown
---
slides: true
title: Performance Evaluation
subtitle: Measurements from November 2026
---

# Methods

## Measurement Conditions

### Medians of 30 runs each

We processed the same input 30 times for each condition.

## Before and After

::: column
Before: 12 ms.

::: column
After: 10 ms.

::: note
Each value is the median of 30 measurements.

::: talk
Explain the comparison conditions aloud.
```

- A top-level `#` begins a group. A top-level `##` begins a new page and supplies its title. Use `###` and deeper headings within a page. Use `___` to start a page without a title.
- A `###` written directly after a `##` becomes that page's subtitle and appears right below the title. With body text or a `::: name` in between, it stays an ordinary heading. A raw HTML `<h3>` is treated the same way, so put body text before it to keep it as a heading in the body. Set the cover subtitle with `subtitle` in the front matter.
- The cover uses front matter such as the title, author, and date. An omitted title falls back to the input file or directory name. The cover and table of contents are enabled by default. Use `cover: false` or `toc: false` to omit them. A template without a cover slot produces no cover.
- The table of contents comes from `#` headings and is omitted when none are present. `section_covers: true` adds a divider at the start of each group. The table of contents continues on a new page after every five entries.
- `::: name` starts a region, which continues until the next `::: name` or page. Adjacent regions with the same name form one group and, by default, sit side by side from left to right. The `::: column` regions in the example work this way. Names may contain lowercase letters, digits, and `-`.
- Write `::: name` on its own line at the top level of the document. Blank lines before and after it are the safe choice. Directly below a list, a block quote, or a table, a line without a preceding blank line is treated as a continuation of that block. To show a line that reads `::: name` as text, put it in code.
- Choose the look of slides with the same `template` setting as for documents. Every bundled template has a slide variant with the same fonts and colors as its document design. Without `template`, the slide variant of `default` is used. See [chapter 6](06_templates-and-assets.md) for the template list and for how to write a slide variant.
- The selected template defines region names and their appearance. The slide variants of the bundled templates all support `column` for columns, `left` and `right` for two sides with distinct roles, and `note` for a note that is visible on the slide.
- The slide variants of the bundled templates set body text at 24 pt (22 pt in `compact`), page titles at about 36 pt, and the agenda at about 28 pt. To change the body text size of a whole deck, set `slide_font_size` in the front matter to a number of points from 10 to 40, as in `slide_font_size: 20`. Titles, the cover, and the agenda keep their sizes
- To make the body text of one page smaller, write `<!-- pfpdf:size=small -->` at the beginning of the page. In the bundled templates, body text, tables, code, and notes shrink to five sixths. `size=x-small` shrinks them to two thirds. The title and subtitle keep their sizes
- The slide template `slide-base` is deprecated. Selecting it prints a warning, and it will be removed in 0.7.0. Omit `template` or select another bundled template.
- pfpdf itself defines only two names. `::: talk` holds presenter notes, which do not appear in the PDF. `::: body` returns to ordinary slide content.
- To choose how a page looks, write `key=value` options in a comment at the beginning of the page. Examples include `<!-- pfpdf:layout=closing -->` and `<!-- pfpdf:layout=section tone=dark -->`. A value is any text without whitespace and is passed to the template unchanged. The template defines the available keys and values. An option that is not in the `key=value` form is an error.
- A page without a title or content is created only when `layout` is specified, as in `<!-- pfpdf:layout=blank -->`.
- When you use the same source as an ordinary document, pfpdf omits presenter notes and prints the other regions as ordinary body text. A region ends at the next region, top-level ATX `#` or `##`, `___` page break, or the end of the source file in either mode.
- Each slide must fit on one PDF page. If a slide box extends past the page vertically, pfpdf warns that content may be clipped. If the expected pagination fails, pfpdf stops. The layout diagnostic includes the page number and the slide title when available. Check the page and shorten the slide, split it, or reduce its text size if needed.
