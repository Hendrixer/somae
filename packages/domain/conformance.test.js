import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, DomainError } from './index.js';
import { createFixture } from './fixtures.js';

// These are contract scenarios, rather than tests of private runtime functions.
// A production persistence adapter must pass the same commands and assertions.
const NOW = '2026-10-11T12:00:00.000Z';
const LATER = '2026-10-11T13:00:00.000Z';
const SYSTEM = { kind: 'system' };
const text = (value) => [{ type: 'text', text: value }];
const values = (snapshot, collection) => Object.values(snapshot[collection]);
const last = (snapshot, collection) => values(snapshot, collection).at(-1);
const choice = (actions = ['volt', 'type']) => ({
  id: 'choose_direction', mode: 'required', response_type: 'single_choice',
  actions: actions.map((id) => ({ id, label: id })), consequences: 'Continue this design conversation.',
});

function setup(kind = 'hosted_coding', { online = true, changeSeed } = {}) {
  const fixture = createFixture(kind, { online });
  changeSeed?.(fixture.seed, fixture);
  let now = NOW;
  let serial = 100;
  let keySerial = 0;
  const runtime = createRuntime({ seed: fixture.seed, clock: () => now, idFactory: (prefix) => `${prefix}_${++serial}` });
  return {
    ...fixture, runtime,
    time(value) { now = value; },
    command(command, payload = {}, principal = fixture.agent, key) {
      return runtime.execute({ command, idempotency_key: key ?? `scenario_${++keySerial}`, ...payload }, principal);
    },
    snapshot() { return runtime.snapshot(); },
  };
}

function expectDenied(run, codes) {
  assert.throws(run, (error) => {
    assert.ok(error instanceof DomainError, 'rejection is a stable domain error');
    assert.ok([codes].flat().includes(error.code), `expected ${[codes].flat().join(' or ')}, received ${error.code}`);
    assert.ok(Array.isArray(error.ruleIds) && error.ruleIds.length > 0, 'error identifies the violated business rules');
    assert.ok(error.ruleIds.every((id) => typeof id === 'string' && id.length > 0));
    return true;
  });
}

function start(s, principal = s.desktop, payload = {}) {
  const result = s.command('message.submit', {
    connection_id: s.connection_id, title: 'Somae launch', content: text('Explore a quieter layout.'), ...payload,
  }, principal);
  return { result, conversation: last(s.snapshot(), 'conversations'), message: last(s.snapshot(), 'messages'), delivery: last(s.snapshot(), 'deliveries') };
}

function publish(s, { conversation_id = s.conversation_id, ...payload } = {}) {
  s.command('signal.publish', {
    connection_id: s.connection_id, conversation_id,
    title: 'Somae launch', content: text('Which direction should I develop?'), kind: 'question',
    interaction: choice(), presentation: { type: 'native' }, ...payload,
  });
  return last(s.snapshot(), 'signals');
}

function respond(s, signal, principal = s.mobile, payload = {}) {
  return s.command('response.submit', {
    signal_id: signal.id, expected_revision: signal.revision,
    interaction_id: signal.interaction.id, value: { option_id: 'volt' }, ...payload,
  }, principal);
}

function changeSignal(s, signal, payload = {}) {
  s.command('signal.update', {
    signal_id: signal.id, expected_revision: signal.revision,
    content: text('The choices have changed.'), kind: 'question',
    interaction: choice(['type', 'quiet']), presentation: { type: 'native' }, ...payload,
  });
  return s.snapshot().signals[signal.id];
}

function withdraw(s, signal, principal = s.agent) {
  return s.command('signal.withdraw', { signal_id: signal.id, expected_revision: signal.revision, reason: 'No longer needed.' }, principal);
}

function dispatch(s, delivery) {
  return s.command('delivery.dispatch', { delivery_id: delivery.id }, SYSTEM);
}

function receive(s, delivery) {
  dispatch(s, delivery);
  s.command('delivery.ack', { delivery_id: delivery.id });
  s.command('input.accept', { delivery_id: delivery.id });
}

function continuation() {
  return { session_id: 'session_1', workspace_id: 'workspace_1', valid_until: LATER };
}

function artifact(s, conversation_id = s.conversation_id, payload = {}) {
  s.command('artifact.publish', {
    conversation_id, media_type: 'text/html', presentation_type: 'document',
    content_ref: { uri: 'https://preview.example.test/launch/v1', origin: 'https://preview.example.test', access: 'conversation' },
    digest: 'a'.repeat(64), size: 512, description: 'Readable launch preview.', ...payload,
  });
  return last(s.snapshot(), 'artifacts');
}

function removeGrant(seed, fixture, grant, field) {
  const connection = seed.connections[fixture.connection_id];
  if (Array.isArray(connection[field])) connection[field] = connection[field].filter((value) => value !== grant);
  else connection[field][grant] = false;
}

