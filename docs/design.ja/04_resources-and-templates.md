# 4. resource、font、template

## 4.1 標準フォント

標準フォントには Noto Sans JP、Noto Serif JP など、再配布可能でウェイトを持つ日本語フォントを採用します。npm package 内の同じ font file を参照し、OS のインストール状態に依存させません。

- 本文、見出し、コード用フォントを明示する
- CSS の先頭に OS 固有フォントを置かない
- ホストフォント機能は既定で無効にし、通常実行ではホスト OS の font directory を探索しない
- 標準フォントを使う代表文書について、PDF が生成でき、日本語を含む本文を `pdftotext` で抽出できる最小限のスモークテストを用意する
- font の subset 化や format 変換を行う場合は、元 license が改変と Reserved Font Name を許すか確認し、生成手順を再現可能にする

## 4.2 host font の opt-in

- `--host-fonts` で OS 標準の font directory を探索し、`--font-dir PATH` の繰り返し指定で探索先を追加できるようにする
- `--font-dir` 自体もその directory に限った明示的な opt-in とみなし、`--host-fonts` なしで利用可能にする
- macOS では `~/Library/Fonts`、`/Library/Fonts`、`/System/Library/Fonts`、`/System/Library/Fonts/Supplemental` を標準探索候補とする
- renderer は許可された font file を loopback `AssetServer` から配信する
- 利用者が指定した host font file を package、workspace、cache へ複製しない。生成するのは一時的な font index、`@font-face` CSS、Linux 用 fontconfig metadata だけとする
- OpenType `OS/2.fsType` などから PDF への埋め込みが禁止されていると判定できる font は候補から除外する。静的 CSS がその family / face を要求して fallback できない利用者指定 font なら終了 code `2`、bundled font なら package の不整合として `1` とする。未使用候補または制限の有無を判定できない format は warning とし、許諾を推測しない
- `--font-dir` で発見した候補だけでなく、template / Markdown / raw HTML / CSS の静的 URL から font role として発見したすべての local / `data:` font に同じ embedding 検査を適用する。remote font の license / 内容は取得保証と同様に検査できないため利用者責任とし、再現可能な標準文書では使わない
- ホストフォントを直接参照できることと、そのフォントを PDF へ埋め込めることは別問題であり、各フォントのライセンス条件は利用者が確認する必要がある
- ホストフォントを使った出力は OS と font の更新に依存し、canonical build と同じ見た目を保証しない

## 4.3 `FontResolver`

- bundled font を常に利用可能にし、ホストフォントが無効なら OS の font discovery を行わない
- `--host-fonts` と明示された `--font-dir` から、利用を許可された directory の集合を作る
- 探索順位は、CLIの`--font-dir`で指定した追加font directory list、`--host-fonts`が追加するOS標準directoryの固定順、bundled fallbackの順とする
- OpenType の name table から family、weight、style、stretch を読み、採用した各 face を logical font URL で参照する一時的な `@font-face` CSS を生成する。`--font-dir` は font を自動的に本文へ選択する option ではなく、template / document CSS が family 名で選べる候補を追加する
- renderer の実行環境から参照可能な font URL を使う CSS を生成し、必要な場合だけ renderer 内部向けの fontconfig metadata を渡す
- bundled template の静的 CSS が要求する non-generic family を抽出し、見つかった face だけを有効にする。見つからない family は source location 付き warning とし、bundled fallback が font-family list の末尾にあることを template test で保証する。custom / raw CSS の dynamic property まで選択 font を保証しない
- TTF、OTF、TTC、WOFF2 など Chromium で検証済みの format だけを対象にする。TTC の face index、variable font axis、weight / style mapping を fixture で確認し、未対応 format や face は `--doctor` で理由を表示する
- directory は決定的な file 名順で再帰探索するが、symlink directory はたどらない。symlink file は解決先が regular file の場合だけ候補にし、canonical path で重複を除く
- 同じ family / weight / style / stretch に複数候補がある場合は探索順位が先の file を採用し、競合を warning にする。filesystem の列挙順や「最後に見つかった file」へ依存させない
- OpenType の table directory、offset、length、collection face count を file size と照合し、整数 overflow と範囲外 read を入力エラーとして扱う。1 face 当たりの table と 1 collection 当たりの face はそれぞれ 4096 を上限とし、通常の font として不合理な header で CPU / memory を消費しない
- family 名と logical font URL は CSS string / URL token として escape し、font metadata を CSS source へそのまま連結しない
- font file の copy は行わず、終了時に一時 CSS、index、fontconfig metadata を削除する
- font family、実際に選択された file、埋め込み制限の検査結果を debug log と `--doctor` で確認可能にする
- Chromium 自体は OS font へアクセス可能なため、既定値で保証するのは pfpdf が host directory を探索せず、bundled template が host family を要求しないことまでとする。再現性が必要な文書では custom / raw CSS から OS 固有の family を要求しない
- custom / raw CSS の `local()` source は browser 自身の discovery を経由して実 file と embedding flag を事前特定できないため、利用時に warning を出す。bundled template では `local()` を禁止し、検査済み logical font URL と generic fallback だけを使う

