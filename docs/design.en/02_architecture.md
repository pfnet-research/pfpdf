# 2. Internal architecture

## 2.1 Components

```text
pfpdf CLI
  ├── ConfigResolver
  ├── InputResolver
  ├── ResourceResolver
  ├── Workspace
  ├── FontResolver
  ├── MarkdownRenderer
  ├── BibliographyFormatter
  ├── TemplateResolver
  ├── HtmlDocumentBuilder
  ├── ReadinessCoordinator
  ├── AssetServer
  ├── OutputCommitter
  └── Renderer
        └── Vivliostyle CLI
              └── Chromium
```

The CLI and conversion logic are implemented in TypeScript and run as compiled JavaScript from the npm package.

## 2.2 `ConfigResolver`

- Resolves built-in defaults, front matter, and CLI arguments in the defined precedence order
- Validates booleans, enums, numbers, and paths, and rejects invalid values
- Resolves each path against the appropriate base directory and normalizes it to an absolute path before passing it to the renderer
- Always prefers CLI values over front matter, and reuses the effective configuration and the source of each value for `--print-effective-config` and `--doctor`
- Front matter `template` / `toc` / `logo` values returned by `InputResolver` replace built-in defaults only when the corresponding CLI selection is absent. The resulting precedence is built-in default, front matter, then CLI argument
- A template is resolved as one logical setting. `--template SOURCE` classifies an exact bundled-preset name first, then a `git::` locator, then a local path. Explicit `--template-preset NAME` is exclusive with the source form
- Combining positive and negative forms of the same logical setting in the same CLI invocation — for example `--toc` and `--no-toc`, or `--logo` and `--no-logo` — exits with code `2`, regardless of argument order
- Repeating any value-taking or boolean option other than `--font-dir` in one invocation exits with code `2`, even when the repeated values are identical. Unknown options, unexpected positional arguments, and missing option values also produce code `2`; behavior never depends on a "last value wins" rule
- Conversion, `--doctor`, `--print-effective-config`, `--help`, and `--version` are mutually exclusive command modes. Specifying multiple mode flags is code `2`, and help / version do not implicitly excuse other invalid arguments
- Paths reject NUL, and empty strings are not treated as "unspecified". After resolution, the original representation used for display and the absolute path used for execution are kept separate

## 2.3 `InputResolver`

- Converts CLI paths to absolute paths
- Determines the list of Markdown files using locale-independent rules, and also detects names that collide on case-insensitive filesystems
- Verifies that front matter appears in only one place: at the top of the first Markdown file
- Validates the types and values of the title, author, series, date, page size, confidential flag, document language / direction, and `template` / `toc` / `logo`. Invalid front matter remains an error even when the CLI overrides it
- Keeps the allowed-HTML and plain-text representations of metadata separate, preventing escaping mistakes in individual template placeholders
- For file input, uses the parent directory as the resource base; for directory input, uses the input directory itself
- Passes the exact Markdown byte sequence used for validation to the parser, rather than reading the path again and potentially processing different content
- If even one of multiple files fails, the entire document fails (fail-fast)

pfpdf deliberately does not skip invalid Markdown files and emit the rest. Reporting a partial artifact as successful could allow an incomplete document to be distributed unnoticed.

Front matter is read as a single-document mapping under an existing YAML library's JSON schema. pfpdf validates only the metadata keys and types it uses; it does not implement a custom YAML parser or impose size and nesting limits as input defenses. If the first line, excluding a leading BOM, is `---`, pfpdf reserves it as a front matter delimiter. The first source file must contain a standalone closing `---` or `...` line; a missing delimiter or invalid mapping is an input error, not a thematic break. If any later source file begins with `---`, pfpdf reports duplicate front matter regardless of what follows.

### 2.3.1 `BibliographyFormatter`

The `bibliography` front matter entry is a string or a non-empty list of strings, and `.bib` paths are resolved relative to the parent directory of the first Markdown file. A `.bib` file is a build input, not a resource the browser fetches at render time. The `InputResolver` reads the UTF-8 byte sequence exactly once, just as for Markdown, and passes the content to the `BibliographyFormatter`.