for (const kind of ['local_coding', 'hosted_coding', 'custom_turn_based', 'custom_durable']) {
  test(`${kind}: one conversation spans initial input, question, response, and informational result`, () => {
    const s = setup(kind);
    const initial = start(s, s.desktop, { conversation_id: s.conversation_id });
    receive(s, initial.delivery);
    const signal = publish(s, { conversation_id: initial.conversation.id, ...(kind === 'local_coding' ? { continuation: continuation() } : {}) });
    respond(s, signal);
    const accepted = s.snapshot();
    const response = last(accepted, 'responses');
    const replyDelivery = accepted.deliveries[response.delivery_id];
    assert.equal(accepted.signals[signal.id].response_id, response.id);
    assert.equal(accepted.messages[response.message_id].conversation_id, initial.conversation.id);
    assert.equal(replyDelivery.response_id, response.id);
    assert.equal(replyDelivery.message_id, response.message_id);
    assert.equal(replyDelivery.input_state, 'unknown', 'storage alone is not agent acceptance');
    receive(s, replyDelivery);
    const result = publish(s, { conversation_id: initial.conversation.id, kind: 'result', content: text('The new layout is ready.'), interaction: null });
    const snapshot = s.snapshot();
    assert.equal(values(snapshot, 'conversations').length, 1);
    assert.equal(values(snapshot, 'responses').length, 1);
    assert.equal(snapshot.deliveries[replyDelivery.id].state, 'received');
    assert.equal(snapshot.deliveries[replyDelivery.id].input_state, 'accepted');
    assert.equal(snapshot.signals[signal.id].state, 'answered');
    assert.equal(result.kind, 'result');
    assert.equal(result.interaction, null);
    assert.equal(values(snapshot, 'signals').filter((item) => item.state === 'active' && item.interaction?.mode === 'required').length, 0);
    assert.ok(values(snapshot, 'messages').every((message) => message.conversation_id === initial.conversation.id));
    assert.deepEqual(values(snapshot, 'messages').map((message) => message.sequence), [1, 2, 3, 4]);
    assert.equal(Object.hasOwn(snapshot, 'tasks'), false, 'agent execution is not mirrored into a Somae task tracker');
  });
}

test('local starts and unsolicited follow-ups from a phone are rejected even while the endpoint is online', () => {
  const s = setup('local_coding');
  expectDenied(() => start(s, s.mobile), 'origin_device_disallowed');
  const { conversation } = start(s);
  expectDenied(() => start(s, s.mobile, { conversation_id: conversation.id }), 'origin_device_disallowed');
  assert.equal(values(s.snapshot(), 'conversations').length, 2);
  assert.equal(values(s.snapshot(), 'messages').length, 1);
});

test('an offline local endpoint cannot queue a fresh start even from its registered machine', () => {
  const s = setup('local_coding', { online: false });
  const before = s.snapshot();
  expectDenied(() => start(s), 'endpoint_unavailable');
  assert.deepEqual(s.snapshot(), before);
});

test('a mobile device cannot become a local initiation client through a coincidentally matching machine binding', () => {
  const s = setup('local_coding', { changeSeed: (seed, fixture) => {
    seed.devices[fixture.mobile.device_id].machine_id = seed.connections[fixture.connection_id].machine_id;
  } });
  expectDenied(() => start(s, s.mobile), 'origin_device_disallowed');
  expectDenied(() => start(s, s.mobile, { conversation_id: s.conversation_id }), 'origin_device_disallowed');
  assert.equal(values(s.snapshot(), 'messages').length, 0);
});

test('hosted starts and follow-ups accept both desktop and phone origins', () => {
  for (const kind of ['hosted_coding', 'custom_turn_based', 'custom_durable']) {
    const s = setup(kind);
    const { conversation } = start(s, s.mobile);
    start(s, s.desktop, { conversation_id: conversation.id, content: text('A second thought.') });
    assert.equal(values(s.snapshot(), 'conversations').length, 2);
    assert.equal(values(s.snapshot(), 'messages').length, 2);
    assert.equal(values(s.snapshot(), 'deliveries').length, 2);
  }
});

test('remote local responses require an explicit bound continuation; a conversation ID alone is insufficient', () => {
  const s = setup('local_coding');
  const signal = publish(s);
  expectDenied(() => respond(s, signal), ['continuation_unavailable', 'origin_device_disallowed']);
  const next = changeSignal(s, signal, { interaction: choice(), continuation: continuation() });
  respond(s, next);
  assert.equal(last(s.snapshot(), 'responses').origin_device_id, s.mobile.device_id);
  assert.equal(s.snapshot().signals[signal.id].state, 'answered');
});

