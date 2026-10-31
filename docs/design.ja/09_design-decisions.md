# 9. 設計判断の記録

この章は、複数の妥当な選択肢があった事項について、採用案・非採用案とそれぞれの理由、trade-off、再検討条件を記録します。判断が置き換えられた場合も過去の却下理由を消さず、status を superseded にして新しい判断へつなぎます。commit や issue だけを設計理由の唯一の記録場所にしません。

各判断は次の形式で記録します。

- status と決定日
- 解決する問題、制約、評価基準
- 検討した選択肢
- 採用案と採用理由
- 採用しなかった案と、それぞれを採用しなかった具体的な理由
- 採用案の欠点、運用上の結果、既知の risk
- 実装・test での検証方法
- 将来再検討する条件

## DD-01: Markdown parser に既存 GFM library を採用する

- status: Accepted(2026-08)
- 問題: Markdown 変換の実装方法。独自 parser の実装・保守は仕様網羅と保守コストの両面で高くつく
- 選択肢: (a) 独自 parser を実装する、(b) 保守されている GFM 対応 library を固定して利用する
- 採用: (b)。GFM Spec の conformance example で検証でき、pfpdf 固有機能(目次、数式、改ページ、日本語 strong)を明示的な extension として分離できる
- 非採用理由: (a) は GFM の全構文を自前で網羅する必要があり、仕様追従の負担が大きい。部分実装は「書けるはずの記法が変換されない」利用者体験を生む
- risk: parser library の保守停止。version 固定と conformance suite により、乗り換え時の挙動差を検出できるようにする
- 検証: `GfmAdapter` に対する pinned GFM conformance suite
- 再検討条件: 採用 library の保守停止、または conformance を満たせない不具合の長期未修正

## DD-02: 日本語 strong は delimiter 層の extension で対応する

- status: Accepted(2026-08)
- 問題: CommonMark の flanking rule では `これは**「重要」**です` のような全角約物を含む strong が認識されない
- 選択肢: (a) parse 後の正規表現 / HTML 置換で補正する、(b) parser の delimiter 層で CJK-friendly extension を使う、(c) 仕様どおりとして対応しない
- 採用: (b)。code span、raw HTML、link destination を壊さずに、token 単位で正しく判定できる
- 非採用理由: (a) は code block や raw HTML 内の `**` を誤変換する危険が高く、文脈を再解析することになる。(c) は日本語文書で頻出する自然な記法を書けないままにする
- risk: extension の保守状況に依存する。標準機能または既存 extension で満たせない場合だけ同等の delimiter rule を最小実装する
- 検証: 変換対象・非対象を網羅する fixture(07 章)
- 再検討条件: CommonMark 本体が CJK flanking rule を改善した場合

## DD-03: raw HTML は tag filter を適用せず passthrough する

- status: Accepted(2026-08)
- 問題: GFM の「Disallowed Raw HTML」tag filter を適用するか
- 選択肢: (a) GitHub.com と同様に filter する、(b) trusted input として保持する
- 採用: (b)。pfpdf は信頼済みローカル文書向けの build tool であり、`style` / `script` を含む raw HTML はレイアウトの自由度に必要
- 非採用理由: (a) は信頼できない入力を安全にする効果が sandbox なしでは不完全なまま、正当な表現手段を奪う
- risk: 信頼できない文書を処理すると任意 script が実行される。trust model を README と `SECURITY.md` に明記する(08 章)
- 検証: raw HTML 保持の fixture と、conformance suite 上の expected deviation として記録
- 再検討条件: 信頼できない入力の処理を正式サポートする場合(その際は sandbox 設計が前提)

## DD-04: loopback `AssetServer` を security boundary としない

- status: Superseded by DD-11(2026-08)
- 問題: Vivliostyle CLI が URL input を必要とする場合の local resource 配信方法
- 選択肢: (a) exact-file map、build token、origin allowlist を持つ厳密な server、(b) trusted input 前提の単純な静的 file server
- 当初採用: (b)。trust model 上、入力は信頼済みであり、(a) の機構は防御効果に対して複雑さと故障点が大きいと判断した
- 非採用理由: (a) は raw HTML が任意の local file を参照できるという前提と矛盾し、安全性の錯覚を与える
- risk: `AssetServer` を多用途に流用される可能性。design と `SECURITY.md` で boundary ではないことを明示する
- 検証: 静的配信、CORS、port close の integration test
- 置換理由: `..` / absolute path / nested CSS を正しく解決するには静的 resource の対応表が必要だった。また wildcard CORS の単純 server は、別の local web page からの偶発的な file 読取り範囲を不必要に広げる。sandbox を提供しなくても exact-file map と random token には correctness と defense-in-depth の価値がある

## DD-05: browser 管理は Vivliostyle CLI へ委譲する

- status: Accepted(2026-08)
- 問題: PDF 描画に使う Chromium の取得・cache 管理
- 選択肢: (a) pfpdf が独自に browser を download・管理する、(b) pinned Vivliostyle CLI と Puppeteer 系 browser manager の標準機構に任せる
- 採用: (b)。download の integrity、cache layout、platform 差分は upstream が既に解決しており、重複実装は保守負担と不整合の源になる
- 非採用理由: (a) は cache lock、partial download recovery、prune まで自前で持つことになり、upstream の変更に追従し続ける必要がある
- risk: upstream の browser 方針変更に影響を受ける。`--browser-path` の明示 override を逃げ道として提供する
- 検証: browser なし初回実行と明示 browser path の integration test
- 再検討条件: upstream の browser 管理が pfpdf の要件を満たさなくなった場合

## DD-06: renderer は単一の描画経路にする

- status: Accepted(2026-08)
- 問題: 複数の renderer backend と利用者向け選択設定は、実行経路、診断、cleanup、test matrix を増やし、同じ入力に対する挙動差を生み得る
- 選択肢: (a) 複数 backend と明示的な切替を維持する、(b) 単一の Vivliostyle 描画経路に限定する
- 採用: (b)。`AssetServer` と Vivliostyle CLI の child process に描画経路を限定し、設定・診断・失敗分類を一意にする
- 非採用理由: (a) は利用されない backend にも配布、互換性、timeout、cleanup の保守を要求し、品質保証を分散させる
- risk: 特定環境で browser を起動できない場合に別 backend へ切り替えられない。`--doctor`、明示 browser path、対応環境の検証で診断と移行を支援する
- 検証: 公開 CLI に renderer 選択がなく、integration test が実際の単一経路を通ることを確認する
- 再検討条件: 別の描画 engine が独立した利用価値と保守可能な互換性 contract を持つ場合

## DD-07: 設定はfront matterとCLI引数に限定し、CLIが常に優先

- status: Accepted(2026-08)
- 問題: 設定 source の種類と優先順位
- 選択肢: (a) project config file を導入する、(b) PFPDF固有の環境変数を使う、(c) 文書設定をfront matter、実行設定をCLIへ置く
- 採用: (c)。config file は探索順序・merge 規則・相対 path 基準という新たな仕様を生み、環境変数はversion管理されず「どの設定が効いたか」の診断を難しくする。文書設定の優先順はdefault、front matter、CLIとし、繰り返し実行設定はMakefileやCI workflowにCLI引数として記録する。再現可能buildの標準入力`SOURCE_DATE_EPOCH`と一般的なprocess environmentは対象外とする
- 非採用理由: (a) は別形式のproject設定を増やす。(b) は文書の意図をMarkdownから分離し、CLI reset optionと設定元の組合せを増やす
- risk: 実行設定では長い引数列が必要になる場合がある。wrapper scriptで緩和する
- 検証: default / front matter / CLI優先順位、CLI-only設定、effective config sourceのunit test
- 再検討条件: 実行設定項目が大幅に増え、CLIで管理困難になった場合

## DD-08: 生成 HTML を公開出力形式にしない

- status: Accepted(2026-08)
- 問題: HTML を PDF と並ぶ出力形式として公開するか
- 選択肢: (a) 単一 file HTML 出力を提供する、(b) HTML は renderer 入力とテスト専用にする
- 採用: (b)。単一 file 化には asset の再帰的埋込み、data URL 化、font subset が必要で、PDF 生成という主目的に対して複雑さが大きい
- 非採用理由: (a) は resource graph の完全な追跡を要求し、raw HTML 内の動的参照と原理的に両立しない
- risk: HTML 出力を求める利用者の要望。renderer が消費する `document.html` と同一の builder 出力をテストから検査可能にすることで、内部形式としての品質は保証する
- 検証: builder 出力と Vivliostyle 入力の同一性を検査する integration test
- 再検討条件: `v0.2.0` 以降で単一 file HTML の需要と実装コストを再評価する場合

## DD-09: 日本語文書を正典、英語文書を翻訳とする

- status: Accepted(2026-08)
- 問題: design / tutorial の多言語管理
- 選択肢: (a) 英語のみ、(b) 英語正典 + 日本語訳、(c) 日本語正典 + 英語訳
- 採用: (c)。主要な読者・執筆者が日本語話者であり、日本語 typesetting(全角約物の strong、日本語 font)が pfpdf の中核機能であるため、正確さを保ちやすい言語を正とする
- 非採用理由: (a) は主要利用者の可読性を損なう。(b) は日本語固有の仕様(約物、日付書式)を英語で先に規定する不自然さがある
- risk: 英語話者 contributor には翻訳が二次情報になる。file 対応検査と同一 pull request での同時更新を CI で強制し、乖離を防ぐ
- 検証: `check-doc-translations.mjs` と docs build の CI
- 再検討条件: contributor の言語構成が大きく変わった場合

## DD-10: エラーは fail-fast とし部分出力を成功にしない

- status: Accepted(2026-08)
- 問題: 複数 Markdown の一部が変換エラーになった場合の挙動
- 選択肢: (a) エラーの file を読み飛ばして続行する、(b) 文書全体を失敗させ非 0 を返す
- 採用: (b)。読み飛ばしは欠落した PDF が成功として配布される事故を生み、CI でも検出できない
- 非採用理由: (a) は一見親切だが、終了 code `0` のまま内容が欠ける方が実害が大きい
- risk: 大きな文書で 1 か所の誤りが全体を止める。エラー位置の明確な診断で緩和する
- 検証: 全エラー経路が非 0 を返す unit / integration test
- 再検討条件: なし

## DD-11: 静的 resource graph と token 付き exact-file server を使う

- status: Superseded by DD-18(2026-08)
- 問題: Markdown、raw HTML、nested CSS から参照される local asset を正しい基準 path で解決しつつ、renderer へ同じ `document.html` を渡す必要がある
- 選択肢: (a) input directory 全体や filesystem root を配信する、(b) asset をすべて data URL として HTML に埋め込む、(c) 静的参照を parser 上で graph 化し logical URL へ書き換える
- 採用: (c)。renderer 固有 path を HTML から除去でき、配信を必要な resource に限定でき、CSS import cycle も明示的に扱える。server は random path token と exact-file map を使い、browser と同じ host の loopback interface に起動する
- 非採用理由: (a) は absolute path を扱うために過度に広い配信を招き、path collision と platform 差も残る。(b) は大きな font / image の memory 使用を増やし、単一 HTML 出力を非目標とする方針にも反する
- risk: HTML / CSS の静的 URL 抽出が新しい複雑さになる。script が動的に生成する local path は対象にできず、renderer での解決を保証しない。asset 内容の build 中 snapshot も行わない。専用 parser、visited set、manifest fixture で緩和する
- 検証: nested `@import`、`url()`、`srcset`、absolute / `..` / symlink、循環、logical URL、token / traversal / range の integration test。同じ HTML byte 列を server から配信することも検査する
- 再検討条件: upstream renderer が renderer-neutral な resource protocol を提供し、独自 graph を安全に削除できる場合

## DD-12: 複数 Markdown は file ごとに独立 parse して AST を結合する

- status: Accepted(2026-08)
- 問題: source 文字列を単純連結すると、未閉鎖 fence、HTML block、list、setext heading、reference definition が file 境界を越えて構文を変える
- 選択肢: (a) separator を挟んで文字列連結してから 1 回 parse する、(b) 各 file を独立 parse して AST block の配列を結合する
- 採用: (b)。file 単体の構文と directory input の構文が一致し、境界条件を局所化できる
- 非採用理由: (a) はどの separator を選んでも未閉鎖 block の全種類を安全に閉じられず、source file の末尾次第で次章の意味が変わる
- risk: reference definition など parser state が file 間で共有されない。これを仕様として明記し、共通 link は通常の inline link を使う
- 検証: fence、HTML、list、setext、reference definition の file-boundary fixture
- 再検討条件: file 間で parser state を共有する明確な利用要求が生じ、曖昧さのない boundary syntax を追加する場合

