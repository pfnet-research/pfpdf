# 5. Renderer

## 5.1 The `Renderer` interface

The `Renderer` interface accepts an immutable `RenderJob`. The job contains the generated `document.html`, resource manifest, temporary output path, temporary working directory, resolved configuration, absolute deadline, and an `AbortSignal`. The renderer obtains the HTML bytes created by `HtmlDocumentBuilder` from the `AssetServer`; it does not repeat Markdown conversion or configuration resolution.

- On success, the renderer returns the output path, byte size, and elapsed time; on failure, it does not return partial output as a result object
- Just before the renderer launches its first external process, set an absolute deadline, by default 300 seconds from that point. Apply the same deadline to browser verification and acquisition, waiting for the document to be ready for rendering, rendering, PDF metadata post-processing, and structural inspection. Pass the remaining time to every wait, so that per-phase or per-child timeout resets cannot extend the total time without bound
- The CLI and document-conversion pipeline expose no renderer selection and use one rendering path

## 5.2 Vivliostyle renderer

- Invoke the Vivliostyle CLI as a Node.js child process, maintaining a clear boundary from the pfpdf main process
- Pass the document URL of the `AssetServer` as input; do not generate a separate workspace `file:` URL
- Do not resolve the Vivliostyle CLI via `PATH` or `npx`; launch the entry point that pfpdf resolved through package resolution, using the Node.js at `process.execPath`
- Use the browser managed by the pinned Vivliostyle CLI's standard mechanism, or a verified browser explicitly specified by the user, and pass only confirmed option names. Do not reimplement browser acquisition or cache recovery in pfpdf
- Do not assemble shell strings; launch child processes with an argument array and `shell: false`
- Do not unnecessarily disable the sandbox provided upstream
- Do not forward the child's stdout and stderr to the parent's stdout; stream them to stderr at the appropriate log level and save them in the renderer diagnostics. Because trusted input is assumed, do not sanitize the content or redact credentials
- Cap saved renderer diagnostics at 8 MiB; after the cap is exceeded, keep draining the child pipe rather than abandoning it, to prevent deadlock. Record the truncation and the number of omitted bytes in the file, and do not let process memory grow in proportion to log volume. The volume forwarded to stderr is managed by the caller and is never diverted to stdout
- On timeout, `SIGINT`, and `SIGTERM`, start no new work; first request graceful termination, then force-kill after 5 seconds. The entire cleanup is also capped at 15 seconds. Use a dedicated process group on POSIX and the available process-tree termination on Windows to reclaim browser descendants on a best-effort basis. PIDs whose termination the OS cannot confirm after the cap are explicitly recorded in the diagnostics and are not treated as success
- Before conversion, check that the browser executable exists, is a regular file, and is executable. Perform the additional launch check with a minimal HTML page in `--doctor`, rather than on every run. If an actual conversion reveals an incompatible browser, produce a clear diagnostic and exit code `1`
- Do not treat a run as success if the child was terminated by a signal, if the exit code is nonzero, or if pipes or processes fail to close by the deadline

## 5.3 Output validation and commit

The renderer waits for the directly launched child to exit and stops it on catchable interruption. There is no arbitrary fixed limit on input size or request count, but `--render-timeout-ms` bounds execution through PDF structural inspection.

- After the child returns exit code `0`, confirm that the renderer output is a nonsymlink regular file and is long enough to contain at least a header and trailer
- `OutputCommitter` exclusively creates a temporary file in the same directory as the final output. It copies renderer output into this file through a fixed-size buffer and confirms that the cumulative byte counts read and written match the validated source size
- Before structural inspection, check a fixed-size prefix and suffix of the copied temporary file. Confirm that the file starts with a `%PDF-1.` or `%PDF-2.` header, the suffix contains the final `%%EOF` marker, and only permitted whitespace follows that marker
- Use a pinned structure-aware PDF library to parse the xref table or stream and incremental-update chain, trailer and catalog, object offsets, and page tree. Require at least one readable page without repair mode or warnings. Encrypted output, references to nonexistent objects, cyclic or out-of-range references, and zero-page output must produce exit code `1`; do not commit a broken PDF merely because its header and EOF marker are correct
- If post-processing is needed for the title, author, or timestamps in PDF Info / XMP, or for `/Lang` in the catalog, update the temporary file through the same library's public API and structurally inspect the final bytes again. Do not use regex replacement of PDF bytes or an automatically repaired parser result as successful output
- Do not perform PDF parsing or rewriting as synchronous work that occupies the main event loop. Isolate it in a terminable worker thread or dedicated child process launched without a shell. Pass the remaining time until the deadline, and on timeout or abnormal exit, terminate the thread or child process and discard the temporary file. Cyclic object graphs or huge xref data must not be able to block the deadline timer or signal handler itself
- Flush and close the temporary file in the same directory as the final output, then clean up the temporary working directory and commit to the final path in the order defined in chapter 02
- Normal execution does not inspect actual font selection, text content, or image diffs; CI smoke tests using the independent tools `pdfinfo`, `pdftotext`, and `pdffonts` supplement these checks
- Preserve existing output when generation fails
