# 4. Resources, fonts, and templates

## 4.1 Bundled fonts

pfpdf bundles redistributable Japanese fonts in multiple weights, including Noto Sans JP and Noto Serif JP. It always references the copies in the npm package, independently of fonts installed on the host OS.

- Specify body, heading, and code fonts explicitly
- Do not list OS-specific fonts first in CSS font declarations
- The host font feature is disabled by default; normal runs do not scan the host OS font directories
- Provide a minimal smoke test for representative documents using the bundled fonts: the PDF can be generated, and body text containing Japanese can be extracted with `pdftotext`
- If font subsetting or format conversion is performed, verify that the original license permits modification and that any Reserved Font Name conditions are met. Make the generation procedure reproducible

All bundled templates default to CSS `text-autospace: normal` on elements whose `lang` has `ja` as its primary language subtag. This adds visual spacing between Japanese text and Latin letters or digits. Elements that explicitly specify another language reset the policy. The `code` / `pre` / `kbd` / `samp` / `textarea` elements, SVG, MathML, and math are excluded. Preserve authored spaces and punctuation; no characters are inserted into source, DOM text, URLs, or identifiers. User CSS can override this with `text-autospace: no-autospace`. Unsupported browsers continue conversion without added spacing.

Verify actual PDFs generated with Vivliostyle 11.1.0 and its default Chrome 150, using both bundled sans and serif fonts. PDF extractors may reconstruct visual gaps as whitespace.

## 4.2 Explicitly enabling host fonts

- `--host-fonts` scans the standard OS font directories, and repeated `--font-dir PATH` options add scan locations
- `--font-dir` itself is also treated as an explicit opt-in limited to that directory, usable without `--host-fonts`
- On macOS, the standard scan candidates are `~/Library/Fonts`, `/Library/Fonts`, `/System/Library/Fonts`, and `/System/Library/Fonts/Supplemental`
- Permitted font files are served to the renderer by `AssetServer` on a loopback address
- User-specified host font files are never copied into the package, workspace, or cache. Only a temporary font index, `@font-face` CSS, and fontconfig metadata for Linux are generated
- Fonts whose OpenType `OS/2.fsType` or similar metadata indicates that PDF embedding is prohibited are excluded from the candidates. If static CSS requires that family or face and no fallback is possible, use exit code `2` for a user-specified font, or `1` for a bundled font to indicate a package inconsistency. Issue warnings for unused candidates and formats whose restrictions cannot be determined; never assume permission
- Apply the same embedding check to all local and `data:` fonts identified as font resources in static URLs in templates, Markdown, raw HTML, and CSS, as well as candidates discovered via `--font-dir`. Remote font licenses and contents cannot be inspected, just as fetching them cannot be guaranteed. Users are responsible for these fonts; do not use them in reproducible standard documents
- Technical support for referencing a host font does not imply permission to embed it in a PDF; users must verify each font's license terms
- Output that uses host fonts depends on the OS and on font updates, and identical appearance to a reference build is not guaranteed

## 4.3 `FontResolver`

- Bundled fonts are always available; if host fonts are disabled, no OS font discovery is performed
- Builds the set of permitted directories from `--host-fonts` and any explicitly given `--font-dir`
- The scan priority is: the additional font directories in CLI `--font-dir` order, then the fixed order of standard OS directories added by `--host-fonts`, then the bundled fallback
- Reads family, weight, style, and stretch from the OpenType name table and generates temporary `@font-face` CSS that references each adopted face by logical font URL. `--font-dir` adds candidates that template and document CSS can select by family name; it does not automatically apply fonts to body text
- Generates CSS with font URLs reachable from the renderer's execution environment, and passes renderer-internal fontconfig metadata only where needed
- Extracts the non-generic families required by the bundled templates' static CSS and enables only the faces that are found. Missing families produce warnings with source locations. Template tests guarantee that the bundled fallback appears at the end of the `font-family` list. The choice of font is not guaranteed for dynamic properties in custom or directly authored CSS
- Only formats verified with Chromium — TTF, OTF, TTC, WOFF2, and so on — are targeted. TTC face indices, variable font axes, and weight/style mappings are verified by fixtures, and unsupported formats or faces are reported with reasons in `--doctor`
- Directories are traversed recursively in deterministic file name order, but symlinked directories are not followed. Symlinked files are candidates only if their target is a regular file; candidates are deduplicated by their canonical path after resolving symlinks
- When the same family/weight/style/stretch has multiple candidates, the file earlier in scan priority is adopted and the conflict is reported as a warning. There is no dependence on filesystem enumeration order or on "the last file found"
- OpenType table directories, offsets, lengths, and collection face counts are checked against the file size, treating integer overflow and out-of-range reads as input errors. Tables per face and faces per collection are each capped at 4096 to prevent implausible font headers from consuming excessive CPU or memory
- Family names and logical font URLs are escaped as CSS string and URL tokens; font metadata is never concatenated raw into CSS source
- Font files are not copied; the temporary CSS, index, and fontconfig metadata are deleted on exit
- The font families, the files actually selected, and the results of the embedding restriction checks can be inspected via the debug log and `--doctor`
- Since Chromium can itself access OS fonts, the default guarantee extends only to pfpdf not scanning host directories and bundled templates not requiring host families. Documents that require reproducibility do not request OS-specific families from custom or directly authored CSS
- `local()` sources in custom or directly authored CSS go through the browser's own discovery, so the actual file and its embedding restriction flag cannot be identified in advance; a warning is emitted when they are used. In bundled templates, `local()` is forbidden; only checked logical font URLs and generic fallbacks are used

