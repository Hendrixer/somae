import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageGesture } from './image-gesture.js';

const rect = { left: 20, top: 40, width: 400, height: 200 };
const pointer = (clientX, clientY, extra = {}) => ({ pointerId: 7, isPrimary: true, button: 0, clientX, clientY, ...extra });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`);

test('consecutive and overlapping drags create independent regions', () => {
  const saved = [];
  for (const [from, to] of [[[60, 60], [200, 160]], [[90, 80], [240, 190]], [[250, 50], [400, 150]]]) {
    const gesture = createImageGesture(rect, pointer(...from));
    assert.equal(gesture.move(pointer(...to)).dragging, true);
    const note = gesture.finish(pointer(...to));
    assert.equal(note.kind, 'region');
    saved.push(note.anchor);
  }
  assert.equal(saved.length, 3);
  near(saved[0].x, .1); near(saved[1].x, .175);
  assert.ok(saved[1].x < saved[0].x + saved[0].width);
  assert.notDeepEqual(saved[1], saved[0]);
});

test('reverse and outside drags clamp to the captured image rectangle', () => {
  const source = { ...rect };
  const gesture = createImageGesture(source, pointer(300, 160));
  source.left = 1000; source.width = 1;
  const result = gesture.finish(pointer(-100, -100));
  assert.equal(result.kind, 'region');
  assert.deepEqual(result.anchor, { type: 'region', x: 0, y: 0, width: .7, height: .6 });
  const lower = createImageGesture(rect, pointer(60, 60)).finish(pointer(1000, 1000));
  near(lower.anchor.x + lower.anchor.width, 1);
  near(lower.anchor.y + lower.anchor.height, 1);
});

test('click and small pointer jitter create one point, clamped inside the image', () => {
  const click = createImageGesture(rect, pointer(220, 140));
  assert.equal(click.move(pointer(225, 145)).dragging, false);
  assert.deepEqual(click.finish(pointer(225, 145)), { kind: 'point', anchor: { type: 'region', x: .499, y: .499, width: .002, height: .002 } });
  assert.equal(click.finish(pointer(225, 145)), null);
  const corner = createImageGesture(rect, pointer(20, 240)).finish(pointer(20, 240));
  assert.deepEqual(corner.anchor, { type: 'region', x: 0, y: .998, width: .002, height: .002 });
});

test('explicit region mode rejects clicks and sticky thin drags never become points', () => {
  assert.equal(createImageGesture(rect, pointer(100, 100), { regionOnly: true }).finish(pointer(100, 100)), null);
  assert.equal(createImageGesture(rect, pointer(100, 100)).finish(pointer(200, 103)), null);
  const backtrack = createImageGesture(rect, pointer(100, 100));
  assert.equal(backtrack.move(pointer(150, 150)).dragging, true);
  assert.equal(backtrack.move(pointer(101, 101)).dragging, true);
  assert.equal(backtrack.finish(pointer(101, 101)), null);
});

test('other pointers and invalid geometry cannot start or finish a gesture', () => {
  assert.equal(createImageGesture(rect, pointer(100, 100, { isPrimary: false })), null);
  assert.equal(createImageGesture(rect, pointer(100, 100, { button: 2 })), null);
  for (const invalid of [{ ...rect, width: 0 }, { ...rect, height: -1 }, { ...rect, left: NaN }]) {
    assert.equal(createImageGesture(invalid, pointer(100, 100)), null);
  }
  const gesture = createImageGesture(rect, pointer(100, 100));
  assert.equal(gesture.move(pointer(200, 200, { pointerId: 8 })), null);
  assert.equal(gesture.finish(pointer(200, 200, { pointerId: 8 })), null);
  assert.equal(gesture.finish(pointer(150, 150)).kind, 'region');
});

test('the drag threshold uses CSS pixels rather than image or viewport proportions', () => {
  for (const size of [100, 1000, 10000]) {
    const bounds = { left: 0, top: 0, width: size, height: size };
    assert.equal(createImageGesture(bounds, pointer(10, 10)).finish(pointer(15, 15)).kind, 'point');
    assert.equal(createImageGesture(bounds, pointer(10, 10)).finish(pointer(16, 16)).kind, 'region');
  }
});
