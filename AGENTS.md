# AGENTS.md

Working rules for coding agents in this repository. This file is intentionally
written in English and must stay free of Japanese characters (enforced by
`scripts/check-doc-policy.mjs`). Rationale behind these rules lives in the
design docs, not here.

## Canonical documents

- `docs/design.ja/` and `docs/tutorial.ja/` are the canonical specification and
  usage documents. They are written in Japanese.
- `docs/design.en/` and `docs/tutorial.en/` are translations. They must mirror
  the Japanese trees exactly: same file names, same numbering, same chapter
  structure. When Japanese and English disagree, Japanese wins; fix the English.
- `README.md` / `README.ja.md` are short entry points only. Do not duplicate
  detailed specifications there; link to the canonical docs instead.

## Documentation rules

- Any pull request that changes a file under `docs/design.ja/` or
  `docs/tutorial.ja/` must update the corresponding English file in the same
  pull request. CI checks file-set parity and change synchronization.
- Do not add or remove chapters in one language only.
- Tutorial chapters double as pfpdf input examples and are built to PDF in CI.
  Keep them valid pfpdf input: front matter only at the top of the first file,
  lowercase `.md` extensions, UTF-8.
- Record substantial design decisions in `docs/design.ja/09_design-decisions.md`
  (with the English translation), including rejected alternatives and reasons.
  Do not rely on commit messages or issues as the only record.

## Code rules

- Implementation language is TypeScript under `src/`; compiled output is what
  ships. Do not add runtime dependencies on Python.
- Pin dependencies via `package-lock.json`. Do not upgrade Vivliostyle CLI, the
  Markdown parser, or the CJK-friendly extension casually; upgrades require the
  PDF smoke tests on all supported platforms.
- Never spawn child processes through a shell (`shell: true` is forbidden);
  always use argument arrays.
- Fail fast: any conversion error must fail the whole build with a non-zero
  exit code. Never treat partial output as success.
- Exit codes: `0` success, `1` runtime/renderer errors, `2` input/CLI errors.
  Machine-readable results go to stdout; logs and diagnostics go to stderr.
- Configuration comes from CLI arguments and environment variables only; CLI
  always wins. Do not introduce project config files.
- Do not bundle logos, non-redistributable fonts, or other assets whose
  licenses have not been verified. The `pfn` template must keep working without
  a logo; logos are injected by users via `--logo` / `PFPDF_LOGO`.
- Treat inputs as trusted documents: no sanitization of raw HTML, no sandbox
  claims. Do not present the asset server or Docker mounts as security
  boundaries.

## Testing

- Run `npm ci`, `npm test`, and `npm run lint` before submitting.
- GFM conformance is tested against the pinned spec via `GfmAdapter`; intended
  deviations must be listed in `docs/design.ja/03_markdown.md` and its English
  translation, and covered by fixtures.
- The HTML inspected by integration tests must be the exact `document.html`
  consumed by the renderer; do not create a separate output pipeline for tests.
- Docs must build: `make docs` (all four PDFs) has to succeed on a clean
  checkout.

## Website (site/)

- The official website lives in `site/` as an independent Astro project with
  its own `package.json` and lockfile; never add site dependencies to the root
  package.
- Build order: `npm ci && npm run build` at the root, then `make site-assets`
  (renders the sample PDFs with Chromium and converts them to WebP; requires
  Poppler's `pdftoppm` and a prior `npm ci` inside `site/`), then
  `cd site && npm run build`. For local preview use `npm run dev` in `site/`.
- Internal links must stay base-path independent: write root-relative URLs in
  the sources; `site/scripts/relativize-links.mjs` rewrites them after the
  build and `site/scripts/check-links.mjs` fails the build on broken or
  root-relative leftovers. Only canonical / hreflang / og:url / sitemap and
  404.html use absolute URLs derived from `SITE_URL` / `GITHUB_REPOSITORY`.
- Never hardcode the GitHub org name, repository URL, or domain in `site/` or
  in `.github/workflows/pages.yml`; the repository is scheduled to move to a
  different organization.
- The `docs` branch is a generated deployment artifact (one orphan commit,
  force-pushed by the Pages workflow); never edit or base work on it.