test('an offered local continuation must match the conversation\'s existing session and workspace', () => {
  const s = setup('local_coding');
  const before = s.snapshot();
  expectDenied(() => publish(s, { continuation: { ...continuation(), session_id: 'another_session' } }), 'continuation_unavailable');
  expectDenied(() => publish(s, { continuation: { ...continuation(), workspace_id: 'another_workspace' } }), 'continuation_unavailable');
  assert.deepEqual(s.snapshot(), before);
});

test('a valid remote continuation queues offline without allowing replacement session or workspace selection', () => {
  const s = setup('local_coding', { online: false });
  const signal = publish(s, { continuation: continuation() });
  respond(s, signal);
  const snapshot = s.snapshot();
  assert.equal(last(snapshot, 'deliveries').state, 'queued');
  assert.equal(values(snapshot, 'conversations').length, 1);
  assert.equal(snapshot.signals[signal.id].continuation.session_id, 'session_1');
  const replacement = setup('local_coding');
  const pending = publish(replacement, { continuation: continuation() });
  expectDenied(() => respond(replacement, pending, replacement.mobile, { continuation: { session_id: 'different_session', workspace_id: 'different_workspace' } }), ['command_invalid', 'interaction_invalid', 'continuation_unavailable']);
});

test('a caller-supplied origin cannot disguise a phone as the local registered machine', () => {
  const s = setup('local_coding');
  expectDenied(() => start(s, s.mobile, { origin_device_id: s.desktop.device_id, device_id: s.desktop.device_id }), ['origin_device_disallowed', 'command_invalid']);
  assert.equal(values(s.snapshot(), 'messages').length, 0);
});

test('an unregistered authenticated device cannot submit human communication', () => {
  const s = setup();
  expectDenied(() => start(s, { ...s.desktop, device_id: 'unknown_device' }), ['origin_device_disallowed', 'unauthorized']);
});

for (const field of ['capabilities', 'permissions']) {
  test(`declaring support does not replace consent: messages.start requires ${field}`, () => {
    const s = setup('hosted_coding', { changeSeed: (seed, fixture) => removeGrant(seed, fixture, 'messages.start', field) });
    expectDenied(() => start(s), field === 'capabilities' ? 'capability_unsupported' : 'permission_denied');
    assert.equal(values(s.snapshot(), 'messages').length, 0);
  });
  test(`remote local continuation requires its ${field} grant independently of response support`, () => {
    const s = setup('local_coding', { changeSeed: (seed, fixture) => removeGrant(seed, fixture, 'responses.remote_continuation', field) });
    const signal = publish(s, { continuation: continuation() });
    expectDenied(() => respond(s, signal), field === 'capabilities' ? 'capability_unsupported' : 'permission_denied');
  });
}

test('a grant cannot manufacture a capability absent from the endpoint itself', () => {
  const s = setup('hosted_coding', { changeSeed: (seed, fixture) => {
    seed.endpoints[fixture.endpoint_id].capabilities = seed.endpoints[fixture.endpoint_id].capabilities.filter((value) => value !== 'messages.start');
  } });
  expectDenied(() => start(s), 'capability_unsupported');
  assert.equal(values(s.snapshot(), 'messages').length, 0);
});

test('a notification-only connector can send an informational signal but cannot offer an unsupported reply action', () => {
  const s = setup('hosted_coding', { changeSeed: (seed, fixture) => {
    seed.endpoints[fixture.endpoint_id].capabilities = seed.endpoints[fixture.endpoint_id].capabilities.filter((value) => value !== 'responses.receive');
  } });
  const result = publish(s, { kind: 'result', interaction: null, content: text('The draft is ready.') });
  assert.equal(result.interaction, null);
  expectDenied(() => publish(s), 'capability_unsupported');
  assert.equal(values(s.snapshot(), 'signals').length, 1);
});

test('signal publication includes its timeline message without implicitly granting standalone message publication', () => {
  const s = setup('hosted_coding', { changeSeed: (seed, fixture) => {
    removeGrant(seed, fixture, 'messages.publish', 'capabilities');
    removeGrant(seed, fixture, 'messages.publish', 'permissions');
  } });
  publish(s, { kind: 'result', interaction: null, content: text('A surfaced result.') });
  expectDenied(() => s.command('message.publish', { connection_id: s.connection_id, conversation_id: s.conversation_id, content: text('A separate message.') }), 'capability_unsupported');
  assert.equal(values(s.snapshot(), 'signals').length, 1);
  assert.equal(values(s.snapshot(), 'messages').length, 1);
});

test('a pending connection cannot publish content to authorize itself', () => {
  const s = setup('hosted_coding', { changeSeed: (seed, fixture) => { seed.connections[fixture.connection_id].state = 'pending'; } });
  expectDenied(() => publish(s), 'connection_inactive');
  assert.equal(values(s.snapshot(), 'signals').length, 0);
});

