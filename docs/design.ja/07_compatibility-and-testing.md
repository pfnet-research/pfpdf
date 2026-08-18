# 7. 互換性とテスト

## 7.1 固定している dependency と検証済み OS

release ごとの完全な互換性表は作らず、現在固定している dependency version と検証済み OS だけをこの章に記録します。正確な package version と integrity は source / CI では `package-lock.json`、公開 tarball では同じ tree から生成した `npm-shrinkwrap.json`、利用者向けの対応範囲はこの章を正とします。これらが不一致なら release を禁止します。

この文書の段階では実装用 lockfile と 4 環境の実測結果がまだ存在しないため、下表は固定方法だけを示しています。release candidate では各行に exact version / browser revision / OS image version / 検証日を記入し、「現行」「最新版」「11 系」のような範囲だけで compatibility claim を行わないことを release blocker とします。

| 項目 | 固定方法 | 備考 |
|---|---|---|
| Vivliostyle CLI | exact direct spec + source lockfile + 公開 shrinkwrap | AGPL-3.0。更新は各対象 OS のサンプル PDF スモークテスト後に行う |
| browser build | pinned Vivliostyle CLI の標準機構(`@puppeteer/browsers`) | pfpdf は独自 downloader を持たない |
| GFM parser | source lockfile + 公開 shrinkwrap | pinned GFM Spec の conformance example で検証する |
| CJK-friendly extension | source lockfile + 公開 shrinkwrap | GFM strikethrough との組合せを確認する |
| PDF parser / rewriter | source lockfile + 公開 shrinkwrap | xref / page tree 検査と metadata 更新を全対象 OS で確認する |
| MathJax / highlight.js | package 同梱の固定 version | CDN から取得しない |
| 標準フォント | package 同梱 | 再配布可能な日本語フォント |
| Node.js 対応 semver range | `package.json` の `engines` + 起動時検査 | pinned direct dependency の要件の共通部分に合わせる |

検証済み OS は次の 4 環境で、いずれも CI で実 browser による PDF 生成まで確認します。

- macOS aarch64(主要サポート)
- Linux x86_64(主要サポート)
- Windows x86_64(追加サポート)
- Linux aarch64(追加サポート)

architecture は実際にその architecture の browser binary を起動して検証し、x86_64 emulation の成功だけで arm64 対応としません。OS image や hosted runner label が更新された場合は、同じ名前でも runtime が変わり得るため検証日と image version を更新します。

## 7.2 Linux の runtime 前提

Linux では browser archive だけでは shared library が揃いません。

- 対応 distribution は GitHub-hosted Ubuntu と現行 Debian stable を最初の検証対象とし、必要 shared library package を versioned documentation として維持する
- `--doctor` で不足 library を可能な範囲で報告し、root 権限で暗黙 install はしない
- shared library が揃っていても、Ubuntu 23.10 以降の unprivileged user namespace 制限のように Chromium sandbox を起動できない環境がある。sandbox 起因の失敗を library 不足と区別して診断し、AppArmor profile 追加など root 作業を伴う回避手順は tutorial の troubleshooting 章に記載する

## 7.3 unit test

