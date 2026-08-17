# 5. renderer

## 5.1 `Renderer` interface

`Renderer` interface は生成済み `document.html`、resource manifest、出力用一時 path、一時 workspace、effective config、absolute deadline、`AbortSignal` を持つ immutable な `RenderJob` を受け取り、`LocalRenderer` と `DockerRenderer` の差を CLI と文書変換処理から隠します。両 renderer は `HtmlDocumentBuilder` が作った同じ HTML byte 列を消費し、Markdown 変換や設定解決を container 内で繰り返しません。

- renderer は `local` を既定とし、`--renderer docker` または `PFPDF_RENDERER=docker` で明示的に Docker へ切り替える
- local 実行の失敗時に Docker へ暗黙 fallback しない。どちらの実装が失敗したかをログと終了コードから判別可能にする
- renderer は成功時に output path、byte size、経過時間を返し、失敗時に部分出力を結果 object として返さない
- timeout は renderer が最初の外部 process を起動する直前から Docker image / browser の確認と取得、readiness、描画、PDF metadata 後処理、構造検査を合わせた既定 300 秒の absolute deadline とする。phase や child ごとに timeout を reset して総時間が無制限に伸びないよう、すべての待機へ残り時間を渡す

## 5.2 `LocalRenderer`

- Vivliostyle CLI は Node.js の child process として呼び出し、pfpdf 本体との境界を明確にする
- local `AssetServer` の document URL を入力として渡し、workspace の `file:` URL を renderer ごとに別生成しない
- Vivliostyle CLI を `PATH` や `npx` で解決せず、pfpdf が package 解決した entry point を `process.execPath` の Node.js で起動する
- pinned Vivliostyle CLI が標準管理する browser、または利用者が明示した検証済み browser を使い、確認済みの option 名を渡す。browser の取得・cache recovery は pfpdf で再実装しない
- shell 文字列を組み立てず、引数配列と `shell: false` で child process を起動する
- upstream が提供する sandbox を不必要に無効化しない
- child の stdout / stderr は parent の stdout へ転送せず、必要な log level では stderr へ stream し、renderer diagnostics に保存する。trusted input 前提のため内容の sanitize や credential redaction は行わない
- 保存する renderer diagnostics は 8 MiB を上限とし、超過後も child pipe は捨てずに drain して deadlock を防ぐ。file には truncation と省略 byte 数を記録し、log volume に比例して process memory を増やさない。stderr への転送量自体は呼出側が管理するものとし、stdout へ迂回しない
- timeout、`SIGINT`、`SIGTERM` では新しい処理を開始せず、まず graceful termination を要求し、5 秒後に強制終了する。cleanup 全体にも 15 秒の上限を持たせる。POSIX では専用 process group、Windows では利用可能な process-tree termination を使って browser descendant も best effort で回収する。上限後も OS が終了を確認できない PID / container ID は診断へ明記し、成功扱いしない
- browser executable の存在・regular file 性・実行可否は conversion 前に検査するが、最小 HTML を使う追加起動は毎回行わず `--doctor` で行う。実変換で判明した非互換 browser は明確な診断と終了 code `1` にする
- child が signal で終了した場合、exit code が `0` でもない場合、deadline 後も pipe / process が閉じない場合は成功にしない

## 5.3 `DockerRenderer`

- Docker はサーバーや既存 CI 向けの補助的な配布方法とし、README の第一の手順にはしない
- Docker CLI を引数配列と `shell: false` で起動する。必要なら deadline 内で明示的に pull した後、image を inspect して content-addressed image ID / digest と protocol label を同じ結果から固定し、`docker run` には tag ではなくその固定参照を渡す。inspect 後に tag が差し替わる race や `docker run` の暗黙 pull に依存しない
- generated HTML / CSS と、resource manifest が列挙した input、template、logo、font を読み取り専用 bind mount として渡す。設定は host 側で解決し、container へ環境変数全体を渡さない
- internal render command は mount された manifest を container path へ対応付けて検証し、container 内 loopback に `AssetServer` を起動してから Vivliostyle CLI を呼ぶ。host 側 server への到達、host network mode、host port の公開には依存しない
- 最終出力の親 directory は mount せず、実行ごとの空の一時 output directory だけを書き込み可能で mount する。container 成功後に host 側で検査し、最終出力の sibling 一時 file へ copy して atomic に置換する
- container entrypoint は外部向け CLI ではなく internal render command に固定し、renderer 選択や設定解決を行わないことで再帰実行を構造的に防ぐ
- host path と container path の対応を resource manifest から生成する。同じ parent directory の resource は 1 個の read-only mount にまとめるが、共通祖先へ過度に広げず、`/`、home directory 全体、最終 output directory を便宜的に mount しない
- mount 数と、それによって増える argument 数を共通 spawn 上限の計算へ含める。利用者 resource によって超える場合は asset を共通 directory の下へ整理する方法を示して code `2` とし、filesystem root の mount や asset copy へ自動 fallback しない
- Docker Desktop で共有されていない directory は、実行前の診断で mount 手順を含むエラーにする
- container は non-root user、read-only root filesystem、`no-new-privileges`、capability drop、PID 1 の signal forwarding を基本とし、Chromium が必要とする writable temp / profile だけを tmpfs または専用 volume にする
- container network の有無は local renderer と同じ remote resource 方針に合わせ、network が有効であることを隠れた sandbox 境界として扱わない
- default image は実行中の pfpdf と同じ version tag と digest policy を使う。custom image は OCI label に記録した internal renderer protocol version を `docker image inspect` で確認し、不一致や label 欠落は利用者指定の非互換設定として描画前に code `2` とする。default image 自体の label 不整合は配布物の破損として code `1`、Docker daemon / inspect / pull の実行失敗は runtime error として code `1` にする
- container には build ごとの予測不能な name と label を付け、timeout / 中断時は `docker stop`、grace period 後の `docker kill`、最後に `docker rm` を引数配列で実行する。他の container を name prefix だけで列挙・削除しない

