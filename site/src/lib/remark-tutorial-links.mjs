// Rewrites intra-tutorial references when docs/tutorial.* chapters are
// rendered as site pages:
//   03_gfm.md#anchor -> ../gfm/#anchor   (language independent)
//   assets/example.svg -> /assets/docs/<lang>/example.svg (relativized post-build)

const CHAPTER_LINK = /^(?:\.\/)?\d{2}_([A-Za-z0-9-]+)\.md(#.*)?$/;
const ASSET_LINK = /^(?:\.\/)?assets\/(.+)$/;

function visit(node, callback) {
  callback(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      visit(child, callback);
    }
  }
}

export function remarkTutorialLinks() {
  return (tree, file) => {
    const filePath = String(file.path ?? '');
    const langMatch = filePath.match(/tutorial\.(en|ja)\//);
    if (langMatch === null) {
      return;
    }
    const lang = langMatch[1];
    visit(tree, (node) => {
      if ((node.type !== 'link' && node.type !== 'image') || typeof node.url !== 'string') {
        return;
      }
      const chapter = node.url.match(CHAPTER_LINK);
      if (chapter !== null) {
        node.url = `../${chapter[1]}/${chapter[2] ?? ''}`;
        return;
      }
      const asset = node.url.match(ASSET_LINK);
      if (asset !== null) {
        node.url = `/assets/docs/${lang}/${asset[1]}`;
      }
    });
  };
}
