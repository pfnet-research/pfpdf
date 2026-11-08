# 7. Compatibility and testing

## 7.1 Pinned dependencies and verified OSes

This chapter records the currently pinned dependency versions and verified operating systems; it does not provide a complete compatibility table for every release. `package-lock.json` defines the exact package versions and integrity hashes for source and CI, and `npm-shrinkwrap.json`, generated from the same dependency tree, defines them for the published tarball. This chapter defines the user-facing support range. A release is prohibited if these sources disagree.

The table below records how dependencies are pinned. For a release candidate, every row must include the exact version, browser revision, OS image version, and verification date. A release is prohibited if compatibility claims rely only on ranges or labels such as "current," "latest," or "the 11 series."

| Item | Pinning method | Notes |
|---|---|---|
| Vivliostyle CLI | exact direct dependency version + source lockfile + published shrinkwrap | AGPL-3.0. Updated after sample PDF smoke tests on each supported OS |
| Browser build | standard mechanism of the pinned Vivliostyle CLI (`@puppeteer/browsers`) | pfpdf has no downloader of its own |
| GFM parser | source lockfile + published shrinkwrap | Verified against the conformance examples of the pinned GFM Spec |
| CJK-friendly extension | source lockfile + published shrinkwrap | Verify the combination with GFM strikethrough |
| PDF parsing / rewriting library | source lockfile + published shrinkwrap | Verify cross-reference table (xref) / page tree inspection and metadata updates on all supported OSes |
| MathJax / highlight.js | fixed versions bundled in the package | Not fetched from a CDN |
| Standard fonts | bundled in the package | Redistributable Japanese fonts |
| Supported Node.js version range (semver) | `package.json` `engines` + startup check | Matched to the intersection of the pinned direct dependencies' requirements |

The following four OS environments are verified in CI through PDF generation with a real browser.

- macOS aarch64 (primary support)
- Linux x86_64 (primary support)
- Windows x86_64 (additional support)
- Linux aarch64 (additional support)

Each architecture is verified by launching its browser binary; success under x86_64 emulation alone does not count as arm64 support. When an OS image or hosted runner label is updated, the runtime can change even under the same name, so the verification date and image version must be updated.

## 7.2 Linux runtime prerequisites

On Linux, the browser archive alone does not provide all the required shared libraries.

- The initial distribution targets are Ubuntu on GitHub-hosted runners and current Debian stable. Required shared library packages are recorded and maintained in version-controlled documentation
- `--doctor` reports missing libraries where possible and never installs them automatically with root privileges
- Even with all shared libraries present, some environments cannot start the Chromium sandbox, for example because of the unprivileged user namespace restrictions in Ubuntu 23.10 and later. Failures caused by the sandbox are diagnosed separately from missing libraries. Workarounds requiring root privileges, such as adding an AppArmor profile, are documented in the tutorial's troubleshooting chapter

## 7.3 Unit tests

