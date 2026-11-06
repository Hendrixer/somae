import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLibrary, applyLibraryOperation, projectLibrary } from './index.js';
import { createRuntime } from '../domain/index.js';

function setup() {
  let state = createLibrary();
  let n = 0;
  const person = { kind: 'person', person_id: 'person_local', device_id: 'desktop_local' };
  const apply = (type, fields, who = person) => {
    const transition = applyLibraryOperation(state, { type, idempotency_key: `op_${++n}`, ...fields }, who);
    state = transition.state;
    return transition.result;
  };
  const session = apply('session.register', { title: 'Launch', session_id: 'local_session', workspace_id: 'private_workspace' });
  const agent = { kind: 'endpoint', endpoint_id: session.endpoint_id };
  const sent = apply('message.send', { connection_id: session.connection_id, text: 'Make a brief.' });
  const conversation_id = sent.conversation.id;
  const publish = (source, fields = {}) => apply('artifact.publish', { conversation_id, title: 'Brief', filename: 'brief.md', media_type: 'text/markdown', size: Buffer.byteLength(source), digest: createHash('sha256').update(source).digest('hex'), source, ...fields }, agent);
  return { get state() { return state; }, person, agent, apply, sent, publish, conversation_id };
}

test('library preserves actual immutable versions and an approval pin when a revision arrives', () => {
  const s = setup();
  const first = s.publish('# Launch\n\nHello creators.').artifact;
  const before = structuredClone(s.state.domain.artifacts[`${first.id}@1`]);
  s.apply('version.approve', { artifact_id: first.id, revision: 1, expected_sequence: 0 });
  s.publish('# Launch\n\nHello independent creators.', { artifact_id: first.id, expected_revision: 1 });
  assert.deepEqual(s.state.domain.artifacts[`${first.id}@1`], before);
  assert.equal(s.state.approvals[first.id].artifact_revision, 1);
  assert.equal(s.state.items[first.id].latest_revision, 2);
  assert.throws(() => s.apply('version.approve', { artifact_id: first.id, revision: 2, expected_sequence: 0 }), { code: 'approval_stale' });
});

test('version-bound review and agent delivery commit together, preserve drafts on stale input, and deduplicate retries', () => {
  const s = setup();
  const artifact = s.publish('# Launch\n\nHello creators.').artifact;
  const refs = [{ artifact_id: artifact.id, revision: 1 }];
  const comment = { artifact_id: artifact.id, revision: 1, kind: 'replace', text: 'Be more specific.', replacement: 'independent creators', anchor: { type: 'text', block_id: 'block_1', start: 6, end: 14, quote: 'creators' } };
  const op = { type: 'review.submit', idempotency_key: 'review_once', conversation_id: s.conversation_id, artifacts: refs, comments: [comment], note: 'Make this warmer.' };
  const accepted = applyLibraryOperation(s.state, op, s.person);
  assert.ok(accepted.result.review.delivery_id);
  assert.equal(accepted.state.domain.deliveries[accepted.result.review.delivery_id].message_id, accepted.result.review.message_id);
  const retry = applyLibraryOperation(accepted.state, op, s.person);
  assert.deepEqual(retry.result, accepted.result);
  assert.equal(Object.keys(retry.state.reviews).length, 1);
  s.apply('draft.save', { conversation_id: s.conversation_id, draft: { comments: [comment] } });
  s.publish('# Launch\n\nA new version.', { artifact_id: artifact.id, expected_revision: 1 });
  const saved = structuredClone(s.state);
  assert.throws(() => applyLibraryOperation(s.state, op, s.person), { code: 'review_stale' });
  assert.deepEqual(s.state, saved);
});

