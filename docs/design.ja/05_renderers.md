# 5. renderer

## 5.1 `Renderer` interface

`Renderer` interface は生成済み `document.html`、resource manifest、出力用一時 path、一時 workspace、effective config、absolute deadline、`AbortSignal` を持つ immutable な `RenderJob` を受け取ります。renderer は `HtmlDocumentBuilder` が作った HTML byte 列を `AssetServer` から取得し、Markdown 変換や設定解決を繰り返しません。

- renderer は成功時に output path、byte size、経過時間を返し、失敗時に部分出力を結果 object として返さない
- timeout は renderer が最初の外部 process を起動する直前から browser の確認と取得、readiness、描画、PDF metadata 後処理、構造検査を合わせた既定 300 秒の absolute deadline とする。phase や child ごとに timeout を reset して総時間が無制限に伸びないよう、すべての待機へ残り時間を渡す
- CLI と文書変換処理には renderer 選択を公開せず、単一の描画経路を使う

## 5.2 Vivliostyle renderer

- Vivliostyle CLI は Node.js の child process として呼び出し、pfpdf 本体との境界を明確にする
- `AssetServer` の document URL を入力として渡し、workspace の `file:` URL を別生成しない
- Vivliostyle CLI を `PATH` や `npx` で解決せず、pfpdf が package 解決した entry point を `process.execPath` の Node.js で起動する
- pinned Vivliostyle CLI が標準管理する browser、または利用者が明示した検証済み browser を使い、確認済みの option 名を渡す。browser の取得・cache recovery は pfpdf で再実装しない
- shell 文字列を組み立てず、引数配列と `shell: false` で child process を起動する
- upstream が提供する sandbox を不必要に無効化しない
- child の stdout / stderr は parent の stdout へ転送せず、必要な log level では stderr へ stream し、renderer diagnostics に保存する。trusted input 前提のため内容の sanitize や credential redaction は行わない
- 保存する renderer diagnostics は 8 MiB を上限とし、超過後も child pipe は捨てずに drain して deadlock を防ぐ。file には truncation と省略 byte 数を記録し、log volume に比例して process memory を増やさない。stderr への転送量自体は呼出側が管理するものとし、stdout へ迂回しない
- timeout、`SIGINT`、`SIGTERM` では新しい処理を開始せず、まず graceful termination を要求し、5 秒後に強制終了する。cleanup 全体にも 15 秒の上限を持たせる。POSIX では専用 process group、Windows では利用可能な process-tree termination を使って browser descendant も best effort で回収する。上限後も OS が終了を確認できない PID は診断へ明記し、成功扱いしない
- browser executable の存在・regular file 性・実行可否は conversion 前に検査するが、最小 HTML を使う追加起動は毎回行わず `--doctor` で行う。実変換で判明した非互換 browser は明確な診断と終了 code `1` にする
- child が signal で終了した場合、exit code が `0` でもない場合、deadline 後も pipe / process が閉じない場合は成功にしない

## 5.3 出力の検証と move

renderer は直接起動した child の終了を待ち、捕捉可能な中断時はそれを停止します。入力 size と request count の任意な固定上限は設けませんが、PDF 構造検査までの実行時間は `--render-timeout-ms` で制限します。

- child が終了 code `0` を返した後、renderer output が symlink でない regular file で、少なくとも header と trailer を保持できる長さを持つことを確認する
- `OutputCommitter` は renderer output を固定長 buffer で exclusive create 済みの sibling 一時 file へ copy し、read / write の累計 byte 数が source の検査済み size と一致することを確認する
- copy 後の sibling 一時 file について、固定長の先頭で `%PDF-1.` または `%PDF-2.` header、固定長の末尾で最後の `%%EOF` marker とその後が許可された whitespace だけであることを precheck する
- pinned した構造認識型 PDF library で xref table / stream と incremental update chain、trailer / catalog、object offset、page tree を parse し、repair mode や警告なしで 1 page 以上を読めることを必須にする。暗号化された出力、dangling object、循環 / 範囲外参照、0 page は code `1` とし、header / EOF だけが正しい壊れた PDF を commit しない
- PDF Info / XMP の title・author・timestamp と catalog `/Lang` の後処理が必要な場合は同じ library の正式 API で sibling 一時 file を更新し、更新後の最終 byte 列をもう一度構造検査する。byte 列の正規表現置換や parser の自動 repair 結果を成功出力に使わない
- PDF parse / rewrite は main event loop を占有する同期処理として実行せず、終了可能な worker thread または shell を介さない専用 child に隔離する。残り deadline を渡し、timeout / abnormal exit では worker を終了して sibling 一時 file を破棄する。循環 object graph や巨大 xref によって deadline timer と signal handler 自体が動けなくなる構成にしない
- sibling 一時 file を flush して close してから、02 章の順序で workspace cleanup と最終 path への commit を行う
- font の実選択と text 内容、画像差分までは通常実行で検査せず、独立した `pdfinfo` / `pdftotext` / `pdffonts` の CI smoke test で補う
- 生成に失敗した場合は既存出力を維持する
