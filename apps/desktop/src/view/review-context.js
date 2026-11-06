const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const positive = value => Number.isInteger(value) && value > 0;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function pinSet(pins) {
  if (!Array.isArray(pins)) return null;
  const keys = new Set();
  for (const ref of pins) {
    if (!plain(ref) || Object.keys(ref).length !== 2 || !Object.hasOwn(ref, 'artifact_id') || !Object.hasOwn(ref, 'revision') || !nonempty(ref.artifact_id) || !positive(ref.revision)) return null;
    const key = JSON.stringify([ref.artifact_id, ref.revision]);
    if (keys.has(key)) return null;
    keys.add(key);
  }
  return keys;
}

export function sameReviewPins(a, b) {
  const left = pinSet(a); const right = pinSet(b);
  return !!left && !!right && left.size === right.size && [...left].every(key => right.has(key));
}

function actionsValid(actions) {
  return Array.isArray(actions) && actions.length > 0 && actions.every(action => plain(action) && nonempty(action.id)) && new Set(actions.map(action => action.id)).size === actions.length;
}

function requestType(signal) {
  const interaction = signal?.interaction;
  if (!plain(interaction) || interaction.mode !== 'required') return null;
  if (signal.review_request) {
    return signal.kind === 'approval' && interaction.response_type === 'approval' && interaction.terms?.operation === 'review_artifacts' && nonempty(interaction.terms_digest) && actionsValid(interaction.actions) && interaction.actions.length === 2 && ['approve', 'reject'].every(id => interaction.actions.some(action => action.id === id)) ? 'review' : null;
  }
  if (signal.kind !== 'question') return null;
  if (interaction.response_type === 'single_choice' && actionsValid(interaction.actions)) return 'choice';
  if (interaction.response_type === 'text' && positive(interaction.max_length ?? 4000) && (interaction.max_length ?? 4000) <= 16_384) return 'text';
  return null;
}

// A question keeps its actual answer type, even when the person adds artifact
// comments. Only an explicit artifact approval accepts a binary decision.
export function reviewResponseValue(signal, decision, answer) {
  const type = requestType(signal);
  if (!type || signal.state !== 'active') return null;
  if (type === 'review') return ['approve', 'reject'].includes(decision) && answer == null ? { action_id: decision, terms_digest: signal.interaction.terms_digest } : null;
  if (decision != null) return null;
  if (type === 'choice') return typeof answer === 'string' && signal.interaction.actions.some(action => action.id === answer) ? { option_id: answer } : null;
  return nonempty(answer) && answer.length <= (signal.interaction.max_length ?? 4000) ? { text: answer } : null;
}

export function reviewSourceForSubmission(request, signal, { decision, answer } = {}) {
  if (!reviewRequestIsCurrent(request, signal)) return null;
  const value = reviewResponseValue(signal, decision, answer);
  return value ? { signal_id: request.signal_id, expected_revision: request.expected_revision, interaction_id: request.interaction_id, value } : null;
}

export function captureReviewRequest(signal) {
  if (!requestType(signal) || !nonempty(signal.id) || !positive(signal.revision) || !nonempty(signal.interaction.id)) return null;
  return { signal_id: signal.id, expected_revision: signal.revision, interaction_id: signal.interaction.id, structured: !!signal.review_request };
}

export function reviewRequestIsCurrent(request, signal) {
  const current = captureReviewRequest(signal);
  return !!current && plain(request) && signal.state === 'active' && request.signal_id === current.signal_id && request.expected_revision === current.expected_revision && request.interaction_id === current.interaction_id && request.structured === current.structured;
}
