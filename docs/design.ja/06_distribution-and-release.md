# 6. 配布とリリース

## 6.1 npm パッケージ設計

- リポジトリーと CI では、`package-lock.json` で依存ツリー全体と integrity 値を固定する。公開パッケージのインストールでは `package-lock.json` が使われないため、`package.json` で実行時の直接依存を厳密なバージョンに固定する。レビュー済みのロックファイルと同じ依存ツリーから、公開準備用の隔離ディレクトリーで `npm-shrinkwrap.json` を生成し、tarball に含める
- semver で表す Node.js の対応範囲は、バージョンを固定した Vivliostyle CLI と実行時の直接依存すべての要件の共通部分から確定する。範囲が非連続の場合も、単に最低バージョン以上という範囲へ広げない。`package.json` の `engines`、起動時検査、4 つの対応環境の CI で同じ範囲を使う
- TypeScript のコンパイルターゲットと公開する JavaScript の構文は、対応範囲の最も古いランタイムで読み込めるものにする。梱包したパッケージのテストをそのランタイムで行い、バージョンエラーを出すエントリーポイント自体が、未対応の構文によって構文解析エラーにならないことを確認する
- ブラウザーの取得とキャッシュは、バージョンを固定した Vivliostyle CLI の標準機構に任せ、pfpdf は `--browser-path` による明示的な上書きだけを提供する
- npm tarball にはコンパイル済みの JavaScript、テンプレート、CSS、フォント、MathJax、highlight.js、ライセンス文書を含める
- `npm pack --dry-run` で内容をレビューし、`npm-shrinkwrap.json` が含まれ、`package-lock.json` が含まれないことを確認する。独自のサイズ上限、SBOM、署名、provenance はリリース要件にしない
- pfpdf 自身のライフサイクルスクリプトによる暗黙のブラウザーのダウンロードや root 権限の変更は行わない。間接依存のライフサイクルスクリプトも、ロックファイルのレビューとクリーンインストールのテストで確認する。ブラウザーの取得が必要な場合は、最初の明示的な実行時に上流の標準機構を使う

## 6.2 公開 tarball の内容

npm パッケージ `@pfnet-research/pfpdf` の `bin` フィールドで、コンパイル済みの `dist/launcher.js` を `pfpdf` として公開します。

- 公開 tarball にはパッケージのメタデータと shrinkwrap、`dist/`、必要なリソース、README、ライセンス文書だけを含め、TypeScript のソースマップにローカルの絶対パスが残らないことを確認する
- `package.json` の `files` による許可リストと、CI 上で展開した tarball の確認を使い、テスト用フィクスチャー、`.env`、キャッシュなどを公開しない
- npm パッケージ名は組織スコープの `@pfnet-research/pfpdf` とする。スコープを持たない `pfpdf` は、既存パッケージ `jspdf` との類似名判定によりレジストリーから拒否されるため使わない。公開時は `--access public` または同等の `publishConfig.access` を必須とする

## 6.3 ディレクトリー構成

```text
pfpdf/
  .github/workflows/
    ci.yml
    release-please.yml
    release.yml
  src/
    asset-server.ts
    browser.ts
    cli.ts
    settings.ts
    input.ts
    resources.ts
    markdown/
      index.ts
      gfm-adapter.ts
      japanese-strong.ts
      pfpdf-directives.ts
    document.ts
    readiness.ts
    fonts.ts
    templates.ts
    workspace.ts
    output.ts
    renderer.ts
  resources/
    templates/
      default/
      pfn/
    fonts/
    mathjax/
    highlight.js/
  docs/
    design.ja/  design.en/
    tutorial.ja/  tutorial.en/
  scripts/
    check-doc-policy.mjs
    check-doc-translations.mjs
    check-workflows.mjs
    release-lib.mjs
    release.mjs
  tests/
  Makefile
  release-please-config.json
  .release-please-manifest.json
  package.json
  package-lock.json
  tsconfig.json
  AGENTS.md
  README.md
  CHANGELOG.md
  CONTRIBUTING.md
  SECURITY.md
  CODE_OF_CONDUCT.md
  NOTICE.md
  THIRD_PARTY_LICENSES.md
  LICENSE
```

Make ターゲットの生成物を置く `build/docs/` は、`.gitignore` の `build/` によって除外します。生成した PDF はソースツリーにコミットしません。

## 6.4 CI とサプライチェーン

