import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, verifyState, DomainError } from './index.js';
import { createFixture } from './fixtures.js';

const NOW = '2026-10-11T12:00:00.000Z';
const SYSTEM = { kind: 'system' };
const content = [{ type: 'text', text: 'A new thought.' }];
function setup(kind = 'hosted_coding') {
  const fixture = createFixture(kind);
  let sequence = 200;
  return { ...fixture, runtime: createRuntime({ seed: fixture.seed, clock: () => NOW, idFactory: prefix => `${prefix}_${++sequence}` }) };
}
function denied(fn, code) {
  assert.throws(fn, error => error instanceof DomainError && error.code === code && error.ruleIds.length > 0);
}
function submit(fixture, key = 'message-1', principal = fixture.desktop) {
  return fixture.runtime.execute({ command: 'message.submit', idempotency_key: key, conversation_id: fixture.conversation_id, content }, principal);
}
function publish(fixture, overrides = {}) {
  return fixture.runtime.execute({
    command: 'signal.publish', idempotency_key: 'signal-1', conversation_id: fixture.conversation_id,
    kind: 'question', content,
    interaction: { id: 'choose', mode: 'required', response_type: 'single_choice', consequences: 'Continue the conversation.', actions: [{ id: 'yes', label: 'Continue' }] },
    presentation: { type: 'native' }, ...overrides,
  }, fixture.agent);
}

test('same-person message retry from another device reuses the original submission and origin', () => {
  const fixture = setup();
  const first = submit(fixture);
  const before = fixture.runtime.snapshot();
  const retry = submit(fixture, 'message-1', fixture.mobile);
  assert.deepEqual(retry, first);
  assert.deepEqual(fixture.runtime.snapshot(), before);
  assert.equal(retry.message.author.device_id, fixture.desktop.device_id);
});

test('same-person response retry from another device returns the first accepted response', () => {
  const fixture = setup();
  const { signal } = publish(fixture);
  const command = { command: 'response.submit', idempotency_key: 'response-1', signal_id: signal.id, expected_revision: signal.revision, interaction_id: signal.interaction.id, value: { option_id: 'yes' } };
  const first = fixture.runtime.execute(command, fixture.desktop);
  const before = fixture.runtime.snapshot();
  assert.deepEqual(fixture.runtime.execute(command, fixture.mobile), first);
  assert.deepEqual(fixture.runtime.snapshot(), before);
  assert.equal(first.response.origin_device_id, fixture.desktop.device_id);
});

test('inherited command names are unsupported domain commands with stable errors', () => {
  const fixture = setup();
  const before = fixture.runtime.snapshot();
  for (const command of ['toString', 'constructor', '__proto__']) {
    denied(() => fixture.runtime.execute({ command, idempotency_key: command }, SYSTEM), 'command_unsupported');
  }
  assert.deepEqual(fixture.runtime.snapshot(), before);
});

test('inherited endpoint identifiers cannot become resources or mutate object prototypes', () => {
  const fixture = setup();
  const before = fixture.runtime.snapshot();
  const original = Object.getOwnPropertyDescriptor(Object.prototype, 'online');
  try {
    for (const endpoint_id of ['__proto__', 'constructor', 'toString']) {
      denied(() => fixture.runtime.execute({ command: 'endpoint.set_availability', idempotency_key: endpoint_id, endpoint_id, online: false }, SYSTEM), 'not_found');
    }
    assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, 'online'), original);
    assert.deepEqual(fixture.runtime.snapshot(), before);
  } finally {
    if (original) Object.defineProperty(Object.prototype, 'online', original);
    else delete Object.prototype.online;
  }
});

test('state audit reports malformed records and historical revisions without throwing', () => {
  const fixture = setup();
  const malformed = fixture.runtime.snapshot();
  malformed.persons.broken = null;
  assert.ok(verifyState(malformed).length > 0);
  denied(() => createRuntime({ seed: malformed }), 'seed_invalid');
  const { signal } = publish(fixture);
  const brokenHistory = fixture.runtime.snapshot();
  brokenHistory.signals[signal.id].revisions[0] = null;
  assert.ok(verifyState(brokenHistory).length > 0);
  denied(() => createRuntime({ seed: brokenHistory }), 'seed_invalid');
});

test('state audit rejects forged event sources and an audience outside the conversation', () => {
  const fixture = setup();
  submit(fixture);
  const malformed = fixture.runtime.snapshot();
  malformed.events[0].source = { kind: 'endpoint', endpoint_id: 'unknown_endpoint' };
  malformed.events[0].audience.person_id = fixture.other_person.person_id;
  assert.ok(verifyState(malformed).length > 0);
  denied(() => createRuntime({ seed: malformed }), 'seed_invalid');
});

test('state audit rejects a human timeline submission with no outbound delivery', () => {
  const fixture = setup();
  submit(fixture);
  const malformed = fixture.runtime.snapshot();
  malformed.deliveries = {};
  assert.ok(verifyState(malformed).length > 0);
  denied(() => createRuntime({ seed: malformed }), 'seed_invalid');
});

