# 7. Compatibility and testing

## 7.1 Pinned dependencies and verified OSes

This chapter records the currently pinned dependency versions and verified operating systems rather than providing a comprehensive compatibility table for every release. `package-lock.json` is authoritative for source and CI package versions and integrity; the `npm-shrinkwrap.json` generated from the same tree is authoritative for the published tarball; and this chapter defines the user-facing support range. A release cannot proceed if these sources disagree.

At this stage, the implementation lockfile and measured results for the four environments do not yet exist, so the table records only how each item will be pinned. Before a release candidate can proceed, every row must include the exact version, browser revision, OS image version, and verification date. Compatibility claims cannot rely on ranges or labels such as "current," "latest," or "the 11 series."

| Item | Pinning method | Notes |
|---|---|---|
| Vivliostyle CLI | exact direct spec + source lockfile + published shrinkwrap | AGPL-3.0. Updated after sample PDF smoke tests on each supported OS |
| browser build | standard mechanism of the pinned Vivliostyle CLI (`@puppeteer/browsers`) | pfpdf has no downloader of its own |
| GFM parser | source lockfile + published shrinkwrap | Verified against the conformance examples of the pinned GFM Spec |
| CJK-friendly extension | source lockfile + published shrinkwrap | Verify the combination with GFM strikethrough |
| PDF parser / rewriter | source lockfile + published shrinkwrap | Verify xref / page tree inspection and metadata updates on all supported OSes |
| MathJax / highlight.js | fixed versions bundled in the package | Not fetched from a CDN |
| Standard fonts | bundled in the package | Redistributable Japanese fonts |
| Node.js supported semver range | `package.json` `engines` + startup check | Matched to the intersection of the pinned direct dependencies' requirements |

The verified OSes are the following four environments, all of which are exercised in CI all the way through PDF generation with a real browser.

- macOS aarch64 (primary support)
- Linux x86_64 (primary support)
- Windows x86_64 (additional support)
- Linux aarch64 (additional support)

Architectures are verified by actually launching the browser binary for that architecture; success under x86_64 emulation alone does not count as arm64 support. When an OS image or hosted runner label is updated, the runtime can change even under the same name, so the verification date and image version are updated accordingly.

## 7.2 Linux runtime prerequisites

On Linux, the browser archive alone does not provide all the required shared libraries.

- Supported distributions start with GitHub-hosted Ubuntu and current Debian stable as the initial verification targets, and the required shared library packages are maintained as versioned documentation
- `--doctor` reports missing libraries to the extent possible, and no implicit installation with root privileges is ever performed
- Even with all shared libraries present, some environments cannot start the Chromium sandbox — for example, the unprivileged user namespace restrictions in Ubuntu 23.10 and later. Sandbox-caused failures are diagnosed distinctly from missing libraries, and workaround procedures that involve root work, such as adding an AppArmor profile, are documented in the tutorial's troubleshooting chapter

## 7.3 Unit tests

