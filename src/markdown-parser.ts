/** The pinned syntax shared by document rendering and title inference. */
import { unified, type Processor } from 'unified';
import type { Root } from 'mdast';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkMath from 'remark-math';

export function createMarkdownParser(): Pick<Processor<Root>, 'parse'> {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkCjkFriendly)
    .use(remarkMath, { singleDollarTextMath: true });
}
