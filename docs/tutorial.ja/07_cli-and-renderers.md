# 7. CLI とレンダラー

## 7.1 CLI の全体像

```text
Usage: pfpdf --input INPUT --output OUTPUT [OPTIONS]

Required:
  --input PATH       Markdown ファイルまたは Markdown を含むディレクトリー
  --output PATH      .pdf の出力先

Options:
  --title TEXT             フロントマターと自動補完より優先するタイトル
  --toc / --no-toc         目次生成を有効 / 無効化する。既定は有効
  --cover / --no-cover     表紙または先頭の文書ヘッダーを有効 / 無効化する。既定は有効
  --template SOURCE        プリセット名、ローカルディレクトリー、または git::URL//PATH?ref=REVISION
  --template-preset NAME   同梱テンプレートのプリセットを明示的に選択
  --logo SOURCE            ローカルファイルまたは git::URL//PATH?ref=REVISION。テンプレートの既定値を上書き
  --no-logo                ローカル・リポジトリー・テンプレート既定のロゴを無効化
  --host-fonts             OS 標準のフォントディレクトリーを使用する
  --font-dir PATH          追加のフォントディレクトリー。複数回指定可能
  --browser-path PATH      レンダラーが使うブラウザー
  --vivliostyle-cli PATH   Vivliostyle の JavaScript エントリーポイント
  --vivliostyle-daemon SOCKET
                           Linux または macOS で起動済みのスタンドアロンデーモンを使う
  --vivliostyle-daemon-dir DIR
                           Linux または macOS で起動済みのデーモンを使う
  --render-timeout-ms N    レンダラーの準備から PDF 検査完了まで。既定は 300000
  --keep-work-dir          一時的な作業ディレクトリーを保持する
  --strict-front-matter    未知のフロントマターキーをエラーにする。既定は警告して無視
  --log-level LEVEL        error / warn / info / debug
  --print-effective-config 適用後の設定と設定元を表示して終了する
  --doctor                 レンダラー、ブラウザー、アセットを診断する
  --version                バージョンを表示する
  -h, --help               ヘルプを表示する
```

`--title` とフロントマターの `title` がどちらも未指定の場合は、入力順で最初に見つかる空でないトップレベルの Markdown H1 をタイトルに使います。H1 もなければ、`.md` を除いた入力ファイル名、または入力ディレクトリー名を使います。詳しくは第 2 章を参照してください。

## 7.2 設定の優先順位

文書の内容と見た目を決める `template` / `toc` / `cover` / `logo` は、通常はフロントマターに記述します。CLI オプションで、その実行だけ設定を上書きできます。組み込みの既定値、フロントマター、CLI 引数の順で上書きし、CLI 引数を最優先にします。

ブラウザー、フォントディレクトリー、タイムアウト、ログ、作業ディレクトリーの保持などの実行設定は、CLI だけで指定します。

- `--template` と `--template-preset`、`--toc` と `--no-toc`、`--cover` と `--no-cover`、`--logo` と `--no-logo` は、それぞれ同時に指定するとエラーになります
- `--font-dir` 以外のオプションを繰り返すと、同じ値でもエラーになります
- `--template` はプリセット名との完全一致を先に判定し、それ以外を Git ロケーターまたはローカルパスとして扱います。`--logo` は、Git ロケーターとローカルパスのどちらも受け付けます
- `--strict-front-matter` は CLI だけで指定する実行設定です。省略時は未知のフロントマターキーに警告を出して無視します。指定時は、変換と設定表示では入力エラー（終了コード `2`）、`--doctor` では入力の検査結果が `fail`（終了コード `1`）になります。警告は通常のログレベルに従って標準エラー出力（stderr）に出し、`--log-level error` なら表示しません

`--print-effective-config` は、適用後の設定と各値の設定元を、バージョン付きスキーマを持つ JSON オブジェクトとして表示します。`--input` も指定すると、フロントマターの `template` / `toc` / `cover` / `logo` を反映し、設定元を `front-matter` と表示します。