- Before pfpdf-specific post-processing, `GfmAdapter` passes the conformance examples of the pinned GFM Spec, except for the intentional deviation of the Disallowed Raw HTML tag filter recorded in the specification
- Each GFM construct can be converted: headings, lists / nested lists / task lists, blockquotes, code, links / images / autolinks, emphasis / strong emphasis, strikethrough, tables, raw HTML, and so on
- Test valid cases of CJK-friendly strong emphasis, including `これは**重要**です`, `これは**「強調表示」**の例です`, `これは**重要な点。**続き`, fullwidth parentheses, mixed ASCII / CJK, nested emphasis, and runs of 3 or more `*`
- The CJK-friendly extension does not rewrite code spans, fenced code blocks, raw HTML, link destinations, math, escaped `\**`, or unmatched `**`
- After applying the CJK-friendly extension, there are no unintended differences in the existing pinned CommonMark / GFM fixtures
- Inline and block raw HTML, `style` / `script`, document control elements, and custom attributes are preserved as trusted input
- A standalone line of `___` becomes a page break, while `---` / `***` remain usable as GFM thematic breaks
- Test valid and invalid front matter. Metadata is removed from each file's body, the first value for each key wins, and later files fill unset values. Relative paths are resolved against the file supplying the selected value, lists are selected as whole values, and unselected assets are not opened. All files are validated, and original source-line numbers are preserved
- Test permitted line breaks in titles, specified and omitted series names, positive page sizes, precedence of explicit BCP 47 language tags and Japanese/English inference when tags are omitted, `dir` values `ltr` / `rtl` / `auto` with default `auto`, and fixed date display according to the primary language subtag
- Check the types of the YAML mapping and the metadata fields in use
- Unknown front matter keys produce warnings and are ignored by default, but are rejected with `--strict-front-matter`. Invalid known values, duplicate keys, and invalid YAML are rejected in either mode. Check consistency across conversion, configuration printing, and `--doctor`; separation of stderr warnings from stdout JSON; CLI precedence; and preservation of existing PDFs on strict-mode failure
- Test H1 / input-name fallback for omitted titles and the precedence of explicit values. Also test empty / nested H1s, one-time character-reference decoding, Japanese filenames, retained body headings, consistent cover and PDF metadata, and inferred titles without covers
- Test acceptance of UTF-8 BOM / CRLF, rejection of invalid UTF-8, and locale-independent filename sorting
- Reject `-` as input or output denoting stdin / stdout
- Each Markdown file is parsed independently, so unclosed fences, HTML blocks, lists, setext headings, and reference definitions do not leak into the next file
- Test Unicode in heading slugs, symbol-only headings, and `x` / `x-2` collisions. Raw HTML headings are excluded from the automatic ToC, duplicate headings receive unique anchors, and links to Markdown files contained in the same document are rewritten
- Test inline and display math delimiter boundaries, internal `*` / `_`, currency, escapes, and unclosed delimiters. Long `$` runs finish in linear time
- Classify user TeX errors in MathJax as exit code `2` with source locations, and bundled initialization failures as exit code `1`
- Test boundary conditions for `___`, including indentation, occurrences inside blockquotes / lists, runs of 4 or more `_`, surrounding whitespace, and document start / end / consecutive occurrences. Page breaks are normalized to `break-before` on the next block
- Test CLI exit codes `0` / `1` / `2` and stdout / stderr separation
- Test diagnostics for paths and URLs containing newlines, ESC, C0 / C1, and bidirectional formatting characters. Human-readable diagnostics remain unmodified, and JSON uses the serializer's normal escaping. Invalid UTF-8 filenames produce input errors
- The startup check works at the boundaries inside and outside the supported Node.js semver range
- The build workspace is removed on normal termination, ordinary errors, and catchable interruptions
- Test the precedence of defaults, front matter, and CLI for `template` / `toc` / `cover` / `logo`. The CLI always wins, and invalid front matter values are rejected even when overridden
- Test simultaneous use of mutually exclusive flags; duplicate options other than `--font-dir`; unknown options, positional arguments, missing values, and timeout minimum / maximum / overflow
- Test required files in bundled and custom templates, and output when the logo is omitted
- Test required, duplicate, and unknown DOM slots in custom templates; text insertion of metadata; removal of unspecified `author` / `series` slots; rejection of anything but permitted tags in titles; and rejection of a logo specification when the slot is missing
- Trusted attributes are preserved, and no processed `data-pfpdf-slot` remains
- Host fonts are disabled by default, and explicitly specified font directories can be used
- Test deterministic font scan priority, symlink cycles, broken OpenType offsets / lengths, the 4096 boundary for table and face counts, duplicate faces, and CSS escaping. Also test handling of the no-embedding flag for `--font-dir` and direct CSS URL / `data:` fonts, warnings for `local()` in custom CSS, and the prohibition of `local()` in bundled CSS
- Test child-process argument / environment limits and variable-length Unicode paths / proxies / custom CAs. Classify user-caused errors as exit code `2` and errors caused by bundled components as exit code `1`
- Test `SOURCE_DATE_EPOCH`, the PDF Info / XMP title, author, language, and timestamp policy, and the catalog `/Lang`. Emit a reproducibility warning when front matter has a `date` but `SOURCE_DATE_EPOCH` is unset
- Reject negative values, signs, whitespace, exponents, and values exceeding the safe integer / Date range for `SOURCE_DATE_EPOCH`
- Inspect the PDF header / EOF markers, xref, object offsets, incremental updates, catalog, and page tree. Never commit invalid, encrypted, zero-page, or truncated PDFs. Replace an output symlink itself without writing to its target, and reject directory outputs
- Test `bibliography` string and list forms, relative paths resolved against the front matter source, and absolute / `..` / symlink paths. Also test missing files, directories, NUL, wrong extensions, and invalid UTF-8
- Test `\cite` with single, multiple, and repeated keys, adjacency to Japanese text, the `\\cite` escape, exclusion inside code / raw HTML / math, and rejection in headings / links. Report brace / key / citation cluster errors in `file:line` diagnostics
- Test the major BibTeX / BibLaTeX entry types, Unicode, brace protection, accents, `@string`, crossref, duplicate keys within a single file or across multiple files, missing cited keys, and exclusion of uncited entries
- Test citation / bibliography / backlink `role` values, uniqueness of all generated IDs, collisions with raw HTML / template IDs, 0 / 1 / 2 markers, and numbering and entry order derived from a single citeproc session

