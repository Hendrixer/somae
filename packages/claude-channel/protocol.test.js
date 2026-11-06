import test from 'node:test';
import assert from 'node:assert/strict';
import { tools, validateEvent } from './src/protocol.js';

test('channel events require exact safe conversation and input identities', () => {
  assert.deepEqual(validateEvent({ conversation_id: 'conversation_1', input_id: 'input_1', content: 'Review this.' }), { conversation_id: 'conversation_1', input_id: 'input_1', content: 'Review this.' });
  for (const value of [null, [], {}, { conversation_id: '../foreign', input_id: 'input_1', content: 'Hello' }, { conversation_id: 'ok', input_id: 'bad" tag', content: 'Hello' }, { conversation_id: 'ok', input_id: 'input_1', content: ' ' }, { conversation_id: 'ok', input_id: 'input_1', content: 'a'.repeat(100001) }]) assert.throws(() => validateEvent(value));
});

test('artifact review exposes exact versions and no agent-defined decision controls', () => {
  const review = tools.find(tool => tool.name === 'request_review').inputSchema;
  assert.deepEqual(Object.keys(review.properties).sort(), ['artifacts', 'conversation_id', 'input_id', 'text']);
  assert.deepEqual(review.required, ['conversation_id', 'text', 'artifacts']);
  assert.equal(review.additionalProperties, false);
  assert.equal(review.properties.artifacts.minItems, 1);
  assert.equal(review.properties.artifacts.items.additionalProperties, false);
  assert.deepEqual(review.properties.artifacts.items.required, ['artifact_id', 'revision']);
  assert.equal(review.properties.artifacts.items.properties.revision.minimum, 1);
  const question = tools.find(tool => tool.name === 'ask_question').inputSchema;
  assert.equal(question.properties.choices.maxItems, 8);
  assert.equal(question.required.includes('choices'), false);
});
