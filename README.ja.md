# pfpdf

pfpdfは、Markdown文書から日本語組版に対応したPDFを生成するコマンドラインツールです。表紙や目次を付けた技術レポート、マニュアルなどを作れます。表・数式・コードハイライトにも対応しています。

[English](README.md) · [ウェブサイト](https://pfpdf.preferred.tech/ja/) · [チュートリアル](docs/tutorial.ja/01_getting-started.md)

<p>
  <a href="https://pfpdf.preferred.tech/ja/gallery/pfn/"><img src="docs/readme/pfn-cover.ja.webp" width="30%" alt="pfnテンプレートで生成した青い表紙"></a>
  <a href="https://pfpdf.preferred.tech/ja/gallery/pfn/"><img src="docs/readme/pfn-math.ja.webp" width="30%" alt="pfnテンプレートで組版した数式とMermaidの図"></a>
  <a href="https://pfpdf.preferred.tech/ja/gallery/notebook/"><img src="docs/readme/notebook-code.ja.webp" width="30%" alt="notebookテンプレートで組版した表とTypeScriptのコードハイライト"></a>
</p>

左から、`pfn`の表紙と本文、`notebook`の表とコードの例です。[テンプレートギャラリー](https://pfpdf.preferred.tech/ja/gallery/)では、同梱する7種類すべての出力を確認できます。

## 最初のPDF

Node.js 22.12.0以上とnpmを用意します。下の`npx`コマンドでpfpdfを取得して実行できます。

次の内容を`document.md`に保存します。先頭の`---`で囲んだ設定欄（フロントマター）で、タイトルとテンプレートを指定しています。

```markdown
---
title: 技術レポート
template: pfn
---

# 概要

これは**pfpdf**で作るPDFです。
```

`document.md`を保存したディレクトリーで、次のコマンドを実行します。

```bash
npx @pfnet-research/pfpdf@latest --input document.md --output document.pdf
```

初回はnpmパッケージと描画用ブラウザーのChromiumを取得するため、インターネット接続が必要です。Chromiumのダウンロードには数百MBの通信が発生することがあります。2回目以降は保存済みのブラウザーを再利用します。PDFの描画には[Vivliostyle CLI](https://github.com/vivliostyle/vivliostyle-cli)を使います。

生成された`document.pdf`を開くと、タイトルの入った表紙、目次、本文を確認できます。

CIや継続して使うビルド手順では、`@latest`を`@0.2.1`のような指定に置き換え、バージョンを固定してください。

## 複数ファイルの結合

章ごとにファイルを分ける場合は、`chapters/`などのディレクトリーにまとめ、`--input`に指定します。

```bash
npx @pfnet-research/pfpdf@latest --input chapters --output report.pdf
```

直下の`.md`ファイル（拡張子は小文字）をファイル名順に結合します。`00_title.md`、`01_intro.md`、`02_results.md`のように番号を付けると、読む順序を指定できます。フロントマターは、最初のファイルの先頭にだけ書きます。章の間のリンク、改ページ、画像のパスは[文書の構成](docs/tutorial.ja/02_document-structure.md)を参照してください。

## テンプレートと記法

見た目はフロントマターの`template`で選びます。一度だけ別のデザインを試す場合は、コマンドに`--template notebook`などを追加してください。コマンドライン引数がフロントマターより優先されます。

各テンプレートの既定フォントも、日本語フォントを含めて同梱しています。独自のテンプレートやロゴ、手元のフォントの指定方法は[テンプレートとアセット](docs/tutorial.ja/06_templates-and-assets.md)にまとめています。

文書に内容を追加するときは、次の記法を使えます。

| 書きたい内容 | 対応する記法と使用例 |
| --- | --- |
| 表・タスクリスト | [GitHub Flavored Markdown（GFM）](docs/tutorial.ja/03_gfm.md)に対応しています。取り消し線や、日本語の句読点・括弧に隣接する強調も扱えます。 |
| 数式・コード・図 | [TeXの数式、コードハイライト、Mermaid](docs/tutorial.ja/05_math-and-code.md)を使えます。描画に必要なアセットは同梱しています。 |
| 引用・参考文献 | [BibTeXファイル](docs/tutorial.ja/03_gfm.md#39-bibtex-参考文献)から参考文献一覧を生成し、本文の引用番号から各文献へリンクします。 |

## 動作環境とトラブルシューティング

CIでは、次の4環境で実際のブラウザーを使ったPDF生成を検証しています。

- macOS aarch64（Apple Silicon）
- Linux x86_64
- Windows x86_64
- Linux aarch64

LinuxではChromiumの実行にシステムライブラリーも必要です。変換に失敗したときは、次のコマンドで環境を診断してください。

```bash
npx @pfnet-research/pfpdf@latest --doctor
```

Node.js、ブラウザー、フォントなどの問題と対処方法が表示されます。Linuxの環境設定や、その他の変換エラーへの対処は[トラブルシューティング](docs/tutorial.ja/08_troubleshooting.md)を参照してください。

## 入力文書の取り扱い

入力には信頼できる文書を使ってください。pfpdfは入力のHTMLをそのまま描画し、スクリプトも実行します。文書からは、pfpdfが読み取れるローカルファイルや外部URLにアクセスできます。

リモートの画像などを参照する場合は、変換時に取得できる必要があります。入力文書を信頼する前提と脆弱性の報告方法は、[セキュリティーポリシー](SECURITY.md)に記載しています。

## ドキュメントと開発

| 文書 | 日本語 | 英語 |
| --- | --- | --- |
| チュートリアル：使い方と文書の例 | [日本語](docs/tutorial.ja/) | [English](docs/tutorial.en/) |
| 設計書：仕様と設計判断 | [日本語](docs/design.ja/) | [English](docs/design.en/) |

仕様と使い方は日本語版を基準とし、英語版はその翻訳です。各GitHub Releaseには4文書のPDFを添付しています。手元でPDFを生成したり開発に参加したりする場合は、[コントリビューションガイド](CONTRIBUTING.md)に従って環境を用意してください。文書のPDFは`make docs`で生成できます。

コマンドライン引数の一覧は[CLIの使い方](docs/tutorial.ja/07_cli-and-renderers.md)を参照してください。

## ライセンス

pfpdfのコードは[MIT License](LICENSE)で公開しています。依存するソフトウェアや同梱アセットには個別のライセンスが適用されます。Vivliostyle CLIのAGPL-3.0を含む一覧は、[第三者ライセンス](THIRD_PARTY_LICENSES.md)に記載しています。