test('invalid text anchors and out-of-bounds image regions cannot create a review or delivery', () => {
  const s = setup();
  const artifact = s.publish('# Launch\n\nHello creators.').artifact;
  const base = { conversation_id: s.conversation_id, artifacts: [{ artifact_id: artifact.id, revision: 1 }], note: 'Review' };
  const saved = structuredClone(s.state);
  assert.throws(() => s.apply('review.submit', { ...base, comments: [{ artifact_id: artifact.id, revision: 1, kind: 'comment', text: 'Wrong quote', anchor: { type: 'text', block_id: 'block_1', start: 0, end: 5, quote: 'Wrong' } }] }), { code: 'anchor_invalid' });
  assert.throws(() => s.apply('review.submit', { ...base, comments: [{ artifact_id: artifact.id, revision: 1, kind: 'comment', text: 'Wrong region', anchor: { type: 'region', x: 0.9, y: 0, width: 0.5, height: 0.5 } }] }), { code: 'anchor_invalid' });
  assert.deepEqual(s.state, saved);
});

test('client projection excludes provider routing, idempotency data and credentials', () => {
  const s = setup();
  s.publish('# A brief');
  const view = projectLibrary(s.state, s.person);
  const text = JSON.stringify(view);
  assert.ok(view.items.length);
  for (const privateValue of ['private_workspace', 'local_session', 'idempotency', 'payload_digest', 'continuity']) assert.ok(!text.includes(privateValue), privateValue);
  assert.throws(() => projectLibrary(s.state, { kind: 'person', person_id: 'other', device_id: 'desktop_local' }), { code: 'unauthorized' });
});

test('library idempotency replay rechecks current communication authority after revocation', () => {
  const s = setup();
  const publication = s.apply('agent.reply', { conversation_id: s.conversation_id, text: 'Ready for feedback.' }, s.agent);
  const op = { type: 'response.submit', idempotency_key: 'same-response', signal_id: publication.signal.id, expected_revision: 1, interaction_id: publication.signal.interaction.id, value: { text: 'Make it warmer.' } };
  const accepted = applyLibraryOperation(s.state, op, s.person);
  const runtime = createRuntime({ seed: accepted.state.domain });
  runtime.execute({ command: 'connection.revoke', idempotency_key: 'revoke', connection_id: publication.signal.connection_id, expected_revision: 1 }, s.person);
  const revoked = { ...accepted.state, domain: runtime.snapshot() };
  assert.throws(() => applyLibraryOperation(revoked, op, s.person), { code: 'connection_inactive' });
});

test('terminal-originated conversations are endpoint-scoped, session-bound and create no fake person delivery', () => {
  const s = setup();
  const before = Object.keys(s.state.domain.deliveries).length;
  const opened = s.apply('agent.open', { title: 'Terminal work', text: 'A brief requested in my terminal.' }, s.agent);
  const bound = s.state.domain.conversations[opened.conversation.id];
  assert.equal(bound.endpoint_id, s.agent.endpoint_id);
  assert.equal(bound.continuity.session_id, 'local_session');
  assert.equal(opened.message.author.kind, 'endpoint');
  assert.equal(Object.keys(s.state.domain.deliveries).length, before);
  const result = s.apply('agent.question', { conversation_id: bound.id, text: 'Which direction?', choices: ['Quiet', 'Bold'] }, s.agent);
  assert.equal(result.signal.interaction.mode, 'required');
  assert.equal(result.signal.interaction.actions[0].id, '1');
  const answered = s.apply('response.submit', { signal_id: result.signal.id, expected_revision: 1, interaction_id: result.signal.interaction.id, value: { option_id: '1' } });
  assert.equal(answered.delivery.endpoint_id, s.agent.endpoint_id);
  assert.throws(() => s.apply('agent.open', { title: 'Forged', text: 'No.' }), { code: 'unauthorized' });
  const other = s.apply('session.register', { title: 'Other', session_id: 'other_session', workspace_id: 'other_workspace' });
  assert.throws(() => s.apply('agent.reply', { conversation_id: bound.id, text: 'Cross-session reply' }, { kind: 'endpoint', endpoint_id: other.endpoint_id }), { code: 'unauthorized' });
});

const ref = artifact => ({ artifact_id: artifact.id, revision: artifact.revision });
const sourceOf = (signal, value) => ({ signal_id: signal.id, expected_revision: signal.revision, interaction_id: signal.interaction.id, value });
const decisionInput = (s, artifacts, decision = 'approve', rest = {}) => ({ conversation_id: s.conversation_id, artifacts: artifacts.map(ref), comments: [], decision, expected_sequences: Object.fromEntries(artifacts.map(a => [a.id, s.state.decisions?.[a.id]?.sequence ?? s.state.approvals[a.id]?.sequence ?? 0])), ...rest });

