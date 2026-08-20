# 6. 配布と release

## 6.1 npm package 設計

- repository / CI は `package-lock.json` で完全な dependency tree と integrity を固定する。公開 package の install では `package-lock.json` が使われないため、`package.json` の direct runtime dependency は exact version とし、review 済み lockfile と同じ tree から `npm-shrinkwrap.json` を隔離した staging directory で生成して tarball に含める
- Node.js の対応 semver range は pinned Vivliostyle CLI と全 direct runtime dependency の要件の共通部分から確定し、非連続 range も単純な最低 version へ広げない。`package.json` の `engines`、起動時検査、4 つの対応環境の CI で同じ range を使う
- TypeScript の compile target と公開 JavaScript の構文は range の最古 runtime で load できる値にし、version error を出す entrypoint 自体が未対応構文で parse error にならないことを最古 runtime の packed-package test で確認する
- browser の取得と cache は pinned Vivliostyle CLI の標準機構に任せ、pfpdf は `--browser-path` による明示 override だけを提供する
- npm tarball には compile 済み JavaScript、template、CSS、font、MathJax、highlight.js、license 文書を含める
- `npm pack --dry-run` で内容を review し、`npm-shrinkwrap.json` が含まれ `package-lock.json` が含まれないことを確認するが、独自の size budget、SBOM、署名、provenance は release 要件にしない
- pfpdf 自身の lifecycle script による暗黙の browser download や root 権限の変更は行わない。transitive dependency の lifecycle script も lockfile review と clean install test で確認する。browser 取得が必要な場合は最初の明示的な実行時に upstream の標準機構を使う

## 6.2 公開 tarball の内容

npm package `@pfnet-research/pfpdf` の `bin` field から compile 済みの `dist/launcher.js` を `pfpdf` として公開します。

- 公開 tarball には package metadata / shrinkwrap、`dist/`、必要な resource、README、license 文書だけを含め、TypeScript source map にローカル絶対パスが残らないことを確認する
- `package.json` の `files` allowlist と CI 上で展開した tarball の確認を使い、test fixture、`.env`、cache などを publish しない
- npm package 名は Organization scope の `@pfnet-research/pfpdf` とする。unscoped の `pfpdf` は既存 package `jspdf` との類似名判定により registry から拒否されるため使わない。公開時は `--access public` または同等の `publishConfig.access` を必須とする

## 6.3 ディレクトリ構成

```text
pfpdf/
  .github/workflows/
    ci.yml
    release-please.yml
    release.yml
  src/
    asset-server.ts
    browser.ts
    cli.ts
    settings.ts
    input.ts
    resources.ts
    markdown/
      index.ts
      gfm-adapter.ts
      japanese-strong.ts
      pfpdf-directives.ts
    document.ts
    readiness.ts
    fonts.ts
    templates.ts
    workspace.ts
    output.ts
    renderer.ts
  resources/
    templates/
      default/
      pfn/
    fonts/
    mathjax/
    highlight.js/
  docs/
    design.ja/  design.en/
    tutorial.ja/  tutorial.en/
  scripts/
    check-doc-policy.mjs
    check-doc-translations.mjs
    check-workflows.mjs
    release-lib.mjs
    release.mjs
  tests/
  Makefile
  release-please-config.json
  .release-please-manifest.json
  package.json
  package-lock.json
  tsconfig.json
  AGENTS.md
  README.md
  CHANGELOG.md
  CONTRIBUTING.md
  SECURITY.md
  CODE_OF_CONDUCT.md
  NOTICE.md
  THIRD_PARTY_LICENSES.md
  LICENSE
```

`docs/*.pdf` は Make target の生成物として `.gitignore` へ追加し、source tree には commit しません。

## 6.4 CI と supply chain

