# 2. 内部 architecture

## 2.1 構成要素

```text
pfpdf CLI
  ├── ConfigResolver
  ├── InputResolver
  ├── ResourceResolver
  ├── Workspace
  ├── FontResolver
  ├── MarkdownRenderer
  ├── BibliographyFormatter
  ├── TemplateResolver
  ├── HtmlDocumentBuilder
  ├── ReadinessCoordinator
  ├── AssetServer
  ├── OutputCommitter
  └── Renderer
        └── Vivliostyle CLI
              └── Chromium
```

CLI と変換処理は TypeScript で実装し、npm package の compiled JavaScript を実行します。

## 2.2 `ConfigResolver`

- 組み込み既定値、front matter、CLI 引数を定義済みの優先順位で解決する
- boolean、enum、数値、path を検証し、不正値を拒否する
- path ごとに基準 directory を適用し、renderer へ渡す前に絶対 path へ正規化する
- CLI の値をfront matterより常に優先し、effective config と各値の設定元を `--print-effective-config` と `--doctor` から再利用する
- `InputResolver` が返した front matter の `template` / `toc` / `logo` は、対応するCLI指定がない場合だけ組み込み既定値を置き換える。したがって優先順は組み込み既定値、front matter、CLI とする
- template は1つの論理設定として解決する。`--template SOURCE` は bundled preset 名との完全一致、`git::` locator、local path の順に分類する。明示 preset の `--template-preset NAME` は source 指定と排他的とする
- 同じ論理設定の正 / 負指定、たとえば `--toc` と `--no-toc`、`--logo` と `--no-logo` を同じ CLI invocation で併用した場合は、引数順に依存させず終了 code `2` とする
- `--font-dir` 以外の値付き / boolean option を同じ invocation で繰り返した場合は、同じ値でも code `2` とする。unknown option、未定義の positional argument、option value の欠落も code `2` とし、「最後の値が勝つ」引数順依存を作らない
- conversion、`--doctor`、`--print-effective-config`、`--help`、`--version` は排他的な command mode とする。mode flag を複数指定した場合は code `2` とし、help / version を理由に他の不正引数を暗黙に無視しない
- path は NUL を拒否し、空文字列を「未指定」として扱わない。解決後も表示用の元表現と実行用の絶対 path を分離する

## 2.3 `InputResolver`

- CLI のパスを絶対パスへ変換する
- locale に依存しない規則で Markdown 一覧を決定し、case-insensitive filesystem で衝突する名前も検出する
- front matter が最初の Markdown の先頭 1 か所だけにあることを検証する
- title、author、series、date、page size、confidential、document language / direction、および `template` / `toc` / `logo` の型と値を検証する。CLIがfront matterを上書きする場合も、不正な値を無視しない
- metadata の許可済み HTML と plain text 表現を分離し、template placeholder ごとの escape 漏れを防ぐ
- file input ではその親 directory、directory input では input directory を resource base として保持する
- 検証に使った Markdown byte 列をそのまま parser へ渡し、検証後に path から読み直して別内容を処理しない
- 複数ファイルのうち 1 ファイルでも失敗したら文書全体を失敗させる(fail-fast)

エラーを含む Markdown だけを読み飛ばして残りを出力する挙動は採用しません。部分的な成果物を成功扱いすると、欠落に気付かないまま配布される危険があるためです。

front matter は既存 YAML library の JSON schema で 1 document の mapping として読みます。pfpdf が利用する metadata key と型だけを検査し、入力を防御するための独自 YAML parser や size / nesting 制限は持ちません。先頭の BOM を除いた最初の行が `---` なら front matter delimiter として予約します。最初の source file では同じ file 内の単独行 `---` または `...` で閉じることを必須とし、閉じ delimiter がない場合や mapping が不正な場合は thematic break として読み替えず入力エラーにします。最初以外の source file が `---` で始まる場合は、その後の内容にかかわらず重複 front matter として入力エラーです。

### 2.3.1 `BibliographyFormatter`

`bibliography` front matter は string または非空 string list とし、先頭 Markdown の親 directory を基準に `.bib` path を解決します。`.bib` は browser が描画時に取得する resource ではなく build input です。`InputResolver` が Markdown と同様に UTF-8 byte 列を一度だけ読み、その content を `BibliographyFormatter` へ渡します。

