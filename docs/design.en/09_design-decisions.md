# 9. Record of design decisions

This chapter documents decisions for which several reasonable options existed. Each record explains the adopted and rejected options, the reasons for choosing among them, the trade-offs, and the conditions that would justify reconsideration. When one decision replaces another, the original rationale remains in place and its status links to the superseding decision. Commits and issues are never the sole record of design rationale.

Each decision follows this format:

- Status and decision date
- The problem to solve, constraints, and evaluation criteria
- Options considered
- The adopted option and the reasons for adopting it
- The options not adopted, with the specific reasons each was rejected
- Drawbacks of the adopted option, operational consequences, and known risks
- How it is verified in implementation and tests
- Conditions for future reconsideration

## DD-01: Adopt an existing GFM library as the Markdown parser

- Status: Accepted (2026-08)
- Problem: How to implement Markdown conversion. Implementing and maintaining a custom parser is expensive both in spec coverage and in ongoing maintenance
- Options: (a) implement a custom parser, (b) pin and use a maintained GFM-compatible library
- Adopted: (b). It can be verified against the GFM Spec conformance examples, and pfpdf-specific features (table of contents, math, page breaks, Japanese strong) can be separated out as explicit extensions
- Rejection reasons: (a) requires covering all GFM syntax ourselves, with the heavy burden of tracking the spec. A partial implementation produces the user experience of "notation that should work is not converted"
- Risk: The parser library may become unmaintained. Version pinning and the conformance suite make behavioral differences detectable at migration time
- Verification: the pinned GFM conformance suite run against `GfmAdapter`
- Reconsideration conditions: the adopted library becoming unmaintained, or a long-unfixed defect that prevents meeting conformance

## DD-02: Handle Japanese strong via an extension at the delimiter layer

- Status: Accepted (2026-08)
- Problem: Under CommonMark's flanking rules, strong emphasis containing full-width punctuation, as in `これは**「重要」**です`, is not recognized
- Options: (a) fix it up with post-parse regular-expression / HTML replacement, (b) use a CJK-friendly extension at the parser's delimiter layer, (c) leave it unsupported, per spec
- Adopted: (b). It can decide correctly at the token level without breaking code spans, raw HTML, or link destinations
- Rejection reasons: (a) carries a high risk of misconverting `**` inside code blocks or raw HTML and amounts to re-parsing context. (c) leaves natural notation, common in Japanese documents, unwritable
- Risk: Dependence on the extension's maintenance status. Only if standard features or existing extensions cannot satisfy the need will an equivalent delimiter rule be implemented minimally
- Verification: fixtures covering converted and non-converted cases (chapter 07)
- Reconsideration conditions: if CommonMark itself improves the CJK flanking rules

## DD-03: Pass raw HTML through without applying the tag filter

- Status: Accepted (2026-08)
- Problem: Whether to apply GFM's "Disallowed Raw HTML" tag filter
- Options: (a) filter as GitHub.com does, (b) preserve raw HTML as trusted input
- Adopted: (b). pfpdf is a build tool for trusted local documents, and raw HTML including `style` / `script` is needed for layout flexibility
- Rejection reasons: (a) removes legitimate means of expression, while its effect of making untrusted input safe remains incomplete without a sandbox
- Risk: Processing an untrusted document executes arbitrary scripts. The trust model is stated explicitly in the README and `SECURITY.md` (chapter 08)
- Verification: raw HTML preservation fixtures, recorded as an expected deviation in the conformance suite
- Reconsideration conditions: if processing of untrusted input is ever officially supported (which presupposes a sandbox design)

## DD-04: Do not treat the loopback `AssetServer` as a security boundary

- Status: Superseded by DD-11 (2026-08)
- Problem: How to serve local resources when the Vivliostyle CLI requires URL input
- Options: (a) a strict server with an exact-file map, a build token, and an origin allowlist, (b) a simple static file server assuming trusted input
- Initially adopted: (b). Under the trust model the input is trusted, and the mechanisms of (a) were judged to add complexity and failure points out of proportion to their defensive value
- Rejection reasons: (a) contradicts the premise that raw HTML can reference arbitrary local files, giving an illusion of safety
- Risk: The `AssetServer` being repurposed for other uses. The design and `SECURITY.md` state explicitly that it is not a boundary
- Verification: integration tests for static serving, CORS, and port closing
- Replacement reason: To use the same HTML with Docker as well, and to mount `..` / absolute paths / nested CSS correctly, a mapping table of static resources became necessary. Moreover, a simple server with wildcard CORS unnecessarily widens the scope of accidental file reads from other local web pages. Even without providing a sandbox, an exact-file map and a random token have value for correctness and defense in depth

## DD-05: Delegate browser management to the Vivliostyle CLI

- Status: Accepted (2026-08)
- Problem: Acquisition and cache management of the Chromium used for PDF rendering
- Options: (a) pfpdf downloads and manages the browser itself, (b) delegate to the standard mechanism of the pinned Vivliostyle CLI and the Puppeteer-family browser manager
- Adopted: (b). Download integrity, cache layout, and platform differences are already solved upstream, and a duplicate implementation would be a source of maintenance burden and inconsistency
- Rejection reasons: (a) would mean owning cache locking, partial-download recovery, and pruning ourselves, and continually tracking upstream changes
- Risk: Exposure to upstream changes in browser policy. The explicit override via `--browser-path` / `PFPDF_BROWSER_PATH` is provided as an escape hatch
- Verification: integration tests for a browser-less first run and for an explicit browser path
- Reconsideration conditions: if upstream's browser management no longer meets pfpdf's requirements

## DD-06: Renderer defaults to local; Docker is explicit opt-in

- Status: Accepted (2026-08)
- Problem: The relationship between the local renderer and the Docker renderer
- Options: (a) make Docker the default, (b) default to local with implicit fallback to Docker, (c) default to local with Docker available only via explicit switching
- Adopted: (c). Not requiring Docker is a goal, and implicit fallback makes it difficult to diagnose where a failure occurred
- Rejection reasons: (a) forces Docker on all users. (b) makes it unclear which implementation failed and produces double errors on environments without Docker
- Risk: Users whose local renderer fails due to environment differences must switch explicitly. `--doctor` assists diagnosis
- Verification: unit and integration tests of renderer selection and the prohibition of fallback
- Reconsideration conditions: none (maintained as long as the trust model and diagnosability requirements do not change)

## DD-07: Configuration is CLI arguments and environment variables only, with CLI always winning

- Status: Accepted (2026-08)
- Problem: Which kinds of configuration sources to support, and their precedence
- Options: (a) introduce a project config file, (b) use only CLI arguments and environment variables
- Adopted: (b). A config file introduces new specifications for search order, merge rules, and relative path bases, making it harder to diagnose which setting took effect. Repeated settings can be recorded as CLI arguments in a Makefile or CI workflow
- Rejection reasons: (a) means arbitrating the same item across 3 sources, reducing the explainability of `--print-effective-config`
- Risk: Some users need long argument lists. Mitigated with environment variables and wrapper scripts
- Verification: unit tests of precedence and boolean negation flags
- Reconsideration conditions: if the number of configuration items grows substantially and becomes unmanageable via CLI and environment variables

## DD-08: Do not make the generated HTML a public output format