test('review decisions atomically send all notes, answer the exact request and create one outbox delivery', () => {
  const s = setup();
  const first = s.publish('# Launch\n\nHello creators.').artifact;
  const second = s.publish('# Cover').artifact;
  const artifacts = [first, second];
  const requested = s.apply('agent.review', { conversation_id: s.conversation_id, text: 'Review the brief and cover.', artifacts: artifacts.map(ref) }, s.agent).signal;
  assert.deepEqual(requested.interaction.actions.map(action => action.id), ['approve', 'reject']);
  assert.deepEqual(requested.interaction.terms, { operation: 'review_artifacts', scope: 'content_review_only', target: s.conversation_id, artifact_refs: artifacts.map(ref) });
  const comment = { ...ref(first), kind: 'comment', text: 'Keep this tone.', anchor: { type: 'text', block_id: 'block_1', start: 0, end: 5, quote: 'Hello' } };
  s.apply('draft.save', { conversation_id: s.conversation_id, draft: { comments: [comment], note: 'Looks great.' } });
  const before = { deliveries: Object.keys(s.state.domain.deliveries).length, messages: Object.keys(s.state.domain.messages).length };
  const source_request = sourceOf(requested, { action_id: 'approve', terms_digest: requested.interaction.terms_digest });
  const accepted = s.apply('review.submit', decisionInput(s, artifacts, 'approve', { comments: [comment], note: 'Looks great.', source_request }));
  assert.equal(Object.keys(s.state.domain.deliveries).length, before.deliveries + 1);
  assert.equal(Object.keys(s.state.domain.messages).length, before.messages + 1);
  assert.equal(s.state.domain.signals[requested.id].state, 'answered');
  assert.equal(accepted.review.response_id, accepted.response.id);
  assert.equal(accepted.review.delivery_id, accepted.delivery.id);
  assert.equal(accepted.response.message_id, accepted.review.message_id);
  assert.deepEqual(accepted.review.comments, [comment]);
  assert.deepEqual(accepted.review.source_request, source_request);
  const message = s.state.domain.messages[accepted.review.message_id];
  assert.deepEqual(message.artifact_refs, artifacts.map(ref));
  assert.match(message.content.map(b => b.text).join('\n'), /Approved.*|Looks great\./s);
  assert.ok(message.content.some(b => b.text.includes('Keep this tone.')));
  assert.equal(s.state.drafts[s.conversation_id], undefined);
  for (const artifact of artifacts) {
    assert.equal(s.state.decisions[artifact.id].review_id, accepted.review.id);
    assert.equal(s.state.approvals[artifact.id].artifact_revision, 1);
    assert.deepEqual(s.state.decision_history[s.state.decisions[artifact.id].id], s.state.decisions[artifact.id]);
  }
  const projected = projectLibrary(s.state, s.person);
  assert.deepEqual(projected.signals.find(signal => signal.id === requested.id).review_request, { signal_id: requested.id, revision: 1, artifacts: artifacts.map(ref) });
  assert.equal(projected.items.find(item => item.id === first.id).decision.decision, 'approve');
});

test('zero-note approval and rejection notify the agent and retain immutable decision history', () => {
  const s = setup();
  const first = s.publish('# Ready').artifact;
  const approved = s.apply('review.submit', decisionInput(s, [first]));
  const rejected = s.apply('review.submit', decisionInput(s, [first], 'reject'));
  assert.equal(rejected.review.comments.length, 0);
  assert.match(s.state.domain.messages[rejected.review.message_id].content[0].text, /Decision: Changes requested/);
  assert.equal(s.state.approvals[first.id], undefined);
  assert.equal(s.state.decisions[first.id].sequence, 2);
  assert.equal(s.state.decisions[first.id].previous_id, Object.values(s.state.decision_history).find(d => d.review_id === approved.review.id).id);
  assert.equal(Object.keys(s.state.approval_history).length, 1);
  assert.equal(Object.keys(s.state.decision_history).length, 2);
  s.publish('# Revised', { artifact_id: first.id, expected_revision: 1 });
  const second = s.state.domain.artifacts[`${first.id}@2`];
  s.apply('review.submit', decisionInput(s, [second], 'reject'));
  assert.equal(s.state.decisions[first.id].sequence, 3);
  assert.equal(Object.keys(s.state.approval_history).length, 1);
});