`BibliographyFormatter` は Citation.js で BibTeX / BibLaTeX を CSL-JSON へ変換し、citeproc-js の一つの session で文書全体の citation cluster と参考文献一覧を処理します。source file ごとに processor を分けると番号と並びが変わるため禁止します。library 固有 object と生成 HTML は adapter 内に閉じ、Markdown 層へは citation key、entry 順、HAST fragment だけを返します。不正 database、重複 key、存在しない引用 key は renderer 起動前の code `2` とします。

## 2.4 `ResourceResolver`

`ResourceResolver` は、静的に記述された local resource を renderer-neutral な logical URL へ変換します。

- Markdown とその inline raw HTML は input の resource base、template HTML は template directory、各外部 CSS はその file の親 directory を基準にする。CLI で指定した logo / font は ConfigResolver が解決した絶対 path を起点にし、異なる基準を暗黙に混ぜない
- Markdown AST の link / image、raw HTML の URL 属性と `srcset`、inline style、`<style>`、template、外部 CSS の `url()` / `@import` を、それぞれ HTML / CSS parser の token 上で処理する。正規表現だけで HTML や CSS を書き換えない
- local CSS の `@import` を queue で反復的にたどり、canonical path の visited set で循環を止める。同じ file を path 表現の違いで複数回解析しない
- 各 fetch resource に探索順で決定的な logical ID を割り当て、HTML には `assets/<id>/<encoded-basename>` のような相対 URL だけを出力する。pfpdf が解決した asset の absolute path、一時 directory、random token を `document.html` へ新たに埋め込まない。利用者が navigation link として明示した absolute `file:` URL は portable でないことを承知した入力として保持する
- seed の順序は bundled resource の固定 list、template DOM の source order、Markdown file / AST node の source order、effective font の優先順とする。CSS の参照は queue から取り出した file 内の token 順で追加し、非同期 I/O の完了順や hash map の偶然の列挙順で ID を変えない
- query と fragment は resource path と分離して保持し、percent decode は URL component ごとに 1 回だけ行う。NUL、不正な percent encoding、URL として不正な値は入力エラーにする
- Markdown / HTML / CSS の URL は `/` を separator とする。Windows absolute path は `file:///C:/path/to/file`、UNC は妥当な `file://server/share/...` URL で表し、backslash を URL path separator として推測しない。CLI の path は OS native path として別に扱う
- URL は element / AST node の役割で分類する。画像、script、stylesheet、font など browser が取得する URL だけを resource graph に入れ、`a[href]` の navigation target を asset 配信用 URL へ変えない。fetch role では relative / absolute `file:` を local、HTTP(S) / network-path reference と `data:` を remote / embedded として扱い、それ以外の scheme は静的に再現できないため code `2` とする。特に source に直書きされた `blob:` は別 browser session で有効でないため拒否する
- navigation role の文書内 fragment、HTTP(S)、`mailto:`、`tel:`、absolute `file:`、raw HTML に明示された `javascript:` / custom scheme は local resource graph へ入れず、trusted link として保持する。scheme のない relative navigation は後述の document link 規則で処理する。URL parser が scheme と判断した値を local path として再解釈しない
- symlink は許可するが、canonical path で重複排除と循環検出を行う。build 中の file 内容変更を snapshot として固定することまでは保証しない
- local resource は regular file または regular file への symlink だけを許可する。directory、FIFO、socket、device は描画前に code `2` で拒否し、resource discovery や response で特殊 file を開いて停止しない
- script が実行時に組み立てる path、runtime に追加される DOM、network response 内の参照は静的 resource graph の対象外とし、動的な local path を参照できることを保証しない
- JavaScript module graph と nested HTML document 内の resource graph は解析しない。inline module、`iframe[srcdoc]` などの trusted HTML は保持するが、その内部で参照される relative local resource の解決は保証しない。必要なら利用者が bundle または absolute / remote URL を使う

この graph は local file を単一 HTML へ埋め込むためではなく、URL 書き換えと request routing を一貫させるために使います。元 asset の byte 列は workspace へ複製せず、書き換えが必要な CSS だけを generated asset として出力します。

## 2.5 `Workspace`

入力ディレクトリを変更しないため、システムの一時ディレクトリに build workspace を作ります。

