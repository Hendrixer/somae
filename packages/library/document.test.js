import test from 'node:test';
import assert from 'node:assert/strict';
import { documentModel } from './document.js';

test('review document model exposes natural text without executable HTML or hidden instructions', () => {
  const model = documentModel('<h1>Welcome</h1><script>steal()</script><p>Hello <strong>creators</strong>.</p><iframe>hidden</iframe>', 'text/html');
  assert.deepEqual(model, [{ id: 'block_0', type: 'h1', text: 'Welcome' }, { id: 'block_1', type: 'p', text: 'Hello creators.' }]);
  assert.deepEqual(documentModel('# Welcome\n\nHello **creators**.', 'text/markdown'), model);
});
