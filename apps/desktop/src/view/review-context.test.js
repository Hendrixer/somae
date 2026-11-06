import test from 'node:test';
import assert from 'node:assert/strict';
import { sameReviewPins, reviewResponseValue, reviewSourceForSubmission, captureReviewRequest, reviewRequestIsCurrent } from './review-context.js';

function review(overrides = {}) {
  return {
    id: 'review-request', revision: 3, state: 'active', kind: 'approval',
    review_request: { signal_id: 'review-request', revision: 3, artifacts: [{ artifact_id: 'cover', revision: 2 }] },
    interaction: {
      id: 'review-interaction', mode: 'required', response_type: 'approval',
      actions: [{ id: 'approve', label: 'Looks good' }, { id: 'reject', label: 'Needs work' }],
      terms: { operation: 'review_artifacts' }, terms_digest: 'exact-request-terms',
    }, ...overrides,
  };
}

function question(type = 'single_choice', overrides = {}) {
  return {
    id: 'question', revision: 1, state: 'active', kind: 'question',
    interaction: { id: 'question-interaction', mode: 'required', response_type: type, ...(type === 'single_choice' ? { actions: [{ id: 'opaque-17', label: 'Approve everything' }, { id: 'opaque-24', label: 'Maybe' }] } : { max_length: 8 }) },
    ...overrides,
  };
}

test('only artifact approvals accept a binary decision and preserve exact terms', () => {
  const signal = review();
  const request = captureReviewRequest(signal);
  const source = { signal_id: 'review-request', expected_revision: 3, interaction_id: 'review-interaction' };
  for (const decision of ['approve', 'reject']) {
    assert.deepEqual(reviewResponseValue(signal, decision), { action_id: decision, terms_digest: 'exact-request-terms' });
    assert.deepEqual(reviewSourceForSubmission(request, signal, { decision }), { ...source, value: { action_id: decision, terms_digest: 'exact-request-terms' } });
    assert.equal(reviewResponseValue(signal, decision, 'An unrelated question answer'), null);
  }
  signal.interaction.actions = [{ id: 'approve', label: 'Reject and delete everything' }, { id: 'reject', label: 'Approve immediately' }];
  assert.deepEqual(reviewResponseValue(signal, 'approve'), { action_id: 'approve', terms_digest: 'exact-request-terms' });
  for (const decision of ['disapprove', 'Request changes', 'Approve immediately', '', undefined, null, 1]) assert.equal(reviewResponseValue(signal, decision), null);
  delete signal.interaction.terms_digest;
  assert.equal(reviewResponseValue(signal, 'approve'), null);
  assert.equal(captureReviewRequest(signal), null);
});

test('questions use exact offered opaque option IDs without interpreting labels as approvals', () => {
  const signal = question();
  const request = captureReviewRequest(signal);
  assert.deepEqual(reviewResponseValue(signal, undefined, 'opaque-24'), { option_id: 'opaque-24' });
  assert.deepEqual(reviewSourceForSubmission(request, signal, { answer: 'opaque-17' }), { signal_id: 'question', expected_revision: 1, interaction_id: 'question-interaction', value: { option_id: 'opaque-17' } });
  for (const decision of ['approve', 'reject', false, '']) assert.equal(reviewResponseValue(signal, decision, 'opaque-17'), null);
  for (const answer of ['Approve everything', 'Maybe', '1', 'approve', '', null, undefined]) assert.equal(reviewResponseValue(signal, undefined, answer), null);
  signal.interaction.actions = [{ id: 'approve', label: 'No thanks' }, { id: 'reject', label: 'Ship it' }];
  assert.deepEqual(reviewResponseValue(signal, null, 'approve'), { option_id: 'approve' });
  assert.deepEqual(reviewResponseValue(signal, undefined, 'reject'), { option_id: 'reject' });
  assert.equal(reviewResponseValue(signal, 'approve'), null);
  signal.interaction.actions.push({ id: 'reject', label: 'Ambiguous duplicate' });
  assert.equal(reviewResponseValue(signal, undefined, 'reject'), null);
});

