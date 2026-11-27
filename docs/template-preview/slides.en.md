---
slides: true
title: Checking pfpdf Slides
subtitle: One deck in seven templates
author: pfpdf contributors
series: pfpdf Template Series
date: 2026-11-26
lang: en
confidential: true
section_covers: true
---

# Writing

## One Slide

### A ### right below the title becomes its subtitle

A `##` heading starts a new slide and becomes its title. This text checks the size and line height of English prose with numbers 0123456789.

- The first bullet
- A second bullet with **strong text** and `inline code`
  - A nested item

::: note
A note appears in small type at the bottom of the slide.

::: talk
TALK-MARKER Speaker notes do not appear in the PDF.

## Columns

### Regions with one name sit side by side

::: column
### Before

Processing took 12 ms.

::: column
### After

Processing now takes 10 ms.

::: column
### Difference

About 17% faster.

::: note
Values are the median of 30 runs.

# Presentation

## Left and Right

::: left
![Sample figure](assets/preview.svg)

::: right
The figure is on the left and the explanation on the right. The template decides the ratio between them.

1. A numbered item
2. Another item

## Tables and Code

| Item | Before | After |
| --- | ---: | ---: |
| Time | 12 ms | 10 ms |
| Memory | 48 MB | 40 MB |

```ts
const speedup = (before - after) / before;
```

> Quotations are checked as well.

## A Dense Slide

<!-- pfpdf:font_size=20 -->

### font_size=20 makes the body text smaller

- The title and subtitle keep their size.
- The body text base is 20 pt. Tables, code, and notes scale with it.
- To shrink a whole deck, write `font_size: 20` in the front matter.
- When a slide does not fit on one page, conversion stops with an error.
