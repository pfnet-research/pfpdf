---
title: pfpdf チュートリアル
author: pfpdf maintainers
page_size: A4
lang: ja
dir: ltr
---

# pfpdf チュートリアル

このチュートリアルは、pfpdf で Markdown 文書から PDF を生成する方法を、導入から順番に説明します。各章の Markdown source 自体が pfpdf の入力例になっており、このディレクトリ全体を pfpdf に渡すと、いま読んでいる PDF が生成されます。

```bash
npx @pfnet-research/pfpdf@latest --input docs/tutorial.ja --output tutorial.ja.pdf
```

## 章構成

| 章 | 内容 |
|---|---|
| 01 | はじめに: インストールと最初の PDF |
| 02 | 文書の構成: front matter と複数ファイル |
| 03 | GFM の書き方 |
| 04 | raw HTML |
| 05 | 数式とコードハイライト |
| 06 | template、ロゴ、アセット、フォント |
| 07 | CLI と renderer |
| 08 | troubleshooting |

仕様の背景や設計判断は設計書(`docs/design.ja/`)を参照してください。英語版チュートリアルは `docs/tutorial.en/` にあります。