test('another person or endpoint cannot use a connection, answer its signal, or withdraw it', () => {
  const s = setup();
  const signal = publish(s);
  const before = s.snapshot();
  expectDenied(() => start(s, s.other_person), ['unauthorized', 'permission_denied']);
  expectDenied(() => respond(s, signal, s.other_person), ['unauthorized', 'permission_denied']);
  expectDenied(() => withdraw(s, signal, { kind: 'endpoint', endpoint_id: 'unrelated_endpoint' }), ['unauthorized', 'permission_denied']);
  assert.deepEqual(s.snapshot(), before);
});

test('the person cannot publish as an agent, and the agent cannot submit a human response', () => {
  const s = setup();
  const signal = publish(s);
  expectDenied(() => s.command('signal.publish', { connection_id: s.connection_id, content: text('Forged agent'), kind: 'result', interaction: null, presentation: { type: 'native' } }, s.person), ['unauthorized', 'permission_denied']);
  expectDenied(() => respond(s, signal, s.agent), ['unauthorized', 'permission_denied']);
});

test('changed choices reject an old response and retain the previous evidence', () => {
  const s = setup();
  const signal = publish(s);
  const oldMessage = s.snapshot().messages[signal.message_id];
  const updated = changeSignal(s, signal);
  expectDenied(() => respond(s, signal), 'signal_stale');
  expectDenied(() => respond(s, updated, s.mobile, { value: { option_id: 'volt' } }), 'interaction_invalid');
  assert.equal(updated.revision, 2);
  assert.deepEqual(s.snapshot().messages[signal.message_id], oldMessage);
  assert.equal(values(s.snapshot(), 'responses').length, 0);
});

test('withdrawal before response wins the terminal race without deleting history', () => {
  const s = setup();
  const signal = publish(s);
  withdraw(s, signal);
  expectDenied(() => respond(s, signal), 'signal_withdrawn');
  assert.equal(s.snapshot().signals[signal.id].state, 'withdrawn');
  assert.equal(values(s.snapshot(), 'responses').length, 0);
  assert.equal(values(s.snapshot(), 'messages').length, 1);
});

test('response before withdrawal wins the terminal race and preserves the accepted answer', () => {
  const s = setup();
  const signal = publish(s);
  respond(s, signal);
  expectDenied(() => withdraw(s, signal), 'signal_already_answered');
  assert.equal(s.snapshot().signals[signal.id].state, 'answered');
  assert.equal(values(s.snapshot(), 'responses').length, 1);
  assert.equal(values(s.snapshot(), 'deliveries').length, 1);
});

test('two authenticated devices cannot both answer the same required interaction', () => {
  const s = setup();
  const signal = publish(s);
  respond(s, signal, s.desktop);
  expectDenied(() => respond(s, signal, s.mobile, { value: { option_id: 'type' } }), 'signal_already_answered');
  assert.equal(values(s.snapshot(), 'responses').length, 1);
  assert.equal(values(s.snapshot(), 'messages').length, 2);
  assert.equal(values(s.snapshot(), 'deliveries').length, 1);
});

test('an idempotent publication or response retry returns the same result without adding records', () => {
  const s = setup();
  const command = { command: 'signal.publish', idempotency_key: 'publish-once', connection_id: s.connection_id, content: text('Which direction?'), kind: 'question', interaction: choice(), presentation: { type: 'native' } };
  const first = s.runtime.execute(command, s.agent);
  const before = s.snapshot();
  assert.deepEqual(s.runtime.execute(command, s.agent), first);
  assert.deepEqual(s.snapshot(), before);
  const signal = last(s.snapshot(), 'signals');
  const answer = { command: 'response.submit', idempotency_key: 'answer-once', signal_id: signal.id, expected_revision: signal.revision, interaction_id: signal.interaction.id, value: { option_id: 'volt' } };
  const accepted = s.runtime.execute(answer, s.mobile);
  const answered = s.snapshot();
  assert.deepEqual(s.runtime.execute(answer, s.mobile), accepted);
  assert.deepEqual(s.snapshot(), answered);
  expectDenied(() => s.runtime.execute({ ...answer, value: { option_id: 'type' } }, s.mobile), 'idempotency_conflict');
});

test('the same idempotency key cannot expose another actor\'s answer or bypass a later revocation', () => {
  const s = setup();
  const signal = publish(s);
  const answer = { command: 'response.submit', idempotency_key: 'shared-key', signal_id: signal.id, expected_revision: signal.revision, interaction_id: signal.interaction.id, value: { option_id: 'volt' } };
  s.runtime.execute(answer, s.desktop);
  expectDenied(() => s.runtime.execute(answer, s.other_person), ['unauthorized', 'permission_denied']);
  const connection = s.snapshot().connections[s.connection_id];
  s.command('connection.revoke', { connection_id: connection.id, expected_revision: connection.revision }, s.person);
  expectDenied(() => s.runtime.execute(answer, s.desktop), 'connection_inactive');
});