### 5.3.1 container 内の Chromium sandbox

container hardening は Chromium sandbox と両立しない場合があります。`no-new-privileges` の下では setuid sandbox が使えず、既定の seccomp profile では user namespace の作成が拒否され得ます。user namespace を許可する最小の専用 seccomp profile を配布して sandbox を維持する案を第一候補とし、次を pinned browser の両 architecture で実証します。

- non-root、read-only root filesystem、capability drop、`no-new-privileges` の各条件を個別・組合せで試し、browser sandbox の実際の mode と失敗理由を記録する
- 専用 seccomp profile は既定 profile との差分と根拠を source 管理し、`unconfined` を成功条件に使わない
- sandbox なしでしか動かない場合は暗黙に flag を追加せず、脅威と代替を設計判断として再 review する
- Docker image の release はこの判断と `SECURITY.md` の一致を blocking gate とし、「container だから安全」という説明だけで完了にしない

### 5.3.2 Docker renderer の host 環境

`v0.1.0` では Linux host と macOS の Docker Desktop を検証対象とします。Windows host からの Docker renderer は、path 変換と file 共有を検証できるまで Experimental と表示します。

Linux では native Docker Engine、macOS では release 対象の Docker Desktop version を記録します。bind mount の permission、case sensitivity、symlink、空白 / Unicode path、host architecture と image architecture の組合せを実測し、emulation だけで native architecture の合格にしません。

## 5.4 出力の検証と move

両 renderer は直接起動した child または container の終了を待ち、捕捉可能な中断時はそれを停止します。入力 size と request count の任意な固定上限は設けませんが、PDF 構造検査までの実行時間は `--render-timeout-ms` で制限します。

- child が終了 code `0` を返した後、renderer output が symlink でない regular file で、少なくとも header と trailer を保持できる長さを持つことを確認する
- `OutputCommitter` は renderer output を固定長 buffer で exclusive create 済みの sibling 一時 file へ copy し、read / write の累計 byte 数が source の検査済み size と一致することを確認する。Docker と local で別の commit pipeline を作らない
- copy 後の sibling 一時 file について、固定長の先頭で `%PDF-1.` または `%PDF-2.` header、固定長の末尾で最後の `%%EOF` marker とその後が許可された whitespace だけであることを precheck する
- pinned した構造認識型 PDF library で xref table / stream と incremental update chain、trailer / catalog、object offset、page tree を parse し、repair mode や警告なしで 1 page 以上を読めることを必須にする。暗号化された出力、dangling object、循環 / 範囲外参照、0 page は code `1` とし、header / EOF だけが正しい壊れた PDF を commit しない
- PDF Info / XMP の title・author・timestamp と catalog `/Lang` の後処理が必要な場合は同じ library の正式 API で sibling 一時 file を更新し、更新後の最終 byte 列をもう一度構造検査する。byte 列の正規表現置換や parser の自動 repair 結果を成功出力に使わない
- PDF parse / rewrite は main event loop を占有する同期処理として実行せず、終了可能な worker thread または shell を介さない専用 child に隔離する。残り deadline を渡し、timeout / abnormal exit では worker を終了して sibling 一時 file を破棄する。循環 object graph や巨大 xref によって deadline timer と signal handler 自体が動けなくなる構成にしない
- sibling 一時 file を flush して close してから、02 章の順序で workspace cleanup と最終 path への commit を行う
- font の実選択と text 内容、画像差分までは通常実行で検査せず、独立した `pdfinfo` / `pdftotext` / `pdffonts` の CI smoke test で補う
- 生成に失敗した場合は既存出力を維持する

## 5.5 Docker image

- Docker image を提供する場合も public registry と固定 tag を使う
- `linux/amd64` と `linux/arm64` を同じ version の multi-architecture manifest で提供し、両 architecture で実 browser による PDF smoke test を行う
- Apple Silicon の Docker Desktop では native の `linux/arm64` image を利用し、architecture ごとの差異があれば文書化する
- release tag は immutable として運用し、canonical build と CI では可能な限り image digest まで記録する
- Node.js を持たない利用者向けの単体バイナリは `v0.2.0` 以降で検討する
