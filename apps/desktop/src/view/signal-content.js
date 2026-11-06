import { Marked } from 'marked';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

/** Only explicit web links may leave a signal. Relative/local/app URLs stay inert. */
export function signalLink(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const decoded = value.replace(/&#(x[\da-f]+|\d+);?/gi, (_, entity) => {
    const code = Number.parseInt(entity.replace(/^x/i, ''), /^x/i.test(entity) ? 16 : 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
  }).replace(/&amp;/gi, '&');
  if (!/^https?:\/\//i.test(decoded) || /[\u0000-\u001f\u007f]/.test(decoded)) return null;
  try {
    const url = new URL(decoded);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

// Use the same Markdown parser as document previews, with fixed renderer rules.
// Raw HTML is text, images are alt text, and no agent-provided DOM attributes,
// styles, IDs, form controls or URL schemes reach the privileged webview.
const markdown = new Marked({
  async: false,
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) { return escape(text); },
    image({ text }) { return escape(text); },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      const url = signalLink(href);
      return url ? `<a href="${escape(url)}" data-signal-link target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    },
    heading({ depth, tokens }) {
      const level = Math.min(4, Math.max(2, depth + 1));
      return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
    },
    checkbox({ checked }) { return `<span class="markdown-check" aria-label="${checked ? 'Checked' : 'Unchecked'}">${checked ? '☑' : '☐'}</span> `; },
  },
});

/** Render only formatting. Attachments continue through the existing originals route. */
export function renderSignalMarkdown(source) {
  const text = typeof source === 'string' ? source : '';
  if (!text) return '';
  // Unusually large or pathological input still remains readable inert text.
  if (text.length > 100_000) return `<p>${escape(text)}</p>`;
  try { return markdown.parse(text); }
  catch { return `<p>${escape(text)}</p>`; }
}

/** Keep the existing short, plain first-line title convention separate from the body. */
export function signalContent(signal, { hasArtifacts = false } = {}) {
  const copy = (signal?.content ?? []).filter(block => ['text', 'markdown'].includes(block.type) && typeof block.text === 'string').map(block => block.text).join('\n\n');
  const parts = copy.split('\n');
  const first = parts[0];
  const hasShortTitle = first.length < 110 && parts.length > 1;
  const questionTitle = signal?.kind === 'question' && parts.length === 1 && copy.length < 110;
  const title = hasShortTitle || questionTitle ? first : signal?.kind === 'question' ? 'A question for you.' : hasArtifacts ? 'Ready for your eye.' : 'A word from Claude.';
  const body = questionTitle ? '' : hasShortTitle ? parts.slice(1).join('\n').trim() : copy;
  return { title, body, bodyHtml: renderSignalMarkdown(body) };
}
