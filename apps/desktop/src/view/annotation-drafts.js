// Unfinished editors are UI drafts, always bound to the exact asset and version
// where they began. Switching the canvas parks an editor; it never retargets it.
const clone = value => structuredClone(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const failure = (reason, annotation) => ({ ok: false, reason, artifact_id: annotation?.artifact_id, revision: annotation?.revision });

export function annotationForAsset(draft, artifactId) {
  if (draft.annotation?.artifact_id === artifactId) return draft.annotation;
  const parked = draft.parked_annotations;
  return plain(parked) && Object.hasOwn(parked, artifactId) ? parked[artifactId] : null;
}

export function parkAnnotation(draft) {
  const annotation = draft.annotation;
  if (!annotation) return { ok: true };
  if (!plain(annotation) || !nonempty(annotation.artifact_id)) return failure('invalid', annotation);
  const parked = draft.parked_annotations ?? {};
  if (!plain(parked)) return failure('invalid', annotation);
  if (Object.hasOwn(parked, annotation.artifact_id) && JSON.stringify(parked[annotation.artifact_id]) !== JSON.stringify(annotation)) return failure('conflict', annotation);
  draft.parked_annotations = { ...parked, [annotation.artifact_id]: { ...clone(annotation), collapsed: true } };
  delete draft.annotation;
  return { ok: true };
}

export function resumeAnnotation(draft, artifactId) {
  const annotation = annotationForAsset(draft, artifactId);
  if (!annotation) return { ok: false, reason: 'missing', artifact_id: artifactId };
  if (draft.annotation && draft.annotation.artifact_id !== artifactId) return failure('conflict', annotation);
  if (draft.annotation && plain(draft.parked_annotations) && Object.hasOwn(draft.parked_annotations, artifactId)
    && JSON.stringify(draft.annotation) !== JSON.stringify(draft.parked_annotations[artifactId])) return failure('conflict', annotation);
  if (!plain(annotation) || annotation.artifact_id !== artifactId) return failure('invalid', annotation);
  draft.annotation = { ...clone(annotation), collapsed: false };
  if (plain(draft.parked_annotations)) {
    delete draft.parked_annotations[artifactId];
    if (!Object.keys(draft.parked_annotations).length) delete draft.parked_annotations;
  }
  return { ok: true, annotation: draft.annotation };
}

export function discardAnnotation(draft, artifactId) {
  let removed = false;
  if (draft.annotation?.artifact_id === artifactId) { delete draft.annotation; removed = true; }
  if (plain(draft.parked_annotations) && Object.hasOwn(draft.parked_annotations, artifactId)) {
    delete draft.parked_annotations[artifactId]; removed = true;
    if (!Object.keys(draft.parked_annotations).length) delete draft.parked_annotations;
  }
  return removed;
}

function validAnchor(annotation, version) {
  const anchor = annotation.anchor;
  if (anchor?.type === 'text') {
    const block = version.blocks?.find(block => block.id === anchor.block_id);
    return !!block && Number.isInteger(anchor.start) && Number.isInteger(anchor.end) && anchor.start >= 0 && anchor.end > anchor.start
      && anchor.end <= block.text.length && block.text.slice(anchor.start, anchor.end) === anchor.quote
      && (annotation.kind !== 'replace' || typeof annotation.replacement === 'string' && annotation.replacement.length <= 16_384);
  }
  if (anchor?.type !== 'region' || annotation.kind !== 'comment' || !version.media_type?.startsWith('image/')) return false;
  const { x, y, width, height } = anchor;
  return [x, y, width, height].every(Number.isFinite) && x >= 0 && y >= 0 && width > 0 && height > 0
    && x + width <= 1.000001 && y + height <= 1.000001;
}

// Build one candidate comment list before mutating anything. If any parked edit
// is stale or invalid, every saved comment and unfinished editor stays intact.
// The shared command boundary remains authoritative for the review itself.
export function prepareAnnotationsForSubmit(draft, items, pins = draft.pins) {
  if (draft.parked_annotations !== undefined && !plain(draft.parked_annotations)) return failure('invalid');
  const pending = Object.entries(draft.parked_annotations ?? {});
  for (const [artifactId, annotation] of pending) if (!plain(annotation) || annotation.artifact_id !== artifactId) return failure('invalid', annotation);
  const annotations = pending.map(([, annotation]) => annotation);
  if (draft.annotation) annotations.push(draft.annotation);
  const comments = clone(draft.comments ?? []);
  if (!Array.isArray(comments)) return failure('invalid');
  const assets = new Set(); const edited = new Set();
  for (const annotation of annotations) {
    if (!plain(annotation) || !nonempty(annotation.artifact_id)) return failure('invalid', annotation);
    if (assets.has(annotation.artifact_id)) return failure('conflict', annotation);
    assets.add(annotation.artifact_id);
    const hasText = nonempty(annotation.text);
    const hasReplacement = nonempty(annotation.replacement);
    // A blank untouched insertion has no feedback to lose. An emptied edit or
    // replacement still needs the person's attention instead of disappearing.
    if (!hasText && !hasReplacement && annotation.edit_index === undefined) continue;
    if (!hasText) return failure('unfinished', annotation);
    const item = items.find(item => item.id === annotation.artifact_id);
    const version = item?.versions.find(version => version.revision === annotation.revision);
    if (!item || !version || item.latest_revision !== annotation.revision) return failure('stale', annotation);
    if (!Array.isArray(pins) || !pins.some(pin => pin.artifact_id === annotation.artifact_id && pin.revision === annotation.revision)) return failure('outside_review', annotation);
    if (!['comment', 'replace'].includes(annotation.kind) || annotation.text.length > 16_384 || !validAnchor(annotation, version)) return failure('invalid', annotation);
    const comment = {
      artifact_id: annotation.artifact_id, revision: annotation.revision, kind: annotation.kind,
      text: annotation.text.trim(), anchor: clone(annotation.anchor),
      ...(annotation.kind === 'replace' ? { replacement: annotation.replacement } : {}),
    };
    if (annotation.edit_index !== undefined) {
      const index = annotation.edit_index;
      if (!Number.isInteger(index) || index < 0 || !Array.isArray(draft.comments) || index >= draft.comments.length
        || !Object.hasOwn(draft.comments, index) || edited.has(index) || JSON.stringify(draft.comments[index]) !== annotation.original) return failure('conflict', annotation);
      edited.add(index); comments[index] = comment;
    } else comments.push(comment);
  }
  return { ok: true, comments };
}
