# 3. Markdown processing and GFM

## 3.1 GFM as the baseline

pfpdf uses the [GitHub Flavored Markdown Spec 0.29-gfm](https://github.github.com/gfm/) as its Markdown baseline. Rather than implementing a custom parser, it uses a maintained CommonMark- and GFM-compliant JavaScript or TypeScript library pinned by both the source lockfile and published shrinkwrap. Changing the spec version is a specification change, not a routine dependency update, and requires a review of every conformance example and expected deviation.

At minimum, the following are processed according to the GFM/CommonMark rules:

- ATX and setext headings, paragraphs, soft and hard line breaks, thematic breaks
- Unordered, ordered, and nested lists; loose and tight lists; task lists
- Blockquotes, indented and fenced code blocks, inline code
- Inline and reference links, images, autolinks, backslash escapes, HTML entities
- `*emphasis*`, `**strong emphasis**`, `~~strikethrough~~`, and valid nesting thereof
- Tables and alignment
- Inline and block-level raw HTML

## 3.2 Parser pipeline

pfpdf's extensions to GFM are kept separate within the parser pipeline.

1. Validate UTF-8 and front matter, and fix the order of the input files
2. Treat each Markdown file as an independent document, generating its AST in a single parse that incorporates the GFM, CJK-friendly delimiter, math, and pfpdf directive tokenizer extensions. Code and raw HTML are protected with the highest priority; outside of them, math and directives claim their internal tokens before emphasis and strong emphasis are processed
3. Prepend a file anchor to each file's AST and join them into a single document as an array of ASTs
4. Process heading IDs, the table of contents, cross-file links, and resource URLs using AST, HTML, and CSS parsers
5. Generate HTML using context-aware escaping and DOM APIs

Markdown source strings must not be joined with simple separators before parsing. Doing so lets unclosed code fences, HTML blocks, lists, setext headings, and link reference definitions leak into the next file, producing a different syntax tree from parsing each file independently. Independent parsing also confines link reference definitions and footnote-like extensions to their source file. File boundaries generate no empty paragraphs, and adjacent blocks cannot alter one another's syntax.

In table rendering, non-empty cells of 4 graphemes or fewer receive `.pfpdf-table-cell-compact`, and longer cells receive `.pfpdf-table-cell-min-4`. This keeps short status words on a single line while allowing long-text cells to wrap. Tables with 8 or more columns receive `.pfpdf-table-many-columns`, so templates can adjust the whole table's font size and spacing without having to guess column meaning or position.

## 3.3 pfpdf extensions

### 3.3.1 Math

`$...$` (inline) and `$$...$$` (display) math are pfpdf extensions, typeset with the bundled MathJax.

- The inline delimiter is a single `$` that is not backslash-escaped, with no whitespace immediately after the opening delimiter or immediately before the closing one. It does not span line breaks, and a `$` without a matching closing delimiter remains plain text
- The display delimiter is exclusively a pair of standalone `$$` lines that occupy a block from start to end, with the TeX source being the content between the opening and closing delimiter lines
- A `$$` without a matching closing delimiter is not treated as an opener and remains ordinary GFM text. Notation that places the delimiter and expression on the same line is likewise not display math
- Math delimiters are not recognized inside code, raw HTML, autolinks, or link destinations. `\$` is a literal `$`
- Math is recognized as a syntax extension of the same tokenizer as the GFM parser, without re-guessing code or raw HTML context from strings. Tokenization runs in linear time in the input length, avoiding implementations that scan the entire remaining input per opening delimiter or regular expressions prone to catastrophic backtracking

If MathJax reports a TeX error in a source expression, pfpdf does not accept a PDF containing the red error display as successful. It exits with code `2` and reports the original source file and line. A failure to load or initialize bundled MathJax is a distribution or runtime problem and produces code `1`.

### 3.3.2 Page breaks

Outside block containers, a line consisting of exactly three ASCII underscores `___` with no indentation is a thematic break in GFM, but pfpdf reserves it as a page break. Surrounding whitespace, four or more underscores, and `___` inside blockquotes or list items are not part of the reserved notation and are processed as GFM. `---` and `***` remain available for ordinary thematic breaks. This difference is recorded as an explicit expected deviation in the GFM conformance suite.

The directive is normalized to mean "start the next rendered block at the top of a new page", implemented by attaching the reserved `data-pfpdf-page-break` attribute to the next block and using the paged CSS `break-before: page`. Directives at the start or end of the document, as well as consecutive directives, do not create blank pages and are collapsed into a single break. A feature for inserting blank pages themselves is not provided in `v0.1.0`.

### 3.3.3 Heading anchors and the table of contents

The beginning of each source file is assigned a sequentially numbered anchor of the form `pfpdf-file-0001`. Explicit IDs in templates and raw HTML are used to avoid collisions with generated heading IDs, but the format and uniqueness of trusted HTML IDs themselves are not checked. Heading IDs are made unique by the following procedure:

1. Obtain the heading's plain text from the AST. Code spans contribute their content, images contribute their alt text, and raw HTML tags themselves are excluded
2. Normalize to NFC using Unicode data pinned at release time, and convert to locale-independent default lowercase. The slug never varies with the host's ICU or locale
3. Remove control characters and ASCII punctuation other than `_` and `-`, convert runs of whitespace to a single `-`, and strip leading and trailing `-`. Unicode letters, digits, and combining characters are preserved
4. If the result is empty, use `section`
5. On collision with an already-used ID, append `-2`, `-3`, and so on until an unused ID is found. Collisions with headings whose original text ends in such a suffix are checked against the same global set. A next-suffix cursor is kept per base, so the scan does not restart from `-2` on every duplicate

The table of contents includes all heading nodes (`h1` through `h6`) of the Markdown AST in source order, and excludes headings from raw HTML and the template itself, as well as the cover's metadata title. Raw HTML headings receive no automatic ID; to make them link targets, specify an explicit `id`. Links to a `chapter.md` merged into the same document are converted to the file anchor. `chapter.md#fragment` matches within the target file, and `#fragment` matches within the source file containing the link, comparing the once-percent-decoded fragment against the final explicit or heading ID for exact equality at the Unicode code point level. Suffixes are never re-derived from the base slug; a link to the second of two duplicate headings uses the actual `-2` ID. The query component of a relative Markdown link has no defined meaning and results in exit code `2`. Nonexistent targets also yield code `2`, with no case-insensitive guessing or ambiguous basename-only matching.

### 3.3.4 Japanese strong emphasis (CJK-friendly)

CommonMark's flanking delimiter rule has a known problem: when the content inside `**` ends in full-width punctuation or brackets and a CJK character follows outside without whitespace, it is not recognized as strong emphasis. pfpdf prioritizes natural notation in Japanese documents and converts at least the following to `<strong>`:

```md
これは**重要**です。
これは**「強調表示」**の例です。
これは**重要な点。**続きのテキスト
ここは**（重要事項）**です。
```

- Use a maintained, version-pinned CJK-friendly delimiter extension compatible with the chosen parser. For the remark/micromark family, `remark-cjk-friendly` and similar packages are the first candidates; also verify their combination with GFM strikethrough
- Only if the parser's standard features or an existing extension cannot satisfy this should an equivalent delimiter rule be implemented, and then only minimally
- Never correct the output via post-parse regular expressions or HTML replacement
- Do not rewrite code spans, fenced code, raw HTML, link destinations, math, escaped `\**`, or an unmatched one-sided `**`
- Turn Japanese punctuation, full-width brackets, ASCII/CJK adjacency, nested emphasis, and runs of 3 or more `*` into fixtures, recorded as intentional deviations from CommonMark/GFM
- Choose an implementation whose delimiter processing is linear in the number of tokens, and stress-test that long runs of `*` and inputs without closing delimiters do not degrade to quadratic behavior

Background material:

- [CommonMark issue: Emphasis with CJK punctuation](https://github.com/commonmark/commonmark-spec/issues/650)
- [markdown-cjk-friendly](https://github.com/tats-u/markdown-cjk-friendly)

### 3.3.5 Break opportunities in long unbroken strings

After Markdown and raw HTML have been converted to HAST, heading IDs, the table of contents, and resource URLs have been finalized, and math and code highlighting have been rendered, `<wbr>` elements are inserted into ordinary visible text nodes. This is an output decoration, not Markdown syntax. The input, link destinations, `href`, `src`, `id`, classes, styles, and other properties are not modified.

Runs containing no whitespace or existing break opportunities are measured in grapheme clusters via `Intl.Segmenter`. Runs of 15 graphemes or fewer are left unchanged; runs of 16 graphemes or more receive at least one break candidate, keeping each segment at 16 graphemes or fewer in principle. Priority goes first to the URL/path characters `/`, `?`, `&`, `#`, `;`, `=`, then to the host/file/identifier characters `.`, `@`, `:`, `-`, `_`, then to camelCase and letter-digit transitions, and finally to a fixed-length fallback, in that order. No split occurs in the middle of `://`, percent-encoded `%HH`, IPv6 `::`, combining characters, variation selectors, or emoji ZWJ sequences. Candidates are evaluated deterministically by count, priority, short end fragments, segment-length imbalance, and source position, in that order.

Runs continue across inline element boundaries, so display strings spanning links, `strong`, and `em` are handled as well. Runs end at blocks, `br`, existing `wbr`, zero-width spaces, soft hyphens, and characters where ordinary CJK typesetting allows inter-character breaks. Existing `wbr` elements are respected, and running the same transform twice adds no further candidates.

`pre`, `code`, `kbd`, `samp`, `script`, `style`, `textarea`, `svg`, `math`, `.pfpdf-math-src`, `.pfpdf-math-inline`, `.pfpdf-math-display`, `contenteditable` subtrees, and replaced elements are excluded. The DOM of code and math, executable content, form values, accessible text, and user-managed DOM are fully preserved. The processing applies only to source sections, not to fixed template UI. For a run of length `n`, the bounded dynamic programming takes `O(n * 16)` time and `O(n)` memory.

### 3.3.6 Mermaid

A fenced code block whose info string is lowercase `mermaid` is converted into a diagram as a pfpdf extension. Using the Mermaid version pinned in the package and a server-side DOM adapter, a static SVG is generated within the Markdown pipeline. The SVG is placed in the build workspace as `generated/mermaid-NNNN.svg` and referenced from an `img` inside a `.pfpdf-mermaid` container. No CDN, host-installed Mermaid, or additional headless browser process is used.

Mermaid is fixed to `startOnLoad: false` and `securityLevel: strict`, with HTML labels disabled and error rendering suppressed. Each diagram is assigned a deterministic ID, and the SVG is parsed as HAST and then serialized as an external SVG after the normal resource URL rewriting completes. Inline SVG is not used because in Vivliostyle's pagination DOM, SVG marker fragment references are lost and the arrowheads simply disappear. External SVG preserves markers with the same renderer and browser, and because it is not converted to a raster image, vectors and in-SVG text are preserved.

In the server-side DOM, flowchart edge label text and their background rects end up with different baselines, so only the background drifts upward away from the text. This occurs with English labels as well, not just Japanese ones. We do not apply fixed coordinate corrections that depend on font or character count, `tspan` corrections that can break multiline text, or a switch to HTML labels, which have poor portability in external SVG. Edge labels are therefore unsupported; do not use labeled edges such as `-->|label|`.

Syntax or rendering errors in Mermaid source yield code `2` with the source file and line; load or initialization failures of the bundled runtime yield code `1`. In neither case is unrendered code or an error diagram left in the PDF.

### 3.3.7 BibTeX citations

As a pfpdf extension, bibliography citations recognize `\cite{key}` and the multi-key form `\cite{key1,key2}`. In TeX, the command for citing literature is `\cite`, while `\ref` is generic label referencing, so the latter is reserved for future figure, table, equation, and section references. CommonMark preserves a backslash before an ASCII letter, so `\c` itself is not lost as a Markdown escape.

- A citation key starts with an ASCII letter or digit, followed by letters, digits, and `_:.#$%&+?<>~/-`. Commas separate clusters, so a key never contains one
- ASCII whitespace around keys is stripped; empty keys, duplicates within the same cluster, and missing or nested braces yield code `2` with file and line
- `\\cite{key}` is the literal `\cite{key}`. Citation syntax is not recognized inside inline, fenced, or indented code, raw HTML, or math
- Citations inside links and headings yield code `2` in the initial version, to avoid nested anchors and style-dependent slugs
- After each source file has been parsed independently, the clusters of all files are collected in document order, and a single citeproc session determines numbering and bibliography order
- A citation is an internal link with `role="doc-biblioref"`; an entry has a unique encoded ID and `role="doc-backlink"` links to every citing position. BibTeX keys are never used as raw HTML IDs without validation

The explicit position of the bibliography list is a top-level standalone line `\printbibliography`. There is 0 or 1 per document; when omitted, the list is appended to the end of the last source section. No heading is generated automatically; to include the bibliography in the table of contents, write an ordinary Markdown heading immediately before the marker. A marker with no citations, 2 or more markers, and citations without a specified bibliography all yield code `2`.

The initial version ships a single version-pinned numeric CSL style. The CSL processor's bibliography order is the canonical source of numbering, and entry bodies are not rebuilt by a custom formatter. Custom CSL, locators, prenotes, author-only and year-only forms, `\nocite`, and Pandoc's `[@key]` are out of scope for the initial version.

## 3.4 Handling raw HTML

Inline and block-level raw HTML pass through to preserve the flexibility that Markdown alone cannot provide. pfpdf follows GFM parsing rules but does not apply GitHub.com's post-conversion sanitization or GFM's "Disallowed Raw HTML" tag filter. Authors may use `table`, `div`, `section`, `figure`, `style`, and `script` where needed. Input is treated as trusted code, and local file access is not sandboxed (see Chapter 08).

However, for URL rewriting and template assembly, raw HTML is read as fragments by an HTML parser and re-serialized. This is not allowlist-based removal of tags or attributes, but the byte representation — quoting, attribute order, tag closing style — may not match the input. HTML blocks spanning source files cannot be constructed. Static URLs are registered into the chapter 02 resource graph; local URLs generated later by scripts are outside the guarantee.

`<base>`, `meta[http-equiv=refresh]`, and custom `data-pfpdf-*` attributes are also preserved as trusted HTML. Since these can change resource resolution and what is rendered, the consequences of using them are the user's responsibility.

Synchronous errors in user scripts and unhandled rejections before readiness are conversion failures. Asynchronous work that affects pagination must be registered with `window.pfpdf.registerReady(promise)`. Completion of unregistered timers, events, and workers is never inferred automatically.

## 3.5 Distinguishing GFM from GitHub.com-specific features

GitHub.com also renders features such as footnotes, alerts, mentions, issue references, emoji shortcodes, and Mermaid. pfpdf distinguishes features in the official GFM specification from service-specific post-processing that may require repository context.

- Official GFM features (tables, task lists, strikethrough, autolinks, and so on) are mandatory for `v0.1.0`
- Mentions and issue references that require repository context, and out-of-spec notations such as alerts, emoji shortcodes, and Mermaid, are treated as individual extensions managed in this chapter's support table. `v0.1.0` supports the Mermaid fenced code block; the rest are unsupported
- GFM syntax itself is never omitted on the grounds that raw HTML could substitute for it
- Unsupported GitHub.com-specific features are never described as "GFM not supported"

## 3.6 How conformance is checked

GFM Spec examples are run against the `GfmAdapter` before pfpdf-specific post-processing — the template wrapper, heading IDs, the table of contents, and resource URL rewriting — is added. This checks the parser's own conformance without misjudging pfpdf's added attributes as GFM violations.

- Compare using the same raw HTML settings as at runtime, treating only the Disallowed Raw HTML tag filter examples as expected deviations, with reasons recorded
- `___`, math, and Japanese strong emphasis are excluded from the standalone adapter and pinned in full-pipeline tests that include each extension
- The spec version, support table, pfpdf extensions, and expected deviations are consolidated in this chapter, and diffs are reviewed whenever the parser library or spec fixtures are updated
- Conformance fixtures pin the upstream example number, input, expected HTML, license, and spec checksum in the repository, and are never fetched from the network at test time

### Expected deviation list

| Item | GFM behavior | pfpdf behavior | Reason |
|---|---|---|---|
| Disallowed Raw HTML tag filter | Filters `<script>` and others | Preserved without filtering | Prioritizes expressive freedom for trusted documents |
| Standalone `___` line | Thematic break | Page break | Reserved as a pfpdf directive. `---` / `***` remain as alternatives |
| `**...**` adjacent to CJK | May not become strong | Converted to `<strong>` | Prioritizes natural notation in Japanese documents |
| `$...$` / `$$...$$` | Plain text | Typeset as math | pfpdf extension |
| `mermaid` fenced code block | Code block | Converted to a static SVG diagram | pfpdf extension |
| `\cite{key}` / `\printbibliography` | Plain text | Citation link / bibliography list | pfpdf extension |
| `<base>` | Preserved as raw HTML | Input error | To fix the basis of logical resource URLs and internal links |
| `meta[http-equiv=refresh]` | Preserved as raw HTML | Input error | To forbid document navigation during rendering |