test('marking a result read or set aside changes only the person\'s view, not its conversation or agent lifecycle', () => {
  const s = setup();
  const signal = publish(s, { kind: 'result', content: text('The draft is ready.'), interaction: null });
  s.command('inbox.mark', { signal_id: signal.id, read: true, set_aside: true }, s.person);
  assert.equal(s.snapshot().signals[signal.id].state, 'active');
  assert.equal(values(s.snapshot(), 'responses').length, 0);
  assert.equal(values(s.snapshot(), 'messages').length, 1);
});

test('a durable endpoint may originate a conversation and an informational signal without a human task', () => {
  const s = setup('custom_durable');
  s.command('signal.publish', { connection_id: s.connection_id, title: 'Calendar change', kind: 'notice', content: text('Your available time changed.'), interaction: null, presentation: { type: 'native' } });
  const signal = last(s.snapshot(), 'signals');
  assert.equal(values(s.snapshot(), 'conversations').length, 2);
  assert.equal(signal.interaction, null);
  assert.equal(values(s.snapshot(), 'responses').length, 0);
  assert.equal(values(s.snapshot(), 'deliveries').length, 0);
});

test('a failed rich publication leaves no half-created conversation, message, signal, event, or outbox entry', () => {
  const s = setup();
  const before = s.snapshot();
  expectDenied(() => s.command('signal.publish', {
    connection_id: s.connection_id, content: text('A new preview'), kind: 'result', interaction: null,
    presentation: { type: 'native' }, artifact_refs: [{ artifact_id: 'missing_artifact', revision: 1 }],
  }), ['artifact_revision_invalid', 'not_found']);
  assert.deepEqual(s.snapshot(), before);
});

test('new artifact revisions cannot silently change the concrete terms of an existing approval', () => {
  const s = setup();
  const first = artifact(s);
  const firstRef = { artifact_id: first.id, revision: first.revision };
  const signal = publish(s, {
    artifact_refs: [firstRef], kind: 'approval', content: text('Deploy this exact preview to staging?'),
    interaction: {
      id: 'staging_approval', mode: 'required', response_type: 'approval',
      actions: [{ id: 'approve', label: 'Deploy to staging' }, { id: 'reject', label: 'Keep local' }],
      consequences: 'Deploys to staging only.',
      terms: { operation: 'deploy', scope: 'staging', target: 'somae-launch', cost: { amount: 0, currency: 'USD' }, artifact_refs: [firstRef] },
    },
  });
  artifact(s, s.conversation_id, {
    artifact_id: first.id, expected_revision: first.revision,
    content_ref: { uri: 'https://preview.example.test/launch/v2', origin: 'https://preview.example.test', access: 'conversation' },
    digest: 'b'.repeat(64),
  });
  assert.deepEqual(s.snapshot().signals[signal.id].interaction.terms.artifact_refs, [firstRef]);
  expectDenied(() => respond(s, signal, s.mobile, { value: { action_id: 'approve', terms_digest: 'wrong_terms' } }), 'approval_terms_invalid');
  respond(s, signal, s.mobile, { value: { action_id: 'approve', terms_digest: signal.interaction.terms_digest } });
  assert.deepEqual(last(s.snapshot(), 'responses').value, { action_id: 'approve', terms_digest: signal.interaction.terms_digest });
  assert.equal(values(s.snapshot(), 'artifacts').length, 2);
});

test('updating an approval to a newer artifact invalidates its old revision and terms digest', () => {
  const s = setup();
  const original = artifact(s);
  const terms = { operation: 'publish', scope: 'staging', target: 'launch', artifact_refs: [{ artifact_id: original.id, revision: 1 }] };
  const interaction = {
    id: 'approve_launch', mode: 'required', response_type: 'approval',
    actions: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }],
    consequences: 'Publishes to staging.', terms,
  };
  const signal = publish(s, { kind: 'approval', interaction, artifact_refs: terms.artifact_refs });
  const newer = artifact(s, s.conversation_id, { artifact_id: original.id, expected_revision: 1, digest: 'c'.repeat(64) });
  const refs = [{ artifact_id: newer.id, revision: newer.revision }];
  const updated = changeSignal(s, signal, { kind: 'approval', interaction: { ...interaction, terms: { ...terms, artifact_refs: refs } }, artifact_refs: refs });
  expectDenied(() => respond(s, signal, s.mobile, { value: { action_id: 'approve', terms_digest: signal.interaction.terms_digest } }), 'signal_stale');
  expectDenied(() => respond(s, updated, s.mobile, { value: { action_id: 'approve', terms_digest: signal.interaction.terms_digest } }), 'approval_terms_invalid');
  assert.notEqual(updated.interaction.terms_digest, signal.interaction.terms_digest);
  assert.equal(values(s.snapshot(), 'responses').length, 0);
});

