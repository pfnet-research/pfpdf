# 1. はじめに

## 1.1 必要なもの

- Node.js（対応するバージョン範囲は README を参照）と npm
- インターネット接続（npm パッケージと PDF 描画用ブラウザーの初回取得に使います）

Python は必要ありません。

> 初回実行時には PDF 描画用の Chromium が自動でダウンロードされるため、数百 MB の通信が発生することがあります。2 回目以降はキャッシュが使われます。Linux では Chromium の実行に OS の共有ライブラリーが必要です（08 章参照）。

ブラウザーの初回取得から PDF の生成完了までの制限時間は、既定で 5 分です。低速な回線や大きな文書で時間が足りない場合は、`--render-timeout-ms` で制限時間を増やしてください（07 章参照）。

## 1.2 最初の PDF

`hello.md` を作ります。

```md
# はじめての pfpdf

これは **pfpdf** で作った最初の PDF です。
```

変換します。

```bash
npx @pfnet-research/pfpdf@latest --input hello.md --output hello.pdf
```

`hello.pdf` が生成されれば成功です。表紙にタイトル、本文に見出しと段落が入っています。

タイトルを省略すると最初の H1（レベル 1 の見出し）がタイトルに使われ、本文にもその見出しが残ります。タイトルの指定方法や H1 がない場合の規則は 02 章を参照してください。

## 1.3 バージョンの固定

CI や長期保存する手順書では `latest` を使わず、バージョンを固定してください。

```bash
npx --yes @pfnet-research/pfpdf@0.4.0 --input hello.md --output hello.pdf
```

## 1.4 ディレクトリーをまとめて変換する

`--input` にディレクトリーを渡すと、直下の `*.md` ファイルがファイル名順に結合されて 1 つの PDF になります。

```bash
docs/
  00_title.md
  01_intro.md
  02_details.md
```

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf
```

並び順は、ファイル名をバイト列として比較して決まります。ファイル名の先頭に `00_`、`01_` のような番号を付けることを推奨します。

## 1.5 うまくいかないとき

環境の診断には `--doctor` を使います。

```bash
npx @pfnet-research/pfpdf@latest --doctor
```

Node.js、ブラウザー、フォントなどの状態を検査し、問題があれば対処方法とともに報告します。詳しくは 08 章を参照してください。