test('rejecting a new revision retains a previously approved older copy', () => {
  const s = setup();
  const first = s.publish('# First').artifact;
  s.apply('review.submit', decisionInput(s, [first]));
  const approval = structuredClone(s.state.approvals[first.id]);
  const second = s.publish('# Second', { artifact_id: first.id, expected_revision: 1 }).artifact;
  s.apply('review.submit', decisionInput(s, [second], 'reject'));
  assert.deepEqual(s.state.approvals[first.id], approval);
  assert.equal(s.state.decisions[first.id].artifact_revision, 2);
  assert.equal(s.state.decisions[first.id].decision, 'reject');
  assert.equal(s.state.decisions[first.id].sequence, 2);
});

test('decision sequence, stale artifact and source request failures roll back all changes and keep drafts', () => {
  const s = setup();
  const first = s.publish('# One').artifact;
  const second = s.publish('# Two').artifact;
  const requested = s.apply('agent.review', { conversation_id: s.conversation_id, text: 'Approve both?', artifacts: [ref(first), ref(second)] }, s.agent).signal;
  s.apply('draft.save', { conversation_id: s.conversation_id, draft: { note: 'Unsent, keep me.' } });
  const source_request = sourceOf(requested, { action_id: 'approve', terms_digest: requested.interaction.terms_digest });
  const valid = decisionInput(s, [first, second], 'approve', { source_request });
  for (const [fields, code] of [
    [{ expected_sequences: undefined }, 'approval_stale'],
    [{ expected_sequences: { [first.id]: 0 } }, 'approval_stale'],
    [{ expected_sequences: { [first.id]: 0, [second.id]: 1 } }, 'approval_stale'],
    [{ decision: 'maybe' }, 'review_invalid'],
    [{ source_request: undefined }, 'review_request_required'],
    [{ artifacts: [ref(first)], expected_sequences: { [first.id]: 0 } }, 'review_request_invalid'],
    [{ source_request: { ...source_request, value: { action_id: 'reject', terms_digest: requested.interaction.terms_digest } } }, 'review_request_invalid'],
    [{ source_request: { ...source_request, value: { action_id: 'approve', terms_digest: 'wrong' } } }, 'review_request_invalid'],
    [{ source_request: { ...source_request, expected_revision: 2 } }, 'review_request_invalid'],
  ]) {
    const before = structuredClone(s.state);
    assert.throws(() => s.apply('review.submit', { ...valid, ...fields }), { code });
    assert.deepEqual(s.state, before);
  }
  s.publish('# New one', { artifact_id: first.id, expected_revision: 1 });
  const before = structuredClone(s.state);
  assert.throws(() => s.apply('review.submit', valid), { code: 'review_stale' });
  assert.deepEqual(s.state, before);
});

test('review source cannot answer a foreign conversation and legacy choices require an explicitly offered value', () => {
  const s = setup();
  const artifact = s.publish('# Review').artifact;
  const foreign = s.apply('agent.open', { title: 'Other work', text: 'Unrelated conversation.' }, s.agent).conversation;
  const foreignSignal = s.apply('agent.question', { conversation_id: foreign.id, text: 'Ship?', choices: ['Approve', 'No'] }, s.agent).signal;
  const before = structuredClone(s.state);
  assert.throws(() => s.apply('review.submit', decisionInput(s, [artifact], 'approve', { source_request: sourceOf(foreignSignal, { option_id: '1' }) })), { code: 'review_request_invalid' });
  assert.deepEqual(s.state, before);
  const legacy = s.apply('agent.question', { conversation_id: s.conversation_id, text: 'Pick the original answer.', choices: ['Looks good', 'Discuss with me'] }, s.agent).signal;
  assert.throws(() => s.apply('review.submit', { conversation_id: s.conversation_id, artifacts: [ref(artifact)], comments: [], source_request: sourceOf(legacy, { action_id: 'approve' }) }), { code: 'interaction_invalid' });
  assert.throws(() => s.apply('review.submit', decisionInput(s, [artifact], 'approve', { source_request: sourceOf(legacy, { option_id: '1' }) })), { code: 'review_request_invalid' });
  const accepted = s.apply('review.submit', { conversation_id: s.conversation_id, artifacts: [ref(artifact)], comments: [], source_request: sourceOf(legacy, { option_id: '2' }), note: 'The content needs changes.' });
  assert.deepEqual(accepted.response.value, { option_id: '2' });
  assert.equal(s.state.domain.signals[legacy.id].state, 'answered');
  assert.equal(s.state.domain.signals[foreignSignal.id].state, 'active');
  assert.equal(accepted.review.decision, undefined);
  assert.deepEqual(s.state.decisions, {});
});