- Status: Accepted (2026-08)
- Problem: Whether to publish HTML as an output format alongside PDF
- Options: (a) provide single-file HTML output, (b) keep HTML as renderer input and test-only
- Adopted: (b). Single-file conversion requires recursive asset embedding, data URL conversion, and font subsetting — complexity that is large relative to the primary goal of PDF generation
- Rejection reasons: (a) demands complete tracking of the resource graph and is fundamentally incompatible with dynamic references inside raw HTML
- Risk: User demand for HTML output. Quality as an internal format is guaranteed by making the same builder output the renderer consumes as `document.html` inspectable from tests
- Verification: an integration test inspecting the identity of the builder output and the Vivliostyle input
- Reconsideration conditions: re-evaluate the demand for and implementation cost of single-file HTML from `v0.2.0` onward

## DD-09: Japanese documents are canonical; English documents are translations

- Status: Accepted (2026-08)
- Problem: Multilingual management of the design and tutorial documents
- Options: (a) English only, (b) English canonical + Japanese translation, (c) Japanese canonical + English translation
- Adopted: (c). The primary readers and authors are Japanese speakers, and Japanese typesetting (strong emphasis with fullwidth punctuation, Japanese fonts) is a core feature of pfpdf, so the language in which accuracy is easiest to maintain is made canonical
- Rejection reasons: (a) harms readability for the primary users. (b) has the awkwardness of specifying Japanese-specific behavior (punctuation, date formats) in English first
- Risk: For English-speaking contributors, the translation is secondary information. File correspondence checks and simultaneous updates in the same pull request are enforced in CI to prevent divergence
- Verification: `check-doc-translations.mjs` and the docs build in CI
- Reconsideration conditions: if the language composition of contributors changes substantially

## DD-10: Errors are fail-fast; partial output is not treated as success

- Status: Accepted (2026-08)
- Problem: What to do when some of multiple Markdown files fail to convert
- Options: (a) skip the failing files and continue, (b) fail the whole document and return non-zero
- Adopted: (b). Skipping leads to accidents where a PDF with missing content is distributed as a success, undetectable even in CI
- Rejection reasons: (a) looks friendly at first glance, but missing content combined with exit code `0` causes greater real harm
- Risk: In a large document, one error stops the whole build. Mitigated by clear diagnostics of the error location
- Verification: unit and integration tests that all error paths return non-zero
- Reconsideration conditions: none

## DD-11: Use a static resource graph and a token-protected exact-file server

- Status: Superseded by DD-18 (2026-08)
- Problem: While passing the same `document.html` to the local and Docker renderers, local assets referenced from Markdown, raw HTML, and nested CSS must be resolved with the correct base path
- Options: (a) mount / serve the entire input directory or the filesystem root, (b) embed all assets in the HTML as data URLs, (c) build a graph of static references in the parser and rewrite them to logical URLs
- Adopted: (c). Renderer-specific paths can be removed from the HTML, Docker mounts can be limited to the required resources, and CSS import cycles are handled explicitly. The server uses a random path token and an exact-file map, starting on the same loopback network as the browser — on the host locally, and inside the container for Docker
- Rejection reasons: (a) invites overly broad mounts and serving to handle absolute paths, with remaining path collisions and platform differences. (b) increases memory usage for large fonts and images, and also conflicts with the policy of making single-file HTML a non-goal
- Risk: Static URL extraction from HTML and CSS becomes a new source of complexity. Local paths dynamically generated by scripts cannot be covered and are not guaranteed under either local or Docker. Assets are also not snapshotted during the build. Mitigated with dedicated parsers, a visited set, and manifest fixtures
- Verification: integration tests for nested `@import`, `url()`, `srcset`, absolute / `..` / symlink paths, cycles, identical logical URLs across local and Docker, and token / traversal / range handling. Also verify that Docker does not depend on the host network or published ports and that the in-container server serves the same HTML byte sequence
- Reconsideration conditions: if the upstream renderer provides a renderer-neutral resource protocol and the custom graph can be removed safely

## DD-12: Multiple Markdown files are parsed independently and their ASTs concatenated

- Status: Accepted (2026-08)
- Problem: Naively concatenating source strings lets unclosed fences, HTML blocks, lists, setext headings, and reference definitions change syntax across file boundaries
- Options: (a) concatenate strings with a separator and parse once, (b) parse each file independently and concatenate arrays of AST blocks
- Adopted: (b). A standalone file and directory input then agree in syntax, and boundary conditions stay localized
- Rejection reasons: (a) cannot safely close every kind of unclosed block with any choice of separator, and the meaning of the next chapter changes depending on how a source file ends
- Risk: Parser state such as reference definitions is not shared between files. This is stated explicitly as the specification, and ordinary inline links are used for shared links
- Verification: file-boundary fixtures for fences, HTML, lists, setext headings, and reference definitions
- Reconsideration conditions: if a clear user demand arises for sharing parser state across files and an unambiguous boundary syntax is added

## DD-13: Custom templates are assembled via DOM slots

- Status: Accepted (2026-08)
- Problem: A contract is needed for inserting metadata, body text, the table of contents, and the logo into custom HTML safely and unambiguously
- Options: (a) `{{...}}` string substitution, (b) a general-purpose template engine, (c) parse an inert DOM with `data-pfpdf-slot` and insert nodes
- Adopted: (c). The text / node context can be fixed, avoiding paths where metadata unintentionally ends up in attributes or CSS
- Rejection reasons: (a) delegates per-context escaping to the template author, and duplicate or missing placeholders are easily overlooked. (b) adds unnecessary APIs and dependencies: arbitrary expressions, helpers, and versioning
- Risk: Flexibility for advanced custom layouts is lower than with a general-purpose engine. This is complemented by raw HTML, scripts, CSS, and optional slots, and users who need compatibility are asked to pin the pfpdf version
- Verification: unit and integration tests for required / duplicate / unknown slots, metadata escaping, logo / TOC omission, and script readiness
- Reconsideration conditions: if multiple practical templates are identified that DOM slots cannot express

## DD-14: Require a finite deadline and post-verification atomic output commit

- Status: Accepted (2026-08)
- Problem: Preventing script and browser stalls, and preventing a truncated PDF containing only a header from destroying existing output
- Options: (a) wait for upstream processes indefinitely and check only `%PDF-`, (b) combine an absolute deadline, structure-aware PDF parsing, flushing, and same-directory atomic replace
- Adopted: (b). This prevents CI from stalling forever, rejects broken PDFs containing only the header and EOF markers, and preserves the existing output on failure. The deadline defaults to 300 seconds and can be changed within the range of 1 second to 1 hour. If upstream has no pre-pagination hook, a load gate and a loopback completion signal are used, and demonstrating that method with the pinned renderer is a release condition
- Rejection reasons: (a) is fragile even with trusted input against infinite loops, browser bugs, and truncated writes, and does not satisfy the fail-fast contract
- Risk: For very large legitimate documents, PDF parse time and memory also grow and can exceed the default timeout. An explicit override and diagnostics of phase and elapsed time are provided. Since structural parsing still cannot guarantee textual or visual semantics, independent `pdfinfo` / `pdftotext` / `pdffonts` checks are also used in CI
- Verification: fault-injection tests for the prohibition of pagination before the readiness gate, readiness hangs, child / container hangs, source / copied byte-count mismatch, truncated trailer after copy, flush / rename failure, interruption, and preservation of existing output
- Reconsideration conditions: if measurements show the default is inappropriate. This is not a reason to return to indefinite waiting