The `BibliographyFormatter` uses Citation.js to convert BibTeX and BibLaTeX to CSL-JSON, then processes citation clusters and the bibliography for the entire document in a single citeproc-js session. Creating a separate processor for each source file is forbidden because it changes numbering and ordering. Library-specific objects and generated HTML stay inside the adapter; only citation keys, entry order, and HAST fragments reach the Markdown layer. Invalid databases, duplicate keys, and citations of nonexistent keys produce code `2` before the renderer starts.

## 2.4 `ResourceResolver`

`ResourceResolver` converts statically written local resources into renderer-neutral logical URLs.

- Markdown and its inline raw HTML use the input's resource base, template HTML uses the template directory, and each external CSS file uses its own parent directory as its base. Logo and font paths specified on the CLI start from the absolute path resolved by ConfigResolver; different bases are never implicitly mixed
- Links and images in the Markdown AST, URL attributes and `srcset` in raw HTML, inline styles, `<style>`, templates, and `url()` / `@import` in external CSS are each processed on HTML / CSS parser tokens. HTML and CSS are never rewritten with regular expressions alone
- Local CSS `@import` is traversed iteratively with a queue, with cycles stopped by a visited set of canonical paths. The same file is never analyzed more than once under different path representations
- Each fetched resource is assigned a deterministic logical ID in discovery order, and only relative URLs such as `assets/<id>/<encoded-basename>` are emitted into the HTML. pfpdf never newly embeds resolved absolute asset paths, temporary directories, or random tokens into `document.html`. Absolute `file:` URLs the user explicitly wrote as navigation links are preserved as input the user knowingly made non-portable
- The seed order is: the fixed list of bundled resources, template DOM source order, Markdown file / AST node source order, then the effective font priority order. CSS references are appended in token order within the file dequeued from the queue; IDs never depend on asynchronous I/O completion order or incidental hash map enumeration order
- The query and fragment are kept separate from the resource path, and percent decoding is performed exactly once per URL component. NUL, invalid percent encoding, and values that are invalid as URLs are input errors
- URLs in Markdown / HTML / CSS use `/` as the separator. Windows absolute paths are represented as `file:///C:/path/to/file` and UNC paths as valid `file://server/share/...` URLs; backslashes are never guessed to be URL path separators. CLI paths are handled separately as OS-native paths
- URLs are classified by the role of the element or AST node. Only URLs the browser fetches — images, scripts, stylesheets, fonts, and so on — enter the resource graph; navigation targets in `a[href]` are never rewritten to asset-serving URLs. In fetch roles, relative and absolute `file:` URLs are treated as local, HTTP(S) / network-path references and `data:` as remote / embedded, and any other scheme is code `2` because it cannot be reproduced statically. In particular, `blob:` written directly in the source is rejected because it is not valid in a different browser session
- In navigation roles, in-document fragments, HTTP(S), `mailto:`, `tel:`, absolute `file:`, and `javascript:` / custom schemes explicitly written in raw HTML do not enter the local resource graph and are preserved as trusted links. Scheme-less relative navigation is handled by the document link rules described later. A value the URL parser identifies as having a scheme is never reinterpreted as a local path
- Symlinks are allowed, but deduplication and cycle detection use canonical paths. Snapshotting file contents against modification during the build is not guaranteed
- Local resources may only be regular files or symlinks to regular files. Directories, FIFOs, sockets, and devices are rejected with code `2` before rendering; special files are never opened during resource discovery or responses in a way that could hang
- Paths a script assembles at runtime, DOM added at runtime, and references inside network responses are outside the static resource graph; the ability to reference dynamic local paths is not guaranteed
- The JavaScript module graph and resource graphs inside nested HTML documents are not analyzed. Trusted HTML such as inline modules and `iframe[srcdoc]` is preserved, but resolution of relative local resources referenced inside them is not guaranteed. Where needed, the user should bundle, or use absolute or remote URLs

The graph does not embed local files in a single HTML document. Instead, it keeps URL rewriting and request routing consistent. Original asset bytes are not copied into the workspace; only CSS that requires rewriting is emitted as a generated asset.

