# 5. Renderers

## 5.1 The `Renderer` interface

The `Renderer` interface accepts an immutable `RenderJob` containing the generated `document.html`, resource manifest, temporary output path, workspace, effective configuration, absolute deadline, and an `AbortSignal`. It hides the differences between `LocalRenderer` and `DockerRenderer` from both the CLI and document-conversion pipeline. Both renderers consume the same HTML bytes from `HtmlDocumentBuilder`; the container does not repeat Markdown conversion or configuration resolution.

- The renderer defaults to `local`; switching to Docker is explicit, via `--renderer docker` or `PFPDF_RENDERER=docker`
- Never fall back to Docker implicitly when local execution fails. The logs and exit code must identify which implementation failed
- On success, the renderer returns the output path, byte size, and elapsed time; on failure, it does not return partial output as a result object
- The timeout is an absolute deadline, defaulting to 300 seconds, measured from just before the renderer launches its first external process and covering Docker image and browser verification and acquisition, readiness, rendering, PDF metadata post-processing, and structural inspection. Pass the remaining time to every wait, so that per-phase or per-child timeout resets cannot extend the total time without bound

## 5.2 `LocalRenderer`

- Invoke the Vivliostyle CLI as a Node.js child process, maintaining a clear boundary from the pfpdf main process
- Pass the document URL of the local `AssetServer` as input; do not generate separate workspace `file:` URLs per renderer
- Do not resolve the Vivliostyle CLI via `PATH` or `npx`; launch the entry point that pfpdf resolved through package resolution, using the Node.js at `process.execPath`
- Use the browser managed by the pinned Vivliostyle CLI's standard mechanism, or a verified browser explicitly specified by the user, and pass only confirmed option names. Do not reimplement browser acquisition or cache recovery in pfpdf
- Do not assemble shell strings; launch child processes with an argument array and `shell: false`
- Do not unnecessarily disable the sandbox provided upstream
- Do not forward the child's stdout and stderr to the parent's stdout; stream them to stderr at the appropriate log level and save them in the renderer diagnostics. Because trusted input is assumed, do not sanitize the content or redact credentials
- Cap saved renderer diagnostics at 8 MiB; after the cap is exceeded, keep draining the child pipe rather than abandoning it, to prevent deadlock. Record the truncation and the number of omitted bytes in the file, and do not let process memory grow in proportion to log volume. The volume forwarded to stderr is managed by the caller and is never diverted to stdout
- On timeout, `SIGINT`, and `SIGTERM`, start no new work; first request graceful termination, then force-kill after 5 seconds. The entire cleanup is also capped at 15 seconds. Use a dedicated process group on POSIX and the available process-tree termination on Windows to reclaim browser descendants on a best-effort basis. PIDs and container IDs whose termination the OS cannot confirm after the cap are explicitly recorded in the diagnostics and are not treated as success
- The browser executable's existence, regular-file status, and executability are checked before conversion, but an additional launch with a minimal HTML page is not performed on every run; that is done in `--doctor`. An incompatible browser discovered during an actual conversion produces a clear diagnostic and exit code `1`
- Do not treat a run as success if the child was terminated by a signal, if the exit code is nonzero, or if pipes or processes fail to close by the deadline

## 5.3 `DockerRenderer`

- Docker is a supplementary distribution method for servers and existing CI systems, not the primary workflow presented in the README
- Launch the Docker CLI with an argument array and `shell: false`. If needed, pull explicitly within the deadline, then inspect the image, pin the content-addressed image ID/digest and the protocol label from the same result, and pass that pinned reference — not the tag — to `docker run`. Do not depend on a race in which the tag is swapped after the inspect, or on `docker run`'s implicit pull
- Pass the generated HTML and CSS, along with the inputs, templates, logos, and fonts enumerated by the resource manifest, as read-only bind mounts. Resolve settings on the host side, and do not pass the entire set of environment variables to the container
- The internal render command validates the mounted manifest against container paths, starts an `AssetServer` on the container's loopback interface, and then invokes the Vivliostyle CLI. It does not depend on reaching a host-side server, host network mode, or publishing host ports
- Do not mount the parent directory of the final output; mount only a per-run empty temporary output directory as writable. After the container succeeds, inspect the output on the host side, copy it to a sibling temporary file of the final output, and replace it atomically
- The container entrypoint is fixed to the internal render command rather than the externally facing CLI; by performing no renderer selection or settings resolution, recursive execution is structurally prevented
- Generate the mapping between host paths and container paths from the resource manifest. Resources in the same parent directory are combined into a single read-only mount, but do not over-broaden mounts to common ancestors, and do not mount `/`, the entire home directory, or the final output directory for convenience
- Include the number of mounts, and the argument count they add, in the common spawn limit calculation. If user resources exceed it, explain how to organize assets under a common directory and exit with code `2`; do not automatically fall back to mounting the filesystem root or copying assets
- Directories not shared in Docker Desktop produce a pre-run diagnostic error that includes mounting instructions
- The container baseline is a non-root user, a read-only root filesystem, `no-new-privileges`, capability drop, and PID 1 signal forwarding, with only the writable temp and profile directories that Chromium requires placed on tmpfs or a dedicated volume
- Whether the container has network access follows the same remote resource policy as the local renderer, and network access being enabled is not treated as a hidden sandbox boundary
- The default image uses the same version tag and digest policy as the running pfpdf. For custom images, verify the internal renderer protocol version recorded in the OCI label via `docker image inspect`; a mismatch or missing label is a user-specified incompatible configuration and yields code `2` before rendering. A label inconsistency in the default image itself is treated as distribution corruption with code `1`, and execution failures of the Docker daemon, inspect, or pull are runtime errors with code `1`
- Give the container an unpredictable per-build name and label; on timeout or interruption, execute `docker stop`, then `docker kill` after a grace period, and finally `docker rm`, using argument arrays. Do not enumerate or delete other containers by name prefix alone

