# 8. Troubleshooting

## 8.1 Start with `--doctor`

If something goes wrong, run `--doctor` first.

```bash
npx @pfnet-research/pfpdf@latest --doctor
```

The command checks the Node.js version, browser availability, fonts, output permissions, and other environmental requirements, then reports problems with suggested remedies. When you provide `--input` and `--output`, it also checks the document's resources and output destination. Standard output contains a single JSON object with a versioned schema, making it suitable for CI; regular logs are written separately to standard error.

`--doctor` does not download browsers, create project or output directories, or change OS settings. For the actual launch check it uses an isolated temporary profile, which is deleted afterward. Each external check times out after 10 seconds including cleanup, and the whole run after 60 seconds.

To confirm that settings are taking effect as intended, use `--print-effective-config`. It prints each setting's value, along with whether it came from the CLI, an environment variable, front matter, or a default, as JSON. Include `--input` when checking a front matter template selection.

## 8.2 The Node.js version is too old

pfpdf checks the Node.js version at startup and exits with a clear error if it is outside the supported range (exit code `1`). Install a Node.js version within the semver range stated in the README. A newer version number alone is not necessarily supported.

## 8.3 The browser download fails

The first-run Chromium fetch is performed by the standard mechanism of the bundled Vivliostyle CLI and its browser manager.

- In environments that need a proxy or a custom CA, follow the Vivliostyle CLI / Puppeteer instructions to configure them
- If you already have a compatible browser, you can specify it explicitly with `--browser-path` / `PFPDF_BROWSER_PATH`

## 8.4 The browser does not start on Linux (missing shared libraries)

On Linux, OS shared libraries are required in addition to the browser itself. Because package names vary by distribution and release, check the missing libraries reported by `--doctor` and the list of verified distributions and browser revisions recorded in the compatibility chapter of the design document. Do not blindly install package names intended for a different release.

pfpdf never installs packages automatically with root privileges. Add OS packages explicitly, following your distribution's package manager and your operational policies.

## 8.5 The sandbox cannot start on Linux

Even with all shared libraries in place, some environments cannot start the Chromium sandbox, for example due to the unprivileged user namespace restrictions in Ubuntu 23.10 and later. This is a separate issue from missing libraries, and pfpdf's diagnostics report it as such.

Working around it requires configuration changes with root privileges. On Ubuntu, for example, one known approach is adding an AppArmor profile for the Chromium executable. If the environment cannot be changed, run the conversion in another supported environment where the sandbox works.

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
