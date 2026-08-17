# 6. Distribution and release

## 6.1 npm package design

- The repository and CI use `package-lock.json` to pin the complete dependency tree and its integrity. Because npm does not consult that file when installing a published package, `package.json` uses exact versions for direct runtime dependencies, and the tarball includes an `npm-shrinkwrap.json` generated in an isolated staging directory from the same tree as the reviewed lockfile
- The supported Node.js semver range is derived from the intersection of the requirements of the pinned Vivliostyle CLI and all direct runtime dependencies; a non-contiguous range is not widened into a simple minimum version. The same range is used in `package.json` `engines`, the startup check, and CI for the four supported environments
- The TypeScript compile target and the syntax of the published JavaScript are chosen so the oldest runtime in the range can load them, and a packed-package test on that oldest runtime confirms that the entrypoint which emits the version error does not itself fail to parse due to unsupported syntax
- Browser acquisition and caching are delegated to the pinned Vivliostyle CLI's standard mechanism; pfpdf only provides explicit overrides via `--browser-path` / `PFPDF_BROWSER_PATH`
- The npm tarball includes the compiled JavaScript, templates, CSS, fonts, MathJax, highlight.js, and license documents
- Review the tarball with `npm pack --dry-run` and confirm that it includes `npm-shrinkwrap.json` but not `package-lock.json`. A custom size budget, SBOM, signing, and provenance are not release requirements
- pfpdf's own lifecycle scripts perform no implicit browser download and never require or change root privileges. Lifecycle scripts of transitive dependencies are also checked via lockfile review and clean-install tests. When a browser must be acquired, the upstream standard mechanism is used on the first explicit run

## 6.2 Contents of the published tarball

The npm package `@pfnet-research/pfpdf` publishes the compiled `dist/launcher.js` as `pfpdf` via its `bin` field.

- The published tarball contains only the package metadata and shrinkwrap, `dist/`, required resources, the README, and license documents, and it is confirmed that no local absolute paths remain in the TypeScript source maps
- The `files` allowlist in `package.json`, together with inspection of the tarball extracted in CI, ensures that test fixtures, `.env`, caches, and similar files are not published
- The npm package name is `@pfnet-research/pfpdf` in the Organization scope. The registry rejects the unscoped `pfpdf` as confusingly similar to the existing `jspdf`, so it is not used. Publishing requires `--access public` or the equivalent `publishConfig.access`

## 6.3 Directory layout

```text
pfpdf/
  .github/workflows/
    ci.yml
    release.yml
  src/
    asset-server.ts
    browser.ts
    cli.ts
    settings.ts
    input.ts
    resources.ts
    markdown/
      index.ts
      gfm-adapter.ts
      japanese-strong.ts
      pfpdf-directives.ts
    document.ts
    readiness.ts
    fonts.ts
    templates.ts
    workspace.ts
    output.ts
    renderer/
      index.ts
      internal.ts
      local.ts
      docker.ts
  resources/
    templates/
      default/
      pfn/
    fonts/
    mathjax/
    highlight.js/
  docs/
    design.ja/  design.en/
    tutorial.ja/  tutorial.en/
  scripts/
    check-doc-policy.mjs
    check-doc-translations.mjs
  tests/
  Makefile
  package.json
  package-lock.json
  tsconfig.json
  Dockerfile
  AGENTS.md
  README.md
  CHANGELOG.md
  CONTRIBUTING.md
  SECURITY.md
  CODE_OF_CONDUCT.md
  NOTICE.md
  THIRD_PARTY_LICENSES.md
  LICENSE
```

The Make targets generate `docs/*.pdf` files as build artifacts. They are listed in `.gitignore` and never committed.

## 6.4 CI and supply chain

- The npm package is tested on a matrix of macOS aarch64, Linux x86_64, Windows x86_64, and Linux aarch64, running Node tests and real PDF smoke tests in all four environments
- Third-party GitHub Actions are pinned to reviewed commit SHAs rather than floating tags, with the source tag preserved in a comment
- Diffs to `package-lock.json` are treated as a review target
- Publishing is forbidden if the dependencies or integrity of the `npm-shrinkwrap.json` generated in staging do not match the reviewed `package-lock.json`. The generated artifact is never hand-edited in place of the source lockfile
- Dependabot or Renovate only opens update pull requests; nothing is auto-merged
- Every pull request runs TypeScript tests, lint, packed npm package tests, and a minimal PDF smoke test in the four environments
- Every pull request runs `make docs-release docs-templates` to confirm that the public Japanese and English canonical and translated documents, as well as previews using all bundled templates, can be built
- `scripts/check-doc-translations.mjs` checks the Japanese/English file correspondence and change synchronization, and semantic agreement of translations is a mandatory checklist item in pull request review
- `scripts/check-doc-policy.mjs` checks that no `AGENTS.md` contains Japanese characters
- The Vivliostyle CLI is never fetched unconditionally from npm's latest at run time; a single verified version is pinned via the exact direct dependency spec, the source lockfile, and the published shrinkwrap. Updates are never auto-merged and land only after sample PDF smoke tests on each supported OS
- CI test commands do not fetch conformance fixtures or scripts from the network; they use only inputs pinned in the lockfile and the repository. Jobs that require dependency downloads are separated from offline behavior checks

