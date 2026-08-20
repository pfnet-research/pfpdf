# 7. CLI and Renderers

## 7.1 CLI overview

```text
Usage: pfpdf --input INPUT --output OUTPUT [OPTIONS]

Required:
  --input PATH       A Markdown file or a directory containing Markdown
  --output PATH      Destination path for the .pdf

Options:
  --title TEXT             Override the front matter title
  --toc / --no-toc         Enable / disable table of contents generation. Enabled by default
  --template SOURCE        Preset name, local directory, or git::URL//PATH?ref=REVISION
  --template-preset NAME   Explicitly select a bundled template preset
  --logo SOURCE            Local file or git::URL//PATH?ref=REVISION; overrides template default
  --no-logo                Disable local, repository, and template default logos
  --host-fonts             Use the OS standard font directories
  --font-dir PATH          Additional font directory. Can be specified multiple times
  --browser-path PATH      Browser used by the renderer
  --render-timeout-ms N    From renderer preparation to PDF inspection completion. Default is 300000
  --keep-work-dir          Keep the temporary workspace
  --log-level LEVEL        error / warn / info / debug
  --print-effective-config Print the effective configuration and its sources, then exit
  --doctor                 Diagnose renderer, browser, and assets
  --version                Show the version
  -h, --help               Show help
```

## 7.2 Configuration precedence

The front matter is authoritative for `template` / `toc` / `logo`, which determine document content and appearance. CLI options can override them for one invocation. Precedence is built-in default, front matter, then CLI argument. Runtime settings such as the browser, font directories, timeout, logging, and workspace retention are CLI-only.

- Combining `--template` with `--template-preset`, `--toc` with `--no-toc`, or `--logo` with `--no-logo` is an error. `--template` first checks for an exact preset-name match and otherwise treats the value as a Git locator or local path. `--logo` likewise accepts either a Git locator or local path
- Repeating any option other than `--font-dir` is an error, even with the same value
- To see where each setting came from, use `--print-effective-config`, which outputs a JSON object with a versioned schema. When `--input` is also specified, it reflects front matter `template` / `toc` / `logo` values and reports their source as `front-matter`

```bash
npx @pfnet-research/pfpdf@latest --input docs --print-effective-config
```

## 7.3 Exit codes

`v0.1.0` handles named files and directories only. You cannot use stdin / stdout via `--input -` or `--output -`.

| code | Meaning |
|---:|---|
| `0` | Success |
| `1` | Runtime errors in the renderer, browser, etc. |
| `2` | Errors in CLI arguments, input, or front matter |

pfpdf never reports success for a partial PDF. It writes to a temporary file in the output directory, checks the PDF header and EOF marker, parses the cross-reference table, catalog, page tree, and at least one page, and confirms that the renderer succeeded. Only then does it move the file into place. If conversion fails, any existing output file remains unchanged.

## 7.4 Renderer

pfpdf renders the PDF using the bundled Vivliostyle CLI and the Chromium managed by its standard mechanism.

- The browser is fetched automatically on first run and cached thereafter
- To use an existing compatible browser, specify it with `--browser-path`

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --browser-path /usr/bin/chromium
```

## 7.5 Timeouts

The default timeout of 300,000 ms (five minutes) covers the entire operation: browser verification and initial download, document readiness, PDF rendering, post-processing, and structural inspection. If a large document or slow initial download needs more time, choose a value from 1,000 to 3,600,000 ms. Unlimited values such as `0` are not accepted.

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --render-timeout-ms 600000
```

The timeout does not restart at each processing phase; it is an absolute deadline running from just before the renderer launches its first external process until PDF post-processing and structural inspection complete. On timeout, child processes are stopped, existing output is preserved, and exit code `1` is returned.

## 7.6 Reproducible builds

If you want the same result from the same input, for example in CI, set the `SOURCE_DATE_EPOCH` environment variable. When the front matter `date` is omitted, the UTC date of this value is used instead of the run date.

Even if a display `date` is set in the front matter, the PDF metadata timestamps exist separately, so a build without `SOURCE_DATE_EPOCH` produces a warning and is not treated as reproducible.

```bash
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
  npx --yes @pfnet-research/pfpdf@0.1.0 --input docs --output docs.pdf
```

## 7.7 Debugging

- `--log-level debug` shows detailed logs and stack traces
- `--keep-work-dir` keeps the temporary workspace, letting you inspect the generated `document.html` / CSS, the resource manifest, and renderer diagnostics including readiness and page errors. If the pinned renderer does not provide browser console events, the full console is not recorded. Logical asset URLs cannot be resolved without the server once conversion ends, so opening the HTML directly is not guaranteed to render identically. The workspace containing diagnostics may retain secrets derived from your input, so delete it after inspection