## 2.5 `Workspace`

To leave the input directory untouched, pfpdf creates a build workspace in the system temporary directory.

```text
<temporary>/
  pfpdf-<random>/
    manifest.json
    style.css
    vivliostyle.css
    host-fonts.css
    document.html
    renderer-diagnostics.log
    browser-profile/
    renderer-output/
      output.pdf

<output-directory>/
  .pfpdf-<random>.tmp
```

- Original input, templates, logos, and host fonts are not copied into the workspace; the manifest keeps the mapping between the original files and their logical URLs
- Generated assets are placed in a directory with a random component directly under the workspace so they cannot collide with user files, and pfpdf itself never adds original-input absolute paths to `document.html` or generated CSS. Absolute `file:` navigation links explicitly written by the user are the exception. `manifest.json`, which contains the path mapping, is never exposed outside the workspace
- The browser binary and cache are managed by the Vivliostyle CLI; only the per-run browser profile lives in the workspace
- Unless `--keep-work-dir` is given, the workspace is removed in `finally`-equivalent handling, with representative tests covering normal exit, ordinary validation / renderer errors, and catchable interruption
- The path shown by `--keep-work-dir` may retain input-derived secrets, so this is called out with a warning, and the directory's permissions are set so only the user can read it
- With `--keep-work-dir`, the manifest, generated HTML / CSS, and renderer diagnostics — including readiness and page errors — are retained. Diagnostics are trusted input and are not sanitized or redacted. Because logical asset URLs cannot be resolved after the AssetServer stops, users are not promised that opening `document.html` directly via `file:` will render identically
- Enumeration and automatic reclamation of stale workspaces after a crash is not implemented; this is left to the OS's temporary directory cleanup
- Workspace creation uses the OS's secure temporary API, requiring permissions `0700` on POSIX. Existing paths are never reused, predictable fixed names are never used, and creation never goes through symlinks

## 2.6 `AssetServer`

- The host process starts the `AssetServer`, and the Vivliostyle CLI receives a document URL rather than a file path. The server binds only to an OS-assigned port on `127.0.0.1` on the same host as the browser, and no interface other than the IPv4 loopback is bound
- Even though the HTML bytes and logical asset paths are deterministic, the port visible to the browser differs per build. Reproducibility is not guaranteed for user scripts that derive rendered content from `location.href` / `origin`, the current time, or randomness
- Only the exact files and generated files the `ResourceResolver` manifest enumerates as publishable are served, by logical ID; the manifest itself, the browser profile, and the renderer output are not served. The server is likewise never turned into an arbitrary-path static file server or a directory listing
- For each request, the manifest target is opened and verified to be a regular file before it is served. Changes to files during the build are non-guarantees under the trust model
- Only the `GET` and `HEAD` methods used by the renderer are handled. Host / Origin / CORS policies are not implemented because they would not constitute a security boundary
- MIME types, `Content-Length`, single range requests, and `HEAD` are supported. Multi-range requests, compression, cache validation, and uploads are not; invalid ranges yield `416`
- Responses carry `Cache-Control: no-store`
- Path segments are validated both before and after decoding so that `..`, separators, NUL, or double encoding cannot change what a logical ID maps to
- Remote HTTP(S) resources are not proxied; the browser fetches them directly and the results are not monitored
- On renderer exit and catchable interruption, the server stops accepting new requests, and after 2 seconds any remaining sockets are destroyed and the listener and port are released
- The manifest exists for renderer-neutral resource resolution; this server is not considered a sandbox or a security boundary

## 2.7 Generated HTML and `document.html`

pfpdf processes trusted local documents and does not sandbox local resources.

