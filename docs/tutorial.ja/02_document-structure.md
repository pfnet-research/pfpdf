# 2. 文書の構成

## 2.1 front matter

文書の metadata は、最初の Markdown ファイルの先頭に YAML front matter として書きます。

```md
---
title: 四半期報告書
author: 山田 太郎
series: 技術報告シリーズ
date: 2026-08-01
page_size: A4
confidential: false
lang: ja
dir: ltr
---
```

使える key は次の 8 つだけです。未知の key や重複する key はエラーになります。

| key | 型 | 既定値 | 説明 |
|---|---|---|---|
| `title` | string | なし(必須) | 文書タイトル。表紙では `<br>` で改行できます |
| `author` | string | なし | 著者名 |
| `series` | string | なし | 全 bundled template の主要ラベル位置に表示するシリーズ名 |
| `date` | string | 実行日 | 表紙に表示する日付 |
| `page_size` | keyword / 寸法 | `A4` | ページサイズ |
| `confidential` | boolean | `false` | `true` のとき全 page に Confidential 表示を出します |
| `lang` | BCP 47 string | `ja` | 文書の言語。HTML の `lang`、組版、フォント選択に使います |
| `dir` | `ltr` / `rtl` / `auto` | `auto` | 文書の文字方向。HTML root の `dir` に使います |

- `title` は必須です。front matter に書くか、`--title` で指定してください。どちらにもない場合はエラー(終了 code `2`)になります
- `series` を省略するとシリーズ表示領域自体が削除されます。bundled template は固定の出版名、文書種別、ブランド名、定型ラベルを補いません
- 表紙のタイトルを改行したいときは `title: "長いタイトル<br>サブタイトル"` のように `<br>` を使います。使える tag は `<br>` / `<br/>` だけです
- front matter は YAML mapping として読みます。pfpdf が利用する key は上表のものだけで、それぞれ表に記載した型である必要があります。複雑な YAML 値を書けても metadata としては利用されません
- source file の最初の行が `---` なら front matter delimiter とみなされます。最初の file では閉じる `---` または `...` が必要で、2 個目以降の file では front matter の重複としてエラーです。各 file の先頭で水平線を出したい場合は `***` を使ってください
- `page_size` の keyword は `A3` / `A4` / `A5`、`JIS-B4` / `JIS-B5`、`ISO-B4` / `ISO-B5`、`Letter` / `Legal` です。規格が曖昧な `B4` / `B5` は使えません。`210mm 297mm` のように幅と高さを指定することもできます
- 英語文書なら `lang: en` のように BCP 47 language tag を指定します。省略時は host の言語に依存せず `ja` です
- 右から左へ書く文書は `dir: rtl`、左から右なら `dir: ltr` を指定できます。`auto` は文書内容から browser が判定し、`lang` や host locale だけから方向を推測しません
- `lang` の primary language が `ja` なら自動日付は `2026 年 8 月 3 日`、それ以外では `2026-08-03` の固定表記になります。front matter に書いた `date` の文字列自体は書き換えられません

## 2.2 複数ファイルの結合

ディレクトリを入力にすると、直下の `*.md` がファイル名順に結合されます。

- front matter を書けるのは、並び順で最初のファイルの先頭 1 か所だけです。2 つ目以降のファイルに `---` front matter があるとエラーになります
- 拡張子は小文字の `.md` だけが対象です
- ファイルは UTF-8 で保存してください(先頭の BOM と CRLF 改行は受け付けます)
- 各ファイルは独立した Markdown として解釈されます。code fence、list、raw HTML block、reference link definition を次のファイルへ続けることはできません。章をまたぐ構文は 1 ファイル内で閉じてください

## 2.3 ファイル間のリンク

同じ文書に結合される Markdown ファイルへの相対リンクは、Markdown 記法でも raw HTML の `<a href>` でも、生成される PDF 内の対象ファイル先頭へのリンクに書き換えられます。存在しないファイルを指すリンクは入力エラーになります。

```md
詳細は [03 章](03_gfm.md) を参照してください。
```

別ファイル内の見出しへ直接移動するには fragment を付けます。同じ見出しが複数ある場合、2 個目以降の anchor には `-2`、`-3` が付くため、表示された実際の ID を指定します。

```md
[表の節](03_gfm.md#34-表)を参照してください。
```

見出しへの文書内リンクも使えます。

```md
[front matter の節](#21-front-matter) を参照してください。
```

PDF と一緒に配布する spreadsheet など、`.md` 以外の相対 local file への link は、変換後に配信 server が終了すると壊れるため受け付けません。portable な link には HTTP(S) URL を使ってください。特定 machine の file を開く意図がある場合だけ absolute `file:` URL を明示できます。

## 2.4 目次と改ページ

- 目次は既定で生成されます。不要なら `--no-toc` を指定します
- 改ページしたい位置には、単独の行に `___`(underscore 3 つ)を書きます

```md
ここで章が終わります。

___

ここから新しいページが始まります。
```

`___` は pfpdf の拡張です。水平線(thematic break)を出したいときは `---` または `***` を使ってください。

改ページは次の block を新しい page から始めます。文書先頭 / 末尾や連続した `___` は空白 page を作らず、1 回の改ページへまとめられます。

## 2.5 画像などの相対パス

file input では Markdown ファイルの親ディレクトリ、directory input では入力ディレクトリが相対パスの基準です。directory input の Markdown はすべて直下にあるため、同じ基準になります。

```md
![構成図](assets/diagram.png)
```

一方、CLI 引数(`--input`、`--output`、`--logo` など)の相対パスは、`pfpdf` を実行したカレントディレクトリが基準です。

Markdown、raw HTML、CSS に静的に書いた local URL は resource graph を通じて解決されます。script が実行時に文字列から作る local path は自動公開されないため、resource は静的な `src` / `href` / CSS `url()` として宣言するか、HTTP(S) URL を使ってください。

文書内の URL separator は OS にかかわらず `/` です。Windows の absolute path は `file:///C:/docs/image.png`、UNC path は妥当な `file://server/share/...` URL で書きます。CLI 引数の path だけは実行 OS の通常の path 表記を使えます。
