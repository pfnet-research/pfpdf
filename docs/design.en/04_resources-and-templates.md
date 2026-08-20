# 4. Resources, fonts, and templates

## 4.1 Bundled fonts

pfpdf bundles redistributable Japanese fonts in multiple weights, including Noto Sans JP and Noto Serif JP. It always references the copies in the npm package, independently of fonts installed on the host OS.

- Specify body, heading, and code fonts explicitly
- Do not place OS-specific fonts at the head of the CSS font lists
- The host font feature is disabled by default; normal runs do not scan the host OS font directories
- Provide a minimal smoke test for representative documents using the bundled fonts: the PDF can be generated, and body text containing Japanese can be extracted with `pdftotext`
- If font subsetting or format conversion is performed, verify that the original license permits modification and check any Reserved Font Name conditions, and make the generation procedure reproducible

## 4.2 Host font opt-in

- `--host-fonts` scans the standard OS font directories, and repeated `--font-dir PATH` options add scan locations
- `--font-dir` itself is also treated as an explicit opt-in limited to that directory, usable without `--host-fonts`
- On macOS, the standard scan candidates are `~/Library/Fonts`, `/Library/Fonts`, `/System/Library/Fonts`, and `/System/Library/Fonts/Supplemental`
- The renderer serves permitted font files from the loopback `AssetServer`
- User-specified host font files are never copied into the package, workspace, or cache. Only a temporary font index, `@font-face` CSS, and fontconfig metadata for Linux are generated
- Fonts that can be determined from OpenType `OS/2.fsType` and similar data to prohibit embedding in PDFs are excluded from the candidates. If static CSS demands that family or face and no fallback is possible: exit code `2` for a user-specified font, or `1` — a package inconsistency — for a bundled font. Unused candidates, and formats whose restrictions cannot be determined, produce warnings; permission is never assumed
- The same embedding check applies not only to candidates discovered via `--font-dir` but to every local or `data:` font discovered in a font role among the static URLs in templates, Markdown, raw HTML, and CSS. Remote font licenses and contents cannot be inspected, just as fetching them cannot be guaranteed, so they are the user's responsibility; do not use them in reproducible standard documents
- Technical support for referencing a host font does not imply permission to embed it in a PDF; users must verify each font's license terms
- Output that uses host fonts depends on the OS and on font updates, and identical appearance to a canonical build is not guaranteed

## 4.3 `FontResolver`

- Bundled fonts are always available; if host fonts are disabled, no OS font discovery is performed
- Builds the set of permitted directories from `--host-fonts` and any explicitly given `--font-dir`
- The scan priority is: the effective list of additional font directories, then the fixed order of standard OS directories added by `--host-fonts`, then the bundled fallback. The additional list uses only the CLI `--font-dir` order if at least one is given, and otherwise the order of the `PFPDF_FONT_DIRS` environment variable
- Reads family, weight, style, and stretch from the OpenType name table and generates temporary `@font-face` CSS that references each adopted face by logical font URL. `--font-dir` is not an option that automatically selects fonts into the body; it adds candidates that template and document CSS can select by family name
- Generates CSS with font URLs reachable from the renderer's execution environment, and passes renderer-internal fontconfig metadata only where needed
- Extracts the non-generic families demanded by the bundled templates' static CSS and enables only the faces that are found. Families that are not found become warnings with source locations, and template tests guarantee that the bundled fallback appears at the end of the font-family list. Selected fonts are not guaranteed for dynamic properties in custom or raw CSS
- Only formats verified with Chromium — TTF, OTF, TTC, WOFF2, and so on — are targeted. TTC face indices, variable font axes, and weight/style mappings are verified by fixtures, and unsupported formats or faces are reported with reasons in `--doctor`
- Directories are traversed recursively in deterministic file name order, but symlinked directories are not followed. Symlinked files are candidates only if their resolution target is a regular file, deduplicated by canonical path
- When the same family/weight/style/stretch has multiple candidates, the file earlier in scan priority is adopted and the conflict is reported as a warning. There is no dependence on filesystem enumeration order or on "the last file found"
- OpenType table directories, offsets, lengths, and collection face counts are checked against the file size, treating integer overflow and out-of-range reads as input errors. Tables per face and faces per collection are each capped at 4096, so headers implausible for an ordinary font cannot consume excessive CPU or memory
- Family names and logical font URLs are escaped as CSS string and URL tokens; font metadata is never concatenated raw into CSS source
- Font files are not copied; the temporary CSS, index, and fontconfig metadata are deleted on exit
- The font families, the files actually selected, and the results of the embedding restriction checks can be inspected via the debug log and `--doctor`
- Since Chromium can itself access OS fonts, the default guarantee extends only to pfpdf not scanning host directories and bundled templates not demanding host families. Documents that require reproducibility do not request OS-specific families from custom or raw CSS
- `local()` sources in custom or raw CSS go through the browser's own discovery, so the actual file and its embedding flag cannot be identified in advance; a warning is emitted when they are used. In bundled templates, `local()` is forbidden; only checked logical font URLs and generic fallbacks are used

