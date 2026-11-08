# 4. 生の HTML

## 4.1 生の HTML はいつ使うか

Markdown だけでは表現しにくいレイアウトやコンポーネントは、HTML を直接書いて表現できます。文中にも、独立したブロックにも書けます。このような生の HTML は、GFM で書けない表現を補う手段です。表や強調のように GFM で書けるものには、まず GFM の記法（03 章）を使ってください。

> **警告**: 変換時には、ブラウザーが生の HTML を読み込み、`<script>` などのスクリプトをそのまま実行します。pfpdf は信頼できる自分の文書を変換するためのツールであり、生の HTML のサンドボックス化やサニタイズは行いません。出所の分からない Markdown ファイルを pfpdf で変換しないでください。詳細は設計書の 08 章「セキュリティーモデル」を参照してください。

## 4.2 インライン HTML

文中に HTML 要素を混ぜられます。次の Markdown を PDF に変換すると、<kbd>Ctrl</kbd> + <kbd>C</kbd> のようなキー表示になります。`<sub>` と `<sup>` で、<sub>下付き</sub>・<sup>上付き</sup>も書けます。

```md
<kbd>Ctrl</kbd> + <kbd>C</kbd> を押します。
```

## 4.3 ブロック HTML

`div`、`section`、`figure`、`table` などのブロック要素も使えます。次の例を Markdown に書いて変換すると、PDF には文字を中央揃えにした枠が表示されます。

<figure style="text-align: center; border: 1px solid #ccc; padding: 1em;">
  <figcaption>figure 要素と style attribute の例</figcaption>
  <p>この枠は raw HTML の <code>figure</code> で作られています。</p>
</figure>

```md
<figure style="text-align: center; border: 1px solid #ccc; padding: 1em;">
  <figcaption>figure 要素と style attribute の例</figcaption>
  <p>この枠は raw HTML の <code>figure</code> で作られています。</p>
</figure>
```

HTML ブロックの内側では、GFM のブロック構文の規則に従い、Markdown 記法が解釈されない場合があります。確実に Markdown として扱いたい内容は HTML ブロックの外に出してください。また、1 個の HTML ブロックを別の Markdown ファイルまで続けることはできません。

`<base>`、`<meta http-equiv="refresh">`、`data-pfpdf-*` 属性も、信頼済みの HTML として保持されます。ただし、pfpdf の URL の解決や描画対象を変える場合があります。ページ分割前に待つ処理を登録する API を使う場合は、`window.pfpdf` を上書きしないでください（4.5 節参照）。

## 4.4 `<style>` による装飾

文書内に `<style>` を書いて、CSS で装飾を追加できます。次の例を Markdown に書いて変換すると、`.tutorial-note` クラスを指定した領域に、左側の線と背景色が付きます。

<style>
.tutorial-note {
  border-left: 4px solid #4a90d9;
  padding: 0.5em 1em;
  background: #f0f6fc;
}
</style>

<div class="tutorial-note">
この box は文書内の <code>style</code> 要素で定義した class を使っています。
</div>

```md
<style>
.tutorial-note {
  border-left: 4px solid #4a90d9;
  padding: 0.5em 1em;
  background: #f0f6fc;
}
</style>

<div class="tutorial-note">
この box は文書内の <code>style</code> 要素で定義した class を使っています。
</div>
```

## 4.5 `<script>` の利用

必要であれば `<script>` も書けます。同期スクリプトは PDF のページ分割より前に実行されます。描画開始の準備が整う前にスクリプトのエラーや未処理の Promise の拒否が検出されると、変換は失敗します（終了コード `1`）。

数式とコードハイライトは、HTML の組み立て前に変換されます。ブラウザーでは、HTML 文書の解析と登録された Promise の完了を待ち、続いてフォントの準備を待ちます。その時点で文書内にある `img` の読み込み・デコードを確認してから、ページ分割を始めます。画像の参照先がローカルファイル、リモート URL、データ URL のいずれでも、読み込みやデコードに失敗すると変換は失敗します。

静的に記述されたローカルのスタイルシートやスクリプトで、準備完了前に読み込みエラーが検出された場合も、変換は失敗します。リモートのスタイルシートやスクリプトの取得結果まで、網羅的に監視する保証はありません。

ページ分割前に待つ必要がある非同期処理は、次のように Promise を明示的に登録します。

```html
<script>
  window.pfpdf.registerReady(loadChartData().then(drawChart));
</script>
```

この例の `loadChartData` と `drawChart` は、利用者が用意する関数です。

Promise は文書の解析が終わるまでに登録してください。それ以降に登録するとエラーになります。未登録のタイマー、イベントハンドラー、ワーカーがいつ完了するかは、自動では判断しません。準備完了後のエラーも変換の成否へ反映できません。描画に必要な非同期処理は必ず登録し、`--render-timeout-ms` の範囲内で完了させてください。

変換中の `window.location` には、実行ごとに異なるループバックのポート番号が含まれます。再現可能な文書では、`location.href` / `origin`、現在時刻、乱数を描画内容や文書 ID に使わないでください。

## 4.6 ローカルファイルとリモートリソースの参照

- 生の HTML で画像・スタイルシート・スクリプトなどを取得する相対 URL は、HTML を書いた Markdown ファイルがあるディレクトリーを基に解決されます。`src` / `href` / `srcset`、インラインスタイル、`<style>` に静的に記述した URL が対象です
- pfpdf のプロセスが読めるローカルファイルは、参照先を静的に記述すれば、絶対パスや `..` を含むパスでも参照できます
- CSS の `@import` と `url()` は、CSS ファイル自身を基準に再帰的に解決されます。循環する `@import` も、解析中のファイルを再び参照した時点でその参照の処理を止めるため、無限ループにはなりません
- スクリプトが実行時に組み立てるローカルパスは、静的な参照先の解決対象に含まれないため、利用できる保証がありません
- JavaScript モジュールの依存関係や、入れ子になった HTML 文書内のリソース参照は解析しません。インラインモジュールや `iframe[srcdoc]` 自体は保持されますが、その内部の相対パスによるローカルリソースの参照を解決できる保証はありません
- `https:` のリモート画像・スタイルシート・スクリプトは、ブラウザーが直接取得します。取得結果は、実行時のネットワークや取得先の状態に左右されます。再現性が必要な文書ではリモートリソースを使わず、ファイルをリポジトリーに置いてください
