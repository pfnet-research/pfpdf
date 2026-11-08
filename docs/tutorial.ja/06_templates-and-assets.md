# 6. テンプレート、ロゴ、アセット、フォント

<style>
@media print {
  h2[id="61-同梱テンプレート"] + p + table :is(th, td):first-child { min-width: 8em; }
}
</style>

## 6.1 同梱テンプレート

pfpdf には 7 つのテンプレートが同梱されています。用途と特徴を目安に選んでください。

| テンプレート | 主な用途 | 特徴 |
|---|---|---|
| `academic` | 論文、研究報告、調査報告 | 本文は Noto Serif JP の明朝体。表、数式、図注を重視し、装飾を抑えたデザイン |
| `book` | チュートリアル、教科書、長文マニュアル | 章単位で読み進めるための落ち着いたデザイン |
| `compact` | 会議資料、社内メモ、短い報告書や配布資料、参照用メモ | 独立した表紙を置かず、狭い余白と 2 段組み目次でページ数を抑えるデザイン |
| `default` | 汎用文書 | 中立的なデザイン。既定のテンプレート |
| `notebook` | ノート、計画表、小冊子、親しみやすさを重視する教材 | 温かくカジュアルなデザイン |
| `pfn` | 企業文書、ブランド性を重視する公式文書 | ロゴ画像は同梱せず、外部から指定 |
| `technical` | 技術文書、設計書、API 仕様 | コード、表、長い識別子を読みやすく配置する高密度なデザイン |

`book` は章の区切りを明確にするため、短い章でも H1 の前で改ページするデザインです。ただし現在は、目次を表示すると、先頭の Markdown ファイル内の H1 にこの自動改ページが適用されません。ページ数を抑えたい文書には `default` または `compact` を使用してください。

通常は Markdown のフロントマターに `template` を書いて選択します。複数ファイルでは最初に指定された値を使います。

```md
---
title: 四半期報告書
template: pfn
---
```

一時的に別の見た目で出力する場合は `--template` を指定します。CLI はフロントマターの選択を上書きします。

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --template pfn
```

フロントマターから選べるのは同梱テンプレートだけです。CLI の `--template SOURCE` は、同梱プリセット名と完全に一致する値をプリセット名として扱い、それ以外はローカルディレクトリーまたは Git ロケーターとして扱います。同梱プリセットであることを明示する場合は `--template-preset` を使います。テンプレートは `default` を既定値とし、フロントマター、CLI の順に上書きされます。

同梱テンプレートは利用者が指定していない出版名、文書種別、ブランド名、目次名などの文字列を追加しません。すべての同梱テンプレートで共通のシリーズ名を表示したい場合は、フロントマターの `series` を使います。表示位置と書体はテンプレートごとに異なり、`series` を省略すると表示領域自体が削除されます。

表紙を省略する場合は、フロントマターの `cover: false` または CLI の `--no-cover` を使います。`--cover` でフロントマターの非表示指定を上書きできます。表紙の表示は、目次の `toc` / `--no-toc` とは独立して指定できます。

```bash
pfpdf --input report.md --output report.pdf --no-cover --no-toc
```

表紙を非表示にすると、`compact` では先頭の文書ヘッダーが省略されます。表紙上の著者・日付・シリーズ名・ロゴは表示しませんが、PDF のメタデータと、テンプレートが持つ本文の Confidential やシリーズ名の柱は維持します。

カスタムテンプレートで表紙を切り替える場合は、表紙全体を `data-pfpdf-slot="cover"` を持つ要素にします。`content` / `toc` スロットと独自の柱要素（running element）は、`cover` の外へ置いてください。`cover` スロットがないカスタムテンプレートの表示は、この切替では変わりません。

## 6.2 ロゴの指定

同梱テンプレートにはロゴ画像を含めていません。通常は Markdown のフロントマターに、利用者が権利を持つローカルファイルを指定します。相対パスは、`logo` を最初に指定した Markdown の親ディレクトリーを基準にします。

```md
---
title: 四半期報告書
template: pfn
logo: assets/logo.png
---
```

`logo: false` を指定すると、テンプレートの既定値を含めてロゴを表示しません。Git ロケーターから取得する場合や一時的に上書きする場合は、CLI の `--logo` を使います。

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --template pfn --logo assets/logo.png
```

- CLI で指定するロゴの相対パスは、カレントディレクトリーを基準に解決されます
- ロゴを明示しない場合は、テンプレートの既定の `src` を使います。それもなければロゴの表示領域自体を削除し、壊れた画像を示す代替表示を残しません
- フロントマターまたはテンプレートの既定ロゴを一時的に使わない場合は、`--no-logo` を指定します
- リポジトリーで管理するロゴを継続的に使う場合は、Makefile や CI ワークフローに `--logo` を記録してください

```make
docs.pdf: $(wildcard docs/*.md)
	npx --yes @pfnet-research/pfpdf@0.4.0 --input docs --output $@ \
	  --template pfn --logo assets/logo.png
```

## 6.3 カスタムテンプレート

同梱テンプレートで足りない場合は、`--template` で独自のテンプレートディレクトリーを指定できます。ディレクトリーには次の 3 ファイルを置きます。

