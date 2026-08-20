# 6. template、ロゴ、アセット、フォント

## 6.1 bundled template

pfpdf には 7 つの template が同梱されています。

| template | 説明 |
|---|---|
| `academic` | 論文や研究報告に適した、Noto Serif JP の明朝本文と、表、数式、図注を重視する抑制したデザイン |
| `book` | tutorial、教科書、長文 manual に適した、章単位で読み進めるための落ち着いたデザイン |
| `compact` | 会議資料、社内メモ、短い report に適した、独立した表紙を置かず狭い余白と2段組み目次でページ数を抑えるデザイン |
| `default` | 中立なデザイン。既定値 |
| `notebook` | ノートや計画表、小冊子に適した、温かくカジュアルなデザイン |
| `pfn` | 企業文書向けのデザイン。ロゴは同梱されず、外部から注入します |
| `technical` | コード、表、長い識別子を読みやすく配置する高密度な技術文書向けデザイン |

通常は先頭 Markdown の front matter に `template` を書いて選択します。

```md
---
title: 四半期報告書
template: pfn
---
```

一時的に別の見た目で出力する場合は `--template` を指定します。CLI は front matter の選択を上書きします。

用途に迷う場合は、短い配布資料や参照用メモには `compact`、章単位で読み進める長文には `book`、親しみやすさを重視する教材には `notebook`、ブランド性を重視する公式文書には `pfn` を選ぶのが目安です。中立的な汎用文書には `default`、論文や調査報告には `academic`、設計書や API 仕様には `technical` が適します。

`book` は章の区切りを明確にするため、短い章でも H1 ごとに新しいページを開始します。ページ数を抑えたい文書には `default` または `compact` を使用してください。

bundled template は利用者が指定していない出版名、文書種別、ブランド名、目次名などの文字列を追加しません。全 template で共通のシリーズ名を表示したい場合は front matter の `series` を使います。表示位置と書体は template ごとに異なり、省略時は表示領域自体が削除されます。

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --template pfn
```

front matter から選べるのは bundled template だけです。CLI の `--template SOURCE` は、bundled preset 名との完全一致ならpreset、それ以外はlocal directoryまたはGit locatorとして扱います。presetであることを明示する場合は`--template-preset`を使います。template選択全体の優先順は、組み込みの`default`、front matter、CLIです。

## 6.2 ロゴの注入

bundled template にはロゴ画像を含めていません。通常は先頭Markdownのfront matterに、利用者が権利を持つlocal fileを指定します。custom templateは`logo` slotの`src`にtemplate相対pathを書くことで既定ロゴを持てます。

```md
---
title: 四半期報告書
template: pfn
logo: assets/logo.png
---
```

front matterの相対pathは、そのMarkdownの親directory基準です。`logo: false`ならtemplate既定値を含めてロゴを表示しません。Git locatorや一時的な上書きには`--logo` / `--no-logo`を使います。

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --template pfn --logo assets/logo.png
```

- ロゴの相対パスはカレントディレクトリ基準で解決されます
- 明示ロゴがなければ template の既定 `src` を使います。それもなければロゴ領域自体を削除し、壊れた画像 placeholder を残しません
- repository logoを継続的に使う場合は、MakefileやCI workflowに`--logo`を記録してください
- front matterまたはtemplate既定ロゴを一時的に使わない場合は`--no-logo`を指定します

```make
docs.pdf: $(wildcard docs/*.md)
	npx --yes @pfnet-research/pfpdf@0.1.0 --input docs --output $@ \
	  --template pfn --logo assets/logo.png
```

## 6.3 custom template

bundled template で足りない場合は、`--template` で独自の template directory を指定できます。directory には次の 3 ファイルを置きます。