```text
<temporary>/
  pfpdf-<random>/
    manifest.json
    style.css
    vivliostyle.css
    host-fonts.css
    document.html
    renderer-diagnostics.log
    browser-profile/
    renderer-output/
      output.pdf

<output-directory>/
  .pfpdf-<random>.tmp
```

- original input、template、logo、host font は workspace へ複製せず、manifest が original file と logical URL の対応を保持する
- generated asset は workspace 直下の乱数を含む directory に配置して利用者ファイルと衝突させず、`document.html` と生成 CSS へ pfpdf 自身が original input の absolute path を追加しない。利用者が明示した absolute `file:` navigation link は例外とする。path 対応を含む `manifest.json` は workspace 外へ公開しない
- browser binary と cache は Vivliostyle CLI に管理させ、実行ごとの browser profile だけを workspace に置く
- `--keep-work-dir` がない限り `finally` 相当の処理で削除し、正常終了、通常の validation / renderer error、捕捉可能な中断を代表 test する
- `--keep-work-dir` で表示する path に入力由来の秘密情報が残り得ることを warning にし、directory permission を利用者だけが読める値にする
- `--keep-work-dir` では manifest、生成 HTML / CSS、readiness / page error を含む renderer diagnostics を残す。diagnostic は trusted input として sanitize / redact しない。logical asset URL は AssetServer 停止後に解決できないため、`document.html` を `file:` で直接開いて同じ描画になるとは案内しない
- crash 後の stale workspace の列挙・自動回収は実装せず、OS の temporary directory cleanup に任せる
- workspace 作成は OS の secure temporary API を使い、POSIX では permission `0700` を要求する。既存 path の再利用、予測可能な固定名、symlink をたどった作成は行わない

## 2.6 `AssetServer`

- renderer と同じ host process で `AssetServer` を起動し、Vivliostyle CLI には file path ではなく document URL を渡す。browser と同じ host の `127.0.0.1` にある OS 割当 port だけへ bind し、IPv4 loopback 以外の interface へ bind しない
- HTML byte 列と logical asset path は決定的でも、browser から見える port は build ごとに異なる。利用者 script が `location.href` / `origin`、時刻、乱数から描画内容を作る場合の再現性は保証しない
- `ResourceResolver` の manifest が公開対象として列挙した exact file と generated file だけを logical ID で配信し、manifest 自体、browser profile、renderer output は配信しない。任意 path の静的 file server や directory listing にもしない
- request ごとに manifest の target を open し、regular file であることを確認して配信する。build 中の file 変更は trust model 上の非保証とする
- method は renderer が使う `GET` / `HEAD` だけを扱う。Host / Origin / CORS policy は security boundary にならないため実装しない
- MIME type、`Content-Length`、single range request、`HEAD` を扱う。multi-range、圧縮、cache validation、upload は扱わず、無効な range は `416` とする
- response に `Cache-Control: no-store` を付ける
- path segment は decode 前後で検証し、`..`、separator、NUL、二重 encoding によって logical ID の対応先を変えられないようにする
- remote HTTP(S) resource は proxy せず browser から直接取得させ、取得結果を監視しない
- renderer 終了と捕捉可能な中断で新規 request の受付を止め、2 秒後に残る socket を破棄して listener と port を解放する
- manifest は renderer-neutral な resource 解決のためのものであり、この server を sandbox や security boundary とはみなさない

## 2.7 生成 HTML と `document.html`

pfpdf は信頼済みのローカル文書を処理する tool とし、local resource を sandbox 化しません。

- Markdown と raw HTML に静的に記述された相対 URL は resource base を基準に解決し、`ResourceResolver` が renderer-neutral な logical URL へ書き換える
- local stylesheet、script、CSS の `url()` / `@import` も各 resource 自身の URL を基準に再帰解決する
- `..`、absolute path、`file:` URL、symlink target を入力 root だけに制限しない。静的に解決でき、pfpdf process の実行権限で読める file は trusted input の resource として扱う
- Markdown AST の link と raw HTML の `a[href]` が同一文書へ結合される Markdown file を相対指定した場合は、file anchor または指定 fragment へ書き換える。それ以外の navigation link は trusted input として保持し、存在確認や可搬性の判定は行わない
- remote image、stylesheet、script は browser に直接取得させる。timeout、DNS、TLS、HTTP error を pfpdf が監視・分類して build 成否へ反映することは保証しない