test('an artifact version is conversation-scoped and cannot be attached to another conversation', () => {
  const s = setup();
  const existing = artifact(s);
  const other = start(s).conversation;
  const before = s.snapshot();
  expectDenied(() => publish(s, { conversation_id: other.id, artifact_refs: [{ artifact_id: existing.id, revision: existing.revision }] }), 'artifact_revision_invalid');
  assert.deepEqual(s.snapshot(), before);
});

test('sharing context requires explicit consent and a purpose, and stores a copied snapshot for the exact destination', () => {
  const s = setup();
  expectDenied(() => start(s, s.mobile, { context: { consent: false, purpose: 'Plan the trip', snapshot: { home: 'Austin' } } }), ['context_consent_required', 'permission_denied', 'interaction_invalid']);
  expectDenied(() => start(s, s.mobile, { context: { consent: true, purpose: '', snapshot: { home: 'Austin' } } }), ['context_consent_required', 'command_invalid', 'interaction_invalid']);
  const shared = { consent: true, purpose: 'Plan the trip', snapshot: { home: 'Austin', preferences: { quiet: true } } };
  const { message, conversation } = start(s, s.mobile, { context: shared });
  shared.snapshot.preferences.quiet = false;
  const snapshot = last(s.snapshot(), 'context_snapshots');
  assert.equal(snapshot.conversation_id, conversation.id);
  assert.deepEqual(snapshot.value, { home: 'Austin', preferences: { quiet: true } });
  assert.deepEqual(snapshot.audience, { endpoint_id: s.endpoint_id, connection_id: s.connection_id });
  assert.ok(message.context_snapshot_refs.length === 1);
  assert.equal(values(s.snapshot(), 'context_snapshots').length, 1);
});

test('context receive capability and permission are independent of messaging authority', () => {
  for (const field of ['capabilities', 'permissions']) {
    const s = setup('hosted_coding', { changeSeed: (seed, fixture) => removeGrant(seed, fixture, 'context.receive', field) });
    const before = s.snapshot();
    expectDenied(() => start(s, s.mobile, { context: { consent: true, purpose: 'Plan the trip', snapshot: { home: 'Austin' } } }), field === 'capabilities' ? 'capability_unsupported' : 'permission_denied');
    assert.deepEqual(s.snapshot(), before);
  }
});

test('extra context audience or caller-supplied private routing authority fails closed', () => {
  const s = setup();
  expectDenied(() => start(s, s.mobile, { context: { consent: true, purpose: 'Plan the trip', snapshot: { home: 'Austin' }, audience: ['unrelated_endpoint'] } }), ['command_invalid', 'context_consent_required', 'permission_denied']);
  expectDenied(() => start(s, s.mobile, { author: { kind: 'endpoint', endpoint_id: s.endpoint_id }, continuity: { session_id: 'private_replacement' } }), 'command_invalid');
});

test('terminal signals cannot be updated into an active request again', () => {
  for (const terminal of ['answered', 'withdrawn', 'expired']) {
    const s = setup();
    const signal = publish(s, { expires_at: LATER });
    if (terminal === 'answered') respond(s, signal);
    if (terminal === 'withdrawn') withdraw(s, signal);
    if (terminal === 'expired') {
      s.time(LATER);
      s.command('signal.expire', { signal_id: signal.id, expected_revision: signal.revision }, SYSTEM);
    }
    const before = s.snapshot();
    expectDenied(() => changeSignal(s, before.signals[signal.id]), `signal_${terminal === 'answered' ? 'already_answered' : terminal}`);
    assert.deepEqual(s.snapshot(), before);
  }
});

test('unsupported rich content needs a readable fallback and cannot manufacture custom app authority', () => {
  const s = setup();
  expectDenied(() => publish(s, { content: [{ type: 'data', value: { status: 'ready' } }] }), ['content_invalid', 'command_invalid']);
  expectDenied(() => publish(s, { presentation: { type: 'custom_app', credentials: 'invented' } }), ['presentation_unsupported', 'command_invalid']);
  assert.equal(values(s.snapshot(), 'signals').length, 0);
});

test('duplicate choice IDs and values outside the declared interaction do not accept a response', () => {
  const s = setup();
  expectDenied(() => publish(s, { interaction: choice(['volt', 'volt']) }), 'interaction_invalid');
  const signal = publish(s);
  const before = s.snapshot();
  expectDenied(() => respond(s, signal, s.mobile, { value: { option_id: 'invented_option' } }), 'interaction_invalid');
  assert.deepEqual(s.snapshot(), before);
});

