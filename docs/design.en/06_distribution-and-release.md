# 6. Distribution and release

## 6.1 npm package design

- The repository and CI use `package-lock.json` to pin the complete dependency tree and its integrity values. npm does not use that file when installing a published package, so pin direct runtime dependencies to exact versions in `package.json`. Generate `npm-shrinkwrap.json` in an isolated staging directory from the same dependency tree as the reviewed lockfile, and include it in the tarball
- Derive the supported Node.js semver range from the intersection of the requirements of the pinned Vivliostyle CLI and all direct runtime dependencies. Do not broaden a non-contiguous range to accept every version at or above a minimum. Use the same range in `package.json`'s `engines`, the startup check, and CI for the four supported environments
- Choose the TypeScript compile target and published JavaScript syntax so the oldest runtime in the supported range can load the resulting code. Test the packed package on that runtime to confirm that the entry point which reports a version error does not itself fail to parse because of unsupported syntax
- Browser acquisition and caching are delegated to the pinned Vivliostyle CLI's standard mechanism; pfpdf only provides explicit overrides via `--browser-path`
- The npm tarball includes the compiled JavaScript, templates, CSS, fonts, MathJax, highlight.js, and license documents
- Review the tarball with `npm pack --dry-run` and confirm that it includes `npm-shrinkwrap.json` but not `package-lock.json`. A custom size budget, SBOM, signing, and provenance are not release requirements
- pfpdf's own lifecycle scripts perform no implicit browser download and never require or change root privileges. Lifecycle scripts of transitive dependencies are also checked via lockfile review and clean-install tests. When a browser must be acquired, the upstream standard mechanism is used on the first explicit run

## 6.2 Contents of the published tarball

The npm package `@pfnet-research/pfpdf` publishes the compiled `dist/launcher.js` as `pfpdf` via its `bin` field.

- Include only the package metadata and shrinkwrap, `dist/`, required resources, the README, and license documents in the published tarball. Confirm that no local absolute paths remain in the TypeScript source maps
- Use the `files` allowlist in `package.json` and CI inspection of the extracted tarball to ensure that test fixtures, `.env`, caches, and similar files are not published
- Publish the npm package as `@pfnet-research/pfpdf` under the organization scope. The registry rejects the unscoped `pfpdf` as confusingly similar to the existing `jspdf`, so it is not used. Publishing requires `--access public` or the equivalent `publishConfig.access`

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
    renderer.ts
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

The Make targets write their build artifacts to `build/docs/`, which is excluded by the `build/` entry in `.gitignore`. Generated PDFs are never committed to the source tree.

## 6.4 CI and supply chain

- CI for the npm package uses a matrix of macOS aarch64, Linux x86_64, Windows x86_64, and Linux aarch64, and runs Node.js tests and real PDF smoke tests in all four environments
- Third-party GitHub Actions are pinned to reviewed commit SHAs rather than floating tags, with the source tag preserved in a comment
- Review changes to `package-lock.json`
- Do not publish if the dependencies or integrity values in the `npm-shrinkwrap.json` generated in staging do not match the reviewed `package-lock.json`. Do not hand-edit the generated shrinkwrap in place of the source lockfile
- Dependabot or Renovate only opens update pull requests; nothing is auto-merged
- Every pull request runs TypeScript tests, lint, and a minimal PDF smoke test in the four environments. For a release tag, the release workflow packs the npm tarball once. All four environments install that same tarball and run a real PDF smoke test
- Every pull request runs `make docs-release docs-template-samples` to confirm that the canonical Japanese documents and their English translations build for publication, and that the shared preview builds with every bundled template. Use `make docs-template-images` for detailed visual review of every template
- `scripts/check-doc-translations.mjs` checks that Japanese and English files correspond and that their changes stay synchronized. Reviewers must verify semantic agreement between each translation and its original as part of the pull request review checklist
- `scripts/check-doc-policy.mjs` checks that no `AGENTS.md` contains Japanese characters
- The Vivliostyle CLI is never fetched unconditionally from npm's latest at run time; a single verified version is pinned via the exact direct dependency spec, the source lockfile, and the published shrinkwrap. Updates are never auto-merged and land only after sample PDF smoke tests on each supported OS
- CI test commands do not fetch conformance fixtures or scripts from the network; they use only inputs pinned in the lockfile and the repository. Jobs that require dependency downloads are separated from offline behavior checks
- Release Please uses commits in the Conventional Commits format as the units of change for a release. It updates the version, `CHANGELOG.md`, `package-lock.json`, and `npm-shrinkwrap.json` together in the release PR. Version decisions and release notes, including breaking changes in `0.x`, require human review before merge
- Use a short-lived installation token from a dedicated release GitHub App so the normal workflows can also run for PRs and tags created by Release Please. The App has the minimum necessary write permissions for Contents, Pull requests, and Issues in this repository. No personal access token is used

## 6.5 Publishing