- The `GfmAdapter`, before any pfpdf-specific post-processing, passes the conformance examples of the pinned GFM Spec except for the expected deviation of the Disallowed Raw HTML tag filter
- Conversion of each GFM construct: headings, lists / nested lists / task lists, blockquotes, code, links / images / autolinks, emphasis / strong, strikethrough, tables, raw HTML, and so on
- Happy paths of CJK-friendly strong, including `これは**重要**です`, `これは**「強調表示」**の例です`, `これは**重要な点。**続き`, fullwidth parentheses, mixed ASCII / CJK, nested emphasis, and runs of 3 or more `*`
- The CJK-friendly extension does not rewrite code spans / fences, raw HTML, link destinations, math, escaped `\**`, or one-sided `**`
- After applying the CJK-friendly extension, there are no unintended differences in the existing pinned CommonMark / GFM fixtures
- Inline and block raw HTML with `style` / `script`, document control elements, and custom attributes are preserved as trusted input
- A standalone line of `___` becomes a page break, while `---` / `***` remain usable as GFM thematic breaks
- Front matter happy and error paths, rejection of multiple metadata blocks, permitted line breaks inside titles, optional display of series, positive page sizes, BCP 47 language tags with default `ja`, `dir` values `ltr` / `rtl` / `auto` with default `auto`, and fixed date display per primary language
- Type checking of the YAML mapping and the metadata fields in use
- UTF-8 BOM / CRLF, invalid UTF-8, and locale-independent filename sorting
- Rejection of `-` as input or output denoting stdin / stdout
- Each Markdown file is parsed independently, so unclosed fences, HTML blocks, lists, setext headings, and reference definitions do not leak into the next file
- Heading slug Unicode, symbol-only headings, `x` / `x-2` collisions, raw HTML headings excluded from the automatic ToC, unique anchors for duplicate headings, and rewriting of links to Markdown files contained in the same document
- Inline and display math delimiter boundaries, internal `*` / `_`, currency, escapes, unclosed delimiters, and long `$` runs finishing in linear time
- Classifying user TeX errors in MathJax as code `2` with source locations, and bundled initialization failures as code `1`
- Boundary conditions for `___`, including indentation, occurrences inside blockquotes / lists, runs of 4 or more characters, surrounding whitespace, document start / end / consecutive occurrences, and the `break-before` normalization onto the next block
- CLI exit codes `0` / `1` / `2` and stdout / stderr separation
- Diagnostic escaping of paths and URLs containing newlines, ESC, C0 / C1, and bidi formatting characters, and raw byte display of invalid UTF-8 filenames
- The startup check against boundary values of the supported and unsupported Node.js semver ranges
- Workspace cleanup on normal termination, ordinary errors, and catchable interruptions
- Precedence of default, front matter, environment, and CLI for templates; precedence of CLI, environment, and defaults for other settings; the CLI always winning; and invalid front matter templates remaining errors under an override
- Strict parsing of environment variable booleans, enums, numbers, and path lists
- Simultaneous use of mutually exclusive flags; duplicate options other than `--font-dir`; unknown options, positional arguments, and missing values; explicit resets of the template selector and of the logo / font directory / managed browser / workspace retention overriding the entire logical configuration from environment variables; empty or duplicate components in path lists; and timeout minimum / maximum / overflow
- Required files of bundled and custom templates, and the output when the logo is omitted
- Required, duplicate, and unknown DOM slots in custom templates; text insertion of metadata; removal of unspecified author / series slots; rejection of anything but permitted tags in titles; rejection of a logo specification when the slot is missing
- Trusted attributes are preserved, no processed `data-pfpdf-slot` remains, and a runtime overwrite of `window.pfpdf` results in code `1`
- Host fonts are disabled by default and font directories are opt-in
- Deterministic priority of the font scan, symlink cycles, broken OpenType offsets / lengths, the 4096 boundary for tables / faces, duplicate faces, CSS escaping, the no-embedding flag for `--font-dir` and direct CSS URL / `data:` fonts, the custom CSS `local()` warning, and the prohibition of `local()` in bundled CSS
- Child-process argv / environment limits, variable-length Unicode paths / proxies / custom CAs, and classification into code `2` / `1` by user versus bundled cause
- `SOURCE_DATE_EPOCH` and the PDF Info / XMP title, author, language, and timestamp policy, the catalog `/Lang`, and emitting a reproducibility warning when front matter has a `date` but the epoch is unset
- Rejecting negative values, signs, whitespace, exponents, and values exceeding the safe integer / Date range for `SOURCE_DATE_EPOCH`
- Never committing PDFs with bad header / EOF markers, xref / object offset / incremental update / catalog / page tree problems, encryption, 0 pages, symlink or directory outputs, or truncation
- Inspecting `bibliography` string and list forms, relative paths resolved against the front matter source, absolute / `..` / symlink paths, and missing / directory / NUL / wrong-extension / invalid-UTF-8 inputs
- Inspecting `\cite` with single, multiple, and repeated keys, adjacency to Japanese text, the `\\cite` escape, exclusion inside code / raw HTML / math, rejection in headings / links, and file:line diagnostics for brace / key / cluster errors
- Inspecting the major BibTeX / BibLaTeX entry types, Unicode, brace protection, accents, `@string`, crossref, duplicate keys within a single file or across multiple files, missing cited keys, and exclusion of uncited entries
- Inspecting citation / bibliography / backlink roles, uniqueness of all IDs, collisions with raw HTML / template IDs, 0 / 1 / 2 markers, and numbering and entry order derived from a single citeproc session

## 7.4 Integration tests

