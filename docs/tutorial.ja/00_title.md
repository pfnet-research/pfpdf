---
title: pfpdf チュートリアル
author: pfpdf maintainers
page_size: A4
lang: ja
dir: ltr
---

# pfpdf チュートリアル

<style>
@media print {
  p:has(code), li:has(code), dd:has(code) { text-align: start; }
}
</style>

このチュートリアルは、pfpdf で Markdown 文書から PDF を生成する方法を、導入から順番に説明します。各章の Markdown ファイルは pfpdf の入力例でもあります。`docs/tutorial.ja/` ディレクトリー全体を pfpdf に渡すと、このチュートリアルの PDF を生成できます。

```bash
npx @pfnet-research/pfpdf@latest --input docs/tutorial.ja --output tutorial.ja.pdf
```

## 章構成

| 章 | 内容 |
|---|---|
| 01 | はじめに: インストールと最初の PDF |
| 02 | 文書の構成: フロントマターと複数ファイル |
| 03 | GFM の書き方 |
| 04 | 生の HTML |
| 05 | 数式・コードハイライト・Mermaid 図 |
| 06 | テンプレート、ロゴ、アセット、フォント |
| 07 | CLI とレンダラー |
| 08 | トラブルシューティング |

仕様の背景や設計判断は設計書（`docs/design.ja/`）を参照してください。英語版チュートリアルは `docs/tutorial.en/` にあります。