test('review decision retries across devices add no duplicate messages or decisions and recheck authority', () => {
  const s = setup();
  const artifact = s.publish('# Ready').artifact;
  const requested = s.apply('agent.review', { conversation_id: s.conversation_id, text: 'Review it.', artifacts: [ref(artifact)] }, s.agent).signal;
  const op = { type: 'review.submit', idempotency_key: 'decision-once', ...decisionInput(s, [artifact], 'approve', { source_request: sourceOf(requested, { action_id: 'approve', terms_digest: requested.interaction.terms_digest }) }) };
  const accepted = applyLibraryOperation(s.state, op, s.person);
  accepted.state.domain.devices.desktop_other = { id: 'desktop_other', person_id: s.person.person_id, kind: 'desktop', machine_id: 'machine_local', state: 'active' };
  const retry = applyLibraryOperation(accepted.state, op, { ...s.person, device_id: 'desktop_other' });
  assert.deepEqual(retry.result, accepted.result);
  assert.deepEqual(retry.state, accepted.state);
  assert.equal(Object.keys(retry.state.decision_history).length, 1);
  assert.equal(Object.keys(retry.state.domain.responses).length, 1);
  assert.throws(() => applyLibraryOperation(retry.state, { ...op, decision: 'reject' }, s.person), { code: 'idempotency_conflict' });
  const race = { ...op, idempotency_key: 'different-decision' };
  assert.throws(() => applyLibraryOperation(retry.state, race, s.person), { code: 'approval_stale' });
  const revoked = structuredClone(retry.state);
  revoked.domain.connections[s.sent.conversation.connection_id].state = 'revoked';
  assert.throws(() => applyLibraryOperation(revoked, op, s.person), { code: 'connection_inactive' });
});

test('legacy approval alias sends available notes once and preserves old cached approvals without redelivery', () => {
  const s = setup();
  const artifact = s.publish('# Ready').artifact;
  s.apply('draft.save', { conversation_id: s.conversation_id, draft: { comments: [], note: 'Keep this style.' } });
  const op = { type: 'version.approve', idempotency_key: 'compat-approval', artifact_id: artifact.id, revision: 1, expected_sequence: 0 };
  const accepted = applyLibraryOperation(s.state, op, s.person);
  assert.equal(accepted.result.review.note, 'Keep this style.');
  assert.ok(accepted.result.delivery.id);
  assert.equal(accepted.result.approval.artifact_revision, 1);
  const oldState = structuredClone(s.state);
  delete oldState.decisions; delete oldState.decision_history; delete oldState.review_requests;
  const cached = { id: 'old_approval', artifact_id: artifact.id, artifact_revision: 1, person_id: s.person.person_id, at: new Date().toISOString(), sequence: 1, previous_id: null };
  oldState.approvals[artifact.id] = cached;
  oldState.approval_history[cached.id] = cached;
  oldState.operations[JSON.stringify([s.person.person_id, op.type, op.idempotency_key])] = { input: structuredClone(op), result: { approval: cached }, domain_commands: [] };
  const replay = applyLibraryOperation(oldState, op, s.person);
  assert.deepEqual(replay.result, { approval: cached });
  assert.deepEqual(replay.state, oldState);
  const reject = applyLibraryOperation(oldState, { type: 'review.submit', idempotency_key: 'reject-after-old', conversation_id: s.conversation_id, artifacts: [ref(artifact)], comments: [], decision: 'reject', expected_sequences: { [artifact.id]: 1 } }, s.person);
  assert.equal(reject.state.decisions[artifact.id].sequence, 2);
  assert.equal(reject.state.decisions[artifact.id].previous_id, cached.id);
  assert.equal(reject.state.approvals[artifact.id], undefined);
  assert.deepEqual(reject.state.approval_history[cached.id], cached);
});

