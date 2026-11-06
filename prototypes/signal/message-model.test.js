import test from 'node:test';
import assert from 'node:assert/strict';
import { demoDevices, messageEndpoints, getMessageAvailability } from './message-model.js';

const macbook = demoDevices.find(device => device.id === 'macbook');
const iphone = demoDevices.find(device => device.id === 'iphone');
const endpoint = id => messageEndpoints.find(agent => agent.id === id);

test('a ready local runner can receive a new message only from its own desktop', () => {
  assert.equal(getMessageAvailability(endpoint('codex-macbook'), { device: macbook }).allowed, true);
  assert.equal(getMessageAvailability(endpoint('codex-studio'), {
    device: { id: 'studio', kind: 'desktop', name: 'Studio' }
  }).allowed, true);
});

test('a local runner on another computer stays blocked when online, offline, or paused', () => {
  const studio = endpoint('codex-studio');
  const online = getMessageAvailability(studio, { device: macbook });
  assert.equal(online.allowed, false);
  assert.equal(online.label, 'On Studio only');
  assert.match(online.reason, /Being online does not make it a hosted agent/);
  assert.deepEqual(getMessageAvailability({ ...studio, available: false }, { device: macbook }), online);
  assert.deepEqual(getMessageAvailability(studio, { device: macbook, paused: ['Codex'] }), online);
});

test('mobile cannot message any local runner, even one falsely associated with its device ID', () => {
  for (const local of messageEndpoints.filter(agent => agent.host === 'local')) {
    const result = getMessageAvailability(local, { device: iphone });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /same computer/);
    assert.deepEqual(getMessageAvailability({ ...local, available: false }, { device: iphone }), result);
  }
  assert.equal(getMessageAvailability({ ...endpoint('codex-macbook'), deviceId: 'iphone' }, { device: iphone }).allowed, false);
});

test('connected hosted agents with a message grant work on both desktop and mobile', () => {
  for (const id of ['claude-hosted', 'chatgpt-hosted']) {
    for (const device of [macbook, iphone, 'macbook', 'iphone']) {
      assert.equal(getMessageAvailability(endpoint(id), { device }).allowed, true);
    }
  }
});

test('paused access blocks new messages to hosted and same-machine local agents by sender or endpoint', () => {
  for (const id of ['claude-hosted', 'codex-macbook']) {
    const agent = endpoint(id);
    for (const paused of [[agent.name], [agent.id], new Set([agent.id])]) {
      const result = getMessageAvailability(agent, { device: macbook, paused });
      assert.equal(result.allowed, false);
      assert.equal(result.label, 'Paused');
    }
  }
});

test('unavailable hosted services and local runners cannot receive new messages', () => {
  for (const agent of [endpoint('daylight-hosted'), { ...endpoint('codex-macbook'), available: false }]) {
    const result = getMessageAvailability(agent, { device: macbook });
    assert.equal(result.allowed, false);
    assert.equal(result.label, 'Unavailable');
  }
});

test('incoming permission is distinct from permission to send new messages', () => {
  for (const device of [macbook, iphone]) {
    const result = getMessageAvailability(endpoint('orbit-incoming'), { device });
    assert.equal(result.allowed, false);
    assert.equal(result.label, 'Incoming only');
    assert.match(result.reason, /does not grant permission/);
  }
});

test('a disconnected endpoint cannot use an otherwise valid message grant', () => {
  const result = getMessageAvailability({ ...endpoint('claude-hosted'), connected: false }, { device: macbook });
  assert.equal(result.allowed, false);
  assert.equal(result.label, 'Not connected');
});

test('unknown devices and unsupported endpoints fail closed', () => {
  assert.equal(getMessageAvailability(endpoint('claude-hosted')).allowed, false);
  assert.equal(getMessageAvailability(endpoint('claude-hosted'), { device: 'missing' }).allowed, false);
  assert.equal(getMessageAvailability(undefined, { device: macbook }).allowed, false);
  assert.equal(getMessageAvailability({ host: 'relay' }, { device: macbook }).allowed, false);
  assert.equal(getMessageAvailability({ ...endpoint('codex-macbook'), deviceId: undefined }, { device: macbook }).allowed, false);
});
