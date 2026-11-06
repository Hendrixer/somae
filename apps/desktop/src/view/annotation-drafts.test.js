import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationForAsset, parkAnnotation, resumeAnnotation, discardAnnotation, prepareAnnotationsForSubmit } from './annotation-drafts.js';

const imageAnchor = { type: 'region', x: .1, y: .2, width: .3, height: .4 };
const textAnchor = { type: 'text', block_id: 'paragraph', start: 3, end: 9, quote: 'lovely' };
const items = [
  { id: 'cover', latest_revision: 2, versions: [{ revision: 1, media_type: 'image/png' }, { revision: 2, media_type: 'image/png' }] },
  { id: 'brief', latest_revision: 1, versions: [{ revision: 1, media_type: 'text/markdown', blocks: [{ id: 'paragraph', text: 'A 💛lovely evening.' }] }] },
];
// UTF-16 offsets include both code units of the heart.
textAnchor.start = items[1].versions[0].blocks[0].text.indexOf('lovely');
textAnchor.end = textAnchor.start + 'lovely'.length;
const pins = [{ artifact_id: 'cover', revision: 2 }, { artifact_id: 'brief', revision: 1 }];
const image = (overrides = {}) => ({ artifact_id: 'cover', revision: 2, kind: 'comment', anchor: structuredClone(imageAnchor), text: '  More space.  ', collapsed: false, ...overrides });
const text = (overrides = {}) => ({ artifact_id: 'brief', revision: 1, kind: 'replace', anchor: structuredClone(textAnchor), text: 'Keep it direct.', replacement: 'quiet', collapsed: false, ...overrides });

test('a legacy live draft parks, persists, and resumes only for its original asset', () => {
  const draft = { comments: [], pins, annotation: image() };
  const captured = structuredClone(draft.annotation);
  assert.deepEqual(parkAnnotation(draft), { ok: true });
  assert.equal(draft.annotation, undefined);
  assert.equal(annotationForAsset(draft, 'brief'), null);
  assert.deepEqual(annotationForAsset(draft, 'cover'), { ...captured, collapsed: true });
  const restored = JSON.parse(JSON.stringify(draft));
  assert.equal(resumeAnnotation(restored, 'brief').reason, 'missing');
  assert.equal(resumeAnnotation(restored, 'cover').ok, true);
  assert.deepEqual(restored.annotation, captured);
  assert.equal(restored.parked_annotations, undefined);
  assert.deepEqual(restored.annotation.anchor, imageAnchor);
});

test('each asset can keep an unfinished editor without overwriting another', () => {
  const draft = { comments: [], pins, annotation: image() };
  parkAnnotation(draft); draft.annotation = text(); parkAnnotation(draft);
  assert.deepEqual(Object.keys(draft.parked_annotations), ['cover', 'brief']);
  resumeAnnotation(draft, 'cover');
  assert.equal(resumeAnnotation(draft, 'brief').reason, 'conflict');
  assert.equal(draft.annotation.artifact_id, 'cover');
  parkAnnotation(draft); resumeAnnotation(draft, 'brief');
  assert.equal(draft.annotation.artifact_id, 'brief');
  assert.equal(annotationForAsset(draft, 'cover').text, '  More space.  ');
  assert.equal(discardAnnotation(draft, 'cover'), true);
  assert.equal(draft.annotation.artifact_id, 'brief');
  assert.equal(discardAnnotation(draft, 'brief'), true);
  assert.equal(draft.annotation, undefined);
});

test('parking refuses a conflicting draft instead of silently replacing it', () => {
  const draft = { annotation: image(), parked_annotations: { cover: image({ text: 'Earlier work.' }) } };
  const before = structuredClone(draft);
  assert.equal(parkAnnotation(draft).reason, 'conflict');
  assert.equal(resumeAnnotation(draft, 'cover').reason, 'conflict');
  assert.deepEqual(draft, before);
});