## 4.4 Separation of templates and logos

`v0.1.0` bundles seven templates: the restrained `academic` for research reports; the calm `book` for long-form text; the space-saving `compact` for short meeting materials and internal memos; the neutral `default`; the warm, casual, booklet-style `notebook`; the corporate `pfn`; and the dense `technical` for documents that emphasize code and tables. Bundled templates include no logo whose license has not been verified, and every template, including `pfn`, works without one.

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

- Select a bundled template with the first Markdown file's front matter `template`, or with `--template SOURCE` / `PFPDF_TEMPLATE` when the source exactly matches a bundled name. `--template-preset NAME` / `PFPDF_TEMPLATE_PRESET` explicitly requires a bundled preset. Environment variables and CLI arguments take precedence over front matter
- A custom or repository template may declare a default logo by putting a template-relative path in the `src` of its `logo` slot. Bundled templates have no default logo
- `--logo SOURCE` / `PFPDF_LOGO` accepts a local path or Git locator and overrides the template default. `--no-logo` disables both the environment value and the template default
- If no logo is explicit and the slot has no `src`, the logo placeholder itself is not emitted. No broken image placeholder is left behind
- A relative logo path is resolved against the current directory
- The logo and template are trusted input; only their existence and readability are pre-checked. Their content is not sandboxed

## 4.5 Custom templates

- A plain `--template SOURCE` / `PFPDF_TEMPLATE` value that does not exactly match a bundled preset name is a custom-template directory path. To select a same-named directory, use an unambiguous path spelling such as `./default`
- Custom template paths are accepted only from the CLI or environment, not from front matter
- Custom templates are treated like trusted local code, with explicit documentation that they may execute raw HTML and scripts
- The custom template format has no `apiVersion`, JSON Schema, or cross-version compatibility guarantee. Users who need to preserve a template's appearance and structure should pin the pfpdf version. Within a given version, the following DOM slot contract prevents ambiguous string substitution
- A custom template directory contains `template.html`, `style.css`, and `vivliostyle.css` directly, and only the presence of the files required by the selected pfpdf version is checked

### 4.5.1 Git repository sources

- `--template 'git::URL//PATH?ref=REVISION'` / `PFPDF_TEMPLATE` selects a custom template directory inside a Git repository. `--logo` / `PFPDF_LOGO` uses the same form to select a regular file
- `PATH` is a `/`-separated relative path from the repository root. Subdirectories are allowed; absolute paths, empty components, `.`, `..`, and backslashes are code `2`. A template must select a directory and a logo a regular file
- Supported URL schemes are `https://`, `ssh://`, and `file://`; `file://` is for local use and tests. Passwords and HTTPS userinfo are rejected to avoid credential disclosure. Private repositories authenticate through a Git credential helper or SSH agent
- `ref` accepts a branch, tag, or commit. If omitted, remote `HEAD` is used and the resolved commit is reported as a warning. Reproducible CI should specify a full commit hash
- A repository source is checked out under an OS temporary directory at depth 1, detached HEAD, with submodules disabled. The same URL / ref is shared within one process. There is no persistent cache; a conversion checkout lives in the build workspace and is reclaimed with it, subject to `--keep-work-dir`
- Locator syntax, path, and file-type errors are code `2`; Git startup, network, authentication, fetch / checkout failures, and timeouts are code `1`. The conversion timeout is 300 seconds and a doctor's external-process check is 10 seconds. Git is launched with an argument array rather than a shell, with interactive prompts disabled
- Repository templates remain trusted code. Front matter cannot select one; only an explicit CLI or environment selection causes network access and template-script execution

### 4.5.2 DOM slot contract

`template.html` is a complete HTML document that declares insertion points with the `data-pfpdf-slot` attribute.

| Slot | Count | Inserted content |
|---|---:|---|
| `content` | Required, 1 | Body containing one section per source file |
| `title` | Optional, 0 or 1 | Title. Only the allowed `<br>` is preserved as an element |
| `author` | Optional, 0 or 1 | Author text |
| `series` | Optional, 0 or 1 | Series text |
| `date` | Optional, 0 or 1 | Date text |
| `confidential` | Optional, 0 or 1 | Displayed only when `confidential: true` |
| `toc` | Optional, 0 or 1 | Table of contents. Without the slot, it is inserted at the top of the content |
| `logo` | Optional, 0 or 1 | Sets the `img` element's `src` / `alt` |