## DD-13: custom template は DOM slot で組み立てる

- status: Accepted(2026-08)
- 問題: metadata、本文、目次、logo を custom HTML へ安全かつ曖昧なく挿入する contract が必要
- 選択肢: (a) `{{...}}` の文字列置換、(b) 汎用 template engine、(c) `data-pfpdf-slot` を持つ inert DOM を parse して node を挿入する
- 採用: (c)。text / node の context を固定でき、metadata が attribute や CSS へ意図せず入る経路を作らずに済む
- 非採用理由: (a) は context ごとの escape を template author に委ね、重複・欠落 placeholder も見逃しやすい。(b) は任意式、helper、versioning という不要な API と依存を増やす
- risk: 高度な custom layout の自由度は汎用 engine より低い。raw HTML / script / CSS と optional slot で補い、互換性が必要な利用者には pfpdf version 固定を求める
- 検証: 必須・重複・未知 slot、metadata escape、logo / TOC 省略、script readiness の unit / integration test
- 再検討条件: DOM slot では表現できない複数の実用 template が確認された場合

## DD-14: finite deadline と検証後の atomic output commit を必須にする

- status: Accepted(2026-08)
- 問題: script / browser の停止と、header だけを持つ切断 PDF が既存出力を破壊することを防ぐ
- 選択肢: (a) upstream process を無期限に待ち、`%PDF-` だけ検査する、(b) absolute deadline、構造認識型 PDF parse、flush、同一 directory の atomic replace を組み合わせる
- 採用: (b)。CI の永久停止を防ぎ、header / EOF だけを持つ壊れた PDF を除外し、失敗時に既存出力を維持できる。deadline は既定 300 秒、1 秒から 1 時間の範囲で変更できる。pagination 前 hook が上流にない場合は load gate と loopback 完了 signal を使い、その方法を pinned renderer で実証できることを release 条件とする
- 非採用理由: (a) は trusted input でも無限 loop、browser bug、切断 write に弱く、fail-fast の契約を満たさない
- risk: 非常に大きい正当な文書では PDF parse の time / memory も増え、既定 timeout を超える。明示 override と phase / elapsed time の診断を提供する。構造 parse でも text / visual の意味までは保証できないため CI で独立した `pdfinfo` / `pdftotext` / `pdffonts` を併用する
- 検証: readiness gate 前の pagination 禁止、readiness hang、child hang、source / copy byte 数不一致、copy 後の truncated trailer、flush / rename failure、中断、既存出力保持の fault-injection test
- 再検討条件: 実測により既定値が不適切と判明した場合。無期限待機へ戻す理由にはしない

## DD-15: front matter は制限した YAML 1.2 mapping とする

- status: Superseded by DD-18(2026-08)
- 問題: YAML の暗黙型、任意 tag、alias graph、merge key は少数の scalar metadata を読む用途に対して複雑で、型の不一致や resource 増幅を生む
- 選択肢: (a) parser の既定 schema で YAML 全機能を許可する、(b) front matter を JSON だけにする、(c) YAML 1.2 の JSON schema 相当へ制限し、tag / anchor / alias / merge を拒否する
- 採用: (c)。64 KiB 以下の flat mapping と scalar に限定し、一般的な `key: value` の可読性を保ちながら、date の暗黙 object 化、深い nesting、alias 展開を避けられる
- 非採用理由: (a) は入力型と計算量を必要以上に広げる。(b) は既存の Markdown front matter として冗長で、利用者の期待から外れる
- risk: YAML の高度な機能を使う front matter は移行できない。許可 key が少数の scalar だけであるため、値を書き直す案内で対応する
- 検証: 64 KiB 境界、scalar 型、nested value、duplicate / unknown key、tag、anchor / alias、merge、multi-document、prototype key、巨大 alias chain の test
- 再検討条件: metadata model が入れ子構造を必要とするほど拡張された場合

## DD-16: 文書言語と Unicode 正規化を build 入力として固定する

- status: Superseded in part by DD-18(2026-08)
- 問題: host locale / ICU に language、filename collision、heading slug を委ねると、同じ source でも OS や runtime update により HTML の `lang`、anchor、内部 link、日付表記が変わり得る
- 選択肢: (a) host locale と built-in `Intl` / Unicode data をそのまま使う、(b) `lang` metadata と version 固定した Unicode / language subtag data を使う
- 採用: (b)。`lang` の既定を `ja`、`dir` の既定を `auto` として HTML root へ反映し、NFC、case folding、default lowercase、BCP 47 canonicalization を release 内の固定 data で処理する。text direction を host locale から推測せず、自動日付と label も primary language に基づく固定書式として host formatter を使わない
- 非採用理由: (a) は暗黙の machine 設定を新たな configuration source にし、内部 link の互換性と再現性を損なう
- risk: Unicode / language data の更新で、従来衝突しなかった filename や既存 slug が変わる可能性がある。data version を第三者一覧へ記録し、更新を仕様差分として review する
- 検証: 4 環境での BCP 47、NFC / case folding、Unicode heading slug、ja / non-ja の date / label、LTR / RTL / vertical writing fixture
- 再検討条件: Node.js と全対応環境が同一 version の data を互換性契約として提供し、独自固定を削除できる場合

## DD-17: 公開 CLI は publishable shrinkwrap で transitive dependency を固定する