`HtmlDocumentBuilder` は workspace に `document.html` を 1 つ生成し、`AssetServer` がその byte 列を変更せず配信した URL を Vivliostyle CLI へ渡します。HTML を公開出力形式にはせず、asset の data URL 化、font subset、単一 file 化を行いません。HTML の integration test は別の出力 pipeline を作らず、renderer が実際に URL から消費する `document.html` と同じ builder 出力を保存・比較します。host path や port は manifest / 起動引数側で解決し、HTML byte 列を作り直しません。

`pfpdf-file-` で始まる ID、`data-pfpdf-*` attribute、`window.pfpdf` は内部 contract でも利用しますが、trusted HTML との衝突を事前検査して拒否しません。builder は処理した `data-pfpdf-slot` を除去します。利用者 script による `window.pfpdf` の上書きを防止・検出する専用処理は持ちません。登録 API を利用する script はその名前を保持する必要があります。

## 2.8 `ReadinessCoordinator`

document の `<head>` で最初に readiness coordinator を初期化し、font、local image、および利用者が明示登録した非同期処理を 1 つの promise に集約します。MathJax と highlight.js は HTML assembly 前に完了する build-time transform であり、browser 内の readiness 状態には含めません。

- coordinator は DOM parse、`document.fonts.ready`、static local image / logo の `decode()`、登録 promise の完了を待つ。stylesheet / classic scriptなど実際に読み込まれるlocal resourceのload errorはcapture phaseの`error`でbuild errorにする
- manifest はURL解決と配信対象の正確な対応表として使うが、描画に利用されない項目を含む全件の事前`fetch`は行わない。browserが実際にload / decodeする経路を二重実行せず、その完了を待つ
- 利用者 script は `window.pfpdf.registerReady(promise)` で pagination 前に待つ処理を登録できる。登録は document の parse 完了までに行い、それ以降の登録は error にする
- coordinator は `window.pfpdf` に frozen API object を公開し、`registerReady` の引数を `Promise.resolve` 相当で同化する。trusted scriptによるnamespaceの改変を防ぐproperty descriptorや改変検出は設けない
- `error` と `unhandledrejection` は readiness 完了までは build error とする。完了後に timer や event handler が起こす処理までは PDF の成否へ反映できない
- renderer は readiness の成功を確認してから pagination を開始し、`--render-timeout-ms` の deadline を renderer が最初の外部 process を起動する直前から browser の確認と取得、readiness、PDF 生成・後処理・構造検査の全体へ適用する
- child process として呼ぶ pinned Vivliostyle CLI との readiness 接続方法を release 前に固定する。上流に pagination 前の hook がある場合はその正式 API を使う。ない場合は、document load を保留する専用 gate resource と、coordinator から loopback serverへの単一完了通知を使う。通知は成功・失敗と短い診断を伝え、gateは成功時だけ解放する。host側のcoordinatorがrejection、resource error、timeoutを記録し、上流childがcode `0`を返してもbuildを失敗させる。この接続をpinned browserで実証できない限りreleaseしない

remote image / stylesheet / script の欠落や利用者 script が登録しなかった非同期処理まで完全に検出する契約ではありません。再現可能な文書では local resource を使い、pagination に影響する非同期処理を必ず登録します。

## 2.9 CLI 設計

実行ファイル名は `pfpdf` とします。

```text
Usage: pfpdf --input INPUT --output OUTPUT [OPTIONS]

Required:
  --input PATH       Markdown ファイルまたは Markdown を含むディレクトリ
  --output PATH      .pdf の出力先

Options:
  --title TEXT             front matter の title を上書きする
  --toc / --no-toc         目次生成を有効 / 無効化する。既定は有効
  --template SOURCE        preset 名、local directory、または git::URL//PATH?ref=REVISION
  --template-preset NAME   bundled template preset を明示選択
  --logo SOURCE            local file または git::URL//PATH?ref=REVISION。template 既定値を上書き
  --no-logo                local / repository / template 既定 logo を無効化
  --host-fonts             OS 標準の font directory を使用する
  --font-dir PATH          追加 font directory。複数回指定可能
  --browser-path PATH      renderer が使う browser
  --render-timeout-ms N    renderer 準備から PDF 検査完了まで。既定は 300000
  --keep-work-dir          一時 workspace を保持する
  --log-level LEVEL        error / warn / info / debug
  --print-effective-config 適用後の設定と設定元を表示して終了する
  --doctor                 renderer、browser、asset を診断する
  --version                バージョンを表示する
  -h, --help               ヘルプを表示する
```

