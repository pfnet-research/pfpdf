---
title: pfpdf 設計書
author: pfpdf maintainers
page_size: A4
lang: ja
dir: ltr
---

# pfpdf 設計書

この文書は pfpdf の実装方針、architecture、Markdown 処理、resource と template、renderer、配布、互換性、security、および主要な設計判断を記録する詳細設計書です。

- 対象バージョン: `v0.1.0`
- 言語上の位置付け: 日本語版(`docs/design.ja/`)が正典であり、英語版(`docs/design.en/`)は同じ構成の翻訳です。仕様解釈が日英で衝突した場合は日本語版を正とします。

## 読者と目的

この設計書は次の読者を想定します。

- pfpdf 本体を変更・保守する実装者
- pfpdf の挙動を正確に知る必要がある利用者
- 依存関係の更新や release を行う maintainer

利用者向けの導入手順と実例は `docs/tutorial.ja/` を参照してください。README は導入用の短い入口であり、詳細仕様はこの設計書に集約します。

## 章構成

| 章 | 内容 |
|---|---|
| 01 | scope と基本方針 |
| 02 | 内部 architecture |
| 03 | Markdown 処理と GFM |
| 04 | resource、font、template |
| 05 | renderer(local / Docker) |
| 06 | 配布と release |
| 07 | 互換性とテスト |
| 08 | security model |
| 09 | 設計判断の記録 |