## DD-15: Front matter is a restricted YAML 1.2 mapping

- Status: Superseded by DD-18 (2026-08)
- Problem: YAML's implicit typing, arbitrary tags, alias graphs, and merge keys are excessive for reading a few scalar metadata values, producing type mismatches and resource amplification
- Options: (a) allow full YAML with the parser's default schema, (b) restrict front matter to JSON only, (c) restrict to the equivalent of YAML 1.2's JSON schema, rejecting tags, anchors, aliases, and merges
- Adopted: (c). Limiting input to a flat mapping and scalars of at most 64 KiB keeps the readability of ordinary `key: value` while avoiding implicit date-to-object conversion, deep nesting, and alias expansion
- Rejection reasons: (a) broadens input types and computational cost more than needed. (b) is verbose as Markdown front matter and departs from user expectations
- Risk: Front matter using advanced YAML features cannot migrate. Since the permitted keys are a few scalars, this is handled with guidance to rewrite the values
- Verification: tests for the 64 KiB boundary, scalar types, nested values, duplicate / unknown keys, tags, anchors / aliases, merges, multi-document input, prototype keys, and huge alias chains
- Reconsideration conditions: if the metadata model is extended enough to need nested structures

## DD-16: Fix document language and Unicode normalization as build inputs

- Status: Superseded in part by DD-18 (2026-08)
- Problem: Delegating language, filename collision handling, and heading slugs to the host locale / ICU means the HTML `lang`, anchors, internal links, and date rendering can change for the same source after an OS or runtime update
- Options: (a) use the host locale and built-in `Intl` / Unicode data as-is, (b) use `lang` metadata and version-pinned Unicode / language subtag data
- Adopted: (b). A `lang` default of `ja` and a `dir` default of `auto` are reflected onto the HTML root, and NFC, case folding, default lowercasing, and BCP 47 canonicalization are processed with data fixed within the release. Text direction is not inferred from the host locale, and automatic dates and labels use fixed formats based on the primary language, without the host formatter
- Rejection reasons: (a) turns implicit machine settings into a new configuration source, harming internal link compatibility and reproducibility
- Risk: Updating the Unicode / language data may change filenames that previously did not collide, or existing slugs. The data versions are recorded in the third-party list, and updates are reviewed as specification diffs
- Verification: BCP 47, NFC / case folding, Unicode heading slugs, ja / non-ja dates and labels, and LTR / RTL / vertical writing fixtures in the four environments
- Reconsideration conditions: if Node.js and all supported environments provide the same data versions as a compatibility contract, allowing the custom pinning to be removed

## DD-17: The public CLI pins transitive dependencies with a publishable shrinkwrap