test('structured review requests reject foreign and stale artifact pins without publishing a signal', () => {
  const s = setup();
  const artifact = s.publish('# Initial').artifact;
  s.publish('# Revised', { artifact_id: artifact.id, expected_revision: 1 });
  const before = structuredClone(s.state);
  assert.throws(() => s.apply('agent.review', { conversation_id: s.conversation_id, text: 'Review.', artifacts: [ref(artifact)] }, s.agent), { code: 'review_stale' });
  assert.throws(() => s.apply('agent.review', { conversation_id: s.conversation_id, text: 'Review.', artifacts: [] }, s.agent), { code: 'review_invalid' });
  const other = s.apply('agent.open', { title: 'Other', text: 'Other conversation' }, s.agent).conversation;
  assert.throws(() => s.apply('agent.review', { conversation_id: other.id, text: 'Review.', artifacts: [{ artifact_id: artifact.id, revision: 2 }] }, s.agent), { code: 'review_stale' });
  assert.equal(Object.keys(s.state.domain.signals).length, Object.keys(before.domain.signals).length);
  assert.deepEqual(s.state.review_requests, {});
});

test('choosing one of several overlapping review requests answers only that exact request', () => {
  const s = setup();
  const artifact = s.publish('# Ready').artifact;
  const requested = () => s.apply('agent.review', { conversation_id: s.conversation_id, text: 'Review this copy.', artifacts: [ref(artifact)] }, s.agent).signal;
  const first = requested();
  const second = requested();
  s.apply('review.submit', decisionInput(s, [artifact], 'approve', { source_request: sourceOf(second, { action_id: 'approve', terms_digest: second.interaction.terms_digest }) }));
  assert.equal(s.state.domain.signals[first.id].state, 'active');
  assert.equal(s.state.domain.signals[second.id].state, 'answered');
  assert.equal(Object.keys(s.state.domain.responses).length, 1);
});

test('legacy approval rejects incompatible or unfinished drafts without discarding them', () => {
  const s = setup();
  const first = s.publish('# One').artifact;
  const second = s.publish('# Two').artifact;
  const comment = { ...ref(second), kind: 'comment', text: 'Keep this.', anchor: { type: 'text', block_id: 'block_0', start: 0, end: 3, quote: 'Two' } };
  for (const draft of [{ comments: [comment] }, { comments: [], annotation: { text: 'Still typing' } }]) {
    s.apply('draft.save', { conversation_id: s.conversation_id, draft });
    const before = structuredClone(s.state);
    assert.throws(() => s.apply('version.approve', { artifact_id: first.id, revision: 1, expected_sequence: 0 }));
    assert.deepEqual(s.state, before);
  }
});

test('content review cannot answer an unrelated execution approval even with an explicitly supplied action', () => {
  const s = setup();
  const artifact = s.publish('# Reviewed copy').artifact;
  const runtime = createRuntime({ seed: s.state.domain });
  const toolApproval = runtime.execute({ command: 'signal.publish', idempotency_key: 'tool-approval', conversation_id: s.conversation_id, kind: 'approval', content: [{ type: 'text', text: 'Deploy this app?' }], artifact_refs: [ref(artifact)], interaction: { id: 'deploy', mode: 'required', response_type: 'approval', consequences: 'Deploys the app publicly.', actions: [{ id: 'approve', label: 'Deploy' }, { id: 'reject', label: 'Cancel' }], terms: { operation: 'deploy', scope: 'production', target: 'public-site', artifact_refs: [ref(artifact)] } }, presentation: { type: 'native_choice' } }, s.agent).signal;
  s.state.domain = runtime.snapshot();
  const before = structuredClone(s.state);
  assert.throws(() => s.apply('review.submit', decisionInput(s, [artifact], 'approve', { source_request: sourceOf(toolApproval, { action_id: 'approve', terms_digest: toolApproval.interaction.terms_digest }) })), { code: 'review_request_invalid' });
  assert.deepEqual(s.state, before);
});


