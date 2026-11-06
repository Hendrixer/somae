import { CAPABILITIES, emptyState } from './index.js';

/** Trusted seed fixtures. These are reference integrations, not provider adapters. */
export function createFixture(kind, { online = true } = {}) {
  const types = {
    local_coding: { hosting: 'local', execution: 'turn_based', machine_id: 'machine_1' },
    hosted_coding: { hosting: 'hosted', execution: 'turn_based' },
    custom_turn_based: { hosting: 'hosted', execution: 'turn_based' },
    custom_durable: { hosting: 'hosted', execution: 'durable' },
  };
  if (!types[kind]) throw new TypeError(`Unknown fixture: ${kind}`);
  const seed = emptyState();
  seed.persons.person_1 = { id: 'person_1', handle: '@scott' };
  seed.persons.person_2 = { id: 'person_2', handle: '@other' };
  seed.devices.desktop_1 = { id: 'desktop_1', person_id: 'person_1', kind: 'desktop', machine_id: 'machine_1', state: 'active' };
  seed.devices.mobile_1 = { id: 'mobile_1', person_id: 'person_1', kind: 'mobile', machine_id: 'phone_1', state: 'active' };
  seed.devices.desktop_2 = { id: 'desktop_2', person_id: 'person_2', kind: 'desktop', machine_id: 'machine_2', state: 'active' };
  seed.endpoints.endpoint_1 = {
    id: 'endpoint_1', agent_id: 'agent_1', ...types[kind], online,
    durable_delivery: true, capabilities: [...CAPABILITIES],
    interaction_types: ['text', 'single_choice', 'multiple_choice', 'form', 'approval'],
    receive_media_types: ['text/plain', 'application/json', 'text/html', 'image/png'],
    max_artifact_bytes: 10485760,
  };
  seed.connections.connection_1 = {
    id: 'connection_1', person_id: 'person_1', agent_id: 'agent_1', endpoint_id: 'endpoint_1',
    state: 'active', permissions: [...CAPABILITIES], capabilities: [...CAPABILITIES],
    created_at: '2026-10-11T00:00:00.000Z', revision: 1,
    ...(kind === 'local_coding' ? { machine_id: 'machine_1' } : {}),
  };
  seed.conversations.conversation_1 = {
    id: 'conversation_1', person_id: 'person_1', connection_id: 'connection_1', endpoint_id: 'endpoint_1',
    created_at: '2026-10-11T00:00:00.000Z', title: 'Reference conversation', sequence: 0,
    continuity: { session_id: 'session_1', workspace_id: 'workspace_1' },
  };
  const desktop = { kind: 'person', person_id: 'person_1', device_id: 'desktop_1' };
  return {
    seed, person: { ...desktop }, desktop, mobile: { kind: 'person', person_id: 'person_1', device_id: 'mobile_1' },
    other_person: { kind: 'person', person_id: 'person_2', device_id: 'desktop_2' },
    agent: { kind: 'endpoint', endpoint_id: 'endpoint_1' },
    connection_id: 'connection_1', endpoint_id: 'endpoint_1', conversation_id: 'conversation_1',
  };
}