- npm package は macOS aarch64、Linux x86_64、Windows x86_64、Linux aarch64 の matrix を使い、4 環境すべてで Node test と実 PDF smoke test を行う
- third-party GitHub Action は floating tag ではなく review 済み commit SHA で固定し、更新元の tag を comment に残す
- `package-lock.json` の差分を review 対象にする
- staging で生成した `npm-shrinkwrap.json` の dependency / integrity が review 済み `package-lock.json` と一致しない場合は publish を禁止する。生成物を source lockfile の代わりに手編集しない
- Dependabot または Renovate は更新 pull request を作るだけとし、自動マージしない
- pull request ごとに TypeScript test、lint、4 環境の最小 PDF smoke test を実行する。release tag では、release workflow が一度だけ pack した同一 npm tarball を4環境すべてで installして実 PDF smoke testを行う
- pull request ごとに `make docs-release docs-template-samples` を実行し、公開用の日英の正典・翻訳と、すべての bundled template による共通 preview が build できることを確認する。全 template の詳細画像 review には `make docs-template-images` を使う
- `scripts/check-doc-translations.mjs` で日英の file 対応と変更同期を検査し、翻訳の意味上の一致は pull request review の必須 checklist にする
- `scripts/check-doc-policy.mjs` で、すべての `AGENTS.md` に日本語文字が含まれないことを検査する
- Vivliostyle CLI は npm の最新版を実行時に無条件取得せず、検証済みの 1 バージョンを direct dependency の exact spec、source lockfile、公開 shrinkwrap で固定する。更新は自動マージせず、各対象 OS のサンプル PDF スモークテスト後に行う
- CI の test command は network から conformance fixture や script を取得せず、lockfile と repository に固定した入力だけを使う。dependency download が必要な job と offline behavior の検査を分ける
- Release Please は Conventional Commit を release unit として release PR を更新し、version、`CHANGELOG.md`、`package-lock.json`、`npm-shrinkwrap.json` を同じ PR で変更する。`0.x` の破壊的変更を含む version 判断と release note は merge 前に human review する
- Release Please が作る PR / tag からも通常の workflow を起動できるよう、release 専用 GitHub App の短命 installation token を使う。App は現在の repository の Contents、Pull requests、Issues だけに必要最小限の write permission を持ち、個人 PAT は使わない

## 6.5 publish

- Release Please は release PR の merge commit に `v<package version>` tag と draft GitHub Release を作る。tag の作成を契機に `.github/workflows/release.yml` が始まる。手動再開は `gh workflow run release.yml --ref v<package version>` で workflow 自体を既存 tag から開始し、branch から別 tag を input する方式は許可しない。tag、`package.json`、lockfile、CHANGELOG の version が一致しない場合は publish 前に失敗させる
- tag の同じ source revision から npm tarball と4文書 PDFを一度だけ build し、GitHub Actions artifact に保存する。承認後に再 build せず、この tarball と PDF を publish まで昇格させる
- packed tarball は file allowlist、package 名、version、shrinkwrap、checksum、license file を検査し、空の一時 project へ install する。生成された install lock の package path、version、resolved source、integrity が公開 shrinkwrap と一致することを確認し、同一 tarball を macOS aarch64、Linux x86_64、Windows x86_64、Linux aarch64 で `npm ls --all --json`、`pfpdf --version`、実 PDF smoke test に使う
- GitHub Release は最初 draft として作成し、`build/docs/release/` の4 PDFと `SHA256SUMS` だけを upload する。upload 直後と公開直前に remote asset の exact set、upload state、size、SHA-256 digest を staging metadata と照合する。template preview、npm tarball、内部 metadata は Release asset に含めない
- `release` GitHub Environment は required reviewer、self-review 禁止、release tag 制限を持つ。承認画面の job summary に source commit、tarball file count と SHA-256、toolchain version、4 PDF の checksum、全 matrix test の結果を表示する
- npm publish は `.github/workflows/release.yml` と `release` Environment に限定した GitHub Actions trusted publishing を使い、長期 npm token を repository secret に保存しない。OIDC に必要な `id-token: write` は publish job だけへ付与し、stable は `latest`、prerelease は `next` tag で公開する
- publish 後は public registry から exact version を新しい一時 project へ取得し、version と実 PDF smoke test を確認してから draft GitHub Release を公開する。公開確認、npm tarball SHA-256、Vivliostyle / Chromium / font version、4 PDF の checksum を release note に追記する
- npm と GitHub Release は atomic に公開できない。途中で失敗した場合、GitHub Release は draft のまま保つ。再実行時に npm 上の同 version の SHA-1 / integrity が staging tarball と一致すれば publish 済みとして後続検証から再開し、不一致なら停止する。公開済み artifact を上書き・再利用せず、修正版は新しい version とする
- shrinkwrap された transitive dependency の security fix も既存 release の install 結果へ自動反映されないため、lockfile を更新して全 smoke test を通した新しい patch release として配布する