### 2.9.1 パス規則

- 相対パスは `pfpdf` を呼び出したカレントディレクトリ基準で解決する
- `--input -` / `--output -` を stdin / stdout の意味では受け付けず code `2` とする。入力順・resource base・atomic output を維持するため、`v0.1.0` は named path だけを扱う
- `--input` がディレクトリなら、直下の小文字拡張子 `*.md` を持つ regular file と regular file への symlink だけを対象にし、file 名の UTF-8 byte 列の昇順で処理する。POSIX では directory entry を byte 列として読み、不正 UTF-8 の file 名を replacement character にせず入力エラーにする。再帰探索と locale 依存 sort は使わず、可搬性のため `00_`、`01_` の番号 prefix を推奨する。対象が 0 件の場合は入力エラーにする
- `--input` がファイルなら、その 1 ファイルだけを処理する。小文字 `.md` 以外の拡張子は入力エラーにする
- input は UTF-8 とし、先頭の UTF-8 BOM と CRLF を受け付ける。不正な byte 列は replacement character にせずエラーにする
- directory input の front matter は、並び順で最初の Markdown の先頭に 1 つだけ置ける。他の file が front matter delimiter で始まる場合は重複 metadata として拒否する。どの source file でも冒頭の thematic break には `***` を使う
- file 名の異なる入力は現在の filesystem が列挙した別 entry として扱う。別 OS 向けの normalization / case-folding 衝突を先回りして拒否しない
- output 拡張子は ASCII case-insensitive に `.pdf` だけを受け付け、利用者が指定した file 名を保持する
- 既存 output path は regular file または symlink だけを置換対象とし、directory、FIFO、socket、device は入力エラーとして拒否する。symlink の target へ書き込まず、最終 commit で directory entry としての symlink を置換する
- 出力先の親ディレクトリがない場合は、入力と設定の検証完了後に作成する。親 path に regular file がある場合や作成後の親が directory でない場合は入力エラーにする
- `OutputCommitter` は最終出力と同じ directory に、exclusive create した予測不能な短い名前の sibling 一時 file を作る。POSIX の初期 permission は `0600` とし、新規出力は `0666 & ~umask`、既存 regular file の置換はその mode を引き継いでから commit する。既存 symlink の target mode は引き継がず、symlink 自体を新しい regular file で置換する。renderer と AssetServer の停止、PDF 検査、file flush、`--keep-work-dir` でない場合の workspace cleanup がすべて完了した後、同一 filesystem 上の rename / replace を最後の commit point とする
- atomic replace と directory flush は対象 OS / filesystem が提供する保証の範囲とする。atomic replace を提供しない filesystem へ copy-delete で fallback せず code `1` にし、network / distributed filesystem 固有の visibility や durability を local filesystem と同等とは表現しない
- renderer、検査、rename のいずれかに失敗した場合は sibling 一時 file を削除し、既存出力を維持する。Windows で既存 file が他 process に開かれて置換できない場合は終了 code `1` とし、先に既存 file を削除して retry しない
- 捕捉不能な `SIGKILL` / 電源断では `.pfpdf-<random>.tmp` が出力 directory に残り得る。次回実行で同 prefix の file を所有物と推測して自動削除せず、最終 output としても扱わない。利用者は動作中 process がないことを確認した後に手動削除できる
- rename 成功後は完全な新出力が visible であり、既存出力へ安全に rollback できない。可能な POSIX platform では親 directory を flush し、その flush だけが失敗した場合は durability warning と終了 code `0` を返す。出力内容の成功と crash 後の directory entry 永続化を混同しない
- 捕捉可能な中断 signal と commit を state machine で直列化する。commit critical section に入る前に受けた signal は rename せず中断扱いにし、critical section 開始後の signal は rename と可能な directory flush が終わるまで遅延する。rename が成功した後は rollback せず build 成功 code `0` として signal を再送しない。これにより「捕捉可能な中断の非 0」と「新 output の commit」を同時に発生させない
- 同じ最終出力を対象にした同時 build の lock は実装しない。各 build の一時 file は衝突せず、複数が成功した場合は最後に commit した完全な PDF が残る。どの build を優先するかの調停と crash recovery は行わない
- 入力と出力が同じファイル、または出力が入力 Markdown を上書きする指定は拒否する

