import { createRuntime, emptyState, CAPABILITIES } from '../domain/index.js';
import { documentModel } from './document.js';

const clone = value => structuredClone(value);
const pin = (id, revision) => `${id}@${revision}`;
const nonempty = value => typeof value === 'string' && value.trim() && value.length <= 16_384;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const sameRefs = (left, right) => left.length === right.length && left.every(ref => right.some(other => ref.artifact_id === other.artifact_id && ref.revision === other.revision));
const assert = (condition, code, message) => { if (!condition) throw new LibraryError(code, message); };
export class LibraryError extends Error {
  constructor(code, message) { super(message); this.name = 'LibraryError'; this.code = code; }
}

export function createLibrary({ person_id = 'person_local', device_id = 'desktop_local', machine_id = 'machine_local' } = {}) {
  const domain = emptyState();
  domain.persons[person_id] = { id: person_id, handle: '@you' };
  domain.devices[device_id] = { id: device_id, person_id, machine_id, kind: 'desktop', state: 'active' };
  return { version: 1, identity: { person_id, device_id, machine_id }, domain, sessions: {}, items: {}, reviews: {}, review_requests: {}, drafts: {}, decisions: {}, decision_history: {}, approvals: {}, approval_history: {}, cleared: {}, operations: {} };
}

function authorizePerson(state, principal) {
  const device = state.domain.devices[principal?.device_id];
  assert(principal?.kind === 'person' && principal.person_id === state.identity.person_id && device?.person_id === principal.person_id && device.state === 'active', 'unauthorized', 'This person/device cannot access the library.');
}
function endpoint(state, principal) {
  const found = state.domain.endpoints[principal?.endpoint_id];
  assert(principal?.kind === 'endpoint' && found, 'unauthorized', 'This endpoint is not connected.');
  return found;
}
function version(state, id, revision) {
  const artifact = state.domain.artifacts[pin(id, revision)];
  assert(artifact, 'artifact_unavailable', 'This exact artifact version is unavailable.');
  return artifact;
}
function latest(state, id) { return Math.max(...Object.values(state.domain.artifacts).filter(a => a.id === id).map(a => a.revision)); }
function commandKey(op, suffix) { return `${op.idempotency_key}:${suffix}`; }
function reviewedArtifacts(state, conversationId, refs) {
  assert(Array.isArray(refs) && refs.length > 0 && refs.length <= 20 && refs.every(ref => plain(ref) && Object.keys(ref).length === 2 && nonempty(ref.artifact_id) && Number.isInteger(ref.revision) && ref.revision > 0), 'review_invalid', 'Review a bounded set of exact artifact versions.');
  assert(new Set(refs.map(ref => ref.artifact_id)).size === refs.length, 'review_invalid', 'An artifact cannot be included twice.');
  const artifacts = refs.map(ref => version(state, ref.artifact_id, ref.revision));
  assert(artifacts.every(a => a.conversation_id === conversationId && a.revision === latest(state, a.id)), 'review_stale', 'A new version arrived. Keep this draft and review the current work before sending.');
  return artifacts;
}
function decisionSequence(state, artifactId) { return state.decisions?.[artifactId]?.sequence ?? state.approvals[artifactId]?.sequence ?? 0; }