### 5.3.1 The Chromium sandbox inside the container

Container hardening can conflict with the Chromium sandbox. With `no-new-privileges`, Chromium cannot use its setuid sandbox, and the default seccomp profile may prevent user-namespace creation. The preferred approach is to ship a minimal dedicated seccomp profile that permits user namespaces and preserves the sandbox, then demonstrate the following with the pinned browser on both architectures:

- Try non-root, read-only root filesystem, capability drop, and `no-new-privileges` individually and in combination, recording the browser sandbox's actual mode and the reason for any failure
- The dedicated seccomp profile's diff from the default profile, along with its rationale, is kept under source control, and `unconfined` is not accepted as a success condition
- If things only work without the sandbox, do not add flags implicitly; re-examine the threats and alternatives as a design decision
- Docker image releases treat agreement between this decision and `SECURITY.md` as a blocking gate, and are not completed on the strength of an "it is safe because it is a container" explanation alone

### 5.3.2 Host environments for the Docker renderer

For `v0.1.0`, the verification targets are Linux hosts and Docker Desktop on macOS. The Docker renderer on a Windows host is labeled Experimental until path conversion and file sharing can be verified.

Record the native Docker Engine version on Linux and the Docker Desktop version targeted by the release on macOS. Measure bind mount permissions, case sensitivity, symlinks, paths with spaces and Unicode, and the combinations of host architecture and image architecture in practice; do not claim a native architecture based on emulation alone.

## 5.4 Output verification and move

Both renderers wait for the child process or container they launched and stop it after a catchable interruption. Input size and request count have no arbitrary fixed limits, but `--render-timeout-ms` bounds the total execution time through PDF structural inspection.

- After the child returns exit code `0`, verify that the renderer output is a regular file, not a symlink, with at least the length required to hold a header and trailer
- The `OutputCommitter` copies the renderer output with a fixed-length buffer into a sibling temporary file created with exclusive create, and verifies that the cumulative read and write byte counts match the source's inspected size. Do not build separate commit pipelines for Docker and local
- For the sibling temporary file after copying, precheck that a fixed-length prefix contains the `%PDF-1.` or `%PDF-2.` header, and that a fixed-length suffix contains the final `%%EOF` marker followed only by permitted whitespace
- With a pinned structure-aware PDF library, parse the xref table or stream and the incremental update chain, the trailer and catalog, object offsets, and the page tree, and require that at least 1 page can be read without repair mode or warnings. Encrypted output, dangling objects, cyclic or out-of-range references, and 0 pages yield code `1`; do not commit a broken PDF whose only correct parts are the header and EOF
- When post-processing of the PDF Info / XMP title, author, and timestamps and of the catalog `/Lang` is needed, update the sibling temporary file via the same library's official API and re-run the structural inspection on the final byte sequence after the update. Do not treat regular-expression byte replacement or the parser's automatic repair results as successful output
- Do not run PDF parsing and rewriting as synchronous work that occupies the main event loop; isolate it in a terminable worker thread or a dedicated child process launched without a shell. Pass in the remaining deadline, and on timeout or abnormal exit, terminate the worker and discard the sibling temporary file. Never create a configuration in which cyclic object graphs or a huge xref can prevent the deadline timer and signal handlers themselves from running
- Flush and close the sibling temporary file, then perform workspace cleanup and the commit to the final path in the order specified in chapter 02
- Actual font selection, text content, and image diffs are not inspected in normal runs; they are covered by independent `pdfinfo` / `pdftotext` / `pdffonts` CI smoke tests
- If generation fails, keep the existing output

## 5.5 Docker image

- When providing a Docker image, also use a public registry and fixed tags
- Provide `linux/amd64` and `linux/arm64` in a multi-architecture manifest of the same version, and run PDF smoke tests with a real browser on both architectures
- On Apple Silicon Docker Desktop, use the native `linux/arm64` image, and document any per-architecture differences
- Operate release tags as immutable, and record image digests wherever possible in canonical builds and CI
- A standalone binary for users without Node.js will be considered from `v0.2.0` onward