### 2.9.2 metadata と再現可能な日付

- `title` は必須とし、front matter と `--title` のどちらにもなければ終了 code `2` で失敗する
- `title` は空でない string とし、HTML tokenizer で text / character reference と、大小文字を区別しない attribute なしの `<br>` / `<br/>` / `<br />` token だけを許可する。その他の comment、tag、attribute は除去せずエラーにする。plain な `x < y` は text として扱う。plain text 表現では許可した改行 tag を U+000A へ変換し、HTML `<title>` では空白へ畳んでから DOM API で設定する
- `author`、`series`、`date` は string、`confidential` は YAML boolean、`page_size` は allowlist keyword または寸法 2 個だけを受け付け、省略時は `A4` とする。`author` / `series` / `date` には HTML を許可せず DOM の text として挿入する
- title の視覚的な改行は YAML block scalar や literal newline ではなく、許可した `<br>` を使う
- `lang` は well-formed な BCP 47 language tag の string とし、Node.js の `Intl.getCanonicalLocales` で canonical form へ正規化する。省略時は `ja` とし、生成 HTML root の `lang` attribute、hyphenation、font 選択へ使う
- `dir` は `ltr` / `rtl` / `auto` の ASCII case-sensitive enum とし、省略時は `auto` とする。生成 HTML root の `dir` attribute へ設定し、host locale や `lang` だけから text direction を推測しない。upstream の reading progression は固定値で上書きせず、computed `writing-mode` / direction から自動判定させ、horizontal RTL と vertical writing の PDF direction を compatibility test で確認する
- page size keyword は ASCII case-insensitive の `A3`、`A4`、`A5`、`JIS-B4`、`JIS-B5`、`ISO-B4`、`ISO-B5`、`Letter`、`Legal` とする。曖昧な `B4` / `B5` は受け付けない。寸法は `<number><unit><ASCII-whitespace+><number><unit>` の幅・高さ順とし、unit は `mm` / `cm` / `in` / `pt`、各辺は正の有限 decimal とする。renderer が扱える寸法へ pfpdf 独自の上限を設けない
- metadata key は `title`、`author`、`series`、`date`、`page_size`、`confidential`、`lang`、`dir` の allowlist とし、重複 key と未知 key は入力誤りとして報告する
- 文書設定の`template`はbundled template名、`toc`はYAML boolean、`logo`はlocal path stringまたは`false`とする。`logo`の相対pathはfront matter sourceの親directory基準で解決し、Git repository sourceはfront matterでは拒否して`--logo`だけから受け付ける
- `--title` は有効な front matter title の値だけを上書きする。CLI override があっても front matter 全体の syntax、key、型を先に検証し、不正値を隠さない
- `confidential` の既定値は `false` とし、利用者が明示した場合だけ `Confidential` 表示を行う
- `SOURCE_DATE_EPOCH` は ASCII decimal の非負整数 Unix seconds とし、13 digit を超える値は数値変換前に拒否する。その後 JavaScript `Number` を経由せず parse し、安全な整数かつ ECMAScript `Date` の表現範囲にあることを確認する。不正値は無視せずエラーにする。`date` が省略されてこの値が有効なら、表示日付には UTC のその日付を使う。未設定時の表示日付は process 起動時に 1 回だけ取得した local date、PDF metadata は同じ起動 instant を使う。front matter の `date` の有無にかかわらず、`SOURCE_DATE_EPOCH` 未設定時は再現可能 build ではないことを warning にする
- 生成日付は `lang` の primary language が `ja` なら `2026 年 8 月 3 日`、それ以外なら locale 非依存の `2026-08-03` とする。template は日付へ固定 label を追加せず、利用者が指定した任意 string の `date` は書式変更しない
- PDF Info / XMP の title は title の plain text 表現、author は HTML として解釈しない元 string を使い、author 未指定時は field を作らない。PDF catalog の `/Lang` は canonical `lang` にする。表示用 `date` や confidential flag を PDF の作成 timestamp / author field へ流用しない
- PDF の CreationDate / ModDate と XMP timestamp は、`SOURCE_DATE_EPOCH` があればその UTC instant、なければ process 起動時刻を使う。任意 string である front matter の `date` は PDF timestamp に流用しない。upstream の正式 option または構造を理解する PDF library で設定し、PDF byte 列を正規表現置換しない
- canonical CI では `SOURCE_DATE_EPOCH` を固定し、生成 HTML と PDF Info / XMP title・author・language・timestamp / timezone policy を同じ fixture で検査する。timestamp を固定しても browser / OS 間の PDF byte 一致までは保証しない