## 6.5 Publishing

- npm publishing uses GitHub Actions trusted publishing; repository secrets contain no long-lived npm token
- Before npm publish, a dry-run job plus a human-approval environment verify the package name, version, tarball file list, checksums, and license files
- Before publishing, stage the npm tarball, per-architecture Docker images, document PDFs, and checksums from the same source revision, install the packed tarball into an empty temporary project, and confirm that the `npm ls --json` runtime tree matches the shrinkwrap. `npx @pfnet-research/pfpdf@<version>` via the registry is verified with a prerelease tag or during post-publish verification
- GitHub Releases are created as drafts first and published only after the upload of the four PDFs and their checksums has been confirmed. For Docker, inspect the immutable per-architecture digests first, and build the version manifest only from those digests
- npm, Docker, and GitHub Releases cannot be published atomically. If a failure occurs midway, do not overwrite or reuse already-published immutable artifacts; record the release as incomplete and ship a corrected version as a new version
- After publishing, verify from the public npm and Docker endpoints that the exact version and the internal renderer protocol match. A failed version is never overwritten; the fix is published as a new version
- Because security fixes for shrinkwrapped transitive dependencies also do not automatically reach the install results of existing releases, they are distributed as a new patch release with an updated lockfile that has passed all smoke tests

## 6.6 Document builds and release

The Makefile generates the public documents and template previews into separate output trees.

```bash
make docs-release          # full set of public PDFs with the default template
make docs                  # alias for docs-release
make list-templates        # list the bundled template names
make docs-template-default # short sample PDF for the default template
make docs-template-pfn     # short sample PDF for the pfn template
make docs-templates        # sample PDFs for all bundled templates
make docs-template-images  # rasterize every page to PNG for visual review
```

- Public PDFs go in `build/docs/release/` and template previews in `build/docs/templates/<template>/sample.pdf`, which prevents same-named PDFs from overwriting each other and previews from leaking into releases
- Instead of the full public documents, template previews use a common sample of at least 5 pages containing GFM, long tables and code blocks, math, local images, raw HTML, and page breaks. `compact`, which has no standalone cover, uses at least 4 pages. No upper limit is placed on page count. Templates other than `compact` have enough headings for the table of contents to span 2 or more pages, and `compact` has a two-column table of contents and body text coexisting on the first page
- So that coding agents can review the entire document, every page is rasterized to PNG with `pdftoppm` and placed in page order at `build/docs/template-images/<template>/page-NN.png`. The imaging target fails if a PDF falls short of the prescribed minimum page count, if the table of contents does not continue onto a second page for templates other than `compact`, or if the table of contents and body text do not coexist on `compact`'s first page
- `resources/templates/manifest.json` is the canonical list of bundled templates; the CLI's allowed names, `list-templates`, and `docs-templates` all use this list. Tests verify that the manifest matches the actual directories
- Each target uses the current pfpdf built inside the checkout, and does not depend on `latest` in the registry or on a previous release
- `SOURCE_DATE_EPOCH` is accepted, and release builds fix it to the tag's source date to improve reproducibility
- The release workflow regenerates the four PDFs with `docs-release` from the tag's source and uploads only `build/docs/release/*.pdf`, together with checksums, to the draft GitHub Release. Template preview PDFs and PNGs are not included in release assets. A release missing any of the four PDFs does not proceed to the published state
- Docker images are published to a public registry for `linux/amd64` and `linux/arm64` with the same version tag as the release tag, and the multi-architecture manifest is created only after real browser tests on both architectures. The digests are recorded in the release notes

## 6.7 Versioning and license documents

- The CHANGELOG follows Semantic Versioning, and breaking changes in `0.x` are also explicitly noted
- Record the release tag, Vivliostyle, Chromium, fonts, checksums of the four PDFs, post-publish verification, and the procedure for security-fix releases
- Code newly written for pfpdf is under the MIT License. However, do not represent the npm package or Docker image as a whole as consisting solely of MIT-licensed components
- The Vivliostyle CLI is a direct runtime dependency under AGPL-3.0. Organize the obligations per distribution channel (bundling into npm, Docker images, network services), and record the exact source version, upstream URL, license text, and whether any modifications were made
- MathJax, highlight.js, fonts, Chromium, Node.js, the GFM parser, the CJK-friendly extension, and the PDF parser/rewriter are likewise listed in `THIRD_PARTY_LICENSES.md` with their versions, licenses, and sources
- Also pin the version, license, and source of the Unicode and language subtag data used for filename collision handling, heading slugs, and BCP 47 canonicalization, and review compatibility diffs of anchors and existing documents when updating
- Before release, confirm secret scanning, dependency review, and updates to the third-party license list
