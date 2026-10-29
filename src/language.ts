/** Small, deterministic Japanese/English classifier for omitted document lang. */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';
import type { SourceFile } from './input.js';

export function inferDocumentLanguage(files: SourceFile[], title: string): 'ja' | 'en' {
  let prose = '';
  const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
  for (const file of files) {
    // Text nodes omit fenced/inline code, math, raw HTML blocks, link targets,
    // and front matter. Keep authored link labels and footnote prose.
    visit(parser.parse(file.content), 'text', (node) => { prose += `${node.value}\n`; });
  }
  const count = (text: string): { hiragana: number; kana: number; han: number; latin: number } => {
    const cleaned = text.replace(/https?:\/\/\S+/gi, '');
    const hiragana = cleaned.match(/\p{Script=Hiragana}/gu)?.length ?? 0;
    const katakana = cleaned.match(/\p{Script=Katakana}/gu)?.length ?? 0;
    return {
      hiragana,
      kana: hiragana + katakana,
      han: cleaned.match(/\p{Script=Han}/gu)?.length ?? 0,
      latin: cleaned.match(/\p{Script=Latin}/gu)?.length ?? 0,
    };
  };
  let counts = count(prose);
  if (counts.kana + counts.han + counts.latin === 0) counts = count(title);
  const { hiragana, kana, han, latin } = counts;
  const letters = kana + han + latin;
  // Hiragana is strong Japanese evidence even in technical prose with many
  // English identifiers. Isolated Japanese examples in English are insufficient.
  return (hiragana >= 2 && hiragana * 100 >= letters)
    || (kana > 0 && kana + han >= latin)
    || han > latin ? 'ja' : 'en';
}
