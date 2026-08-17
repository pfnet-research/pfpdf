# Contributing

Thank you for considering a contribution to pfpdf.

## Development setup

```bash
npm ci
npm run build
npm test          # unit tests
npm run test:e2e  # includes the PDF smoke test (downloads Chromium once)
npm run lint
```

## Rules

- Read `AGENTS.md` for the repository working rules.
- `docs/design.ja/` and `docs/tutorial.ja/` are the canonical specification.
  Changes to behavior must update the docs (and their English translations)
  in the same pull request.
- Record substantial design decisions in
  `docs/design.ja/09_design-decisions.md`.
- Do not upgrade the pinned Vivliostyle CLI, Markdown parser, or fonts without
  running PDF smoke tests on the supported platforms.
- `make docs` must succeed on a clean checkout. It is an alias for the
  `docs-release` target, which builds the public documents with the `default`
  template.
- `make list-templates` lists bundled templates, and `make docs-templates`
  builds the compact sample plus `design.ja.pdf` and `tutorial.ja.pdf` with
  every bundled template. A single template can be checked with a target such
  as `make docs-template-pfn`. Outputs are written below
  `build/docs/templates/<template>/`.
  `make docs-template-samples` builds only each template's `sample.pdf`, which
  is the reduced target used by pull request CI.
  `make docs-template-images` uses Poppler tools to validate the page count and
  contents, then renders every page as a sequentially named PNG for visual
  review.