- Relative URLs statically written in Markdown and raw HTML are resolved against the resource base, and `ResourceResolver` rewrites them into renderer-neutral logical URLs
- Local stylesheets, scripts, and CSS `url()` / `@import` are likewise resolved recursively against each resource's own URL
- `..`, absolute paths, `file:` URLs, and symlink targets are not restricted to the input root. Any file that can be resolved statically and read with the pfpdf process's privileges is treated as a trusted-input resource
- If a Markdown AST link or a raw HTML `a[href]` refers relatively to a Markdown file that is merged into the same document, it is rewritten to the file's anchor or the specified fragment. Other navigation links are preserved as trusted input, with no existence checks or portability judgments
- Remote images, stylesheets, and scripts are fetched directly by the browser. pfpdf does not guarantee that it monitors and classifies timeouts, DNS, TLS, and HTTP errors or reflects them in build success or failure

`HtmlDocumentBuilder` generates one `document.html` file in the workspace. The Vivliostyle CLI receives the URL from which `AssetServer` serves those exact bytes. HTML is not a published output format: assets do not become data URLs, fonts are not subset, and pfpdf produces no single-file HTML build. Integration tests use the same builder output as the `document.html` that the renderer consumes; they do not create a separate HTML pipeline. Host paths and ports are resolved through the manifest and launch arguments, without rebuilding the HTML.

IDs beginning with `pfpdf-file-`, `data-pfpdf-*` attributes, and `window.pfpdf` are also used in internal contracts, but collisions with trusted HTML are not detected and rejected up front. The builder removes the `data-pfpdf-slot` attributes it has processed. There is no dedicated logic to prevent or detect user scripts overwriting `window.pfpdf`; scripts that use the registration API must preserve that name.

## 2.8 `ReadinessCoordinator`

The readiness coordinator is initialized first in the document `<head>`, aggregating fonts, local images, and asynchronous work explicitly registered by the user into a single promise. MathJax and highlight.js are build-time transforms completed before HTML assembly and are not part of the in-browser readiness state.

- The coordinator waits for DOM parsing, `document.fonts.ready`, `decode()` of static local images and the logo, and completion of registered promises. Load errors of local resources that are actually loaded, such as stylesheets and classic scripts, become build errors via a capture-phase `error` handler
- The manifest is used as the exact mapping between URL resolution and served targets, but there is no upfront `fetch` of every entry, including items unused in rendering. The paths the browser actually loads or decodes are not executed twice; only their completion is awaited
- User scripts can register work to be awaited before pagination via `window.pfpdf.registerReady(promise)`. Registration must happen by the time document parsing completes; later registrations are errors
- The coordinator exposes a frozen API object on `window.pfpdf` and assimilates the `registerReady` argument via the equivalent of `Promise.resolve`. No property descriptors or tamper detection guard the namespace against modification by trusted scripts
- `error` and `unhandledrejection` are build errors until readiness completes. Work triggered by timers or event handlers after completion cannot be reflected in PDF success or failure
- The renderer confirms readiness success before starting pagination, and the `--render-timeout-ms` deadline applies, from just before the renderer starts its first external process, to the whole of browser verification and acquisition, readiness, and PDF generation, post-processing, and structural inspection
- How readiness is connected to the pinned Vivliostyle CLI, invoked as a child process, is fixed before release. If upstream offers a pre-pagination hook, its official API is used. Otherwise, a dedicated gate resource that holds up document load, plus a single completion notification from the coordinator to a loopback server, are used. The notification conveys success or failure and a short diagnostic, and the gate is released only on success. The host-side coordinator records rejections, resource errors, and timeouts, failing the build even if the upstream child returns code `0`. No release is made unless this connection is demonstrated with the pinned browser

This is not a contract to fully detect missing remote images / stylesheets / scripts, or asynchronous work the user's script did not register. Reproducible documents should use local resources and always register any asynchronous work that affects pagination.

## 2.9 CLI design

The executable name is `pfpdf`.