- The DOM is built with an HTML5 parser, checking for the presence of `html`, `head`, `body`, and the `content` slot, for duplicates of the same slot, and for unknown slots. The doctype, IDs, attributes outside slots, and the validity of trusted HTML are not redundantly checked
- The builder sets the root `html` element's `lang` / `dir` to the metadata's canonical language tag and direction. Fixed template values and the host locale are not given precedence
- The builder parses the template as an inert DOM and replaces the child nodes of slot elements via DOM APIs. Metadata is never string-interpolated into the template source
- The builder inserts a heading and a continuation label for the table of contents according to the document language. The continuation label is provided as the named string `.pfpdf-toc-continuation-marker`, which templates style in paged media margin boxes. An empty marker immediately after the table of contents clears the named string, so the continuation label does not carry over onto body pages. This styling hook adds no new DOM slot and does not change the `toc` slot contract
- The `logo` slot is specified on an `img` element. Its own `src` is the template default logo and is resolved as an ordinary resource relative to the template directory. An explicit logo replaces it with a logical `src`, while other attributes such as classes are preserved. If the template provides no `alt`, the builder sets `alt=""` to mark the image as decorative
- If an explicit logo is specified but there is no `logo` slot, the user's specification is not silently dropped; the result is exit code `2`. If neither a default `src` nor an explicit logo exists, or if `--no-logo` is given, the slot element itself is removed
- If `author` or `series` is unspecified, the corresponding slot element itself is removed. The title is required and the date always has an explicit or generated value, so if those slots exist their content is always set
- All bundled templates have a `series` slot and add no fixed publication name, document type, brand name, table of contents name, metadata prefix, callout name, or figure/table numbering. To also display the series in running headers, use a named string rather than duplicating the same slot
- When `confidential: false`, the `confidential` slot element itself is removed. Only when it is true does the slot remain in the template, with the display text set by the builder. Bundled templates display it on the cover or leading header and on every subsequent page, including the table of contents and body, in template-specific styling
- With `--no-toc`, the `toc` slot is removed and nothing is inserted into the content either
- Scripts do not run until the final `document.html` is loaded in the browser. Asynchronous work in template scripts registers with the readiness contract
- `style.css` is loaded as common styles and `vivliostyle.css` as paged media styles, in that order. Both pass through the resource graph, which resolves `@import` and `url()`

## 4.6 `TemplateResolver` and `HtmlDocumentBuilder`

- `TemplateResolver` resolves the bundled template name or the custom template directory, validating the file types, readability, and DOM slot contract required by the current pfpdf version
- Templates and CSS are shipped as npm package resources
- The logo path is kept separate from the template and, only when specified, converted into a URL referenceable from the workspace
- Package and input assets are referenced via `ResourceResolver` logical URLs. There is no data URL materialization for single-file HTML, and no per-renderer HTML builder
- MathJax and highlight.js are build-time transforms that use modules in the package; the generated HTML does not reference them as browser scripts
- The `document.html` generated by `HtmlDocumentBuilder` is served byte-for-byte unchanged by `AssetServer`, and that URL is passed to the Vivliostyle CLI. Integration tests also inspect both the builder output and the served bytes
- Metadata passes type validation appropriate to each slot's node or text context; unvalidated values are never passed into naive string substitution. No slot inserts metadata into CSS or attribute names
- The in-browser readiness coordinator aggregates fonts, local images, user-registered promises, and resource load errors, conveying timeouts and JavaScript errors to the renderer

## 4.7 Version management of bundled assets

- The bundled MathJax adopts the maintained current major version (3.x or later), enabling the `$` / `$$` delimiters and the equivalent of `processEscapes`
- The bundled highlight.js adopts the 11.x line, normalizing language aliases and loading assets only for the languages actually used. Unknown language names output the code as plain text without losing it, with a warning that includes the source location
- The versions, licenses, and sources of MathJax, highlight.js, and the fonts are listed in `THIRD_PARTY_LICENSES.md`
- Resource paths at CLI startup are resolved from the ES module package location, independent of `process.cwd()` and the npm cache layout

## 4.8 Bibliography input and style

The `.bib` files referenced by front matter are build inputs read in full. Unlike images, CSS, and fonts, they do not enter the browser's resource graph. They therefore require no AssetServer logical URL or readiness fetch. Relative paths are resolved against the parent directory of the source file containing the front matter. Absolute paths and `..` are allowed under the trusted-input policy, although the tutorial recommends a portable relative layout.

Citation.js, citeproc-js, and the CSL style and locale in use are pinned in the lockfile and the published shrinkwrap, with licenses and sources recorded in `THIRD_PARTY_LICENSES.md`. The HTML returned by CSL is not inserted as a document wrapper but parsed into HAST fragments, and pfpdf attaches stable classes, IDs, ARIA roles, and backlinks. All bundled templates share the structural rules in `common.css` / `common-vivliostyle.css`, and no template-specific CSS adds bibliography semantics or fixed labels.
