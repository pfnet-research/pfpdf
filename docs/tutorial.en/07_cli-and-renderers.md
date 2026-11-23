# 7. CLI and Renderers

## 7.1 CLI overview

```text
Usage: pfpdf --input INPUT --output OUTPUT [OPTIONS]

Required:
  --input PATH       A Markdown file or a directory containing Markdown files
  --output PATH      Destination .pdf path

Options:
  --title TEXT             Set the title, overriding front matter and inference
  --toc / --no-toc         Enable / disable table of contents generation. Enabled by default
  --cover / --no-cover     Enable / disable the cover or leading document header. Enabled by default
  --template SOURCE        Preset name, local directory, or git::URL//PATH?ref=REVISION
  --template-preset NAME   Explicitly select a bundled template preset
  --logo SOURCE            Local file or git::URL//PATH?ref=REVISION; overrides template default
  --no-logo                Disable local, repository, and template default logos
  --host-fonts             Use the OS standard font directories
  --font-dir PATH          Additional font directory. Can be specified multiple times
  --browser-path PATH      Browser used by the renderer
  --vivliostyle-cli PATH    Vivliostyle JavaScript entry point
  --vivliostyle-daemon SOCKET
                           use a running standalone daemon on Linux or macOS
  --render-timeout-ms N    Time limit from renderer preparation through PDF inspection; default: 300000 ms
  --keep-work-dir          Keep the temporary working directory
  --strict-front-matter    Reject unknown front matter keys; default: warn and ignore
  --log-level LEVEL        error / warn / info / debug
  --print-effective-config Print the effective configuration and its sources, then exit
  --doctor                 Diagnose renderer, browser, and assets
  --version                Show the version
  -h, --help               Show help
```

If neither `--title` nor the front matter `title` is specified, pfpdf uses the first non-empty top-level Markdown H1 in input order. If there is no such H1, it uses the input filename without `.md` or the input directory name. See Chapter 2 for details.

## 7.2 Configuration precedence

The document settings `template` / `toc` / `cover` / `logo` determine content and appearance and are normally specified in front matter. CLI options can override them for one invocation. Front matter overrides built-in defaults, and CLI arguments override front matter.

Runtime settings such as the browser, font directories, timeout, logging, and working directory retention are CLI-only.

- Combining `--template` with `--template-preset`, `--toc` with `--no-toc`, `--cover` with `--no-cover`, or `--logo` with `--no-logo` is an error
- Repeating any option other than `--font-dir` is an error, even with the same value
- `--template` first checks for an exact preset-name match and otherwise treats the value as a Git locator or local path. `--logo` accepts either a Git locator or local path
- `--strict-front-matter` is a CLI-only runtime setting. Without it, unknown front matter keys produce warnings and are ignored. With it, conversion and configuration printing report an input error (exit code `2`), while `--doctor` reports an input check with status `fail` (exit code `1`). Warnings go to standard error (stderr) according to the normal log level; `--log-level error` suppresses them

`--print-effective-config` outputs the effective settings and the source of each value as a JSON object with a versioned schema. When `--input` is also specified, it reflects front matter `template` / `toc` / `cover` / `logo` values and reports their source as `front-matter`.

```bash
npm exec -- pfpdf --input docs --print-effective-config
```

## 7.3 Exit codes

`v0.1.0` handles named files and directories only. You cannot use stdin / stdout via `--input -` or `--output -`.

| code | Meaning |
|---:|---|
| `0` | Success |
| `1` | Runtime errors in the renderer, browser, etc. |
| `2` | Errors in CLI arguments, input, or front matter |

pfpdf never reports success for a partial PDF. It creates a temporary file in the output directory. It checks the PDF header and EOF marker, parses the cross-reference table, catalog, and page tree, and confirms that the PDF has at least one page and the renderer succeeded. Only then does it move the temporary file to the specified output path to finalize the output. If conversion fails, any existing output file remains unchanged.

## 7.4 Renderer

By default, pfpdf runs a one-off conversion using Vivliostyle CLI 11.5.0 from its own installation. The CLI fetches and caches its browser on first use. Pass `--browser-path` to use an existing compatible browser.