```text
Usage: pfpdf --input INPUT --output OUTPUT [OPTIONS]

Required:
  --input PATH       Markdown file or a directory containing Markdown
  --output PATH      destination path for the .pdf

Options:
  --title TEXT             override the front matter title
  --toc / --no-toc         enable / disable table of contents generation. Default is enabled
  --template SOURCE        preset name, local directory, or git::URL//PATH?ref=REVISION
  --template-preset NAME   explicitly select a bundled template preset
  --logo SOURCE            local file or git::URL//PATH?ref=REVISION; overrides template default
  --no-logo                disable local, repository, and template default logos
  --host-fonts             use the OS standard font directories
  --font-dir PATH          additional font directory. May be repeated
  --browser-path PATH      browser used by the renderer
  --render-timeout-ms N    from renderer preparation to PDF inspection completion. Default is 300000
  --keep-work-dir          keep the temporary workspace
  --log-level LEVEL        error / warn / info / debug
  --print-effective-config print the applied configuration and its sources, then exit
  --doctor                 diagnose the renderer, browser, and assets
  --version                print the version
  -h, --help               print help
```

### 2.9.1 Path rules

- Relative paths are resolved against the current directory from which `pfpdf` was invoked
- `--input -` / `--output -` are not accepted in the stdin / stdout sense; they are code `2`. To preserve input order, the resource base, and atomic output, `v0.1.0` handles named paths only
- If `--input` is a directory, only regular files, and symlinks to regular files, directly beneath it with the lowercase extension `*.md` are targeted, processed in ascending order of the UTF-8 byte sequence of the file name. On POSIX, directory entries are read as byte sequences, and file names with invalid UTF-8 are input errors rather than being converted to replacement characters. Recursive traversal and locale-dependent sorting are not used; numeric prefixes such as `00_`, `01_` are recommended for portability. Zero matching targets is an input error
- If `--input` is a file, only that one file is processed. Any extension other than lowercase `.md` is an input error
- Input is UTF-8, with a leading UTF-8 BOM and CRLF accepted. Invalid byte sequences are errors rather than replacement characters
- For directory input, front matter may appear only once, at the top of the first Markdown file in sort order. If any other file starts with a front matter delimiter, it is rejected as duplicate metadata. In any source file, use `***` for a thematic break at the very top
- Inputs with different file names are treated as distinct entries as enumerated by the current filesystem. Normalization or case-folding collisions that would occur on other OSes are not preemptively rejected
- The output extension accepts only `.pdf`, ASCII case-insensitively, and the file name the user specified is preserved
- An existing output path is eligible for replacement only if it is a regular file or a symlink. Directories, FIFOs, sockets, and devices are rejected as input errors. The symlink's target is not written to; the final commit replaces the symlink as a directory entry
- If the output's parent directory does not exist, it is created after input and configuration validation completes. A regular file on the parent path, or the parent not being a directory after creation, is an input error
- `OutputCommitter` creates an exclusively-created sibling temporary file with an unpredictable short name in the same directory as the final output. The initial POSIX permissions are `0600`; new outputs get `0666 & ~umask`, and replacing an existing regular file inherits its mode before committing. The mode of an existing symlink's target is not inherited; the symlink itself is replaced with a new regular file. Only after the renderer and AssetServer have stopped and PDF inspection, the file flush, and, when `--keep-work-dir` is not set, workspace cleanup have all completed does a same-filesystem rename / replace serve as the final commit point
- Atomic replacement and directory flushing are bounded by what the target OS and filesystem guarantee. On filesystems without atomic replace, there is no copy-delete fallback; the result is code `1`, and the visibility and durability characteristics of network / distributed filesystems are not presented as equivalent to a local filesystem
- If the renderer, inspection, or rename fails, the sibling temporary file is deleted and the existing output is preserved. On Windows, if the existing file is open in another process and cannot be replaced, the process exits with code `1`; the existing file is not deleted first and retried
- Under uncatchable `SIGKILL` or power loss, `.pfpdf-<random>.tmp` may remain in the output directory. The next run does not assume ownership of files with the same prefix and auto-delete them, nor does it treat them as final output. Users may delete them manually after confirming no running process exists
- After a successful rename, the complete new output is visible and there is no safe rollback to the previous output. On POSIX platforms, where possible, the parent directory is flushed; if only that flush fails, a durability warning and exit code `0` are returned. Success of the output content and post-crash persistence of the directory entry are not conflated
- Catchable interruption signals and the commit are serialized by a state machine. A signal received before the commit critical section is entered aborts without renaming; a signal received after the critical section starts is delayed until the rename and any directory flush finish. After a successful rename, there is no rollback; the build succeeds with code `0` and the signal is not re-raised. This ensures that "non-zero exit for catchable interruption" and "commit of the new output" can never both occur
- No lock is implemented for concurrent builds targeting the same final output. Each build's temporary file does not collide with the others, and if multiple builds succeed, the last complete PDF committed remains. No arbitration of which build wins, and no crash recovery, is performed
- Specifying the same file as both input and output, or an output that would overwrite an input Markdown file, is rejected