## 4.4 Separation of templates and logos

`v0.1.0` bundles the following templates:

- `academic`: a restrained design for research reports
- `book`: a calm design for long-form text
- `compact`: a space-saving design for short meeting materials and internal memos
- `default`: a neutral design
- `notebook`: a warm, casual design for booklets
- `pfn`: a design for corporate documents
- `technical`: a dense design for technical documents that emphasize code and tables

Bundled templates include no logo whose license has not been verified, and every template, including `pfn`, works without one.

```text
resources/templates/
  academic/
    template.html
    style.css
    vivliostyle.css
  book/
    template.html
    style.css
    vivliostyle.css
  compact/
    template.html
    style.css
    vivliostyle.css
  default/
    template.html
    style.css
    vivliostyle.css
  notebook/
    template.html
    style.css
    vivliostyle.css
  pfn/
    template.html
    style.css
    vivliostyle.css
  technical/
    template.html
    style.css
    vivliostyle.css
```

- Select a bundled template with Markdown front matter `template`, or with `--template SOURCE` when the source exactly matches a bundled name. With multiple files, the first supplied `template` is used. `--template-preset NAME` explicitly requires a bundled preset. CLI arguments take precedence over front matter
- A custom template or one obtained from a repository may declare a default logo by putting a path relative to the template directory in the `src` of its `logo` slot. Bundled templates have no default logo
- Front matter `logo` accepts a local path or `false`. CLI `--logo SOURCE` accepts a local path or Git locator and overrides front matter and the template default; `--no-logo` disables both
- If no logo is explicitly specified and the slot has no `src`, the logo element itself is not emitted. No broken image placeholder is left behind
- A relative front matter logo path is resolved from the parent directory of the Markdown file that first supplies `logo`; a relative CLI logo path is resolved from the current directory
- The logo and template are trusted input; only their existence and readability are pre-checked. Their content is not sandboxed

## 4.5 Custom templates

- A plain `--template SOURCE` value that does not exactly match a bundled preset name is a custom-template directory path. To select a same-named directory, use an unambiguous path spelling such as `./default`
- Custom template paths are accepted only from the CLI, not from front matter
- Custom templates are treated like trusted local code, with explicit documentation that they may execute raw HTML and scripts
- The custom template format has no `apiVersion`, JSON Schema, or cross-version compatibility guarantee. Users who need to preserve a template's appearance and structure should pin the pfpdf version. Within a given version, the following DOM slot contract prevents ambiguous string substitution
- A custom template directory contains `template.html`, `style.css`, and `vivliostyle.css` directly. Only the presence of the files required by the selected pfpdf version is checked

### 4.5.1 Fetching from Git repositories

