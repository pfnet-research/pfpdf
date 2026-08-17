# 6. 配布と release

## 6.1 npm package 設計

- repository / CI は `package-lock.json` で完全な dependency tree と integrity を固定する。公開 package の install では `package-lock.json` が使われないため、`package.json` の direct runtime dependency は exact version とし、review 済み lockfile と同じ tree から `npm-shrinkwrap.json` を隔離した staging directory で生成して tarball に含める
- Node.js の対応 semver range は pinned Vivliostyle CLI と全 direct runtime dependency の要件の共通部分から確定し、非連続 range も単純な最低 version へ広げない。`package.json` の `engines`、起動時検査、4 つの対応環境の CI で同じ range を使う
- TypeScript の compile target と公開 JavaScript の構文は range の最古 runtime で load できる値にし、version error を出す entrypoint 自体が未対応構文で parse error にならないことを最古 runtime の packed-package test で確認する
- browser の取得と cache は pinned Vivliostyle CLI の標準機構に任せ、pfpdf は `--browser-path` / `PFPDF_BROWSER_PATH` による明示 override だけを提供する
- npm tarball には compile 済み JavaScript、template、CSS、font、MathJax、highlight.js、license 文書を含める
- `npm pack --dry-run` で内容を review し、`npm-shrinkwrap.json` が含まれ `package-lock.json` が含まれないことを確認するが、独自の size budget、SBOM、署名、provenance は release 要件にしない
- pfpdf 自身の lifecycle script による暗黙の browser download や root 権限の変更は行わない。transitive dependency の lifecycle script も lockfile review と clean install test で確認する。browser 取得が必要な場合は最初の明示的な実行時に upstream の標準機構を使う

## 6.2 公開 tarball の内容

npm package の `bin` field から compile 済みの `dist/cli.js` を `pfpdf` として公開します。

- 公開 tarball には package metadata / shrinkwrap、`dist/`、必要な resource、README、license 文書だけを含め、TypeScript source map にローカル絶対パスが残らないことを確認する
- `package.json` の `files` allowlist と CI 上で展開した tarball の確認を使い、test fixture、`.env`、cache などを publish しない
- npm package 名は公開前に Organization の所有下で確保し、確保できない場合は Organization の scoped package を使う。registry の `404` は名前の予約を意味しない

## 6.3 ディレクトリ構成

```text
pfpdf/
  .github/workflows/
    ci.yml
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
    renderer/
      index.ts
      internal.ts
      local.ts
      docker.ts
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
  tests/
  Makefile
  package.json
  package-lock.json
  tsconfig.json
  Dockerfile
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
- pull request ごとに TypeScript test、lint、packed npm package test、4 環境の最小 PDF smoke test を実行する
- pull request ごとに `make docs-release docs-templates` を実行し、公開用の日英の正典・翻訳と、すべての bundled template による preview が build できることを確認する
- `scripts/check-doc-translations.mjs` で日英の file 対応と変更同期を検査し、翻訳の意味上の一致は pull request review の必須 checklist にする
- `scripts/check-doc-policy.mjs` で、すべての `AGENTS.md` に日本語文字が含まれないことを検査する
- Vivliostyle CLI は npm の最新版を実行時に無条件取得せず、検証済みの 1 バージョンを direct dependency の exact spec、source lockfile、公開 shrinkwrap で固定する。更新は自動マージせず、各対象 OS のサンプル PDF スモークテスト後に行う
- CI の test command は network から conformance fixture や script を取得せず、lockfile と repository に固定した入力だけを使う。dependency download が必要な job と offline behavior の検査を分ける

## 6.5 publish

- npm publish は GitHub Actions の trusted publishing を使い、長期 npm token を repository secret に保存しない
- npm publish 前に package 名、version、tarball の file list、checksum、license file を確認する dry-run job と human approval environment を設ける
- publish 前は同じ source revision から npm tarball、architecture ごとの Docker image、文書 PDF、checksum を staging し、空の一時 project へ packed tarball を install して `npm ls --json` の runtime tree が shrinkwrap と一致することを確認する。registry 経由の `npx pfpdf@<version>` は prerelease tag または publish 後 verification で確認する
- GitHub Release は最初 draft として作成し、4 PDF と checksum の upload を確認してから公開する。Docker は architecture ごとの immutable digest を先に検査し、その digest だけから version manifest を作る
- npm、Docker、GitHub Release を atomic に公開することはできない。途中で失敗した場合は既に公開した immutable artifact を上書き・再利用せず、release を incomplete として記録し、修正版を新しい version で公開する
- publish 後に npm と Docker の public endpoint から exact version と internal renderer protocol の一致を検証する。失敗した version は上書きせず、問題を修正した新しい version を公開する
- shrinkwrap された transitive dependency の security fix も既存 release の install 結果へ自動反映されないため、lockfile を更新して全 smoke test を通した新しい patch release として配布する

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
- Docker image は release tag と同じ version tag で `linux/amd64` / `linux/arm64` を public registry へ publish し、両 architecture の実 browser test 後に multi-architecture manifest を作成する。digest は release note に記録する

## 6.7 versioning と license 文書

- CHANGELOG は Semantic Versioning に従い、`0.x` の破壊的変更も明記する
- release tag、Vivliostyle、Chromium、font、4 PDF の checksum、publish 後 verification、security fix release の手順を記録する
- pfpdf が新規に作成するコードは MIT License とする。ただし npm package や Docker image 全体が MIT の要素だけで構成されるとは表現しない
- Vivliostyle CLI は AGPL-3.0 の直接 runtime dependency である。配布経路(npm への同梱、Docker image、ネットワークサービス)ごとの義務を整理し、正確な source version、upstream URL、license 文、変更の有無を記録する
- MathJax、highlight.js、フォント、Chromium、Node.js、GFM parser、CJK-friendly extension、PDF parser / rewriter についても、バージョン・ライセンス・入手元を `THIRD_PARTY_LICENSES.md` に一覧化する
- filename collision、heading slug、BCP 47 canonicalization に使う Unicode / language subtag data の version、license、入手元も固定し、更新時は anchor と既存文書の互換性差分を review する
- release 前に secret scan、dependency review、第三者ライセンス一覧の更新を確認する