### 2.9.2 Metadata and reproducible dates

- `title` is required; if it is present in neither the front matter nor `--title`, the build fails with exit code `2`
- `title` is a non-empty string; via an HTML tokenizer, only text / character reference tokens and case-insensitive attribute-less `<br>` / `<br/>` / `<br />` tokens are allowed. Other comments, tags, and attributes are errors rather than being stripped. Plain `x < y` is treated as text. In the plain-text representation, the allowed line-break tags are converted to U+000A; in the HTML `<title>` they are collapsed to spaces before being set via DOM APIs
- `author`, `series`, and `date` are strings, `confidential` is a YAML boolean, and `page_size` accepts only an allowlisted keyword or exactly two dimensions, defaulting to `A4` when omitted. HTML is not allowed in `author` / `series` / `date`; they are inserted as DOM text
- Visual line breaks in the title use the allowed `<br>`, not YAML block scalars or literal newlines
- `lang` is a string that must be a well-formed BCP 47 language tag, normalized to canonical form with Node.js `Intl.getCanonicalLocales`. It defaults to `ja` and is used for the generated HTML root's `lang` attribute, hyphenation, and font selection
- `dir` is an ASCII case-sensitive enum of `ltr` / `rtl` / `auto`, defaulting to `auto`. It is set on the generated HTML root's `dir` attribute; text direction is never inferred from the host locale or from `lang` alone. The upstream reading progression is not overridden with a fixed value; it is determined automatically from the computed `writing-mode` / direction, and the PDF direction for horizontal RTL and vertical writing is confirmed by compatibility tests
- Page size keywords are ASCII case-insensitive `A3`, `A4`, `A5`, `JIS-B4`, `JIS-B5`, `ISO-B4`, `ISO-B5`, `Letter`, `Legal`. The ambiguous `B4` / `B5` are not accepted. Dimensions are `<number><unit><ASCII-whitespace+><number><unit>` in width-height order, with units `mm` / `cm` / `in` / `pt`, and each side a positive finite decimal. pfpdf imposes no upper bound of its own beyond what the renderer handles
- The metadata keys are the allowlist `title`, `author`, `series`, `date`, `page_size`, `confidential`, `lang`, `dir`; duplicate and unknown keys are reported as input mistakes
- The document setting `template` is a bundled template name, `toc` is a YAML boolean, and `logo` is a local path string or `false`. A relative `logo` path is resolved from the parent directory of the front matter source. Git repository sources are rejected in front matter and accepted only through `--logo`
- `--title` overrides only the value of a valid front matter title. Even with the CLI override, the entire front matter's syntax, keys, and types are validated first; invalid values are not hidden
- `confidential` defaults to `false`; the `Confidential` marking appears only when the user sets it explicitly
- `SOURCE_DATE_EPOCH` is an ASCII decimal non-negative integer of Unix seconds; values exceeding 13 digits are rejected before numeric conversion. It is then parsed without going through JavaScript `Number`, and confirmed to be a safe integer within the range representable by an ECMAScript `Date`. Invalid values are errors, not ignored. If `date` is omitted and this value is valid, the display date uses that date in UTC. When unset, the display date is the local date obtained exactly once at process startup, and the PDF metadata uses the same startup instant. Regardless of whether the front matter `date` is present, when `SOURCE_DATE_EPOCH` is unset a warning states that the build is not reproducible
- The generated date uses the Japanese year-month-day format (the equivalent of `2026-08-03` written with the Japanese counters for year, month, and day) if the primary language of `lang` is `ja`, and the locale-independent `2026-08-03` otherwise. Templates add no fixed label to the date, and a user-specified arbitrary-string `date` is never reformatted
- The PDF Info / XMP title uses the plain-text representation of the title, and the author uses the original string, uninterpreted as HTML; if the author is unspecified, the field is not created. The PDF catalog `/Lang` is the canonical `lang`. The display `date` and the confidential flag are never repurposed for PDF creation timestamps or author fields
- PDF CreationDate / ModDate and the XMP timestamps use the `SOURCE_DATE_EPOCH` UTC instant if present, otherwise the process start time. The front matter `date`, an arbitrary string, is not repurposed for PDF timestamps. They are set via an official upstream option or a PDF library that understands the structure; PDF bytes are never rewritten with regular expressions
- Canonical CI fixes `SOURCE_DATE_EPOCH` and inspects the generated HTML and the PDF Info / XMP title, author, language, and timestamp / timezone policy against the same fixture. Even with the timestamp fixed, PDF byte equality across browsers and OSes is still not guaranteed