test('null content blocks and falsy artifact pins produce safe domain errors without partially publishing', () => {
  const s = setup();
  const before = s.snapshot();
  expectDenied(() => publish(s, { content: [null] }), 'content_invalid');
  for (const value of [0, '', false, null]) {
    expectDenied(() => publish(s, { presentation: { type: 'native', artifact_id: value, artifact_revision: value } }), 'artifact_revision_invalid');
  }
  assert.deepEqual(s.snapshot(), before);
});

test('multiple-choice replies validate the offered IDs as one complete terminal submission', () => {
  const s = setup();
  const signal = publish(s, { interaction: { ...choice(), response_type: 'multiple_choice' } });
  const before = s.snapshot();
  for (const option_ids of [[], ['volt', 'volt'], ['unknown'], ['volt', 'unknown']]) {
    expectDenied(() => respond(s, signal, s.mobile, { value: { option_ids } }), 'interaction_invalid');
  }
  assert.deepEqual(s.snapshot(), before);
  respond(s, signal, s.mobile, { value: { option_ids: ['volt', 'type'] } });
  assert.deepEqual(last(s.snapshot(), 'responses').value, { option_ids: ['volt', 'type'] });
  assert.equal(values(s.snapshot(), 'responses').length, 1);
});

test('form replies enforce required fields, types, enums, bounds, and unknown-field rejection before accepting', () => {
  const s = setup();
  const signal = publish(s, { interaction: {
    id: 'trip_details', mode: 'required', response_type: 'form', consequences: 'Plans this trip.',
    schema: { type: 'object', additionalProperties: false, required: ['days', 'pace'], properties: {
      days: { type: 'integer', minimum: 1, maximum: 10 },
      pace: { type: 'string', enum: ['quiet', 'busy'], minLength: 4, maxLength: 5 },
    } },
  } });
  const before = s.snapshot();
  for (const fields of [{ days: 3 }, { days: '3', pace: 'quiet' }, { days: 0, pace: 'quiet' }, { days: 11, pace: 'quiet' }, { days: 3.5, pace: 'quiet' }, { days: 3, pace: 'fast' }, { days: 3, pace: 'quiet', extra: true }]) {
    expectDenied(() => respond(s, signal, s.mobile, { value: { fields } }), 'interaction_invalid');
  }
  assert.deepEqual(s.snapshot(), before);
  respond(s, signal, s.mobile, { value: { fields: { days: 3, pace: 'quiet' } } });
  assert.deepEqual(last(s.snapshot(), 'responses').value, { fields: { days: 3, pace: 'quiet' } });
});

test('text replies enforce a declared size limit without dropping or truncating the person\'s message', () => {
  const s = setup();
  const signal = publish(s, { interaction: { id: 'name', mode: 'required', response_type: 'text', max_length: 5, consequences: 'Uses this display name.' } });
  const before = s.snapshot();
  expectDenied(() => respond(s, signal, s.mobile, { value: { text: 'Too long' } }), 'interaction_invalid');
  assert.deepEqual(s.snapshot(), before);
  respond(s, signal, s.mobile, { value: { text: 'Somae' } });
  assert.deepEqual(last(s.snapshot(), 'responses').value, { text: 'Somae' });
});

test('an explicitly included attachment must satisfy the endpoint\'s receive media and size limits', () => {
  for (const limitation of ['media', 'size']) {
    const s = setup('hosted_coding', { changeSeed: (seed, fixture) => {
      const endpoint = seed.endpoints[fixture.endpoint_id];
      if (limitation === 'media') endpoint.receive_media_types = ['text/plain'];
      else endpoint.max_artifact_bytes = 64;
    } });
    const attachment = artifact(s);
    const before = s.snapshot();
    expectDenied(() => start(s, s.mobile, { conversation_id: s.conversation_id, artifact_refs: [{ artifact_id: attachment.id, revision: attachment.revision }] }), 'artifact_unsupported');
    assert.deepEqual(s.snapshot(), before);
  }
});

test('including an attachment requires receive support and consent, independent of message support', () => {
  for (const field of ['capabilities', 'permissions']) {
    const s = setup('hosted_coding', { changeSeed: (seed, fixture) => removeGrant(seed, fixture, 'artifacts.receive', field) });
    const attachment = artifact(s);
    const before = s.snapshot();
    expectDenied(() => start(s, s.mobile, { conversation_id: s.conversation_id, artifact_refs: [{ artifact_id: attachment.id, revision: attachment.revision }] }), field === 'capabilities' ? 'capability_unsupported' : 'permission_denied');
    assert.deepEqual(s.snapshot(), before);
  }
});

test('callers cannot mutate accepted records through command objects, returned values, or snapshots', () => {
  const s = setup();
  const command = { command: 'message.submit', idempotency_key: 'immutable-input', connection_id: s.connection_id, content: text('Original input') };
  const result = s.runtime.execute(command, s.person);
  const before = s.snapshot();
  command.content[0].text = 'Injected after submission';
  const mutate = (object) => {
    if (!object || typeof object !== 'object') return;
    for (const key of Object.keys(object)) {
      if (typeof object[key] === 'string') object[key] = 'mutated';
      else mutate(object[key]);
    }
  };
  for (const output of [result, s.snapshot()]) {
    try { mutate(output); }
    catch (error) { assert.ok(error instanceof TypeError, 'immutable outputs may reject mutation'); }
  }
  assert.deepEqual(s.snapshot(), before);
});