```text
my-template/
  template.html
  style.css
  vivliostyle.css
```

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --template ./my-template
```

- カスタムテンプレートは信頼できるローカルコードとして扱われ、生の HTML やスクリプトを実行できます
- テンプレートの形式にバージョン間の互換性保証はありません。見た目を維持したい場合は pfpdf のバージョンを固定してください
- `template.html` は HTML 文書とし、本文の挿入先を `data-pfpdf-slot="content"` で 1 個だけ指定します
- 省略可能なスロットとして、`cover`、`title`、`author`、`series`、`date`、`confidential`、`toc`、`logo` をそれぞれ 0 または 1 個置けます。未知のスロット、スロットの重複、必須の `content` の欠落はエラーです
- 目次が複数ページに続く場合、文書言語に応じた継続ラベルが柱に表示されます。カスタムテンプレートで表示位置を変更する場合は、目次内の `.pfpdf-toc-continuation-marker` が設定する名前付き文字列 `pfpdf-toc-continuation` を、ページメディアのマージンボックスから参照します
- 処理済みの `data-pfpdf-slot` 属性は、HTML を組み立てた後に削除されます。信頼済みの入力に含まれるその他の属性は保持されます

最小の `template.html` は次のようになります。メタデータは文字列置換ではなく、スロット要素の子ノードとして安全に挿入されます。

```html
<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8"></head>
  <body>
    <header>
      <img data-pfpdf-slot="logo">
      <p data-pfpdf-slot="series"></p>
      <h1 data-pfpdf-slot="title"></h1>
    </header>
    <nav data-pfpdf-slot="toc"></nav>
    <main data-pfpdf-slot="content"></main>
  </body>
</html>
```

既定のロゴを持たせる場合は、例えば `src="assets/brand/logo.svg"` を `logo` スロットに設定します。このパスはテンプレートディレクトリーを基準にした相対パスです。`--logo` は、ローカルパスでも Git ロケーターでも、この `src` を上書きします。

- ロゴを明示してもテンプレートに `logo` スロットがなければ、指定を黙って無視せずエラーになります
- 既定の `src` も明示指定のロゴもなければ、`logo` スロット自体が出力から削除されます
- `author` または `series` が未指定の場合も、対応するスロットが削除されます
- `toc` スロットがない場合、目次は `content` の先頭に挿入されます

## 6.4 Git リポジトリーからの取得

テンプレートは Git リポジトリー内のサブディレクトリーから、ロゴはファイルから直接取得できます。リポジトリー URL とリポジトリー内のパスを `//` で区切り、リビジョンを `ref` で指定します。

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --template 'git::https://github.com/example/pdf-assets.git//templates/corporate?ref=0123456789abcdef0123456789abcdef01234567'
```

別のリポジトリーのロゴで、既定のロゴを上書きする例です。

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --template pfn \
  --logo 'git::ssh://git@example.com/pdf-assets.git//logos/brand/main.svg?ref=v2.0.0'
```

- リポジトリー内のパスはルートからの相対パスで、`templates/brand/print` のようなサブディレクトリーや `logos/brand/main.svg` のようなファイルを指定できます
- リビジョンにはブランチ、タグ、コミットを使えます。省略時はリモートの `HEAD` を取得して警告を出します。CI では完全なコミットハッシュに固定してください
- 非公開リポジトリーは Git の認証情報ヘルパーまたは SSH エージェントで認証します。トークンやパスワードを URL へ埋め込まないでください
- サブモジュールは取得しません。リポジトリーから取得するテンプレートも、生の HTML やスクリプトを実行できる信頼済みコードです
- オフラインでビルドを繰り返す場合は、あらかじめリポジトリーをクローンし、`--template` や `--logo` でローカルパスを渡せます

## 6.5 ローカルアセット

画像や CSS などのローカルファイルは、Markdown の親ディレクトリーを基準にした相対パスで参照します（第2章参照）。空白や日本語を含むパスも使えます。入力ディレクトリーが読み取り専用でも変換できます。

## 6.6 フォント

pfpdf には Noto Sans JP などの再配布可能な日本語フォントが同梱されており、同梱テンプレートは既定でこのフォントを明示的に指定します。通常の文書は OS のフォント探索結果に依存しません。

ただし、カスタム CSS や直接記述した CSS が OS 固有のフォントファミリーを要求した場合、Chromium 自体のフォント探索まで pfpdf が隔離することはできません。再現性が必要な文書では、このようなファミリーを要求しないでください。

### ホストフォントの利用

OS にインストールされたフォントを使うには、CLI で明示的に有効化します。

```bash
# OS 標準のフォントディレクトリーを探索する
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --host-fonts

# 特定のディレクトリーだけを追加する（--host-fonts なしでも可）
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --font-dir ~/my-fonts
```

- `--font-dir` は複数回指定できます
- フォントディレクトリーを指定すると、利用できる `@font-face` 定義が追加されます。実際に使うフォントファミリーは、カスタムテンプレートや文書の CSS で `font-family` に指定してください。ディレクトリーを追加しただけで本文のフォントが自動変更されることはありません

### ホストフォントの注意点

- フォントを技術的に参照できることと、そのフォントを PDF へ埋め込んで配布できることは別問題です。各フォントのライセンス条件は利用者自身が確認してください
- フォントディレクトリーの探索では、埋め込みが禁止されていると判定できたフォントを候補から除外し、警告を出します。現在はメタデータを検査できない WOFF2 も、警告して候補から除外します
- 設計書第4章では、CSS が埋め込み禁止のフォントを要求し、フォールバックもできない場合を入力エラーにし、CSS の URL で直接指定するローカルフォントや `data:` フォントも検査することを求めています。実ファイルを事前に特定できない `local()` への警告も要件です。これらの検査・警告は、現在の実装では行われていません
- CSS から直接指定するフォントも、利用者自身で利用権と埋め込み権を確認してください。厳密なビルドでは、事前に検査したフォントファイルを URL で指定してください
- ホストフォントを使った出力は OS とフォントの更新に依存し、環境をまたいだ同一の見た目は保証されません