### 2.9.3 Configuration resolution and diagnostics

- For the document settings `template` / `toc` / `logo`, a CLI value wins; otherwise front matter is used; otherwise the built-in default. Template source / explicit preset and logo source / disabled are each one exclusive logical setting
- Browser paths, additional font directories, host fonts, timeouts, workspace retention, and log levels are CLI-only. Lists are never implicitly concatenated across sources
- Only `SOURCE_DATE_EPOCH` remains as a standard reproducible-build environment variable. It controls the display date and PDF metadata timestamp, while front matter `date` overrides only the display date
- Child processes inherit the caller's environment variables, like ordinary CLI tools
- `--print-effective-config` prints exactly one JSON object with a versioned schema to stdout, including each value and whether its source is the CLI, front matter, or a default. When `--input` is present, the result includes `template` / `toc` / `logo` selected by the first Markdown file. Tokens, credentials, and raw environment variable values are not included, and the contents of proxy URLs and custom CAs, which may contain secrets, are not shown
- `--doctor` inspects, based on the effective configuration: Node.js, the browser, templates, logos, font directories, and output permissions
- `--doctor` and `--print-effective-config` generate no PDF and never display secrets or the entire environment in diagnostics
- `--doctor` performs no browser download, no creation of the user's project or output directory, and no configuration changes. Only when actually launching the browser requires it does it create a dedicated profile / workspace in the OS's secure temporary directory, reclaimed in `finally`. A cleanup failure remains a `fail` for the check. Output permissions are judged, best effort, from the nearest existing parent directory, with no guarantee that an actual create / rename would succeed. Each external process check is cut off at 10 seconds including cleanup, the whole command at 60 seconds, and timeouts are reported as `fail`
- `--doctor` and `--print-effective-config` do not require `--input` and `--output`
- `--doctor` without input / output inspects only the runtime and global settings, and inspects document resources and the write destination only when they are specified. Unspecified items are never displayed as verified successes
- `--doctor` writes a JSON object with a versioned schema to stdout, giving each check `pass` / `warning` / `fail` / `not-run` and its rationale. The exit code is `1` when a problem is detected, `0` when there are only warnings or no problems

An unspecified logo is the `template` state that uses the slot's default `src`; front matter `logo: false` or CLI `--no-logo` is the distinct `none` state that removes it too.

The effective configuration has `schemaVersion: 5` and `command` at the top level, with `config.<name> = {"value": ..., "source": "cli|front-matter|default"}`. Schema 5 removes the environment source and lets `toc` / `logo` have a front matter source. Templates have a repository variant, and logos have `template` / `none` / `local` / `repository` variants. Doctor remains at `schemaVersion: 2` and has an overall `status` plus `checks[] = {"id": ..., "status": "pass|warning|fail|not-run", "message": ...}`. Doctor's overall status is fail if any check fails, otherwise warning if any check warns, and pass if at least one check ran and all passed. Key and check output order is fixed, and exactly one line of compact UTF-8 JSON plus a trailing LF is written to stdout. Adding optional fields in the future is allowed under the same schemaVersion, but changing the meaning or type of an existing field, or removing one, bumps the version.