- `make docs-release` generates the public documents with the `default` template, and `make docs-templates` generates the common sample with every bundled template in the manifest. The sample is at least 4 pages for `compact` and at least 5 pages otherwise, with no upper limit on page count. For templates other than `compact`, the table of contents spans 2 or more pages, and the sample includes long tables and code blocks, math, images, raw HTML, and page breaks. `compact` has a two-column table of contents and body text coexisting on the first page. `make docs-template-images` rasterizes every page to sequentially numbered PNGs for review. The output trees and CI artifacts for public documents, preview PDFs, and review images are kept separate
- `document.html` is generated from a single Markdown file, and the Vivliostyle CLI consumes the same file inspected by the test
- Markdown files in a directory are concatenated in filename order
- Per-file block syntax is unaffected by the contents of adjacent files, and both per-file anchors and globally unique heading anchors are generated
- A comprehensive GFM document containing tables, task lists, nested lists, strikethrough, autolinks, and CJK-friendly strong can be converted to the generated HTML and PDF
- The common preview's BibTeX citations, multiple clusters, long DOIs / URLs, and CJK / Latin entries render in every bundled template without omission or overflow, preserving PDF internal links and text extraction
- When Markdown is combined with inline and block raw HTML in the same document, the HTML elements, styles, and required scripts are reflected in both the generated HTML and the PDF
- Relative images, paths containing spaces, and Japanese paths are handled
- Trusted local resources containing `..`, absolute paths, and symlink targets can be referenced within the process's privileges
- Nested CSS `@import` / `url()`, import cycles, and raw HTML `srcset` / inline styles are captured in the resource graph, and resources at logical URLs can be read
- The classification of relative, `file:`, HTTP(S), network-path, `data:`, `blob:`, `mailto:`, `tel:`, `javascript:`, and unknown schemes is inspected per fetch / navigation role, along with the rewriting of raw HTML `a[href]` links to Markdown files
- Local paths dynamically assembled by scripts fall outside the renderer's guarantees; they must not be mistakenly judged successful as static resources
- Inline module scripts and `iframe[srcdoc]` are preserved as trusted HTML, and the resource graph inside them is not traversed
- On the loopback server, test missing tokens, unknown IDs, path traversal, double encoding, invalid ranges, request bodies, Host / Origin mismatches, and header / concurrency limits; handle the required single range and CORS, plus no-store / no-referrer / nosniff headers; and close the port after completion. Also confirm that a symlink or FIFO swapped in after the pre-check fails without the special file being read
- Verify with the pinned Vivliostyle CLI and a real browser that pagination starts only after the DOM, local stylesheets / scripts, fonts, image decoding, math, and code highlighting are complete. Pagination never starts before the readiness gate is released, and local resource errors, bundled script errors, rejections of registered promises, late registration, and completion-signal inconsistencies result in code `1` regardless of the upstream child's exit code
- Incomplete readiness, a stalled script, or a stalled child terminates at the absolute deadline, and the existing output survives graceful and forced cleanup
- Output is possible from a read-only input directory
- When a build fails while existing output is present, the existing output is preserved
- The commit after success happens from an exclusively created temporary file in the same directory as the final output, and the existing output survives fault injection of source-size / copied-byte-count mismatch, post-copy truncation and broken xref / page tree, corruption after PDF metadata updates, rename failure, temporary-file flush failure, and interruption. A parent-directory flush failure after commit is fixed as a durability warning only
- Signals are injected just before and during the commit critical section and just after rename; only signals before commit produce a non-zero exit and preservation of existing output, while after rename the result is the complete new output and code `0`
- Even with cyclic-object or huge-xref fixtures that stall the PDF worker, the main process's deadline and signal handling still work, and the worker and sibling temporary file are reclaimed
- Even when two builds to the same output are deliberately raced, no bytes are intermixed, and only the complete PDF committed last remains
- The tarball produced by `npm pack` runs from a fresh temporary project via `npm exec`
- On a first run without a browser, the pinned Vivliostyle CLI's standard acquisition works, or the upstream diagnostics are shown to the user as-is
- A compatible browser explicitly specified via `PFPDF_BROWSER_PATH` can be used
- The template and browser can be configured via environment variables, and CLI arguments always override them
- A custom template directory targeting the current pfpdf version can be used
- When host fonts are disabled, the OS font directories are not read
- The renderer takes the same `document.html` inspected by the integration tests as input
- With horizontal RTL and vertical writing fixtures, verify the combinations of the root `dir`, the computed writing mode, and the PDF reading direction generated by upstream
- The origin, port, and token differ per build even for the same HTML byte sequence; verify that no token leaks into the generated HTML, and confirm that user scripts depending on `location` fall outside the reproducibility guarantee
- `--doctor` and `--print-effective-config` return diagnostic results without generating a PDF
- The stdout of `--doctor` and `--print-effective-config` parses as exactly one JSON object of the respective schema, stderr logs do not intermix, and secret-bearing values are redacted
- `--doctor` reclaims the secure temporary profile used for browser checks in success, failure, and timeout cases, and does not modify the project or output directory, the browser cache, or OS settings
- UTF-8 code points and tokens in child output and renderer diagnostics are decoded and escaped correctly even across chunk boundaries, and AssetServer tokens and known credentials are never left in raw form in stdout, stderr, or a retained workspace
- With child output exceeding 8 MiB, the pipe is drained without stalling, only the saved diagnostics are truncated at the cap, and the number of omitted bytes is recorded correctly
- The file sets, numbering, and relative paths of `docs/design.ja/` and `docs/design.en/`, and of `docs/tutorial.ja/` and `docs/tutorial.en/`, match
- The four Japanese / English documents can be generated with the repository's current pfpdf build

