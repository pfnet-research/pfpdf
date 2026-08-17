# 1. scope と基本方針

## 1.1 pfpdf とは

pfpdf は、Markdown 文書を HTML を経由して PDF へ変換する command line tool です。Node.js と npm を導入済みの利用者が、リポジトリを clone せずに次の 1 コマンドで PDF を生成できることを第一の目標とします。

```bash
npx pfpdf@latest --input foo --output foo.pdf
```

CI や長期保存する手順書では `latest` を使わず version を固定します。

```bash
npx --yes pfpdf@0.1.0 --input foo --output foo.pdf
```

## 1.2 `v0.1.0` の目標

- Docker を必要とせずに動作する(local renderer が既定)
- `npx pfpdf` を利用者向け CLI の唯一の正式な導入経路とする
- 外部の Python installation を要求しない
- CommonMark を包含する正式な GitHub Flavored Markdown(GFM)の構文を原則すべて扱う
- `これは**「重要」**です` のような、全角約物・括弧を含む日本語 strong emphasis を空白なしでも確実に `<strong>` へ変換する
- inline / block の raw HTML を扱い、Markdown だけでは表現できないレイアウトの自由度を維持する
- 表紙、目次、改ページ、数式、コードハイライト、ローカル画像を扱える
- 再配布可能な標準フォントを既定とし、ホストフォントは明示的に許可された場合だけ読み込む
- 複数の bundled template(`academic` / `book` / `compact` / `default` / `notebook` / `pfn` / `technical`)を選択でき、ロゴなどの非同梱アセットは利用側から注入できる
- CLI 引数と環境変数から実行設定を制御でき、同じ項目では CLI 引数を常に優先する
- 入力元ディレクトリを変更せず、一時ファイルを正常終了時と捕捉可能な異常終了時に回収する
- 異常時は部分的な成果物を成功扱いせず、非 0 の終了コードを返す
- Markdown file の境界が GFM block の意味を変えないよう各 file を独立 parse し、静的 local resource は renderer-neutral な manifest で解決する
- renderer の準備、readiness、描画に finite な deadline を設け、停止した image / browser download、script、browser、container を無期限に待たない
- macOS aarch64 と Linux x86_64 を主要サポート、Windows x86_64 と Linux aarch64 を追加サポートとし、4 環境すべてを CI で検証する

## 1.3 `v0.1.0` の非目標

- 全 OS でバイト単位に同一な PDF の生成
- 信頼できない Markdown や raw HTML を安全に実行するサンドボックスの提供
- PyPI、Homebrew、単体バイナリへの同時公開
- GUI プレビューや常駐型 watch mode
- PDF/X、CMYK、入稿向け preflight の品質保証
- GitHub repository の文脈を必要とする mention、issue / pull request reference など、GitHub.com 固有の post-processing の完全再現
- GitHub.com と同じ HTML sanitization。pfpdf は trusted document 向けとして raw HTML を保持する
- 単一 file として配布可能な HTML の生成。生成 HTML は PDF renderer への入力とテストにだけ使用する
- `SIGKILL`、電源断、OS crash の瞬間における workspace や browser process の確実な回収
- 同一出力先を対象とする複数 process の調停と、`SIGKILL` / 電源断後に出力 directory へ残った sibling 一時 file の自動 crash recovery
- script が実行時に生成する任意の local path、DOM、network response を事前発見して local / Docker renderer へ公開すること
- remote resource の完全性、応答時間、内容の snapshot、失敗分類を保証すること
- Nix Flake、Nix package、Nix 固有の再現環境の提供

## 1.4 npx-first

一般利用者向けの配布経路は npm package とします。`package.json` の `bin` に `pfpdf` を登録し、global install を要求せず `npx` または `npm exec` から起動できるようにします。

- 対応 Node.js は pinned Vivliostyle CLI の要件に合わせて決定し、`package.json` の `engines`、起動時検査、CI で同じ条件を使う
- npm の `engines` は `npx` 実行では強制されないため、CLI の entry point は古い Node.js でも構文エラーにならない範囲へ build し、起動直後に runtime version を検査して明確な診断と終了 code `1` で失敗する
- npm package に CLI、変換処理、template、CSS、MathJax、highlight.js、標準フォントを含める
- browser の取得と cache 管理は pinned Vivliostyle CLI と、その dependency である Puppeteer 系 browser manager の標準動作に任せる。pfpdf は独自 downloader、cache lock、partial download recovery、prune を実装しない
- 初回に大きな browser download が発生し得ることを README で明示する
- `--browser-path` / `PFPDF_BROWSER_PATH` で既存の互換 browser を明示できる逃げ道を用意する
- Linux では browser archive だけでは shared library が揃わないため、対応 distribution と必要 package を 07 章と tutorial の troubleshooting 章に列挙する。`--doctor` で不足 library を可能な範囲で報告し、root 権限で暗黙 install はしない