- npm パッケージの CI では、macOS aarch64、Linux x86_64、Windows x86_64、Linux aarch64 のマトリックスを使い、4 環境すべてで Node.js のテストと、実際に PDF を生成するスモークテストを行う
- 第三者の GitHub Action は、参照先が変わり得るタグではなく、レビュー済みのコミット SHA で固定し、更新元のタグをコメントに残す
- `package-lock.json` の差分をレビュー対象にする
- 公開準備用に生成した `npm-shrinkwrap.json` の依存関係と integrity 値が、レビュー済みの `package-lock.json` と一致しない場合は公開を禁止する。生成物をソース側のロックファイルの代わりに手編集しない
- Dependabot または Renovate は更新用のプルリクエストを作るだけとし、自動マージしない
- プルリクエストごとに TypeScript のテスト、lint、4 環境での最小限の PDF スモークテストを実行する。リリースタグでは、リリースワークフローが一度だけ梱包した同じ npm tarball を 4 環境すべてでインストールし、実際に PDF を生成するスモークテストを行う
- プルリクエストごとに `make docs-release docs-template-samples` を実行し、公開用の日本語の正本と英語の翻訳、および同梱テンプレートすべてによる共通プレビューをビルドできることを確認する。全テンプレートの画像を詳しくレビューするには、`make docs-template-images` を使う
- `scripts/check-doc-translations.mjs` で日英のファイルの対応と変更の同期を検査し、翻訳の意味上の一致はプルリクエストのレビューで必須の確認項目にする
- `scripts/check-doc-policy.mjs` で、すべての `AGENTS.md` に日本語文字が含まれないことを検査する
- Vivliostyle CLI は npm の最新版を実行時に無条件に取得せず、検証済みの 1 バージョンを、直接依存の厳密なバージョン指定、ソース側のロックファイル、公開用 shrinkwrap で固定する。更新は自動マージせず、各対象 OS でのサンプル PDF のスモークテスト後に行う
- CI のテストコマンドはネットワークから適合性検査用のフィクスチャーやスクリプトを取得せず、ロックファイルとリポジトリーに固定した入力だけを使う。依存関係のダウンロードが必要なジョブと、オフライン時の挙動の検査を分ける
- Release Please は Conventional Commit をリリースに含める変更の単位としてリリース PR を更新し、バージョン、`CHANGELOG.md`、`package-lock.json`、`npm-shrinkwrap.json` を同じ PR で変更する。`0.x` の破壊的変更を含むバージョンの判断とリリースノートは、マージ前に人がレビューする
- Release Please が作る PR やタグからも通常のワークフローを起動できるよう、リリース専用 GitHub App の短命なインストールトークンを使う。App は、現在のリポジトリーの Contents、Pull requests、Issues だけに必要最小限の書き込み権限を持ち、個人 PAT は使わない

## 6.5 公開

- Release Please はリリース PR のマージコミットに `v<package version>` タグと下書きの GitHub Release を作る。タグの作成を契機に `.github/workflows/release.yml` が始まる。手動で再開するときは、`gh workflow run release.yml --ref v<package version>` でワークフロー自体を既存のタグから開始し、ブランチから別のタグを入力する方式は許可しない。タグ、`package.json`、ロックファイル、CHANGELOG のバージョンが一致しない場合は、公開前に失敗させる
- タグが指す同じソースリビジョンから npm tarball と 4 文書の PDF を一度だけビルドし、GitHub Actions のアーティファクトに保存する。承認後に再ビルドせず、この tarball と PDF をそのまま公開まで使う
- 梱包した tarball について、ファイルの許可リスト、パッケージ名、バージョン、shrinkwrap、チェックサム、ライセンスファイルを検査し、空の一時プロジェクトへインストールする。インストール時に生成されたロックファイルのパッケージパス、バージョン、取得元、integrity 値が公開用 shrinkwrap と一致することを確認する。同じ tarball を macOS aarch64、Linux x86_64、Windows x86_64、Linux aarch64 での `npm ls --all --json`、`pfpdf --version`、実際に PDF を生成するスモークテストに使う
- GitHub Release は最初に下書きとして作成し、`build/docs/release/` の 4 PDF と `SHA256SUMS` だけをアップロードする。アップロード直後と公開直前に、リモートにある添付ファイルの一覧、アップロード状態、サイズ、SHA-256 ダイジェストを公開準備用メタデータと照合し、すべてが完全に一致することを確認する。テンプレートのプレビュー、npm tarball、内部メタデータは Release の添付ファイルに含めない
- GitHub Environment `release` では、必須レビュアーを設定し、自己承認を禁止し、リリースタグを制限する。承認画面のジョブサマリーに、ソースコミット、tarball に含まれるファイルの数、tarball の SHA-256、ツールチェーンのバージョン、4 PDF のチェックサム、マトリックスの全テスト結果を表示する
- npm への公開には、`.github/workflows/release.yml` と Environment `release` に限定した GitHub Actions の trusted publishing を使い、長期 npm トークンをリポジトリーのシークレットに保存しない。OIDC に必要な `id-token: write` は公開ジョブだけへ付与し、安定版は `latest`、プレリリース版は `next` タグで公開する
- 公開後は公開レジストリーから厳密に指定したバージョンを新しい一時プロジェクトへ取得し、バージョンと、実際に PDF を生成するスモークテストの結果を確認してから、下書きの GitHub Release を公開する。公開確認、npm tarball の SHA-256、Vivliostyle・Chromium・フォントのバージョン、4 PDF のチェックサムをリリースノートに追記する
- npm と GitHub Release の公開は別々の操作であり、片方だけが完了することがある。途中で失敗した場合、GitHub Release は下書きのまま保つ。再実行時に、npm 上の同じバージョンの SHA-1 と integrity 値が公開準備用の tarball と一致すれば、公開済みとして後続の検証から再開し、不一致なら停止する。公開済みの成果物を上書き・再利用せず、修正版は新しいバージョンとする
- shrinkwrap で固定した間接依存のセキュリティー修正も、既存リリースのインストール結果へ自動反映されない。そのため、ロックファイルを更新してすべてのスモークテストを通し、新しいパッチリリースとして配布する