To select a different CLI for one-off conversions, pass its built JavaScript entry point. Relative paths are resolved from the directory where pfpdf starts.

```bash
npm exec -- pfpdf --input docs --output docs.pdf \
  --vivliostyle-cli ../vivliostyle-cli/dist/cli.js --browser-path /usr/bin/chromium
```

### 7.4.1 Reuse Vivliostyle across conversions

Persistent mode is available on Linux and macOS. Use a separately built Vivliostyle CLI that supports `build-daemon --standalone`, the `describe` session protocol, and `build --build-daemon`. These features were verified with Vivliostyle CLI commit [`ee08133c`](https://github.com/naoto-aoki-fy/vivliostyle-cli/commit/ee08133c3c538ae9ab5d48ffc00d1552151e9bdd).

Start the daemon with the absolute path to its built entry point. The socket and its directory must be accessible only to your user.

```bash
cli=/absolute/path/to/vivliostyle-cli/dist/cli.js
daemon_dir=$(mktemp -d /tmp/pfpdf-vs.XXXXXXXX)
printf '%s\n' "$daemon_dir"
node "$cli" build-daemon --standalone --socket "$daemon_dir/daemon.sock"
```

After the daemon reports that it is ready, set `daemon_dir` to the printed path in another terminal. If you installed pfpdf locally, run the following commands from that npm project. You can point `--input` and `--output` to documents in another directory. If pfpdf is already on your `PATH`, you can call it directly from any document directory.

```bash
npm exec -- pfpdf --input first.md --output first.pdf --vivliostyle-daemon "$daemon_dir/daemon.sock"
npm exec -- pfpdf --input second.md --output second.pdf --vivliostyle-daemon "$daemon_dir/daemon.sock"
```

pfpdf discovers the CLI entry point and working directory from the daemon's `describe` response. It launches that CLI with `build --build-daemon`, allowing Vivliostyle to reuse the build process and browser. Pass `--vivliostyle-cli` only for one-off conversions.

`--print-effective-config` shows the configured socket. `--doctor --vivliostyle-daemon SOCKET` verifies the connection and protocol, reporting `fail` for a stopped daemon or an incompatible reply. A passing socket check covers session discovery only. Run a conversion to verify PDF output. Adding `--browser-path` to `--doctor` runs a separate one-off browser probe.

Press Ctrl+C in the daemon terminal when finished, then remove the empty directory with `rmdir "$daemon_dir"`.

## 7.5 Timeouts

The default timeout of 300,000 ms (five minutes) covers daemon discovery and queueing, browser verification and initial download, waiting for the document to be ready, PDF rendering, post-processing, and structural inspection. If a large document or slow initial download needs more time, choose a value from 1,000 to 3,600,000 ms. Unlimited values such as `0` are not accepted.

```bash
npm exec -- pfpdf --input docs --output docs.pdf \
  --render-timeout-ms 600000
```

The deadline starts before contacting the daemon or launching the renderer and runs until PDF post-processing and structural inspection complete. It does not restart at each processing phase. On timeout, child processes are stopped, existing output is preserved, and exit code `1` is returned.

## 7.6 Reproducible builds

If you want the same result from the same input, for example in CI, set the `SOURCE_DATE_EPOCH` environment variable. When the front matter `date` is omitted, pfpdf uses the UTC date represented by this value instead of the run date.
Use the pinned npm project from section 1.3.

The PDF metadata timestamps are separate from the display `date` in front matter. Even if `date` is set, a build without `SOURCE_DATE_EPOCH` produces a warning and is not treated as reproducible.

```bash
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
  npm exec -- pfpdf --input docs --output docs.pdf
```

## 7.7 Debugging

- `--log-level debug` shows detailed logs and stack traces
- `--keep-work-dir` keeps the temporary working directory, letting you inspect the generated `document.html` / CSS, the resource manifest, and renderer diagnostics on whether the document is ready for rendering and on page errors

If the pinned renderer does not provide browser console events, the full console output is not recorded. Once conversion ends and the server stops, resources are no longer accessible through their logical URLs, so opening the HTML directly may not render identically. The working directory containing diagnostics may retain secrets derived from your input, so delete it after inspection.