### 対応環境

| OS / architecture | サポート水準 | 備考 |
|---|---|---|
| macOS aarch64 | 主要サポート | Apple Silicon。Node test と実 browser による PDF 生成を CI で検証する |
| Linux x86_64 | 主要サポート | Node test と実 browser による PDF 生成を CI で検証する |
| Windows x86_64 | 追加サポート | PowerShell からの npx 実行と実 browser による PDF 生成を CI で検証する |
| Linux aarch64 | 追加サポート | Node test と実 browser による PDF 生成を CI で検証する |

## 1.5 CLI の配布経路は npm に限定する

`v0.1.0` の利用者向け CLI の正式な導入経路は npm / npx だけとします。Docker image は Docker renderer 用の補助配布物です。source / CI の dependency tree は `package-lock.json`、公開 CLI の dependency tree は tarball 内の `npm-shrinkwrap.json` で固定し、検証済み Node.js range と合わせて再現性を確保します。

## 1.6 組み込み機能は browser 取得後にオフラインで使えるようにする

数式とコードハイライトに必要なファイルは CDN から取得せず、固定バージョンを package に含めます。

- npx 版は npm package と browser の初回取得にネットワークを使う
- npm package と browser が cache 済みなら、pfpdf の組み込み機能だけを使う標準文書はネットワークなしで PDF 化できる
- 利用者自身が記述したリモート画像、stylesheet、script については利用者の責任でネットワークへアクセスする
- bundled MathJax による typeset と highlight.js による code highlight は build-time transform として HTML assembly 前に完了させ、変換済みの HTML だけを Vivliostyle が pagination することを integration test で確認する
- bundled MathJax / highlight.js の初期化・変換失敗と、利用者が document readiness contract へ登録した promise の rejection は成功扱いしない。利用者が指定した remote resource の timeout、DNS、TLS、HTTP error は pfpdf が分類・保証せず、出力の安定性を含めて利用者の責任とする
- Docker image / browser の確認と取得、readiness、PDF 描画・後処理・構造検査には既定 300 秒の共通 deadline を適用し、必要な文書だけ明示的に上書きできるようにする。timeout を無期限にする値は提供しない

## 1.7 設定は CLI 引数と環境変数に限定する

project config file は設けません。repository ごとの繰り返し設定は Makefile、npm script、CI workflow などに CLI 引数または環境変数として記録します。

設定の優先順位は次のとおりです。

```text
明示的な CLI 引数 > 環境変数 > 組み込み既定値
```

同じ項目が CLI と環境変数の双方にあれば、値の種類にかかわらず CLI を常に採用します。boolean の `--no-toc` / `--no-host-fonts` のような明示的な否定は CLI の値 `false` として環境変数より優先します。logo、追加 font directory、browser path、Docker image、workspace 保持には専用の CLI reset flag を設け、対応する環境変数を 1 回の実行だけ無効化できます。reset flag を定義していない設定を組み込み既定へ戻す場合は、不要な環境変数を実行環境から外すか、既定値を CLI で明示します。

## 1.8 正典と翻訳の契約

repository 内の長期的な仕様・設計・利用方法は、次の 4 文書へ集約します。

| 文書 | 役割 | 言語上の位置付け |
|---|---|---|
| `docs/design.ja/` | 実装方針、architecture、互換性、security、設計判断 | 日本語の正典 |
| `docs/tutorial.ja/` | 導入から GFM、raw HTML、数式、template、CLI までの利用例 | 日本語の正典 |
| `docs/design.en/` | design の英訳 | 日本語版に従う翻訳 |
| `docs/tutorial.en/` | tutorial の英訳 | 日本語版に従う翻訳 |

- 日本語版と英語版は同じ番号・file 名・章構成を使い、対応関係を機械的に確認できるようにする
- 仕様解釈が日英で衝突した場合は日本語版を正とし、英語版を修正する
- 日本語版を変更する pull request では対応する英語 file も同じ pull request で更新する
- README は導入用の短い入口と各正典・英訳への案内に留め、詳細仕様を重複させない
- repository 内のすべての `AGENTS.md` は日本語正典の例外として英語で記述する。agent 向け規約の実質的な設計根拠は design へ置き、`AGENTS.md` には作業規則と正典への参照だけを簡潔に記載する
