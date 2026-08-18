# Security policy

## Trust model

pfpdf is a build tool for **trusted local documents**. It is not a sandbox:

- Raw HTML, `<style>`, and `<script>` in the input are executed as-is by the
  rendering browser. There is no sanitization.
- Input documents can reference any local file readable by the pfpdf process
  (images, CSS, fonts) and may fetch remote HTTP(S) resources.
- The loopback asset server is an implementation detail, not a security
  boundary.
- The renderer requests Chromium's sandbox.

Do not run pfpdf on Markdown from untrusted sources.

## Reliability measures

- Child processes are always spawned with argument arrays (`shell: false`).
- The asset server binds only to `127.0.0.1` and resolves files through the
  build's resource manifest. This is for correct rendering.
- Renderer child processes inherit the caller's environment. Renderer
  diagnostics are not sanitized or redacted.
- Output is committed atomically; failed builds never replace existing output.
- Temporary workspaces are created with mode `0700` via the OS secure
  temporary API and removed on exit unless `--keep-work-dir` is given.

## Reporting a vulnerability

Report vulnerabilities via GitHub security advisories on this repository, or
to the maintainers privately. Please do not open public issues for
security-sensitive reports.