## 4.4 template とロゴの分離

`v0.1.0` には研究報告向けの抑制した `academic`、長文向けの落ち着いた `book`、短い会議資料や社内メモ向けの省スペースな `compact`、中立な `default`、温かくカジュアルな小冊子向けデザインの `notebook`、企業文書向けデザインの `pfn`、コードと表を重視した高密度な技術文書向けデザインの `technical` を bundled template として含めます。bundled template 自体にはライセンス未確認のロゴを含めず、`pfn` を含む全 template がロゴなしで動作します。

```text
resources/templates/
  academic/
    template.html
    style.css
    vivliostyle.css
  book/
    template.html
    style.css
    vivliostyle.css
  compact/
    template.html
    style.css
    vivliostyle.css
  default/
    template.html
    style.css
    vivliostyle.css
  notebook/
    template.html
    style.css
    vivliostyle.css
  pfn/
    template.html
    style.css
    vivliostyle.css
  technical/
    template.html
    style.css
    vivliostyle.css
```

- 先頭 Markdown の front matter `template`、または bundled 名と完全一致する `--template SOURCE` で bundled template を選択する。`--template-preset NAME` は bundled preset であることを明示する。CLIはfront matterより優先する
- custom / repository template は `logo` slot の `src` に template 相対 path を持つ既定ロゴを宣言できる。bundled template は既定ロゴを持たない
- front matterの`logo`はlocal pathまたは`false`を受け付ける。CLIの`--logo SOURCE`はlocal pathまたはGit locatorでfront matterとtemplate既定ロゴを上書きし、`--no-logo`は両方を無効化する
- logo が明示指定されず slot に `src` もなければ logo placeholder 自体を出力しない。壊れた image placeholder を残さない
- front matter logoの相対pathは先頭Markdownの親directory、CLI logoの相対pathはカレントディレクトリを基準に解決する
- logo と template は trusted input とし、存在して読み取れることだけを事前検査する。内容を sandbox 化しない

## 4.5 custom template

- `--template SOURCE` が bundled preset 名と完全一致しない通常文字列なら、custom template directory path として扱う。同名directoryを選ぶ場合は`./default`のようにpathであることが分かる表記を使う
- custom template の path は front matter では受け付けず、CLIからだけ指定する
- custom template は信頼できるローカルコードと同様に扱い、raw HTML や script を実行し得ることを明記する
- custom template format に `apiVersion`、JSON Schema、version 間の互換性保証は設けない。template の見た目と構造を維持したい利用者は pfpdf の version を固定する。ただし、同じ pfpdf version 内で曖昧な文字列置換を避けるため、次の DOM slot contract は明確に定義する
- custom template directory は `template.html`、`style.css`、`vivliostyle.css` を直接持ち、選択した pfpdf version が必要とする file の存在だけを検査する

### 4.5.1 Git repository source

- `--template 'git::URL//PATH?ref=REVISION'` で Git repository 内の custom template directoryを指定できる。`--logo`も同じ形式で通常 file を指定する
- `PATH` は repository root からの `/` 区切り相対 path とし、サブディレクトリを許可するが、absolute path、空 component、`.`、`..`、backslash は code `2` とする。template は directory、logo は通常 file でなければならない
- 対応 URL scheme は `https://`、`ssh://`、`file://` とする。`file://` は local / test 用である。password、および HTTPS URL の userinfo は credential 漏洩を避けるため拒否し、private repository は Git credential helper または SSH agent で認証する
- `ref` は branch、tag、commit を受け付ける。省略時は remote `HEAD` を使うが、解決 commit を warning に出す。再現可能な CI では完全な commit hash を指定する
- repository source は OS の一時 directory に depth 1、detached HEAD、submodule 無効で checkout し、同一 process 内の同じ URL / ref は共有する。persistent cache は持たず、`--keep-work-dir` の対象となる build workspace と一緒に回収する
- locator の構文 / path / file type error は code `2`、Git 起動、network、認証、fetch / checkout failure と timeout は code `1` とする。conversion の timeout は 300 秒、doctor の外部 process check は 10 秒とする。Git child process は shell を介さず argument array で起動し、interactive prompt を無効化する
- repository template も trusted code として扱う。front matter から repository source を指定できず、CLIによる明示選択だけが network access と template script の実行を発生させる

### 4.5.2 DOM slot contract

`template.html` は完全な HTML document とし、`data-pfpdf-slot` attribute で挿入位置を宣言します。

| slot | 個数 | 挿入内容 |
|---|---:|---|
| `content` | 必須、1 個 | source file ごとの section を含む本文 |
| `title` | 任意、0 または 1 個 | title。許可済みの `<br>` だけを element として保持 |
| `author` | 任意、0 または 1 個 | author の text |
| `series` | 任意、0 または 1 個 | series の text |
| `date` | 任意、0 または 1 個 | date の text |
| `confidential` | 任意、0 または 1 個 | `confidential: true` の場合だけ表示 |
| `toc` | 任意、0 または 1 個 | 目次。slot がなければ content の先頭へ挿入 |
| `logo` | 任意、0 または 1 個 | `img` の `src` / `alt` を設定 |