- pfpdf 固有の後処理前の `GfmAdapter` が、Disallowed Raw HTML tag filter の expected deviation を除く pinned GFM Spec の conformance example を通ること
- heading、list / nested list / task list、blockquote、code、link / image / autolink、emphasis / strong、strikethrough、table、raw HTML など GFM の構文ごとの変換
- `これは**重要**です`、`これは**「強調表示」**の例です`、`これは**重要な点。**続き`、全角括弧、ASCII / CJK 混在、nested emphasis、3 個以上の `*` を含む CJK-friendly strong の正常系
- code span / fence、raw HTML、link destination、数式、escape 済み `\**`、片側だけの `**` を CJK-friendly extension が書き換えないこと
- CJK-friendly extension 適用後も pinned CommonMark / GFM の既存 fixture に意図しない差がないこと
- inline / block raw HTML と `style` / `script`、document 制御要素、独自 attribute が trusted input として保持されること
- 単独行の `___` は改ページになること、GFM の thematic break には `---` / `***` が使えること
- front matter の正常系・異常系、複数 metadata の拒否、title 内の許可された改行、seriesの任意表示、正の page size、BCP 47 language tag と既定 `ja`、`dir` の `ltr` / `rtl` / `auto` と既定 `auto`、primary language ごとの固定 date 表示の検証
- YAML mapping と利用 metadata field の型検査
- UTF-8 BOM / CRLF、不正 UTF-8、locale 非依存 filename sort
- stdin / stdout を表す `-` input / output の拒否
- 各 Markdown file を独立 parse し、未閉鎖 fence、HTML block、list、setext heading、reference definition が次の file へ漏れないこと
- heading slug の Unicode、記号だけの見出し、`x` / `x-2` の衝突、raw HTML heading を自動 ToC の対象にしないこと、重複 heading の一意な anchor、同一文書に含まれる Markdown file link の書換え
- inline / display math の delimiter 境界、内部の `*` / `_`、currency、escape、未閉鎖 delimiter、長い `$` 列が線形時間で終了すること
- MathJax の利用者 TeX error を source location 付き code `2`、bundled initialization failure を code `1` に分類すること
- `___` の indent、blockquote / list 内、4 個以上、前後空白、文書先頭 / 末尾 / 連続を含む境界条件と、次の block への `break-before` 正規化
- CLI の終了 code `0` / `1` / `2` と stdout / stderr の分離
- 改行、ESC、C0 / C1、bidi formatting character を含む path / URL の診断 escape と、不正 UTF-8 filename の raw byte 表示
- Node.js runtime の対応 / 非対応 semver range 境界に対する起動時検査
- 正常終了、通常エラー、捕捉可能な中断での workspace cleanup
- CLI、environment、default の優先順位と、CLI が常に勝つこと
- 環境変数の boolean、enum、数値、path list の厳密な parse
- 排他的 flag の同時指定、`--font-dir` 以外の option 重複、unknown option / positional argument / value 欠落、template selector と logo / font directory / managed browser / workspace 保持の明示 reset が環境変数の論理設定全体を上書きすること、path list の空 / 重複 component、timeout の最小・最大・overflow
- bundled / custom template の必要 file と logo 省略時の出力
- custom template の必須 / 重複 / 未知 DOM slot、metadata の text 挿入、未指定 author / series slot の削除、title の許可 tag 以外の拒否、logo 指定と slot 欠落の拒否
- trusted attribute を保持し、処理した `data-pfpdf-slot` が残らず、`window.pfpdf` の runtime 上書きを code `1` にすること
- host font が既定で無効であることと font directory の opt-in
- font scan の決定的な優先順位、symlink cycle、壊れた OpenType offset / length、table / face の 4096 境界、duplicate face、CSS escape、`--font-dir` と direct CSS URL / `data:` font の埋め込み禁止 flag、custom CSS `local()` warning、bundled CSS の `local()` 禁止
- child process の argv / environment 上限、可変長 Unicode path / proxy / custom CA、user / bundled 原因ごとの code `2` / `1` 分類
- `SOURCE_DATE_EPOCH` と PDF Info / XMP title・author・language・timestamp policy、catalog `/Lang`、および front matter の `date` があっても epoch 未設定なら再現性 warning を出すこと
- `SOURCE_DATE_EPOCH` の負数、符号、空白、指数、safe integer / Date 範囲超過を拒否すること
- PDF header / EOF marker、xref / object offset / incremental update / catalog / page tree、暗号化 / 0 page、symlink / directory output、truncated PDF を commit しないこと
- `bibliography` の string/list、front matter source 基準の relative path、absolute / `..` / symlink、missing / directory / NUL / wrong extension / invalid UTF-8 を検査すること
- `\cite` の単一/複数/反復 key、日本語隣接、`\\cite` escape、code / raw HTML / math の除外、heading / link の拒否、brace / key / cluster error の file:line 診断を検査すること
- BibTeX / BibLaTeX の主要 entry、Unicode、brace 保護、accent、`@string`、crossref、同一/複数 file の duplicate key、missing cited key、未使用 entry の除外を検査すること
- citation / bibliography / backlink の role、全 ID の一意性、raw HTML / template ID との衝突、marker 0/1/2 個、同一 citeproc session に基づく番号と entry 順を検査すること

## 7.4 integration test

