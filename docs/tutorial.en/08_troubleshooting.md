# 8. Troubleshooting

## 8.1 Start with `--doctor`

If something goes wrong, run `--doctor` first.

```bash
npx @pfnet-research/pfpdf@latest --doctor
```

The command checks the Node.js version, browser availability, fonts, output permissions, and other environmental requirements, then reports problems with suggested remedies. When you provide `--input` and `--output`, it also checks the document's resources and output destination. Standard output contains a single JSON object with a versioned schema, making it suitable for CI; regular logs are written separately to standard error.

`--doctor` does not download browsers, create project or output directories, or change OS settings. For the actual launch check it uses an isolated temporary profile, which is deleted afterward. Each external check times out after 10 seconds including cleanup, and the whole run after 60 seconds.

If the browser check fails, the `message` for `id: "browser"` in `checks` includes the exit code, signal, or timeout and the child process's stderr. The stderr excerpt is at most 4 KiB in UTF-8; longer output retains the beginning and end with an explicit truncation marker. This excerpt also helps diagnose unknown errors. Recognized root / sandbox, user namespace / AppArmor, shared library, and executable failures include a suggested cause. Diagnostics are encoded as a JSON string, so newlines in stderr do not split stdout into multiple JSON records.

To confirm that settings are taking effect as intended, use `--print-effective-config`. It prints each setting's value, along with whether it came from the CLI, front matter, or a default, as JSON. Include `--input` when checking front matter `template` / `toc` / `logo` settings.

## 8.2 The Node.js version is too old

pfpdf checks the Node.js version at startup and exits with a clear error if it is outside the supported range (exit code `1`). Install a Node.js version within the semver range stated in the README. A newer version number alone is not necessarily supported.

## 8.3 The browser download fails

The first-run Chromium fetch is performed by the standard mechanism of the bundled Vivliostyle CLI and its browser manager.

- In environments that need a proxy or a custom CA, follow the Vivliostyle CLI / Puppeteer instructions to configure them
- If you already have a compatible browser, you can specify it explicitly with `--browser-path`

## 8.4 The browser does not start on Linux (missing shared libraries)

On Linux, OS shared libraries are required in addition to the browser itself. Because package names vary by distribution and release, check the missing libraries reported by `--doctor` and the list of verified distributions and browser revisions recorded in the compatibility chapter of the design document. Do not blindly install package names intended for a different release.

pfpdf never installs packages automatically with root privileges. Add OS packages explicitly, following your distribution's package manager and your operational policies.

## 8.5 The sandbox cannot start on Linux

Even with all shared libraries in place, some environments cannot start the Chromium sandbox, for example due to the unprivileged user namespace restrictions in Ubuntu 23.10 and later. This is a separate issue from missing libraries, and pfpdf's diagnostics report it as such.

`root execution refused` means that the browser rejected root execution; run as a non-root user. `user namespace or AppArmor restriction` indicates a host restriction that can also affect non-root users. `browser sandbox unavailable` suggests another sandbox launch failure. Check these hints together with the original stderr retained in `message`.

Working around it requires configuration changes with root privileges. On Ubuntu, for example, one known approach is adding an AppArmor profile for the Chromium executable. If the environment cannot be changed, run the conversion in another supported environment where the sandbox works.

### Running in Docker (Ubuntu 24.04, amd64)

The repository checkout's `examples/docker/ubuntu24.Dockerfile` builds pfpdf using Ubuntu 24.04, Node.js 22.23.2, and the locked dependencies. It includes browser shared libraries and `unzip`, required to extract the initial browser download, and runs as a non-root user. The target is amd64; Arm64 hosts need Docker's amd64 emulation.

Run the following from the repository root. Use a non-root host user and directories owned by that user for output and cache.

```bash
docker build --platform linux/amd64 \
  -f examples/docker/ubuntu24.Dockerfile -t pfpdf-ubuntu24 .
PFPDF_CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/pfpdf-docker"
mkdir -p input output "$PFPDF_CACHE_DIR"
cat > input/memo.md <<'EOF'
---
title: Docker example
lang: en
---
# Memo

PDF from a container.
EOF
docker run --rm --platform linux/amd64 --init \
  --cap-add=SYS_ADMIN --user "$(id -u):$(id -g)" \
  --env SOURCE_DATE_EPOCH=0 \
  --mount "type=bind,source=$(pwd)/input,target=/input,readonly" \
  --mount "type=bind,source=$(pwd)/output,target=/output" \
  --mount "type=bind,source=$PFPDF_CACHE_DIR,target=/cache" \
  pfpdf-ubuntu24 --input /input/memo.md --output /output/memo.pdf
```