const questionReviewInput = (s, artifact, signal, value, rest = {}) => ({ conversation_id: s.conversation_id, artifacts: [ref(artifact)], comments: [], source_request: sourceOf(signal, value), ...rest });

test('question answers from the artifact canvas send exact choices or text with optional comments and never change artifact decisions', () => {
  for (const choices of [['Approve this wording', 'Something different'], []]) for (const withComment of [false, true]) {
    const s = setup();
    const artifact = s.publish('# Review\n\nHello creators.').artifact;
    s.apply('review.submit', decisionInput(s, [artifact], 'approve'));
    const originalDecisions = structuredClone({ approvals: s.state.approvals, approval_history: s.state.approval_history, decisions: s.state.decisions, decision_history: s.state.decision_history });
    const question = s.apply('agent.question', { conversation_id: s.conversation_id, text: 'Which direction?', choices }, s.agent).signal;
    const unrelated = s.apply('agent.question', { conversation_id: s.conversation_id, text: 'Separate question.', choices: [] }, s.agent).signal;
    const value = choices.length ? { option_id: '1' } : { text: 'Keep it quiet. I have not approved the artifact.' };
    const comments = withComment ? [{ ...ref(artifact), kind: 'comment', text: 'Consider this passage.', anchor: { type: 'text', block_id: 'block_1', start: 0, end: 5, quote: 'Hello' } }] : [];
    s.apply('draft.save', { conversation_id: s.conversation_id, draft: { comments } });
    const before = structuredClone(s.state);
    const accepted = s.apply('review.submit', questionReviewInput(s, artifact, question, value, { comments }));
    assert.deepEqual(accepted.response.value, value);
    assert.equal(accepted.review.decision, undefined);
    assert.equal(s.state.domain.signals[question.id].state, 'answered');
    assert.equal(s.state.domain.signals[unrelated.id].state, 'active');
    assert.equal(accepted.response.signal_revision, question.revision);
    assert.equal(accepted.response.interaction_id, question.interaction.id);
    assert.equal(accepted.review.response_id, accepted.response.id);
    assert.deepEqual(accepted.review.comments, comments);
    assert.equal(Object.keys(s.state.domain.messages).length, Object.keys(before.domain.messages).length + 1);
    assert.equal(Object.keys(s.state.domain.deliveries).length, Object.keys(before.domain.deliveries).length + 1);
    const message = s.state.domain.messages[accepted.review.message_id];
    assert.deepEqual(message.artifact_refs, [ref(artifact)]);
    assert.equal(message.in_reply_to_message_id, question.message_id);
    assert.equal(message.content[0].text, choices.length ? JSON.stringify(value) : value.text);
    if (withComment) assert.ok(message.content.some(block => block.text?.includes('Consider this passage.')));
    assert.deepEqual({ approvals: s.state.approvals, approval_history: s.state.approval_history, decisions: s.state.decisions, decision_history: s.state.decision_history }, originalDecisions);
    assert.equal(s.state.drafts[s.conversation_id], undefined);
  }
});

