import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSignalMarkdown, signalContent, signalLink } from './signal-content.js';

test('signal body formats Markdown while keeping its existing display title separate', () => {
  const signal = { kind: 'question', content: [{ type: 'text', text: 'Do you approve these features?\n\n1. **Links** keep their label.\n2. `properties` stay in the file.\n\n> The original is retained.' }] };
  const result = signalContent(signal);
  assert.equal(result.title, 'Do you approve these features?');
  assert.match(result.bodyHtml, /<ol>\n<li><strong>Links<\/strong> keep their label\.<\/li>/);
  assert.match(result.bodyHtml, /<code>properties<\/code>/);
  assert.match(result.bodyHtml, /<blockquote>/);
  assert.doesNotMatch(result.bodyHtml, /Do you approve/);
  assert.equal(signal.content[0].text.startsWith('Do you approve'), true);
});

test('Markdown and legacy text blocks share the renderer without changing title fallbacks', () => {
  assert.deepEqual(signalContent({ kind: 'question', content: [{ type: 'text', text: 'Which one?' }] }), { title: 'Which one?', body: '', bodyHtml: '' });
  assert.equal(signalContent({ kind: 'result', content: [{ type: 'markdown', text: 'Ready\n\nA **small** update.' }] }).bodyHtml, '<p>A <strong>small</strong> update.</p>\n');
  assert.equal(signalContent({ kind: 'result', content: [{ type: 'text', text: 'A short reply.' }] }, { hasArtifacts: true }).title, 'Ready for your eye.');
  assert.equal(signalContent({ kind: 'result', content: [{ type: 'artifact', text: 'Ignore me' }, { type: 'text', text: 'Ready' }, { type: 'markdown', text: 'A *small* update.' }] }).bodyHtml, '<p>A <em>small</em> update.</p>\n');
  assert.equal(signalContent(null).title, 'A word from Claude.');
});

test('formatting does not introduce another main heading or interactive task controls', () => {
  const html = renderSignalMarkdown('# Details\n\n- [x] Complete\n- [ ] Later\n\n```html\n<button onclick="send()">Go</button>\n```\n\n~~old~~ and *new*');
  assert.match(html, /<h2>Details<\/h2>/);
  assert.match(html, /class="markdown-check" aria-label="Checked"/);
  assert.match(html, /&lt;button onclick=&quot;send\(\)&quot;&gt;Go&lt;\/button&gt;/);
  assert.match(html, /<del>old<\/del> and <em>new<\/em>/);
  assert.doesNotMatch(html, /<(?:h1|input|button)\b/);
});

test('raw HTML and images remain inert even inside Markdown links or emphasis', () => {
  const html = renderSignalMarkdown('<script>window.evil=true</script>\n\n<img src=x onerror=evil()>\n\n**<svg onload=evil()>x</svg>**\n\n![remote](https://evil.example/track.png)\n\n![local](file:///private/data)\n\n[<img src=x onerror=evil()>](https://example.com)');
  assert.doesNotMatch(html, /<(?:script|img|svg|iframe|object|form|style)\b/i);
  assert.match(html, /&lt;script&gt;window.evil=true&lt;\/script&gt;/);
  assert.match(html, /remote/);
  assert.match(html, /local/);
  assert.match(html, /<a href="https:\/\/example.com\/" data-signal-link target="_blank" rel="noopener noreferrer">&lt;img/);
});

test('only absolute HTTP/S URLs produce links; schemes, local routes and credentials do not', () => {
  for (const href of ['javascript:alert(1)', 'jav&#97;script:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>evil()</script>', 'file:///tmp/private', 'mailto:a@example.com', '/api/operations', '//example.com', '#settings', 'somae://send', 'https://user:secret@example.com']) {
    assert.equal(signalLink(href), null, href);
  }
  const html = renderSignalMarkdown('[safe](https://example.com/path?a=1&b=2) [unsafe](javascript:alert%281%29) [local](/api/operations)');
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.match(html, /href="https:\/\/example.com\/path\?a=1&amp;b=2"/);
  assert.match(html, />safe<\/a> unsafe local/);
  assert.equal(signalLink('https://example.com/?a=1&amp;b=2'), 'https://example.com/?a=1&b=2');
});

test('escaped punctuation, entities, tables and oversized input remain readable without raw DOM', () => {
  const html = renderSignalMarkdown('R&D &amp; tea \\*literal\\*\n\n| Item | State |\n| --- | --- |\n| **Links** | done |');
  assert.match(html, /R&amp;D &amp; tea \*literal\*/);
  assert.match(html, /<table>/);
  assert.match(html, /<strong>Links<\/strong>/);
  const large = '<img onerror=evil()>'.repeat(6000);
  assert.doesNotMatch(renderSignalMarkdown(large), /<img/);
  assert.equal(renderSignalMarkdown(undefined), '');
});