/** One synchronous candidate transition. The host must atomically persist all returned state before responding. */
export function applyLibraryOperation(before, op, principal, { now = new Date().toISOString(), origin = 'https://api.getsomae.ai', id = prefix => `${prefix}_${crypto.randomUUID()}` } = {}) {
  assert(nonempty(op?.idempotency_key), 'invalid_operation', 'An idempotency key is required.');
  const state = clone(before);
  if (principal?.kind === 'person') authorizePerson(state, principal);
  else endpoint(state, principal);
  const actor = principal.kind === 'person' ? principal.person_id : principal.endpoint_id;
  const operationKey = JSON.stringify([actor, op.type, op.idempotency_key]);
  const previous = state.operations[operationKey];
  const runtime = createRuntime({ seed: state.domain, clock: () => now, idFactory: id });
  const domainCommands = [];
  const execute = (command, who = principal) => {
    const result = runtime.execute(command, who);
    domainCommands.push({ command: clone(command), principal: clone(who) });
    return result;
  };
  const operationConversation = op.conversation_id ?? (op.type === 'version.approve' ? state.items[op.artifact_id]?.conversation_id : undefined);
  const connectionId = op.connection_id ?? state.domain.conversations[operationConversation]?.connection_id;
  if (connectionId) assert(state.domain.connections[connectionId]?.state === 'active' || ['session.availability', 'inbox.mark'].includes(op.type), 'connection_inactive', 'The connection is inactive.');
  if (previous) {
    assert(JSON.stringify(previous.input) === JSON.stringify(op), 'idempotency_conflict', 'This key was used for different content.');
    for (const entry of previous.domain_commands ?? []) runtime.execute(entry.command, entry.principal.kind === principal.kind ? principal : entry.principal);
    return { state, result: clone(previous.result) };
  }
  const submitReview = input => {
    authorizePerson(state, principal);
    reviewedArtifacts(state, input.conversation_id, input.artifacts);
    assert(Array.isArray(input.comments) && input.comments.length <= 100 && (input.note === undefined || typeof input.note === 'string' && input.note.length <= 16_384), 'review_invalid', 'Review a bounded set of comments and feedback.');
    for (const comment of input.comments) validateAnchor(state, input.artifacts, comment);
    const hasDecision = Object.hasOwn(input, 'decision');
    assert(!hasDecision || ['approve', 'reject'].includes(input.decision), 'review_invalid', 'Choose approve or request changes.');
    assert(hasDecision || input.source_request !== undefined || nonempty(input.note) || input.comments.length > 0, 'review_invalid', 'Add feedback or answer the offered question before sending.');
    if (hasDecision) {
      assert(plain(input.expected_sequences) && Object.keys(input.expected_sequences).length === input.artifacts.length && input.artifacts.every(ref => Object.hasOwn(input.expected_sequences, ref.artifact_id) && Number.isInteger(input.expected_sequences[ref.artifact_id]) && input.expected_sequences[ref.artifact_id] >= 0), 'approval_stale', 'Inspect the current decision for every reviewed artifact before deciding.');
      for (const ref of input.artifacts) assert(input.expected_sequences[ref.artifact_id] === decisionSequence(state, ref.artifact_id), 'approval_stale', 'A review decision changed. Inspect it before deciding again.');
      const pendingRequests = Object.values(state.review_requests ?? {}).filter(request => state.domain.signals[request.signal_id]?.state === 'active' && state.domain.signals[request.signal_id]?.conversation_id === input.conversation_id && request.artifacts.some(ref => input.artifacts.some(reviewed => reviewed.artifact_id === ref.artifact_id)));
      assert(!pendingRequests.length || pendingRequests.some(request => request.signal_id === input.source_request?.signal_id), 'review_request_required', 'Answer the active review request with this decision so it does not remain pending in your inbox.');
    } else assert(input.expected_sequences === undefined, 'review_invalid', 'Decision sequences require an explicit review decision.');
    let source;
    if (input.source_request !== undefined) {
      source = input.source_request;
      assert(plain(source) && Object.keys(source).length === 4 && ['signal_id', 'interaction_id'].every(key => nonempty(source[key])) && Number.isInteger(source.expected_revision) && source.expected_revision > 0 && plain(source.value), 'review_invalid', 'Choose an exact offered response for this review.');
      const signal = state.domain.signals[source.signal_id];
      assert(signal?.conversation_id === input.conversation_id, 'review_request_invalid', 'This request belongs to another conversation.');
      const request = state.review_requests?.[source.signal_id];
      if (request) {
        assert(hasDecision && request.revision === source.expected_revision && sameRefs(request.artifacts, input.artifacts), 'review_request_invalid', 'Review every exact artifact version in this request together.');
        assert(signal.kind === 'approval' && signal.interaction?.response_type === 'approval' && signal.interaction.terms.operation === 'review_artifacts' && signal.interaction.terms.scope === 'content_review_only' && signal.interaction.terms.target === input.conversation_id && sameRefs(signal.interaction.terms.artifact_refs, request.artifacts), 'review_request_invalid', 'Only the exact content review terms can be answered from this review.');
        assert(Object.keys(source.value).length === 2 && source.value.action_id === input.decision && source.value.terms_digest === signal.interaction?.terms_digest, 'review_request_invalid', 'The decision must match the exact offered content review action.');
      } else {
        assert(signal.kind === 'question' && ['text', 'single_choice'].includes(signal.interaction?.response_type), 'review_request_invalid', 'Only an explicit original text or choice question can accompany review feedback.');
        assert(!hasDecision, 'review_request_invalid', 'Answer the offered question; artifact approval requires a structured review request.');
      }
    }
    const review = { id: id('review'), conversation_id: input.conversation_id, artifacts: clone(input.artifacts), comments: clone(input.comments), note: input.note ?? '', created_at: now, person_id: principal.person_id, ...(hasDecision ? { decision: input.decision } : {}), ...(source ? { source_request: clone(source) } : {}) };
    const content = [{ type: 'text', text: formatReview(review) }];
    const sent = source ? execute({ command: 'response.submit', idempotency_key: commandKey(op, 'review_response'), signal_id: source.signal_id, expected_revision: source.expected_revision, interaction_id: source.interaction_id, value: source.value, content, artifact_refs: input.artifacts }) : execute({ command: 'message.submit', idempotency_key: commandKey(op, 'review_message'), conversation_id: input.conversation_id, content, artifact_refs: input.artifacts });
    review.message_id = sent.message.id;
    review.delivery_id = sent.delivery.id;
    if (sent.response) review.response_id = sent.response.id;
    if (hasDecision) {
      state.decisions ??= {}; state.decision_history ??= {};
      for (const ref of input.artifacts) {
        const previousDecision = state.decisions[ref.artifact_id] ?? state.approvals[ref.artifact_id];
        const decision = { id: id('decision'), artifact_id: ref.artifact_id, artifact_revision: ref.revision, decision: input.decision, person_id: principal.person_id, at: now, sequence: decisionSequence(state, ref.artifact_id) + 1, previous_id: previousDecision?.id ?? null, review_id: review.id };
        state.decisions[ref.artifact_id] = decision;
        state.decision_history[decision.id] = clone(decision);
        if (input.decision === 'approve') {
          const approval = { ...clone(decision), previous_id: state.approvals[ref.artifact_id]?.id ?? null };
          state.approvals[ref.artifact_id] = approval;
          state.approval_history[approval.id] = clone(approval);
        } else if (state.approvals[ref.artifact_id]?.artifact_revision === ref.revision) delete state.approvals[ref.artifact_id];
      }
    }
    state.reviews[review.id] = review;
    delete state.drafts[input.conversation_id];
    return { review, delivery: sent.delivery, ...(sent.response ? { response: sent.response, signal: sent.signal } : {}) };
  };
  let result;
  if (op.type === 'session.register') {
    authorizePerson(state, principal);
    assert([op.session_id, op.workspace_id, op.title].every(nonempty), 'invalid_session', 'A selected project and session identity are required.');
    const existing = Object.values(state.sessions).find(s => s.session_id === op.session_id);
    if (existing) result = { connection_id: existing.connection_id, endpoint_id: existing.endpoint_id };
    else {
      const endpoint_id = id('endpoint'), connection_id = id('connection');
      const capabilities = CAPABILITIES.filter(c => !['context.receive', 'responses.remote_continuation'].includes(c));
      state.domain.endpoints[endpoint_id] = { id: endpoint_id, agent_id: 'claude_code', hosting: 'local', execution: 'turn_based', machine_id: state.identity.machine_id, online: true, durable_delivery: true, capabilities, interaction_types: ['text', 'single_choice', 'approval'], receive_media_types: ['text/plain', 'text/markdown', 'text/html', 'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'], max_artifact_bytes: 20 * 1024 * 1024 };
      state.domain.connections[connection_id] = { id: connection_id, person_id: state.identity.person_id, agent_id: 'claude_code', endpoint_id, state: 'active', capabilities, permissions: [...capabilities], machine_id: state.identity.machine_id, created_at: now, revision: 1 };
      state.sessions[connection_id] = { connection_id, endpoint_id, session_id: op.session_id, workspace_id: op.workspace_id, title: op.title };
      createRuntime({ seed: state.domain });
      result = { connection_id, endpoint_id };
    }
  } else if (op.type === 'message.send') {
    const input = { command: 'message.submit', idempotency_key: commandKey(op, 'message'), content: [{ type: 'text', text: op.text }], ...(op.conversation_id ? { conversation_id: op.conversation_id } : { connection_id: op.connection_id, title: op.title || 'A conversation with Claude' }) };
    result = execute(input);
    const route = state.sessions[result.conversation.connection_id];
    if (!result.conversation.continuity) execute({ command: 'conversation.bind', idempotency_key: commandKey(op, 'bind'), conversation_id: result.conversation.id, session_id: route.session_id, workspace_id: route.workspace_id }, { kind: 'endpoint', endpoint_id: route.endpoint_id });
  } else if (op.type === 'session.availability') {
    endpoint(state, principal);
    result = execute({ command: 'endpoint.set_availability', idempotency_key: commandKey(op, 'availability'), endpoint_id: principal.endpoint_id, online: op.online }, { kind: 'system' });
  } else if (op.type === 'delivery.dispatch') {
    const delivery = state.domain.deliveries[op.delivery_id];
    assert(delivery?.endpoint_id === principal.endpoint_id, 'unauthorized', 'Delivery belongs to another endpoint.');
    result = execute({ command: 'delivery.dispatch', idempotency_key: commandKey(op, 'dispatch'), delivery_id: op.delivery_id }, { kind: 'system' });
  } else if (['delivery.ack', 'input.accept', 'input.reject', 'input.unknown'].includes(op.type)) {
    result = execute({ command: op.type, idempotency_key: commandKey(op, 'receipt'), delivery_id: op.delivery_id, ...(['input.reject', 'input.unknown'].includes(op.type) ? { reason: op.reason } : {}) });
  } else if (op.type === 'agent.open') {
    endpoint(state, principal);
    const route = Object.values(state.sessions).find(s => s.endpoint_id === principal.endpoint_id);
    assert(route && nonempty(op.title) && nonempty(op.text), 'conversation_invalid', 'A connected session, title and opening message are required.');
    result = execute({ command: 'message.publish', idempotency_key: commandKey(op, 'open'), connection_id: route.connection_id, title: op.title, content: [{ type: 'text', text: op.text }] });
    execute({ command: 'conversation.bind', idempotency_key: commandKey(op, 'bind'), conversation_id: result.conversation.id, session_id: route.session_id, workspace_id: route.workspace_id });
  } else if (op.type === 'agent.reply') {
    result = execute({ command: 'signal.publish', idempotency_key: commandKey(op, 'reply'), conversation_id: op.conversation_id, kind: 'result', content: [{ type: 'text', text: op.text }], artifact_refs: op.artifact_refs ?? [], interaction: { id: id('interaction'), mode: 'optional', response_type: 'text', max_length: 16_384, consequences: 'Send a reply to this same Claude session.' }, presentation: { type: 'native' } });
  } else if (op.type === 'agent.question') {
    assert(Array.isArray(op.choices) && op.choices.length <= 8 && op.choices.every(nonempty), 'interaction_invalid', 'Choices must be a short list of readable options.');
    const choices = op.choices.length > 0;
    result = execute({ command: 'signal.publish', idempotency_key: commandKey(op, 'question'), conversation_id: op.conversation_id, kind: 'question', content: [{ type: 'text', text: op.text }], interaction: { id: id('interaction'), mode: 'required', response_type: choices ? 'single_choice' : 'text', consequences: 'Answer this question in the same Claude session.', ...(choices ? { actions: op.choices.map((label, i) => ({ id: String(i + 1), label })) } : { max_length: 16_384 }) }, presentation: { type: choices ? 'native_choice' : 'native' } });
  } else if (op.type === 'agent.review') {
    reviewedArtifacts(state, op.conversation_id, op.artifacts);
    result = execute({ command: 'signal.publish', idempotency_key: commandKey(op, 'review_request'), conversation_id: op.conversation_id, kind: 'approval', content: [{ type: 'text', text: op.text }], artifact_refs: op.artifacts, interaction: { id: id('interaction'), mode: 'required', response_type: 'approval', actions: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Request changes' }], consequences: 'Send this content review decision and feedback to the same agent. This does not authorize execution or publishing.', terms: { operation: 'review_artifacts', scope: 'content_review_only', target: op.conversation_id, artifact_refs: op.artifacts } }, presentation: { type: 'native_choice' } });
    state.review_requests ??= {};
    state.review_requests[result.signal.id] = { signal_id: result.signal.id, revision: result.signal.revision, artifacts: clone(op.artifacts) };
  } else if (op.type === 'artifact.publish') {
    endpoint(state, principal);
    assert(nonempty(op.title) && nonempty(op.filename), 'artifact_invalid', 'Title and filename are required.');
    assert(/^[a-f0-9]{64}$/.test(op.digest), 'artifact_invalid', 'A content digest is required.');
    if (op.review_id) {
      const review = state.reviews[op.review_id];
      assert(review?.conversation_id === op.conversation_id && review.artifacts.some(ref => ref.artifact_id === op.artifact_id && ref.revision === op.expected_revision), 'review_invalid', 'A revision must point to feedback for this exact item and version.');
    }
    result = execute({ command: 'artifact.publish', idempotency_key: commandKey(op, 'artifact'), conversation_id: op.conversation_id, media_type: op.media_type, presentation_type: op.media_type.startsWith('image/') ? 'image' : 'document', content_ref: { uri: `${origin}/v1/originals/${op.digest}`, origin, access: 'conversation' }, digest: op.digest, size: op.size, description: op.title, ...(op.artifact_id ? { artifact_id: op.artifact_id, expected_revision: op.expected_revision } : {}) });
    const artifact = result.artifact;
    const model = op.source === undefined ? null : documentModel(op.source, op.media_type);
    const prior = state.items[artifact.id];
    state.items[artifact.id] = { id: artifact.id, title: op.title, filename: op.filename, conversation_id: artifact.conversation_id, latest_revision: artifact.revision, created_at: prior?.created_at ?? now, updated_at: now, versions: { ...(prior?.versions ?? {}), [artifact.revision]: { filename: op.filename, blocks: model, review_id: op.review_id ?? null } } };
  } else if (op.type === 'review.submit') {
    result = submitReview(op);
  } else if (op.type === 'version.approve') {
    const artifact = version(state, op.artifact_id, op.revision);
    const draft = state.drafts[artifact.conversation_id];
    assert(!draft?.annotation, 'review_invalid', 'Finish the open annotation before approving.');
    result = submitReview({ conversation_id: artifact.conversation_id, artifacts: [{ artifact_id: artifact.id, revision: artifact.revision }], comments: draft?.comments ?? [], note: draft?.note ?? '', decision: 'approve', expected_sequences: { [artifact.id]: op.expected_sequence } });
    result.approval = clone(state.approvals[artifact.id]);
  } else if (op.type === 'draft.save') {
    authorizePerson(state, principal);
    assert(state.domain.conversations[op.conversation_id]?.person_id === principal.person_id, 'unauthorized', 'Conversation unavailable.');
    assert(JSON.stringify(op.draft).length <= 200_000, 'draft_invalid', 'Draft is too large.');
    state.drafts[op.conversation_id] = clone(op.draft);
    result = { saved: true };
  } else if (op.type === 'inbox.mark') {
    result = execute({ command: 'inbox.mark', idempotency_key: commandKey(op, 'view'), signal_id: op.signal_id, read: op.read ?? true, set_aside: op.set_aside ?? false });
    if (op.done) {
      assert(!state.domain.signals[op.signal_id]?.interaction || state.domain.signals[op.signal_id].interaction.mode === 'optional', 'interaction_required', 'Answer the required interaction before clearing it.');
      state.cleared[op.signal_id] = { person_id: principal.person_id, at: now };
    }
  } else if (op.type === 'response.submit') {
    result = execute({ command: 'response.submit', idempotency_key: commandKey(op, 'response'), signal_id: op.signal_id, expected_revision: op.expected_revision, interaction_id: op.interaction_id, value: op.value });
  } else throw new LibraryError('operation_unsupported', 'Unsupported operation.');
  if (op.type !== 'session.register') state.domain = runtime.snapshot();
  state.operations[operationKey] = { input: clone(op), result: clone(result), domain_commands: domainCommands };
  return { state, result };
}

export function validateAnchor(state, refs, comment) {
  assert(nonempty(comment?.text) && ['comment', 'replace'].includes(comment.kind), 'anchor_invalid', 'A comment requires text and a supported kind.');
  const ref = refs.find(ref => ref.artifact_id === comment.artifact_id && ref.revision === comment.revision);
  assert(ref, 'anchor_invalid', 'Comment must pin an included version.');
  const artifact = version(state, ref.artifact_id, ref.revision);
  if (comment.anchor?.type === 'text') {
    const anchor = comment.anchor;
    const block = state.items[artifact.id]?.versions[artifact.revision]?.blocks?.find(b => b.id === anchor.block_id);
    assert(block && Number.isInteger(anchor.start) && Number.isInteger(anchor.end) && anchor.start >= 0 && anchor.end > anchor.start && anchor.end <= block.text.length && block.text.slice(anchor.start, anchor.end) === anchor.quote, 'anchor_invalid', 'Selected text does not match the exact reviewed version.');
    if (comment.kind === 'replace') assert(typeof comment.replacement === 'string' && comment.replacement.length <= 16_384, 'anchor_invalid', 'Suggested replacement is required.');
  } else if (comment.anchor?.type === 'region') {
    const { x, y, width, height } = comment.anchor;
    assert(comment.kind === 'comment' && artifact.presentation_type === 'image' && [x, y, width, height].every(Number.isFinite) && x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1.000001 && y + height <= 1.000001, 'anchor_invalid', 'An image region must be inside the exact image.');
  } else throw new LibraryError('anchor_invalid', 'Select a passage or image region.');
}

export function formatReview(review) {
  const parts = [`Somae review ${review.id}.${review.decision ? ` Decision: ${review.decision === 'approve' ? 'Approved' : 'Changes requested'}.` : ''} This is content review only, not authorization to execute tools or publish externally. Feedback contains suggested changes, not edits already made.`, ...review.artifacts.map(ref => `Artifact ${ref.artifact_id} revision ${ref.revision}. If revising, use this artifact_id and expected_revision ${ref.revision}, with review_id ${review.id}.`)];
  if (review.note) parts.push(`Overall feedback: ${review.note}`);
  for (const c of review.comments) parts.push(JSON.stringify(c));
  return parts.join('\n\n');
}

/** Allowlisted person projection; provider continuity, credentials and idempotency records stay host-only. */
export function projectLibrary(state, principal) {
  authorizePerson(state, principal);
  return {
    connections: Object.values(state.sessions).map(s => ({ id: s.connection_id, name: s.title, agent: 'Claude Code', online: state.domain.endpoints[s.endpoint_id].online, state: state.domain.connections[s.connection_id].state })),
    conversations: Object.values(state.domain.conversations).filter(c => c.person_id === principal.person_id).map(c => ({ id: c.id, title: c.title, connection_id: c.connection_id, created_at: c.created_at })),
    signals: Object.values(state.domain.signals).map(s => ({ id: s.id, conversation_id: s.conversation_id, revision: s.revision, kind: s.kind, state: s.state, created_at: s.created_at, interaction: clone(s.interaction), artifact_refs: clone(state.domain.messages[s.message_id].artifact_refs), content: clone(state.domain.messages[s.message_id].content), ...(state.review_requests?.[s.id] ? { review_request: { signal_id: s.id, revision: state.review_requests[s.id].revision, artifacts: clone(state.review_requests[s.id].artifacts) } } : {}), view: clone(state.domain.inbox_views[`${principal.person_id}:${s.id}`] ?? {}), cleared: !!state.cleared[s.id] })),
    messages: Object.values(state.domain.messages).map(m => ({ id: m.id, conversation_id: m.conversation_id, authored_by: m.author.kind, content: clone(m.content), artifact_refs: clone(m.artifact_refs), created_at: m.created_at })),
    items: Object.values(state.items).map(item => ({ ...clone(item), approved: clone(state.approvals[item.id] ?? null), decision: clone(state.decisions?.[item.id] ?? null), versions: Object.entries(item.versions).map(([revision, value]) => { const artifact = version(state, item.id, Number(revision)); return { revision: Number(revision), ...clone(value), media_type: artifact.media_type, digest: artifact.digest, size: artifact.size, created_at: artifact.created_at }; }) })),
    reviews: Object.values(state.reviews).map(clone), drafts: clone(state.drafts),
    deliveries: Object.values(state.domain.deliveries).map(d => ({ id: d.id, conversation_id: d.conversation_id, message_id: d.message_id, state: d.state, input_state: d.input_state, created_at: d.created_at })),
  };
}