### 2.9.4 Exit codes

| code | Meaning |
|---:|---|
| `0` | Success |
| `1` | Renderer, browser, or other runtime error, or internal error |
| `2` | CLI argument, input, or front matter error |

Only output the command itself was asked for — help, version, `--doctor`, `--print-effective-config` — goes to stdout; a normal PDF build writes nothing to stdout. Progress, normal logs, warnings, errors, and child process output go to stderr. Exception stack traces are not shown by default, only with `--log-level debug`. Interruption codes before the commit follow the conventions of Node.js and each OS, and are not normalized to custom cross-platform codes. Signals after the commit critical section are delayed per the rules of the previous section, and a build that has already succeeded is never turned back into an interruption.

Diagnostics include, where possible, the source file, the 1-based line and column, the relevant CLI option or front matter key, and the processing phase. Under the trusted-input assumption, human-readable log content is not sanitized or redacted, and JSON is left to the serializer's normal escaping.

Invalid, missing, or unreadable user-specified CLI values, Markdown, front matter, custom templates, logos, fonts, and static local resources are code `2`. Browser / renderer failures, timeouts, write / rename failures at the output destination, missing bundled resources, and internal invariant violations are code `1`. Even for the same kind of check, corruption of a bundled template or font is code `1` because it is not user input. If cleanup fails before the commit, that too is code `1` and the existing output is preserved.

## 2.10 Complexity and resource limits

Let `M` be the number of input Markdown files, `B` their total bytes, `N` the number of generated AST nodes, `T` the bytes of the template HTML, `R` the number of static local resources, `C` the total bytes of analyzed CSS, `A` the total bytes actually sent by the AssetServer, `F` the number of scanned font directory entries, `G` the bytes of fonts inspected / decoded, and `P` the bytes of the generated PDF. Since file name and URL / path lengths are variable, sorts are stated in comparison counts rather than time alone, and string length is not treated as constant in hash computation.

- Directory entry enumeration is `O(M)` entries; sorting input file names as byte sequences is `O(M log M)` comparisons and `O(M)` metadata. UTF-8 decoding, pfpdf-owned AST traversal, heading / URL post-processing, and HTML serialization are `O(B + N + T)` in time and memory. The pinned GFM parser itself is benchmarked on adversarial input; its worst-case bound is never asserted to be linear without implementation-level evidence. Per-file iterative `string +=`, full-document rescans per heading, and regex-based re-parsing of HTML are forbidden
- Resource discovery uses a hash map of canonical paths and a queue, requiring at the application level `O(B + T + C + R)` expected operations and `O(B + T + C + R)` memory. The filesystem cost of path canonicalization itself and the hash cost of variable-length strings are measured separately. CSS import cycles are stopped by the visited set. The AssetServer serves with `O(A)` total I/O and fixed-length buffer memory, never holding entire assets in memory. Because retransmission of the same bytes via range requests depends on the browser's requests, `A` counts the bytes actually transmitted
- Heading and file link resolution uses precomputed maps, avoiding a linear scan of all headings / files per link
- Font discovery scans each permitted directory exactly once; including the per-directory entry sort, it is at worst `O(F log F)` comparisons and `O(F)` metadata. Symlinked directories are not traversed recursively. OpenType table lengths and offsets are checked against the file size before reading, and font content inspection and any required decoding are `O(G)` time
- Copying the PDF to the sibling temporary file and structural parsing are `O(P)` in I/O and time. Copying uses a fixed-length buffer, but the PDF parser's memory can be `O(P)` in the worst case, depending on the object / xref structure. Vivliostyle / browser layout complexity is not included in pfpdf's linear bounds; hangs are controlled by the absolute deadline and real PDF performance tests

Even with trusted input, renderer hangs can occur, so a deadline — 300 seconds by default, configurable between 1 second and 1 hour — is applied. No arbitrary small caps are imposed on input bytes or resource counts, but additions to array lengths, byte lengths, and file offsets are checked for safe-integer overflow, and hitting Node.js or OS limits is never converted into partial success. Performance tests verify that processing time and peak memory do not grow quadratically as input size doubles.
