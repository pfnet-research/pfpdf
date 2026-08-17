import type { en } from './en';

export const ja: typeof en = {
  siteName: 'pfpdf',
  tagline: 'Markdown から、印刷品質の PDF へ',
  description:
    'pfpdf は Markdown を印刷品質の PDF に変換するコマンドラインツールです。日本語組版を第一級でサポートし、GFM・数式・コードハイライト・BibTeX・表紙を Vivliostyle と Chromium で組版します。',
  nav: { gallery: 'ギャラリー', docs: 'ドキュメント', github: 'GitHub' },
  langSwitch: { label: 'EN', title: 'Read this page in English' },
  theme: { toggle: 'ダークモード切替' },
  hero: {
    subcopy:
      '日本語組版を第一級でサポート。GFM・数式・コードハイライト・BibTeX・表紙を Vivliostyle と Chromium で組版します。',
    installNote: 'インストール不要 — npx がそのまま pfpdf を取得して実行します。',
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
        title: 'GFM Markdown',
        body: '表・タスクリスト・取り消し線・自動リンク・ネストしたリストなど、GitHub 標準の記法がそのまま使えます。',
      },
      {
        title: '日本語対応の強調処理',
        body: '`これは**「重要」**です` のように全角記号に隣接した強調も正しく変換されます。',
      },
      {
        title: '数式とコードハイライト',
        body: 'インライン・ディスプレイ数式とコードブロックのハイライトを同梱アセットだけで組版します。',
      },
      {
        title: 'BibTeX 参考文献',
        body: 'front matter で .bib を指定し、\\cite{key} で番号付き引用と参考文献リストを生成します。',
      },
      {
        title: '7つの同梱テンプレート + ロゴ注入',
        body: '論文向けからコード主体まで。ロゴは同梱せず --logo PATH で注入します。',
      },
      {
        title: '再配布可能な同梱フォント',
        body: '既定で OS フォントに依存しません。ホストフォントの利用は明示的なオプトインです。',
      },
      {
        title: 'ローカル & Docker レンダラー',
        body: '既定はローカルレンダリング。CI では公開 Docker イメージを明示的に選択できます。',
      },
      {
        title: '4環境で実ブラウザ CI 済み',
        body: 'macOS・Linux・Windows の4環境で実ブラウザによる PDF 生成を CI で検証しています。',
      },
    ],
  },
  teaser: {
    title: '7つのテンプレート、コマンド1つで',
    body: 'すべてのテンプレートが同じサンプル文書をレンダリングするので、組版・表紙・密度を並べて比較できます。',
    cta: 'テンプレートギャラリーを見る',
  },
  quickStart: {
    title: 'クイックスタート',
    steps: [
      { title: 'Markdown を書く', body: '普通の .md ファイルに、必要なら front matter でタイトル・著者・テンプレートを指定します。' },
      { title: 'npx pfpdf を実行', body: 'インストール不要。ディレクトリを渡すと直下の Markdown を1つの PDF に結合します。' },
      { title: '印刷品質の PDF が完成', body: '表紙・目次・ページ番号つきの組版済み PDF がそのまま得られます。' },
    ],
    directoryNote: 'ディレクトリの一括変換や、CI でのバージョン固定も可能です:',
    chromiumNote:
      '初回実行時に PDF 描画用の Chromium (数百MB) をダウンロードします。以後はキャッシュを使い、同梱機能のみの文書はオフラインでも変換できます。',
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
      '7つの同梱テンプレートはすべて同一のサンプル文書 (日本語・英語) から生成されており、組版・表紙・密度の違いをそのまま比較できます。--template NAME で切り替えます。',
    pages: (n: number) => `全${n}ページ`,
    sampleTabs: { en: '英語サンプル', ja: '日本語サンプル' },
    jaShowcase: '日本語サンプルは pfpdf の日本語組版のショーケースを兼ねています。',
    downloadEn: 'サンプル PDF (英語)',
    downloadJa: 'サンプル PDF (日本語)',
    cliLabel: 'このテンプレートで文書を変換:',
    prev: '前のテンプレート',
    next: '次のテンプレート',
    tutorialLink: 'チュートリアルで詳しく: テンプレート・ロゴ・アセット・フォント',
    lightbox: { close: '閉じる', prev: '前のページ', next: '次のページ' },
    pageAlt: (template: string, lang: string, page: number) =>
      `${template} テンプレート (${lang} サンプル) — ${page} ページ目`,
  },
  templateDescriptions: {
    academic: '論文・研究レポート向け',
    book: '長文・書籍向け',
    compact: '省スペース',
    default: '標準',
    notebook: 'カジュアル・ノート風',
    pfn: 'コーポレート',
    technical: 'コード主体・高密度',
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
    body: 'お探しのページは存在しません。',
    home: 'トップページへ',
    gallery: 'テンプレートギャラリーへ',
  },
};
