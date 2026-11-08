---
title: pfpdf Design Document
author: pfpdf maintainers
page_size: A4
lang: en
dir: ltr
---

# pfpdf Design Document

<style>
@media print {
  p:has(code), li:has(code), dd:has(code) { text-align: start; }
}
</style>

This document records the implementation requirements and design decisions for pfpdf, which converts Markdown documents to PDF through HTML. It sets requirements for GFM and Japanese typesetting, configuration through front matter and the CLI, and the handling of trusted documents. It also defines the policy that partial output does not count as success when an error occurs.

- Scope: the initial design targeting `v0.1.0` and subsequent design changes. Chapter 09 records the status and decision date of each design decision.
- Language status: the Japanese version in `docs/design.ja/` is canonical. This English translation mirrors its structure. If the two versions differ in their interpretation of the specification, the Japanese version takes precedence.

## Audience and purpose

This design document is intended for:

- Implementers who modify and maintain pfpdf itself
- Users who need a precise understanding of pfpdf's behavior
- Maintainers who update dependencies and cut releases

For user-facing setup instructions and examples, see `docs/tutorial.en/`. The README serves only as a brief introduction; this design document contains the detailed specification.

## Chapter structure

| Chapter | Contents |
|---|---|
| 01 | Scope and basic principles |
| 02 | Internal architecture |
| 03 | Markdown processing and GFM |
| 04 | Resources, fonts, and templates |
| 05 | Renderer |
| 06 | Distribution and release |
| 07 | Compatibility and testing |
| 08 | Security model |
| 09 | Record of design decisions |