- status: Accepted(2026-08)
- 問題: repository の `package-lock.json` は npm tarball に公開されず、`npx` 利用者の nested install では無視されるため、それだけでは release 時に検証した transitive dependency tree を再現できない
- 選択肢: (a) direct dependency の semver range と利用者側の解決に任せる、(b) 全 dependency を bundle する、(c) direct runtime version を exact にし、review 済み source lockfile から公開用 `npm-shrinkwrap.json` を生成する
- 採用: (c)。npm が CLI tool 向けに提供する [publishable lockfile](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json#package-lockjson-vs-npm-shrinkwrapjson) を使い、platform optional dependency を含む install tree を 4 環境で検証する
- 非採用理由: (a) は同じ pfpdf version の挙動が publish 後に変わる。(b) は package size、native / platform package、license 管理を不必要に複雑にする
- risk: transitive security fix も自動では入らず、lock update と patch release が必要になる。source lockfile と staging shrinkwrap の機械比較、dependency review、定期 update で対応する
- 検証: tarball file list、shrinkwrap / source lock tree 一致、空 project での install と `npm ls`、4 環境の packed-package PDF smoke test
- 再検討条件: npm の publish / install semantics が変わるか、別の配布形式で同等の完全 tree 固定を提供する場合

## DD-18: trusted input を前提に security 専用機構を持たない

- status: Accepted(2026-08)
- 問題: pfpdf は raw HTML と script を許可する trusted-document build tool である一方、loopback token、CORS、接続制限、diagnostic redaction、child environment allowlist、独自 YAML / BCP 47 parser を実装していた。これらは不完全な security boundary を形成し、利用可能な入力と実行環境を狭め、保守対象を増やしていた
- 選択肢: (a) defense-in-depth として各機構を維持する、(b) correctness に必要な validation だけを残し、security 専用機構と標準機能の重複実装を削除する
- 採用: (b)。AssetServer は loopback bind と resource graph による URL 解決を維持するが、token や CORS policy を持たない。renderer child は通常の process environment を継承し、診断は改変せず出力する。front matter は `js-yaml` の JSON schema で mapping として読み、利用する metadata field の型だけを検査する。language tag は Node.js の `Intl.getCanonicalLocales` で検査・正規化する。raw HTML / template の禁止要素、予約属性、ID・navigation link の整合性検査、module / nested document の禁止、異 OS 向け filename collision と独自 page-size 上限も持たない
- 非採用理由: (a) は trusted script が同一 origin の全 resource を読める時点で confidentiality を提供せず、security boundary ではない機構を security feature のように見せる。独自 parser と allowlist は妥当な文書・環境を拒否する互換性問題も生む
- risk: renderer の diagnostic には入力由来の control character や URL credential が現れ得て、child process は呼出元の環境変数を参照できる。trusted document と通常の local CLI process という前提を利用者へ明示する

## DD-19: readiness は実際に描画する非同期処理だけを一度待つ

- status: Accepted(2026-08)
- 問題: pagination前の品質保証としてfont、image、利用者promiseの完了待ちは必要だが、manifest全件の事前`fetch`、実際のbrowser load、成功・失敗別endpoint、API改変検出が同じ故障を複数経路で扱っていた
- 選択肢: (a) 全経路を維持する、(b) readiness自体を削除してrendererに任せる、(c) 実際に描画するfont / local image / 登録promiseとbrowserのresource errorだけを待ち、gateを単一完了通知で解放する
- 採用: (c)。`document.fonts.ready`とimage `decode()`はpagination品質へ直接必要であり、登録promiseは利用者scriptの明示contractとして必要である。一方、manifest全件fetchはbrowserが利用しないresourceまで読み、実際のload / decodeを置き換えず二重I/Oになる。成功・失敗は1つのendpointの結果で表現できる
- 非採用理由: (a) は同じassetを事前fetchとbrowser loadで二度読み、endpointとbrowser stateを増やす。(b) はfontやimage decode前にpaginationを開始するraceと、利用者promise rejectionを成功扱いする問題を戻す
- trusted inputとの関係: `window.pfpdf`をnon-configurableにする処理と改変検出はsecurity専用の防御であり削除する。利用者scriptが登録APIを上書きすればそのscript自身のcontract違反であり、別の改変監視状態は持たない
- risk: 動的に生成され、DOM image / font / static resource load / 登録promiseのいずれにも現れない非同期処理は自動検出できない。paginationに影響する利用者処理は`registerReady`へ登録する
- 検証: fontとlocal SVGを含むbrowser smoke、登録promise rejectionのbrowser E2E、resource MIME / load failure、通知失敗、timeout、gate解放、child abort、既存出力保持のtest
- 再検討条件: Vivliostyleがpagination前の正式なasync hookを提供し、gate resourceとloopback通知を同等の失敗診断付きで置換できる場合
- 検証: local resource、byte range、readiness、YAML metadata type、language tag、renderer 起動の test を維持する。security mechanism 自体の test は削除する
- 再検討条件: 不特定利用者の文書を処理する service mode を正式に追加する場合。その場合は個別の filter ではなく process / filesystem / network を含む sandbox を別設計する

## DD-20: 公開文書と template preview の build を分離する

- status: Accepted(2026-08)
- 問題: bundled template をすべて実 renderer で継続的に検査したい一方、企業向けの `pfn` template で生成した PDF を公開 release の標準文書として配布したくない。単一の出力 directory では同名 PDF の上書きや release asset への混入が起き得る
- 選択肢: (a) `TEMPLATE` 変数で同じ出力を上書きする、(b) 公開用と template 別 preview の target・出力 tree・CI artifact を分離する、(c) `default` だけを PDF build して他 template は HTML unit test だけにする
- 採用: (b)。`docs-release` は `default` を明示して `build/docs/release/` に生成し、`docs-template-<name>` と `docs-templates` は共通sampleを `build/docs/templates/<name>/` に生成する。sampleは5ページ以上とし、独立した表紙を省き目次と本文をfirst pageから始める `compact` だけは4ページ以上とする。template固有のページネーションを不自然に圧縮しないためページ数に上限は設けない。sampleは原則2ページ以上の目次と長い表・codeを含めて主要機能を網羅するが、`compact` は2段組み目次をfirst page内に収め、省スペース性自体を検査する。bundled template の正本は package resource の manifest とし、Make と CLI が共有する
- 非採用理由: (a) は build 順序により成果物の意味が変わり、広い glob を使う release workflow で誤添付を防ぎにくい。(c) は CSS、font、pagination を含む実 renderer の回帰を検出できない
- risk: `default` 文書は公開用と preview の両方で描画され、全 template build の時間が増える。用途を明示した独立 target により、release だけが必要な場合は preview build を省略できる
- 検証: manifest と template directory の一致を unit test し、CI で `docs-release docs-templates docs-template-images` を実行する。画像化時にPDFが5ページ以上で目次が2ページに継続することを検査し、`compact` は例外として4ページ以上でfirst pageに目次と本文の双方があることを検査する。ページ数の上限は検査しない。全ページを連番PNG artifactにし、公開 artifact は `build/docs/release/*.pdf` の明示 path、previewは別artifactとする
- 再検討条件: template 数または文書量の増加により全ページ画像化が CI budget を超える場合。その場合も公開出力との分離と定期的な全ページreviewは維持し、pull requestごとの実行範囲を再検討する

## DD-21: カジュアルな bundled template は用途を限定しない notebook とする

- status: Accepted(2026-08)
- 問題: 旅のしおり程度に親しみやすい文書を作れる bundled template が必要だが、特定用途やブランドへ限定すると再利用しにくく、色だけを変えた template は保守コストに見合う差を提供しない
- 選択肢: (a) 旅行 motif と固有語を持つ `travel`、(b) 既存 template の配色 variant、(c) ノート、計画表、イベント案内、小冊子に共通して使える `notebook`
- 採用: (c)。暖色と青緑の色面、丸みのある目次・引用・表・task list により、固定の用途名を追加せずにカジュアルな紙面を提供する。logo や用途固有 asset は同梱しない
- 非採用理由: (a) は旅行以外の利用時に文脈が不自然になる。(b) は `default` と用途・組版上の選択基準がなく、preview と回帰 test の対象だけを増やす
- risk: 多色の面は monochrome 印刷で差が弱くなる。見出しの大きさ、罫線、背景、形状も併用し、色だけに情報を持たせない
- 検証: 共通 template preview で表紙、複数ページの目次、見出し、task list、引用、表、code、数式、running header、page number を確認する。template slot の展開は unit test で検査する
- 再検討条件: 利用実績から、旅行やイベントなどの用途固有 component を template contract として提供する必要が生じた場合

## DD-22: 長文向け bundled template は既存フォントで組版を差別化する

- status: Accepted(2026-08)
- 問題: tutorial、教科書、長文 manual を章単位で読み進めるための bundled template が必要だが、色だけの variant や未検証の追加 font は保守・配布コストを増やす
- 選択肢: (a) `default` の配色だけを変える、(b) Noto Sans JP のまま版面だけを変える、(c) 検証済みで同梱済みの Noto Serif JP を本文・表題に使い、表と code は Noto Sans JP 系を維持する
- 採用: (c)。章見出しを改ページし、本文幅と行間を長文向けに調整し、抑制した暖色と running header、中央の page number で書籍的な読み順を示す。本文・表題は Noto Serif JP、密な表は Noto Sans JP、code は Noto Sans Mono とし、logo や用途固有 asset は同梱しない
- 非採用理由: (a) は `default` と用途・組版上の差が小さい。(b) は一般的な和文書籍との書体上の差が弱い。Noto Serif JP は `academic` のために既に固定・同梱・license確認済みであり、新たな配布依存を増やさない
- risk: serif化により字幅、改行、ページ数が変化し得る。表は密度を維持するためsans-serifのままとし、共通previewと公開文書のPDF smoke testでページネーションを確認する
- 検証: 共通 template preview で表紙、複数ページの目次、章ごとの改ページ、長文、表、code、数式、running header、page number と書体の使い分けを確認する。template slot の展開は unit test で検査する
- 再検討条件: serif本文の可読性またはページ増加が実文書で問題になる場合、あるいは章 metadata を template contract として追加する場合

## DD-23: 研究報告向け bundled template は再現性と汎用性を優先する

- status: Accepted(2026-08)
- 問題: 論文や研究報告に適した bundled template が必要だが、特定学会の投稿規程を模倣すると用途が限定される。一方、sans-serif 本文だけでは一般的な和文論文との視覚的な差が弱い
- 選択肢: (a) 特定学会の paper format を再現する、(b) Noto Sans JP のまま版面だけを変える、(c) SIL OFL 1.1 の Noto Serif JP を固定・同梱し、明朝本文、ゴシック見出し、抑制した表紙、連続した節構成、表、数式、図注、abstract、keywords、references の組版を提供する `academic` を追加する
- 採用: (c)。特定の投稿先を名乗らず、研究報告、white paper、調査報告に共通する視覚的階層を提供する。本文は Noto Serif JP、見出しと表は Noto Sans JP とし、OS font に依存しない。`abstract`、`keywords`、`references` は raw HTML の class として見た目だけを提供し、固定labelや図表番号を補わず、通常の Markdown だけでも破綻しない
- 非採用理由: (a) は投稿先ごとの厳密な page size、段組み、citation 規則を保証できず誤解を招く。(b) は `default` や `book` と書体上の差が小さく、論文向けという選択基準が弱い
- risk: Noto Serif JP の追加により package と PDF の容量が増える。また一般的な学術誌の二段組みとは異なる。font version と checksum を lockfile に固定し、投稿規程への適合をうたわず、厳密な指定がある場合は custom template を使う
- 検証: 共通 template preview で Noto Serif JP の埋め込み、表紙、目次、長文、表、code、数式、figure と figcaption、running header、page number を確認する。template slot と abstract の展開は unit test で検査する
- 再検討条件: citation、著者所属、抄録、figure/table caption などを first-class metadata として template contract に追加する場合、または特定の投稿規程に対応する場合

## DD-24: 短い資料向け bundled template は独立した表紙を省く

- status: Accepted(2026-08)
- 問題: 会議資料、社内メモ、短い report では `default` の独立した表紙と広い余白が本文より多くの page を消費し得るが、単に文字を小さくすると可読性を損ない、`technical` は code-first という用途上の意味が強い
- 選択肢: (a) `default` の配色だけを変える、(b) 二段組みの本文で最大限に詰める、(c) 独立した表紙を持たず、metadata header、2段組み目次、狭い page margin、密な表と code を組み合わせる `compact` を追加する
- 採用: (c)。title、author、date、confidential、任意 logo は first page 上部の小さな header に集約し、目次と本文を同じ page から開始できるようにする。本文は一段組みを維持し、一般的な Markdown の表、code、画像が狭い column に押し込まれないようにする。本文は9.5ptを下限とし、色への依存を抑え、罫線、太さ、背景差で白黒印刷でも階層を区別する
- 非採用理由: (a) は page 数を減らさず `default` との選択基準がない。(b) は長い表、code、URL、画像の利用可能幅を半減させ、汎用 template として破綻しやすい
- risk: 9.5pt の本文と狭い margin は長時間読む文書や製本には適さず、目次の2段組みは深い階層や長い見出しで窮屈になり得る。その場合は `default` または `book` を使い、`compact` は短い配布資料に限定する
- 検証: unit test で metadata slot、目次、本文、logo contract と、header に強制改ページがないことを確認する。共通 template preview は4ページ以上とし、ページ数に上限を設けない。first pageに2段組み目次と本文が共存すること、および長い表、code、URL、画像、深い目次、白黒相当の階層、running header、page number を確認する
- 再検討条件: 実文書で9.5ptの本文または2段組み目次の可読性が不足する場合、あるいは表紙省略を template ではなく共通 CLI option として求める利用例が増えた場合

## DD-25: bundled template の文字情報は利用者指定のseriesへ限定する

- status: Accepted(2026-08)
- 問題: template 固有の出版名、文書種別、ブランド名、目次名、metadata 接頭辞、callout 名、図表番号は、利用者の文書と無関係な意味を最終PDFへ付加し得る。template ごとに置換方法が異なると同じ文書を別のtemplateで描画できない
- 選択肢: (a) 固定文字列をデザインの一部として維持する、(b) 文字列ごとに個別metadataを追加する、(c) 全bundled templateが任意の`series`を受け取り、それ以外の固定文字情報を追加しない
- 採用: (c)。`series`は任意のplain text metadataとし、全bundled templateの主要ラベル位置へ表示する。未指定時はslot elementを削除する。同一pageに固定ラベル位置が複数あったtemplateでは主要位置だけをseriesへ転用し、補助位置は削除する。柱への反復は同じDOM slotを増やさずCSS named stringを使う
- 非採用理由: (a) は文書に存在しない所属や用途を示す。(b) はtemplateの装飾ごとにmetadata contractを増やし、template切替時の可搬性を損なう
- risk: abstract、keywords、note、図表番号など、従来templateが補っていたlabelは自動表示されない。目次名と目次継続表示だけは文書構造を示す renderer の UI として文書言語から生成する。その他の文字情報はMarkdownまたはraw HTMLへ利用者が明示し、PDFへ伝える情報を入力文書だけから判断できる状態を優先する
- 検証: unit testでseriesの型、全bundled templateでの挿入と未指定時の削除、固定文字列の不在、named stringの参照を確認する。共通previewにseriesを明示し、全PDFと全page画像を再生成して配置を目視する
- 再検討条件: 利用者入力に基づく汎用caption numberingやlocalizationをtemplate外の文書変換機能として設計する場合

## DD-26: 複数ページ目次の継続表示は localized named string とする

- status: Accepted(2026-08)
- 問題: 目次が複数ページに分割されると、2ページ目以降は文脈のないリンク一覧に見える。一方、各templateのCSSへ固定の日本語を記述すると文書言語と一致せず、custom templateへ新しい必須slotを加えると既存contractを不必要に広げる
- 選択肢: (a) 継続表示を行わない、(b) 各templateのCSS generated contentへ固定labelを書く、(c) builderが文書言語に応じた継続labelを目次内のmarkerへ挿入し、CSS named stringとして各templateの空いているmargin boxから参照する
- 採用: (c)。`.pfpdf-toc-continuation-marker` が `pfpdf-toc-continuation` named stringを設定し、各bundled templateは `first-except` により最初の目次ページを除くページだけに表示する。本文先頭の空markerでstringを解除する。これは既存の`toc`内容に対するstyling hookであり、DOM slotは追加しない
- 非採用理由: (a) はページ単体で目次の続きと識別できない。(b) はlocalizationをtemplateごとに重複させ、入力言語と異なるlabelを出力し得る。running elementは既存の柱と同じmargin boxを占有しやすく、空の専用margin boxをtemplateごとに選べるnamed stringを採用する
- risk: paged media rendererのnamed stringと`first-except`の実装に依存する。また長い翻訳labelは柱へ収まらない可能性があるため、labelは短い構造名に限定し、追加言語を導入する際は全templateのPDFを確認する
- 検証: unit testでja / non-jaのlabel、marker、reset、全bundled templateの`first-except`参照を検査する。共通previewの目次を2ページ以上にし、画像生成時にpage 2の目次見出し、page 3の継続label、page 4のlabel解除をPDF textから検査する。`compact`は目次と本文をfirst pageに共存させる例外を維持する
- 再検討条件: rendererがfragmentごとの繰返し見出しをHTML要素として標準的に提供する場合、または目次以外にも同じlocalized continuation contractが必要になった場合

## DD-27: 長い表示文字列へ HAST 上で `wbr` を挿入する

- status: Accepted(2026-08)
- 問題: URL、メールアドレス、長い識別子が page 幅や狭い table cell の最小内容幅を超える。CSS の `overflow-wrap` だけでは意味のある区切りを優先できず、templateごとのlayout差も大きい
- 選択肢: (a) 全templateで`overflow-wrap: anywhere`だけを使う、(b) Markdown sourceへzero-width spaceまたはsoft hyphenを挿入する、(c) serialize後のHTML文字列を置換する、(d) HASTの可視textへ`wbr` elementを挿入する
- 採用: (d)。grapheme境界、URL・識別子の意味境界、除外context、inline elementをまたぐrunをDOM構造上で判定できる。`wbr`は表示上の改行候補であり、元のtext content、copy結果、link destination、attributeを変えない
- 非採用理由: (a) はoverflowを防げても意味境界を優先できない。(b) はcode、link destination、source位置、copy結果を変え得る。(c) はtextとattributeを安全に区別できず、escapeとraw HTMLを壊し得る
- pipeline: 見出しID、目次、resource URL、table decoration、MathJax、syntax highlightの後、source sectionの最終passとして適用する。rendererが消費する`document.html`へ含め、test専用pipelineは作らない
- accessibility / raw HTML: text自体は不変で、screen readerやcopyに不可視文字を追加しない。trusted raw HTMLの通常の可視textは対象だが、code、script、style、form value、SVG、MathJax、`contenteditable`は完全保存する
- risk: 候補が多いと不自然な短い行を作り得る。最大16、基本最小4、break数最小化、semantic priority、均等化をbounded DPで固定し、全templateのPDF画像と`pdftotext`で確認する
- 検証: 15 / 16 / 17 / 31 / 32 / 33 grapheme、Unicode cluster、URL構造、識別子、inline境界、属性保存、除外context、冪等性、長大runをunit / full-pipeline fixtureで検査する。共通previewを全bundled templateで描画し、抽出文字列とpage領域を確認する
- 再検討条件: HTML / CSS rendererが意味境界を同等に扱う標準機能を一貫して実装した場合、または実文書でthresholdやpriorityの変更が必要になった場合

## DD-28: Mermaid は server-side DOM で build-time SVG にする

- status: Accepted(2026-08)。text 測定、edge label、既定 layout は DD-43 で更新
- 問題: Mermaid fence を PDF の図として扱いながら、network 非依存、renderer と test で同じ静的 HTML、構文 error 時の fail-fast を満たす必要がある。Vivliostyle は frontend framework に SSR を要求し、source document で非同期生成した DOM は pagination 入力へ安定して反映されない
- 選択肢: (a) 利用者に画像の事前生成を求める、(b) CDN または同梱 browser script で描画する、(c) 別の headless browser process で build-time SVG を生成する、(d) 固定した Mermaid を server-side DOM adapter 上で実行しinline SVGを生成する、(e) (d)で生成したSVGをbuild workspaceの外部assetにして`img`から参照する、(f) SVG markerを独自実装で通常pathへ展開する
- 採用: (e)。renderer 開始前に SVG を HAST 上で検査・正規化し、`generated/mermaid-NNNN.svg`へserializeする。renderer と test が同じ生成assetを消費し、既存rendererとは別のbrowser processやCDNを必要としない。外部SVGはVivliostyleのpagination用DOMによるinline SVG marker参照の欠落を避け、vector、SVG内text、決定的IDを維持する
- 非採用理由: (a) は Mermaid 記法への対応にならない。(b) は offline version 固定または Vivliostyle の SSR 制約を満たさない。(c) は browser 取得、process、deadline、font 環境を二重化する。(d) は生成SVG単体とChrome直接PDFでは正常だが、Vivliostyle組版後だけ`marker-end`の矢印が消え、線端にgapを残す。(f) はpathの接線、markerのviewBox・refX・orient・markerUnitsを再実装し、Mermaidが出力する図種とmarkerの変更へ追従する必要がある。edge labelにはHTML labelへの切替、背景の固定量移動、`tspan` baseline補正、背景除去も検討したが、順に`foreignObject`依存、font size依存、複数行labelの行間破壊、Mermaid本来のlabel背景喪失を生じるため採用せず、edge label自体を未対応とする
- security / error: `securityLevel: strict`、HTML label 無効、error rendering 抑止を固定する。各図を直列描画し、source error へ file / line を付加して code `2` とする。同梱 runtime failure は code `1` とし、未描画 source や error diagram を成功 PDF に残さない
- risk: 軽量 DOM の text 測定結果は実 browserのMermaidと完全一致しない可能性がある。またSVGは独立documentになるため、外側documentのCSSを継承しない。Mermaidが必要なstyleとfont fallbackをSVG内へ固定し、Mermaid、adapter、DOM dependencyをlockfileに固定する。`img`にはMermaidのaccessible title / descriptionからaltを付け、存在しなければ一般labelを付ける
- 検証: fence変換、通常codeとの分離、deterministicなasset名とID、marker定義と参照、構文error、実browserとVivliostyle PDFでの矢印、SVG内text抽出、全templateのPDF smoke testを行う
- 再検討条件: Mermaid が Node DOM なしで同等の deterministic SVG API を公式提供する場合、または Vivliostyle が公式の document preprocess hook を提供する場合

## DD-29: academic template の表紙は二重罫 masthead 構成とする

- status: Accepted(2026-08)
- 問題: 従来の表紙は細い単罫と 24pt の title の組合せで要素間の階層が弱く、中央の余白が意図のない空白に見えた。series / confidential / logo / author はいずれも省略可能な metadata であり、どの組合せでも自然に見える骨格が必要
- 選択肢: (a) 上端に太罫 2.2pt + 細罫 0.6pt の二重罫 masthead を置き、下端にその鏡映(細罫 + 太罫)で author / date 行を挟む左揃え構成、(b) 表紙中央へ full-bleed の accent 色帯を置き title を白抜きで載せる構成、(c) 学位論文の扉のような左右対称・中央揃え構成
- 採用: (a)。学術誌の masthead に由来する構造で、series と logo は上罫の上、author と date は下罫の間に収まる。head は空でも高さを保持するため、metadata の有無で title 位置が動かず、全 metadata が省略されても罫線骨格が letterhead として自立する。title は 29pt / `text-wrap: balance` とし、役割が masthead と重複する短い accent 罫は削除する。装飾は CSS 罫線のみで、新しい asset・slot・font は追加しない
- 非採用理由: (b) は印字面積が大きく「抑制した表紙」という template の性格から外れ、企業報告書の印象が強い。(c) は `book` template の frame 付き中央構成と印象が近く、metadata が無い場合に骨格が消えて貧弱に見える
- risk: 二重罫は `.academic-cover-head` の `::after` で実現するため要素追加は不要だが、罫線間隔が固定 offset に依存する。`text-wrap: balance` は renderer が未対応でも単に無視され、折返し自体は `overflow-wrap` が保証する
- 検証: series / confidential の有無 4 通り、logo の有無、長 title(7 行)、英語 title で page 1 画像を目視確認し、template unit test で masthead と metadata 行の罫線指定を検査する
- 再検討条件: 表紙へ abstract など新しい metadata を表示する要件が生じた場合、または bundled template 全体の表紙言語を統一的に再設計する場合

## DD-30: BibTeX citation は TeX 風構文と build 時 CSL 処理を組み合わせる

- status: Accepted(2026-08)
- 問題: Markdown source から `.bib` を参照し、本文 citation、決定的な参考文献一覧、PDF 内部 link を生成したい。既存 GFM / HAST / Vivliostyle pipeline、単一/複数 file 入力、renderer と test の同一 HTML を維持する必要がある
- 選択肢: (a) 文献に `\ref{key}` を割り当て独自 formatter を書く、(b) Pandoc の `[@key]` と Pandoc process を追加する、(c) `\cite{key}` を pfpdf parser extension とし、Citation.js / citeproc-js を Node.js build 時に利用する、(d) browser script で `.bib` を処理する
- 採用: (c)。先頭 Markdown の `bibliography` metadata から `.bib` を一回読みし、全 source の citation cluster を一つの citeproc session で処理する。初期版は numeric style 1 種、`\cite{key1,key2}`、任意の `\printbibliography` marker を提供する。marker 省略時は文書末尾へ追加し、通常 heading を利用者が書くことで既存 ToC を再利用する
- 非採用理由: (a) の `\ref` は TeX では一般 label 参照で、将来の figure / table / equation / section と衝突し、独自 formatter は entry type と locale 規則を再実装する。(b) は既存 remark pipeline と出力差を作り、外部 executable を build に追加する。(d) は入力 error が renderer 起動後まで遅れ、asset / readiness 処理を増やす。Pandoc syntax は source portability に利点があるが、部分互換を名乗らず将来 alias として再評価する
- path: relative `.bib` は front matter source の親 directory 基準とする。absolute、`..`、symlink は既存 trusted-input 方針と同じく許可し、自動探索と後勝ちは採用しない。複数 file の重複 key は code `2` とする
- HTML: processor の entry 順を citation number の正本とし、entry HTML を HAST fragment に変換する。pfpdf が encoded ID、`doc-biblioref`、`doc-bibliography`、全引用位置への `doc-backlink` を付ける。template は共通 semantic DOM を装飾するだけで citation 規則を持たない
- risk: Citation.js / citeproc-js / CSL style の変換差、package size、BibLaTeX 非完全互換、英語 locale の label に依存する。version と license を lockし、日本語、Unicode、TeX accent、`@string`、crossref、DOI / URL の fixture と全 template PDF を維持する。custom CSL、locator、`\nocite` は別仕様とする
- 検証: input / parser / formatter / semantic HTML の unit test、bibliography error 時の既存 output 保持、共通 preview の全 template PDF / page image / link / `pdftotext`、renderer E2E を実行する
- 再検討条件: VFM が citation syntax を標準化した場合、Pandoc source portability の要求が増えた場合、または投稿規程向け custom CSL / locator / note style を first-class feature にする場合

## DD-31: pfn template の表紙背景と artwork は単一の vector SVG として生成する

- status: Accepted(2026-08)
- 問題: pfn template の表紙は full-bleed の blue gradient と中央の title 群のみで構成され、要素が少なく寂しい印象を与えていた。PFN の brand imagery(三角形 mesh 状の network と流線)を反映したいが、raster 画像は file size と画質の trade-off が生じるため避けたい。confidential / series / logo はいずれも省略可能な metadata であり、どの組合せでも自然に見える必要がある
- 選択肢: (a) brand 写真や既存 banner(raster)を表紙へ配置する、(b) CSS gradient の多層化や幾何学 border だけで飾る、(c) 背景 gradient、network mesh、流線を決定的に生成した単一の vector SVG とする
- 採用: (c)。`scripts/generate-pfn-cover-art.mjs` が seed 固定の乱数と Delaunay 三角形分割で `resources/templates/pfn/cover-art.svg` を生成し、`style.css`(screen の `header`)と `vivliostyle.css`(print の `header::before`)が参照する。artwork は `wovenAiryCanopy` とし、左上には最小距離付きの点群から生成した疎な network mesh を広く配置して線幅と不透明度を水平寄りに減衰させ、下部には接線連続の細い曲線を2系統交差させる。比較案は実装に残さず、script 冒頭の `DESIGN` で色、mesh、流線を調整し、`--preview` で正式案だけを別 directory に出力できる。中央の title 帯と Confidential badge 周辺は artwork の不透明度を抑えた calm zone とする
- color: logo の `#141c77`〜`#0293dd` と調和しながら表紙が暗い星空の印象にならないよう、背景は navy から鮮やかな blue へ抜ける `#111b64`〜`#19438f`〜`#1b75b4` の gradient とする。screen と print の fallback も同じ色と角度を使う。2 page 目以降の running header と本文見出しの基準色は緑味を抑えた `#263c7f` とし、下位見出しと罫線も同じ青紫系の濃淡で構成する
- 非採用理由: (a) は「画像は入れない」という template の方針と file size 要件に反し、拡縮で劣化する。(b) は gradient の変化だけでは brand の network motif を表現できず、寂しさの根本原因が残る
- risk: SVG を CSS background として参照しても Chromium の PDF 出力では vector のまま保持されることを実測した(pdfimages で raster ゼロ、共通 preview の PDF は +50KB 程度)。SVG は表示する背景 gradient を内包し、CSS の同色 gradient は読込み失敗時の fallback とする。SVG は 13mm の bleed を含む viewBox と `preserveAspectRatio: slice` を持ち、cover crop で端が欠けても破綻しない余白で設計する。生成 script は時刻や環境に依存せず、test で bundled SVG との完全一致を検証する
- 検証: confidential / series の有無 4 通り、logo の有無、長 title(3 行)で page 1 画像を目視確認し、`pdfimages -list` で raster 化がないことを確認する。template unit test で cover-art 層と badge 規則の共存を検査する
- 再検討条件: PFN が公式の vector brand asset を提供する場合、表紙へ新しい metadata 表示要件が生じる場合、または bundled template 全体の表紙言語を統一的に再設計する場合

## DD-32: 公式サイトの SSG には Astro を採用する

- status: Accepted(2026-08)
- 問題: GitHub Pages で公開する公式サイトは、自由 layout の landing page、`resources/templates/manifest.json` を情報源とする template gallery、`docs/tutorial.{ja,en}` を単一情報源のまま読む docs ページを 1 つの build で共存させる必要がある。root の `package.json` は npm 公開物なのでサイトの依存を混ぜられない
- 選択肢: (a) Astro、(b) Eleventy、(c) VitePress、(d) 自前 script 群
- 採用: (a)。static 出力で client JS が既定でゼロ、content collections の glob loader で repository 内の Markdown と JSON を copy なしで読め、file base routing で `/ja/` mirror を素直に表現できる。依存は `site/` の独立した `package.json` + lock に閉じる
- 非採用理由: (b) は i18n・画像最適化・asset pipeline が手組みになる。(c) は docs 特化で LP と gallery の自由度が低く Vue 依存が入る。(d) は依存最小だが工数と保守で不利
- risk: Astro の major update への追従が必要になる。サイトは独立 project なので本体の build・test・npm package には影響しない
- 検証: `site/` の build が既存 CI(lint / test / e2e)、`check-package-policy.mjs`、`check-doc-policy.mjs` に影響しないことを確認した
- 再検討条件: docs の章数や検索要件が増えて Starlight 等の docs theme が有利になる場合、または Astro の保守が停滞する場合

## DD-33: サイトは orphan commit の docs branch 配信とし、内部 link は相対 path に統一する

- status: Accepted(2026-08)
- 問題: 配信方式には GitHub Pages の branch 配信と actions/deploy-pages 方式がある。また repository は将来 `pfnet-research/pfpdf` へ移管予定で、custom domain 取得の可能性もあるため、org 名や base path を source に固定できない
- 選択肢: (a) actions/deploy-pages、(b) docs branch へ履歴を積む、(c) docs branch へ orphan 単一 commit を force push
- 採用: (c) + 相対 link 化。`.github/workflows/pages.yml` が main への push を契機に site を build し、orphan 単一 commit を docs branch へ force push する(生成物の履歴で repository を太らせない)。出力 root に `.nojekyll` を置く。HTML / CSS 内の内部 link は build 後処理(`site/scripts/relativize-links.mjs`)で各ページからの相対 path に変換し、canonical / hreflang / og:url / sitemap / 404 だけを `SITE_URL`(既定は `GITHUB_REPOSITORY` から導出)由来の絶対 URL とする。link の解決は `site/scripts/check-links.mjs` が build 毎に全 file を検査する
- 非採用理由: (a) は指定により不採用(将来の移行は容易)。(b) は生成物の履歴が repository を肥大させる
- risk: force push のため docs branch 上での手動変更は失われるが、docs branch は生成物であり手動変更しない運用とする
- 検証: 配信物一式を任意の subdirectory に置いても link・画像・CSS が壊れないことを build 時の link check で担保する。source と workflow に org 名が現れないことを grep で確認した
- custom domain 運用(2026-10-28): Repository の Settings → Secrets and variables → Actions → Variables で `SITE_URL` を公開先の HTTPS URL(末尾 `/` 付き)に設定する。workflow は `${{ vars.SITE_URL }}` を環境変数へ渡し、未設定なら従来どおり `GITHUB_REPOSITORY` から URL を導出する。site build の最後に同じ `SITE_URL` の hostname から `dist/CNAME` を生成し、URL の scheme や path は含めない。`github.io` 配信では `CNAME` を削除する。ドメインを source に固定したり、生成物の docs branch に手動追加したりしない
- custom domain の判断理由: GitHub の Pages 設定で追加された `CNAME` だけに依存すると、次の orphan commit の force push で消える。別のドメイン変数を導入すると canonical URL と配信ドメインが食い違う可能性があるため、`SITE_URL` に一本化する。導入時はこの変数を設定してから再デプロイし、必要なら Settings → Pages で custom domain を再保存する。変数を空に戻すと次のデプロイで custom domain は解除される
- 再検討条件: deploy-pages 方式へ移行する場合

## DD-34: gallery のページ表示は sample PDF から生成した WebP 画像を基本とする

- status: Accepted(2026-08)
- 問題: template gallery は各 template の sample PDF 全ページを Web で見せる必要がある。PDF をそのまま `<img>` で表示できれば file size を抑えられるが、PDF-in-img は WebKit / Safari 系のみの機能で、Chrome / Firefox では表示されない(2026-08 時点で確認)
- 選択肢: (a) 1 ページ分割 PDF の `<img>` 直接表示、(b) PDF.js による client 描画、(c) build 時に WebP 画像へ変換して配信する
- 採用: (c)。`scripts/build-site-assets.mjs` が `make docs-template-samples`(日本語)と `docs-template-samples-en`(英語)の成果物に対して `pdftoppm -r 180` で master を作り、sharp で thumbnail(幅 480px)と lightbox 用(幅 1500px)の 2 種の WebP を出力し、page 数などの metadata を `index.json` に書く。既存の `render-template-preview-images.mjs` は検証用途なので無改変とする
- 非採用理由: (a) は主要 browser で表示できない。(b) は client へ大きな JS runtime を送ることになり、静的で軽量なサイトという方針に反する
- risk: 画像は 7 template × 2 言語 × 約 5–8 page × 2 size で十数 MB になるが、GitHub Pages の制限には遠く及ばない
- 検証: 全 template × 2 言語で page 数の下限 check を行い、生成画像の寸法を `index.json` 経由で HTML の `width` / `height` に埋めて CLS ゼロを確認する
- 再検討条件: Chrome / Firefox が PDF-in-img に対応した場合(`<picture><source type="application/pdf">` の追加で段階導入できる)

## DD-35: サイトは主張の押し付けを避け、docs の入口は第 1 章とする

- status: Accepted(2026-08)
- 問題: 初版サイトには、browser の言語設定と表示言語が食い違うときに上部へ出る言語誘導 bar、landing page 末尾の「信頼モデル」「対応環境」節、docs の入口となる章一覧ページがあった。言語誘導 bar は閲覧を遮り、「信頼モデル」は README / SECURITY.md が扱うべき主張を landing page で述べるもので、「対応環境」は landing page より docs 側の情報である。章一覧ページは、全 docs ページの sidebar が同じ一覧を常に表示している以上、header の「ドキュメント」から本文へ着くまでの余分な 1 click にしかならない
- 選択肢: (a) 現状維持、(b) 言語誘導 bar と 2 節を削除し、docs の入口を第 1 章へ変更する、(c) 章一覧ページを残したまま header の link 先だけ第 1 章にする
- 採用: (b)。言語切替は header の言語 switch に一本化する(言語別 URL と hreflang は不変)。「信頼モデル」「対応環境」は削除し、SECURITY.md と docs を情報源とする。`/docs/` は削除せず第 1 章への redirect ページ(`meta refresh` + `location.replace`、いずれも page 相対 URL)として残し、既存 link を保つ。第 1 章の slug は `listChapters()` の先頭から導出し固定しない
- 非採用理由: (a) は上記の問題が残る。(c) は到達不能に近い章一覧ページが sitemap と canonical に残り、二重管理になる
- risk: `/docs/` を indexing していた検索 engine が redirect を辿るまで一時的に順位を失う可能性がある。redirect ページには `noindex` を付け、sitemap からは外した
- 検証: build 後の `check-links.mjs` が全 link の解決を確認する。headless browser で `/docs/` と `/ja/docs/` が第 1 章へ遷移すること、header・footer の link 先が第 1 章であることを確認した
- 再検討条件: docs の章数が増えて一覧性が sidebar だけでは不足する場合、または landing page に安全性の説明を求める要望が出た場合

## DD-36: トップページの図版は confidential なしの専用文書からレンダリングする

- status: Accepted(2026-08)
- 問題: トップページの「Markdown → PDF」図版は gallery 用 sample PDF (`docs/template-preview/sample.md`) の 1 ページ目を流用していた。この sample は `confidential: true` を含むため、表紙に赤い Confidential badge が出る。gallery では confidential 表示の確認を兼ねており残したいが、トップページの第一印象としては不適切である
- 選択肢: (a) sample の `confidential` を落とす、(b) `--confidential` 系の CLI option を追加して build 時に上書きする、(c) 画像を後処理して badge を消す、(d) confidential なしの短い専用文書を別に用意する
- 採用: (d)。`docs/template-preview/hero.{md,en.md}` を追加し、`make docs-hero-sample` が `HERO_TEMPLATE`(既定 `pfn`)で PDF を作る。`build-site-assets.mjs` はその 1 ページ目だけを `build/site-assets/hero/<lang>/cover.webp` と `index.json` に変換し、site 側は `loadHero()` で読む。表示される Markdown snippet も component 内の literal をやめ、`loadHeroSource()` でこの file を verbatim に読むので、入力と出力の図が食い違わない。snippet が hero 枠に収まるよう本文は数行に留め、`series` は入れない
- 非採用理由: (a) は gallery から confidential の実例が消える。(b) は site の都合で製品 CLI に option を増やすことになる。(c) は生成物の後処理で、再現性と保守性を損なう
- risk: hero 用に PDF を 2 本余分にレンダリングするが、いずれも 2 ページ程度で build 時間への影響は小さい
- 検証: `make site-assets` で hero の cover が生成されること、トップページに badge がなく gallery には残ることを headless browser で確認した
- 再検討条件: front matter を CLI から上書きする機能が別の理由で入った場合(その場合は sample を使い回せる)

## DD-37: npm package は Organization scope で公開する

- status: Accepted(2026-08)
- 問題: 当初予定した unscoped package 名 `pfpdf` は未使用だったが、npm registry が既存 package `jspdf` との類似名として初回 publish を `E403` で拒否した。公式な配布元を Organization の所有権で明示しつつ、利用者向け executable 名 `pfpdf` を維持する必要がある
- 選択肢: (a) npm へ unscoped 名の例外を申請する、(b) 別の unscoped 名へ変更する、(c) Organization scoped package `@pfnet-research/pfpdf` とする、(d) 個人 scope `@imostella/pfpdf` とする
- 採用: (c)。Organization scope は registry 全体の類似名制約と衝突せず、GitHub repository の所有主体とも一致する。`package.json` の `bin` key は `pfpdf` のままなので、global install 後の executable 名は変えず、直接実行は `npx @pfnet-research/pfpdf@<version>` とする。`publishConfig` で public npm registry と public access を固定する
- 非採用理由: (a) は例外が認められる保証がなく release を registry の個別判断へ依存させる。(b) は利用者向け package 名をいずれにせよ変更し、Organization の正規配布物であることも名前から示せない。(d) は最終所有者と異なり、scoped package は後から別 scope へ移せない
- risk: `npx` の package spec が長くなり、既存の `npx pfpdf` 表記はすべて更新が必要になる
- 検証: `npm pack --dry-run` で package 名、public access、tarball 内容を確認し、空の一時 project へ tarball を install して `pfpdf` executable を実行する。publish 後は `npx @pfnet-research/pfpdf@<version> --version` を registry 経由で確認する
- 再検討条件: 初回 publish 前に Organization または registry の命名方針が変わった場合。初回 publish 後は別 package への移行が利用者向け破壊的変更になるため、通常の名称変更としては再検討しない

## DD-38: release PR と承認付き build-once publish を分離する

- status: Accepted(2026-08)
- 問題: version / CHANGELOG の判断、npm tarball と4文書 PDFの検証、npm と GitHub Release の公開を自動化しつつ、`main` merge ごとの無条件 publish、承認後の再 build、長期 npm token を避ける必要がある。Release Please が既定 `GITHUB_TOKEN` で作った PR / tag は再帰防止により通常の workflow event を発生させない
- 選択肢: (a) `main` の merge ごとに semantic-release で即 publish、(b) maintainer が version、tag、CHANGELOG、publish command を手作業で管理、(c) Release Please の release PR と tag-backed draft Release、tag source からの build-once staging、GitHub Environment 承認、npm trusted publishing、公開後検証を分離する
- 採用: (c)。Conventional Commit から Release Please が release PR を維持し、version と note は PR review で確定する。権限を repository に限定した release GitHub App の短命 installation token で PR / tag を作り、tag workflow は npm tarball と4 PDFを一度だけ生成する。同じ tarball を4環境で検査し、draft ReleaseへPDFを揃え、`release` Environment 承認後にOIDCでnpmへ公開する。手動再開も workflow ref を既存 release tag に固定する。public registryからexact versionを検証し、remote Release asset のdigestを再検証して初めてGitHub Releaseを公開する
- 非採用理由: (a) は release timing と `0.x` のversion判断をcommit prefixだけに委ね、公開前の成果物reviewを持てない。(b) はlockfile、tag、artifactの対応を人手に依存し、同じsourceから同じartifactを配布した証跡が弱い。既定 `GITHUB_TOKEN` をRelease Pleaseに使う案は生成PRのrequired CIとtag workflowを起動できないため採用しない
- scope: 公式利用者向け配布をnpm、付属文書をGitHub Releaseへ限定する
- risk: GitHub App、Environment、npm trusted publisherのrepository外設定が必要である。App permissionをContents / Pull requests / Issuesの必要範囲へ絞り、actionをcommit SHA固定し、workflow lintと運用checklistで設定driftを検出する。npm公開後にGitHub Release公開が失敗する非atomic区間は残るため、draftを維持し、同一tarballのregistry integrityを確認してfinalizeだけ再開できるようにする
- 検証: release helperのunit test、tag / lock / CHANGELOGの整合検査、npm pack allowlist、4環境のpacked-package install lock / shrinkwrap一致、`npm ls`、実PDF smoke test、4 PDFのexact setとchecksum、draft assetのstate / size / remote SHA-256 digest検査、public registryからのexact-version smoke test
- 再検討条件: packageが複数になる場合、npm staged publishingを採用してnpm側の2FA承認もrelease gateへ含める場合、またはGitHub / npmが複数artifactのtransactional promotionを提供する場合

## DD-39: bundled template は front matter で選択し、外部設定で上書き可能にする

- status: Accepted(2026-08)
- 問題: 文書が意図する見た目を Markdown と一緒に version 管理できるようにしたい。一方で preview、CI、移行確認では source を変更せず別 template を適用する必要があり、`--template`との優先関係を曖昧にできない
- 選択肢: (a) CLIだけを使う、(b) front matter を CLI より優先する、(c) front matter で bundled template を選択でき、組み込み既定値、front matter、CLI の順に上書きする、(d) custom template directory も front matter の相対 path で指定できるようにする
- 採用: (c)。先頭 Markdown の `template` は manifest にある bundled template 名だけを受け付ける。InputResolver の値はCLI指定がなくsourceが`default`の場合だけ置き換える。`--template`はCLI overrideとする。不正なfront matterはCLI指定で隠れてもcode `2`とし、`--print-effective-config --input PATH`と`--doctor --input PATH`はdocument選択を反映する
- 非採用理由: (a) は文書単体で見た目を再現できない。(b) は一時的な preview と CI policy の適用に source 編集を要求する。(d) は trusted code の実行 path を文書へ埋め込み、文書 directory と invocation cwd のどちらを基準にするかという新しい path 規則と、配布先に存在しない directory への依存を作る
- 検証: InputResolver の型・未知名検査、front matter 単独選択、CLI / custom directory による上書き、上書き時の不正値検出、effective config の source と schema version を unit test で確認する
- 再検討条件: custom template を package 名や content digest で移植可能に参照する registry を導入する場合、または他の front matter 設定も共通の多段 ConfigResolver へ統合する場合

## DD-40: template 既定ロゴと Git repository source を明示的な外部設定として扱う

- status: Accepted(2026-08)
- 問題: organization 共通の template とロゴを各文書 repository へ複製せず version 固定して利用し、monorepo 内のサブディレクトリも選択したい。また custom template 自体が既定ロゴを持ちながら、文書単位の上書きと完全な非表示も必要である
- 選択肢: (a) GitHub raw URL を個別 file ごとに指定する、(b) Helm のような registry / index と template manifest を新設する、(c) Terraform / Kustomize 型の `git::URL//PATH?ref=REVISION` locator で repository を checkout し、既定ロゴは既存 `logo` slot の `src` で表す、(d) repository URL、ref、path を別々の CLI option にする
- 採用: (c)。`--template SOURCE` は bundled preset 名との完全一致を最優先し、それ以外を `git::` locatorまたはlocal pathとして分類する。明示preset用に`--template-preset NAME`を提供する。`--logo SOURCE`もGit locatorとlocal pathを同じoptionで扱う。repository内pathはroleに応じてdirectory / fileとして検査し、同一URL / refはbuild内で共有する。template logoは未指定時にslotの`src`を通常resourceとして解決し、front matterまたはCLIの明示logoで上書きし、`logo: false` / `--no-logo`で削除する。新しいmanifestやtemplate engineを導入せず既存DOM slot / resource graphを使う
- 非採用理由: (a) は3つのtemplate fileとnested CSS / image / fontを同一revisionで取得するpackage境界を持てない。(b)は探索、署名、version index、配信運用を現在の要件以上に増やす。(d)のsource種別ごとの専用optionはtemplateとlogoごとのoptionと不完全指定を増やし、sourceを1文字列でcopy / pinできない
- security / trust: repository templateもraw HTML / scriptを実行できるtrusted codeであり、front matterからは指定できない。private sourceはGit credential helper / SSH agentを使い、HTTPS userinfoとpasswordを拒否する。Gitはshellなし、interactive promptなし、submoduleなし、300秒timeoutで実行する。この制約をsandboxとは表現しない
- risk: persistent cacheがないため繰返し実行はnetworkとcheckout costを払う。branch / tagも移動し得るため、ref省略はwarning、CIは完全commit hash固定を推奨する。Git executableと認証設定が新しいruntime prerequisiteになる。offline用途は事前cloneと既存local optionで対応する
- 検証: locatorのscheme / query / traversal / credential検査、local Git fixtureからのcommit checkout、template / logoのnested path、同一repository共有、template既定logo・front matter / CLI上書き・`logo: false` / `--no-logo`、CLI排他性、終了code、日英文書buildをtestする
- 再検討条件: repository利用が支配的になりpersistent content-addressed cacheが必要になった場合、またはgalleryから名前とsemantic versionで取得する署名付きregistryを導入する場合

## DD-41: 脆弱性修正を依存単位で固定し、サイトの Markdown processor を維持する

- status: Accepted(2026-10-28)
- 問題: root と `site/` の依存に既知の脆弱性があり、既存の DOMPurify override も脆弱な版を固定している。Astro 5 内の更新だけでは修正できず、Astro 7 の既定 Markdown processor は既存の remark link 変換を実行しない
- 選択肢: (a) `npm audit fix --force` で一括変更する、(b) 修正版へ個別更新し、必要な間接依存だけ override する、(c) trusted input / static site を理由に更新を見送る
- 採用: (b)。`js-yaml`、DOMPurify、KaTeX と lockfile 内の修正可能な間接依存を更新する。Vivliostyle CLI 11.1.0、Markdown parser、CJK extension は維持し、CLI 配下の Handlebars、Puppeteer Core、Vite を修正版に固定する。サイトは Astro 7.3.3 と sharp 0.35.5 へ更新し、`@astrojs/markdown-remark` の `unified` processor を明示して tutorial link 変換を維持する。root の lockfile と公開用 shrinkwrap は同一に保つ
- 非採用理由: (a) は `remark-math` の旧 major への downgrade まで提案し、PDF renderer 本体にも不要な変更を広げる。(c) は build 時やローカル preview の依存に修正可能な問題を残す。サイトを既定 processor へ移行する案は link plugin の書換えと Markdown 出力差の検証を同時に要求するため、今回は採用しない
- risk: Puppeteer Core と KaTeX の override は上流の依存範囲を超えるため、監査結果だけで互換性を保証できない。Astro major 更新にも出力差の可能性がある。trust model は変更せず、raw HTML の sanitization や sandbox を保証しない
- 検証: 両 project の `npm ci`、`npm audit`、`npm ls --all`、root の test / lint、PDF smoke test、4 文書 PDF、全 template のサイト asset 生成とリンク検査付きサイト build。対応 OS の PDF smoke test は既存の CI matrix でも確認する
- 再検討条件: 上流が修正版を依存に取り込んだ場合は override の撤去を検討する。新しい advisory が公開された場合は固定版を再監査する

## DD-42: 改ページを連続する underscore 3 個以上に統一

- status: Accepted(2026-10-29)
- 問題: `___` だけが改ページで、`____` は水平線になるため、長さによって意図が変わる
- 採用: block container の外側で、空白も indent もない行全体が連続する ASCII underscore 3 個以上なら改ページとする
- 非採用: ちょうど 3 個に限定する案は長さによる不整合が残る。空白や blockquote / list 内にも拡張する案は今回の長さの統一を超えて GFM の扱いを変えるため採用しない
- 影響: 以前水平線だった `____` なども改ページになる。水平線には `---` または `***` を使う
- 検証: 3 個・4 個・5 個・長い連続、LF / CRLF、空白・入れ子・code の除外、先頭・末尾・連続の折り畳みを full-pipeline test で確認する
- 再検討: 空白や container 内でも改ページを指定する要件が生じた場合

## DD-43: Mermaid の text 測定を同梱 font と browser 互換の値でそろえ、ELK を既定 layout にする

- status: Accepted(2026-10-29)
- 問題: DD-28 の server-side DOM(svgdom)は Open Sans だけで text を測るため、日本語 label の幅が `.notdef` 相当になり、node から文字がはみ出す。`y="1em"` などの em を `parseFloat` で読むため複数行 label の高さが 1 行分になり、edge label の背景も文字からずれる。stylesheet を適用しないため `.node .label text` の `text-anchor: middle` が測定に入らず、`getBBox()` が `left` / `top` を持つ `Box` を返すため、円柱などの label が左へずれる。また dagre 以外の layout を選べない
- 選択肢: (a) DD-28 の (a) / (c) と同じく画像の事前生成または別 browser process で描画する、(b) 文字数に応じた固定補正を後処理で加える、(c) svgdom へ同梱 font を登録し、Mermaid が layout のために読む値だけを browser と同じ意味に補正する、(d) svgdom を fork する
- 採用: (c)。`resources/fonts` に同梱した Noto Sans JP の unicode-range subset(`noto-sans-jp-400.css` の `@font-face` から読む)を code point ごとに引く測定用 font を `Noto Sans JP` と `sans-serif` に登録する。`text` / `tspan` の位置属性の em を px に換算し、`.node .label text` に `text-anchor: middle` を返し、`getBBox()` は `x` / `y` / `width` / `height` だけを返す。ELK は `@mermaid-js/layout-elk` を登録して site config の既定 layout とし、diagram config の指定を優先する。生成 SVG の属性、決定的 ID、外部 SVG の構成は変えない
- 非採用理由: (a) は DD-28 で退けた理由がそのまま当てはまる。(b) は font size、文字種、図種に依存し、複数行や edge label を壊し得る。(d) は保守対象を増やし、上流の修正を取り込みにくくする
- ELK 固有の対応: layout-elk は GWT 由来 engine が `window.Error` などを参照するため、svgdom の window へ組込み object を補う。同梱の DOMPurify が読込時の `window` に結び付くため、layout chunk の読込中だけ jsdom の window を渡す。最初の図の subgraph 見出しを config 同期前に測るため、initialize 直後に subgraph のない図を一度描いて同期させ、失敗は runtime error(code `1`)とする
- ID の互換性: layout-elk の内部辞書は通常の object を使うため、`constructor` などの ID が継承プロパティと衝突し、subgraph の描画に失敗する。ELK に渡す layout data のコピーで該当する node ID と親子・edge の参照を一貫して置き換える。置換先は既存 ID と衝突しない決定的な値とし、label、style、Mermaid の入力は維持する。入力の正規表現による書換えは label なども変えるおそれがあり、`Object.prototype` の変更は他の処理へ影響するため採用しない
- 同梱依存の更新: layout-elk 0.2.3 が同梱する DOMPurify 3.4.12 には、pfpdf の DOMPurify override が適用されない。lockfile だけでなく配布 bundle の版も確認する。依存を外部化した layout-elk 1.0.0 は Mermaid 本体に ELK を統合した版との組合せを前提とするため、単独では更新せず、Mermaid の更新と合わせて互換性と各 OS の PDF 出力を検証する
- risk: 測定 font は Noto Sans JP の 400 weight だけで、bold など weight 差は測定に入らない。SVG は外部 document のため、描画 font は host の fallback になり、測定との差が残り得る。ELK を既定にすると既存文書の図の配置が変わる。layout-elk は Mermaid の描画処理を同梱するため、Mermaid 更新時は両者の版の組合せを確認する
- 検証: 日本語 1 行の幅、3 行 label の高さ、円柱 label の中央配置、ELK 既定と `layout: dagre` 指定の優先、subgraph 内の複数行 label を unit test で検査する。subgraph の入れ子、edge label、init directive を含む実文書を全 bundled template で PDF 化して目視確認する
- ID の回帰テスト: `constructor`、`toString`、`hasOwnProperty`、`__proto__` の subgraph、入れ子、置換先と同名の既存 node、edge、style、繰返し描画の一致を Markdown から SVG までの経路で検査する。PDF smoke test でも入れ子の subgraph と label の出力を確認する
- 再検討条件: svgdom が em 長さや stylesheet を解釈するようになった場合、layout-elk が Mermaid 本体の描画処理を共有する構成になった場合、または描画 font を SVG 内へ埋め込む方針を採る場合

## DD-44: Gantt の描画に必要な `parentElement` を server-side DOM に補う

- 状態: 採用 (2026-10-29)
- 問題: Mermaid の Gantt renderer は幅を決める前に `elem.parentElement.offsetWidth` を読む。svgdom には `parentNode` があるが `parentElement` がなく、正しい入力でも描画に失敗する。`gantt.useWidth` や `layout: dagre` の指定でも回避できない (#13)
- 選択肢: (a) 利用者に SVG の事前生成を求める、(b) 別 browser process で Gantt を描画する、(c) DOM / Mermaid の依存を更新する、(d) 不足する DOM getter だけを補う
- 採用: (d)。svgdom の `Node.prototype` に既存実装がない場合だけ `parentElement` getter を定義する。親が element ならその親、それ以外は `null` を返す。`offsetWidth` は追加せず、Mermaid 自身の幅 1200px への fallback と diagram config の `gantt.useWidth` を使う
- 非採用理由: (a) は Mermaid fence の対応にならず、(b) は DD-28 で退けた browser 環境の二重化を生む。(c) は他の図種や PDF 出力にも影響し、今回不足する API を補うだけで修正できる問題に対して範囲が広い
- 検証: 投稿された最小例の Markdown → SVG 変換でタスク名、日付軸、正の幅・高さ、既定幅と指定幅、dagre 指定を確認する。flowchart / sequence / Gantt の混在と繰り返し生成も検証する。PDF smoke test は renderer が消費する `document.html` と生成 SVG を検査し、PDF 内のタスク名と日付を確認する
- risk: server-side DOM は browser の container layout を行わないため、Gantt の幅は本文幅の測定結果ではなく既定値または指定値になる
- 再検討条件: svgdom が `parentElement` を実装するか、Mermaid の幅取得方法が変わる場合

## DD-45: 未知の front matter key は警告して無視し、厳格検証は CLI で選ぶ

- 状態: 採用 (2026-10-29)
- 問題: 他ツール用の `tags` / `status` などを持つ Markdown を PDF 化すると、従来の未知 key 拒否によって失敗する (#15)。同じ文書を複数ツールで再利用できるようにしたい
- 選択肢: (a) 未知 key の拒否を維持する、(b) 黙って無視する、(c) 既定では警告して無視し、CLI で厳格検証を選ぶ、(d) 許可する任意 key のリストや project config file を追加する
- 採用: (c)。未知 key ごとに source file と key 名を含む warning を stderr へ出し、値を捨てる。CLI-only の `--strict-front-matter` で従来の入力エラーを選べる。通常変換、`--print-effective-config`、`--doctor` は同じ parser と検証方針を使い、警告は既存の log level に従う。effective config へ boolean の `strictFrontMatter` と source を追加し、既存の field を変えないため schema version `5` を維持する
- 非採用理由: (a) は文書の再利用に metadata の削除を要求する。(b) は `page_szie` のような誤記に気付けない。(d) は利用ツールごとに key の保守を必要とし、設定を front matter と CLI に限定する方針にも反する
- 互換性: 未知 key の拒否という既定動作だけを変更する。既知 key の型違い・不正値、重複 key、不正 YAML、未知 CLI option は引き続きエラーであり、CLI は front matter より優先される。厳格モードの変換・設定表示は code `2`、doctor は既存の診断契約に従って入力 check を `fail` とし code `1` を返す。front matter 自身では厳格検証を設定できない
- 検証: 投稿例の `tags` / `status`、未知 key の値が設定や文書へ入らないこと、誤記の警告、厳格モード、既知 key の不正値、重複 key、不正 YAML、各コマンドの stdout / stderr、CLI 優先順位を unit / integration test で検査する。PDF smoke test で投稿例の変換成功と厳格モード失敗時の既存出力保持を確認し、日英の設計・チュートリアルを PDF 化する
- 再検討条件: 未知 key の利用状況から追加の正式 metadata が必要になった場合、または warning の集約表示が必要になった場合

## DD-47: 省略時の文書言語を日英推定し、脚注 label と共用する

- 状態: 採用 (2026-10-29)
- 問題: DD-16 の固定既定値 `ja` では言語を指定しない英語文書の目次・自動日付が日本語になり、脚注 label は明示 `ja` でも英語になる (#26)
- 選択肢: (a) 既定 `ja` のまま脚注だけ翻訳する、(b) host locale や外部言語判定 service を使う、(c) 本文の文字種による小さい日英分類を使い、解決済みの言語を全生成 label へ渡す
- 採用: (c)。明示した well-formed BCP 47 tag を最優先し、未指定時は全 file の Markdown text node（code、数式、raw HTML block、URL を除く）のひらがな・かな・漢字・英字を数える。ひらがな 2 字以上かつ対象文字の 1% 以上、かなを含み日本語文字数が英字数以上、または漢字数が英字数を超える場合は `ja`、それ以外は `en`。判定対象文字がなければ正規化した title を同じ規則で判定し、それでも不明なら `en`。host locale・network・新しい依存は使わない。DD-16 の省略時 `ja` の方針をこの規則で置き換える
- label: 正規化済み言語を `buildDocumentBody` へ渡し、`ja` と派生 tag の脚注・繰返し参照を含む戻りリンク label を日本語化する。他言語は英語へ fallback する。利用者の本文は保持する。DD-52 のページ脚注では見出しを生成せず、番号・ID を文書全体で割り当てる
- 非採用理由: (a) は省略した英語文書に不自然な表示を残す。(b) は同一入力の再現性や offline 利用を損ねる。語彙 model は日英だけの分類に対して保守と配布が大きい
- risk: 少量の日本語例を含む英語、多言語、漢字だけの中国語を完全には区別できない。誤判定は `lang` の明示で回避する。推定は date・目次・HTML / PDF language も変えるため、脚注だけの表示変更ではない
- 検証: 明示 tag 優先、複数 file、日英・混在・code / math / HTML / URL 除外、空本文の title fallback、自動日付、全7 template の正規 renderer HTML と日英 PDF、繰返し参照の label・link・目次除外を検査する
- 再検討条件: 日英以外の自動分類や、利用者指定の翻訳 label が必要になった場合

## DD-48: 複数 file の front matter は key ごとの先勝ちで継承する

- 状態: 採用 (2026-10-29)
- 問題: 個別に metadata を持つメモを結合すると、後続 file の front matter が重複として拒否される (#21)
- 選択肢: (a) 後続 block を拒否する、(b) 全 block を除去し先頭 file だけを使う、(c) key ごとに後勝ちで上書きする、(d) key ごとに最初の値を採用し、後続 file は未設定 key を補う
- 採用: (d)。入力順で key ごとに最初に現れた値を文書全体へ適用し、CLI がその選択値を上書きする。先頭 file に値や front matter 自体がなくても後続 file の title や設定を使える。`false` も指定済みと扱い、`bibliography` list は一つの値として選び、後続 list と連結しない。DD-31 / DD-39 の front matter を先頭 file に限定する部分と、従来の後続 front matter 拒否を置き換える
- 選択元: key ごとに source file を保持し、相対 logo / bibliography path はその key を最初に指定した Markdown の親 directory を基準にする。選択されない logo / bibliography の file は存在確認・読込をしない
- 検証方針: 全 file で YAML mapping、未知 key の warning / strict mode、既知 key の型・値・path 構文と bibliography の重複 path を採否にかかわらず検査する。変換・effective config・doctor が同じ選択・検証経路を使い、不正な後続 block も文書全体の失敗とする
- 非採用理由: (a) はメモを編集してから結合する必要がある。(b) は後続 file の有用な未設定値まで捨てる。(c) はメモを追加するだけで既存の文書設定が変わる。file 単位の局所適用も、単一文書の page size・template・language の適用範囲を曖昧にするため採用しない
- 位置情報: 各 `SourceFile.content` はその file の front matter を除去した byte 表現とし、`lineOffset` に除去行数を保持する。file 順・anchor・file 間 link と本文の line ending は保持する。言語推定には metadata 除去後の全 file の本文を渡す
- 検証: 複数 front matter と混在入力、key ごとの先勝ち・後続 file からの title / 設定補完、CLI 優先、false と list 全体の選択、採否にかかわらない metadata 検証・未知 key・strict mode、選択 asset の解決と不採用 asset の非読込、BOM / CRLF、元行番号、file 間 link、正規 renderer HTML と最終 PDF を確認する
- 再検討条件: file 単位の組版設定や bibliography 統合が独立した機能として必要になる場合

## DD-49: 表紙を独立した document 設定と optional slot で切り替える

- 状態: 採用 (2026-10-29)
- 問題: 短い文書でも template を変えずに表紙だけ省略したい。目次の有無とは独立した操作である (#19)
- 選択肢: (a) compact への template 変更だけを案内する、(b) CSS の display:none だけで表紙を隠す、(c) cover 設定と optional cover slot で element を除去し、組版上の表紙 page を区別する
- 採用: (c)。`cover` は boolean、既定 true、front matter より `--cover` / `--no-cover` を優先する。全7 template の表紙（compact は先頭 header）に cover slot を設ける。custom template の slot は optional とし、ない場合は切替を no-op とする。content / toc は cover に含められない
- 組版: 独立表紙は `pfpdf-cover` named page の first-page 規則、compact は body に与える専用 named page の first 規則を使う。表紙がない本文へ従来の `@page :first` の表紙用 margin / 柱抑制を適用せず、先頭の空白 page を作らない
- metadata: 表紙上の title / author / date / series / logo は省略する。HTML title と PDF metadata は維持し、series / Confidential の named string source は高さ 0 の非表示 marker へ移す。pfn の running badge は cover の外に置く。custom template も独自 running element を cover の外へ置く
- 非採用理由: (a) は本文デザインまで変わる。(b) は named string / running element の情報や first-page 用 CSS を失い、Confidential 非表示や余白不良を招く。本文へ代替 metadata header を自動生成する案は、利用者が省略したい情報を再表示し、template ごとの見た目を増やすため採用しない
- 検証: CLI / front matter 優先・不正型、optional custom slot、全7 template の cover / toc 全4組合せで正規 renderer HTML と最終 PDF の page 数・先頭内容・Confidential・PDF title / author を確認する
- 再検討条件: 表紙とは別に title / author を本文内へ表示する設定や、template 固有の複数表紙が必要になる場合

## DD-50: 画像の元位置を保持し、動的な参照先は readiness 後に診断する

- 状態: 採用 (2026-10-29)
- 問題: 存在しない画像では解決後 path だけ、空や破損画像では汎用 decode error だけが出て参照元が分からない (#29)
- 選択肢: (a) URL だけを診断する、(b) src のない img をすべて入力エラーにする、(c) 元位置と記述した参照先を保持し、静的 Markdown の空 URL は早期拒否、動的 HTML の参照先は登録 promise 後に検査する
- 採用: (c)。resource 解決時の InputError に元 path・front matter 補正後の行・参照先を加え、画像の DOM attribute に同じ情報を保存する。生成 Mermaid SVG 画像にも元 code fence の位置を付ける。readiness は local / data / remote の全画像を decode し、失敗箇所と参照先を RuntimeError に含める。script で新規生成した画像は位置がなければ document.html と現在の URL を使う
- 非採用理由: (a) は同じ URL を参照する複数箇所や書換え後 URL から入力を特定できない。(b) は正当な script による画像設定を壊す。HTTP status の取得のために画像を再 fetch する案は認証・CORS・副作用を変えるため採用しない
- 検証: 空 URL、元行番号、local 不存在、HTML の src 未指定、破損 local / data、HTTP404、通信切断、登録 promise による src 設定、画像なし、既存出力保持を正規 HTML と renderer で検査する
- 再検討条件: script 生成画像に利用者が明示 source location を付ける API が必要になった場合

## DD-51: Docker は非 root と有効な Chromium sandbox を前提にする

- 状態: 採用 (2026-10-29)
- 問題: root の Ubuntu container で browser が起動せず、shared library、初回展開、cache と mount 権限、host 制限を含む一通りの手順がない (#27)
- 選択肢: (a) 暗黙に sandbox を無効化する、(b) CLI-only の無効化 option を加える、(c) 非 root と sandbox を維持した検証済み container 例を提供する
- 採用: (c)。Ubuntu 24.04 amd64 の Dockerfile に Node.js と lockfile の依存、Chrome の shared library と unzip を含める。runtime は非 root、host UID / GID、read-only 入力、書込み可能な出力と永続 browser cache を使う。container の Chromium sandbox 起動には upstream の手順どおり SYS_ADMIN capability を明示する。root は引き続き非対応とし、runtime option は追加しない
- 非採用理由: (a) は既定挙動を変え利用者の意図なく browser 起動方針を緩める。(b) は非 root の手順で変換できる要件に対して別の実行 policy を増やす。root 拒否、shared library 不足、namespace / AppArmor 制限は doctor の原因分類と元 stderr で区別する
- 検証: Ubuntu 24.04 amd64、Node 22.23.2、Vivliostyle 11.1.0、Chrome 150.0.7871.115。Arm64 Docker daemon の amd64 emulation で、fresh / reused cache、入力・出力 mount、host user 所有の PDF、doctor 成功、root 拒否、capability なしの namespace 起動失敗を確認した。Ubuntu host の AppArmor profile そのものの実機検証とは区別する
- 再検討条件: 非 root と sandbox を利用できない環境を公式対応へ加える場合、または upstream が container で必要な capability を変える場合

## DD-52: ページ脚注は DPUB-ARIA と既定 renderer のネイティブ配置を使う

- 状態: 採用 (2026-10-29)
- 問題: 現行 Markdown 脚注は末尾注だけで、印刷文書の参照ページ下部へ配置できない (#25)
- 選択肢: (a) 末尾注の CSS に float を足すだけ、(b) 参照ごとに脚注本文を複製する、(c) DPUB-ARIA の参照・本文を生成し Vivliostyle の配置を使う、(d) browser script でページを測って並べ直す
- 採用: (c)。Markdown 脚注は常にページ下部へ配置し、配置を切り替える文書設定や CLI option は設けない。`role="doc-noteref"` の link と `aside[role="doc-footnote"]` を生成する。依存を更新せず、同梱 Vivliostyle.js 2.44.1 のネイティブ DPUB 配置と分割を利用する。custom template でも同じ意味構造を使い、bundled template は専用 class で書体・行間だけを整える
- 番号・参照: 文書全体の初出順に番号を付け、file 内の識別子を独立に扱う。本文・全参照に allocator で衝突しない ID を割り当て、参照先・全戻り link を更新する。各本文は最初に参照したページへ一度だけ配置する。後の参照は既存本文への link とし、同ページ・別ページとも本文を再印刷しない。自動見出しを作らず、参照と本文の名前・戻り label を言語対応させる
- 長い脚注: renderer の `footnote-policy: auto` で本文を後続ページへ分割する。複数段落、code、link と元の source position を保持し、renderer が扱う不可分 block の改ページ規則を使う
- 非採用理由: (a) は file 末尾の位置で float され、参照ページと結び付かない。(b) は同じ本文の重複と長い脚注の増幅を起こす。(d) は renderer の改ページと競合し、フォント・用紙・template ごとの独自レイアウト実装を必要とする
- 互換性: 従来の file 末尾の注一覧からページ下部の脚注へ変更する。生成 ID と文書全体番号は新規契約であり、利用者の脚注本文は変更しない。effective config に脚注設定は追加しない
- 検証: 既定のページ脚注、配置 option が存在しないこと、複数 file の同名識別子・ID 衝突・繰返し参照・言語 label・目次除外・本文保持を HTML で検査する。全7 template の PDF で脚注と最初の参照が同じページにあり、脚注がページ下部にあることを座標で検査する。長い複数段落・code・link を含む脚注の分割と内容保持、Confidential / 柱を確認する
- 根拠: Vivliostyle の [Footnotes Guide](https://docs.vivliostyle.org/en/cookbook/footnotes/) と、固定版の UA stylesheet / 実 PDF を確認した
- 再検討条件: 繰返し参照先のページにも本文を印刷する要件、章ごとの番号リセット、別 renderer を追加する場合

## DD-53: 日本語 paragraph のソース改行を AST 上で結合する

- 状態: 採用 (2026-10-29)
- 問題: 日本語 paragraph の編集用改行が表示上の空白になり、折り返していない本文と異なる組版になる (#23)
- 選択肢: (a) source 全体の改行を文字列置換する、(b) CSS white-space だけで制御する、(c) 日本語文書の Markdown paragraph 内で、両隣の文字と source 由来を確認して soft break だけを除く
- 採用: (c)。文書言語は既存の解決済み `lang` を再利用し、漢字・かな・和文約物・全角約物間の source LF / CRLF だけを結合する。emphasis / strong / link の text は連続して評価し、code / math / image / note reference は境界、raw HTML を含む paragraph は保護する。行末に記述された空白と文字参照による改行を保護し、Markdown の構造的な継続 indent は文字へ変換しない。見出しや source position は保持する
- 非採用理由: (a) は code・raw HTML・hard break と元の行番号を壊す。(b) は明示空白とソース改行を区別できず、text extraction にも意図しない空白が残る
- 互換性: 英語・他言語、和欧境界、明示空白、hard break、段落境界は従来どおり。GFM parser 自体は変更せず、意図的な差分を Markdown 仕様と fixture に記録する
- 検証: pinned parser の GfmAdapter fixture、inline 要素・文字参照・CRLF・入れ子・raw HTML・code / math・ID / URL / position の検査、全7 template の正規 renderer HTML の表示幅と最終 PDF
- 再検討条件: 和欧境界も結合する要件、または raw HTML 内の source 改行を制御する明示設定が必要になった場合

## DD-54: 和欧間の空きを日本語向け CSS の既定値にする

- 状態: 採用 (2026-10-29)
- 問題: 和文と欧文・数字が空きなしで隣接し、印刷物として読み取りづらい (#24)
- 選択肢: (a) 実際の空白を source / DOM へ挿入する、(b) 新しい front matter / CLI 設定を導入する、(c) 既存 lang に基づき CSS text-autospace を日本語の既定値にする
- 採用: (c)。全 bundled template の共通 CSS で、明示 lang の日本語要素へ text-autospace: normal（ideograph-alpha / ideograph-numeric 相当）を適用し、別言語の subtree では解除する。code、pre、kbd、samp、textarea、SVG、MathML、数式とその子孫は対象外とする。selector の specificity はゼロにし、利用者の CSS で上書きできる
- 非採用理由: (a) は URL・識別子・コピー文字列を変更する。(b) は既存の文書言語で決まる組版のために設定を増やす。約物の自動調整や replace は今回の範囲へ含めない
- 実装互換性: 固定 Chrome 150 は normal を受け付けるが、ideograph-alpha ideograph-numeric の組合せ値を受け付けないため、[CSS Text 4](https://drafts.csswg.org/css-text-4/#text-autospace-property) で同じ動作と定義される normal を使う
- fallback: 非対応 browser は CSS property を無視し、従来の空きなしで変換する。依存や renderer の更新は行わない
- 検証: 固定 Chrome 150 / Vivliostyle 11.1.0、全7 template のゴシック・明朝、Latin / 数字、明示空白、約物、link、nested lang、code / math、DOM text と selection の保持、正規 document.html の computed style / geometry と PDF の文字位置・抽出結果
- risk: 自動空きで改行位置が変わる。PDF 抽出器が視覚的な空きを空白として復元する可能性はあるが、DOM の source text は変更しない
- 再検討条件: browser 間で既定の空き量や対応範囲が変わる場合、または CSS override より文書設定での切替が必要になった場合

## DD-55: 明示 title がない文書は H1 と入力名から補完する

- 状態: 採用 (2026-10-30)
- 問題: 見出しのある既存 Markdown でも title を重複指定しないと変換できない (#18)
- 選択肢: (a) 明示 title を必須のままにする、(b) 常に入力名を使う、(c) 明示値、H1、入力名の順で補完する、(d) browser の描画後に見出しを取得する
- 採用: (c)。`--title`、全 file の front matter から DD-48 で選んだ title、入力順で最初の空でないトップレベル Markdown H1、入力名の順とする。後続 file の明示 title も先行 H1 より優先する。H1 がなければ file は末尾 `.md` を除いた名前、directory は自身の名前を使い、空の名前は `document` とする
- 文字列: 描画と同じ固定 GFM / CJK / math parser を軽量 module で共用し、ATX / Setext H1 の装飾を文字列へ変換する。link label、code / math source、画像 alt を採用し、脚注参照・comment と script / style / template の内容を除く。CSS / script は評価せず、空白・改行を一つの空白へ畳む。補完済み文字列や file 名を明示 title 用 HTML parser へ再投入せず、文字参照や `<br>` の二重解釈を避ける
- 契約: 本文の H1、anchor、source position は保持する。表紙・HTML title・PDF Info / XMP は同じ解決値を使う。明示 title の型・空文字・許可 HTML の検証と全 front matter block の検証は従来どおり失敗させる。新しい設定や依存は追加せず、effective config の title は従来どおり CLI override を表す
- 非採用理由: (a) は既存メモの変換に追加編集を要求する。(b) は意味のある見出しを捨てる。(d) は metadata・言語推定の解決を描画へ依存させ、動的な DOM と入力時点の規則を混在させる。本文 H1 を削除する案は本文構造や link 先を変えるため採用しない
- 検証: 明示値優先、不正値、複数 file、空 H1、入れ子・code・raw HTML block の除外、装飾・数式・HTML・文字参照、日本語と特殊文字の file 名、H1 のない directory、doctor / help を確認する。全7 template の正規 renderer HTML と PDF title・本文見出し、表紙省略時の metadata を検査し、日英4冊を build する
- 再検討条件: 別の見出し level や HTML 見出し、利用者指定の補完形式が必要になった場合

## DD-56: 悪意ある変更も想定してレビューし、メンテナーが最小限の修正を引き受ける

- 状態: 採用 (2026-10-31)
- 問題: PR の背景を知らない第三者にも、変更の目的、影響、検証の限界、残る課題が分かるレビューが必要である。投稿者への信頼やテストの成功だけでは、不正なコードや意図しない挙動の混入を防げない
- 選択肢: (a) 指摘を列挙して投稿者に修正を任せる、(b) メンテナーが広範に書き直して取り込む、(c) 悪意ある変更を想定して全差分を調査し、メンテナーが目的に必要な修正を用意して最終差分を検証する
- 採用: (c)。調査から再レビューまでの手順を `docs/reviewing.ja.md` にまとめ、AGENTS.md と CONTRIBUTING.md から参照する。コメントは「概要、影響範囲、確認した項目、現在の課題、今後の課題」の順とし、英語の後に同じ内容の日本語を書く。信頼している `main` の手順で変更を調べ、隔離環境で検証する。対象 SHA と未検証事項も記録する
- 修正方針: 原則としてメンテナーが修正する。元の PR の head から修正後までの差分と、最新の `main` へ入る最終差分を確認する。説明できない変更は除去するか、必要な部分を実装し直す。既存の実装を使って無関係な変更を避け、必要な回帰テストと日英の仕様更新は残す。メンテナー自身の変更にも同じ検査を適用する
- 非採用理由: (a) は、修正から検証までをメンテナーが進める方針に合わない。(b) は目的外の変更を増やし、全差分の確認を難しくする。修正コミットの行数だけを減らす案は、元の PR にある不要な変更を見落とし得るため採用しない
- リスク: 全差分の調査と隔離環境の用意には工数がかかり、検査しても不正な変更の不在を保証できない。確認済みと未確認を分けて記録し、重要な検証不足はマージ前に解消する。pfpdf は入力文書を信頼する方針を維持し、worktree や AssetServer を隔離の手段として扱わない
- 検証: 日英の手順、5節の雛形、参照リンクの対応と、AGENTS.md の英語限定規則を確認する。`npm ci`、`npm test`、`npm run lint` を実行し、新しいチェックアウトで `make docs` により日英4冊を生成する
- 再検討条件: レビュー規模や実行環境が変わり、手順の自動化や役割分担を更新する必要が生じた場合