Repository 外では次を一度だけ設定します。

- release 専用 GitHub App の App ID を `RELEASE_APP_ID` repository variable、private key を `RELEASE_APP_PRIVATE_KEY` Actions secret に置く
- npm package の trusted publisher を repository、workflow file `release.yml`、Environment `release` に固定し、public publish を許可する
- GitHub Environment `release` に required reviewer と deployment tag rule を設定し、release tag の更新・削除を ruleset で禁止する

## 6.6 文書の build と release

Makefile は公開用文書と template preview を別の出力 tree に生成します。

```bash
make docs-release          # default template による公開用 PDF 一式
make docs                  # docs-release の alias
make list-templates        # bundled template 名を一覧表示
make docs-template-default # default template の短い sample PDF
make docs-template-pfn     # pfn template の短い sample PDF
make docs-templates        # 全 bundled template の sample PDF
make docs-template-images  # 目視用に全ページをPNG化
```

- 公開用 PDF は `build/docs/release/`、template preview は `build/docs/templates/<template>/sample.pdf` に置き、同名 PDF の上書きと release への preview 混入を防ぐ
- template preview は公開文書全体ではなく、GFM、長い表とcode block、数式、local image、raw HTML、改ページを含む5ページ以上の共通sampleを使う。独立した表紙を持たない `compact` は4ページ以上とする。ページ数に上限は設けない。`compact` 以外は目次が2ページ以上になる見出し数を持たせ、`compact` は2段組み目次と本文をfirst pageに共存させる
- coding agentが文書全体をreviewできるよう、全ページを `pdftoppm` でPNG化し、`build/docs/template-images/<template>/page-NN.png` にページ順で置く。PDFが所定の最小ページ数に満たない場合、`compact` 以外で目次が2ページに継続しない場合、または `compact` のfirst pageに目次と本文が共存しない場合は画像化targetを失敗させる
- `resources/templates/manifest.json` を bundled template 一覧の正本とし、CLI の許可名、`list-templates`、`docs-templates` はこの一覧を使う。manifest と実 directory の一致を test する
- 各 target は checkout 内で build した現在の pfpdf を使い、registry 上の `latest` や以前の release に依存しない
- `SOURCE_DATE_EPOCH` を受け取り、release build では tag の source date を固定して再現可能性を高める
- release workflow は tag の sourceから `docs-release` で4 PDFを再生成し、`build/docs/release/*.pdf` だけをchecksumとともにdraft GitHub Releaseへuploadする。template previewのPDFとPNGはrelease assetに含めない。4 PDFが揃わないreleaseは公開状態へ進めない

## 6.7 versioning と license 文書

- CHANGELOG は Semantic Versioning に従い、`0.x` の破壊的変更も明記する
- release tag、source commit、npm tarball checksum、Vivliostyle、Chromium、font、4 PDF の checksum、publish 後 verification、security fix release の手順を記録する
- pfpdf が新規に作成するコードは MIT License とする。ただし npm package 全体が MIT の要素だけで構成されるとは表現しない
- Vivliostyle CLI は AGPL-3.0 の直接 runtime dependency である。配布経路(npm への同梱、ネットワークサービス)ごとの義務を整理し、正確な source version、upstream URL、license 文、変更の有無を記録する
- MathJax、highlight.js、フォント、Chromium、Node.js、GFM parser、CJK-friendly extension、PDF parser / rewriter についても、バージョン・ライセンス・入手元を `THIRD_PARTY_LICENSES.md` に一覧化する
- filename collision、heading slug、BCP 47 canonicalization に使う Unicode / language subtag data の version、license、入手元も固定し、更新時は anchor と既存文書の互換性差分を review する
- release 前に secret scan、dependency review、第三者ライセンス一覧の更新を確認する