- `make docs-release` が `default` template で公開用文書を生成し、`make docs-templates` が manifest にあるすべての bundled template で共通sampleを生成する。sampleは `compact` で4ページ以上、その他で5ページ以上とし、ページ数に上限を設けない。`compact` 以外の目次は2ページ以上とし、長い表・code block、数式、画像、raw HTML、改ページを含める。`compact` は2段組み目次と本文をfirst pageに共存させる。`make docs-template-images` はreview用に全ページを連番PNGへ画像化する。公開用、preview PDF、確認画像の出力treeとCI artifactは分離する
- 単一 Markdown から `document.html` を生成し、test が検査した同じ file を Vivliostyle CLI が消費する
- ディレクトリ中の Markdown がファイル名順に結合される
- file ごとの block 構文が隣接 file の内容に影響されず、各 file anchor と全体で一意な heading anchor が生成される
- table、task list、nested list、strikethrough、autolink、CJK-friendly strong を含む comprehensive GFM 文書を生成 HTML / PDF へ変換できる
- 共通 preview の BibTeX citation、複数 cluster、長い DOI / URL、CJK / Latin entry が全 bundled template で欠落・overflowせず、PDF 内部 link と text extraction を維持する
- Markdown と inline / block raw HTML を同じ文書で組み合わせ、HTML 要素、style、必要な script が生成 HTML / PDF の双方へ反映される
- 相対画像、空白を含むパス、日本語パスを処理できる
- `..`、absolute path、symlink target を含む trusted local resource を process の権限内で参照できる
- nested CSS `@import` / `url()`、import cycle、raw HTML の `srcset` / inline style を resource graph に取り込み、logical URL の resource を読める
- fetch / navigation role ごとの relative、`file:`、HTTP(S)、network-path、`data:`、`blob:`、`mailto:`、`tel:`、`javascript:`、未知 scheme の分類と、raw HTML `a[href]` の Markdown file link 書き換えを検査する
- script が動的に組み立てる local path は renderer の保証対象外であることを、誤って静的 resource と成功判定しない
- inline module script と `iframe[srcdoc]` を trusted HTML として保持し、その内部の resource graph は追跡しない
- loopback server で、token なし、未知 ID、path traversal、二重 encoding、不正 range、request body、Host / Origin 不一致、header / concurrency 上限を検査し、必要な single range と CORS、no-store / no-referrer / nosniff header を扱い、終了後に port を閉じる。事前検査後の symlink / FIFO 差替えで特殊 file を読まず失敗することも確認する
- DOM、local stylesheet / script、font、image decode、数式、コードハイライトが完了した後に pagination が始まることを、pinned Vivliostyle CLI と実 browser で検査する。readiness gate の解放前に pagination が始まらず、local resource error、bundled script error、登録 promise の rejection、late registration、完了 signal 不整合が、上流 child の終了 code にかかわらず code `1` になる
- readiness 未完了、停止 script、停止 child が absolute deadline で終了し、graceful / forced cleanup 後も既存出力を保持する
- 読み取り専用の入力ディレクトリから出力できる
- 既存出力がある状態でビルドに失敗しても既存出力を保持する
- 最終出力と同じ directory の exclusive な一時 file から成功後に commit し、source size と copy byte 数の不一致、copy 後の切断 / 壊れた xref / page tree、PDF metadata 更新後の破損、rename failure、一時 file の flush failure、中断の fault injection で既存出力を保持する。commit 後の親 directory flush failure は durability warning になることも固定する
- commit critical section の直前 / 中 / rename 直後へ signal を注入し、commit 前の signal だけが非 0 と既存出力保持になり、rename 後は完全な新出力と code `0` になる
- PDF worker を停止させる循環 object / 巨大 xref fixture でも main process の deadline と signal handling が動作し、worker と sibling 一時 file を回収する
- 同一出力への 2 build を意図的に競合させても byte が混在せず、最後に commit した完全な PDF だけが残る
- `npm pack` した tarball を新しい一時 project から `npm exec` で実行できる
- browser がない初回実行で pinned Vivliostyle CLI の標準取得処理が動作するか、上流の診断をそのまま利用者へ示す
- `PFPDF_BROWSER_PATH` で明示した互換 browser を利用できる
- 環境変数で template、browser を設定でき、CLI 引数が常に上書きする
- 現在の pfpdf version に対応する custom template directory を利用できる
- host font が無効なときは OS の font directory を読み込まない
- renderer が integration test で検査したものと同じ `document.html` を入力にする
- horizontal RTL と vertical writing の fixture で root `dir`、computed writing mode、upstream が生成する PDF reading direction の組合せを確認する
- 同じ HTML byte 列でも build ごとの origin / port / token が異なることを固定し、生成 HTML に token が混入しないことと、利用者 script が `location` に依存した場合は再現性保証外であることを検査する
- `--doctor` と `--print-effective-config` が PDF を生成せずに診断結果を返す
- `--doctor` と `--print-effective-config` の stdout が各 schema の JSON object 1 個だけで parse でき、stderr の log が混ざらず、秘密を含む値が redaction される
- `--doctor` が browser 検査用の secure temporary profile を正常時・失敗時・timeout 時に回収し、project / output directory、browser cache、OS 設定を変更しない
- child output / renderer diagnostics の UTF-8 code point や token が chunk 境界をまたいでも正しく decode / escape し、AssetServer token や既知 credential を stdout、stderr、保持 workspace のいずれにも生値で残さない
- 8 MiB を超える child output でも pipe を drain して停止せず、保存 diagnostics だけを上限で truncate し、省略 byte 数を正しく記録する
- `docs/design.ja/` と `docs/design.en/`、`docs/tutorial.ja/` と `docs/tutorial.en/` の file 集合・番号・相対 path が一致する
- 日英 4 文書を repository の現在の pfpdf build で生成できる