test('submission collects exact parked and live notes into one nonmutating candidate', () => {
  const draft = { comments: [], pins, parked_annotations: { cover: image({ collapsed: true }) }, annotation: text() };
  const before = structuredClone(draft);
  const prepared = prepareAnnotationsForSubmit(draft, items);
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.comments, [
    { artifact_id: 'cover', revision: 2, kind: 'comment', text: 'More space.', anchor: imageAnchor },
    { artifact_id: 'brief', revision: 1, kind: 'replace', text: 'Keep it direct.', replacement: 'quiet', anchor: textAnchor },
  ]);
  assert.deepEqual(draft, before);
  prepared.comments[0].anchor.x = .9;
  assert.equal(draft.parked_annotations.cover.anchor.x, .1);
});

test('a stale parked version or changed exact review set blocks the whole candidate', () => {
  for (const [annotation, reason] of [[image({ revision: 1 }), 'stale'], [image(), 'outside_review']]) {
    const draft = { comments: [], pins: reason === 'outside_review' ? [pins[1]] : pins, parked_annotations: { cover: annotation }, annotation: text() };
    const before = structuredClone(draft);
    assert.deepEqual(prepareAnnotationsForSubmit(draft, items), { ok: false, reason, artifact_id: 'cover', revision: annotation.revision });
    assert.deepEqual(draft, before);
  }
});

test('parked edits replace only the original unchanged comment at its exact index', () => {
  const original = { artifact_id: 'cover', revision: 2, kind: 'comment', text: 'Earlier wording.', anchor: imageAnchor };
  const draft = { comments: [structuredClone(original)], pins, parked_annotations: { cover: image({ edit_index: 0, original: JSON.stringify(original) }) } };
  assert.equal(prepareAnnotationsForSubmit(draft, items).comments[0].text, 'More space.');
  assert.equal(draft.comments[0].text, 'Earlier wording.');
  draft.comments[0].text = 'Changed elsewhere.';
  assert.equal(prepareAnnotationsForSubmit(draft, items).reason, 'conflict');
  draft.parked_annotations.cover.edit_index = -1;
  assert.equal(prepareAnnotationsForSubmit(draft, items).reason, 'conflict');
});

test('an edit without an existing original comment cannot create a sparse candidate', () => {
  for (const comments of [undefined, [], Array(3)]) {
    const draft = { ...(comments === undefined ? {} : { comments }), pins, annotation: image({ edit_index: 2 }) };
    const before = structuredClone(draft);
    assert.equal(prepareAnnotationsForSubmit(draft, items).reason, 'conflict');
    assert.deepEqual(draft, before);
  }
});

test('blank new editors are harmless but emptied edits and unfinished replacements stay protected', () => {
  const draft = { comments: [], pins, annotation: image({ text: '' }) };
  assert.deepEqual(prepareAnnotationsForSubmit(draft, items), { ok: true, comments: [] });
  assert.ok(draft.annotation);
  draft.annotation.edit_index = 0;
  assert.equal(prepareAnnotationsForSubmit(draft, items).reason, 'unfinished');
  draft.annotation = text({ text: '' });
  assert.equal(prepareAnnotationsForSubmit(draft, items).reason, 'unfinished');
  draft.annotation = text({ replacement: '' });
  assert.equal(prepareAnnotationsForSubmit(draft, items).ok, true); // Explicit deletion is a valid suggestion.
});

test('invalid or mismatched anchors and duplicate live/parked assets cannot disappear into a batch', () => {
  for (const annotation of [image({ anchor: { ...imageAnchor, x: .9 } }), text({ anchor: { ...textAnchor, quote: 'wrong' } }), image({ kind: 'replace', replacement: 'x' }), text({ text: 'x'.repeat(16_385) })]) {
    const draft = { comments: [], pins, annotation };
    const before = structuredClone(draft);
    assert.equal(prepareAnnotationsForSubmit(draft, items).reason, 'invalid');
    assert.deepEqual(draft, before);
  }
  assert.equal(prepareAnnotationsForSubmit({ comments: [], pins, annotation: image(), parked_annotations: { cover: image() } }, items).reason, 'conflict');
  assert.equal(prepareAnnotationsForSubmit({ comments: [], pins, parked_annotations: { brief: image() } }, items).reason, 'invalid');
});
