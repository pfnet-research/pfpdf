# 7. CLI と renderer

## 7.1 CLI の全体像

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

## 7.2 設定の優先順位

文書の内容と見た目を決める `template` / `toc` / `logo` は front matter を正本とし、CLI optionを指定した実行だけ上書きできます。優先順は組み込み既定値、front matter、CLI引数です。browser、font directory、timeout、log、workspace保持などの実行設定はCLIだけで指定します。

- `--template` と `--template-preset`、`--toc` と `--no-toc`、`--logo` と `--no-logo` をそれぞれ同時指定した場合はエラーです。`--template`はpreset名との完全一致を先に判定し、それ以外をGit locatorまたはlocal pathとして扱います。`--logo`もGit locatorとlocal pathを同じoptionで扱います
- `--font-dir` 以外の option を繰り返した場合は、同じ値でもエラーです
- どの設定がどこから来たかは `--print-effective-config` で、versioned schema の JSON object として確認できます。`--input` も指定すると front matter の `template` / `toc` / `logo` を反映し、設定元を `front-matter` と表示します

```bash
npx @pfnet-research/pfpdf@latest --input docs --print-effective-config
```

## 7.3 終了コード

`v0.1.0` は named file / directory だけを扱います。`--input -` や `--output -` で stdin / stdout を指定することはできません。

| code | 意味 |
|---:|---|
| `0` | 成功 |
| `1` | renderer、browser などの実行時エラー |
| `2` | CLI 引数、入力、front matter のエラー |

エラー時に部分的な PDF が成功として残ることはありません。pfpdf は同じ出力ディレクトリの一時ファイルへ生成し、PDF header / EOF に加えて xref、catalog、page tree と 1 page 以上を構造 parse し、renderer の成功も確認してから最終名へ置換します。既存の出力ファイルがある状態で変換に失敗した場合、既存ファイルは保持されます。

## 7.4 renderer

同梱の Vivliostyle CLI と、その標準機構が管理する Chromium を使って PDF を描画します。

- browser は初回に自動取得され、以降は cache されます
- 既にある互換 browser を使いたい場合は `--browser-path` で指定します

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --browser-path /usr/bin/chromium
```

## 7.5 timeout

browser の確認と初回取得、readiness、PDF 描画・後処理・構造検査の合計には既定で 300,000 ms(5 分)の timeout があります。大きな文書や低速な初回 download で不足する場合だけ、1,000 から 3,600,000 ms の範囲で変更します。`0` など無期限にする値は使えません。

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --render-timeout-ms 600000
```

timeout は処理 phase ごとに最初から数え直されず、renderer が最初の外部 process を起動する直前から PDF の後処理・構造検査が完了するまでの absolute deadline です。timeout になった場合は child process を停止し、既存出力を保持して終了 code `1` を返します。

## 7.6 再現可能な build

CI などで同じ入力から同じ結果を得たい場合は、環境変数 `SOURCE_DATE_EPOCH` を設定します。front matter の `date` が省略されているとき、実行日ではなくこの値の UTC 日付が使われます。

front matter に表示用の `date` が書かれていても、PDF metadata の timestamp は別に存在します。そのため `SOURCE_DATE_EPOCH` がない build は warning になり、再現可能とは扱われません。

```bash
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
  npx --yes @pfnet-research/pfpdf@0.1.0 --input docs --output docs.pdf
```

## 7.7 デバッグ

- `--log-level debug` で詳細な log と stack trace を表示します
- `--keep-work-dir` で一時 workspace を残し、生成された `document.html` / CSS、resource manifest、readiness / page error を含む renderer diagnostics を確認できます。pinned renderer が browser console event を提供しない場合、console 全体は記録されません。logical asset URL は変換終了後の server なしでは読めないため、HTML を直接開いて同じ描画になるとは限りません。diagnostics を含む workspace には入力由来の秘密情報が残り得るため、確認後は削除してください