リポジトリー外では次を一度だけ設定します。

- リリース専用 GitHub App の App ID をリポジトリー変数 `RELEASE_APP_ID` に、秘密鍵を Actions シークレット `RELEASE_APP_PRIVATE_KEY` に置く
- npm パッケージの trusted publisher をリポジトリー、ワークフローファイル `release.yml`、Environment `release` に固定し、パッケージの一般公開を許可する
- GitHub Environment `release` に必須レビュアーとデプロイ用のタグルールを設定し、リリースタグの更新・削除をルールセットで禁止する

## 6.6 文書のビルドとリリース

Makefile は公開用文書とテンプレートのプレビューを別々の出力先に生成します。

```bash
make docs-release          # default テンプレートによる公開用 PDF 一式
make docs                  # docs-release と同じ処理
make list-templates        # 同梱テンプレート名の一覧
make docs-template-default # default で見本と日本語の設計書・チュートリアルを PDF 化
make docs-template-pfn     # pfn で見本と日本語の設計書・チュートリアルを PDF 化
make docs-templates        # 全同梱テンプレートで見本と日本語の設計書・チュートリアルを PDF 化
make docs-template-images  # 各テンプレートの見本の全ページを目視用 PNG に変換
```

- 公開用 PDF は `build/docs/release/`、テンプレートのプレビューは `build/docs/templates/<template>/sample.pdf` に置き、同名 PDF の上書きとリリースへのプレビューの混入を防ぐ
- `sample.pdf` には、GFM、長い表とコードブロック、数式、ローカル画像、生の HTML、改ページを含む 5 ページ以上の共通サンプルを使う。独立した表紙を持たない `compact` は 4 ページ以上とする。ページ数に上限は設けない。`compact` 以外は目次が 2 ページ以上になる数の見出しを設け、`compact` は 2 段組みの目次と本文を最初のページに共存させる
- コーディングエージェントが文書全体をレビューできるよう、全ページを `pdftoppm` で PNG 化し、`build/docs/template-images/<template>/page-NN.png` にページ順で置く。PDF が所定の最小ページ数に満たない場合、`compact` 以外で目次が 2 ページに継続しない場合、または `compact` の最初のページに目次と本文が共存しない場合は、画像化ターゲットの実行を失敗させる
- `resources/templates/manifest.json` を同梱テンプレート一覧の正本とし、CLI で許可する名前、`list-templates`、`docs-templates` はこの一覧を使う。マニフェストと実際のディレクトリーが一致することをテストする
- 各ターゲットは、チェックアウトしたソースからビルドした現在の pfpdf を使い、レジストリー上の `latest` や以前のリリースに依存しない
- `SOURCE_DATE_EPOCH` を受け取り、リリースビルドではタグが指すコミットの日時を固定して再現可能性を高める
- リリースワークフローは、タグが指すソースから `docs-release` で 4 PDF を再生成し、`build/docs/release/*.pdf` だけをチェックサムとともに下書きの GitHub Release へアップロードする。テンプレートのプレビューの PDF と PNG は Release の添付ファイルに含めない。4 PDF が揃わないリリースは公開状態へ進めない

## 6.7 バージョンの付け方とライセンス文書

- CHANGELOG は Semantic Versioning に従い、`0.x` の破壊的変更も明記する
- リリースタグ、ソースコミット、npm tarball のチェックサム、Vivliostyle・Chromium・フォントのバージョン、4 PDF のチェックサム、公開後の検証、セキュリティー修正を配布するリリースの手順を記録する
- pfpdf が新規に作成するコードは MIT License とする。ただし npm パッケージ全体が MIT の要素だけで構成されるとは表現しない
- Vivliostyle CLI は実行時の直接依存で、ライセンスは AGPL-3.0 である。配布経路（npm への同梱、ネットワークサービス）ごとの義務を整理し、正確なソースのバージョン、上流の URL、ライセンス文、変更の有無を記録する
- MathJax、highlight.js、フォント、Chromium、Node.js、GFM パーサー、CJK 向けの拡張、PDF の解析・書き換えツールについても、バージョン・ライセンス・入手元を `THIRD_PARTY_LICENSES.md` に一覧化する
- ファイル名の衝突、見出しのスラッグ、BCP 47 言語タグの正規化に使う Unicode データと言語サブタグデータのバージョン、ライセンス、入手元も固定する。更新時は、アンカーや既存文書との互換性にどのような差が生じるかをレビューする
- リリース前にシークレットスキャン、依存関係のレビュー、第三者ライセンス一覧の更新を確認する
