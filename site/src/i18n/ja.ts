import type { en } from './en';

export const ja: typeof en = {
  siteName: 'pfpdf',
  tagline: 'Markdown を印刷品質の PDF に',
  description:
    'pfpdf は Markdown を印刷品質の PDF に変換するコマンドラインツールです。GFM・数式・コードハイライト・BibTeX の引用・表紙に対応し、Vivliostyle と Chromium で日本語の文書も組版できます。',
  nav: { gallery: 'ギャラリー', docs: 'ドキュメント', github: 'GitHub' },
  langSwitch: { label: 'EN', title: 'Read this page in English' },
  theme: { toggle: 'ダークモード切替' },
  hero: {
    subcopy:
      '日本語の文書も Vivliostyle と Chromium で組版できます。GFM・数式・コードハイライト・BibTeX の引用・表紙に対応しています。',
    installNote: 'pfpdf の事前インストールは不要です。Node.js 22.12.0 以上と npm を用意し、npx で取得して実行します。',
    getStarted: 'はじめる',
    browseTemplates: 'テンプレートを見る',
    viewOnGitHub: 'GitHub で見る',
    inputLabel: 'document.md',
    outputLabel: 'document.pdf — pfn テンプレートで出力',
    copy: 'コピー',
    copied: 'コピーしました',
  },
  features: {
    title: '機能',
    items: [
      {
        title: 'GitHub の Markdown 記法（GFM）',
        body: '表・タスクリスト・取り消し線・自動リンク・入れ子のリストなど、GitHub で使われる記法に対応しています。',
      },
      {
        title: '日本語対応の強調処理',
        body: '`これは**「重要」**です` のように全角記号に隣接した強調も正しく変換されます。',
      },
      {
        title: '数式とコードハイライト',
        body: '文中と別行立ての数式、コードブロックのハイライトに対応しています。必要なアセットは同梱しています。',
      },
      {
        title: 'BibTeX 参考文献',
        body: 'フロントマターで .bib ファイルを指定し、\\cite{key} で番号付き引用と参考文献リストを生成します。',
      },
      {
        title: '7つのテンプレートとロゴの指定',
        body: '論文向けからコード中心の文書向けまで選べます。ロゴは同梱せず、--logo PATH で指定します。',
      },
      {
        title: '再配布可能な同梱フォント',
        body: '同梱テンプレートは既定で同梱フォントを使います。--host-fonts を指定すると、OS のフォントも検索対象に加わります。',
      },
      {
        title: 'ブラウザーの自動取得',
        body: '既定では、同梱の Vivliostyle CLI が Chromium を取得・管理します。--browser-path で既存の互換ブラウザーも指定できます。',
      },
      {
        title: '4環境で PDF 生成を検証',
        body: 'macOS（Arm64）・Linux（x64 / Arm64）・Windows（x64）の4環境で、実際のブラウザーによる PDF 生成を CI で検証しています。',
      },
    ],
  },
  teaser: {
    title: '7つのテンプレート、コマンド1つで',
    body: '同じサンプル文書を各テンプレートで PDF に変換しているので、レイアウトや表紙、1ページあたりの情報量を並べて比較できます。',
    cta: 'テンプレートギャラリーを見る',
  },
  quickStart: {
    title: 'クイックスタート',
    steps: [
      { title: 'Markdown を書く', body: 'Markdown を .md ファイルに書き、必要に応じて先頭のフロントマターにタイトル・著者・テンプレートを指定します。' },
      { title: 'npx @pfnet-research/pfpdf を実行', body: '--input に .md ファイル、--output に PDF の保存先を指定して実行します。' },
      { title: '印刷品質の PDF が完成', body: '既定では表紙・目次・ページ番号付きの PDF が生成されます。--output で指定した保存先を確認してください。' },
    ],
    directoryNote: 'ディレクトリーを --input に渡すと、直下の .md ファイルをファイル名順に1つの PDF にまとめます。CI 用にバージョンを固定する例も示します:',
    chromiumNote:
      '初回実行にはインターネット接続が必要で、PDF 描画用の Chromium の取得で数百 MB の通信が発生することがあります。npm パッケージとブラウザーのキャッシュが揃えば、同梱機能だけを使う文書はオフラインでも変換できます。Linux では Chromium に必要な OS の共有ライブラリーも用意してください。',
  },
  footer: {
    docs: 'ドキュメント',
    gallery: 'ギャラリー',
    github: 'GitHub',
    npm: 'npm',
    releases: 'Releases (PDF 版ドキュメント)',
    license: 'ライセンス',
    licenseNote:
      'pfpdf: MIT License。依存する Vivliostyle CLI は AGPL-3.0、その他は THIRD_PARTY_LICENSES.md を参照してください。',
    copyright: '© Preferred Networks, Inc.',
  },
  gallery: {
    title: 'テンプレートギャラリー',
    intro:
      '日本語・英語それぞれで同じサンプル文書を使っているので、7つの同梱テンプレートのレイアウトや表紙、1ページあたりの情報量を比較できます。--template NAME で切り替えます。',
    pages: (n: number) => `全${n}ページ`,
    sampleTabs: { en: '英語サンプル', ja: '日本語サンプル' },
    jaShowcase: '日本語サンプルでは、日本語と英語が混じる文章や強調表示の組版例を確認できます。',
    downloadEn: 'サンプル PDF (英語)',
    downloadJa: 'サンプル PDF (日本語)',
    cliLabel: 'このテンプレートで文書を変換:',
    prev: '前のテンプレート',
    next: '次のテンプレート',
    tutorialLink: 'チュートリアルで詳しく: テンプレート・ロゴ・アセット・フォント',
    lightbox: { close: '閉じる', prev: '前のページ', next: '次のページ' },
    pageAlt: (template: string, lang: string, page: number) =>
      `${template} テンプレート（${lang === 'ja' ? '日本語' : '英語'}サンプル）の${page}ページ目`,
  },
  templateDescriptions: {
    academic: '論文・研究レポート向け',
    book: '長文・書籍向け',
    compact: '省スペース',
    default: '標準',
    notebook: 'カジュアル・ノート風',
    pfn: '企業文書向け',
    technical: 'コード中心・高密度',
  },
  docs: {
    title: 'ドキュメント',
    onThisPage: 'このページの目次',
    chapters: '章一覧',
    prev: '前の章',
    next: '次の章',
    editNote: 'このページは GitHub 上のチュートリアルから生成されています。',
  },
  notFound: {
    title: 'ページが見つかりません',
    body: 'トップページやテンプレートギャラリーからお探しください。',
    home: 'トップページへ',
    gallery: 'テンプレートギャラリーへ',
  },
};