- Status: Accepted (2026-08)
- Problem: The repository's `package-lock.json` is not published in the npm tarball and is ignored in nested installs by `npx` users, so it alone cannot reproduce the transitive dependency tree verified at release time
- Options: (a) rely on direct dependencies' semver ranges and user-side resolution, (b) bundle all dependencies, (c) make direct runtime versions exact and generate a published `npm-shrinkwrap.json` from the reviewed source lockfile
- Adopted: (c). This uses the [publishable lockfile](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json#package-lockjson-vs-npm-shrinkwrapjson) npm provides for CLI tools, and the install tree, including platform-specific optional dependencies, is verified in the four environments
- Rejection reasons: (a) means the behavior of the same pfpdf version changes after publish. (b) needlessly complicates package size, native / platform packages, and license management
- Risk: Transitive security fixes also do not arrive automatically, requiring lock updates and patch releases. Handled with mechanical comparison of the source lockfile and the staging shrinkwrap, dependency review, and periodic updates
- Verification: tarball file list, agreement of the shrinkwrap and source lock trees, installation into an empty project with `npm ls`, and packed-package PDF smoke tests in the four environments
- Reconsideration conditions: if npm's publish / install semantics change, or another distribution format provides equivalent complete-tree pinning

## DD-18: Assuming trusted input, keep no security-only mechanisms

- Status: Accepted (2026-08)
- Problem: Although pfpdf is a trusted-document build tool that permits raw HTML and scripts, it had implemented loopback tokens, CORS, connection limits, diagnostic redaction, a child environment allowlist, and custom YAML / BCP 47 parsers. These formed an incomplete security boundary, narrowed the usable inputs and execution environments, and increased the maintenance surface
- Options: (a) keep each mechanism as defense in depth, (b) keep only the validation needed for correctness, removing security-only mechanisms and duplicate implementations of standard functionality
- Adopted: (b). The AssetServer keeps the loopback bind and URL resolution via the resource graph, but has no token or CORS policy. Renderer children inherit the ordinary process environment, and diagnostics are output unmodified. Front matter is read as a mapping with `js-yaml`'s JSON schema, checking only the types of the metadata fields in use. Language tags are checked and normalized with Node.js's `Intl.getCanonicalLocales`. There are likewise no forbidden elements or reserved attributes for raw HTML / templates, no consistency checks of IDs and navigation links, no prohibition of modules or nested documents, no cross-OS filename collision handling, and no custom page-size limits
- Rejection reasons: (a) provides no confidentiality once trusted scripts can read all same-origin resources, and makes mechanisms that are not security boundaries look like security features. Custom parsers and allowlists also create compatibility problems by rejecting valid documents and environments
- Risk: Renderer diagnostics can contain input-derived control characters and URL credentials, and child processes can reference the caller's environment variables. The premises — trusted documents and an ordinary local CLI process — are stated explicitly to users

## DD-19: Readiness waits once, only for asynchronous work that actually renders

- Status: Accepted (2026-08)
- Problem: Waiting for fonts, images, and user promises before pagination is necessary for quality assurance, but prefetching the entire manifest, the actual browser load, separate success / failure endpoints, and API tamper detection handled the same failures via multiple paths
- Options: (a) keep all paths, (b) remove readiness itself and leave it to the renderer, (c) wait only for the fonts, local images, and registered promises that actually render, plus the browser's resource errors, releasing the gate with a single completion notification
- Adopted: (c). `document.fonts.ready` and image `decode()` are directly needed for pagination quality, and registered promises are needed as an explicit contract for user scripts. Fetching the entire manifest, by contrast, reads even resources the browser does not use, does not substitute for the actual load and decode, and doubles I/O. Success and failure can be expressed by the result of a single endpoint
- Rejection reasons: (a) reads the same assets twice — via prefetch and browser load — and increases endpoints and browser state. (b) reintroduces the race of pagination starting before font and image decoding, and the problem of treating user promise rejections as success
- Relation to trusted input: making `window.pfpdf` non-configurable, along with tamper detection, are security-only defenses and are removed. If a user script overwrites the registration API, that is the script's own contract violation, and no separate tamper-monitoring state is kept
- Risk: Asynchronous work that is dynamically generated and appears in none of the DOM images, fonts, static resource loads, or registered promises cannot be detected automatically. User work that affects pagination is registered via `registerReady`
- Verification: local and Docker smoke tests including fonts and local SVG, a browser E2E test for registered promise rejection, and tests for resource MIME / load failure, notification failure, timeout, gate release, child abort, and preservation of existing output
- Reconsideration conditions: if Vivliostyle provides an official pre-pagination async hook allowing the gate resource and loopback notification to be replaced with equivalent failure diagnostics
- Verification: keep the tests for local resources, byte ranges, readiness, YAML metadata types, language tags, and renderer startup. Tests of the security mechanisms themselves are removed
- Reconsideration conditions: if a service mode processing documents from arbitrary users is officially added. In that case, design a separate sandbox covering process, filesystem, and network rather than individual filters

## DD-20: Separate the builds of public documents and template previews

- Status: Accepted (2026-08)
- Problem: We want all bundled templates continuously tested with the real renderer, but we do not want PDFs generated with the corporate `pfn` template distributed as the standard documents of the public release. A single output directory risks same-named PDFs overwriting each other and previews mixing into release assets
- Options: (a) overwrite the same output using a `TEMPLATE` variable, (b) separate targets, output trees, and CI artifacts for public docs and per-template previews, (c) build PDFs only for `default` and cover the other templates with HTML unit tests alone
- Adopted: (b). `docs-release` explicitly uses `default` and generates into `build/docs/release/`, while `docs-template-<name>` and `docs-templates` generate the common sample into `build/docs/templates/<name>/`. The sample is at least 5 pages; only `compact`, which omits the standalone cover and starts the table of contents and body text on the first page, is at least 4 pages. No upper limit is placed on page count, so template-specific pagination is never unnaturally compressed. The sample in principle includes a table of contents of 2 or more pages plus long tables and code to cover the main features, but `compact` fits its two-column table of contents within the first page, testing that space efficiency itself. The canonical source of bundled templates is the manifest in the package resources, shared by Make and the CLI
- Rejection reasons: (a) makes the meaning of artifacts depend on build order and makes accidental attachment hard to prevent in a release workflow using broad globs. (c) cannot detect real-renderer regressions involving CSS, fonts, and pagination
- Risk: The `default` documents are rendered both for public use and for preview, and building all templates increases build time. With separate purpose-specific targets, the preview build can be skipped when only the release is needed
- Verification: unit-test the agreement of the manifest and template directories, and run `docs-release docs-templates docs-template-images` in CI. During imaging, check that PDFs have 5 or more pages with the table of contents continuing onto a second page and, as the exception, that `compact` has 4 or more pages with both the table of contents and body text on the first page. No upper page limit is checked. All pages become sequentially numbered PNG artifacts, the public artifact is the explicit path `build/docs/release/*.pdf`, and previews are a separate artifact
- Reconsideration conditions: if the growth of template count or document volume makes full-page imaging exceed the CI budget. Even then, keep the separation from public output and the periodic full-page review, and reconsider only the per-pull-request execution scope

## DD-21: The casual bundled template is a `notebook` not tied to a specific use

- Status: Accepted (2026-08)
- Problem: A bundled template is needed for friendly documents on the level of a travel itinerary, but restricting it to a specific use or brand hinders reuse, and a template differing only in color does not provide differences worth the maintenance cost
- Options: (a) a `travel` template with travel motifs and specific wording, (b) a color variant of an existing template, (c) a `notebook` template usable equally for notes, planning sheets, event guides, and booklets
- Adopted: (c). Warm and teal color fields and rounded tables of contents, quotes, tables, and task lists provide a casual page without attaching a fixed use-case name. No logo or use-specific assets are bundled
- Rejection reasons: (a) makes the context feel unnatural when used outside travel. (b) offers no use-case or typesetting criterion for choosing it over `default` and only increases the preview and regression-test surface
- Risk: Multicolor fields lose contrast in monochrome printing. Heading size, rules, backgrounds, and shapes are also used, so information is never carried by color alone
- Verification: verify the cover, multi-page table of contents, headings, task lists, quotes, tables, code, math, running header, and page number in the common template preview. Template slot expansion is checked in unit tests
- Reconsideration conditions: if usage shows a need to provide use-specific components such as travel or events as part of the template contract

## DD-22: The long-form bundled template differentiates its typesetting with existing fonts

- Status: Accepted (2026-08)
- Problem: A bundled template is needed for reading tutorials, textbooks, and long manuals chapter by chapter, but color-only variants or unverified additional fonts increase maintenance and distribution cost
- Options: (a) change only `default`'s color scheme, (b) keep Noto Sans JP and change only the page layout, (c) use the verified and already bundled Noto Serif JP for body text and titles, keeping the Noto Sans JP family for tables and code
- Adopted: (c). Chapter headings force page breaks, the text width and line height are tuned for long-form reading, and restrained warm colors, a running header, and a centered page number convey a book-like reading order. Body text and titles use Noto Serif JP, dense tables use Noto Sans JP, and code uses Noto Sans Mono; no logo or use-specific assets are bundled
- Rejection reasons: (a) differs little from `default` in use or typesetting. (b) is typographically weakly differentiated from ordinary Japanese books. Noto Serif JP is already pinned, bundled, and license-verified for `academic`, adding no new distribution dependency
- Risk: Switching to serif can change character widths, line breaks, and page counts. Tables remain sans-serif to keep their density, and pagination is verified with the common preview and the public documents' PDF smoke tests
- Verification: verify the cover, multi-page table of contents, per-chapter page breaks, long text, tables, code, math, running header, page number, and the typeface separation in the common template preview. Template slot expansion is checked in unit tests
- Reconsideration conditions: if the readability of serif body text or the page-count increase becomes a problem in real documents, or if chapter metadata is added to the template contract

## DD-23: The research-report bundled template prioritizes reproducibility and generality

- Status: Accepted (2026-08)
- Problem: A bundled template suited to papers and research reports is needed, but imitating a specific society's submission rules limits its use. Meanwhile, sans-serif body text alone is visually weakly differentiated from typical Japanese papers
- Options: (a) reproduce a specific society's paper format, (b) keep Noto Sans JP and change only the page layout, (c) add `academic`, pinning and bundling Noto Serif JP under SIL OFL 1.1 and providing serif body text, sans-serif headings, a restrained cover, continuous section structure, and typesetting for tables, math, figure captions, abstract, keywords, and references
- Adopted: (c). Without claiming any specific venue, it provides the visual hierarchy common to research reports, white papers, and survey reports. Body text uses Noto Serif JP, headings and tables use Noto Sans JP, with no dependence on OS fonts. `abstract`, `keywords`, and `references` provide appearance only, as raw HTML classes, adding no fixed labels or figure / table numbering, and nothing breaks with plain Markdown alone
- Rejection reasons: (a) cannot guarantee each venue's exact page size, column layout, and citation rules, and invites misunderstanding. (b) differs little typographically from `default` or `book`, giving a weak reason to choose it for papers
- Risk: Adding Noto Serif JP increases package and PDF size. It also differs from the two-column layout of typical academic journals. The font version and checksum are pinned in the lockfile, no conformance to submission rules is claimed, and custom templates are used when strict specifications exist
- Verification: verify the embedding of Noto Serif JP, the cover, table of contents, long text, tables, code, math, figure and figcaption, running header, and page number in the common template preview. Template slots and abstract expansion are checked in unit tests
- Reconsideration conditions: if citations, author affiliations, abstracts, or figure / table captions are added to the template contract as first-class metadata, or if a specific submission rule set is supported

## DD-24: The short-material bundled template omits the standalone cover

- Status: Accepted (2026-08)
- Problem: For meeting materials, internal memos, and short reports, `default`'s standalone cover and wide margins can consume more pages than the body, but simply shrinking the text harms readability, and `technical` carries a strong code-first connotation
- Options: (a) change only `default`'s color scheme, (b) pack maximally with two-column body text, (c) add `compact`, which has no standalone cover and combines a metadata header, a two-column table of contents, narrow page margins, and dense tables and code
- Adopted: (c). Title, author, date, confidentiality marking, and an optional logo are consolidated into a small header at the top of the first page, allowing the table of contents and body to start on the same page. The body remains single-column so that ordinary Markdown tables, code, and images are not squeezed into narrow columns. Body text has a lower bound of 9.5pt, reliance on color is restrained, and rules, weight, and background differences distinguish hierarchy even in black-and-white printing
- Rejection reasons: (a) does not reduce page count and offers no criterion for choosing it over `default`. (b) halves the usable width for long tables, code, URLs, and images, easily breaking down as a general-purpose template
- Risk: 9.5pt body text and narrow margins are unsuited to long reading sessions or bookbinding, and the two-column table of contents can become cramped with deep hierarchies or long headings. In such cases, use `default` or `book`, keeping `compact` for short handouts
- Verification: unit tests verify the metadata slots, table of contents, body, logo contract, and the absence of forced page breaks in the header. The common template preview is at least 4 pages with no upper limit. Verify that the two-column table of contents and body coexist on the first page, plus long tables, code, URLs, images, a deep table of contents, black-and-white-equivalent hierarchy, running header, and page number
- Reconsideration conditions: if real documents show insufficient readability of the 9.5pt body or the two-column table of contents, or if demand grows for cover omission as a general CLI option rather than a template

## DD-25: Textual information in bundled templates is limited to the user-specified series

- Status: Accepted (2026-08)
- Problem: Template-specific publication names, document types, brand names, table-of-contents titles, metadata prefixes, callout names, and figure / table numbering can attach meanings unrelated to the user's document to the final PDF. If replacement methods differ per template, the same document cannot be rendered with a different template
- Options: (a) keep fixed strings as part of the design, (b) add individual metadata per string, (c) have all bundled templates accept an optional `series` and add no other fixed textual information
- Adopted: (c). `series` is optional plain-text metadata, displayed at the primary label position of every bundled template. When unspecified, the slot element is removed. In templates that previously had multiple fixed label positions on the same page, only the primary position is repurposed for the series and the auxiliary positions are removed. Repetition in running headers uses a CSS named string rather than duplicating the same DOM slot
- Rejection reasons: (a) indicates affiliations or purposes that do not exist in the document. (b) grows the metadata contract with every template decoration and harms portability when switching templates
- Risk: Labels that templates previously supplied — abstract, keywords, note, figure / table numbering — are no longer displayed automatically. Only the table-of-contents title and its continuation display are generated from the document language, as renderer UI indicating document structure. All other textual information is specified explicitly by the user in Markdown or raw HTML, prioritizing a state where the information conveyed to the PDF can be determined from the input document alone
- Verification: unit tests verify the series type, its insertion in all bundled templates and removal when unspecified, the absence of fixed strings, and the named-string reference. The common preview specifies a series explicitly, and all PDFs and page images are regenerated for visual placement review
- Reconsideration conditions: if generic caption numbering or localization based on user input is designed as a document conversion feature outside templates

## DD-26: Continuation display for multi-page tables of contents uses a localized named string

- Status: Accepted (2026-08)
- Problem: When the table of contents splits across pages, the second and later pages read as a context-free list of links. Meanwhile, writing fixed Japanese into each template's CSS would not match the document language, and adding a new required slot to custom templates would broaden the existing contract unnecessarily
- Options: (a) no continuation display, (b) write a fixed label into each template's CSS generated content, (c) have the builder insert a continuation label matching the document language into a marker inside the table of contents, referenced as a CSS named string from each template's free margin box
- Adopted: (c). `.pfpdf-toc-continuation-marker` sets the `pfpdf-toc-continuation` named string, and each bundled template displays it via `first-except` only on pages other than the first table-of-contents page. An empty marker at the start of the body clears the string. This is a styling hook over the existing `toc` content and adds no DOM slot
- Rejection reasons: (a) makes a page unidentifiable on its own as a table-of-contents continuation. (b) duplicates localization per template and can output labels in a language different from the input. Running elements tend to occupy the same margin box as the existing running header, so a named string — letting each template choose a free dedicated margin box — is adopted instead
- Risk: This depends on the paged media renderer's implementation of named strings and `first-except`. Long translated labels may also not fit in the running header, so labels are limited to short structural names, and when a new language is introduced, the PDFs of all templates are checked
- Verification: unit tests check the ja / non-ja labels, the marker, the reset, and the `first-except` reference in all bundled templates. The common preview's table of contents spans 2 or more pages, and image generation checks, from the PDF text, the table-of-contents heading on page 2, the continuation label on page 3, and the label clearing on page 4. `compact` keeps its exception of the table of contents and body coexisting on the first page
- Reconsideration conditions: if the renderer standardly provides per-fragment repeated headings as HTML elements, or if the same localized continuation contract becomes needed beyond the table of contents

## DD-27: Insert `wbr` into long display strings on the HAST

- Status: Accepted (2026-08)
- Problem: URLs, email addresses, and long identifiers exceed the page width or the minimum content width of narrow table cells. CSS `overflow-wrap` alone cannot prioritize meaningful break points, and layout differences between templates are large
- Options: (a) use only `overflow-wrap: anywhere` in all templates, (b) insert zero-width spaces or soft hyphens into the Markdown source, (c) replace in the serialized HTML string, (d) insert `wbr` elements into visible text on the HAST
- Adopted: (d). Grapheme boundaries, semantic boundaries of URLs and identifiers, excluded contexts, and runs spanning inline elements can all be judged on the DOM structure. `wbr` is a display-level break opportunity and does not change the original text content, copy results, link destinations, or attributes
- Rejection reasons: (a) prevents overflow but cannot prioritize semantic boundaries. (b) can change code, link destinations, source positions, and copy results. (c) cannot safely distinguish text from attributes and can break escaping and raw HTML
- Pipeline: Applied as the final pass of the source section, after heading IDs, the table of contents, resource URLs, table decoration, MathJax, and syntax highlighting. It is included in the same `document.html` consumed by the local and Docker renderers, and no test-only pipeline is created
- Accessibility and raw HTML: The text itself is unchanged, adding no invisible characters to screen readers or copied text. Ordinary visible text in trusted raw HTML is in scope, but code, script, style, form values, SVG, MathJax, and `contenteditable` are fully preserved
- Risk: With many candidates, unnaturally short lines can result. A maximum of 16, a base minimum of 4, break-count minimization, semantic priority, and equalization are fixed with a bounded DP, verified against the PDF images of all templates and `pdftotext`
- Verification: check 15 / 16 / 17 / 31 / 32 / 33 graphemes, Unicode clusters, URL structure, identifiers, inline boundaries, attribute preservation, excluded contexts, idempotence, and very long runs with unit and full-pipeline fixtures. Render the common preview with all bundled templates and verify the extracted strings and page regions
- Reconsideration conditions: if HTML / CSS renderers consistently implement a standard feature treating semantic boundaries equivalently, or if real documents require changes to the thresholds or priorities

## DD-28: Mermaid becomes build-time SVG via a server-side DOM

- Status: Accepted (2026-08)
- Problem: Mermaid fences must be handled as figures in the PDF while satisfying network independence, identical static HTML for local and Docker, and fail-fast behavior on syntax errors. Vivliostyle requires SSR from frontend frameworks, and DOM generated asynchronously in the source document is not reliably reflected in the pagination input
- Options: (a) require users to pre-generate images, (b) render with a CDN or a bundled browser script, (c) generate build-time SVG in a separate headless browser process, (d) run a pinned Mermaid on a server-side DOM adapter and generate inline SVG, (e) make the SVG generated by (d) an external asset in the build workspace referenced from `img`, (f) expand SVG markers into ordinary paths with a custom implementation
- Adopted: (e). Before the renderer starts, the SVG is inspected and normalized on the HAST and serialized to `generated/mermaid-NNNN.svg`. Local, Docker, and the tests consume the same generated assets, requiring no browser process or CDN beyond the existing renderer. The external SVG avoids the loss of inline SVG marker references in Vivliostyle's pagination DOM while keeping vectors, in-SVG text, and deterministic IDs
- Rejection reasons: (a) is not support for Mermaid notation. (b) satisfies neither offline version pinning nor Vivliostyle's SSR constraint. (c) duplicates browser acquisition, processes, deadlines, and font environments. (d) is correct for the standalone generated SVG and direct Chrome PDF output, but after Vivliostyle typesetting the `marker-end` arrows disappear, leaving gaps at line ends. (f) requires reimplementing path tangents and the markers' viewBox / refX / orient / markerUnits, and tracking changes in the diagram types and markers Mermaid outputs. For edge labels, switching to HTML labels, fixed-offset background shifts, `tspan` baseline correction, and background removal were also considered, but were rejected because they respectively cause `foreignObject` dependence, font-size dependence, broken line spacing in multi-line labels, and loss of Mermaid's native label background; edge labels are therefore unsupported
- Security and error handling: `securityLevel: strict`, disabled HTML labels, and suppression of error rendering are fixed. Each diagram is rendered serially; source errors get file and line attached and exit with code `2`. Bundled runtime failures exit with code `1`, and no unrendered sources or error diagrams are left in a successful PDF
- Risk: The lightweight DOM's text measurement may not exactly match real-browser Mermaid. The SVG also becomes an independent document and does not inherit the outer document's CSS. The styles and font fallbacks Mermaid needs are fixed inside the SVG, and Mermaid, the adapter, and the DOM dependency are pinned in the lockfile. The `img` gets its alt text from Mermaid's accessible title / description, or a generic label if absent
- Verification: fence conversion, separation from ordinary code, deterministic asset names and IDs, marker definitions and references, syntax errors, arrows in real-browser and Vivliostyle PDFs, in-SVG text extraction, and PDF smoke tests with all templates
- Reconsideration conditions: if Mermaid officially provides an equivalent deterministic SVG API without a Node DOM, or if Vivliostyle provides an official document preprocessing hook

## DD-29: The academic template cover uses a double-rule masthead layout

- Status: Accepted (2026-08)
- Problem: The previous cover combined a thin single rule with a 24pt title, giving weak hierarchy between elements, and the central whitespace read as unintentional emptiness. Since series, confidential, logo, and author are all optional metadata, the cover needs a skeleton that looks natural under any combination
- Options: (a) a left-aligned layout with a double-rule masthead at the top (2.2pt thick rule + 0.6pt thin rule) and its mirror image (thin rule + thick rule) at the bottom enclosing the author / date line, (b) a full-bleed accent-color band across the middle of the cover with the title knocked out in white, (c) a symmetric, centered layout like a thesis title page
- Adopted: (a). The structure derives from academic-journal mastheads: series and logo sit above the top rule, and author and date sit between the bottom rules. The head keeps its height even when empty, so the title position does not shift with the presence or absence of metadata, and even with all metadata omitted the rule skeleton stands on its own as a letterhead. The title becomes 29pt with `text-wrap: balance`, and the short accent rule whose role overlapped with the masthead is removed. Decoration is CSS rules only; no new assets, slots, or fonts are added
- Rejection reasons: (b) has a large printed area, departs from the template's character as a "restrained cover", and strongly evokes a corporate report. (c) is close in impression to the `book` template's framed centered layout, and with no metadata the skeleton disappears and looks weak
- Risk: The double rule is realized with `::after` on `.academic-cover-head`, so no extra element is needed, but the rule spacing depends on a fixed offset. `text-wrap: balance` is simply ignored by renderers that do not support it, and wrapping itself is guaranteed by `overflow-wrap`
- Verification: visually inspect the page 1 image for the four combinations of series / confidential presence, logo presence, a long title (7 lines), and an English title, and check the rule specifications of the masthead and metadata lines in the template unit test
- Reconsideration conditions: if a requirement arises to display new metadata such as an abstract on the cover, or if the cover language of the bundled templates is redesigned uniformly

## DD-30: BibTeX citations combine TeX-style syntax with build-time CSL processing

- Status: Accepted (2026-08)
- Problem: Markdown sources need a way to reference `.bib` files and generate inline citations, a deterministic bibliography, and internal PDF links without changing the existing GFM, HAST, and Vivliostyle pipeline, the handling of single- and multi-file input, or the shared HTML used by local and Docker renderers
- Options: (a) assign `\ref{key}` to bibliography entries and write a custom formatter, (b) adopt Pandoc's `[@key]` and add a Pandoc process, (c) make `\cite{key}` a pfpdf parser extension and use Citation.js / citeproc-js at Node.js build time, (d) process `.bib` with a browser script
- Adopted: (c). The `.bib` is read once from the `bibliography` metadata of the first Markdown file, and the citation clusters of all sources are processed in a single citeproc session. The initial version provides one numeric style, `\cite{key1,key2}`, and an optional `\printbibliography` marker. When the marker is omitted, the list is appended to the end of the document, and users write an ordinary heading to reuse the existing ToC
- Rejection reasons: In (a), `\ref` is generic label referencing in TeX, colliding with future figure / table / equation / section references, and a custom formatter would reimplement entry types and locale rules. (b) creates output differences from the existing remark pipeline and adds an external executable to local and Docker. (d) delays input errors until after the renderer starts and adds assets, readiness handling, and mounts. Pandoc syntax has source-portability advantages; rather than claiming partial compatibility, it will be re-evaluated as a future alias
- Path resolution: A relative `.bib` is resolved against the parent directory of the front matter source. Absolute paths, `..`, and symlinks are allowed under the existing trusted-input policy; automatic discovery and last-wins are not adopted. Duplicate keys across multiple files are code `2`
- HTML: The processor's entry order is the canonical source of citation numbers, and entry HTML is converted into HAST fragments. pfpdf attaches encoded IDs, `doc-biblioref`, `doc-bibliography`, and a `doc-backlink` to every citing position. Templates only decorate the shared semantic DOM and hold no citation rules
- Risk: Dependence on conversion differences among Citation.js, citeproc-js, and CSL styles, package size, incomplete BibLaTeX compatibility, and English-locale labels. Versions and licenses are locked, and fixtures for Japanese, Unicode, TeX accents, `@string`, crossref, and DOIs / URLs, plus all-template PDFs, are maintained. Custom CSL, locators, and `\nocite` are separate specifications
- Verification: unit tests for input, parser, formatter, and semantic HTML, preservation of existing output on bibliography errors, all-template PDFs / page images / links / `pdftotext` of the common preview, and local / Docker E2E tests
- Reconsideration conditions: if VFM standardizes a citation syntax, if demand for Pandoc source portability grows, or if custom CSL, locators, or note styles for submission guidelines become first-class features

## DD-31: The pfn template generates its cover backdrop and artwork as one vector SVG

- status: Accepted (2026-08)
- Problem: The pfn template cover consisted only of the full-bleed blue gradient and the centered title block, which looked sparse. We want to reflect Preferred Networks' brand imagery (a triangulated network mesh and flowing light strands), but raster images trade file size against quality and are to be avoided. confidential / series / logo are all optional metadata, and every combination must look natural
- Options: (a) place brand photos or existing banners (raster) on the cover, (b) decorate with richer CSS gradients or geometric borders only, (c) deterministically generate the backdrop gradient, network mesh, and flow strands as one vector SVG
- Adopted: (c). `scripts/generate-pfn-cover-art.mjs` generates `resources/templates/pfn/cover-art.svg` with a fixed-seed PRNG and Delaunay triangulation, and both `style.css` (screen `header`) and `vivliostyle.css` (print `header::before`) reference it. The artwork is `wovenAiryCanopy`: a broad, sparse upper-left network mesh generated from minimum-distance points and faded with near-horizontal opacity and stroke-width falloff, plus two families of thin, tangent-continuous crossing curves along the bottom. Comparison studies are not retained in the implementation; the top-level `DESIGN` object controls colour, mesh, and wave tuning, and `--preview` emits only the current design to a separate directory. The central title band and the area around the Confidential badge remain calm zones with reduced artwork opacity
- color: To harmonize with the logo range `#141c77`–`#0293dd` without making the cover resemble a dark night sky, the backdrop moves from navy to vivid blue through the `#111b64`–`#19438f`–`#1b75b4` gradient. The screen and print fallbacks use the same colors and angle. Running headers from page 2 onward and primary body headings use the less green `#263c7f`; subordinate headings and rules use lighter shades of the same blue-violet family
- Rejection reasons: (a) conflicts with the template's no-image policy and the file-size requirement, and degrades when scaled. (b) gradient changes alone cannot express the brand's network motif, leaving the root cause of the sparseness
- risk: We measured that SVG referenced as a CSS background stays vector in Chromium's PDF output (zero raster images per pdfimages; the shared preview PDF grows by about 50KB). The SVG owns the visible backdrop gradient, while the matching CSS gradient is a loading fallback. The SVG carries a viewBox with 13mm bleed and `preserveAspectRatio: slice`, and is designed with margins so cover cropping never breaks the composition. The generator depends on no clock or environment, and a test verifies byte-for-byte equality with the bundled SVG
- Verification: visually inspect page 1 for the four confidential / series combinations, with and without a logo, and with a long (3-line) title; confirm with `pdfimages -list` that nothing is rasterized. Template unit tests check that the cover-art layer coexists with the badge rules
- Reconsideration conditions: if PFN provides official vector brand assets, if new metadata display requirements arise for the cover, or if the cover language of the bundled templates is redesigned uniformly

## DD-32: The official website uses Astro as its static site generator

- status: Accepted (2026-08)
- Problem: The official website published on GitHub Pages must combine a free-form landing page, a template gallery driven by `resources/templates/manifest.json`, and docs pages that read `docs/tutorial.{ja,en}` in place as the single source of truth, all in one build. The root `package.json` is the published npm package, so site dependencies cannot be mixed into it
- Options: (a) Astro, (b) Eleventy, (c) VitePress, (d) hand-rolled scripts
- Adopted: (a). Static output ships zero client JS by default, content collections with the glob loader read in-repository Markdown and JSON without copying, and file-based routing expresses the `/ja/` mirror naturally. Dependencies stay inside the independent `site/` `package.json` + lockfile
- Rejected because: (b) requires hand-building i18n, image optimization, and the asset pipeline. (c) is docs-focused, limits the LP and gallery, and adds a Vue dependency. (d) minimizes dependencies but loses on effort and maintenance
- Risk: Following Astro major updates is required. The site is an independent project and does not affect the core build, tests, or the npm package
- Verification: Confirmed the `site/` build does not affect the existing CI (lint / test / e2e), `check-package-policy.mjs`, or `check-doc-policy.mjs`
- Reconsider when: The chapter count or search requirements grow enough that a docs theme such as Starlight wins, or Astro maintenance stalls

## DD-33: The site deploys as a single orphan commit on the docs branch, with all internal links relative

- status: Accepted (2026-08)
- Problem: Delivery options are GitHub Pages branch serving and actions/deploy-pages. The repository is scheduled to move to `pfnet-research/pfpdf` and may later get a custom domain, so the org name and base path cannot be fixed in the sources
- Options: (a) actions/deploy-pages, (b) accumulate history on a docs branch, (c) force-push a single orphan commit to the docs branch
- Adopted: (c) plus relative links. `.github/workflows/pages.yml` builds the site on pushes to main and force-pushes one orphan commit to the docs branch (build outputs never bloat the repository history). The output root carries `.nojekyll`. Internal links in HTML / CSS are rewritten to page-relative paths by a post-build step (`site/scripts/relativize-links.mjs`); only canonical / hreflang / og:url / sitemap / 404 use absolute URLs derived from `SITE_URL` (defaulting from `GITHUB_REPOSITORY`). `site/scripts/check-links.mjs` verifies every reference on every build
- Rejected because: (a) was ruled out by request (migrating later is easy). (b) bloats the repository with generated history
- Risk: Force pushes discard manual edits on the docs branch, but the branch is a build artifact and is never edited by hand
- Verification: The build-time link check guarantees the output keeps working when placed under any subdirectory. A grep confirms the org name appears nowhere in the site sources or the workflow
- Reconsider when: A custom domain is introduced (overriding SITE_URL should suffice), or the deployment moves to deploy-pages

## DD-34: Gallery pages display WebP images generated from the sample PDFs

- status: Accepted (2026-08)
- Problem: The template gallery must show every page of each template's sample PDF on the web. Serving single-page PDFs directly in `<img>` would save bytes, but PDF-in-img is a WebKit / Safari-only feature and does not render in Chrome / Firefox (verified 2026-08)
- Options: (a) single-page split PDFs in `<img>`, (b) client-side rendering with PDF.js, (c) converting to WebP images at build time
- Adopted: (c). `scripts/build-site-assets.mjs` takes the outputs of `make docs-template-samples` (Japanese) and `docs-template-samples-en` (English), renders masters with `pdftoppm -r 180`, produces two WebP sizes with sharp (480px-wide thumbnails and 1500px-wide lightbox images), and records page counts and dimensions in `index.json`. The existing `render-template-preview-images.mjs` is verification tooling and stays unmodified
- Rejected because: (a) does not render in the major browsers. (b) ships a large JS runtime to clients, against the static, lightweight site policy
- Risk: Images total in the low tens of MB (7 templates × 2 languages × ~5–8 pages × 2 sizes), far below GitHub Pages limits
- Verification: Minimum page counts are checked for every template × language, and image dimensions flow from `index.json` into HTML `width` / `height` attributes for zero CLS
- Reconsider when: Chrome / Firefox support PDF-in-img (a `<picture><source type="application/pdf">` addition enables gradual adoption)

## DD-35: The site avoids unsolicited claims, and docs open at the first chapter

- status: Accepted (2026-08)
- Problem: The first version of the site showed a language-suggestion bar at the top whenever the browser language differed from the page language, a "Trust model" and a "Supported environments" section at the end of the landing page, and a chapter-list page as the entry point to the docs. The bar interrupts reading; "Trust model" states on the landing page a claim that belongs to README / SECURITY.md; "Supported environments" is docs material rather than landing-page material. The chapter-list page is only an extra click between the header's "Docs" link and actual content, because every docs page already shows the same list in its sidebar
- Options: (a) keep as is, (b) drop the bar and the two sections, and make the docs entry point the first chapter, (c) keep the chapter-list page but point the header link at the first chapter
- Adopted: (b). Language switching is handled solely by the header switch (per-language URLs and hreflang are unchanged). "Trust model" and "Supported environments" are removed; SECURITY.md and the docs are the sources for both. `/docs/` is kept as a redirect page to the first chapter (`meta refresh` plus `location.replace`, both with page-relative URLs) so existing links keep working. The first chapter's slug is derived from the head of `listChapters()` rather than hardcoded
- Rejected because: (a) leaves the problems in place. (c) leaves a near-unreachable chapter-list page in the sitemap and canonical set, duplicating maintenance
- Risk: Search engines that indexed `/docs/` may lose ranking until they follow the redirect. The redirect page is marked `noindex` and is excluded from the sitemap
- Verification: `check-links.mjs` verifies every link resolves after the build. A headless browser confirmed that `/docs/` and `/ja/docs/` land on the first chapter and that the header and footer links point there
- Reconsider when: The docs grow enough that the sidebar alone no longer gives a usable overview, or a safety explanation on the landing page is requested

## DD-36: The landing-page illustration renders from a dedicated document without confidential

- status: Accepted (2026-08)
- Problem: The "Markdown → PDF" illustration on the landing page reused page 1 of the gallery sample PDF (`docs/template-preview/sample.md`). That sample sets `confidential: true`, so the cover carries a red Confidential badge. The gallery should keep it — it doubles as a demonstration of the feature — but it is the wrong first impression for the landing page
- Options: (a) drop `confidential` from the sample, (b) add a `--confidential`-style CLI option and override it at build time, (c) post-process the image to erase the badge, (d) add a short dedicated document without `confidential`
- Adopted: (d). `docs/template-preview/hero.{md,en.md}` are new; `make docs-hero-sample` renders them with `HERO_TEMPLATE` (`pfn` by default). `build-site-assets.mjs` converts page 1 alone into `build/site-assets/hero/<lang>/cover.webp` plus an `index.json`, which the site reads through `loadHero()`. The Markdown snippet shown beside the image is no longer a literal inside the component either: `loadHeroSource()` reads the same file verbatim, so the input and the output on the page cannot disagree. The body stays a few lines and omits `series` so the snippet fits its box
- Rejected because: (a) removes the only worked example of confidential from the gallery. (b) grows the product CLI for the website's convenience. (c) post-processes an artifact, hurting reproducibility and maintainability
- Risk: Two extra PDFs are rendered for the hero, but both are about two pages and barely affect build time
- Verification: `make site-assets` produces the hero covers, and a headless browser confirmed the badge is absent on the landing page and still present in the gallery
- Reconsider when: Overriding front matter from the CLI lands for other reasons (the sample could then be reused directly)

## DD-37: Publish the npm package in the Organization scope

- Status: Accepted (2026-08)
- Problem: The originally planned unscoped package name `pfpdf` was unused, but the npm registry rejected its first publish with `E403` because it was confusingly similar to the existing `jspdf`. The official distribution must express Organization ownership while preserving the user-facing executable name `pfpdf`
- Options: (a) ask npm for an exception for the unscoped name, (b) choose another unscoped name, (c) use the Organization-scoped package `@pfnet-research/pfpdf`, (d) use the personal scope `@imostella/pfpdf`
- Adopted: (c). The Organization scope does not conflict with the registry-wide similarity restriction and matches the owner of the GitHub repository. The `bin` key in `package.json` remains `pfpdf`, so global installation keeps the executable name while direct execution uses `npx @pfnet-research/pfpdf@<version>`. `publishConfig` pins the public npm registry and public access
- Rejected because: (a) offers no guarantee that an exception will be granted and makes the release depend on an individual registry decision. (b) still changes the user-facing package name and does not identify the official Organization distribution. (d) differs from the intended final owner, and a scoped package cannot later move to another scope
- Risk: The `npx` package spec becomes longer, and every existing `npx pfpdf` example must change
- Verification: Inspect the package name, public access, and tarball contents with `npm pack --dry-run`; install the tarball into an empty temporary project and run the `pfpdf` executable. After publishing, verify `npx @pfnet-research/pfpdf@<version> --version` through the registry
- Reconsider when: The Organization or registry naming policy changes before the first publish. After the first publish, moving to another package would be a user-facing breaking change and is not reconsidered as an ordinary rename

## DD-38: Separate the release PR from gated build-once publishing

- Status: Accepted (2026-08)
- Problem: We need to automate version / CHANGELOG decisions, verification of the npm tarball and four documentation PDFs, and npm plus GitHub Release publication while avoiding unconditional publication on every `main` merge, rebuilding after approval, and long-lived npm tokens. PRs and tags created by Release Please with the default `GITHUB_TOKEN` do not emit normal workflow events because of recursion prevention
- Options: (a) publish immediately with semantic-release after every merge to `main`, (b) have a maintainer manage versions, tags, CHANGELOG, and publish commands manually, (c) separate a Release Please release PR and tag-backed draft Release from build-once staging at the tag source, GitHub Environment approval, npm trusted publishing, and post-publication verification
- Adopted: (c). Release Please maintains a release PR from Conventional Commits, while PR review decides the version and notes. A short-lived installation token from a release GitHub App scoped to this repository creates the PR and tag. The tag workflow builds the npm tarball and four PDFs exactly once, checks the same tarball on four environments, completes the PDF set on the draft Release, and publishes to npm via OIDC after approval in the `release` Environment. The GitHub Release becomes public only after verifying the exact version from the public registry
- Rejected because: (a) delegates release timing and `0.x` version judgment to commit prefixes alone and has no pre-publication artifact review. (b) leaves lockfile, tag, and artifact correspondence to manual operation and provides weaker evidence that the same source produced the distributed artifacts. Using the default `GITHUB_TOKEN` for Release Please cannot start required CI on its generated PR or the tag workflow, so that variant is also rejected
- Scope: Docker images are not release artifacts. Independently of the planned removal of the Docker renderer, the official user-facing distribution is npm and the accompanying documents are delivered through GitHub Releases
- Risk: GitHub App, Environment, and npm trusted-publisher settings must be configured outside the repository. Limit App permissions to the necessary Contents / Pull requests / Issues operations, pin actions to commit SHAs, and detect configuration drift with workflow lint and an operations checklist. A non-atomic interval remains if publishing the GitHub Release fails after npm succeeds; keep the draft, compare registry integrity with the identical tarball, and resume finalization only
- Verification: release-helper unit tests; tag / lock / CHANGELOG consistency checks; npm pack allowlist; packed-package install / `npm ls` / real PDF smoke tests on four environments; exact four-PDF set and checksums; draft-asset inspection; and an exact-version smoke test from the public registry
- Reconsider when: the repository contains multiple packages, npm staged publishing is adopted to add npm-side 2FA approval to the release gate, or GitHub / npm provides transactional promotion across multiple artifacts
