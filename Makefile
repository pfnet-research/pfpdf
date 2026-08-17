NODE ?= node
PFPDF = $(NODE) dist/launcher.js
DOCS_ROOT ?= build/docs
SOURCE_DATE_EPOCH ?= $(shell git log -1 --format=%ct 2>/dev/null || echo 0)
export SOURCE_DATE_EPOCH

DOC_NAMES = design.ja tutorial.ja

# English docs are built only when the translated trees exist.
ifneq ($(wildcard docs/design.en),)
DOC_NAMES += design.en
endif
ifneq ($(wildcard docs/tutorial.en),)
DOC_NAMES += tutorial.en
endif

BUNDLED_TEMPLATES := $(shell $(NODE) scripts/list-bundled-templates.mjs --make)
ifeq ($(strip $(BUNDLED_TEMPLATES)),)
$(error bundled template manifest is empty or unreadable)
endif

DOC_INPUTS = $(foreach name,$(DOC_NAMES),$(wildcard docs/$(name)/*.md))
RELEASE_DOC_TARGETS = $(addprefix $(DOCS_ROOT)/release/,$(addsuffix .pdf,$(DOC_NAMES)))
TEMPLATE_DOCUMENT_NAMES = design.ja tutorial.ja
TEMPLATE_PREVIEW_INPUT = docs/template-preview/sample.md
TEMPLATE_PREVIEW_INPUT_EN = docs/template-preview/sample.en.md
TEMPLATE_PREVIEW_INPUTS = $(TEMPLATE_PREVIEW_INPUT) $(wildcard docs/template-preview/*.bib) $(wildcard docs/template-preview/assets/*)
TEMPLATE_PREVIEW_INPUTS_EN = $(TEMPLATE_PREVIEW_INPUT_EN) $(wildcard docs/template-preview/*.bib) $(wildcard docs/template-preview/assets/*)
TEMPLATE_SAMPLE_TARGETS = $(foreach template,$(BUNDLED_TEMPLATES),$(DOCS_ROOT)/templates/$(template)/sample.pdf)
TEMPLATE_SAMPLE_EN_TARGETS = $(foreach template,$(BUNDLED_TEMPLATES),$(DOCS_ROOT)/templates/$(template)/sample.en.pdf)
# The site's hero illustration: the same cover as the gallery, but rendered from
# a short document without `confidential`, so the landing page shows no
# Confidential badge (the gallery samples keep theirs).
HERO_TEMPLATE = pfn
HERO_INPUT = docs/template-preview/hero.md
HERO_INPUT_EN = docs/template-preview/hero.en.md
HERO_TARGETS = $(DOCS_ROOT)/hero/hero.pdf $(DOCS_ROOT)/hero/hero.en.pdf

.PHONY: all build test lint docs docs-release docs-templates docs-template-samples docs-template-samples-en docs-hero-sample docs-template-images list-templates site-assets site clean

all: build

build:
	npm run build

test:
	npm test

lint:
	npm run lint

docs: docs-release

docs-release: $(RELEASE_DOC_TARGETS)

$(RELEASE_DOC_TARGETS): build $(DOC_INPUTS)
	@mkdir -p $(DOCS_ROOT)/release
	$(PFPDF) --input docs/$(basename $(notdir $@)) --output $@ --template default

list-templates:
	@$(NODE) scripts/list-bundled-templates.mjs

docs-templates: $(addprefix docs-template-,$(BUNDLED_TEMPLATES))

docs-template-samples: $(TEMPLATE_SAMPLE_TARGETS)

docs-template-samples-en: $(TEMPLATE_SAMPLE_EN_TARGETS)

docs-hero-sample: $(HERO_TARGETS)

$(DOCS_ROOT)/hero/hero.pdf: build $(HERO_INPUT)
	@mkdir -p $(DOCS_ROOT)/hero
	$(PFPDF) --input $(HERO_INPUT) --output $@ --template $(HERO_TEMPLATE)

$(DOCS_ROOT)/hero/hero.en.pdf: build $(HERO_INPUT_EN)
	@mkdir -p $(DOCS_ROOT)/hero
	$(PFPDF) --input $(HERO_INPUT_EN) --output $@ --template $(HERO_TEMPLATE)

site-assets: docs-template-samples docs-template-samples-en docs-hero-sample
	$(NODE) scripts/build-site-assets.mjs --docs-root $(DOCS_ROOT) --output build/site-assets \
		--hero-template $(HERO_TEMPLATE)

site: site-assets
	cd site && npm run build

docs-template-images: $(addprefix docs-template-images-,$(BUNDLED_TEMPLATES))

define TEMPLATE_DOC_RULES
TEMPLATE_DOC_TARGET_$(1) = $(DOCS_ROOT)/templates/$(1)/sample.pdf
TEMPLATE_DOCUMENT_TARGETS_$(1) = $$(addprefix $(DOCS_ROOT)/templates/$(1)/,$$(addsuffix .pdf,$$(TEMPLATE_DOCUMENT_NAMES)))

.PHONY: docs-template-$(1) docs-template-images-$(1)
docs-template-$(1): $$(TEMPLATE_DOC_TARGET_$(1)) $$(TEMPLATE_DOCUMENT_TARGETS_$(1))

$$(TEMPLATE_DOC_TARGET_$(1)): build $(TEMPLATE_PREVIEW_INPUTS)
	@mkdir -p $(DOCS_ROOT)/templates/$(1)
	$$(PFPDF) --input $(TEMPLATE_PREVIEW_INPUT) --output $$@ --template $(1)

$(DOCS_ROOT)/templates/$(1)/sample.en.pdf: build $(TEMPLATE_PREVIEW_INPUTS_EN)
	@mkdir -p $(DOCS_ROOT)/templates/$(1)
	$$(PFPDF) --input $(TEMPLATE_PREVIEW_INPUT_EN) --output $$@ --template $(1)

docs-template-images-$(1): docs-template-$(1)
	$$(NODE) scripts/render-template-preview-images.mjs \
		$$(TEMPLATE_DOC_TARGET_$(1)) $(DOCS_ROOT)/template-images/$(1)
endef

$(foreach template,$(BUNDLED_TEMPLATES),$(eval $(call TEMPLATE_DOC_RULES,$(template))))

define TEMPLATE_DOCUMENT_RULE
$(DOCS_ROOT)/templates/$(1)/$(2).pdf: build $$(wildcard docs/$(2)/*.md)
	@mkdir -p $(DOCS_ROOT)/templates/$(1)
	$$(PFPDF) --input docs/$(2) --output $$@ --template $(1)
endef

$(foreach template,$(BUNDLED_TEMPLATES),$(foreach document,$(TEMPLATE_DOCUMENT_NAMES),$(eval $(call TEMPLATE_DOCUMENT_RULE,$(template),$(document)))))

clean:
	rm -rf dist build
