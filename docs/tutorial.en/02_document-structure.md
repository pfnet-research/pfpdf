# 2. Document Structure

## 2.1 Front matter

Write document metadata as YAML front matter at the top of the first Markdown file.

```md
---
title: Quarterly Report
author: Taro Yamada
series: Technical Report Series
template: pfn
toc: true
logo: assets/logo.svg
date: 2026-08-01
page_size: A4
confidential: false
lang: en
dir: ltr
---
```

The following nine keys are available as document metadata. The `toc` / `logo` document settings and the `bibliography` build-input key described in Chapter 03 are also accepted. All other unknown keys, and duplicate keys, are errors.

| Key | Type | Default | Description |
|---|---|---|---|
| `title` | string | none (required) | Document title. On the cover, lines can be broken with `<br>` |
| `author` | string | none | Author name |
| `series` | string | none | Series name shown in the primary label position of every bundled template |
| `template` | bundled template name | `default` | Bundled template used for the document |
| `toc` | boolean | `true` | Whether to generate a table of contents |
| `logo` | path string / `false` | template default | Cover logo. `false` displays no logo |
| `date` | string | run date | Date shown on the cover |
| `page_size` | keyword / dimensions | `A4` | Page size |
| `confidential` | boolean | `false` | When `true`, shows a Confidential mark on every page |
| `lang` | BCP 47 string | `ja` | Document language. Used for the HTML `lang` attribute, typesetting, and font selection |
| `dir` | `ltr` / `rtl` / `auto` | `auto` | Text direction of the document. Used for the `dir` attribute of the HTML root |

- `title` is required. Write it in the front matter or pass it with `--title`. If it appears in neither, that is an error (exit code `2`)
- Front matter `template` must be one of `academic` / `book` / `compact` / `default` / `notebook` / `pfn` / `technical`. The CLI's `--template` / `--template-preset` override front matter
- Relative `logo` paths are resolved from the directory containing the front matter Markdown. Front matter accepts only local files; use `--logo` for a Git repository source
- If `series` is omitted, the series display area is removed entirely. The bundled templates never fill it with a fixed publication name, document type, brand name, or boilerplate label
- To break the title across lines on the cover, use `<br>`, as in `title: "Long Title<br>Subtitle"`. The only tags allowed are `<br>` / `<br/>`
- The front matter is parsed as a YAML mapping. pfpdf uses only the keys in the table above and the `bibliography` key described in Chapter 03; each metadata key must have the type listed in the table. You can write complex YAML values, but they are not used as metadata
- If the first line of a source file is `---`, pfpdf treats it as a front matter delimiter. The first file must contain a closing `---` or `...`; the same opening delimiter in any later file is an error because it would introduce duplicate front matter. To place a horizontal rule at the top of a file, use `***`
- The `page_size` keywords are `A3` / `A4` / `A5`, `JIS-B4` / `JIS-B5`, `ISO-B4` / `ISO-B5`, and `Letter` / `Legal`. The ambiguous `B4` / `B5` are not allowed. You can also specify an explicit width and height, such as `210mm 297mm`
- For an English document, specify a BCP 47 language tag such as `lang: en`. When omitted, the default is `ja` regardless of the host language
- For right-to-left documents you can specify `dir: rtl`, and for left-to-right documents, `dir: ltr`. With `auto`, the browser determines the direction from the document content; it does not guess the direction from `lang` or the host locale alone
- If the primary language of `lang` is `ja`, the automatically generated date is rendered in Japanese style, as in `2026 年 8 月 3 日`; otherwise it uses the fixed `2026-08-03` format. A `date` string written in the front matter is never rewritten

## 2.2 Combining multiple files

When the input is a directory, pfpdf combines the `*.md` files directly inside it in filename order.

- Front matter may appear in exactly one place: at the top of the first file in order. A `---` front matter block in any later file is an error
- Only the lowercase `.md` extension is accepted
- Save files as UTF-8 (a leading BOM and CRLF line endings are accepted)
- Each file is parsed as independent Markdown. Code fences, lists, raw HTML blocks, and reference link definitions cannot continue into the next file. Close any syntax that would otherwise span chapters within a single file

## 2.3 Links between files

Relative links to Markdown files in the same document—whether written in Markdown syntax or as raw HTML `<a href>` elements—become internal links to the beginning of the target file in the generated PDF. A link to a nonexistent file is an input error.

```md
See [Chapter 03](03_gfm.md) for details.
```

To jump directly to a heading in another file, add a fragment. When the same heading text appears more than once, the second and later anchors get `-2`, `-3`, and so on, so specify the ID that is actually rendered.

```md
See [the tables section](03_gfm.md#34-tables).
```

Links to headings within the same document also work.

```md
See [the front matter section](#21-front-matter).
```

Relative links to local files other than `.md`, such as a spreadsheet distributed with the PDF, are rejected because they stop working when the conversion server shuts down. Use HTTP(S) URLs for portable links. Use an explicit, absolute `file:` URL only when the link is intentionally specific to one machine.

## 2.4 Table of contents and page breaks

- A table of contents is generated by default. Normally disable it with `toc: false` in front matter; use `--toc` / `--no-toc` for temporary overrides
- To force a page break, write `___` (three underscores) on a line by itself

```md
The chapter ends here.

___

A new page starts here.
```

`___` is a pfpdf extension. To produce a horizontal rule (thematic break), use `---` or `***`.

A page break starts the next block on a new page. Page breaks at the very beginning or end of the document, and consecutive `___` lines, do not create blank pages; they are merged into a single page break.

## 2.5 Relative paths for images and other assets

With file input, relative paths are resolved against the Markdown file's parent directory; with directory input, against the input directory. Since all Markdown files in directory input sit directly under it, the base is the same either way.

```md
![Architecture diagram](assets/diagram.png)
```

By contrast, relative paths in CLI arguments such as `--input`, `--output`, and `--logo` are resolved from the directory in which you run `pfpdf`.

Local URLs written statically in Markdown, raw HTML, and CSS are resolved through the resource graph. Local paths that a script builds from strings at runtime are not automatically exposed, so declare resources with static `src` / `href` / CSS `url()`, or use HTTP(S) URLs.

The URL separator inside documents is `/` regardless of OS. A Windows absolute path is written as `file:///C:/docs/image.png`, and a UNC path as a valid `file://server/share/...` URL. Only paths in CLI arguments may use the native path notation of the OS you are running on.
