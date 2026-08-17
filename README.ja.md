# pfpdf

Markdown 文書から日本語組版に対応した PDF を生成する command line tool です。GitHub Flavored Markdown(GFM)を基準とし、表紙・目次・改ページ・数式・コードハイライト・raw HTML を扱えます。描画には [Vivliostyle CLI](https://github.com/vivliostyle/vivliostyle-cli) と Chromium を使います。

English README: [README.md](README.md)

公式サイト(テンプレートギャラリーとチュートリアル)はこのリポジトリから GitHub Pages で公開しています。`docs` ブランチは Pages workflow が force push する生成物(orphan 単一 commit)なので、編集したり作業の起点にしたりしないでください。

## クイックスタート

Node.js と npm があれば、install なしで実行できます。

```bash
npx pfpdf@latest --input document.md --output document.pdf
```

ディレクトリを渡すと、直下の `*.md` がファイル名順に結合されて 1 つの PDF になります。

```bash
npx pfpdf@latest --input docs --output docs.pdf
```

CI や長期保存する手順書では version を固定してください。

```bash
npx --yes pfpdf@0.1.0 --input docs --output docs.pdf
```

> **初回実行時の注意**: PDF 描画用の Chromium が自動で download されるため、初回は数百 MB の通信が発生することがあります。2 回目以降は cache が使われ、組み込み機能(数式・コードハイライト)だけを使う文書はネットワークなしで変換できます。

## 主な機能

- **GFM 基準の Markdown** — 表、task list、strikethrough、autolink、ネストしたリストなど、GitHub で使える標準記法をそのまま利用できます
- **日本語の強調に対応** — `これは**「重要」**です` のように全角約物が隣接する `**` も正しく `<strong>` になります
- **数式とコードハイライト** — `$...$` / `$$...$$` の数式と fenced code block の highlight が同梱アセットで動作します
- **BibTeX 参考文献** — front matter で `.bib` を指定し、`\cite{key}` から番号付き引用、参考文献一覧、PDF 内部リンクを生成します。記法は[チュートリアル](docs/tutorial.ja/03_gfm.md#39-bibtex-参考文献)を参照してください
- **raw HTML** — 信頼済み文書向けに inline / block の HTML を保持し、レイアウトの自由度を確保します
- **template とロゴの注入** — 研究報告向け `academic`、長文向け `book`、短い資料向け `compact`、中立な `default`、カジュアルな小冊子向け `notebook`、企業文書向け `pfn`、高密度な技術文書向け `technical` の 7 つの template を同梱。ロゴは同梱せず、`--logo PATH` または `PFPDF_LOGO` で利用側のファイルを注入します(未指定ならロゴ領域は表示されません)
- **再配布可能な同梱フォント** — 既定では OS のフォントに依存しません。host font は `--host-fonts` / `--font-dir` による明示的な opt-in です
- **local / Docker renderer** — 既定はローカル実行。サーバーや CI 向けに `--renderer docker` で公開 Docker image へ明示的に切り替えられます

## 対応環境

| OS / architecture | サポート水準 |
|---|---|
| macOS aarch64 (Apple Silicon) | 主要サポート |
| Linux x86_64 | 主要サポート |
| Windows x86_64 | 追加サポート |
| Linux aarch64 | 追加サポート |

いずれも CI で実 browser による PDF 生成まで検証しています。対応する Node.js の最低 version、固定している Vivliostyle CLI / browser / フォントの version は `package.json` と `package-lock.json` を正とします。

Linux では Chromium の実行に OS の shared library が必要です。必要 package と診断方法は [チュートリアルの troubleshooting 章](docs/tutorial.ja/08_troubleshooting.md) を参照してください。環境の診断には次が使えます。

```bash
npx pfpdf@latest --doctor
```

## trust model(重要)

pfpdf は**信頼できる自分の文書**を変換するための tool です。

- raw HTML と `<script>` は変換時に browser 上でそのまま実行されます。sanitization や sandbox は行いません
- 文書は pfpdf process が読めるローカルファイルを参照でき、リモートリソースへアクセスし得ます
- 出所の分からない Markdown を pfpdf で変換しないでください
- リモートリソースの取得可否・再現性は利用者の責任です

詳細は [SECURITY.md](SECURITY.md) と [設計書の security 章](docs/design.ja/08_security.md) を参照してください。

## ドキュメント

日本語版が正典で、英語版は同じ構成の翻訳です。

| 文書 | 日本語 | English |
|---|---|---|
| チュートリアル(導入から CLI・troubleshooting まで) | [docs/tutorial.ja/](docs/tutorial.ja/) | [docs/tutorial.en/](docs/tutorial.en/) |
| 設計書(仕様・architecture・設計判断) | [docs/design.ja/](docs/design.ja/) | [docs/design.en/](docs/design.en/) |

PDF 版は各 release の GitHub Release に添付されています。手元で生成する場合は `make docs` を実行してください。

## License

pfpdf の新規コードは [MIT License](LICENSE) です。同梱・依存する第三者ソフトウェア(AGPL-3.0 の Vivliostyle CLI、MathJax、highlight.js、フォントなど)のライセンスは [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) を参照してください。

貢献方法は [CONTRIBUTING.md](CONTRIBUTING.md)、脆弱性の報告は [SECURITY.md](SECURITY.md) を参照してください。