test('free-text question answers preserve exact text and respect declared bounds up to 16384', () => {
  const signal = question('text');
  const request = captureReviewRequest(signal);
  assert.deepEqual(reviewResponseValue(signal, undefined, '  yes  '), { text: '  yes  ' });
  assert.deepEqual(reviewSourceForSubmission(request, signal, { answer: '  yes  ' }), { signal_id: 'question', expected_revision: 1, interaction_id: 'question-interaction', value: { text: '  yes  ' } });
  for (const answer of ['', '  ', 'too long!', null, 1]) assert.equal(reviewResponseValue(signal, undefined, answer), null);
  assert.equal(reviewResponseValue(signal, 'approve', 'yes'), null);
  assert.equal(reviewResponseValue(signal, 'reject', 'no'), null);
  signal.interaction.max_length = 16_384;
  assert.deepEqual(reviewResponseValue(signal, undefined, 'a'.repeat(16_384)), { text: 'a'.repeat(16_384) });
  assert.equal(reviewResponseValue(signal, undefined, 'a'.repeat(16_385)), null);
  delete signal.interaction.max_length;
  assert.deepEqual(reviewResponseValue(signal, null, 'a'.repeat(4000)), { text: 'a'.repeat(4000) });
  assert.equal(reviewResponseValue(signal, undefined, 'a'.repeat(4001)), null);
  for (const max_length of [0, -1, 16_385, '4000']) {
    signal.interaction.max_length = max_length;
    assert.equal(reviewResponseValue(signal, undefined, 'yes'), null);
  }
});

test('ordinary tool approvals and unsupported interactions cannot be submitted from a content review', () => {
  const toolApproval = review({ review_request: undefined });
  for (const signal of [null, {}, toolApproval, review({ interaction: { ...review().interaction, terms: { operation: 'publish_site' } } }), question('form'), question('single_choice', { kind: 'result' }), question('single_choice', { interaction: { ...question().interaction, mode: 'optional' } })]) {
    assert.equal(captureReviewRequest(signal), null);
    assert.equal(reviewResponseValue(signal, 'approve'), null);
    assert.equal(reviewResponseValue(signal, undefined, 'opaque-17'), null);
    assert.equal(reviewSourceForSubmission(captureReviewRequest(signal), signal, { decision: 'approve' }), null);
  }
});

test('submission descriptors pin exact signal, revision, interaction and request provenance', () => {
  const signal = review();
  const descriptor = captureReviewRequest(signal);
  assert.deepEqual(descriptor, { signal_id: 'review-request', expected_revision: 3, interaction_id: 'review-interaction', structured: true });
  assert.ok(reviewRequestIsCurrent(descriptor, signal));
  assert.deepEqual(captureReviewRequest(question()), { signal_id: 'question', expected_revision: 1, interaction_id: 'question-interaction', structured: false });
  for (const replacement of [review({ id: 'different-request' }), review({ revision: 4 }), review({ interaction: { ...signal.interaction, id: 'different-interaction' } }), review({ state: 'withdrawn' }), review({ state: 'answered' }), review({ state: 'expired' })]) {
    assert.equal(reviewRequestIsCurrent(descriptor, replacement), false);
    assert.equal(reviewSourceForSubmission(descriptor, replacement, { decision: 'approve' }), null);
    assert.equal(reviewSourceForSubmission(descriptor, replacement, { decision: 'reject' }), null);
  }
  assert.equal(reviewRequestIsCurrent({ ...descriptor, structured: false }, signal), false);
  assert.equal(reviewSourceForSubmission({ ...descriptor, structured: false }, signal, { decision: 'approve' }), null);
  assert.equal(reviewRequestIsCurrent(null, signal), false);
  assert.equal(reviewRequestIsCurrent(descriptor, null), false);
  assert.equal(reviewSourceForSubmission(null, signal, { decision: 'approve' }), null);
  assert.equal(reviewSourceForSubmission(descriptor, null, { decision: 'approve' }), null);
  const asked = question();
  const askedDescriptor = captureReviewRequest(asked);
  for (const replacement of [question('single_choice', { revision: 2 }), question('single_choice', { state: 'withdrawn' }), signal]) assert.equal(reviewSourceForSubmission(askedDescriptor, replacement, { answer: 'opaque-17' }), null);
});

test('review pins compare exact order-independent sets and reject malformed or duplicate pins', () => {
  const pins = [{ artifact_id: 'cover', revision: 2 }, { artifact_id: 'brief', revision: 1 }];
  assert.ok(sameReviewPins(pins, [...pins].reverse()));
  assert.ok(sameReviewPins([], []));
  assert.equal(sameReviewPins(pins, [pins[0]]), false);
  assert.equal(sameReviewPins(pins, [{ ...pins[0], revision: 3 }, pins[1]]), false);
  for (const invalid of [null, {}, [null], [{ artifact_id: 'cover', revision: 0 }], [{ artifact_id: '', revision: 1 }], [{ artifact_id: 'cover', revision: '2' }], [{ artifact_id: 'cover', revision: 2, extra: true }], [pins[0], pins[0]]]) assert.equal(sameReviewPins(invalid, invalid), false);
});