- `--template 'git::URL//PATH?ref=REVISION'` selects a custom template directory inside a Git repository. `--logo` uses the same form to select a regular file
- `PATH` is a `/`-separated relative path from the repository root. Subdirectories are allowed; absolute paths, empty components, `.`, `..`, and backslashes result in exit code `2`. A template must select a directory and a logo a regular file
- Supported URL schemes are `https://`, `ssh://`, and `file://`; `file://` is for local use and tests. Passwords and HTTPS userinfo are rejected to avoid credential disclosure. Private repositories authenticate through a Git credential helper or SSH agent
- `ref` accepts a branch, tag, or commit. If omitted, remote `HEAD` is used and the resolved commit is reported as a warning. Reproducible CI should specify a full commit hash
- A repository source is checked out under an OS temporary directory at depth 1, with a detached HEAD and submodules disabled. The checkout for the same URL / ref is shared within one process. There is no persistent cache; a conversion checkout lives in the build workspace and is reclaimed with it, subject to `--keep-work-dir`
- Locator syntax, path, and file-type errors result in exit code `2`. Git startup, network, authentication, fetch / checkout failures, and timeouts result in exit code `1`. The timeout during conversion is 300 seconds, and the external-process check by `--doctor` has a 10-second timeout. Git is launched with an argument array rather than a shell, with interactive prompts disabled
- Repository templates remain trusted code. Front matter cannot select one; only an explicit CLI selection causes network access and template-script execution

### 4.5.2 DOM slot contract

`template.html` is a complete HTML document that declares insertion points with the `data-pfpdf-slot` attribute.

| Slot | Count | Inserted content |
|---|---:|---|
| `content` | Required, 1 | Body containing one section per source file |
| `cover` | Optional, 0 or 1 | Entire cover or leading header; removed as an element when `cover: false` |
| `title` | Optional, 0 or 1 | Title. Only the allowed `<br>` is preserved as an element |
| `author` | Optional, 0 or 1 | Author text |
| `series` | Optional, 0 or 1 | Series text |
| `date` | Optional, 0 or 1 | Date text |
| `confidential` | Optional, 0 or 1 | Displayed only when `confidential: true` |
| `toc` | Optional, 0 or 1 | Table of contents. Without the slot, it is inserted at the top of `content` |
| `logo` | Optional, 0 or 1 | Sets the `img` element's `src` / `alt` |

- The DOM is built with an HTML5 parser, checking for the presence of `html`, `head`, `body`, and the `content` slot, for duplicates of the same slot, and for unknown slots. The doctype, IDs, attributes outside slots, and the validity of trusted HTML are not redundantly checked
- The builder sets the root `html` element's `lang` / `dir` to the metadata's canonical language tag and direction. Fixed template values and the host locale are not given precedence
- The builder parses the template as an inert DOM and replaces the child nodes of slot elements via DOM APIs. Metadata is never string-interpolated into the template source
- The builder inserts a heading and a continuation label for the table of contents according to the document language. The `.pfpdf-toc-continuation-marker` element provides the continuation label as a named string, which templates style in paged media margin boxes. An empty marker immediately after the table of contents clears the named string, so the continuation label does not carry over onto body pages. This styling hook adds no new DOM slot and does not change the `toc` slot contract
- The `logo` slot is specified on an `img` element. Its own `src` is the template default logo and is resolved as an ordinary resource relative to the template directory. An explicit logo replaces `src` with its logical URL, while other attributes such as `class` are preserved. If the template provides no `alt`, the builder sets `alt=""` to mark the image as decorative
- If an explicit logo is specified but there is no `logo` slot, the user's specification is not silently dropped; the result is exit code `2`. If neither a default `src` nor an explicit logo exists, or if `--no-logo` is given, the slot element itself is removed
- If `author` or `series` is unspecified, the corresponding slot element itself is removed. The title always has an explicit or inferred value and the date an explicit or generated value, so if those slots exist their content is always set
- All bundled templates have a `series` slot and add no fixed publication name, document type, brand name, table of contents name, metadata prefix, callout name, or figure/table numbering. To also display the series in running headers, use a named string rather than duplicating the same slot
- When `confidential: false`, the `confidential` slot element itself is removed. Only when it is true does the slot remain in the template, with the display text set by the builder. Bundled templates display it on the cover or leading header and on every subsequent page, including the table of contents and body, in template-specific styling
- With `--no-toc`, the `toc` slot is removed and nothing is inserted into the content either
- `cover: false` / `--no-cover` removes the `cover` slot. The `content` / `toc` slots cannot be inside it, and `html` / `head` / `body` cannot themselves be the cover. A custom template without a `cover` slot declares no cover, so the toggle is a no-op
- Omitting the cover also omits its visual title / author / date / logo, while retaining the HTML title and PDF metadata. Series / Confidential named-string sources move to a non-painted marker, preserving running information on bundled-template contents and body pages. Custom templates should put their own running elements outside the cover slot
- The `body` receives a `pfpdf-has-cover` or `pfpdf-no-cover` class. Bundled standalone covers use the `pfpdf-cover` named page; `compact` uses the `:first` rule of its own named page to keep its header and body on one page. Cover-specific first-page exceptions do not apply to body pages when the cover is omitted
- Scripts do not run until the final `document.html` is loaded in the browser. Register asynchronous work in template scripts with the document readiness mechanism
- `style.css` is loaded as common styles and `vivliostyle.css` as paged media styles, in that order. Both pass through the resource graph, which resolves `@import` and `url()`