- HTML5 parser で DOM を組み立て、`html` / `head` / `body` と `content` slot の存在、同じ slot の重複、未知 slot を検査する。doctype、ID、slot 外の attribute、trusted HTML の妥当性を重複して検査しない
- builder は root `html` の `lang` / `dir` を metadata の canonical language tag / direction へ設定する。template 側の固定値や host locale を優先しない
- builder は inert な DOM として template を parse し、slot element の child node を DOM API で置換する。metadata を template source へ文字列補間しない
- 目次には文書言語に応じた見出しと継続ラベルを builder が挿入する。継続ラベルは `.pfpdf-toc-continuation-marker` の named string として提供し、template は paged media の margin box で装飾する。目次直後の空 marker が named string を解除するため、本文ページには継続ラベルを残さない。この styling hook は新しい DOM slot を追加せず、`toc` slot の contract を変更しない
- `logo` slot は `img` element に指定する。slot 自身の `src` は template の既定ロゴであり、template directory 相対の通常 resource として解決する。明示 logo は logical `src` で上書きし、class など他の attribute は保持する。template に `alt` がなければ decorative image として `alt=""` を設定する
- 明示 logo が指定されたのに `logo` slot がない場合は、利用者の指定を黙って捨てず終了 code `2` とする。既定 `src` も明示 logo もない場合、または `--no-logo` の場合は slot element 自体を削除する
- `author` または `series` が未指定なら対応する slot element 自体を削除する。title は必須、date は明示値または生成値を常に持つため、それらの slot が存在すれば必ず内容を設定する
- bundled template はすべて `series` slot を持ち、固定の出版名、文書種別、ブランド名、目次名、metadata 接頭辞、callout 名、図表番号を追加しない。series を柱にも表示する場合は同じ slot を重複させず named string を使う
- `confidential: false` のときは `confidential` slot element 自体を削除する。true の場合だけ template に残し、表示 text は builder が設定する。bundled template は表紙または先頭 header と、目次・本文を含む以後の全 page に template 固有の表現で表示する
- `--no-toc` の場合は `toc` slot を削除し、content へも挿入しない
- script は最終 `document.html` が browser に load されるまで実行しない。template script の非同期処理は readiness contract へ登録する
- `style.css` は共通 style、`vivliostyle.css` は paged media style としてこの順で読み込む。両方を resource graph に通し、`@import` と `url()` を解決する

## 4.6 `TemplateResolver` と `HtmlDocumentBuilder`

- `TemplateResolver` は bundled template 名または custom template directory を解決し、現在の pfpdf version が必要とする file の型、読取り可否、DOM slot contract を検証する
- テンプレートと CSS は npm package resource として配置する
- logo path は template から分離し、指定された場合だけ workspace から参照可能な URL へ変換する
- package / input asset は `ResourceResolver` の logical URL で参照する。単一 HTML 用の data URL materialize 処理や renderer ごとの HTML builder は持たない
- MathJax と highlight.js は package 内の module を使う build-time transform とし、生成 HTML から browser script として参照しない
- `HtmlDocumentBuilder` が生成した `document.html` を `AssetServer` が byte 変更なしで配信し、Vivliostyle CLI にその URL を渡す。integration test も同じ builder 出力と配信 byte 列を検査する
- metadata は slot ごとの node / text context に合った型検証を通し、単純な文字列置換へ未検証値を渡さない。metadata を CSS や attribute 名へ挿入する slot は提供しない
- browser 内の readiness coordinator は font、local image、利用者が登録した promise、resource load error を集約し、timeout や JavaScript error を renderer へ伝える

## 4.7 bundled asset の version 管理

- bundled MathJax は保守されている現行 major(3 系以降)を採用し、`$` / `$$` の delimiter と `processEscapes` 相当の設定を有効にする
- bundled highlight.js は 11 系を採用し、言語 alias の正規化と使用言語だけの asset 読み込みを行う。未知の言語名は code を失わず plain text として出力し、source location 付き warning にする
- MathJax、highlight.js、フォントの version、license、入手元は `THIRD_PARTY_LICENSES.md` に一覧化する
- CLI 起動時の resource path は `process.cwd()` や npm cache layout に依存せず、ES module の package location から解決する

## 4.8 bibliography input と style

front matter が指す `.bib` は build 時に全 byte を読み終える input であり、画像・CSS・font のように browser が取得する resource graphへ登録しません。したがって AssetServer の logical URL や readiness fetch を必要としません。relative path は front matter source の親 directory、absolute path と `..` は trusted-input 方針の範囲で許可しますが、tutorial では移植可能な相対配置を推奨します。

Citation.js、citeproc-js、使用する CSL style / locale は lockfile と公開 shrinkwrap に固定し、license と入手元を `THIRD_PARTY_LICENSES.md` に記録します。CSL が返す HTML は document wrapper として挿入せず HAST fragment に parseし、pfpdf が安定した class、ID、ARIA role、backlink を付けます。全 bundled template は `common.css` / `common-vivliostyle.css` の構造 rule を共有し、文献本文の意味や固定 label を template 固有 CSS から追加しません。
