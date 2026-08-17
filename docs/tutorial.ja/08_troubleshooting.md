# 8. troubleshooting

## 8.1 まず `--doctor`

問題が起きたら、最初に `--doctor` を実行してください。

```bash
npx @pfnet-research/pfpdf@latest --doctor
```

Node.js の version、browser の有無、Docker daemon、フォント、出力先の権限などを検査し、問題を対処方法とともに報告します。`--input` / `--output` を付けて実行すると、その文書のリソースと書き込み先まで検査します。stdout は versioned schema の JSON object 1 個なので、CI からも parse できます。通常 log は stderr に分離されます。

`--doctor` は browser の download、Docker image の pull、project / output directory の作成、OS 設定変更を行いません。実起動や mount の検査には隔離した一時 profile / container を使い、検査後に削除します。各外部 check は cleanup を含めて 10 秒、全体は 60 秒で timeout します。

設定が意図どおりに効いているか確認したいときは `--print-effective-config` を使います。各設定値と、それが CLI・環境変数・既定値のどれから来たかが JSON で表示されます。

## 8.2 Node.js の version が古い

pfpdf は起動直後に Node.js の version を検査し、対応 range 外なら明確なエラーで終了します(終了 code `1`)。README に記載された semver range 内の Node.js を導入してください。単に数値が新しければ常に対応するとは限りません。

## 8.3 browser の download が失敗する

初回実行時の Chromium 取得は、同梱の Vivliostyle CLI とその browser manager の標準機構で行われます。

- proxy 環境や custom CA が必要な環境では、Vivliostyle CLI / Puppeteer の手順に従って設定してください
- 既に互換 browser がある場合は `--browser-path` / `PFPDF_BROWSER_PATH` で明示できます

## 8.4 Linux で browser が起動しない(shared library 不足)

Linux では browser 本体に加えて OS の shared library が必要です。package 名は distribution と release により変わるため、`--doctor` が報告する不足 library と、設計書の compatibility 章に記録された検証済み distribution / browser revision の一覧を確認してください。別 release 向けの package 名をそのまま install しないでください。

pfpdf が root 権限で package を自動 install することはありません。OS package の追加は、利用している distribution の package manager と運用方針に従って明示的に行います。

## 8.5 Linux で sandbox が起動できない

shared library が揃っていても、Ubuntu 23.10 以降の unprivileged user namespace 制限などにより Chromium sandbox を起動できない環境があります。これは library 不足とは別の問題で、pfpdf の診断でも区別して報告されます。

回避には root 権限での設定変更が必要です。例として Ubuntu では、Chromium の実行ファイルに対する AppArmor profile を追加する方法が知られています。root 作業が難しい環境では、Docker renderer の利用を検討してください。

## 8.6 日本語が豆腐(□)になる / フォントが意図と違う

- 既定では同梱の日本語フォントが使われるため、通常は tofu になりません
- custom template で独自の font family を指定している場合、その family が見つからないと同梱フォントへ fallback し、warning が出ます
- host font を使いたい場合は `--host-fonts` / `--font-dir` を明示してください(06 章)。どのフォントファイルが選ばれたかは `--log-level debug` と `--doctor` で確認できます

## 8.7 数式やコードハイライトが効かない

- 数式・コードハイライトは同梱アセットで動作し、ネットワークは不要です
- `$` を数式にしたくない場合は `\$` と escape してください(05 章)
- 文書内の `<script>` が readiness 完了前に error になると変換全体が失敗します。非同期描画は `window.pfpdf.registerReady(promise)` へ登録してください。`--keep-work-dir` で `document.html` と renderer diagnostics を残して確認できます

## 8.8 描画が timeout になる

- 既定の timeout は Docker image / browser の準備、readiness、描画、PDF 後処理 / 構造検査を合わせて 5 分です。debug log でどの phase に時間を使ったか確認してください
- remote resource、未完了の登録 promise、script の無限 loop、巨大画像、過度に複雑な CSS がないか確認します
- 正常だが大きい文書だけが超過する場合は `--render-timeout-ms` を増やせます。`0` で無期限にはできません
- timeout 後に既存 PDF は上書きされません。child / container の強制終了まで短い猶予があるため、CLI の終了を待ってから再実行してください

## 8.9 Docker renderer のエラー

- Docker daemon が起動しているか `--doctor` で確認してください
- Docker Desktop では、入力やロゴのある directory が file sharing の対象になっている必要があります。共有されていない場合、実行前の診断が mount 手順を含むエラーを表示します
- image は固定 tag で取得されます。別 version を使う場合は `--docker-image` を指定してください
- custom image の internal renderer protocol が現在の pfpdf と一致しない場合は、同じ version の image を指定してください

## 8.10 出力ファイルが更新されない

変換に失敗した場合、既存の出力 PDF は上書きされずそのまま残ります。終了 code を確認してください(`0` 以外は失敗です)。CI では `pfpdf` の終了 code をそのまま判定に使えます。

PDF header や最後の `%%EOF` がない切断出力だけでなく、xref / catalog / page tree が壊れた出力、暗号化された出力、0 page の出力も失敗として破棄されます。Windows では既存 PDF を viewer が排他的に開いていると最終置換に失敗する場合があります。その場合は viewer を閉じて再実行してください。pfpdf は置換のために既存 PDF を先に削除しません。

`SIGKILL` や電源断の直後には、出力 directory に `.pfpdf-...tmp` が残る場合があります。pfpdf は別 process の file を誤って消さないよう自動回収しません。pfpdf process が動いていないことを確認してから手動で削除してください。

## 8.11 それでも解決しないとき

- `--log-level debug` で詳細 log と stack trace を確認する
- `--keep-work-dir` で workspace を残し、生成された `document.html`、resource manifest、renderer diagnostics を確認する
- issue を報告する際は、OS / architecture、Node.js version、pfpdf version、`--doctor` の出力を添えてください