## 4.6 `TemplateResolver` and `HtmlDocumentBuilder`

- `TemplateResolver` resolves the bundled template name or the custom template directory, validating the file types, readability, and DOM slot contract required by the current pfpdf version
- Templates and CSS are shipped as npm package resources
- The logo path is kept separate from the template and, only when specified, converted into a URL referenceable from the workspace
- Package and input assets are referenced via `ResourceResolver` logical URLs. Assets are not embedded as data URLs to produce a single HTML file, and there is no separate HTML builder for each renderer
- MathJax and highlight.js are build-time transforms that use modules in the package; the generated HTML does not reference them as browser scripts
- The `document.html` generated by `HtmlDocumentBuilder` is served byte-for-byte unchanged by `AssetServer`, and that URL is passed to the Vivliostyle CLI. Integration tests also inspect both the builder output and the served bytes
- Metadata passes type validation appropriate to each slot's node or text context; unvalidated values are never passed into naive string substitution. No slot inserts metadata into CSS or attribute names
- The in-browser `ReadinessCoordinator` aggregates fonts, local / data URL / remote images, user-registered promises, and resource load errors, conveying timeouts and JavaScript errors to the renderer
- Image resource-resolution diagnostics include the original Markdown / template HTML path, line number, and authored destination. Line numbers account for stripped front matter; diagnostics for missing local files also include the resolved path. A static Markdown image with an empty URL is an input error (code `2`)
- Raw HTML `img` elements are not rejected indiscriminately during input preparation because scripts may set `src`. After promises registered with the document readiness mechanism finish, check `src` / `srcset` and whether decoding succeeds. Empty or absent destinations, corrupt data, and HTTP / network failures are runtime errors (code `1`). Keep source positions and destinations in diagnostic DOM attributes, including on generated SVG images. For images newly created by scripts without an identifiable origin, report `document.html` and their current URL
- Browsers do not expose image HTTP status to document scripts, so load / decode errors report authored destinations and resolved URLs. Diagnostic URLs are limited to 256 characters each, and readiness notification messages to 1024 characters. Preserve existing output on failure

## 4.7 Version management of bundled assets

- The bundled MathJax uses the current maintained major version (3.x or later), enabling the `$` / `$$` delimiters and the equivalent of `processEscapes`
- The bundled highlight.js uses the 11.x line, normalizing language aliases and loading assets only for the languages actually used. Code with an unknown language name is preserved as plain text, with a warning that includes the source location
- The versions, licenses, and sources of MathJax, highlight.js, and the fonts are listed in `THIRD_PARTY_LICENSES.md`
- Resource paths at CLI startup are resolved from the ES module package location, independent of `process.cwd()` and the npm cache layout

## 4.8 Bibliography input and style

The `.bib` files referenced by front matter are input files read in full at build time. Unlike images, CSS, and fonts, they do not enter the browser's resource graph. They therefore require no `AssetServer` logical URL or fetch during preparation for rendering. Relative paths are resolved against the parent directory of the source file containing the front matter. Absolute paths and `..` are allowed under the trusted-input policy, although the tutorial recommends a portable relative layout.

Citation.js, citeproc-js, and the CSL style and locale in use are pinned in the lockfile and the published shrinkwrap, with licenses and sources recorded in `THIRD_PARTY_LICENSES.md`. The HTML returned by CSL is parsed as HAST fragments rather than inserted as a wrapper around the document. pfpdf adds stable classes, IDs, ARIA roles, and backlinks. All bundled templates share the structural rules in `common.css` / `common-vivliostyle.css`, and no template-specific CSS adds bibliography semantics or fixed labels.
