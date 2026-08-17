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
  --template NAME          bundled template 名。既定値は default
  --template-dir PATH      custom template directory
  --logo PATH / --no-logo  template に渡す logo file / 環境変数の logo を無効化
  --renderer MODE          local または docker。既定値は local
  --host-fonts             OS 標準の font directory を使用する
  --no-host-fonts          環境変数の host font 指定を無効化する
  --font-dir PATH          追加 font directory。複数回指定可能
  --no-font-dirs           環境変数の追加 font directory を無効化
  --browser-path PATH      local renderer が使う browser
  --managed-browser        環境変数の browser path を無効化
  --docker-image IMAGE     Docker renderer が使う image と tag
  --default-docker-image   環境変数の Docker image を無効化
  --render-timeout-ms N    renderer 準備から PDF 検査完了まで。既定は 300000
  --keep-work-dir / --no-keep-work-dir
                           一時 workspace の保持 / 環境変数の保持指定を無効化
  --log-level LEVEL        error / warn / info / debug
  --print-effective-config 適用後の設定と設定元を表示して終了する
  --doctor                 renderer、browser、mount、asset を診断する
  --version                バージョンを表示する
  -h, --help               ヘルプを表示する
```

## 7.2 環境変数

CLI 引数の多くは環境変数でも設定できます。同じ項目が両方にある場合は、常に CLI 引数が優先されます。

| 環境変数 | 対応する CLI |
|---|---|
| `PFPDF_RENDERER` | `--renderer` |
| `PFPDF_TOC` | `--toc` / `--no-toc` |
| `PFPDF_HOST_FONTS` | `--host-fonts` / `--no-host-fonts` |
| `PFPDF_FONT_DIRS` | `--font-dir` / `--no-font-dirs`(複数は path 区切り文字で連結) |
| `PFPDF_TEMPLATE` | `--template` |
| `PFPDF_TEMPLATE_DIR` | `--template-dir` |
| `PFPDF_LOGO` | `--logo` / `--no-logo` |
| `PFPDF_BROWSER_PATH` | `--browser-path` / `--managed-browser` |
| `PFPDF_DOCKER_IMAGE` | `--docker-image` / `--default-docker-image` |
| `PFPDF_RENDER_TIMEOUT_MS` | `--render-timeout-ms` |
| `PFPDF_KEEP_WORK_DIR` | `--keep-work-dir` / `--no-keep-work-dir` |
| `PFPDF_LOG_LEVEL` | `--log-level` |
| `SOURCE_DATE_EPOCH` | 対応 CLI なし。表示日付と PDF metadata の再現性に使用 |

- boolean の環境変数は `true` / `false` / `1` / `0` だけを受け付けます
- `--font-dir` のような list は CLI と環境変数を混ぜません。CLI で 1 個でも指定すれば CLI の list 全体が使われます
- `--template` と `--template-dir` を同じ場所で両方指定した場合や、`--toc` と `--no-toc` を同時指定した場合はエラーです。CLI で template の一方を選べば、環境変数側の template 選択全体を上書きします
- `--font-dir` 以外の option を繰り返した場合は、同じ値でもエラーです。`PFPDF_FONT_DIRS` に空の path component を入れて current directory を表すこともできません
- optional な環境変数を 1 回だけ無効化するには、`--no-logo`、`--no-font-dirs`、`--managed-browser`、`--default-docker-image`、`--no-keep-work-dir` を使います。これらは明示的な CLI 値として環境変数より優先されます
- どの設定がどこから来たかは `--print-effective-config` で、versioned schema の JSON object として確認できます

```bash
PFPDF_TEMPLATE=pfn npx @pfnet-research/pfpdf@latest --print-effective-config
```

## 7.3 終了コード

`v0.1.0` は named file / directory だけを扱います。`--input -` や `--output -` で stdin / stdout を指定することはできません。

| code | 意味 |
|---:|---|
| `0` | 成功 |
| `1` | renderer、browser、Docker などの実行時エラー |
| `2` | CLI 引数、入力、front matter のエラー |

エラー時に部分的な PDF が成功として残ることはありません。pfpdf は同じ出力ディレクトリの一時ファイルへ生成し、PDF header / EOF に加えて xref、catalog、page tree と 1 page 以上を構造 parse し、renderer の成功も確認してから最終名へ置換します。既存の出力ファイルがある状態で変換に失敗した場合、既存ファイルは保持されます。

## 7.4 local renderer(既定)

既定の `--renderer local` では、同梱の Vivliostyle CLI と、その標準機構が管理する Chromium を使ってローカルで PDF を描画します。

- browser は初回に自動取得され、以降は cache されます
- 既にある互換 browser を使いたい場合は `--browser-path` または `PFPDF_BROWSER_PATH` で指定します

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --browser-path /usr/bin/chromium
```

## 7.5 Docker renderer

サーバーや CI などで、browser の実行環境をコンテナに閉じ込めたい場合は Docker renderer を使えます。

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf --renderer docker
# または
PFPDF_RENDERER=docker npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf
```

- 公開 registry 上の pfpdf image が使われます。image は `--docker-image` で指定でき、実行時には pull / inspect 後の image ID または digest に固定されます
- 入力、template、ロゴ、フォントは読み取り専用で mount され、書き込みは一時 directory だけに限定されます
- local renderer が失敗しても Docker へ自動では切り替わりません。renderer の切替は常に明示的です
- host 環境としては Linux と macOS の Docker Desktop が検証されています。Windows host からの Docker renderer は Experimental です
- `--docker-image` で指定した image は、現在の pfpdf と internal renderer protocol が一致する必要があります。不一致は描画前にエラーになります

## 7.6 timeout

Docker image / browser の確認と初回取得、readiness、PDF 描画・後処理・構造検査の合計には既定で 300,000 ms(5 分)の timeout があります。大きな文書や低速な初回 download で不足する場合だけ、1,000 から 3,600,000 ms の範囲で変更します。`0` など無期限にする値は使えません。

```bash
npx @pfnet-research/pfpdf@latest --input docs --output docs.pdf \
  --render-timeout-ms 600000
```

timeout は処理 phase ごとに最初から数え直されず、renderer が最初の外部 process を起動する直前から PDF の後処理・構造検査が完了するまでの absolute deadline です。timeout になった場合は child process / container を停止し、既存出力を保持して終了 code `1` を返します。

## 7.7 再現可能な build

CI などで同じ入力から同じ結果を得たい場合は、環境変数 `SOURCE_DATE_EPOCH` を設定します。front matter の `date` が省略されているとき、実行日ではなくこの値の UTC 日付が使われます。

front matter に表示用の `date` が書かれていても、PDF metadata の timestamp は別に存在します。そのため `SOURCE_DATE_EPOCH` がない build は warning になり、再現可能とは扱われません。

```bash
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
  npx --yes @pfnet-research/pfpdf@0.1.0 --input docs --output docs.pdf
```

## 7.8 デバッグ

- `--log-level debug` で詳細な log と stack trace を表示します
- `--keep-work-dir` で一時 workspace を残し、生成された `document.html` / CSS、resource manifest、readiness / page error を含む renderer diagnostics を確認できます。pinned renderer が browser console event を提供しない場合、console 全体は記録されません。logical asset URL は変換終了後の server なしでは読めないため、HTML を直接開いて同じ描画になるとは限りません。diagnostics を含む workspace には入力由来の秘密情報が残り得るため、確認後は削除してください
