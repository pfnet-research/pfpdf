# 4. raw HTML

## 4.1 raw HTML はいつ使うか

Markdown だけでは表現しにくいレイアウトやコンポーネントには、inline / block の raw HTML をそのまま書けます。ただし、表や強調のような GFM で書けるものは、まず GFM の記法(03 章)を使ってください。raw HTML は「GFM で書けないもの」のための追加手段です。

> **警告**: raw HTML と `<script>` は変換時に browser 上でそのまま実行されます。pfpdf は信頼できる自分の文書を変換するための tool であり、raw HTML の sandbox 化や sanitization は行いません。出所の分からない Markdown ファイルを pfpdf で変換しないでください。詳細は設計書の security 章を参照してください。

## 4.2 inline HTML

文中に HTML 要素を混ぜられます。たとえば <kbd>Ctrl</kbd> + <kbd>C</kbd> のようなキー表示や、<sub>下付き</sub>・<sup>上付き</sup>が書けます。

```md
<kbd>Ctrl</kbd> + <kbd>C</kbd> を押します。
```

## 4.3 block HTML

`div`、`section`、`figure`、`table` などの block 要素も使えます。

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

block HTML の内側では、GFM の block rule に従って Markdown 記法が解釈されない場合があります。確実に Markdown として扱いたい内容は HTML block の外に出してください。また、1 個の HTML block を別の Markdown ファイルまで続けることはできません。

`<base>`、`<meta http-equiv="refresh">`、`data-pfpdf-*` attribute も trusted HTML として保持されます。ただし pfpdf の URL 解決や readiness 処理と衝突し得ます。`window.pfpdf` の置換は readiness error になるため避けてください。

## 4.4 `<style>` による装飾

文書内に `<style>` を書いて、CSS で装飾を追加できます。

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

必要であれば `<script>` も書けます。同期 script は PDF の pagination より前に実行され、readiness 完了前の error または未処理の promise rejection は変換失敗になります(終了 code `1`)。

pfpdf は DOM、静的 local stylesheet / script、font、image、数式、コードハイライトを待ってから pagination を始めます。remote resource の完了や失敗は同じ精度では保証されません。

pagination 前に待つ必要がある非同期処理は、次のように promise を明示的に登録します。

```html
<script>
  window.pfpdf.registerReady(loadChartData().then(drawChart));
</script>
```

document の parse が終わった後からの登録は error です。登録しなかった timer、event handler、worker、readiness 完了後の error まで pfpdf が自動検出することはできません。描画に必要な処理は必ず登録し、`--render-timeout-ms` の範囲内で完了させてください。

変換中の `window.location` には実行ごとに異なる loopback port が含まれます。再現可能な文書では `location.href` / `origin`、現在時刻、乱数を描画内容や文書 ID に使わないでください。

## 4.6 ローカルファイルとリモートリソースの参照

- raw HTML の `src` / `href` / `srcset`、inline style、`<style>` の静的 URL は input の resource base を基準に解決されます
- pfpdf の process が読めるローカルファイルは、静的に記述すれば絶対パスや `..` を含むパスでも参照できます
- CSS の `@import` と `url()` は CSS ファイル自身を基準に再帰解決されます。循環する `@import` は 1 回ずつ解析され、無限 loop にはなりません
- script が実行時に組み立てる local path は静的 resource の対象外で、local / Docker のどちらでも利用できる保証がありません
- JavaScript の local module graph や nested HTML document 内の resource graphは解析しません。inline module や `iframe[srcdoc]` 自体は保持されますが、その内部の relative local resource が解決される保証はありません
- `https:` のリモート画像・stylesheet・script は browser が直接取得します。取得の成否や再現性は pfpdf は保証しません。再現性が必要な文書ではリモートリソースを使わず、ファイルを repository に置いてください
