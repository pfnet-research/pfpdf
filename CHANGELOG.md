# Changelog

Notable changes to pfpdf are documented in this file. Versions follow Semantic
Versioning; breaking changes before 1.0 are called out explicitly.

## [0.3.0](https://github.com/pfnet-research/pfpdf/compare/v0.2.1...v0.3.0) (2026-10-29)


### Features

* **input:** allow unknown front matter with optional strict validation ([#17](https://github.com/pfnet-research/pfpdf/issues/17)) ([e550546](https://github.com/pfnet-research/pfpdf/commit/e55054663a23b9f18d45ae64689d5c0dc9deb4c2))
* **mermaid:** measure labels with the bundled font and default to ELK ([#12](https://github.com/pfnet-research/pfpdf/issues/12)) ([df3e369](https://github.com/pfnet-research/pfpdf/commit/df3e3698d9049f51f7366f730b2574d6e440c53f))


### Bug Fixes

* **markdown:** accept three or more underscores for page breaks ([#11](https://github.com/pfnet-research/pfpdf/issues/11)) ([f17faa5](https://github.com/pfnet-research/pfpdf/commit/f17faa528e5d7b0b1458c9411119f7ecfea2c6cf))
* **mermaid:** render Gantt diagrams with the server-side DOM ([#16](https://github.com/pfnet-research/pfpdf/issues/16)) ([15727af](https://github.com/pfnet-research/pfpdf/commit/15727af3a4973267645c0a31d87934e5de7167bd))
* **site:** preserve custom domains across Pages deployments ([#9](https://github.com/pfnet-research/pfpdf/issues/9)) ([625df5c](https://github.com/pfnet-research/pfpdf/commit/625df5c29f1c3b25c23b8dfb7a29191d37ca446a))

## [0.2.1](https://github.com/pfnet-research/pfpdf/compare/v0.2.0...v0.2.1) (2026-10-28)


### Bug Fixes

* **deps:** update vulnerable runtime and site dependencies ([#7](https://github.com/pfnet-research/pfpdf/issues/7)) ([26274d1](https://github.com/pfnet-research/pfpdf/commit/26274d160d5e6814d0d9b1104749249c6fe72ffb))

## [0.2.0](https://github.com/pfnet-research/pfpdf/compare/v0.1.0...v0.2.0) (2026-08-20)


### ⚠ BREAKING CHANGES

* remove Docker renderer support ([#4](https://github.com/pfnet-research/pfpdf/issues/4))

### Features

* enable configuration via Markdown files ([#6](https://github.com/pfnet-research/pfpdf/issues/6)) ([0cdb40b](https://github.com/pfnet-research/pfpdf/commit/0cdb40bb3180ef2f00ea6484a279b3d97dae436a))
* implement release process ([#1](https://github.com/pfnet-research/pfpdf/issues/1)) ([b8a7c74](https://github.com/pfnet-research/pfpdf/commit/b8a7c743ef57ff3b318785944bf32c99c7ae23b6))
* support template selection in Markdown front matter ([#5](https://github.com/pfnet-research/pfpdf/issues/5)) ([2591779](https://github.com/pfnet-research/pfpdf/commit/2591779a51dfe151948c90c653da31bec39405b5))


### Bug Fixes

* **release:** strengthen tag and artifact verification ([#3](https://github.com/pfnet-research/pfpdf/issues/3)) ([0d1df8d](https://github.com/pfnet-research/pfpdf/commit/0d1df8daff2b8fdad6e1831f8f8fc1bbd60098d8))


### Code Refactoring

* remove Docker renderer support ([#4](https://github.com/pfnet-research/pfpdf/issues/4)) ([d836f70](https://github.com/pfnet-research/pfpdf/commit/d836f7072cc9f768d6c5c7a27c311ad157b2aa0d))

## 0.1.0 (2026-08-18)

- Initial public npm package.