test('a deadline is checked before accepting a response', () => {
  const s = setup();
  const signal = publish(s, { expires_at: LATER });
  s.time(LATER);
  expectDenied(() => respond(s, signal), 'signal_expired');
  assert.equal(values(s.snapshot(), 'responses').length, 0);
  assert.equal(values(s.snapshot(), 'deliveries').length, 0);
});

test('an accepted offline continuation can expire before dispatch without un-answering the signal', () => {
  const s = setup('local_coding', { online: false });
  const signal = publish(s, { continuation: continuation(), expires_at: LATER });
  respond(s, signal);
  const delivery = last(s.snapshot(), 'deliveries');
  s.time('2026-10-11T14:00:00.000Z');
  s.command('endpoint.set_availability', { endpoint_id: s.endpoint_id, online: true }, SYSTEM);
  dispatch(s, delivery);
  assert.equal(s.snapshot().deliveries[delivery.id].state, 'expired');
  assert.equal(s.snapshot().signals[signal.id].state, 'answered');
  assert.equal(values(s.snapshot(), 'responses').length, 1);
});

test('pause rejects new input, suspends undelivered input, and permits authenticated withdrawal', () => {
  const s = setup();
  const signal = publish(s);
  const { delivery } = start(s);
  const connection = s.snapshot().connections[s.connection_id];
  s.command('connection.pause', { connection_id: connection.id, expected_revision: connection.revision }, s.person);
  assert.equal(s.snapshot().deliveries[delivery.id].state, 'paused');
  expectDenied(() => start(s), 'connection_inactive');
  expectDenied(() => respond(s, signal), 'connection_inactive');
  withdraw(s, signal);
  assert.equal(s.snapshot().signals[signal.id].state, 'withdrawn');
  const paused = s.snapshot().connections[s.connection_id];
  s.command('connection.resume', { connection_id: paused.id, expected_revision: paused.revision }, s.person);
  assert.equal(s.snapshot().deliveries[delivery.id].state, 'queued');
});

test('revocation terminates undelivered input and withdraws active requests while retaining history', () => {
  const s = setup();
  const signal = publish(s);
  const { delivery } = start(s);
  const connection = s.snapshot().connections[s.connection_id];
  s.command('connection.revoke', { connection_id: connection.id, expected_revision: connection.revision }, s.person);
  assert.equal(s.snapshot().deliveries[delivery.id].state, 'revoked');
  assert.equal(s.snapshot().signals[signal.id].state, 'withdrawn');
  assert.equal(values(s.snapshot(), 'messages').length, 2);
  expectDenied(() => start(s), 'connection_inactive');
});

for (const transition of ['pause', 'revoke']) {
  test(`${transition} does not erase receipts for an input already dispatched`, () => {
    const s = setup();
    const { delivery } = start(s);
    dispatch(s, delivery);
    const connection = s.snapshot().connections[s.connection_id];
    s.command(`connection.${transition}`, { connection_id: connection.id, expected_revision: connection.revision }, s.person);
    s.command('delivery.ack', { delivery_id: delivery.id });
    s.command('input.accept', { delivery_id: delivery.id });
    assert.equal(s.snapshot().deliveries[delivery.id].state, 'received');
    expectDenied(() => start(s), 'connection_inactive');
  });
}

test('an ambiguous provider handoff is visible and cannot be automatically dispatched again', () => {
  const s = setup();
  const { delivery } = start(s);
  dispatch(s, delivery);
  s.command('delivery.ack', { delivery_id: delivery.id });
  s.command('input.unknown', { delivery_id: delivery.id, reason: 'Provider accepted input before adapter crashed; outcome cannot be recovered.' });
  expectDenied(() => dispatch(s, delivery), 'input_outcome_unknown');
  assert.equal(values(s.snapshot(), 'messages').length, 1);
  assert.equal(values(s.snapshot(), 'deliveries').length, 1);
});

test('receipt authority belongs to the destination delivery and cannot be used by another endpoint', () => {
  const s = setup();
  const { delivery } = start(s);
  dispatch(s, delivery);
  expectDenied(() => s.command('delivery.ack', { delivery_id: delivery.id }, { kind: 'endpoint', endpoint_id: 'unrelated_endpoint' }), ['unauthorized', 'permission_denied']);
  expectDenied(() => s.command('input.accept', { delivery_id: delivery.id }, s.person), ['unauthorized', 'permission_denied']);
});
