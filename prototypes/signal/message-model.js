// These endpoints are fixtures. Availability describes the prototype's rules;
// it does not discover runners, contact services, or send a message.
export const demoDevices = Object.freeze([
  Object.freeze({ id: 'macbook', name: 'MacBook', kind: 'desktop' }),
  Object.freeze({ id: 'iphone', name: 'iPhone', kind: 'mobile' })
]);

export const defaultMessageDeviceId = 'macbook';

export const messageEndpoints = Object.freeze([
  Object.freeze({
    id: 'claude-hosted', name: 'Claude', host: 'hosted',
    locationLabel: 'Hosted', available: true, connected: true, canReceiveMessages: true,
    description: 'A connected hosted agent for writing, research, and creative work.',
    project: 'Somae launch'
  }),
  Object.freeze({
    id: 'chatgpt-hosted', name: 'ChatGPT', host: 'hosted',
    locationLabel: 'Hosted', available: true, connected: true, canReceiveMessages: true,
    description: 'A connected hosted agent for planning and exploring ideas.',
    project: 'Japan trip'
  }),
  Object.freeze({
    id: 'codex-macbook', name: 'Codex', host: 'local', deviceId: 'macbook',
    locationLabel: 'MacBook', available: true, connected: true, canReceiveMessages: true,
    description: 'A local runner on your MacBook, with access to its project.',
    project: 'somae'
  }),
  Object.freeze({
    id: 'codex-studio', name: 'Codex', host: 'local', deviceId: 'studio',
    locationLabel: 'Studio', available: true, connected: true, canReceiveMessages: true,
    description: 'An online local runner on Studio. Send it a message from Somae on Studio.',
    project: 'somae'
  }),
  Object.freeze({
    id: 'daylight-hosted', name: 'Daylight', host: 'hosted',
    locationLabel: 'Hosted', available: false, connected: true, canReceiveMessages: true,
    description: 'Your planning agent. Its hosted service is currently unavailable.',
    project: 'Tomorrow'
  }),
  Object.freeze({
    id: 'orbit-incoming', name: 'Orbit', host: 'hosted',
    locationLabel: 'Hosted', available: true, connected: true, canReceiveMessages: false,
    description: 'Connected for incoming signals. It has no grant to receive new messages.'
  })
]);

const denied = (label, reason) => ({ allowed: false, label, reason });

/**
 * The calling device is required. `device` may be a device record or demo ID;
 * `paused` is a collection of endpoint IDs or sender names from Connections.
 * A reachable local runner on a different computer is still ineligible.
 */
export function getMessageAvailability(endpoint, { device, paused = [] } = {}) {
  const origin = typeof device === 'string'
    ? demoDevices.find(item => item.id === device)
    : device;

  if (!endpoint || !['hosted', 'local'].includes(endpoint.host)) {
    return denied('Unavailable', 'This agent does not have a supported message endpoint.');
  }
  if (!origin?.id || !['desktop', 'mobile'].includes(origin.kind)) {
    return denied('Device unknown', 'Choose the device you are using before sending a message.');
  }

  // Location is a capability boundary, independent of connectivity or grants.
  if (endpoint.host === 'local') {
    const location = endpoint.locationLabel || 'its computer';
    if (origin.kind === 'mobile') {
      return denied(`On ${location} only`, `Local agents can receive new messages only from Somae on the same computer. Use Somae on ${location}, or choose a hosted agent.`);
    }
    if (!endpoint.deviceId || endpoint.deviceId !== origin.id) {
      return denied(`On ${location} only`, `This agent runs locally on ${location}. Message it from Somae on that computer. Being online does not make it a hosted agent.`);
    }
  }

  if (endpoint.connected !== true) {
    return denied('Not connected', `Connect ${endpoint.name} before sending a message.`);
  }
  const pausedKeys = paused instanceof Set ? paused : new Set(Array.isArray(paused) ? paused : []);
  if (pausedKeys.has(endpoint.id) || pausedKeys.has(endpoint.name)) {
    return denied('Paused', `Resume ${endpoint.name} in Connections before sending a message.`);
  }
  if (endpoint.canReceiveMessages !== true) {
    return denied('Incoming only', 'Receiving signals does not grant permission to send new messages to this agent.');
  }
  if (endpoint.available !== true) {
    return denied('Unavailable', endpoint.host === 'local'
      ? `The local runner on ${endpoint.locationLabel} is unavailable. Reconnect it on this computer to send a message.`
      : `${endpoint.name}'s hosted service is unavailable. Try again when it reconnects.`);
  }

  return {
    allowed: true,
    label: endpoint.host === 'local' ? 'Ready here' : 'Ready',
    reason: endpoint.host === 'local'
      ? `Runs locally on this ${origin.name || 'computer'}.`
      : 'This connected hosted agent can receive a new message from desktop or mobile.'
  };
}