### 2.9.3 設定解決と診断

- 文書設定の`template` / `toc` / `logo`は、CLIに値があればCLI、なければfront matter、どちらにもなければ組み込み既定値を採用する。template source / explicit presetと、logo source / disabledはそれぞれ排他的な1つの論理設定とする
- browser path、追加font directory、host font、timeout、workspace保持、log levelはCLIだけから設定する。listを別の設定元から暗黙連結しない
- `SOURCE_DATE_EPOCH`だけは再現可能buildの標準環境変数として扱い、表示日付とPDF metadata timestampに使用する。front matterの`date`は表示日付だけを上書きする
- child process は通常の CLI tool と同様に呼出元の環境変数を継承する
- `--print-effective-config` は versioned schema を持つ JSON object を 1 個だけ stdout へ表示し、各値と、その設定元が CLI、front matter、default のどれかを含める。`--input` があれば先頭 Markdown の `template` / `toc` / `logo` まで反映する。token、credential、環境変数の生値は含めず、秘密を含み得る proxy URL と custom CA の内容は表示しない
- `--doctor` は effective config に基づき、Node.js、browser、template、logo、font directory、出力権限を検査する
- `--doctor` と `--print-effective-config` は PDF を生成せず、診断で秘密情報や環境変数全体を表示しない
- `--doctor` は browser download、利用者の project / output directory 作成、設定変更を行わない。browser 実起動の検査に必要な場合だけ、OS の secure temporary directory に専用 profile / workspace を作り、`finally` で回収する。cleanup 失敗は check の `fail` として残す。出力権限は既存の最寄り親 directory から best effort で判定し、実際の create / rename 成功を保証しない。外部 process の各 check は cleanup を含めて 10 秒、command 全体は 60 秒で打ち切り、timeout を `fail` として報告する
- `--doctor` と `--print-effective-config` の実行時は `--input` と `--output` を必須にしない
- input / output なしの `--doctor` は runtime と global setting だけを検査し、指定された場合だけ document resource と書込先まで検査する。未指定項目を成功確認済みと表示しない
- `--doctor` は versioned schema の JSON object を stdout へ出し、検査ごとに `pass` / `warning` / `fail` / `not-run` と根拠を持たせる。問題を検出した場合に終了 code `1`、warning のみまたは問題なしの場合は `0` を返す

logo未指定はtemplate slotの既定`src`を使用する`template`状態、front matterの`logo: false`またはCLIの`--no-logo`はそれも削除する`none`状態としてeffective configで区別します。

effective config の top-level は `schemaVersion: 5` と `command` を持ち、`config.<name> = {"value": ..., "source": "cli|front-matter|default"}` を含みます。schema 5ではenvironment sourceを削除し、`toc` / `logo`がfront matter sourceを持てるようにします。template はrepository variant、logoは`template` / `none` / `local` / `repository` variantを持ちます。doctor は `schemaVersion: 2` のままとし、全体の `status` と `checks[] = {"id": ..., "status": "pass|warning|fail|not-run", "message": ...}` を持ちます。doctor の全体 status は 1 個でも fail があれば fail、なければ warning があれば warning、実行対象が 1 個以上すべて pass なら pass とします。key と check の出力順を固定し、UTF-8 の compact JSON 1 行と末尾 LF だけを stdout へ書きます。将来の optional field 追加は同じ schemaVersion で許可しますが、既存 field の意味・型の変更や削除では version を上げます。

### 2.9.4 終了コード

