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
  --vivliostyle-cli PATH   Vivliostyle JavaScript entry point
  --vivliostyle-daemon-dir DIR
                           Use a running daemon on Linux or macOS
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
npx @pfnet-research/pfpdf@latest --input docs --print-effective-config
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

pfpdf renders the PDF using the bundled Vivliostyle CLI and the Chromium browser that the CLI manages by default.

- The browser is fetched automatically on first run and cached thereafter
- To use an existing compatible browser, specify it with `--browser-path`

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --browser-path /usr/bin/chromium
```

### 7.4.1 Reuse Vivliostyle across conversions

On Linux and macOS, a compatible Vivliostyle CLI can keep its Node.js build process and Chromium running between conversions. Use a CLI build that supports `build-worker`, `build-daemon`, and `build --build-daemon`. Set `cli` to its absolute JavaScript entry point. You can also pass `--vivliostyle-cli "$cli"` by itself for a one-off build.

Create a directory accessible only to your user, with a dedicated `context` subdirectory. Start the worker first.

```bash
cli=/absolute/path/to/vivliostyle-cli/dist/cli.js
daemon_dir=$(mktemp -d /tmp/pfpdf-vs.XXXXXXXX)
chmod 700 "$daemon_dir"
mkdir -m 700 "$daemon_dir/context"
printf '%s\n' "$daemon_dir"
node "$cli" build-worker --socket "$daemon_dir/worker.sock"
```

After the worker reports that it is ready, open another terminal. Set `cli` and `daemon_dir` to the same absolute paths and start the daemon from `context`.

```bash
cd "$daemon_dir/context"
node "$cli" build-daemon --socket "$daemon_dir/daemon.sock" \
  --browser-worker "$daemon_dir/worker.sock"
```

After the daemon reports that it is ready, run conversions from your document directory in a third terminal. Set the same `cli` and `daemon_dir` again.

```bash
pfpdf --input first.md --output first.pdf \
  --vivliostyle-cli "$cli" --vivliostyle-daemon-dir "$daemon_dir"
pfpdf --input second.md --output second.pdf \
  --vivliostyle-cli "$cli" --vivliostyle-daemon-dir "$daemon_dir"
```

Both Vivliostyle options resolve relative paths from the directory where pfpdf starts. `--print-effective-config` lists both settings and their sources. `--doctor` checks the selected CLI, `context`, and the socket, and uses a one-off build of that CLI for the browser launch check.

When finished, press Ctrl+C in the daemon terminal first and wait for it to exit. Then press Ctrl+C in the worker terminal and wait for it to exit. Remove the empty directories with `rmdir "$daemon_dir/context" "$daemon_dir"`.

## 7.5 Timeouts

The default timeout of 300,000 ms (five minutes) covers browser verification and initial download, any wait in the daemon queue, waiting for the document to be ready, PDF rendering, post-processing, and structural inspection. If a large document or slow initial download needs more time, choose a value from 1,000 to 3,600,000 ms. Unlimited values such as `0` are not accepted.

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --render-timeout-ms 600000
```

The deadline runs from just before the renderer launches its first external process until PDF post-processing and structural inspection complete. It does not restart at each processing phase. On timeout, child processes are stopped, existing output is preserved, and exit code `1` is returned.

## 7.6 Reproducible builds

If you want the same result from the same input, for example in CI, set the `SOURCE_DATE_EPOCH` environment variable. When the front matter `date` is omitted, pfpdf uses the UTC date represented by this value instead of the run date.

The PDF metadata timestamps are separate from the display `date` in front matter. Even if `date` is set, a build without `SOURCE_DATE_EPOCH` produces a warning and is not treated as reproducible.

```bash
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
  npx --yes @pfnet-research/pfpdf@0.4.0 --input docs --output docs.pdf
```

## 7.7 Debugging

- `--log-level debug` shows detailed logs and stack traces
- `--keep-work-dir` keeps the temporary working directory, letting you inspect the generated `document.html` / CSS, the resource manifest, and renderer diagnostics on whether the document is ready for rendering and on page errors

If the pinned renderer does not provide browser console events, the full console output is not recorded. Once conversion ends and the server stops, resources are no longer accessible through their logical URLs, so opening the HTML directly may not render identically. The working directory containing diagnostics may retain secrets derived from your input, so delete it after inspection.