function receivedLocalApproval() {
  const fixture = setup('local_coding');
  const { signal } = publish(fixture, {
    kind: 'approval', expires_at: '2026-10-11T12:45:00.000Z',
    interaction: {
      id: 'deploy', mode: 'required', response_type: 'approval', consequences: 'One staging deployment.',
      actions: [{ id: 'approve', label: 'Approve staging' }, { id: 'reject', label: 'Not yet' }],
      terms: { operation: 'deploy', scope: 'staging', target: 'somae', artifact_refs: [] },
    },
    continuation: { session_id: 'session_1', workspace_id: 'workspace_1', valid_until: '2026-10-11T13:00:00.000Z' },
  });
  const result = fixture.runtime.execute({
    command: 'response.submit', idempotency_key: 'local-answer', signal_id: signal.id,
    expected_revision: signal.revision, interaction_id: signal.interaction.id,
    value: { action_id: 'approve', terms_digest: signal.interaction.terms_digest },
  }, fixture.mobile);
  fixture.runtime.execute({ command: 'delivery.dispatch', idempotency_key: 'dispatch', delivery_id: result.delivery.id }, SYSTEM);
  fixture.runtime.execute({ command: 'delivery.ack', idempotency_key: 'ack', delivery_id: result.delivery.id }, fixture.agent);
  return { ...fixture, ...result };
}

const corruptions = {
  'changed accepted approval terms': (state, fixture) => { state.responses[fixture.response.id].terms_digest = 'changed'; },
  'missing bound local continuation': (state, fixture) => { state.deliveries[fixture.delivery.id].continuation = null; },
  'extended response delivery deadline': (state, fixture) => { state.deliveries[fixture.delivery.id].valid_until = '2026-10-12T00:00:00.000Z'; },
  'wrong response delivery signal revision': (state, fixture) => { state.deliveries[fixture.delivery.id].signal_revision = 999; },
  'forged integration receipt endpoint': (state, fixture) => { state.deliveries[fixture.delivery.id].receipt.endpoint_id = 'other_endpoint'; },
};
for (const [name, corrupt] of Object.entries(corruptions)) {
  test(`state audit rejects ${name}`, () => {
    const fixture = receivedLocalApproval();
    const malformed = fixture.runtime.snapshot();
    corrupt(malformed, fixture);
    assert.ok(verifyState(malformed).length > 0);
    denied(() => createRuntime({ seed: malformed }), 'seed_invalid');
  });
}

function foreignArtifact(fixture) {
  const { conversation } = fixture.runtime.execute({ command: 'message.submit', idempotency_key: 'another-subject', connection_id: fixture.connection_id, content }, fixture.desktop);
  return fixture.runtime.execute({
    command: 'artifact.publish', idempotency_key: 'foreign-artifact', conversation_id: conversation.id,
    media_type: 'text/plain', presentation_type: 'document', digest: 'a'.repeat(64), size: 20,
    description: 'Private to another conversation.', content_ref: { uri: 'memory:foreign', origin: 'memory:fixture', access: 'conversation' },
  }, fixture.agent).artifact;
}

test('state audit rejects an unattached foreign artifact embedded in message content', () => {
  const fixture = setup();
  const artifact = foreignArtifact(fixture);
  const message = submit(fixture).message;
  const malformed = fixture.runtime.snapshot();
  malformed.messages[message.id].content.push({ type: 'artifact', artifact_id: artifact.id, revision: artifact.revision });
  assert.ok(verifyState(malformed).length > 0);
  denied(() => createRuntime({ seed: malformed }), 'seed_invalid');
});

test('state audit rejects a foreign artifact presentation even when current and historical pins agree', () => {
  const fixture = setup();
  const artifact = foreignArtifact(fixture);
  const { signal } = publish(fixture);
  const malformed = fixture.runtime.snapshot();
  const presentation = { type: 'artifact', artifact_id: artifact.id, artifact_revision: artifact.revision };
  malformed.signals[signal.id].presentation = presentation;
  malformed.signals[signal.id].revisions[0].presentation = structuredClone(presentation);
  assert.ok(verifyState(malformed).length > 0);
  denied(() => createRuntime({ seed: malformed }), 'seed_invalid');
});

for (const corruption of ['actor', 'result']) {
  test(`state audit rejects a corrupted idempotency cache ${corruption}`, () => {
    const fixture = setup();
    submit(fixture);
    const malformed = fixture.runtime.snapshot();
    const cached = Object.values(malformed.idempotency)[0];
    if (corruption === 'actor') cached.actor = fixture.other_person;
    else cached.result = { private_data: 'An unrelated record must never be returned by a retry.' };
    assert.ok(verifyState(malformed).length > 0);
    denied(() => createRuntime({ seed: malformed }), 'seed_invalid');
  });
}