```bash
npx pfpdf --input docs --print-effective-config
```

## 7.3 終了コード

`v0.1.0` は、パスで指定したファイルとディレクトリーだけを扱います。`--input -` や `--output -` で標準入力・標準出力を指定することはできません。

| コード | 意味 |
|---:|---|
| `0` | 成功 |
| `1` | レンダラー、ブラウザーなどの実行時エラー |
| `2` | CLI 引数、入力、フロントマターのエラー |

エラー時に部分的な PDF が成功した出力として残ることはありません。pfpdf は、出力先と同じディレクトリーに一時ファイルを作ります。PDF のヘッダーと EOF に加え、xref、カタログ、ページツリーを構文解析し、1 ページ以上あることとレンダラーの成功を確認してから、指定した出力パスへ一時ファイルを移して出力を確定します。既存の出力ファイルがある状態で変換に失敗した場合は、そのファイルを保持します。

## 7.4 レンダラー

既定では、コマンドを実行した npm プロジェクトにインストールされた Vivliostyle CLI を使います。01 章の手順に従って両方のパッケージをインストールしてください。改変版を使う場合は、pfpdf をインストールし、ビルド済みの `dist/cli.js` のパスを指定します。

```bash
npm install @pfnet-research/pfpdf
npx pfpdf --input docs --output docs.pdf \
  --vivliostyle-cli ../vivliostyle-cli/dist/cli.js
```

Vivliostyle CLI が見つからない場合、変換と `--doctor` はインストール手順とパスの指定方法を表示し、終了コード `1` を返します。

- ブラウザーは初回に自動取得され、以降はキャッシュされます
- 既にある互換ブラウザーを使いたい場合は `--browser-path` で指定します

```bash
npx pfpdf --input docs --output docs.pdf \
  --browser-path /usr/bin/chromium
```

### 7.4.1 複数の変換で Vivliostyle を再利用する

Linux と macOS では、対応する Vivliostyle CLI を使うと、変換をまたいで Node.js のビルドプロセスと Chromium を再利用できます。`build-daemon --standalone` に対応する CLI の絶対パスを `cli` に設定します。

```bash
cli=/absolute/path/to/vivliostyle-cli/dist/cli.js
daemon_dir=$(mktemp -d /tmp/pfpdf-vs.XXXXXXXX)
printf '%s\n' "$daemon_dir"
node "$cli" build-daemon --standalone --socket "$daemon_dir/daemon.sock"
```

デーモンの準備完了が表示されたら、別のターミナルで表示されたパスを `daemon_dir` に設定します。変換は文書ごとに、その文書のディレクトリーから実行します。

```bash
pfpdf --input first.md --output first.pdf --vivliostyle-daemon "$daemon_dir/daemon.sock"
pfpdf --input second.md --output second.pdf --vivliostyle-daemon "$daemon_dir/daemon.sock"
```

ソケットの相対パスは、pfpdf の起動時のディレクトリーを基準に解決します。ソケットとそのディレクトリーには現在のユーザーだけがアクセスできる必要があります。`--print-effective-config` は設定されたソケットを表示し、`--doctor` は接続とプロトコルの互換性を確認します。`--browser-path` も指定した場合は、単発のビルドでブラウザーの起動も確認します。変換が終わったら、デーモンのターミナルで Ctrl+C を押し、空になったディレクトリーを `rmdir "$daemon_dir"` で削除します。

### 7.4.2 ワーカーとデーモンを手動で起動する

`build-worker`、`build-daemon`、`build --build-daemon` に対応する CLI では、サービスを手動で管理できます。`--vivliostyle-cli` で CLI を、`--vivliostyle-daemon-dir` でデーモンディレクトリーを指定します。これらのオプションと `--vivliostyle-daemon` は併用できません。単発の変換でこの CLI を使う場合は、`--vivliostyle-cli "$cli"` だけを指定します。

所有者だけがアクセスできるディレクトリーと、その中に専用の `context` ディレクトリーを作ります。先にワーカーを起動します。

