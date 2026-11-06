const threshold = 5;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const finitePoint = pointer => Number.isFinite(pointer?.clientX) && Number.isFinite(pointer?.clientY);

// One image gesture owns its starting geometry; saved notes do not change it.
export function createImageGesture(rect, pointer, { regionOnly = false } = {}) {
  if (!pointer?.isPrimary || pointer.button !== 0 || !Number.isFinite(pointer.pointerId) || !finitePoint(pointer)) return null;
  const { left, top, width, height } = rect ?? {};
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const pointerId = pointer.pointerId;
  const startX = pointer.clientX; const startY = pointer.clientY;
  const x = clamp((startX - left) / width); const y = clamp((startY - top) / height);
  let dragging = false;
  let finished = false;
  const update = current => {
    if (finished || current?.pointerId !== pointerId || !finitePoint(current)) return null;
    dragging ||= Math.max(Math.abs(current.clientX - startX), Math.abs(current.clientY - startY)) > threshold;
    const endX = clamp((current.clientX - left) / width);
    const endY = clamp((current.clientY - top) / height);
    return { dragging, anchor: { type: 'region', x: Math.min(x, endX), y: Math.min(y, endY), width: Math.abs(endX - x), height: Math.abs(endY - y) } };
  };
  return {
    pointerId,
    move: update,
    finish(current) {
      const result = update(current);
      if (!result) return null;
      finished = true;
      if (result.dragging) {
        const a = result.anchor;
        return a.width * width >= threshold && a.height * height >= threshold ? { kind: 'region', anchor: a } : null;
      }
      if (regionOnly) return null;
      const centerX = clamp(x, .001, .999); const centerY = clamp(y, .001, .999);
      return { kind: 'point', anchor: { type: 'region', x: centerX - .001, y: centerY - .001, width: .002, height: .002 } };
    },
  };
}
