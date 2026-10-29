# 8. troubleshooting

## 8.1 まず `--doctor`

問題が起きたら、最初に `--doctor` を実行してください。

```bash
npx @pfnet-research/pfpdf@latest --doctor
```

Node.js の version、browser の有無、フォント、出力先の権限などを検査し、問題を対処方法とともに報告します。`--input` / `--output` を付けて実行すると、その文書のリソースと書き込み先まで検査します。stdout は versioned schema の JSON object 1 個なので、CI からも parse できます。通常 log は stderr に分離されます。

`--doctor` は browser の download、project / output directory の作成、OS 設定変更を行いません。実起動の検査には隔離した一時 profile を使い、検査後に削除します。各外部 check は cleanup を含めて 10 秒、全体は 60 秒で timeout します。

browser check が失敗した場合、`checks` の `id: "browser"` にある `message` に終了 code・signal・timeout と子 process の stderr を含めます。stderr の抜粋は UTF-8 で最大 4 KiB とし、長い場合は先頭と末尾を残して省略を明示します。未知のエラーでもこの抜粋を確認できます。root / sandbox、user namespace / AppArmor、shared library、実行ファイルの既知の失敗には原因の目安も付けます。診断は JSON の文字列として出力するため、stderr 内の改行が stdout の JSON を分割することはありません。

設定が意図どおりに効いているか確認したいときは `--print-effective-config` を使います。各設定値と、それが CLI・front matter・既定値のどれから来たかが JSON で表示されます。front matter の `template` / `toc` / `logo` を確認する場合は `--input` も指定します。

## 8.2 Node.js の version が古い

pfpdf は起動直後に Node.js の version を検査し、対応 range 外なら明確なエラーで終了します(終了 code `1`)。README に記載された semver range 内の Node.js を導入してください。単に数値が新しければ常に対応するとは限りません。

## 8.3 browser の download が失敗する

初回実行時の Chromium 取得は、同梱の Vivliostyle CLI とその browser manager の標準機構で行われます。

- proxy 環境や custom CA が必要な環境では、Vivliostyle CLI / Puppeteer の手順に従って設定してください
- 既に互換 browser がある場合は `--browser-path` で明示できます

## 8.4 Linux で browser が起動しない(shared library 不足)

Linux では browser 本体に加えて OS の shared library が必要です。package 名は distribution と release により変わるため、`--doctor` が報告する不足 library と、設計書の compatibility 章に記録された検証済み distribution / browser revision の一覧を確認してください。別 release 向けの package 名をそのまま install しないでください。

pfpdf が root 権限で package を自動 install することはありません。OS package の追加は、利用している distribution の package manager と運用方針に従って明示的に行います。

## 8.5 Linux で sandbox が起動できない

shared library が揃っていても、Ubuntu 23.10 以降の unprivileged user namespace 制限などにより Chromium sandbox を起動できない環境があります。これは library 不足とは別の問題で、pfpdf の診断でも区別して報告されます。

`root execution refused` は root 実行に対する browser の拒否です。非 root ユーザーで実行してください。`user namespace or AppArmor restriction` は非 root でも起きる host 側の制限を示します。`browser sandbox unavailable` はその他の sandbox 起動失敗の目安です。いずれも `message` 内に残した元の stderr と合わせて確認してください。

回避には root 権限での設定変更が必要です。例として Ubuntu では、Chromium の実行ファイルに対する AppArmor profile を追加する方法が知られています。変更できない環境では、sandbox を利用できる別の対応環境で変換してください。

### Docker で実行する (Ubuntu 24.04、amd64)

repository checkout の `examples/docker/ubuntu24.Dockerfile` は Ubuntu 24.04、Node.js 22.23.2、lockfile の依存から pfpdf を build します。browser の shared library と初回 download の展開に必要な `unzip` を含み、実行 user は非 root です。対象は amd64 です。Arm64 host では Docker の amd64 emulation が必要です。

repository root で次を実行します。host 側でも非 root user を使い、出力と cache をその user が所有する directory にします。

```bash
docker build --platform linux/amd64 \
  -f examples/docker/ubuntu24.Dockerfile -t pfpdf-ubuntu24 .
PFPDF_CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/pfpdf-docker"
mkdir -p input output "$PFPDF_CACHE_DIR"
cat > input/memo.md <<'EOF'
---
title: Docker example
lang: en
---
# Memo

PDF from a container.
EOF
docker run --rm --platform linux/amd64 --init \
  --cap-add=SYS_ADMIN --user "$(id -u):$(id -g)" \
  --env SOURCE_DATE_EPOCH=0 \
  --mount "type=bind,source=$(pwd)/input,target=/input,readonly" \
  --mount "type=bind,source=$(pwd)/output,target=/output" \
  --mount "type=bind,source=$PFPDF_CACHE_DIR,target=/cache" \
  pfpdf-ubuntu24 --input /input/memo.md --output /output/memo.pdf
```

