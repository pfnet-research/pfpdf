# 日英ドキュメントの用語集

仕様書、チュートリアル、README、サイトの文面を執筆・翻訳・保守するときの用語と表記をまとめます。仕様の定義と条件は、[日本語の設計書](docs/design.ja/)と[チュートリアル](docs/tutorial.ja/)に従います。

## 使い方

- 文章中では以下の表記を基本に、指す対象と文脈を確かめて使います。同じ原語でも、概念が異なれば書き分けます。
- コード、設定キー、クラス名、CLI オプション、ファイル名、URL、製品名、引用、テスト入力は、元の表記を保ちます。
- この表を機械的な一括置換に使わず、編集対象と周囲の文章を読み比べて判断します。

## 一般語の表記

| 英語 | 日本語の推奨表記 |
| --- | --- |
| browser | ブラウザー |
| directory | ディレクトリー |
| repository | リポジトリー |
| library | ライブラリー |
| renderer | レンダラー |
| server | サーバー |
| parameter | パラメーター |
| memory | メモリー |
| parser | パーサー |
| security | セキュリティー |
| front matter | フロントマター |

## 意味を確かめて使う用語

| 英語の概念 | 日本語の推奨表記 | 用途・識別子の扱い |
| --- | --- | --- |
| canonical document | 正本 | 仕様・設計・利用方法の基準となる文書に使います。日本語版が正本、英語版が翻訳です。 |
| canonical language tag | 正規形の言語タグ | `lang` の検証・正規化後の値を説明するときに使います。 |
| canonical path | 実体パス | ローカルリソースの重複排除などで、シンボリックリンクを解決したパスを指す場合に使います。 |
| configuration source | 設定元 | 設定を置く場所は「フロントマターへ記録する」「CLI 引数で指定する」のように説明します。 |
| primary language | 先頭の言語サブタグ | `lang` の値である BCP 47 言語タグについて使います。`lang: ja-JP` なら `ja` です。本文の文字種から `ja` / `en` を推定する処理とは区別します。 |
| raw HTML | 生の HTML | Markdown 内へ直接書いた HTML を指します。GFM の「Disallowed Raw HTML」など、正式な仕様名は原語の表記を保ちます。 |
| readiness / document readiness contract | 準備／準備完了の通知 | 「描画開始の準備が整うまで待つ」「文書の準備完了を通知する仕組み」など、何の準備・待機・通知かを書きます。`ReadinessCoordinator` や `window.pfpdf.registerReady(promise)` はそのまま書きます。 |
| build workspace | ビルド用の作業ディレクトリー | 一時ファイルを置く場所を指します。クラス名は `Workspace`、保持する CLI オプションは `--keep-work-dir` のままです。npm の workspace はパッケージ管理の別概念として扱います。 |
| syntax highlighting / code highlighting | コードハイライト | コードの構文に応じた色分けを指します。ライブラリー名の highlight.js は元の表記を保ちます。 |
| emphasis / strong emphasis | 強調／強い強調 | 変換後の HTML の `<em>` / `<strong>` にそれぞれ対応します。 |
| pagination | ページ分割 | レンダラーが内容をページに分ける処理です。「改ページ」は次のブロックを新しいページから始める指示に使います。 |
