# 1. はじめに

## 1.1 必要なもの

- Node.js(対応する semver range は README を参照)と npm
- インターネット接続(初回のみ。npm package と PDF 描画用 browser の取得に使います)

Python や Docker は必要ありません。

> 初回実行時には PDF 描画のための Chromium が自動で download されるため、数百 MB の通信が発生することがあります。2 回目以降は cache が使われます。Linux では Chromium の実行に OS の shared library が必要です(08 章参照)。

browser の初回取得から PDF 完了までには既定で 5 分の timeout があります。低速な回線や大きな文書で不足する場合は、07 章の `--render-timeout-ms` を明示的に増やしてください。

## 1.2 最初の PDF

`hello.md` を作ります。

```md
---
title: はじめての pfpdf
---

# こんにちは

これは **pfpdf** で作った最初の PDF です。
```

変換します。

```bash
npx pfpdf@latest --input hello.md --output hello.pdf
```

`hello.pdf` が生成されれば成功です。表紙にタイトル、本文に見出しと段落が入っています。

## 1.3 version の固定

CI や長期保存する手順書では `latest` を使わず、version を固定してください。

```bash
npx --yes pfpdf@0.1.0 --input hello.md --output hello.pdf
```

## 1.4 ディレクトリをまとめて変換する

`--input` にディレクトリを渡すと、直下の `*.md` ファイルがファイル名順に結合されて 1 つの PDF になります。

```bash
docs/
  00_title.md
  01_intro.md
  02_details.md
```

```bash
npx pfpdf@latest --input docs --output docs.pdf
```

並び順はファイル名の byte 列順です。`00_`、`01_` のような番号 prefix を付けることを推奨します。

## 1.5 うまくいかないとき

環境の診断には `--doctor` を使います。

```bash
npx pfpdf@latest --doctor
```

Node.js、browser、フォントなどの状態を検査し、問題があれば対処方法とともに報告します。詳しくは 08 章を参照してください。
