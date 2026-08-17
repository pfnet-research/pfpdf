# 3. Writing GFM

pfpdf uses GitHub Flavored Markdown (GFM). Standard GFM syntax works as written, and every construct in this chapter is rendered directly in this PDF.

## 3.1 Headings and paragraphs

Markdown headings from `#` to `######` are supported. Each heading gets an anchor that is unique in source order, and all six levels appear in the table of contents. Headings with the same text get `-2`, `-3` suffixes. `h1` through `h6` elements written directly in raw HTML are not included in the automatic table of contents; give them an explicit `id` if you want to use them as link targets.

## 3.2 Emphasis

*Emphasis*, **strong emphasis**, ~~strikethrough~~, and valid nesting (***strong + emphasis***) are all supported.

### Japanese emphasis

You can use `**` directly in Japanese prose. It converts correctly even when adjacent to full-width punctuation or brackets.

- これは**重要**です。
- これは**「強調表示」**の例です。
- これは**重要な点。**続きのテキストも書けます。
- ここは**（重要事項）**です。

You rarely need to write `<strong>` tags; use `**` whenever GFM can express the emphasis you need.

## 3.3 Lists

Nested lists, numbered lists, and task lists are all supported.

- Fruits
  - Apples
  - Mandarins
    1. Satsuma mandarin
    2. Ponkan
- Vegetables

- [x] A completed task
- [ ] An incomplete task

## 3.4 Tables

For tables, prefer GFM table syntax over raw HTML. Column alignment can also be specified.

| Item | Left | Center | Right |
|---|:---|:---:|---:|
| A | left | center | 100 |
| B | left | center | 2,000 |

## 3.5 Links and images

- Inline links: [Vivliostyle](https://vivliostyle.org/)
- Autolinks: a bare URL such as https://commonmark.org/ becomes a link
- Images: use a relative path, as in `![Alt text](assets/example.svg)`

![Sample image](assets/example.svg)

### Long URLs and identifiers

pfpdf automatically adds display-only line-break opportunities to URLs, email addresses, paths, and snake_case, kebab-case, or camelCase identifiers that contain at least 16 graphemes. It prefers breaks at `/` and `?` in URLs, `.` in hostnames, and separators in identifiers. It does not add whitespace or zero-width characters to link targets or copied text.

https://example.invalid/reports/2026/very-long-document-name?format=print&language=en

Inline code, code blocks, math, and the contents of `kbd` and `samp` are excluded, since exact preservation takes priority there. Long lines of code are displayed using the template's existing wrapping rules.

## 3.6 Quotes and code

> This is a blockquote.
> It can span multiple lines.

Wrap inline code in `` `backticks` ``. See Chapter 05 for code blocks.

## 3.7 Horizontal rules

`---` or `***` produces a horizontal rule (thematic break).

---

An unindented, standalone `___` line is reserved for page breaks in pfpdf (see Chapter 02), so it cannot be used as a horizontal rule. It is not treated as page-break syntax when it appears inside a blockquote or list, when it has surrounding whitespace, or when it contains four or more underscores.

## 3.8 GitHub features not part of GFM

Some features rendered by GitHub.com belong to the GitHub service rather than the GFM specification. pfpdf does not convert the following:

- `@user` mentions and `#123` issue / pull request references
- emoji shortcodes such as `:smile:`
- alerts such as `> [!NOTE]`

Mermaid is supported as a dedicated pfpdf extension; see the `mermaid` fenced code block in Chapter 05. For anything else, express it with raw HTML (Chapter 04) or images.

## 3.9 BibTeX bibliographies

Specify `.bib` files in the front matter of the first Markdown file. Relative paths are resolved against the directory containing the Markdown file that holds the front matter. Multiple files can be given as a list.

```yaml
---
title: Survey Report
bibliography:
  - bibliography/references.bib
---
```

In the body, cite BibTeX keys with the same `\cite` command as in TeX. Separate multiple keys with commas.

```md
See the prior work\cite{smith2024} and the comparative studies\cite{smith2024,tanaka2025}.
```

Citations appear as numbers such as `[1]` and link to the corresponding bibliography entries in the PDF. To choose where the bibliography appears, place `\printbibliography` on a top-level line by itself. Add an ordinary Markdown heading immediately before it to include the bibliography in the table of contents.

```md
# References

\printbibliography
```

If `\printbibliography` is omitted, the list is appended at the end of the document. A `\cite` inside inline code, code blocks, raw HTML, or math is not interpreted as a citation, so literal usage examples can be written in inline code like `` `\cite{key}` ``. To escape a `\cite` with a backslash instead, write `\\cite{key}`.

The initial version supports BibTeX / BibLaTeX `.bib` files with a numeric style. Nonexistent keys, duplicate keys, invalid BibTeX, and unreadable files cause a failure with exit code `2`, without generating a partial PDF. TeX's `\ref` is not a bibliography citation; it is reserved for future figure / table / equation / section references.