## 7.4 Integration tests

- `make docs-release` generates the public documents with the `default` template, and `make docs-templates` generates the common sample with every bundled template in the manifest. The sample is at least 4 pages for `compact` and at least 5 pages otherwise, with no upper limit on page count. For templates other than `compact`, the table of contents spans 2 or more pages, and the sample includes long tables and code blocks, math, images, raw HTML, and page breaks. `compact` has a two-column table of contents and body text coexisting on the first page. `make docs-template-images` rasterizes every page to sequentially numbered PNGs for review. The output trees and CI artifacts for public documents, preview PDFs, and review images are kept separate
- `document.html` is generated from a single Markdown file, and the Vivliostyle CLI consumes the same file inspected by the test
- Markdown files in a directory are concatenated in filename order
- Per-file block syntax is unaffected by the contents of adjacent files, and both per-file anchors and globally unique heading anchors are generated
- A document covering GFM syntax, including tables, task lists, nested lists, strikethrough, autolinks, and CJK-friendly strong emphasis, can be converted to HTML and PDF
- The common preview's BibTeX citations, multiple clusters, long DOIs / URLs, and CJK / Latin entries render in every bundled template without omission or overflow, preserving PDF internal links and text extraction
- When Markdown is combined with inline and block raw HTML in the same document, the HTML elements, styles, and required scripts are reflected in both the generated HTML and the PDF
- Relative images, paths containing spaces, and Japanese paths are handled
- Trusted local resources containing `..`, absolute paths, and symlink targets can be referenced within the process's privileges
- Nested CSS `@import` / `url()`, import cycles, and raw HTML `srcset` / inline styles are captured in the resource graph, and resources at logical URLs can be read
- Test the classification of relative URLs, `file:`, HTTP(S), network-path references, `data:`, `blob:`, `mailto:`, `tel:`, `javascript:`, and unknown schemes for fetch and navigation roles. Raw HTML `a[href]` links to Markdown files contained in the same document are also rewritten. Other navigation links are preserved, including unresolved fragments, links to Markdown files outside the combined document, and relative links with queries
- Local paths dynamically assembled by scripts fall outside the renderer's guarantees; they must not be mistakenly judged successful as static resources
- Inline module scripts and `iframe[srcdoc]` are preserved as trusted HTML, and the resource graph inside them is not traversed
- On the loopback server, test unknown IDs, path traversal, double encoding, and invalid ranges. Handle `GET` / `HEAD`, single-range requests, and `Cache-Control: no-store`, and close the port after completion. Confirm that a symlink or FIFO swapped in after the pre-check causes failure without the special file being read
- Verify with the pinned Vivliostyle CLI and a real browser that pagination starts only after DOM parsing, local stylesheet / script loading, font preparation, image decoding, math rendering, and code highlighting are complete. Pagination never starts before the readiness gate is released. Local resource errors, bundled script errors, rejections of registered promises, late registration, and completion-signal inconsistencies result in exit code `1` regardless of the upstream child's exit code
- If preparation for rendering remains incomplete, or a script or child process stalls, terminate by the absolute deadline for the whole build. Preserve existing output through graceful and forced cleanup
- Output is possible from a read-only input directory
- When a build fails while existing output is present, the existing output is preserved
- Exclusively create a temporary file in the same directory as the final output, and commit it after success. Test that existing output survives injected failures: mismatched source size and copied byte count, post-copy truncation or corruption of the xref or page tree, corruption after PDF metadata updates, rename failure, temporary-file synchronization failure, and interruption. A parent-directory synchronization failure after commit produces only a durability warning
- Inject signals just before and during the commit critical section and just after rename. Signals before commit produce a non-zero exit and preserve existing output; after rename, the result is the complete new output and exit code `0`
- Even with cyclic-object or huge-xref fixtures that stall the PDF worker, the main process's deadline and signal handling still work. Terminate the worker and reclaim the temporary file created alongside the final output
- Even when two builds specifying the same output destination are deliberately raced, no bytes are intermixed, and only the complete PDF committed last remains
- The tarball produced by `npm pack` runs from a fresh temporary project via `npm exec`
- On a first run without a browser, the pinned Vivliostyle CLI's standard acquisition works, or the upstream diagnostics are shown to the user as-is
- A compatible browser explicitly specified via `--browser-path` can be used
- `template`, `toc`, `cover`, and `logo` can be configured via front matter, and CLI arguments always override them
- A custom template directory targeting the current pfpdf version can be used
- When host fonts are disabled, the OS font directories are not read
- With horizontal RTL and vertical writing fixtures, verify the combinations of the root `dir`, the computed writing mode, and the PDF reading direction generated by upstream
- Verify that the origin and port differ per build even for the same HTML byte sequence. Generated HTML does not embed the port used for the connection, and user scripts depending on `location` fall outside the reproducibility guarantee
- `--doctor` and `--print-effective-config` return diagnostic results without generating a PDF
- The stdout of `--doctor` and `--print-effective-config` parses as exactly one JSON object of the respective schema. It contains no stderr logs or excluded configuration values, such as proxy URLs or custom CA contents
- `--doctor` safely creates the temporary profile used for browser checks and reclaims it in success, failure, and timeout cases. It does not modify the project or output directory, the browser cache, or OS settings
- UTF-8 code points in child output and renderer diagnostics are decoded correctly even across chunk boundaries. Diagnostics are preserved without sanitization or redaction, including in a retained workspace
- With child output exceeding 8 MiB, the pipe continues to be drained without stalling. Only the saved diagnostics are truncated at the cap, and the number of omitted bytes is recorded correctly
- The file sets, numbering, and relative paths of `docs/design.ja/` and `docs/design.en/`, and of `docs/tutorial.ja/` and `docs/tutorial.en/`, match
- The four Japanese / English documents can be generated with the repository's current pfpdf build