## 7.5 PDF smoke test

4 つの対応環境すべてで実際に Chromium を起動します。検査は壊れた空 file を成功扱いしないための最小限に留めます。

- 出力が `%PDF-` で始まる
- file が non-empty で、`pdfinfo` で 1 ページ以上と確認できる
- `pdftotext` でタイトル、本文、日本語の代表文字列を確認する
- 日英の design / tutorial 4 PDF について title、言語ごとの代表文字列、page 数が 0 でないことを確認する
- tutorial PDF で table、日本語 strong、raw HTML、数式、code highlight の代表文字列を確認する
- bundled 日本語 font を使う canonical fixture は `pdffonts` で意図した font が埋め込み / subset され、host font へ置換されていないことを 4 環境で確認する。host font 機能は再配布可能な専用 fixture で許可 / 拒否 flag と実際の選択を検査する
- PDF byte comparison、全 page の画像化、一般文書に対する全 font の完全な subset 検査は必須にしない

通常実行の構造検査とは独立に、smoke test でも truncated xref、0 page、暗号化または parse 不能な output を成功にしないよう `pdfinfo` の終了 code を検査します。`pdftotext` は文字列が見つからない場合に command 自体が `0` でも test を失敗させます。

## 7.6 npm package test

- `npm ci` / `npm test` / `npm run lint`
- `npm pack --dry-run` で不要ファイルや秘密情報が含まれないことを確認する
- packed tarball を使って `npm exec --package=<tarball> -- pfpdf --help` を実行する
- tarball に `npm-shrinkwrap.json` が含まれ、`package-lock.json` は含まれず、空 project へ install した runtime dependency tree / integrity が source lockfile と一致することを 4 環境で確認する
- 対応 range の最古 Node.js で packed entrypoint を load / 実行でき、range 直外の代表 version では起動時検査が意図した診断を返す
- 4 つの対応環境で `tests/fixtures/minimal/` の PDF を生成する

## 7.7 property / fuzz / performance test

- front matter、URL、HTML / CSS resource token、heading、CJK delimiter、OpenType table parser は、任意 byte 列で crash / hang せず、入力誤りまたは正常結果のどちらかを返す property test を持つ
- path test は POSIX と Windows の separator、drive letter、UNC、reserved name、末尾 dot / space、Unicode normalization を platform ごとの fixture で扱う。host OS の path library だけで別 OS の文字列を誤って正規化しない
- `M`、`B`、`N`、`T`、`R`、`C`、`A`、`F`、`G`、`P` を個別に段階増加させ、wall time、peak RSS、AST visit / map lookup / file parse / filename comparison / compared byte / 実配信 byte / copy byte の内部 counter を記録する。counter は設計上の bound を assertion にし、sort と外部 parser / renderer を除く線形処理は専用 runner の大きい 3 点以上で入力を 2 倍にした median time / RSS が連続して 3 倍を超えた場合を performance regression とする。pinned GFM parser と実 renderer は別系列で adversarial input の時間推移と timeout を記録する
- 長い delimiter 列、深い list / blockquote、CSS import cycle、同名 heading、多数の missing link、多数の font face を adversarial fixture とする
- fuzz corpus で見つかった crash、timeout、過剰 memory は最小化して通常 fixture へ昇格し、再発を防ぐ
