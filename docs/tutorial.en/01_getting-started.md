# 1. Getting Started

## 1.1 What you need

- Node.js (see the README for the supported version range) and npm
- An internet connection (for the initial download of npm packages and the browser used for PDF rendering)

Python is not required.

> On the first run, pfpdf automatically downloads Chromium for PDF rendering.
> The download may be several hundred megabytes. Subsequent runs use the cached
> browser. On Linux, Chromium also requires system shared libraries (see
> Chapter 08).

By default, a five-minute time limit applies from the initial browser download until PDF generation finishes. If a slow connection or a large document needs more time, use `--render-timeout-ms` to increase the limit (see Chapter 07).

## 1.2 Your first PDF

Create `hello.md`.

```md
# My First pfpdf

This is my first PDF made with **pfpdf**.
```

Convert it.

```bash
npx @pfnet-research/pfpdf@latest --input hello.md --output hello.pdf
```

After the command succeeds, `hello.pdf` contains a cover with the title and a body with the heading and paragraph.

When the title is omitted, pfpdf uses the first H1 (level 1 heading) as the title and keeps that heading in the body. See Chapter 02 for how to specify a title and the rules when there is no H1.

## 1.3 Pinning the version

In CI and long-lived runbooks, pin a specific version instead of using `latest`.

```bash
npx --yes @pfnet-research/pfpdf@0.4.0 --input hello.md --output hello.pdf
```

## 1.4 Converting a whole directory

When you pass a directory to `--input`, pfpdf combines the `*.md` files directly inside it into a single PDF, ordered by filename.

```bash
docs/
  00_title.md
  01_intro.md
  02_details.md
```

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf
```

Files are ordered by comparing their filenames as byte sequences. We recommend adding numeric prefixes such as `00_` and `01_`.

## 1.5 When things go wrong

Use `--doctor` to diagnose your environment.

```bash
npx @pfnet-research/pfpdf@latest --doctor
```

The command checks Node.js, browser availability, fonts, and other parts of the environment, then reports any problems with suggested fixes. See Chapter 08 for details.