## 7.5 PDF smoke tests

The smoke tests launch Chromium in all four supported environments. They perform the minimum checks needed to ensure that a broken or empty file is never accepted as successful output.

- The output starts with `%PDF-`
- The file is non-empty and `pdfinfo` confirms 1 or more pages
- `pdftotext` confirms the title, body text, and representative Japanese strings
- For the four Japanese / English design and tutorial PDFs, confirm the title, representative strings per language, and a non-zero page count
- In the tutorial PDF, confirm representative strings for tables, Japanese strong emphasis, raw HTML, math, and code highlighting
- For reference fixtures using the bundled Japanese font, `pdffonts` confirms in all four environments that the intended font is embedded, subsetted, and not replaced with a host font. Test the host-font feature with a dedicated redistributable fixture covering the allow / deny flags and the font actually selected
- PDF byte comparison, rasterization of every page, and complete subset inspection of all fonts are not mandatory for general documents

Independently of the structural inspection in normal runs, the smoke tests also check the exit code of `pdfinfo`, so that truncated xrefs, 0 pages, and encrypted or unparseable output are not treated as success. `pdftotext` fails the test when the expected string is not found, even if the command itself exits `0`.

## 7.6 npm package tests

- Run `npm ci` / `npm test` / `npm run lint`
- Confirm with `npm pack --dry-run` that no unnecessary files or secrets are included
- Run `npm exec --package=<tarball> -- pfpdf --help` using the packed tarball
- Confirm that the tarball contains `npm-shrinkwrap.json` but not `package-lock.json`. In the four environments, check that the runtime dependency tree and integrity hashes installed into an empty project match the source lockfile
- The packed entrypoint loads and runs on the oldest Node.js in the supported range. On representative versions just outside the range, the startup check returns the intended diagnostic
- Generate the PDF for `tests/fixtures/minimal/` in the four supported environments

## 7.7 Property-based testing, fuzzing, and performance tests

- Provide property-based tests for front matter, URLs, HTML / CSS resource tokens, headings, CJK delimiters, and the OpenType table parser. Arbitrary byte sequences never cause a crash or hang and always return either an input error or a correct result
- Path tests cover POSIX and Windows separators, drive letters, UNC, reserved names, trailing dots / spaces, and Unicode normalization with per-platform fixtures. Strings meant for another OS are not mistakenly normalized with only the host OS's path library
- Increase `M`, `B`, `N`, `T`, `R`, `C`, `A`, `F`, `G`, and `P` individually and incrementally, recording wall time, peak RSS, and internal counters. Count AST visits, map lookups, file parses, filename comparisons, compared bytes, actually served bytes, and copied bytes, and assert the designed bounds. For linear processing, excluding sorting and external parsers / renderers, measure at least 3 large input sizes on a dedicated runner. Declare a performance regression when doubling the input repeatedly causes the median time or RSS to exceed 3 times its previous value. Track the pinned GFM parser and the real renderer as separate series, recording time trends and timeouts for adversarial input
- Adversarial fixtures include long delimiter runs, deep lists / blockquotes, CSS import cycles, same-name headings, many missing links, and many font faces
- When the fuzzing corpus reveals a crash, timeout, or excessive memory use, minimize the input while preserving reproduction of the cause, and add it to the regular fixtures to prevent recurrence
