import { marked } from 'marked';
import { parse } from 'parse5';

const hidden = new Set(['script', 'style', 'iframe', 'object', 'template', 'noscript', 'svg']);
const blockTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'pre', 'blockquote', 'td', 'th']);

/** Inert document model: no agent HTML, scripts or URLs reach the privileged view. */
export function documentModel(source, mediaType) {
  if (source.length > 2_000_000) throw new Error('Document preview exceeds 2 MB. Download the original instead.');
  if (!['text/markdown', 'text/plain', 'text/html'].includes(mediaType)) return null;
  if (mediaType === 'text/plain') return source.split(/\n\s*\n/).filter(Boolean).map((text, i) => ({ id: `block_${i}`, type: 'p', text }));
  const tree = parse(mediaType === 'text/markdown' ? marked.parse(source, { async: false }) : source);
  const blocks = [];
  const textOf = node => hidden.has(node.tagName) ? '' : node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(textOf).join(node.tagName === 'br' ? '\n' : '');
  const visit = node => {
    if (hidden.has(node.tagName)) return;
    if (blockTags.has(node.tagName)) {
      const text = textOf(node).trim();
      if (text) blocks.push({ id: `block_${blocks.length}`, type: node.tagName, text });
      return;
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(tree);
  if (!blocks.length) {
    const text = textOf(tree).trim();
    if (text) blocks.push({ id: 'block_0', type: 'p', text });
  }
  return blocks;
}