```text
my-template/
  template.html
  style.css
  vivliostyle.css
```

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --template ./my-template
```

- custom template は信頼できるローカルコードとして扱われ、raw HTML や script を実行できます
- template format に version 間の互換性保証はありません。見た目を維持したい場合は pfpdf の version を固定してください
- `template.html` は HTML document とし、本文の挿入先を `data-pfpdf-slot="content"` で 1 個だけ指定します
- `title`、`author`、`series`、`date`、`confidential`、`toc`、`logo` の optional slot も 0 または 1 個置けます。未知 slot、重複 slot、必須 `content` の欠落はエラーです
- 目次が複数ページに続く場合、文書言語に応じた継続ラベルが柱に表示されます。custom template で表示位置を変更する場合は、目次内の `.pfpdf-toc-continuation-marker` が設定する `pfpdf-toc-continuation` named string を paged media の margin box から参照します
- 処理された `data-pfpdf-slot` attribute は組立て後の HTML から除去されます。その他の trusted attribute は保持されます

最小の `template.html` は次のようになります。metadata は文字列置換ではなく、slot element の child node として安全に挿入されます。

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

既定ロゴを持たせる場合は、例えば `src="assets/brand/logo.svg"` を `logo` slot に設定します。`--logo` はlocal pathでもGit locatorでもこの`src`を上書きします。明示ロゴを指定したtemplateに`logo` slotがない場合は、指定を黙って無視せずエラーになります。既定`src`も明示ロゴもなければ`logo` slot自体が出力から削除されます。authorまたはseries未指定時も対応するslotが削除されます。`toc` slotがない場合、目次は`content`の先頭に挿入されます。

## 6.4 Git repository source

template または logo は Git repository 内のサブディレクトリ／file から直接取得できます。repository URL と repository 内 path の境界は `//`、revision は `ref` で指定します。

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --template 'git::https://github.com/example/pdf-assets.git//templates/corporate?ref=0123456789abcdef0123456789abcdef01234567'
```

別の repository logo で既定ロゴを上書きする例です。

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --template pfn \
  --logo 'git::ssh://git@example.com/pdf-assets.git//logos/brand/main.svg?ref=v2.0.0'
```

- `PATH` は repository root からの相対 path で、`templates/brand/print` や `logos/brand/main.svg` のようなサブディレクトリを指定できます
- revision には branch、tag、commit を使えます。省略時は remote `HEAD` を取得して warning を出します。CI では完全な commit hash に固定してください
- private repository は Git credential helper または SSH agent で認証します。token や password を URL へ埋め込まないでください
- submodule は取得しません。repository template も raw HTML や script を実行できる trusted code です
- repository source を繰り返し使う offline build では、あらかじめ clone し、`--template` や `--logo` で local path を渡せます

## 6.5 ローカルアセット

画像や CSS などのローカルファイルは、Markdown からの相対パスで参照します(02 章参照)。空白や日本語を含むパスも使えます。入力ディレクトリが読み取り専用でも変換できます。

## 6.6 フォント

pfpdf には再配布可能な日本語フォント(Noto Sans CJK JP など)が同梱されており、bundled template は既定でこの同梱フォントを明示します。通常の文書は OS の font 探索結果に依存しません。ただし custom / raw CSS が OS 固有の family を直接要求した場合、Chromium 自体の font discovery まで pfpdf が隔離することはできません。再現性が必要な文書では、custom / raw CSS から OS 固有の family を要求しないでください。

### host font の利用

OS にインストールされたフォントを使いたい場合は、明示的に opt-in します。

```bash
# OS 標準の font directory を探索する
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --host-fonts

# 特定の directory だけを追加する(--host-fonts なしでも可)
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --font-dir ~/my-fonts
```

- `--font-dir` は複数回指定できます
- font directory の指定は利用可能な `@font-face` を追加します。実際に使う family は custom template や文書の CSS で `font-family` に指定してください。directory を追加しただけで本文 font が自動変更されることはありません

### host font の注意点

- フォントを技術的に参照できることと、そのフォントを PDF へ埋め込んで配布できることは別問題です。各フォントのライセンス条件は利用者自身が確認してください
- 埋め込み禁止を判定できたフォントは候補から除外され、CSS がその font を要求して fallback できない場合は入力エラーになります。未使用候補や format 上で制限を判定できない場合は warning が出ます
- CSS の URL で直接指定した local / `data:` font にも同じ検査が行われます。`local()` は実ファイルを事前特定できないため warning になり、利用権と埋め込み権は利用者が確認します。厳密な build では検査可能な font file の URL を使ってください
- host font を使った出力は OS とフォントの更新に依存し、環境をまたいだ同一の見た目は保証されません
