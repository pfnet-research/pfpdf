---
title: pfpdf Design Document
author: pfpdf maintainers
page_size: A4
lang: en
dir: ltr
---

# pfpdf Design Document

This document records the detailed design of pfpdf: its implementation principles, architecture, Markdown processing, resources and templates, renderers, distribution, compatibility, security model, and major design decisions.

- Target version: `v0.1.0`
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
| 06 | Distribution and releases |
| 07 | Compatibility and testing |
| 08 | Security model |
| 09 | Record of design decisions |