test('question feedback retries once across devices and rejects stale or unauthorized submissions without losing drafts', () => {
  const s = setup();
  const artifact = s.publish('# Review').artifact;
  const question = s.apply('agent.question', { conversation_id: s.conversation_id, text: 'Pick a direction.', choices: ['Quiet', 'Bold'] }, s.agent).signal;
  const op = { type: 'review.submit', idempotency_key: 'question-feedback-once', ...questionReviewInput(s, artifact, question, { option_id: '2' }) };
  s.apply('draft.save', { conversation_id: s.conversation_id, draft: { note: 'Keep this until accepted.' } });
  for (const [fields, code] of [
    [{ source_request: { ...op.source_request, expected_revision: 2 } }, 'signal_stale'],
    [{ source_request: { ...op.source_request, interaction_id: 'different' } }, 'interaction_invalid'],
    [{ source_request: { ...op.source_request, value: { option_id: 'unknown' } } }, 'interaction_invalid'],
    [{ source_request: { ...op.source_request, value: { text: 'Invented free text for choices.' } } }, 'interaction_invalid'],
    [{ expected_sequences: { [artifact.id]: 0 } }, 'review_invalid'],
    [{ decision: 'approve', expected_sequences: { [artifact.id]: 0 } }, 'review_request_invalid'],
  ]) {
    const before = structuredClone(s.state);
    assert.throws(() => applyLibraryOperation(s.state, { ...op, ...fields }, s.person), { code });
    assert.deepEqual(s.state, before);
  }
  const foreign = s.apply('agent.open', { title: 'Foreign', text: 'Another conversation.' }, s.agent).conversation;
  const foreignQuestion = s.apply('agent.question', { conversation_id: foreign.id, text: 'Unrelated?', choices: [] }, s.agent).signal;
  let before = structuredClone(s.state);
  assert.throws(() => applyLibraryOperation(s.state, { ...op, source_request: sourceOf(foreignQuestion, { text: 'No.' }) }, s.person), { code: 'review_request_invalid' });
  assert.throws(() => applyLibraryOperation(s.state, op, { kind: 'person', person_id: 'other', device_id: s.person.device_id }), { code: 'unauthorized' });
  assert.deepEqual(s.state, before);
  const accepted = applyLibraryOperation(s.state, op, s.person);
  accepted.state.domain.devices.other = { id: 'other', person_id: s.person.person_id, kind: 'desktop', machine_id: 'machine_local', state: 'active' };
  const retry = applyLibraryOperation(accepted.state, op, { ...s.person, device_id: 'other' });
  assert.deepEqual(retry.result, accepted.result);
  assert.equal(Object.keys(retry.state.domain.responses).length, 1);
  assert.equal(Object.keys(retry.state.domain.deliveries).length, Object.keys(before.domain.deliveries).length + 1);
  assert.deepEqual(retry.state.decisions, {});
  assert.throws(() => applyLibraryOperation(accepted.state, { ...op, note: 'Changed feedback.' }, s.person), { code: 'idempotency_conflict' });
  const runtime = createRuntime({ seed: accepted.state.domain });
  runtime.execute({ command: 'connection.revoke', idempotency_key: 'revoke-question', connection_id: question.connection_id, expected_revision: 1 }, s.person);
  assert.throws(() => applyLibraryOperation({ ...accepted.state, domain: runtime.snapshot() }, op, s.person), { code: 'connection_inactive' });
  s.publish('# New version', { artifact_id: artifact.id, expected_revision: 1 });
  before = structuredClone(s.state);
  assert.throws(() => applyLibraryOperation(s.state, op, s.person), { code: 'review_stale' });
  assert.deepEqual(s.state, before);
});

test('zero-comment artifact submissions require an exact question answer or structured review decision', () => {
  const s = setup();
  const artifact = s.publish('# Review').artifact;
  const bare = { conversation_id: s.conversation_id, artifacts: [ref(artifact)], comments: [] };
  let before = structuredClone(s.state);
  assert.throws(() => s.apply('review.submit', bare), { code: 'review_invalid' });
  assert.deepEqual(s.state, before);
  const question = s.apply('agent.question', { conversation_id: s.conversation_id, text: 'What would you change?', choices: [] }, s.agent).signal;
  before = structuredClone(s.state);
  assert.throws(() => s.apply('review.submit', { ...bare, source_request: sourceOf(question, { text: '' }) }), { code: 'interaction_invalid' });
  assert.deepEqual(s.state, before);
  const requested = s.apply('agent.review', { conversation_id: s.conversation_id, text: 'Review this artifact.', artifacts: [ref(artifact)] }, s.agent).signal;
  before = structuredClone(s.state);
  assert.throws(() => s.apply('review.submit', { ...bare, source_request: sourceOf(requested, { action_id: 'approve', terms_digest: requested.interaction.terms_digest }) }), { code: 'review_request_invalid' });
  assert.deepEqual(s.state, before);
});
