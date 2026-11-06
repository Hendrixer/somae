import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, DomainError, verifyState } from './index.js';
import { createFixture } from './fixtures.js';

function setup() {
  const fixture = createFixture('hosted_coding');
  let sequence = 100;
  const runtime = createRuntime({ seed: fixture.seed, clock: () => '2026-10-18T20:00:00.000Z', idFactory: prefix => `${prefix}_${++sequence}` });
  const { artifact } = runtime.execute({
    command: 'artifact.publish', idempotency_key: 'publish-cover', conversation_id: fixture.conversation_id,
    media_type: 'image/png', presentation_type: 'image', content_ref: { uri: 'https://assets.example.test/cover.png', origin: 'https://assets.example.test', access: 'conversation' },
    digest: 'a'.repeat(64), size: 512, description: 'A cover to review.',
  }, fixture.agent);
  const refs = [{ artifact_id: artifact.id, revision: artifact.revision }];
  const { signal } = runtime.execute({
    command: 'signal.publish', idempotency_key: 'request-review', conversation_id: fixture.conversation_id,
    kind: 'approval', content: [{ type: 'text', text: 'Do you approve this cover?' }], artifact_refs: refs,
    interaction: {
      id: 'cover-review', mode: 'required', response_type: 'approval', consequences: 'Record a review decision; no permission to publish.',
      actions: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Disapprove' }],
      terms: { operation: 'review', scope: 'content', target: 'Cover', artifact_refs: refs },
    }, presentation: { type: 'native' },
  }, fixture.agent);
  const command = {
    command: 'response.submit', idempotency_key: 'cover-decision', signal_id: signal.id,
    expected_revision: signal.revision, interaction_id: signal.interaction.id,
    value: { action_id: 'approve', terms_digest: signal.interaction.terms_digest }, artifact_refs: refs,
    content: [{ type: 'text', text: 'The composition works. Keep the headline as it is.' }, { type: 'artifact', ...refs[0] }],
  };
  return { ...fixture, runtime, artifact, signal, refs, command };
}

function denied(run, code) {
  assert.throws(run, error => error instanceof DomainError && error.code === code && error.ruleIds.length > 0);
}

test('a response carries its canonical decision and feedback in one atomic pinned message and delivery', () => {
  const s = setup();
  const before = s.runtime.snapshot();
  const accepted = s.runtime.execute(s.command, s.desktop);
  const after = s.runtime.snapshot();
  assert.deepEqual(accepted.message.content, [{ type: 'text', text: 'Approve' }, ...s.command.content]);
  assert.deepEqual(accepted.response.value, s.command.value);
  assert.equal(accepted.response.terms_digest, s.signal.interaction.terms_digest);
  assert.deepEqual(accepted.response.artifact_refs, s.refs);
  assert.equal(accepted.message.in_reply_to_message_id, s.signal.message_id);
  assert.equal(accepted.response.signal_revision, s.signal.revision);
  assert.equal(accepted.signal.state, 'answered');
  assert.equal(accepted.signal.response_id, accepted.response.id);
  assert.equal(accepted.delivery.response_id, accepted.response.id);
  assert.equal(accepted.delivery.message_id, accepted.message.id);
  assert.equal(accepted.response.delivery_id, accepted.delivery.id);
  for (const collection of ['responses', 'messages', 'deliveries']) assert.equal(Object.keys(after[collection]).length, Object.keys(before[collection]).length + 1, collection);
  assert.deepEqual(verifyState(after), []);
  s.command.content[0].text = 'A caller cannot rewrite accepted feedback.';
  accepted.message.content[1].text = 'A result cannot rewrite accepted feedback.';
  assert.deepEqual(s.runtime.snapshot(), after);
});

test('invalid response feedback and undeclared artifact blocks leave the request and outbox unchanged', () => {
  const s = setup();
  const before = s.runtime.snapshot();
  for (const feedback of [null, 'feedback', [null], [{ type: 'html', text: '<script>run()</script>' }], [{ type: 'text', text: '' }], Array.from({ length: 100 }, () => ({ type: 'text', text: 'Too many blocks.' }))]) {
    denied(() => s.runtime.execute({ ...s.command, content: feedback }, s.desktop), 'content_invalid');
    assert.deepEqual(s.runtime.snapshot(), before);
  }
  denied(() => s.runtime.execute({ ...s.command, artifact_refs: [] }, s.desktop), 'artifact_revision_invalid');
  assert.deepEqual(s.runtime.snapshot(), before);
});

test('response feedback does not bypass stale request revisions or exact approval terms', () => {
  const s = setup();
  const before = s.runtime.snapshot();
  denied(() => s.runtime.execute({ ...s.command, value: { action_id: 'approve', terms_digest: 'outdated-terms' } }, s.desktop), 'approval_terms_invalid');
  assert.deepEqual(s.runtime.snapshot(), before);
  const { terms_digest: _digest, ...interaction } = s.signal.interaction;
  s.runtime.execute({
    command: 'signal.update', idempotency_key: 'update-review', signal_id: s.signal.id, expected_revision: 1,
    kind: 'approval', content: [{ type: 'text', text: 'Review this updated request.' }], artifact_refs: s.refs,
    interaction, presentation: { type: 'native' },
  }, s.agent);
  const updated = s.runtime.snapshot();
  denied(() => s.runtime.execute(s.command, s.desktop), 'signal_stale');
  assert.deepEqual(s.runtime.snapshot(), updated);
});

test('response feedback retries reuse the same message and delivery and reject changed feedback', () => {
  const s = setup();
  const accepted = s.runtime.execute(s.command, s.desktop);
  const before = s.runtime.snapshot();
  assert.deepEqual(s.runtime.execute(s.command, s.mobile), accepted);
  assert.deepEqual(s.runtime.snapshot(), before);
  denied(() => s.runtime.execute({ ...s.command, content: [{ type: 'text', text: 'Different feedback.' }] }, s.desktop), 'idempotency_conflict');
  assert.deepEqual(s.runtime.snapshot(), before);
});

test('a decision without additional feedback retains the canonical answer and normal response validation', () => {
  for (const includeContent of [false, true]) {
    const s = setup();
    const { content: _content, ...command } = s.command;
    const accepted = s.runtime.execute({ ...command, ...(includeContent ? { content: [] } : {}) }, s.desktop);
    assert.deepEqual(accepted.message.content, [{ type: 'text', text: 'Approve' }]);
    assert.deepEqual(verifyState(s.runtime.snapshot()), []);
  }
});