## 7.5 PDF smoke test

The smoke tests launch Chromium in all four supported environments. They perform the minimum checks needed to ensure that a broken or empty file is never accepted as successful output.

- The output starts with `%PDF-`
- The file is non-empty and `pdfinfo` confirms 1 or more pages
- `pdftotext` confirms the title, body text, and representative Japanese strings
- For the four Japanese / English design and tutorial PDFs, confirm the title, representative strings per language, and a non-zero page count
- In the tutorial PDF, confirm representative strings for tables, Japanese strong, raw HTML, math, and code highlighting
- For canonical fixtures using the bundled Japanese font, `pdffonts` confirms in all four environments that the intended font is embedded and subset, not substituted with a host font. The host-font feature is tested with a redistributable dedicated fixture covering the allow / deny flags and the actual selection
- PDF byte comparison, rasterization of every page, and complete subset inspection of all fonts are not mandatory for general documents

Independently of the structural inspection in normal runs, the smoke tests also check the exit code of `pdfinfo`, so that truncated xrefs, 0 pages, and encrypted or unparseable output are not treated as success. `pdftotext` fails the test when the expected string is not found, even if the command itself exits `0`.

## 7.6 npm package tests

- `npm ci` / `npm test` / `npm run lint`
- Confirm with `npm pack --dry-run` that no unnecessary files or secrets are included
- Run `npm exec --package=<tarball> -- pfpdf --help` using the packed tarball
- Confirm in the four environments that the tarball contains `npm-shrinkwrap.json` but not `package-lock.json`, and that the runtime dependency tree and integrity installed into an empty project match the source lockfile
- The packed entrypoint loads and runs on the oldest Node.js in the supported range, and on representative versions just outside the range the startup check returns the intended diagnostic
- Generate the PDF for `tests/fixtures/minimal/` in the four supported environments

## 7.7 Property, fuzz, and performance tests

- Front matter, URLs, HTML / CSS resource tokens, headings, CJK delimiters, and the OpenType table parser have property tests showing that arbitrary byte sequences never crash or hang and always return either an input error or a correct result
- Path tests cover POSIX and Windows separators, drive letters, UNC, reserved names, trailing dots / spaces, and Unicode normalization with per-platform fixtures. Strings meant for another OS are not mistakenly normalized with only the host OS's path library
- `M`, `B`, `N`, `T`, `R`, `C`, `A`, `F`, `G`, and `P` are increased individually and incrementally, recording wall time, peak RSS, and internal counters for AST visits, map lookups, file parses, filename comparisons, compared bytes, actually served bytes, and copied bytes. Counters assert the designed bounds, and for linear processing — excluding sort and external parsers / renderers — a performance regression is declared when doubling the input at 3 or more large points on a dedicated runner makes the median time or RSS consecutively exceed 3x. The pinned GFM parser and the real renderer are tracked as separate series, recording time trends and timeouts for adversarial input
- Adversarial fixtures include long delimiter runs, deep lists / blockquotes, CSS import cycles, same-name headings, many missing links, and many font faces
- Crashes, timeouts, and excessive memory use found by the fuzz corpus are minimized and promoted to regular fixtures to prevent recurrence