| code | 意味 |
|---:|---|
| `0` | 成功 |
| `1` | renderer、browser、その他の実行時エラーまたは内部エラー |
| `2` | CLI 引数、入力、front matter のエラー |

help、version、`--doctor`、`--print-effective-config` など command が要求された結果だけを stdout へ出し、通常の PDF build は stdout へ何も出しません。進捗、通常 log、警告、エラーと child process の出力は stderr へ送ります。例外 stack trace は標準では表示せず、`--log-level debug` の場合だけ表示します。commit 前の中断 code は Node.js と各 OS の慣例に従い、platform をまたぐ独自 code へ正規化しません。commit critical section 後の signal は前節の規則で遅延し、成功済み build を中断へ戻しません。

診断には可能な限り source file と 1-origin の line / column、該当 CLI option / front matter key、処理 phase を含めます。trusted input 前提のため human-readable log の内容は sanitize / redact せず、JSON は serializer の通常の escape に任せます。

利用者が指定した CLI の値、Markdown、front matter、custom template、logo、font、静的 local resource の不正・不存在・読取り不能は code `2` とします。browser / renderer の失敗、timeout、出力先への write / rename 失敗、bundled resource の欠落、内部 invariant 違反は code `1` とします。同じ検査でも bundled template / font の破損は利用者入力ではないため code `1` です。cleanup が commit 前に失敗した場合も code `1` として既存出力を維持します。

## 2.10 計算量と resource 上限

入力 Markdown file 数を `M`、その合計 byte 数を `B`、生成 AST node 数を `N`、template HTML の byte 数を `T`、静的 local resource 数を `R`、解析対象 CSS の合計 byte 数を `C`、AssetServer が実際に送信する合計 byte 数を `A`、探索対象 font directory entry 数を `F`、検査・decode する font byte 数を `G`、生成 PDF の byte 数を `P` とします。file 名や URL / path の長さは可変なので、sort は time ではなく比較回数も併記し、hash 計算で文字列長を定数とはみなしません。

- directory entry の列挙は `O(M)` entries、入力 file 名の byte 列 sort は `O(M log M)` comparisons、`O(M)` metadata とする。UTF-8 decode、pfpdf が所有する AST traversal、heading / URL 後処理、HTML serialize は `O(B + N + T)` time / memory とする。pinned GFM parser 自体は adversarial input で benchmark し、worst-case bound を実装の根拠なしに線形と断定しない。file の逐次 `string +=`、見出しごとの全文再走査、正規表現による HTML 再解析を禁止する
- resource discovery は canonical path の hash map と queue を使い、application-level では `O(B + T + C + R)` expected operations、`O(B + T + C + R)` memory にする。path canonicalization 自体の filesystem cost と可変長文字列の hash cost は別に計測する。CSS import cycle は visited set で停止する。AssetServer は合計 `O(A)` I/O と固定長 buffer memory で配信し、asset 全体を memory へ保持しない。range request による同じ byte の再送は browser の request に依存するため `A` に実送信 byte 数として数える
- heading / file link の解決は事前作成した map を使い、link 1 個ごとの全見出し・全 file 線形探索を避ける
- font discovery は各許可 directory を 1 回だけ走査し、各 directory の entry sort を合わせて最悪 `O(F log F)` comparisons、`O(F)` metadata とする。symlink directory は再帰 traversal しない。OpenType table の length / offset を file size と照合してから読み、font 内容の検査・必要な decode は `O(G)` time とする
- PDF の sibling 一時 file への copy と構造 parse は `O(P)` I/O / time とする。copy は固定長 buffer で行うが、PDF parser の memory は object / xref 構造に応じて最悪 `O(P)` になり得る。Vivliostyle / browser の layout 計算量は pfpdf の線形 bound に含めず、absolute deadline と実 PDF performance test で停止を制御する

trusted input であっても renderer の停止は起こり得るため、既定 300 秒、設定可能範囲 1 秒から 1 時間の deadline を設けます。入力 byte 数や resource 数の任意な小さい上限は設けませんが、配列長、byte length、file offset の加算は safe integer overflow を検査し、Node.js または OS の上限到達を部分成功へ変換しません。性能 test は入力を 2 倍にしたときの処理時間と peak memory が継続的に二次増加しないことを確認します。
