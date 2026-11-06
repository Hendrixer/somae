import { createHash, randomUUID } from 'node:crypto';
import ontology from './ontology.json' with { type: 'json' };

export const CAPABILITIES = Object.freeze([...ontology.enums.capability]);
const COLLECTIONS = ['persons', 'devices', 'endpoints', 'connections', 'conversations', 'messages', 'signals', 'responses', 'artifacts', 'context_snapshots', 'deliveries', 'inbox_views', 'idempotency'];
const clone = value => structuredClone(value);
const own = (object, key) => Object.hasOwn(object, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 16384;
const positive = value => Number.isInteger(value) && value > 0;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const refKey = (id, revision) => `${id}@${revision}`;
const same = (a, b) => canonical(a) === canonical(b);
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function json(value, depth = 0) {
  if (depth > 30) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => json(item, depth + 1));
  if (plain(value)) return Object.keys(value).every(key => !['__proto__', 'constructor', 'prototype'].includes(key) && json(value[key], depth + 1));
  return false;
}
function only(value, required, optional = []) {
  return plain(value) && required.every(key => own(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
}
function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function fail(code, message, ...ruleIds) { throw new DomainError(code, message, ruleIds); }

export class DomainError extends Error {
  constructor(code, message, ruleIds = []) {
    super(message); this.name = 'DomainError'; this.code = code; this.ruleIds = [...ruleIds];
  }
}

export function getOntology() { return clone(ontology); }
export function emptyState() {
  return { protocol_version: '0.1', ...Object.fromEntries(COLLECTIONS.map(key => [key, {}])), events: [] };
}

function validateCommand(command) {
  if (!json(command) || !plain(command)) fail('command_invalid', 'Commands must be plain JSON.', 'SOMAE-022');
  const schema = own(ontology.commands, command.command) ? ontology.commands[command.command] : null;
  if (!schema) fail('command_unsupported', 'Unsupported domain command.', 'SOMAE-022');
  if (!only(command, ['command', 'idempotency_key', ...schema.required], schema.optional) || !text(command.idempotency_key)) {
    fail('command_invalid', 'Missing command fields or unsupported payload fields.', 'SOMAE-022');
  }
  for (const [key, value] of Object.entries(command)) {
    if ((key.endsWith('_id') || key === 'title' || key === 'reason' || key === 'session_id' || key === 'workspace_id') && !text(value)) {
      fail('command_invalid', `Invalid ${key}.`, 'SOMAE-022');
    }
  }
  if (own(command, 'expected_revision') && !positive(command.expected_revision)) fail('command_invalid', 'Invalid expected_revision.', 'SOMAE-007');
}

function connectionFor(state, command) {
  let connection;
  if (command.signal_id) {
    const signal = own(state.signals, command.signal_id) ? state.signals[command.signal_id] : null;
    if (!signal) fail('not_found', 'Resource is unavailable.', 'SOMAE-001');
    connection = state.connections[signal.connection_id];
  } else if (command.delivery_id) {
    const delivery = own(state.deliveries, command.delivery_id) ? state.deliveries[command.delivery_id] : null;
    if (!delivery) fail('not_found', 'Resource is unavailable.', 'SOMAE-001');
    connection = state.connections[delivery.connection_id];
  } else if (command.conversation_id) {
    const conversation = own(state.conversations, command.conversation_id) ? state.conversations[command.conversation_id] : null;
    if (!conversation) fail('not_found', 'Resource is unavailable.', 'SOMAE-001');
    connection = state.connections[conversation.connection_id];
    if (command.connection_id && command.connection_id !== connection.id) fail('scope_invalid', 'Conversation destination cannot change.', 'SOMAE-021');
  } else if (command.connection_id) connection = own(state.connections, command.connection_id) ? state.connections[command.connection_id] : null;
  if (!connection && !['endpoint.set_availability'].includes(command.command)) fail('not_found', 'Resource is unavailable.', 'SOMAE-001');
  return connection;
}

// SOMAE-001: the host authenticates this principal; command identity is forbidden.
function authorize(state, command, principal) {
  const schema = ontology.commands[command.command];
  const required = principal?.kind === 'person' ? ['kind', 'person_id', 'device_id'] : principal?.kind === 'endpoint' ? ['kind', 'endpoint_id'] : ['kind'];
  if (!only(principal, required) || principal.kind !== schema.actor || required.filter(key => key !== 'kind').some(key => !text(principal[key]))) fail('unauthorized', 'This actor cannot issue this command.', 'SOMAE-001');
  const connection = connectionFor(state, command);
  if (principal.kind === 'person') {
    const device = own(state.devices, principal.device_id) ? state.devices[principal.device_id] : null;
    if (!own(state.persons, principal.person_id) || !device || device.person_id !== principal.person_id || device.state !== 'active' || connection.person_id !== principal.person_id) {
      fail('unauthorized', 'This actor cannot access the resource.', 'SOMAE-001');
    }
  }
  if (principal.kind === 'endpoint' && (!own(state.endpoints, principal.endpoint_id) || connection.endpoint_id !== principal.endpoint_id)) {
    fail('unauthorized', 'This actor cannot access the resource.', 'SOMAE-001');
  }
  if (command.command === 'endpoint.set_availability' && !own(state.endpoints, command.endpoint_id)) fail('not_found', 'Endpoint is unavailable.', 'SOMAE-001');
  // Receipt authority is bound to a prior dispatch rather than the current grant.
  if (['delivery.ack', 'input.accept', 'input.reject', 'input.unknown'].includes(command.command)) {
    if (!state.deliveries[command.delivery_id].dispatched_at) fail('receipt_invalid', 'Delivery has not been dispatched.', 'SOMAE-016');
    return connection;
  }
  if (command.command === 'inbox.mark') return connection;
  if (command.command === 'signal.expire') return connection;
  if (command.command.startsWith('connection.')) return connection;
  if (command.command === 'endpoint.set_availability') return connection;
  if (command.command === 'signal.withdraw') {
    if (!['active', 'paused'].includes(connection.state)) fail('connection_inactive', 'Connection does not allow withdrawal.', 'SOMAE-002');
    capability(state, connection, 'signals.withdraw'); return connection;
  }
  active(connection);
  if (command.command === 'message.submit') {
    capability(state, connection, command.conversation_id ? 'messages.continue' : 'messages.start');
    localMessagePolicy(state, connection, principal);
  } else if (command.command === 'message.publish') capability(state, connection, 'messages.publish');
  else if (command.command.startsWith('signal.')) capability(state, connection, command.command === 'signal.publish' ? 'signals.publish' : 'signals.update');
  else if (command.command === 'response.submit') {
    capability(state, connection, 'responses.receive');
    continuationPolicy(state, connection, principal, state.signals[command.signal_id]);
  } else if (command.command === 'artifact.publish') capability(state, connection, 'artifacts.publish');
  return connection;
}

// SOMAE-002/003: declaration is not consent.
function active(connection) {
  if (connection.state !== 'active') fail('connection_inactive', 'Connection is not active.', 'SOMAE-002');
}
function capability(state, connection, value) {
  if (![state.endpoints[connection.endpoint_id].capabilities, connection.capabilities].every(values => values.includes(value))) {
    fail('capability_unsupported', `The active grant does not support ${value}.`, 'SOMAE-003');
  }
  if (!connection.permissions.includes(value)) fail('permission_denied', `The person has not granted ${value}.`, 'SOMAE-003');
}
function localMessagePolicy(state, connection, principal) {
  const endpoint = state.endpoints[connection.endpoint_id];
  if (endpoint.hosting === 'local' && (state.devices[principal.device_id].kind !== ontology.enums.device_kind[0] || state.devices[principal.device_id].machine_id !== endpoint.machine_id)) {
    fail('origin_device_disallowed', 'New local input requires Somae on the same registered machine.', 'SOMAE-004');
  }
  if (!endpoint.online && (endpoint.hosting === 'local' || !endpoint.durable_delivery)) fail('endpoint_unavailable', 'Endpoint cannot currently accept new input.', 'SOMAE-004');
}
function validateContinuation(state, conversation, continuation) {
  if (!only(continuation, ['session_id', 'workspace_id', 'valid_until']) || !text(continuation.session_id) || !text(continuation.workspace_id) || !iso(continuation.valid_until)) {
    fail('continuation_unavailable', 'Continuation must identify a bounded existing session.', 'SOMAE-005');
  }
  if (!conversation.continuity || continuation.session_id !== conversation.continuity.session_id || continuation.workspace_id !== conversation.continuity.workspace_id) {
    fail('continuation_unavailable', 'Continuation is not bound to this conversation session.', 'SOMAE-005');
  }
}
function continuationPolicy(state, connection, principal, signal) {
  const endpoint = state.endpoints[connection.endpoint_id];
  if (endpoint.hosting !== 'local') {
    if (!endpoint.online && !endpoint.durable_delivery) fail('endpoint_unavailable', 'Endpoint cannot queue input.', 'SOMAE-005');
    return;
  }
  const remote = state.devices[principal.device_id].machine_id !== endpoint.machine_id;
  if (remote) capability(state, connection, 'responses.remote_continuation');
  if (remote || !endpoint.online) {
    if (!signal.continuation) fail('continuation_unavailable', 'The signal does not offer an existing local continuation.', 'SOMAE-005');
    validateContinuation(state, state.conversations[signal.conversation_id], signal.continuation);
  }
}
function revision(record, expected) {
  if (record.revision !== expected) fail('signal_stale', 'Review the current revision before submitting.', 'SOMAE-007');
}
function signalActive(signal, now) {
  const errors = { answered: 'signal_already_answered', withdrawn: 'signal_withdrawn', expired: 'signal_expired' };
  if (signal.state !== 'active') fail(errors[signal.state], 'Signal is no longer active.', 'SOMAE-008');
  if (signal.expires_at && Date.parse(signal.expires_at) <= Date.parse(now)) fail('signal_expired', 'Signal decision window has ended.', 'SOMAE-009');
}

function content(blocks) {
  if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > 100 || blocks.some(block => !plain(block)) || !blocks.some(block => ['text', 'markdown'].includes(block.type) && text(block.text))) {
    fail('content_invalid', 'Every message requires a readable text fallback.', 'SOMAE-022');
  }
  for (const block of blocks) {
    if (['text', 'markdown'].includes(block.type) && only(block, ['type', 'text']) && text(block.text)) continue;
    if (block.type === 'data' && only(block, ['type', 'value']) && json(block.value)) continue;
    if (block.type === 'artifact' && only(block, ['type', 'artifact_id', 'revision']) && text(block.artifact_id) && positive(block.revision)) continue;
    fail('content_invalid', 'Unsupported content block or unsupported fields.', 'SOMAE-022');
  }
  return clone(blocks);
}
function artifactRefs(state, conversation, refs = [], receiving = false) {
  if (!Array.isArray(refs)) fail('artifact_revision_invalid', 'Attachments must explicitly pin revisions.', 'SOMAE-012');
  const keys = new Set();
  for (const ref of refs) {
    if (!only(ref, ['artifact_id', 'revision']) || !text(ref.artifact_id) || !positive(ref.revision)) fail('artifact_revision_invalid', 'Invalid artifact reference.', 'SOMAE-012');
    const key = refKey(ref.artifact_id, ref.revision);
    const artifact = state.artifacts[key];
    if (!artifact || artifact.conversation_id !== conversation.id || keys.has(key)) fail('artifact_revision_invalid', 'Artifact version is unavailable in this conversation.', 'SOMAE-012');
    keys.add(key);
    if (receiving) {
      const connection = state.connections[conversation.connection_id], endpoint = state.endpoints[connection.endpoint_id];
      capability(state, connection, 'artifacts.receive');
      if (!endpoint.receive_media_types.includes(artifact.media_type) || artifact.size > endpoint.max_artifact_bytes) fail('artifact_unsupported', 'Attachment exceeds the endpoint media or size support.', 'SOMAE-012');
    }
  }
  return clone(refs);
}
function primitiveSchema(schema) {
  if (!only(schema, ['type'], ['enum', 'minLength', 'maxLength', 'minimum', 'maximum'])) return false;
  if (!['string', 'boolean', 'integer', 'number'].includes(schema.type)) return false;
  if (schema.enum && (!Array.isArray(schema.enum) || !schema.enum.length || !schema.enum.every(item => json(item) && (item === null || typeof item !== 'object')))) return false;
  for (const key of ['minLength', 'maxLength']) if (own(schema, key) && (!Number.isInteger(schema[key]) || schema[key] < 0 || schema.type !== 'string')) return false;
  for (const key of ['minimum', 'maximum']) if (own(schema, key) && (!Number.isFinite(schema[key]) || !['integer', 'number'].includes(schema.type))) return false;
  if (schema.minimum > schema.maximum || schema.minLength > schema.maxLength) return false;
  return true;
}
function formSchema(schema) {
  return only(schema, ['type', 'properties', 'required', 'additionalProperties']) && schema.type === 'object' && schema.additionalProperties === false && plain(schema.properties) &&
    Object.keys(schema.properties).length <= 50 && Array.isArray(schema.required) && new Set(schema.required).size === schema.required.length &&
    schema.required.every(key => typeof key === 'string' && own(schema.properties, key)) && Object.values(schema.properties).every(primitiveSchema);
}
function normalizeInteraction(state, conversation, kind, interaction, refs) {
  if (interaction === null) {
    if (['question', 'approval'].includes(kind)) fail('interaction_invalid', 'Questions and approvals require an interaction.', 'SOMAE-010');
    return null;
  }
  if (!only(interaction, ['id', 'mode', 'response_type', 'consequences'], ['actions', 'schema', 'terms', 'max_length']) || !text(interaction.id) || !['required', 'optional'].includes(interaction.mode) || !text(interaction.consequences)) {
    fail('interaction_invalid', 'Unsupported interaction description.', 'SOMAE-010', 'SOMAE-022');
  }
  const endpoint = state.endpoints[conversation.endpoint_id];
  if (!ontology.enums.interaction_type.includes(interaction.response_type) || !endpoint.interaction_types.includes(interaction.response_type)) fail('capability_unsupported', 'Endpoint does not support this interaction type.', 'SOMAE-003');
  capability(state, state.connections[conversation.connection_id], 'responses.receive');
  if (['question', 'approval'].includes(kind) && interaction.mode !== 'required') fail('interaction_invalid', 'Questions and approvals require a required interaction.', 'SOMAE-010');
  if ((kind === 'approval') !== (interaction.response_type === 'approval')) fail('interaction_invalid', 'Approval controls must be attached to an approval signal.', 'SOMAE-011');
  const out = clone(interaction), type = interaction.response_type;
  if (['single_choice', 'multiple_choice', 'approval'].includes(type)) {
    if (!Array.isArray(interaction.actions) || !interaction.actions.length || interaction.actions.length > 50 || interaction.actions.some(action => !only(action, ['id', 'label']) || !text(action.id) || !text(action.label)) || new Set(interaction.actions.map(action => action.id)).size !== interaction.actions.length) {
      fail('interaction_invalid', 'Choices need unique stable action IDs and labels.', 'SOMAE-010');
    }
  } else if (own(interaction, 'actions')) fail('interaction_invalid', 'This interaction does not support choices.', 'SOMAE-010');
  if (type === 'form' ? !formSchema(interaction.schema) : own(interaction, 'schema')) fail('interaction_invalid', 'Unsupported form schema.', 'SOMAE-010', 'SOMAE-022');
  if (own(interaction, 'max_length') && (type !== 'text' || !positive(interaction.max_length) || interaction.max_length > 16384)) fail('interaction_invalid', 'Invalid text limit.', 'SOMAE-010');
  if (type === 'approval') {
    const terms = interaction.terms;
    if (!only(terms, ['operation', 'scope', 'target', 'artifact_refs'], ['cost']) || ![terms.operation, terms.scope, terms.target].every(text) || !Array.isArray(terms.artifact_refs)) fail('interaction_invalid', 'Approvals require concrete pinned operation, scope, target and artifact terms.', 'SOMAE-011');
    if (own(terms, 'cost') && (!only(terms.cost, ['amount', 'currency']) || !Number.isFinite(terms.cost.amount) || terms.cost.amount < 0 || !/^[A-Z]{3}$/.test(terms.cost.currency))) fail('interaction_invalid', 'Invalid approval cost.', 'SOMAE-011');
    artifactRefs(state, conversation, terms.artifact_refs);
    if (terms.artifact_refs.some(ref => !refs.some(attached => same(ref, attached)))) fail('artifact_revision_invalid', 'Approval artifacts must also be explicitly attached.', 'SOMAE-011', 'SOMAE-012');
    if (!same([...interaction.actions.map(action => action.id)].sort(), ['approve', 'reject'])) fail('interaction_invalid', 'Approval actions must explicitly approve or reject.', 'SOMAE-011');
    out.terms_digest = digest(terms);
  } else if (own(interaction, 'terms')) fail('interaction_invalid', 'Only approvals carry operation terms.', 'SOMAE-011');
  return out;
}
function validateValue(interaction, value) {
  const invalid = () => fail('interaction_invalid', 'Response does not match the declared interaction.', 'SOMAE-010');
  const actions = interaction.actions?.map(action => action.id) ?? [];
  switch (interaction.response_type) {
    case 'text': if (!only(value, ['text']) || !text(value.text) || value.text.length > (interaction.max_length ?? 4000)) invalid(); break;
    case 'single_choice': if (!only(value, ['option_id']) || !actions.includes(value.option_id)) invalid(); break;
    case 'multiple_choice': if (!only(value, ['option_ids']) || !Array.isArray(value.option_ids) || !value.option_ids.length || new Set(value.option_ids).size !== value.option_ids.length || !value.option_ids.every(id => actions.includes(id))) invalid(); break;
    case 'approval':
      if (!only(value, ['action_id', 'terms_digest']) || !actions.includes(value.action_id)) invalid();
      if (value.terms_digest !== interaction.terms_digest) fail('approval_terms_invalid', 'Approval terms must match the exact reviewed terms digest.', 'SOMAE-011');
      break;
    case 'form': {
      if (!only(value, ['fields']) || !plain(value.fields)) invalid();
      const schema = interaction.schema;
      if (!schema.required.every(key => own(value.fields, key)) || !Object.keys(value.fields).every(key => own(schema.properties, key))) invalid();
      for (const [key, field] of Object.entries(value.fields)) {
        const spec = schema.properties[key];
        if (spec.type === 'integer' ? !Number.isInteger(field) : typeof field !== spec.type) invalid();
        if (spec.enum && !spec.enum.some(item => same(item, field))) invalid();
        if (typeof field === 'string' && (field.length < (spec.minLength ?? 0) || field.length > (spec.maxLength ?? 16384))) invalid();
        if (typeof field === 'number' && (field < (spec.minimum ?? -Infinity) || field > (spec.maximum ?? Infinity))) invalid();
      }
      break;
    }
    default: invalid();
  }
  return clone(value);
}
function emit(ctx, type, entity, conversation = null) {
  ctx.state.events.push({
    id: ctx.id('event'), protocol_version: '0.1', cursor: ctx.state.events.length + 1,
    type, source: clone(ctx.principal), timestamp: ctx.now,
    audience: { person_id: ctx.connection?.person_id ?? null, endpoint_id: ctx.connection?.endpoint_id ?? null },
    entity_id: entity.id, entity_revision: entity.revision ?? null,
    conversation_id: conversation?.id ?? entity.conversation_id ?? null,
    conversation_sequence: conversation?.sequence ?? null,
    causation: { command: ctx.command.command, idempotency_key: ctx.command.idempotency_key },
  });
}
function conversation(ctx) {
  if (ctx.command.conversation_id) return ctx.state.conversations[ctx.command.conversation_id];
  const value = {
    id: ctx.id('conversation'), person_id: ctx.connection.person_id, connection_id: ctx.connection.id,
    endpoint_id: ctx.connection.endpoint_id, created_at: ctx.now, title: ctx.command.title ?? 'Conversation', sequence: 0, continuity: null,
  };
  if (ctx.command.continuity) {
    if (!only(ctx.command.continuity, ['session_id', 'workspace_id']) || !Object.values(ctx.command.continuity).every(text)) fail('continuation_unavailable', 'Invalid conversation session binding.', 'SOMAE-005');
    value.continuity = clone(ctx.command.continuity);
  }
  ctx.state.conversations[value.id] = value; emit(ctx, 'conversation.created', value, value); return value;
}
function appendMessage(ctx, conv, { content: blocks, artifact_refs = [], in_reply_to_message_id, author = ctx.principal } = {}) {
  const receiving = author.kind === 'person';
  const refs = artifactRefs(ctx.state, conv, artifact_refs, receiving), normalized = content(blocks);
  for (const block of normalized.filter(block => block.type === 'artifact')) if (!refs.some(ref => ref.artifact_id === block.artifact_id && ref.revision === block.revision)) fail('artifact_revision_invalid', 'Content artifact must also be explicitly attached.', 'SOMAE-012');
  if (in_reply_to_message_id && ctx.state.messages[in_reply_to_message_id]?.conversation_id !== conv.id) fail('scope_invalid', 'Reply must reference a message in this conversation.', 'SOMAE-021');
  const message = {
    id: ctx.id('message'), conversation_id: conv.id, author: clone(author), created_at: ctx.now,
    sequence: ++conv.sequence, content: normalized, artifact_refs: refs, context_snapshot_refs: [],
    ...(in_reply_to_message_id ? { in_reply_to_message_id } : {}),
  };
  ctx.state.messages[message.id] = message;
  return message;
}
function shareContext(ctx, conv, message, context) {
  if (context === undefined) return;
  if (!only(context, ['consent', 'purpose', 'snapshot']) || context.consent !== true || !text(context.purpose) || !plain(context.snapshot) || !json(context.snapshot)) fail('context_consent_required', 'Explicit consent, audience and purpose are required for context.', 'SOMAE-013');
  capability(ctx.state, ctx.connection, 'context.receive');
  const snapshot = {
    id: ctx.id('context'), revision: 1, conversation_id: conv.id, person_id: ctx.principal.person_id,
    audience: { endpoint_id: conv.endpoint_id, connection_id: conv.connection_id },
    purpose: context.purpose, consent: true, created_at: ctx.now, value: clone(context.snapshot),
  };
  ctx.state.context_snapshots[snapshot.id] = snapshot;
  message.context_snapshot_refs.push({ snapshot_id: snapshot.id, revision: snapshot.revision });
  emit(ctx, 'context.shared', snapshot, conv);
}
function makeDelivery(ctx, conv, message, response = null, signal = null) {
  const validity = [signal?.expires_at, signal?.continuation?.valid_until].filter(Boolean);
  const valid_until = validity.length ? validity.reduce((a, b) => Date.parse(a) < Date.parse(b) ? a : b) : null;
  const delivery = {
    id: ctx.id('delivery'), connection_id: conv.connection_id, endpoint_id: conv.endpoint_id, conversation_id: conv.id,
    message_id: message.id, response_id: response?.id ?? null, created_at: ctx.now,
    state: 'queued', input_state: 'unknown', valid_until, attempts: 0, dispatched_at: null,
    received_at: null, input_receipt: null,
    continuation: signal?.continuation ? clone(signal.continuation) : null,
    signal_revision: signal?.revision ?? null,
  };
  ctx.state.deliveries[delivery.id] = delivery; emit(ctx, 'delivery.queued', delivery, conv); return delivery;
}
function publishMessage(ctx) {
  const conv = conversation(ctx);
  const message = appendMessage(ctx, conv, ctx.command);
  shareContext(ctx, conv, message, ctx.command.context);
  emit(ctx, 'message.created', message, conv);
  const delivery = ctx.principal.kind === 'person' ? makeDelivery(ctx, conv, message) : null;
  return { conversation: conv, message, ...(delivery ? { delivery } : {}) };
}
function signalFields(ctx, conv) {
  const command = ctx.command;
  if (!ontology.enums.signal_kind.includes(command.kind)) fail('interaction_invalid', 'Unsupported signal kind.', 'SOMAE-022');
  const refs = artifactRefs(ctx.state, conv, command.artifact_refs);
  const interaction = normalizeInteraction(ctx.state, conv, command.kind, command.interaction, refs);
  if (!only(command.presentation, ['type'], ['artifact_id', 'artifact_revision']) || !ontology.enums.presentation_type.includes(command.presentation.type)) fail('presentation_unsupported', 'Unsupported presentation; use native fallback.', 'SOMAE-022');
  if (own(command.presentation, 'artifact_id') || own(command.presentation, 'artifact_revision')) {
    if (!text(command.presentation.artifact_id) || !positive(command.presentation.artifact_revision)) fail('artifact_revision_invalid', 'Presentation must specify a valid paired artifact pin.', 'SOMAE-012');
    if (!refs.some(ref => ref.artifact_id === command.presentation.artifact_id && ref.revision === command.presentation.artifact_revision)) fail('artifact_revision_invalid', 'Presentation must pin an attached artifact version.', 'SOMAE-012');
  }
  if (command.presentation.type === 'artifact' && !command.presentation.artifact_id) fail('artifact_revision_invalid', 'Artifact presentation requires a pinned artifact.', 'SOMAE-012');
  if (command.expires_at && (!iso(command.expires_at) || Date.parse(command.expires_at) <= Date.parse(ctx.now))) fail('signal_expired', 'Signal requires a future deadline.', 'SOMAE-009');
  if (command.continuation) {
    if (!interaction) fail('continuation_unavailable', 'A continuation requires an offered interaction.', 'SOMAE-005');
    validateContinuation(ctx.state, conv, command.continuation);
    if (Date.parse(command.continuation.valid_until) <= Date.parse(ctx.now)) fail('continuation_unavailable', 'Continuation has expired.', 'SOMAE-005');
  }
  return {
    kind: command.kind, interaction, presentation: clone(command.presentation),
    expires_at: command.expires_at ?? null, continuation: command.continuation ? clone(command.continuation) : null,
  };
}
function publishSignal(ctx, updating = false) {
  const previous = updating ? ctx.state.signals[ctx.command.signal_id] : null;
  if (previous) { signalActive(previous, ctx.now); revision(previous, ctx.command.expected_revision); }
  const conv = previous ? ctx.state.conversations[previous.conversation_id] : conversation(ctx);
  const fields = signalFields(ctx, conv), message = appendMessage(ctx, conv, ctx.command);
  if (ctx.command.supersedes_signal_id && ctx.state.signals[ctx.command.supersedes_signal_id]?.conversation_id !== conv.id) fail('scope_invalid', 'Replacement must reference a signal in this conversation.', 'SOMAE-021');
  const signal = {
    ...(previous ?? { id: ctx.id('signal'), conversation_id: conv.id, connection_id: conv.connection_id, created_at: ctx.now, revisions: [] }),
    ...fields, message_id: message.id, revision: previous ? previous.revision + 1 : 1,
    state: 'active', updated_at: ctx.now, response_id: null,
    ...(ctx.command.supersedes_signal_id ? { supersedes_signal_id: ctx.command.supersedes_signal_id } : {}),
  };
  signal.revisions.push({ revision: signal.revision, message_id: message.id, kind: signal.kind, interaction: clone(signal.interaction), presentation: clone(signal.presentation), expires_at: signal.expires_at, continuation: clone(signal.continuation) });
  ctx.state.signals[signal.id] = signal;
  emit(ctx, 'message.created', message, conv); emit(ctx, previous ? 'signal.updated' : 'signal.created', signal, conv);
  return { conversation: conv, message, signal };
}
function withdrawSignal(ctx, expiring = false) {
  const signal = ctx.state.signals[ctx.command.signal_id];
  if (signal.state !== 'active') signalActive(signal, ctx.now);
  revision(signal, ctx.command.expected_revision);
  if (expiring && (!signal.expires_at || Date.parse(signal.expires_at) > Date.parse(ctx.now))) fail('signal_not_expired', 'Signal has not reached its deadline.', 'SOMAE-009');
  signal.state = expiring ? 'expired' : 'withdrawn'; signal.updated_at = ctx.now;
  signal.withdrawal_reason = expiring ? 'deadline_elapsed' : ctx.command.reason;
  emit(ctx, expiring ? 'signal.expired' : 'signal.withdrawn', signal, ctx.state.conversations[signal.conversation_id]);
  return { signal };
}
function submitResponse(ctx) {
  const signal = ctx.state.signals[ctx.command.signal_id];
  signalActive(signal, ctx.now); revision(signal, ctx.command.expected_revision);
  if (!signal.interaction || signal.interaction.id !== ctx.command.interaction_id) fail('interaction_invalid', 'Signal does not offer this interaction.', 'SOMAE-010');
  if (signal.continuation && Date.parse(signal.continuation.valid_until) <= Date.parse(ctx.now)) fail('continuation_unavailable', 'Continuation is no longer valid.', 'SOMAE-005', 'SOMAE-009');
  const value = validateValue(signal.interaction, ctx.command.value), conv = ctx.state.conversations[signal.conversation_id];
  const label = signal.interaction.response_type === 'text' ? value.text : signal.interaction.response_type === 'approval' ? signal.interaction.actions.find(action => action.id === value.action_id).label : canonical(value);
  const feedback = own(ctx.command, 'content') ? ctx.command.content : [];
  if (!Array.isArray(feedback)) fail('content_invalid', 'Response feedback must be an array of supported content blocks.', 'SOMAE-022');
  const message = appendMessage(ctx, conv, { content: [{ type: 'text', text: label }, ...feedback], artifact_refs: ctx.command.artifact_refs, in_reply_to_message_id: signal.message_id });
  shareContext(ctx, conv, message, ctx.command.context);
  const response = {
    id: ctx.id('response'), signal_id: signal.id, signal_revision: signal.revision, interaction_id: signal.interaction.id,
    conversation_id: conv.id, message_id: message.id, person_id: ctx.principal.person_id, origin_device_id: ctx.principal.device_id,
    submitted_at: ctx.now, value, artifact_refs: clone(message.artifact_refs), delivery_id: null,
    ...(signal.interaction.response_type === 'approval' ? { terms_digest: signal.interaction.terms_digest } : {}),
  };
  const delivery = makeDelivery(ctx, conv, message, response, signal); response.delivery_id = delivery.id;
  ctx.state.responses[response.id] = response;
  signal.state = 'answered'; signal.response_id = response.id; signal.updated_at = ctx.now;
  emit(ctx, 'message.created', message, conv); emit(ctx, 'response.submitted', response, conv); emit(ctx, 'signal.answered', signal, conv);
  return { response, message, delivery, signal };
}
function publishArtifact(ctx) {
  const command = ctx.command, conv = ctx.state.conversations[command.conversation_id];
  let id = command.artifact_id ?? ctx.id('artifact'), next = 1;
  const versions = Object.values(ctx.state.artifacts).filter(artifact => artifact.id === id);
  if (versions.length) {
    const latest = versions.reduce((a, b) => a.revision > b.revision ? a : b);
    if (latest.conversation_id !== conv.id) fail('artifact_revision_invalid', 'Artifact is scoped to another conversation.', 'SOMAE-012');
    if (command.expected_revision !== latest.revision) fail('artifact_revision_invalid', 'Artifact revision does not match.', 'SOMAE-012');
    next = latest.revision + 1;
  } else if (command.expected_revision !== undefined) fail('artifact_revision_invalid', 'Cannot revise a missing artifact.', 'SOMAE-012');
  if (!text(command.media_type) || !ontology.enums.artifact_presentation_type.includes(command.presentation_type) || !only(command.content_ref, ['uri', 'origin', 'access']) || !text(command.content_ref.uri) || !text(command.content_ref.origin) || command.content_ref.access !== 'conversation' || !/^(sha256:)?[a-f0-9]{64}$/.test(command.digest) || !Number.isInteger(command.size) || command.size < 0 || !text(command.description)) {
    fail('artifact_invalid', 'Artifact metadata requires explicit scoped access, SHA256 digest, size and fallback.', 'SOMAE-012', 'SOMAE-022');
  }
  let uri, origin;
  try { uri = new URL(command.content_ref.uri); origin = new URL(command.content_ref.origin); } catch { fail('artifact_invalid', 'Artifact references must be absolute URLs.', 'SOMAE-012'); }
  if (!['https:', 'http:', 'memory:'].includes(uri.protocol) || (uri.protocol !== 'memory:' && uri.origin !== origin.origin) || uri.username || uri.password || origin.username || origin.password) fail('artifact_invalid', 'Artifact origin must match its content reference and carry no credentials.', 'SOMAE-012');
  const artifact = {
    id, revision: next, conversation_id: conv.id, publisher: clone(ctx.principal), media_type: command.media_type,
    presentation_type: command.presentation_type, created_at: ctx.now, content_ref: clone(command.content_ref),
    digest: command.digest, size: command.size, description: command.description,
  };
  ctx.state.artifacts[refKey(id, next)] = artifact; emit(ctx, 'artifact.published', artifact, conv); return { artifact };
}
function changeConnection(ctx) {
  const connection = ctx.connection, desired = ctx.command.command.split('.')[1];
  revision(connection, ctx.command.expected_revision);
  const next = { pause: 'paused', resume: 'active', revoke: 'revoked' }[desired];
  if ((desired === 'pause' && connection.state !== 'active') || (desired === 'resume' && connection.state !== 'paused') || (desired === 'revoke' && !['active', 'paused', 'pending'].includes(connection.state))) fail('connection_transition_invalid', 'Connection state does not allow this transition.', 'SOMAE-017');
  connection.state = next; connection.revision++;
  for (const delivery of Object.values(ctx.state.deliveries).filter(value => value.connection_id === connection.id && !value.dispatched_at)) {
    if (next === 'paused' && delivery.state === 'queued') delivery.state = 'paused';
    if (next === 'active' && delivery.state === 'paused') delivery.state = 'queued';
    if (next === 'revoked' && ['queued', 'paused'].includes(delivery.state)) { delivery.state = 'revoked'; emit(ctx, 'delivery.revoked', delivery); }
  }
  if (next === 'revoked') for (const signal of Object.values(ctx.state.signals).filter(value => value.connection_id === connection.id && value.state === 'active')) {
    signal.state = 'withdrawn'; signal.withdrawal_reason = 'connection_revoked'; signal.updated_at = ctx.now;
    emit(ctx, 'signal.withdrawn', signal, ctx.state.conversations[signal.conversation_id]);
  }
  emit(ctx, 'connection.changed', connection); return { connection };
}
function dispatch(ctx) {
  const delivery = ctx.state.deliveries[ctx.command.delivery_id], endpoint = ctx.state.endpoints[delivery.endpoint_id];
  if (delivery.input_state === 'ambiguous') fail('input_outcome_unknown', 'Automatic reinjection is blocked until the adapter reconciles the unknown outcome.', 'SOMAE-018');
  if (delivery.state !== 'queued' || delivery.input_state !== 'unknown') fail('delivery_transition_invalid', 'This delivery cannot be dispatched.', 'SOMAE-016');
  if (delivery.valid_until && Date.parse(delivery.valid_until) <= Date.parse(ctx.now)) {
    delivery.state = 'expired'; emit(ctx, 'delivery.expired', delivery); return { delivery };
  }
  if (delivery.continuation) validateContinuation(ctx.state, ctx.state.conversations[delivery.conversation_id], delivery.continuation);
  if (!endpoint.online) fail('endpoint_unavailable', 'Endpoint is offline; keep delivery queued.', 'SOMAE-009');
  delivery.attempts++; delivery.dispatched_at = ctx.now;
  emit(ctx, 'delivery.dispatched', delivery, ctx.state.conversations[delivery.conversation_id]); return { delivery };
}
function receipt(ctx) {
  const delivery = ctx.state.deliveries[ctx.command.delivery_id], command = ctx.command.command;
  if (command === 'delivery.ack') {
    if (delivery.state !== 'queued' || delivery.input_state !== 'unknown') fail('delivery_transition_invalid', 'Delivery cannot receive another receipt.', 'SOMAE-016');
    delivery.state = 'received'; delivery.received_at = ctx.now;
    delivery.receipt = { endpoint_id: ctx.principal.endpoint_id, at: ctx.now, hop: 'integration' };
    emit(ctx, 'delivery.received', delivery); return { delivery };
  }
  if (delivery.input_state !== 'unknown' || !['queued', 'received'].includes(delivery.state)) fail('input_transition_invalid', 'Input outcome is already terminal or delivery invalid.', 'SOMAE-016');
  if (command === 'input.accept' && delivery.state !== 'received') fail('receipt_invalid', 'Integration receipt must precede input acceptance.', 'SOMAE-016');
  delivery.input_state = command === 'input.accept' ? 'accepted' : command === 'input.reject' ? 'rejected' : 'ambiguous';
  delivery.input_receipt = { endpoint_id: ctx.principal.endpoint_id, at: ctx.now, hop: 'agent_input', reason: ctx.command.reason ?? null };
  if (delivery.input_state === 'rejected') delivery.state = 'failed';
  emit(ctx, command === 'input.unknown' ? 'input.outcome_unknown' : command === 'input.accept' ? 'input.accepted' : 'input.rejected', delivery);
  return { delivery };
}
function markInbox(ctx) {
  const key = `${ctx.principal.person_id}:${ctx.command.signal_id}`;
  if (!['read', 'set_aside'].some(field => own(ctx.command, field)) || ['read', 'set_aside'].some(field => own(ctx.command, field) && typeof ctx.command[field] !== 'boolean')) fail('command_invalid', 'View changes require boolean read/set_aside values.', 'SOMAE-019');
  const view = ctx.state.inbox_views[key] ?? { person_id: ctx.principal.person_id, signal_id: ctx.command.signal_id, read: false, set_aside: false };
  for (const field of ['read', 'set_aside']) if (own(ctx.command, field)) view[field] = ctx.command[field];
  ctx.state.inbox_views[key] = view; emit(ctx, 'inbox.changed', { id: ctx.command.signal_id }); return { view };
}
function apply(ctx) {
  switch (ctx.command.command) {
    case 'message.submit': case 'message.publish': return publishMessage(ctx);
    case 'signal.publish': return publishSignal(ctx);
    case 'signal.update': return publishSignal(ctx, true);
    case 'signal.withdraw': return withdrawSignal(ctx);
    case 'signal.expire': return withdrawSignal(ctx, true);
    case 'response.submit': return submitResponse(ctx);
    case 'artifact.publish': return publishArtifact(ctx);
    case 'connection.pause': case 'connection.resume': case 'connection.revoke': return changeConnection(ctx);
    case 'delivery.dispatch': return dispatch(ctx);
    case 'delivery.ack': case 'input.accept': case 'input.reject': case 'input.unknown': return receipt(ctx);
    case 'inbox.mark': return markInbox(ctx);
    case 'endpoint.set_availability': {
      if (typeof ctx.command.online !== 'boolean') fail('command_invalid', 'online must be boolean.', 'SOMAE-022');
      const endpoint = ctx.state.endpoints[ctx.command.endpoint_id]; endpoint.online = ctx.command.online; emit(ctx, 'endpoint.availability_changed', endpoint); return { endpoint };
    }
    case 'conversation.bind': {
      const conv = ctx.state.conversations[ctx.command.conversation_id], binding = { session_id: ctx.command.session_id, workspace_id: ctx.command.workspace_id };
      if (conv.continuity && !same(conv.continuity, binding)) fail('continuation_unavailable', 'A conversation cannot silently move to another session or workspace.', 'SOMAE-005');
      conv.continuity = binding; emit(ctx, 'conversation.bound', conv, conv); return { conversation: conv };
    }
    default: fail('command_unsupported', 'Unsupported domain command.', 'SOMAE-022');
  }
}

// A host-only relational audit, not a substitute for authenticating storage or users.
export function verifyState(state) {
  try { return auditState(state); }
  catch { return [{ message: 'Malformed nested state record.', ruleIds: ['SOMAE-021'] }]; }
}
function auditState(state) {
  const violations = [], add = (message, ruleIds = ['SOMAE-021']) => violations.push({ message, ruleIds });
  if (!plain(state) || state.protocol_version !== '0.1' || COLLECTIONS.some(key => !plain(state[key])) || !Array.isArray(state.events) || !json(state)) { add('State has invalid shape.'); return violations; }
  if (COLLECTIONS.some(key => Object.values(state[key]).some(value => !plain(value))) || state.events.some(event => !plain(event))) { add('State records must be plain JSON objects.'); return violations; }
  const requireMapIds = key => { for (const [id, value] of Object.entries(state[key])) if (!plain(value) || value.id !== id || !text(id)) add(`${key} map identity mismatch.`); };
  for (const key of ['persons', 'devices', 'endpoints', 'connections', 'conversations', 'messages', 'signals', 'responses', 'context_snapshots', 'deliveries']) requireMapIds(key);
  for (const person of Object.values(state.persons)) if (!text(person.handle)) add('Person requires a handle.');
  for (const device of Object.values(state.devices)) if (!state.persons[device.person_id] || !text(device.machine_id) || !ontology.enums.device_kind.includes(device.kind) || !['active', 'revoked'].includes(device.state)) add('Invalid device relationship/state.');
  const capList = value => Array.isArray(value) && new Set(value).size === value.length && value.every(cap => CAPABILITIES.includes(cap));
  for (const endpoint of Object.values(state.endpoints)) {
    if (!ontology.enums.hosting.includes(endpoint.hosting) || !ontology.enums.execution.includes(endpoint.execution) || !capList(endpoint.capabilities) || typeof endpoint.online !== 'boolean' || typeof endpoint.durable_delivery !== 'boolean' || !text(endpoint.agent_id) || !Array.isArray(endpoint.interaction_types) || endpoint.interaction_types.some(type => !ontology.enums.interaction_type.includes(type)) || !Array.isArray(endpoint.receive_media_types) || !endpoint.receive_media_types.every(text) || !Number.isInteger(endpoint.max_artifact_bytes) || endpoint.max_artifact_bytes < 0) add('Invalid endpoint capabilities or properties.');
    if (endpoint.hosting === 'local' && (!text(endpoint.machine_id) || !Object.values(state.devices).some(device => device.machine_id === endpoint.machine_id))) add('Local endpoint has no registered machine binding.');
  }
  for (const connection of Object.values(state.connections)) {
    const endpoint = state.endpoints[connection.endpoint_id];
    if (!state.persons[connection.person_id] || !endpoint || endpoint.agent_id !== connection.agent_id || !ontology.enums.connection_state.includes(connection.state) || !positive(connection.revision) || !iso(connection.created_at) || !capList(connection.permissions) || !capList(connection.capabilities)) add('Invalid connection identity, grant or relationship.');
    if (endpoint?.hosting === 'local' && (connection.machine_id !== endpoint.machine_id || !Object.values(state.devices).some(device => device.person_id === connection.person_id && device.machine_id === endpoint.machine_id))) add('Local connection machine is not registered to its person.');
  }
  for (const conv of Object.values(state.conversations)) {
    const connection = state.connections[conv.connection_id];
    if (!connection || connection.endpoint_id !== conv.endpoint_id || connection.person_id !== conv.person_id || !text(conv.title) || !Number.isInteger(conv.sequence) || conv.sequence < 0 || !iso(conv.created_at)) add('Invalid conversation destination/sequence.');
    if (conv.continuity !== null && (!only(conv.continuity, ['session_id', 'workspace_id']) || !Object.values(conv.continuity).every(text))) add('Invalid conversation continuity.');
    const messages = Object.values(state.messages).filter(message => message.conversation_id === conv.id).sort((a, b) => a.sequence - b.sequence);
    if (messages.length !== conv.sequence || messages.some((message, index) => message.sequence !== index + 1)) add('Conversation timeline is not contiguous.');
  }
  for (const message of Object.values(state.messages)) {
    const conv = state.conversations[message.conversation_id];
    if (!conv || !positive(message.sequence) || !iso(message.created_at)) { add('Invalid message relationship.'); continue; }
    const connection = state.connections[conv.connection_id];
    if (message.author?.kind === 'person') {
      if (message.author.person_id !== conv.person_id || state.devices[message.author.device_id]?.person_id !== conv.person_id) add('Message has invalid person author.');
    } else if (message.author?.kind !== 'endpoint' || message.author.endpoint_id !== conv.endpoint_id) add('Message has invalid endpoint author.');
    if (message.author?.kind === 'person' && Object.values(state.deliveries).filter(delivery => delivery.message_id === message.id).length !== 1) add('Every submitted person message requires exactly one outbox record.', ['SOMAE-014', 'SOMAE-021']);
    try {
      content(message.content); artifactRefs(state, conv, message.artifact_refs);
      if (message.content.some(block => block.type === 'artifact' && !message.artifact_refs.some(ref => block.artifact_id === ref.artifact_id && block.revision === ref.revision))) throw new Error();
    } catch { add('Message content or explicit artifact pins invalid.'); }
    if (message.in_reply_to_message_id && (state.messages[message.in_reply_to_message_id]?.conversation_id !== conv.id || state.messages[message.in_reply_to_message_id].sequence >= message.sequence)) add('Message reply reference is invalid.');
    if (!Array.isArray(message.context_snapshot_refs)) add('Message context references invalid.');
    else for (const ref of message.context_snapshot_refs) {
      const snapshot = state.context_snapshots[ref.snapshot_id];
      if (!plain(ref) || !snapshot || snapshot.revision !== ref.revision || snapshot.conversation_id !== conv.id || snapshot.audience?.endpoint_id !== connection?.endpoint_id || message.author?.kind !== 'person') add('Message context audience/revision invalid.', ['SOMAE-013', 'SOMAE-021']);
    }
  }
  for (const [key, artifact] of Object.entries(state.artifacts)) {
    const conv = state.conversations[artifact.conversation_id];
    if (key !== refKey(artifact.id, artifact.revision) || !conv || artifact.publisher?.kind !== 'endpoint' || artifact.publisher.endpoint_id !== conv.endpoint_id || !positive(artifact.revision) || !iso(artifact.created_at) || !text(artifact.media_type) || !text(artifact.description) || !/^(sha256:)?[a-f0-9]{64}$/.test(artifact.digest) || !Number.isInteger(artifact.size) || artifact.size < 0 || artifact.content_ref?.access !== 'conversation') add('Invalid artifact identity/version/publisher metadata.', ['SOMAE-012', 'SOMAE-021']);
    if (!ontology.enums.artifact_presentation_type.includes(artifact.presentation_type) || !only(artifact.content_ref, ['uri', 'origin', 'access'])) add('Invalid artifact presentation or content access policy.');
    try {
      const uri = new URL(artifact.content_ref.uri), origin = new URL(artifact.content_ref.origin);
      if (!['https:', 'http:', 'memory:'].includes(uri.protocol) || (uri.protocol !== 'memory:' && uri.origin !== origin.origin) || uri.username || uri.password || origin.username || origin.password) add('Invalid artifact URI or declared origin.');
    } catch { add('Invalid artifact URI or declared origin.'); }
    const revisions = Object.values(state.artifacts).filter(version => version.id === artifact.id).sort((a, b) => a.revision - b.revision);
    if (revisions.some((version, index) => version.revision !== index + 1 || version.conversation_id !== artifact.conversation_id)) add('Artifact revision history is not contiguous and scoped.');
  }
  for (const snapshot of Object.values(state.context_snapshots)) {
    const conv = state.conversations[snapshot.conversation_id];
    if (!conv || snapshot.person_id !== conv.person_id || snapshot.audience?.endpoint_id !== conv.endpoint_id || snapshot.audience?.connection_id !== conv.connection_id || snapshot.consent !== true || !text(snapshot.purpose) || !positive(snapshot.revision) || !iso(snapshot.created_at) || !plain(snapshot.value)) add('Invalid consented context snapshot.', ['SOMAE-013', 'SOMAE-021']);
  }
  for (const signal of Object.values(state.signals)) {
    const conv = state.conversations[signal.conversation_id], message = state.messages[signal.message_id];
    if (!conv || signal.connection_id !== conv.connection_id || !message || message.conversation_id !== conv.id || message.author.kind !== 'endpoint' || !ontology.enums.signal_kind.includes(signal.kind) || !ontology.enums.signal_state.includes(signal.state) || !positive(signal.revision) || !iso(signal.created_at) || !iso(signal.updated_at) || !Array.isArray(signal.revisions) || signal.revisions.length !== signal.revision) { add('Invalid signal identity/version/relationship.'); continue; }
    if ((signal.state === 'answered') !== Boolean(signal.response_id)) add('Answered signal requires exactly one response.', ['SOMAE-008', 'SOMAE-021']);
    if (signal.response_id && state.responses[signal.response_id]?.signal_id !== signal.id) add('Signal response relationship invalid.');
    if (signal.state === 'expired' && !iso(signal.expires_at)) add('Expired signal has no deadline.');
    if (signal.expires_at !== null && !iso(signal.expires_at)) add('Invalid signal expiry.');
    for (let index = 0; index < signal.revisions.length; index++) {
      const version = signal.revisions[index];
      if (!plain(version)) { add('Signal revision must be a plain record.'); continue; }
      const versionMessage = state.messages[version.message_id];
      if (version.revision !== index + 1 || !versionMessage || versionMessage.conversation_id !== conv.id || versionMessage.author.kind !== 'endpoint') { add('Invalid signal historical revision.'); continue; }
      try {
        const interaction = version.interaction ? { ...version.interaction } : null;
        if (interaction) delete interaction.terms_digest;
        // Historical support may have changed; validate native structure without requiring current grant.
        const audit = clone(state); audit.connections[conv.connection_id].permissions = [...CAPABILITIES]; audit.connections[conv.connection_id].capabilities = [...CAPABILITIES]; audit.endpoints[conv.endpoint_id].capabilities = [...CAPABILITIES]; audit.endpoints[conv.endpoint_id].interaction_types = [...ontology.enums.interaction_type];
        const normalized = normalizeInteraction(audit, conv, version.kind, interaction, versionMessage.artifact_refs);
        if (!same(normalized, version.interaction)) add('Historical interaction terms do not match canonical pins.');
        if (version.continuation) validateContinuation(state, conv, version.continuation);
        if (!only(version.presentation, ['type'], ['artifact_id', 'artifact_revision']) || !ontology.enums.presentation_type.includes(version.presentation.type)) add('Unsupported historical signal presentation.');
        if (own(version.presentation, 'artifact_id') || own(version.presentation, 'artifact_revision')) {
          if (!text(version.presentation.artifact_id) || !positive(version.presentation.artifact_revision) || !versionMessage.artifact_refs.some(ref => ref.artifact_id === version.presentation.artifact_id && ref.revision === version.presentation.artifact_revision)) add('Historical presentation artifact pin is invalid.');
        }
        if (version.presentation.type === 'artifact' && !version.presentation.artifact_id) add('Historical artifact presentation has no artifact.');
      } catch { add('Signal interaction or continuation is invalid.'); }
    }
    const latest = signal.revisions.at(-1);
    if (!same(latest, { revision: signal.revision, message_id: signal.message_id, kind: signal.kind, interaction: signal.interaction, presentation: signal.presentation, expires_at: signal.expires_at, continuation: signal.continuation })) add('Current signal does not match its latest immutable revision.');
  }
  const answered = new Set();
  for (const response of Object.values(state.responses)) {
    const signal = state.signals[response.signal_id], conv = state.conversations[response.conversation_id], message = state.messages[response.message_id], delivery = state.deliveries[response.delivery_id];
    if (!signal || !conv || !message || !delivery || signal.conversation_id !== conv.id || signal.state !== 'answered' || signal.response_id !== response.id || response.signal_revision !== signal.revision || response.person_id !== conv.person_id || state.devices[response.origin_device_id]?.person_id !== conv.person_id || message.conversation_id !== conv.id || message.author.kind !== 'person' || message.author.device_id !== response.origin_device_id || delivery.response_id !== response.id || delivery.message_id !== message.id || !iso(response.submitted_at) || answered.has(signal.id)) { add('Response, answered signal, message and outbox are not atomic.', ['SOMAE-014', 'SOMAE-021']); continue; }
    answered.add(signal.id);
    try {
      if (response.interaction_id !== signal.interaction?.id) throw new Error();
      validateValue(signal.interaction, response.value);
      if (!same(response.artifact_refs, message.artifact_refs)) throw new Error();
      if (signal.interaction.response_type === 'approval' && response.terms_digest !== signal.interaction.terms_digest) throw new Error();
    } catch { add('Accepted response has invalid interaction/value or pinned approval terms.'); }
  }
  for (const delivery of Object.values(state.deliveries)) {
    const conv = state.conversations[delivery.conversation_id], message = state.messages[delivery.message_id];
    if (!conv || !message || message.author.kind !== 'person' || message.conversation_id !== conv.id || delivery.connection_id !== conv.connection_id || delivery.endpoint_id !== conv.endpoint_id || !ontology.enums.delivery_state.includes(delivery.state) || !ontology.enums.input_state.includes(delivery.input_state) || !Number.isInteger(delivery.attempts) || delivery.attempts < 0 || !iso(delivery.created_at) || (delivery.valid_until !== null && !iso(delivery.valid_until)) || (delivery.dispatched_at !== null && !iso(delivery.dispatched_at))) add('Delivery relationship, state or validity is invalid.');
    if ((delivery.attempts > 0) !== Boolean(delivery.dispatched_at)) add('Delivery attempts do not match dispatch history.');
    if ((delivery.state === 'received' || ['accepted', 'rejected', 'ambiguous'].includes(delivery.input_state)) && !delivery.dispatched_at) add('Receipt requires a prior dispatch.', ['SOMAE-016', 'SOMAE-021']);
    if (delivery.input_state === 'accepted' && (delivery.state !== 'received' || !delivery.received_at)) add('Input acceptance requires integration receipt.');
    if (delivery.input_state === 'rejected' && delivery.state !== 'failed') add('Rejected input requires failed delivery.');
    if (delivery.response_id && state.responses[delivery.response_id]?.delivery_id !== delivery.id) add('Delivery response relationship is invalid.');
    if (delivery.response_id) {
      const response = state.responses[delivery.response_id], signal = response ? state.signals[response.signal_id] : null;
      const validity = [signal?.expires_at, signal?.continuation?.valid_until].filter(Boolean);
      const deadline = validity.length ? validity.reduce((a, b) => Date.parse(a) < Date.parse(b) ? a : b) : null;
      if (!signal || delivery.signal_revision !== response.signal_revision || !same(delivery.continuation, signal.continuation) || delivery.valid_until !== deadline) add('Response delivery must preserve exact revision, continuation and expiry pins.', ['SOMAE-005', 'SOMAE-009', 'SOMAE-014', 'SOMAE-021']);
    } else if (delivery.continuation !== null || delivery.signal_revision !== null || delivery.valid_until !== null) add('Unsolicited message delivery must not invent signal continuation pins.');
    if (delivery.received_at !== null) {
      if (!iso(delivery.received_at) || !only(delivery.receipt, ['endpoint_id', 'at', 'hop']) || delivery.receipt.endpoint_id !== delivery.endpoint_id || delivery.receipt.at !== delivery.received_at || delivery.receipt.hop !== 'integration' || Date.parse(delivery.received_at) < Date.parse(delivery.dispatched_at)) add('Integration receipt provenance or timestamp is invalid.', ['SOMAE-016', 'SOMAE-021']);
    } else if (delivery.receipt !== undefined) add('Integration receipt has no received timestamp.');
    if (delivery.input_state !== 'unknown') {
      if (!only(delivery.input_receipt, ['endpoint_id', 'at', 'hop', 'reason']) || delivery.input_receipt.endpoint_id !== delivery.endpoint_id || !iso(delivery.input_receipt.at) || delivery.input_receipt.hop !== 'agent_input' || Date.parse(delivery.input_receipt.at) < Date.parse(delivery.dispatched_at) || (delivery.input_state !== 'accepted' && !text(delivery.input_receipt.reason))) add('Input receipt provenance or outcome is invalid.', ['SOMAE-016', 'SOMAE-021']);
    } else if (delivery.input_receipt !== null) add('Unknown input state cannot contain an application receipt.');
    if (delivery.continuation && conv) try { validateContinuation(state, conv, delivery.continuation); } catch { add('Delivery continuation is not bound to its conversation.'); }
  }
  for (const [key, view] of Object.entries(state.inbox_views)) if (key !== `${view.person_id}:${view.signal_id}` || state.signals[view.signal_id]?.connection_id === undefined || state.connections[state.signals[view.signal_id].connection_id]?.person_id !== view.person_id || typeof view.read !== 'boolean' || typeof view.set_aside !== 'boolean') add('Invalid person-owned inbox view.', ['SOMAE-019', 'SOMAE-021']);
  const eventIds = new Set();
  for (const [index, event] of state.events.entries()) {
    if (!text(event.id) || eventIds.has(event.id) || event.cursor !== index + 1 || event.protocol_version !== '0.1' || !text(event.type) || !iso(event.timestamp) || !['person', 'endpoint', 'system'].includes(event.source?.kind) || !text(event.causation?.command) || !text(event.causation?.idempotency_key)) add('Audit event identity/order/provenance invalid.', ['SOMAE-020', 'SOMAE-021']);
    eventIds.add(event.id);
    const conv = event.conversation_id ? state.conversations[event.conversation_id] : null;
    const connection = conv ? state.connections[conv.connection_id] : state.connections[event.entity_id];
    if (!plain(event.audience) || (connection && (event.audience.person_id !== connection.person_id || event.audience.endpoint_id !== connection.endpoint_id))) add('Audit event audience does not match its canonical destination.', ['SOMAE-020', 'SOMAE-021']);
    if (event.source?.kind === 'person') {
      if (!own(state.persons, event.source.person_id) || state.devices[event.source.device_id]?.person_id !== event.source.person_id || (connection && event.source.person_id !== connection.person_id)) add('Audit event person provenance invalid.', ['SOMAE-020', 'SOMAE-021']);
    } else if (event.source?.kind === 'endpoint' && (!own(state.endpoints, event.source.endpoint_id) || (connection && event.source.endpoint_id !== connection.endpoint_id))) add('Audit event endpoint provenance invalid.', ['SOMAE-020', 'SOMAE-021']);
    if (event.conversation_id && !conv) add('Audit event references a missing conversation.', ['SOMAE-020', 'SOMAE-021']);
  }
  for (const [key, cached] of Object.entries(state.idempotency)) {
    try {
      const actor = cached.actor;
      if (!plain(actor) || !['person', 'endpoint', 'system'].includes(actor.kind) || (actor.kind === 'person' && (!only(actor, ['kind', 'person_id']) || !own(state.persons, actor.person_id))) || (actor.kind === 'endpoint' && (!only(actor, ['kind', 'endpoint_id']) || !own(state.endpoints, actor.endpoint_id))) || (actor.kind === 'system' && !only(actor, ['kind']))) throw new Error();
      validateCommand(cached.payload);
      if (key !== canonical([actor, cached.command, cached.key]) || cached.command !== cached.payload.command || cached.key !== cached.payload.idempotency_key || cached.payload_digest !== digest(cached.payload) || !iso(cached.created_at) || !plain(cached.result)) throw new Error();
      const results = {
        'message.submit': ['conversation', 'message', 'delivery'], 'message.publish': ['conversation', 'message'],
        'signal.publish': ['conversation', 'message', 'signal'], 'signal.update': ['conversation', 'message', 'signal'],
        'signal.withdraw': ['signal'], 'signal.expire': ['signal'], 'response.submit': ['response', 'message', 'delivery', 'signal'],
        'artifact.publish': ['artifact'], 'connection.pause': ['connection'], 'connection.resume': ['connection'], 'connection.revoke': ['connection'],
        'conversation.bind': ['conversation'], 'delivery.dispatch': ['delivery'], 'delivery.ack': ['delivery'], 'input.accept': ['delivery'], 'input.reject': ['delivery'], 'input.unknown': ['delivery'],
        'endpoint.set_availability': ['endpoint'], 'inbox.mark': ['view'],
      };
      if (!only(cached.result, results[cached.command])) throw new Error();
      for (const [name, value] of Object.entries(cached.result)) {
        if (!plain(value)) throw new Error();
        if (name === 'view') {
          if (!only(value, ['person_id', 'signal_id', 'read', 'set_aside']) || actor.person_id !== value.person_id || !state.signals[value.signal_id]) throw new Error();
          continue;
        }
        const collection = { conversation: 'conversations', message: 'messages', signal: 'signals', response: 'responses', artifact: 'artifacts', connection: 'connections', delivery: 'deliveries', endpoint: 'endpoints' }[name];
        const current = state[collection][name === 'artifact' ? refKey(value.id, value.revision) : value.id];
        if (!current || Object.keys(value).some(field => !own(current, field))) throw new Error();
        const conv = name === 'conversation' ? current : current.conversation_id ? state.conversations[current.conversation_id] : null;
        const grant = name === 'connection' ? current : conv ? state.connections[conv.connection_id] : current.connection_id ? state.connections[current.connection_id] : null;
        if (actor.kind === 'person' && grant?.person_id !== actor.person_id) throw new Error();
        if (actor.kind === 'endpoint' && grant?.endpoint_id !== actor.endpoint_id) throw new Error();
        if (['message', 'response', 'artifact'].includes(name) && !same(value, current)) throw new Error();
        for (const field of ['connection_id', 'endpoint_id', 'person_id', 'conversation_id', 'message_id', 'response_id', 'valid_until', 'signal_revision']) {
          if (name === 'signal' && ['message_id', 'response_id'].includes(field)) continue;
          if (own(value, field) && !same(value[field], current[field])) throw new Error();
        }
        if (name === 'signal') {
          const version = current.revisions[value.revision - 1];
          if (!version || value.message_id !== version.message_id || !same(value.interaction, version.interaction) || !same(value.presentation, version.presentation) || !same(value.continuation, version.continuation)) throw new Error();
        }
      }
      if (!state.events.some(event => event.causation.command === cached.command && event.causation.idempotency_key === cached.key && (actor.kind === 'system' ? event.source.kind === 'system' : actor.kind === 'person' ? event.source.person_id === actor.person_id : event.source.endpoint_id === actor.endpoint_id))) throw new Error();
    } catch { add('Idempotency cache identity, payload or scoped result is invalid.', ['SOMAE-015', 'SOMAE-021']); }
  }
  return violations;
}
function assertEvolution(before, after) {
  for (const key of ['messages', 'responses', 'artifacts', 'context_snapshots', 'idempotency']) for (const [id, value] of Object.entries(before[key])) if (!same(value, after[key][id])) fail('invariant_violation', `Immutable ${key} changed.`, 'SOMAE-006');
  if (!same(before.events, after.events.slice(0, before.events.length))) fail('invariant_violation', 'Immutable audit events changed.', 'SOMAE-020');
  for (const signal of Object.values(before.signals)) {
    const next = after.signals[signal.id];
    if (!next || !same(signal.revisions, next.revisions.slice(0, signal.revisions.length)) || next.revision < signal.revision || (signal.state !== 'active' && !same(signal, next))) fail('invariant_violation', 'Signal history or terminal lifecycle changed.', 'SOMAE-006', 'SOMAE-008');
  }
  for (const conv of Object.values(before.conversations)) {
    const next = after.conversations[conv.id];
    if (!next || conv.person_id !== next.person_id || conv.connection_id !== next.connection_id || conv.endpoint_id !== next.endpoint_id || (conv.continuity && !same(conv.continuity, next.continuity))) fail('invariant_violation', 'Conversation destination changed.', 'SOMAE-005', 'SOMAE-021');
  }
  for (const delivery of Object.values(before.deliveries)) {
    const next = after.deliveries[delivery.id];
    if (!next || (delivery.input_state !== 'unknown' && delivery.input_state !== next.input_state) || (['failed', 'expired', 'revoked'].includes(delivery.state) && delivery.state !== next.state)) fail('invariant_violation', 'Delivery terminal outcome changed.', 'SOMAE-016');
  }
}

/** Synchronous in-memory serialized reference boundary. snapshot is INTERNAL HOST DATA. */
export function createRuntime({ seed = emptyState(), clock = () => new Date(), idFactory = prefix => `${prefix}_${randomUUID()}` } = {}) {
  const initial = verifyState(seed);
  if (initial.length) throw new DomainError('seed_invalid', initial.map(item => item.message).join(' '), ['SOMAE-021']);
  let state = clone(seed);
  if (typeof clock !== 'function' || typeof idFactory !== 'function') throw new TypeError('clock and idFactory must be functions.');
  return Object.freeze({
    snapshot: () => clone(state),
    execute(commandInput, principalInput) {
      validateCommand(commandInput);
      const command = clone(commandInput), principal = clone(principalInput);
      const connection = authorize(state, command, principal);
      const actor = principal.kind === 'person' ? { kind: 'person', person_id: principal.person_id } : principal.kind === 'endpoint' ? { kind: 'endpoint', endpoint_id: principal.endpoint_id } : { kind: 'system' };
      const key = canonical([actor, command.command, command.idempotency_key]);
      const hash = digest(command), previous = state.idempotency[key];
      if (previous) {
        if (previous.payload_digest !== hash) fail('idempotency_conflict', 'Idempotency key was already used for different content.', 'SOMAE-015');
        return clone(previous.result);
      }
      const value = clock(), now = value instanceof Date ? value.toISOString() : value;
      if (!iso(now)) throw new TypeError('clock must return a valid Date or ISO timestamp.');
      if (state.events.length && Date.parse(now) < Date.parse(state.events.at(-1).timestamp)) fail('clock_invalid', 'Authority timestamps cannot move backwards.', 'SOMAE-020');
      const candidate = clone(state), reserved = new Set([
        ...COLLECTIONS.filter(name => !['idempotency', 'inbox_views'].includes(name)).flatMap(name => Object.values(candidate[name]).map(entity => entity.id)),
        ...candidate.events.map(event => event.id),
      ]);
      const id = prefix => {
        const generated = idFactory(prefix);
        if (!text(generated) || ['__proto__', 'constructor', 'prototype'].includes(generated) || reserved.has(generated)) fail('id_invalid', 'ID factory must return a unique nonempty ID.', 'SOMAE-021');
        reserved.add(generated); return generated;
      };
      const result = apply({ state: candidate, command, principal, now, id, connection: connection ? candidate.connections[connection.id] : null });
      candidate.idempotency[key] = { actor: clone(actor), command: command.command, key: command.idempotency_key, payload: clone(command), payload_digest: hash, result: clone(result), created_at: now };
      assertEvolution(state, candidate);
      const violations = verifyState(candidate);
      if (violations.length) throw new DomainError('invariant_violation', violations.map(item => item.message).join(' '), ['SOMAE-021']);
      state = candidate;
      return clone(result);
    },
  });
}