```bash
cli=/absolute/path/to/vivliostyle-cli/dist/cli.js
daemon_dir=$(mktemp -d /tmp/pfpdf-vs.XXXXXXXX)
chmod 700 "$daemon_dir"
mkdir -m 700 "$daemon_dir/context"
printf '%s\n' "$daemon_dir"
node "$cli" build-worker --socket "$daemon_dir/worker.sock"
```

ワーカーの準備完了が表示されたら、別のターミナルを開きます。`cli` と `daemon_dir` に同じ絶対パスを設定し、`context` からデーモンを起動します。

```bash
cd "$daemon_dir/context"
node "$cli" build-daemon --socket "$daemon_dir/daemon.sock" \
  --browser-worker "$daemon_dir/worker.sock"
```

デーモンの準備完了が表示されたら、3 つ目のターミナルで文書のあるディレクトリーから変換します。`cli` と `daemon_dir` には同じ絶対パスを設定します。

```bash
pfpdf --input first.md --output first.pdf \
  --vivliostyle-cli "$cli" --vivliostyle-daemon-dir "$daemon_dir"
pfpdf --input second.md --output second.pdf \
  --vivliostyle-cli "$cli" --vivliostyle-daemon-dir "$daemon_dir"
```

Vivliostyle の 2 つのオプションの相対パスは、pfpdf の起動時のディレクトリーを基準に解決します。`--print-effective-config` には両方の設定と設定元が表示されます。`--doctor` は指定した CLI、`context`、ソケットを検査し、ブラウザーの起動確認には指定した CLI での単発ビルドを使います。

変換が終わったら、先にデーモンのターミナルで Ctrl+C を押し、終了を待ちます。次にワーカーのターミナルで Ctrl+C を押し、終了を待ちます。空になったディレクトリーは `rmdir "$daemon_dir/context" "$daemon_dir"` で削除できます。

## 7.5 タイムアウト

デーモンへの接続とキューでの待機、ブラウザーの確認と初回取得、描画開始の準備、PDF の描画・後処理・構造検査にかかる合計時間には、既定で 300,000 ms（5 分）のタイムアウトがあります。大きな文書や低速な初回ダウンロードで不足する場合だけ、1,000 から 3,600,000 ms の範囲で変更します。`0` など無期限にする値は使えません。

```bash
npx pfpdf --input docs --output docs.pdf \
  --render-timeout-ms 600000
```

期限は、デーモンへの接続やレンダラーの起動の直前から、PDF の後処理・構造検査が完了するまでに適用されます。処理の段階が変わっても、最初から数え直しません。タイムアウトした場合は子プロセスを停止し、既存出力を保持して終了コード `1` を返します。

## 7.6 再現可能なビルド

CI などで同じ入力から同じ結果を得たい場合は、環境変数 `SOURCE_DATE_EPOCH` を設定します。フロントマターの `date` が省略されているときは、実行日ではなくこの値の UTC 日付が使われます。
1.3 節の手順でバージョンを固定した npm プロジェクトを使います。

フロントマターに表示用の `date` が書かれていても、PDF メタデータのタイムスタンプは別に存在します。そのため、`SOURCE_DATE_EPOCH` を設定しないビルドでは警告が出され、再現可能とは扱われません。

```bash
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
  npx pfpdf --input docs --output docs.pdf
```

## 7.7 デバッグ

- `--log-level debug` で詳細なログとスタックトレースを表示します
- `--keep-work-dir` で一時的な作業ディレクトリーを残し、生成された `document.html` / CSS、リソースマニフェスト、描画開始の準備状況やページのエラーを含むレンダラーの診断情報を確認できます

バージョンを固定したレンダラーがブラウザーのコンソールイベントを提供しない場合、コンソール全体は記録されません。リソースに割り当てた論理 URL は、変換終了後にサーバーが停止すると読めないため、HTML を直接開いても同じ描画になるとは限りません。診断情報を含む作業ディレクトリーには入力由来の秘密情報が残り得るため、確認後は削除してください。