`SYS_ADMIN` is the capability needed to launch Chromium's sandbox in this container. [Puppeteer's Docker instructions](https://pptr.dev/guides/docker) also require it for sandboxed execution. Use this example where the operational policy permits that capability. pfpdf continues to process trusted documents and provides neither root conversion nor a CLI option to disable the sandbox.

Mount input read-only and output and `/cache` writable. `--user` uses the host UID / GID, so output files belong to the host user. The image sets `HOME=/tmp` and `XDG_CACHE_HOME=/cache`. The first conversion downloads Chromium to `/cache/vivliostyle/browsers`; subsequent conversions reuse it when the same cache directory is mounted. After conversion, replace the final arguments of the same `docker run` command with `--doctor` to check the downloaded browser's launch. Doctor with an empty cache reports a warning without downloading.

For `root execution refused`, check the runtime UID. For `user namespace or AppArmor restriction` / `No usable sandbox` as non-root, inspect the capability, Docker's seccomp policy, and the host user namespace / AppArmor policy. Changing only the container user does not remove Ubuntu 24.04 host restrictions. Consult [Ubuntu's AppArmor documentation](https://ubuntu.com/server/docs/how-to/security/apparmor/); the host administrator can provide an appropriate browser profile, or use a host where the sandbox works. The default example does not disable host-wide protections.

Verified environment: Ubuntu 24.04 amd64 container, Node.js 22.23.2, Vivliostyle CLI 11.1.0, managed Chrome 150.0.7871.115. On an Arm64 Docker daemon with amd64 emulation, verified fresh and reused caches, read-only input, host-owned output, and a successful doctor check. Root refusal and launch failure without the capability were also verified. Ubuntu-host-specific AppArmor profiles require separate host verification.

## 8.6 Japanese shows as tofu (□) / fonts differ from what you intended

- By default the bundled Japanese fonts are used, so tofu does not normally appear
- If a custom template specifies its own font family and that family cannot be found, pfpdf falls back to the bundled fonts and emits a warning
- If you want to use host fonts, specify `--host-fonts` / `--font-dir` explicitly (chapter 06). You can check which font files were selected with `--log-level debug` and `--doctor`

## 8.7 Math or code highlighting does not work

- Math and code highlighting run on bundled assets; no network access is required
- If you do not want a `$` to be treated as math, escape it as `\$` (chapter 05)
- If a `<script>` in the document throws before readiness completes, the whole conversion fails. Register asynchronous rendering with `window.pfpdf.registerReady(promise)`. You can keep `document.html` and the renderer diagnostics for inspection with `--keep-work-dir`

## 8.8 Rendering times out

- The default 5-minute timeout covers browser preparation, readiness, rendering, and PDF post-processing / structural inspection combined. Check the debug log to see which phase consumed the time
- Look for remote resources, unresolved registered promises, infinite script loops, huge images, or overly complex CSS
- If a healthy but large document is the only thing exceeding the limit, you can raise `--render-timeout-ms`. `0` cannot be used to mean unlimited
- After a timeout, the existing PDF is not overwritten. There is a short grace period before child processes are forcibly terminated, so wait for the CLI to exit before rerunning

## 8.9 The output file is not updated

If a conversion fails, the existing output PDF is not overwritten and remains as-is. Check the exit code (anything other than `0` is a failure). In CI you can use the `pfpdf` exit code directly as the pass/fail signal.

pfpdf discards truncated output that lacks a PDF header or final `%%EOF` marker, as well as output with a broken cross-reference table, catalog, or page tree. It also rejects encrypted and zero-page output. On Windows, the final replacement may fail when a viewer holds the existing PDF under an exclusive lock. Close the viewer and run the command again. pfpdf does not delete the existing PDF in advance merely to make replacement succeed.

After a `SIGKILL` or a power failure, `.pfpdf-...tmp` files may remain in the output directory. pfpdf does not reclaim them automatically, to avoid accidentally deleting another process's files. Confirm that no pfpdf process is running, then delete them manually.

## 8.10 If the problem persists

- Check the detailed logs and stack traces with `--log-level debug`
- Keep the workspace with `--keep-work-dir` and inspect the generated `document.html`, the resource manifest, and the renderer diagnostics
- When filing an issue, include your OS / architecture, Node.js version, pfpdf version, and the `--doctor` output

For image errors, check the original file, line, and destination in the diagnostic. Markdown `![caption]()` fails during preparation with an empty-destination error. Raw HTML `img` elements are checked after registered `window.pfpdf.registerReady(promise)` work finishes, so register the promise if a script supplies `src`. Corrupt images and HTTP / network failures report the authored destination and resolved URL. Browsers do not expose image HTTP status to document scripts; consult the destination server logs when necessary. Existing PDFs are preserved on failure.
