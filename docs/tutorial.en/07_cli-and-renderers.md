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
  --template NAME          Bundled template name. Default is default
  --template-dir PATH      Custom template directory
  --logo PATH / --no-logo  Logo file passed to the template / disable the environment variable logo
  --renderer MODE          local or docker. Default is local
  --host-fonts             Use the OS standard font directories
  --no-host-fonts          Disable the environment variable host font setting
  --font-dir PATH          Additional font directory. Can be specified multiple times
  --no-font-dirs           Disable the environment variable's additional font directories
  --browser-path PATH      Browser used by the local renderer
  --managed-browser        Disable the environment variable browser path
  --docker-image IMAGE     Image and tag used by the Docker renderer
  --default-docker-image   Disable the environment variable Docker image
  --render-timeout-ms N    From renderer preparation to PDF inspection completion. Default is 300000
  --keep-work-dir / --no-keep-work-dir
                           Keep the temporary workspace / disable the environment variable keep setting
  --log-level LEVEL        error / warn / info / debug
  --print-effective-config Print the effective configuration and its sources, then exit
  --doctor                 Diagnose renderer, browser, mounts, and assets
  --version                Show the version
  -h, --help               Show help
```

## 7.2 Environment variables

Most CLI arguments can also be set via environment variables. When both are present for the same setting, the CLI argument always wins.

| Environment variable | Corresponding CLI |
|---|---|
| `PFPDF_RENDERER` | `--renderer` |
| `PFPDF_TOC` | `--toc` / `--no-toc` |
| `PFPDF_HOST_FONTS` | `--host-fonts` / `--no-host-fonts` |
| `PFPDF_FONT_DIRS` | `--font-dir` / `--no-font-dirs` (join multiple entries with the path separator) |
| `PFPDF_TEMPLATE` | `--template` |
| `PFPDF_TEMPLATE_DIR` | `--template-dir` |
| `PFPDF_LOGO` | `--logo` / `--no-logo` |
| `PFPDF_BROWSER_PATH` | `--browser-path` / `--managed-browser` |
| `PFPDF_DOCKER_IMAGE` | `--docker-image` / `--default-docker-image` |
| `PFPDF_RENDER_TIMEOUT_MS` | `--render-timeout-ms` |
| `PFPDF_KEEP_WORK_DIR` | `--keep-work-dir` / `--no-keep-work-dir` |
| `PFPDF_LOG_LEVEL` | `--log-level` |
| `SOURCE_DATE_EPOCH` | No corresponding CLI option. Used for reproducible display dates and PDF metadata |

- Boolean environment variables accept only `true` / `false` / `1` / `0`
- List options such as `--font-dir` are never merged between the CLI and environment variables. If even one entry is given on the CLI, the CLI list is used in its entirety
- Specifying both `--template` and `--template-dir` in the same place, or `--toc` and `--no-toc` together, is an error. Choosing either template option on the CLI overrides the environment variable template selection entirely
- Repeating any option other than `--font-dir` is an error, even with the same value. You also cannot use an empty path component in `PFPDF_FONT_DIRS` to mean the current directory
- To disable an optional environment variable for a single run, use `--no-logo`, `--no-font-dirs`, `--managed-browser`, `--default-docker-image`, or `--no-keep-work-dir`. As explicit CLI values, these take precedence over environment variables
- To see where each setting came from, use `--print-effective-config`, which outputs a JSON object with a versioned schema

```bash
PFPDF_TEMPLATE=pfn npx @pfnet-research/pfpdf@latest --print-effective-config
```

## 7.3 Exit codes

`v0.1.0` handles named files and directories only. You cannot use stdin / stdout via `--input -` or `--output -`.

| code | Meaning |
|---:|---|
| `0` | Success |
| `1` | Runtime errors in the renderer, browser, Docker, etc. |
| `2` | Errors in CLI arguments, input, or front matter |

pfpdf never reports success for a partial PDF. It writes to a temporary file in the output directory, checks the PDF header and EOF marker, parses the cross-reference table, catalog, page tree, and at least one page, and confirms that the renderer succeeded. Only then does it move the file into place. If conversion fails, any existing output file remains unchanged.

## 7.4 Local renderer (default)

The default `--renderer local` renders the PDF locally using the bundled Vivliostyle CLI and the Chromium managed by its standard mechanism.

- The browser is fetched automatically on first run and cached thereafter
- To use an existing compatible browser, specify it with `--browser-path` or `PFPDF_BROWSER_PATH`

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --browser-path /usr/bin/chromium
```

## 7.5 Docker renderer

Use the Docker renderer to confine the browser runtime to a container, for example on servers or in CI.

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --renderer docker
# or
PFPDF_RENDERER=docker npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf
```

- The pfpdf image on the public registry is used. You can specify an image with `--docker-image`; at run time it is pinned to the image ID or digest obtained after pull / inspect
- Input, templates, logos, and fonts are mounted read-only, and writes are limited to a temporary directory
- If the local renderer fails, pfpdf does not automatically fall back to Docker. Switching renderers is always explicit
- Verified host environments are Linux and Docker Desktop on macOS. The Docker renderer on a Windows host is experimental
- An image specified with `--docker-image` must match the internal renderer protocol of the current pfpdf. A mismatch is an error before rendering starts

## 7.6 Timeouts

The default timeout of 300,000 ms (five minutes) covers the entire operation: Docker image or browser verification and initial download, document readiness, PDF rendering, post-processing, and structural inspection. If a large document or slow initial download needs more time, choose a value from 1,000 to 3,600,000 ms. Unlimited values such as `0` are not accepted.

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --render-timeout-ms 600000
```

The timeout does not restart at each processing phase; it is an absolute deadline running from just before the renderer launches its first external process until PDF post-processing and structural inspection complete. On timeout, child processes and containers are stopped, existing output is preserved, and exit code `1` is returned.

## 7.7 Reproducible builds

If you want the same result from the same input, for example in CI, set the `SOURCE_DATE_EPOCH` environment variable. When the front matter `date` is omitted, the UTC date of this value is used instead of the run date.

Even if a display `date` is set in the front matter, the PDF metadata timestamps exist separately, so a build without `SOURCE_DATE_EPOCH` produces a warning and is not treated as reproducible.

```bash
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
  npx --yes @pfnet-research/pfpdf@0.1.0 --input docs --output docs.pdf
```

## 7.8 Debugging

- `--log-level debug` shows detailed logs and stack traces
- `--keep-work-dir` keeps the temporary workspace, letting you inspect the generated `document.html` / CSS, the resource manifest, and renderer diagnostics including readiness and page errors. If the pinned renderer does not provide browser console events, the full console is not recorded. Logical asset URLs cannot be resolved without the server once conversion ends, so opening the HTML directly is not guaranteed to render identically. The workspace containing diagnostics may retain secrets derived from your input, so delete it after inspection
