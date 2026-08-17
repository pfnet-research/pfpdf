# 3. Markdown 処理と GFM

## 3.1 基準は GFM

pfpdf の Markdown 基準は [GitHub Flavored Markdown Spec 0.29-gfm](https://github.github.com/gfm/)です。独自 parser は実装せず、保守されている CommonMark / GFM 対応の JavaScript / TypeScript library を source lockfile と公開用 shrinkwrap で固定して利用します。spec version の変更は単なる dependency update とせず、全 conformance example と expected deviation を review する仕様変更として扱います。

少なくとも次を GFM / CommonMark の規則どおり処理します。

- ATX / setext 見出し、paragraph、soft / hard line break、thematic break
- unordered / ordered / nested list、loose / tight list、task list
- blockquote、indented / fenced code block、inline code
- inline / reference link、image、autolink、backslash escape、HTML entity
- `*emphasis*`、`**strong emphasis**`、`~~strikethrough~~` と妥当な入れ子
- table と alignment
- inline / block raw HTML

## 3.2 parser pipeline

GFM に対する pfpdf extension は parser pipeline 上で分離します。

1. UTF-8 と front matter を検証し、入力 file の順序を確定する
2. 各 Markdown file を独立した document とし、GFM、CJK-friendly delimiter、数式、pfpdf directive の tokenizer extension を同じ parse に組み込んで AST を生成する。code / raw HTML を最優先で保護し、その外側では数式 / directive が内部 token を確保してから emphasis / strong を処理する
3. 各 file AST の先頭へ file anchor を付け、AST の配列として 1 文書へ結合する
4. 見出し ID、目次、file 間 link、resource URL を AST / HTML / CSS parser 上で処理する
5. context-aware escape と DOM API を使って HTML を生成する

Markdown source の文字列を separator だけで連結してから parse してはいけません。その方法では、未閉鎖の code fence / HTML block、list、setext heading、link reference definition が次の file へ漏れ、file 単体と異なる構文木になるためです。各 file を独立 parse するため、link reference definition と footnote 相当の extension scope も file 内に限定します。file 境界自体は空 paragraph を生成せず、block が隣接しても互いの構文を変えません。

表の描画では、4 grapheme以下の非空セルに `.pfpdf-table-cell-compact`、それより長いセルに `.pfpdf-table-cell-min-4` を付けます。短い状態語などを一行に保ちながら、長文セルは折り返せるようにするためです。8列以上の表には `.pfpdf-table-many-columns` を付け、templateが列の意味や位置を推測せず、表全体の文字サイズと余白を調整できるようにします。

## 3.3 pfpdf extension

### 3.3.1 数式

`$...$`(inline)と `$$...$$`(display)の数式は pfpdf extension とします。bundled MathJax で typeset します。

- inline delimiter は backslash escape されていない単一 `$` とし、開始直後と終了直前を whitespace にしない。改行をまたがず、対応する終了 delimiter がない `$` は text のままにする
- display delimiter は block の先頭から末尾までを占める単独行 `$$` の組だけとし、開始と終了の delimiter 行の間を TeX source とする
- 対応する終了 delimiter がない `$$` は開始扱いせず GFM の text のままにする。delimiter と式を同じ行に置く記法も display math にしない
- code、raw HTML、autolink、link destination 内では数式 delimiter を認識しない。`\$` は literal `$` とする
- GFM parser と同じ tokenizer の構文 extension として認識し、code / raw HTML の context を文字列から再推測しない。token 化は入力長に対して線形時間で行い、開始 delimiter ごとに残り全文を探索する実装や、catastrophic backtracking を起こし得る正規表現を使わない

MathJax が source 数式の TeX error を報告した場合は、赤い error 表示を含む PDF を成功させず、元の source file / line を付けた code `2` にします。bundled MathJax 自体の load / initialization failure は配布物または runtime の問題として code `1` にします。

### 3.3.2 改ページ

block container の外側で、indent なしの行全体が ASCII underscore 3 個だけである `___` は、GFM では thematic break ですが pfpdf では改ページとして予約します。前後の空白、4 個以上の underscore、blockquote / list item 内の `___` は予約記法に含めず GFM として処理します。通常の thematic break には `---` または `***` を利用できます。この差分は GFM conformance suite 上の明示的な expected deviation として記録します。

directive は「次の描画対象 block を新しい page の先頭から始める」という意味に正規化し、次の block に予約済み `data-pfpdf-page-break` attribute を付けて paged CSS の `break-before: page` で実装します。文書先頭 / 末尾の directive と連続する directive は空白 page を作らず、1 個の break へ畳みます。空白 page 自体を挿入する機能は `v0.1.0` では提供しません。

### 3.3.3 見出し anchor と目次

各 source file の先頭に `pfpdf-file-0001` 形式の連番 anchor を割り当てます。template と raw HTML の明示 ID は生成する見出し ID の衝突回避に利用しますが、trusted HTML の ID 自体の形式・重複は検査しません。見出し ID は次の手順により一意化します。

1. AST から見出しの plain text を得る。code span は内容、image は alt text を使い、raw HTML tag 自体は除く
2. release で固定した Unicode data により NFC に正規化し、locale に依存しない default lowercase へ変換する。host ICU や locale によって slug を変えない
3. control character と、`_` / `-` を除く ASCII punctuation を除き、whitespace の連続を `-` 1 個へ変換して両端の `-` を除く。Unicode の文字・数字・結合文字は保持する
4. 空になった場合は `section` とする
5. 既使用 ID と衝突する場合は `-2`、`-3` の順に、未使用になるまで suffix を増やす。元から suffix を持つ見出しとの衝突も同じ global set で確認する。base ごとの次 suffix cursor を保存し、重複のたびに `-2` から走査し直さない

目次には Markdown AST の heading node(`h1` から `h6`)を source 順にすべて含め、raw HTML / template 自身の見出しと表紙の metadata title は含めません。raw HTML の見出しへ自動 ID は付けず、link target にする場合は明示 `id` を指定します。同一文書へ結合される `chapter.md` への link は file anchor へ変換します。`chapter.md#fragment` は対象 file 内、`#fragment` は link を書いた source file 内で、percent encoding を 1 回 decode した fragment と最終的な明示 / 見出し ID を Unicode code point 単位で完全一致させます。基本 slug から suffix を推測し直さず、重複見出しの 2 個目へは実際の `-2` 付き ID を使います。相対 Markdown link の query component は意味を定義せず終了 code `2` とします。存在しない target も code `2` とし、case-insensitive な推測や basename だけの曖昧な照合は行いません。

### 3.3.4 日本語 strong emphasis(CJK-friendly)

CommonMark の flanking delimiter rule には、`**` の内側が全角約物・括弧で、外側に空白を置かない CJK 文字が続くと strong emphasis として認識されない問題があります。pfpdf は日本語文書で自然な記法を使えることを優先し、少なくとも次を `<strong>` へ変換します。

```md
これは**重要**です。
これは**「強調表示」**の例です。
これは**重要な点。**続きのテキスト
ここは**（重要事項）**です。
```

- 選定 parser に対応する保守済みの CJK-friendly delimiter extension を version 固定して利用する。remark / micromark 系なら `remark-cjk-friendly` などを第一候補とし、GFM strikethrough との組合せも確認する
- parser の標準機能または既存 extension で満たせない場合だけ同等の delimiter rule を最小実装する
- parse 後の正規表現や HTML 置換では補正しない
- code span、fenced code、raw HTML、link destination、数式、escape 済み `\**`、対応しない片側だけの `**` は書き換えない
- 日本語句読点、全角括弧、ASCII / CJK の隣接、nested emphasis、3 個以上の `*` を fixture 化し、CommonMark / GFM からの意図的な差分として記録する
- delimiter 処理は token 数に対して線形時間となる実装を選び、長い `*` の列や閉じ delimiter のない入力で二次時間にならないことを stress test する

背景資料:

- [CommonMark issue: Emphasis with CJK punctuation](https://github.com/commonmark/commonmark-spec/issues/650)
- [markdown-cjk-friendly](https://github.com/tats-u/markdown-cjk-friendly)

### 3.3.5 長い連続文字列の改行候補

Markdown と raw HTML を HAST に変換し、見出し ID・目次・resource URL を確定し、数式と code highlight を描画した後、通常の可視 text node に `<wbr>` を挿入します。これは Markdown 構文ではなく出力 decoration です。入力、link destination、`href`、`src`、`id`、class、style、その他の property は変更しません。

空白や既存の改行候補を含まない run は `Intl.Segmenter` の grapheme cluster 単位で数えます。15 grapheme以下は変更せず、16 grapheme以上は少なくとも1個の候補を持ち、各区間を原則16 grapheme以下にします。URL / path の `/`、`?`、`&`、`#`、`;`、`=`、host・file・識別子の `.`, `@`, `:`, `-`, `_` など、camelCaseや文字・数字の遷移、固定長 fallback の順に優先します。`://`、percent encoding の `%HH`、IPv6 の `::`、結合文字、variation selector、emoji ZWJ sequenceの途中では分割しません。候補数、priority、短い端片、区間長の偏り、source位置の順に決定的に評価します。

inline element の境界では run を継続するため、link、`strong`、`em` をまたぐ表示文字列にも対応します。block、`br`、既存の `wbr`、zero-width space、soft hyphen、通常の CJK 組版で文字間改行できる文字では run を終了します。既存の `wbr` を尊重し、同じ transform を二度実行しても候補は増えません。

`pre`、`code`、`kbd`、`samp`、`script`、`style`、`textarea`、`svg`、`math`、`.pfpdf-math-src`、`.pfpdf-math-inline`、`.pfpdf-math-display`、`contenteditable` subtree、replaced elementは対象外です。codeと数式のDOM、実行内容、form value、accessible text、利用者が管理するDOMを完全に保持します。処理は source section にだけ適用し、template 固定UIには適用しません。run長を `n` として bounded dynamic programming は時間 `O(n * 16)`、memory `O(n)` です。

### 3.3.6 Mermaid

info string が小文字の `mermaid` である fenced code block は pfpdf extension として図へ変換します。package に固定した Mermaid と server-side DOM adapter を使い、Markdown pipeline 内で静的 SVG を生成します。SVG は `generated/mermaid-NNNN.svg` として build workspace に置き、`.pfpdf-mermaid` container 内の `img` から参照します。CDN、host にインストールされた Mermaid、追加の headless browser process は使用しません。

Mermaid は `startOnLoad: false`、`securityLevel: strict`、HTML label 無効、error rendering 抑止を固定します。図ごとに決定的な ID を割り当て、SVG を HAST として parse し、通常の resource URL 書換えを完了してから外部 SVG として serialize します。inline SVG にしないのは、Vivliostyle の pagination 用 DOM では SVG marker の fragment 参照が失われ、矢印だけが消えるためです。外部 SVG は同じ renderer と browser で marker を保持し、raster image へ変換しないため vector と SVG 内 text を維持します。

server-side DOMではflowchartのedge label textと背景rectに異なるbaselineが使われ、背景だけが文字の上へ分離します。これは日本語に限らず英語labelでも発生します。fontや文字数に依存する固定座標補正、複数行を壊し得る`tspan`補正、外部SVGでの可搬性が低いHTML labelへの切替は行いません。edge labelは未対応とし、`-->|label|`などのlabel付きedgeを使用しないでください。

Mermaid source の構文・描画 error は source file / line 付き code `2`、同梱 runtime の load / initialization failure は code `1` とします。いずれも未描画 code や error diagram を PDF へ残しません。

### 3.3.7 BibTeX citation

参考文献引用は pfpdf extension として `\cite{key}`、複数 key の `\cite{key1,key2}` を認識します。TeX で文献を引用する command は `\cite` であり、`\ref` は一般の label 参照なので、後者は将来の図表・数式・節参照用に予約します。CommonMark は英字の前の backslash を保持するため、`\c` 自体を Markdown escape として失いません。

- citation key は ASCII letter / digit から始まり、以降は letter / digit と `_:.#$%&+?<>~/-` を許可する。comma は cluster の区切りなので key には含めない
- key 前後の ASCII whitespace は除き、空 key、同一 cluster 内の重複、brace の不足や入れ子を file / line 付き code `2` とする
- `\\cite{key}` は literal `\cite{key}` とする。inline / fenced / indented code、raw HTML、数式内では citation syntax を認識しない
- link と heading 内の citation は、nested anchor と style 依存の slug を避けるため初期版では code `2` とする
- source file ごとに独立 parse した後、全 file の cluster を文書順に集め、一つの citeproc session で番号と bibliography 順を決める
- citation は `role="doc-biblioref"` の内部 link、entry は一意な encoded ID と全引用位置への `role="doc-backlink"` を持つ。BibTeX key を検証せず生の HTML ID にしない

参考文献一覧の明示位置は top-level の独立行 `\printbibliography` とします。文書全体で 0 または 1 個とし、省略時は最終 source section の末尾へ追加します。見出しは自動生成せず、目次へ載せる場合は通常の Markdown heading を marker の直前に書きます。引用がない marker、2 個以上の marker、bibliography 未指定の citation は code `2` です。

初期版の書式は version 固定した numeric CSL style 1 種です。CSL processor の bibliography 順を番号の正本とし、entry 本文を独自 formatter で再構築しません。custom CSL、locator、prenote、author-only、year-only、`\nocite`、Pandoc の `[@key]` は初期 scope 外です。

## 3.4 raw HTML の扱い

raw HTML は表現の自由度を保つため inline / block とも passthrough します。GFM の構文解析は採用しますが、GitHub.com が変換後に行う sanitization と GFM の「Disallowed Raw HTML」tag filter は適用しません。`table`、`div`、`section`、`figure`、`style`、必要な `script` などを扱えます。入力を trusted code とみなし、local file access を sandbox 化しません(08 章参照)。

ただし URL 書き換えと template 組立てのため、raw HTML は HTML parser で fragment として読み、serialize し直します。tag や attribute を allowlist で削除する処理ではありませんが、quote、attribute 順、tag の閉じ方など byte 表現は入力と一致しない場合があります。source file をまたぐ HTML block は構築できません。static URL は 02 章の resource graph へ登録し、script が後から生成する local URL は保証対象外です。

`<base>`、`meta[http-equiv=refresh]`、独自の `data-pfpdf-*` attribute も trusted HTML として保持します。これらは resource 解決や描画対象を変え得るため、使用した結果は利用者の責任です。

利用者 script の同期 error と readiness 前の unhandled rejection は変換失敗です。pagination に影響する非同期処理は `window.pfpdf.registerReady(promise)` へ登録します。登録されない timer、event、worker の完了を自動推測しません。

## 3.5 GFM と GitHub.com 固有機能の区別

footnote、alert、mention、issue reference、emoji shortcode、Mermaid など GitHub.com の追加機能は、正式な GFM Spec の範囲か、repository context を必要とする post-processing かを区別します。

- 正式 GFM の機能(table、task list、strikethrough、autolink など)は `v0.1.0` 必須とする
- repository context を必要とする mention / issue reference と、alert / emoji shortcode / Mermaid など spec 外の表記は個別 extension として扱い、この章の対応表で管理する。`v0.1.0` では Mermaid の fenced code block に対応し、その他は未対応
- raw HTML で代替できることを理由に GFM 構文自体を省略しない
- 対応していない GitHub.com 固有機能を「GFM 非対応」とは表現しない

## 3.6 conformance の検査方法

GFM Spec の example は、template wrapper、見出し ID、目次、resource URL 書き換えなど pfpdf 固有の後処理を加える前の `GfmAdapter` に対して実行します。これにより pfpdf の付加属性を GFM 違反と誤判定せず、parser 自体の conformance を検査できます。

- runtime と同じ raw HTML 設定で比較し、Disallowed Raw HTML tag filter の例だけを理由付きの expected deviation とする
- `___`、数式、日本語 strong は adapter 単体から除き、それぞれの extension を含む full-pipeline test で固定する
- spec version、対応表、pfpdf extension、expected deviation はこの章にまとめ、parser library または spec fixture の更新時に差分を review する
- conformance fixture は upstream の example number、input、expected HTML、license、spec checksum を repository に固定し、network から test 時に取得しない

### expected deviation 一覧

| 項目 | GFM の挙動 | pfpdf の挙動 | 理由 |
|---|---|---|---|
| Disallowed Raw HTML tag filter | `<script>` などを filter する | filter せず保持する | trusted document 向けに表現の自由度を優先 |
| 単独行の `___` | thematic break | 改ページ | pfpdf directive として予約。`---` / `***` で代替可能 |
| CJK 隣接の `**...**` | strong にならない場合がある | `<strong>` へ変換する | 日本語文書での自然な記法を優先 |
| `$...$` / `$$...$$` | plain text | 数式として typeset する | pfpdf extension |
| `mermaid` fenced code block | code block | 静的 SVG の図へ変換する | pfpdf extension |
| `\cite{key}` / `\printbibliography` | plain text | 引用 link / 参考文献一覧 | pfpdf extension |
| `<base>` | raw HTML として保持する | 入力エラー | logical resource URL と内部 link の基準を固定するため |
| `meta[http-equiv=refresh]` | raw HTML として保持する | 入力エラー | 描画中の document navigation を禁止するため |