`SYS_ADMIN` は、この container で Chromium sandbox を起動するための capability です。[Puppeteer の Docker 手順](https://pptr.dev/guides/docker)も sandbox 実行にこの capability を要求します。追加 capability を許容する運用環境で使ってください。pfpdf は引き続き trusted document を処理し、root での変換や sandbox を無効にする CLI option は提供しません。

入力は read-only、出力と `/cache` は書込み可能として mount します。`--user` で host と同じ UID / GID を使うため、出力の所有者も host user になります。`HOME=/tmp`、`XDG_CACHE_HOME=/cache` は image に設定済みです。初回は Chromium を `/cache/vivliostyle/browsers` へ download し、同じ cache directory を mount した2回目以降は再利用します。変換後に、同じ `docker run` の末尾を `--doctor` に置き換えると、download 済み browser の起動を検査できます。空 cache の doctor は download せず warning を返します。

`root execution refused` なら実行 UID を確認します。非 root で `user namespace or AppArmor restriction` / `No usable sandbox` が出る場合は、capability、Docker の seccomp policy、host の user namespace / AppArmor policy を確認します。Ubuntu 24.04 host の制限は container 内の user を変更するだけでは解除されません。[Ubuntu の AppArmor の説明](https://ubuntu.com/server/docs/how-to/security/apparmor/)を参照し、host 管理者が browser に適した profile を用意するか、sandbox を利用できる host で実行してください。host 全体の保護を無効にする手順は既定の実行例には含めません。

検証環境: Ubuntu 24.04 amd64 container、Node.js 22.23.2、Vivliostyle CLI 11.1.0、管理対象 Chrome 150.0.7871.115。Arm64 Docker daemon の amd64 emulation 上で、新規 cache・再利用 cache、read-only 入力、host user 所有の出力、doctor 成功を確認しました。root の拒否と capability なしの起動失敗も確認しました。Ubuntu host 固有の AppArmor profile の実機検証は別途必要です。

## 8.6 日本語が豆腐(□)になる / フォントが意図と違う

- 既定では同梱の日本語フォントが使われるため、通常は tofu になりません
- custom template で独自の font family を指定している場合、その family が見つからないと同梱フォントへ fallback し、warning が出ます
- host font を使いたい場合は `--host-fonts` / `--font-dir` を明示してください(06 章)。どのフォントファイルが選ばれたかは `--log-level debug` と `--doctor` で確認できます

## 8.7 数式やコードハイライトが効かない

- 数式・コードハイライトは同梱アセットで動作し、ネットワークは不要です
- `$` を数式にしたくない場合は `\$` と escape してください(05 章)
- 文書内の `<script>` が readiness 完了前に error になると変換全体が失敗します。非同期描画は `window.pfpdf.registerReady(promise)` へ登録してください。`--keep-work-dir` で `document.html` と renderer diagnostics を残して確認できます

## 8.8 描画が timeout になる

- 既定の timeout は browser の準備、readiness、描画、PDF 後処理 / 構造検査を合わせて 5 分です。debug log でどの phase に時間を使ったか確認してください
- remote resource、未完了の登録 promise、script の無限 loop、巨大画像、過度に複雑な CSS がないか確認します
- 正常だが大きい文書だけが超過する場合は `--render-timeout-ms` を増やせます。`0` で無期限にはできません
- timeout 後に既存 PDF は上書きされません。child process の強制終了まで短い猶予があるため、CLI の終了を待ってから再実行してください

## 8.9 出力ファイルが更新されない

変換に失敗した場合、既存の出力 PDF は上書きされずそのまま残ります。終了 code を確認してください(`0` 以外は失敗です)。CI では `pfpdf` の終了 code をそのまま判定に使えます。

PDF header や最後の `%%EOF` がない切断出力だけでなく、xref / catalog / page tree が壊れた出力、暗号化された出力、0 page の出力も失敗として破棄されます。Windows では既存 PDF を viewer が排他的に開いていると最終置換に失敗する場合があります。その場合は viewer を閉じて再実行してください。pfpdf は置換のために既存 PDF を先に削除しません。

`SIGKILL` や電源断の直後には、出力 directory に `.pfpdf-...tmp` が残る場合があります。pfpdf は別 process の file を誤って消さないよう自動回収しません。pfpdf process が動いていないことを確認してから手動で削除してください。

## 8.10 それでも解決しないとき

- `--log-level debug` で詳細 log と stack trace を確認する
- `--keep-work-dir` で workspace を残し、生成された `document.html`、resource manifest、renderer diagnostics を確認する
- issue を報告する際は、OS / architecture、Node.js version、pfpdf version、`--doctor` の出力を添えてください
