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
    release-please.yml
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
    check-workflows.mjs
    release-lib.mjs
    release.mjs
  tests/
  Makefile
  release-please-config.json
  .release-please-manifest.json
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
- Every pull request runs TypeScript tests, lint, and a minimal PDF smoke test in the four environments. For a release tag, the release workflow installs the identical npm tarball packed once by the workflow and runs a real PDF smoke test in all four environments
- Every pull request runs `make docs-release docs-template-samples` to confirm that the public Japanese and English canonical and translated documents, as well as the shared preview in every bundled template, can be built. Use `make docs-template-images` for detailed visual review of every template
- `scripts/check-doc-translations.mjs` checks the Japanese/English file correspondence and change synchronization, and semantic agreement of translations is a mandatory checklist item in pull request review
- `scripts/check-doc-policy.mjs` checks that no `AGENTS.md` contains Japanese characters
- The Vivliostyle CLI is never fetched unconditionally from npm's latest at run time; a single verified version is pinned via the exact direct dependency spec, the source lockfile, and the published shrinkwrap. Updates are never auto-merged and land only after sample PDF smoke tests on each supported OS
- CI test commands do not fetch conformance fixtures or scripts from the network; they use only inputs pinned in the lockfile and the repository. Jobs that require dependency downloads are separated from offline behavior checks
- Release Please treats Conventional Commits as release units and updates a release PR containing the version, `CHANGELOG.md`, `package-lock.json`, and `npm-shrinkwrap.json`. Version choices and release notes, including breaking changes in `0.x`, receive human review before merge
- A short-lived installation token from a dedicated release GitHub App lets the normal workflows run for PRs and tags created by Release Please. The App has only the necessary write permissions for Contents, Pull requests, and Issues in this repository; no personal access token is used

## 6.5 Publishing

- When the release PR is merged, Release Please creates a `v<package version>` tag at the merge commit and a draft GitHub Release. The tag starts `.github/workflows/release.yml`; a manual resume names an existing tag explicitly. Publishing fails early unless the tag, `package.json`, lockfile, and CHANGELOG versions agree
- Build the npm tarball and four documentation PDFs exactly once from the same tagged source revision, then preserve them as a GitHub Actions artifact. Approval promotes these exact files; it never rebuilds them
- Inspect the packed tarball's file allowlist, package name, version, shrinkwrap, checksums, and license files, then install it into an empty temporary project. The same tarball runs `npm ls --all --json`, `pfpdf --version`, and a real PDF smoke test on macOS aarch64, Linux x86_64, Windows x86_64, and Linux aarch64
- Create the GitHub Release as a draft and upload only the four PDFs from `build/docs/release/` plus `SHA256SUMS`. Template previews, the npm tarball, and internal metadata are not Release assets
- The `release` GitHub Environment has required reviewers, prevents self-review, and restricts release tags. Its approval job summary shows the source commit, tarball file count and SHA-256, toolchain versions, checksums of the four PDFs, and all matrix-test results
- npm publishing uses GitHub Actions trusted publishing restricted to `.github/workflows/release.yml` and the `release` Environment; repository secrets contain no long-lived npm token. Only the publish job receives `id-token: write`. Stable versions publish under `latest`, and prereleases under `next`
- After publishing, install the exact version from the public registry into a new temporary project and verify its version and a real PDF smoke test before publishing the draft GitHub Release. Append the public verification, npm tarball SHA-256, Vivliostyle / Chromium / font versions, and four PDF checksums to the release notes
- npm and GitHub Releases cannot be published atomically. A mid-release failure leaves the GitHub Release as a draft. On a rerun, an npm version whose SHA-1 and integrity match the staged tarball is treated as already published and resumes at verification; a mismatch stops the workflow. Never overwrite or reuse a published artifact; a fix gets a new version
- Docker image build and publication are outside the release workflow. While Docker renderer code remains in the source tree, an npm release does not depend on Docker registry state and GitHub Release assets contain no Docker artifact
- Because security fixes for shrinkwrapped transitive dependencies also do not automatically reach the install results of existing releases, they are distributed as a new patch release with an updated lockfile that has passed all smoke tests

The following one-time settings live outside the repository:

- Put the dedicated release GitHub App ID in the `RELEASE_APP_ID` repository variable and its private key in the `RELEASE_APP_PRIVATE_KEY` Actions secret
- Bind the npm package trusted publisher to this repository, the `release.yml` workflow file, and the `release` Environment, and permit public publishing
- Configure required reviewers and a deployment tag rule on the `release` GitHub Environment, and use a ruleset to forbid release-tag updates and deletion

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

## 6.7 Versioning and license documents

- The CHANGELOG follows Semantic Versioning, and breaking changes in `0.x` are also explicitly noted
- Record the release tag, source commit, npm tarball checksum, Vivliostyle, Chromium, fonts, checksums of the four PDFs, post-publish verification, and the procedure for security-fix releases
- Code newly written for pfpdf is under the MIT License. However, do not represent the npm package or Docker image as a whole as consisting solely of MIT-licensed components
- The Vivliostyle CLI is a direct runtime dependency under AGPL-3.0. Organize the obligations per distribution channel (bundling into npm, Docker images, network services), and record the exact source version, upstream URL, license text, and whether any modifications were made
- MathJax, highlight.js, fonts, Chromium, Node.js, the GFM parser, the CJK-friendly extension, and the PDF parser/rewriter are likewise listed in `THIRD_PARTY_LICENSES.md` with their versions, licenses, and sources
- Also pin the version, license, and source of the Unicode and language subtag data used for filename collision handling, heading slugs, and BCP 47 canonicalization, and review compatibility diffs of anchors and existing documents when updating
- Before release, confirm secret scanning, dependency review, and updates to the third-party license list