- When the release PR is merged, Release Please creates a `v<package version>` tag at the merge commit and a draft GitHub Release. Creating the tag starts `.github/workflows/release.yml`. To resume manually, run `gh workflow run release.yml --ref v<package version>` so the workflow itself starts from the existing tag. Do not start it from a branch and supply a different tag as an input. Fail before publication unless the tag, `package.json`, lockfile, and CHANGELOG versions agree
- Build the npm tarball and four documentation PDFs exactly once from the same tagged source revision, then store them as a GitHub Actions artifact. Use these exact files through publication; do not rebuild them after approval
- Inspect the packed tarball's file allowlist, package name, version, shrinkwrap, checksums, and license files, then install it into an empty temporary project. Confirm that package paths, versions, resolved sources, and integrity values in the lockfile generated by installation match the published shrinkwrap. Use the same tarball for `npm ls --all --json`, `pfpdf --version`, and a real PDF smoke test on macOS aarch64, Linux x86_64, Windows x86_64, and Linux aarch64
- Create the GitHub Release as a draft and upload only the four PDFs from `build/docs/release/` plus `SHA256SUMS`. Immediately after upload and again just before publication, verify that the full set of remote assets and each asset's upload state, size, and SHA-256 digest exactly match the staging metadata. Template previews, the npm tarball, and internal metadata are not Release assets
- Configure the `release` GitHub Environment to require reviewers, prevent self-approval, and restrict release tags. Its approval job summary shows the source commit, the number of files in the tarball, the SHA-256 of the tarball itself, toolchain versions, checksums of the four PDFs, and all matrix-test results
- npm publishing uses GitHub Actions trusted publishing restricted to `.github/workflows/release.yml` and the `release` Environment; repository secrets contain no long-lived npm token. Only the publish job receives `id-token: write` for OIDC. Stable versions publish under `latest`, and prereleases under `next`
- After npm publication, install the exact version from the public registry into a new temporary project. Verify the version and confirm that a real PDF smoke test passes before publishing the draft GitHub Release. Append the results of verification against the public registry, npm tarball SHA-256, Vivliostyle / Chromium / font versions, and four PDF checksums to the release notes
- npm and GitHub Releases are published in separate operations, and one may complete without the other. A mid-release failure leaves the GitHub Release as a draft. On a rerun, compare the SHA-1 and integrity values of the same version on npm with those of the staged tarball. If both match, treat the version as already published and resume at verification; stop the workflow if either differs. Never overwrite or reuse a published artifact; use a new version for any fix
- Security fixes for transitive dependencies pinned by shrinkwrap do not automatically affect installations of existing releases. Distribute such fixes as a new patch release after updating the lockfile and passing all smoke tests

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
make docs-template-default # sample and Japanese design/tutorial PDFs with default
make docs-template-pfn     # sample and Japanese design/tutorial PDFs with pfn
make docs-templates        # sample and Japanese design/tutorial PDFs with every bundled template
make docs-template-images  # rasterize every sample page in each template for visual review
```

- Public PDFs go in `build/docs/release/` and template previews in `build/docs/templates/<template>/sample.pdf`, which prevents same-named PDFs from overwriting each other and previews from leaking into releases
- The `sample.pdf` previews use a common sample of at least 5 pages containing GFM, long tables and code blocks, math, local images, raw HTML, and page breaks. `compact`, which has no standalone cover, uses at least 4 pages. No upper limit is placed on page count. For templates other than `compact`, the sample has enough headings for the table of contents to span at least 2 pages. The first page rendered with `compact` contains both a two-column table of contents and body text
- So that coding agents can review the entire document, every page is rasterized to PNG with `pdftoppm` and placed in page order at `build/docs/template-images/<template>/page-NN.png`. The target for PNG conversion fails if a PDF falls short of the prescribed minimum page count, if the table of contents does not continue onto a second page for templates other than `compact`, or if the table of contents and body text do not coexist on `compact`'s first page
- `resources/templates/manifest.json` is the canonical list of bundled templates; the CLI's allowed names, `list-templates`, and `docs-templates` all use this list. Tests verify that the manifest matches the actual directories
- Each target uses the current pfpdf built from the checked-out source, and does not depend on `latest` in the registry or on a previous release
- `SOURCE_DATE_EPOCH` is accepted. Release builds set it to the timestamp of the commit referenced by the tag to improve reproducibility
- The release workflow regenerates the four PDFs with `docs-release` from the source referenced by the tag and uploads only `build/docs/release/*.pdf`, together with checksums, to the draft GitHub Release. Template preview PDFs and PNGs are not included in release assets. A release missing any of the four PDFs does not proceed to the published state

## 6.7 Versioning and license documents

- The CHANGELOG follows Semantic Versioning, and breaking changes in `0.x` are also explicitly noted
- Record the release tag, source commit, npm tarball checksum, versions of Vivliostyle, Chromium, and fonts, checksums of the four PDFs, post-publish verification, and the procedure for security-fix releases
- Code newly written for pfpdf is under the MIT License. However, do not represent the npm package as a whole as consisting solely of MIT-licensed components
- The Vivliostyle CLI is a direct runtime dependency and is licensed under AGPL-3.0. Organize the obligations per distribution channel (bundling in the npm package, network services), and record the exact source version, upstream URL, license text, and whether any modifications were made
- Also list MathJax, highlight.js, fonts, Chromium, Node.js, the GFM parser, the CJK-friendly extension, and the PDF parsing and rewriting tool in `THIRD_PARTY_LICENSES.md` with their versions, licenses, and sources
- Also pin the version, license, and source of the Unicode and language subtag data used for filename collision handling, heading slugs, and BCP 47 canonicalization. When updating these data, review any changes in compatibility with anchors and existing documents
- Before release, confirm secret scanning, dependency review, and updates to the third-party license list
