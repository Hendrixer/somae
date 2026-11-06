// Motion stays separate from application state. Every mutation happens now;
// animations only interpolate the resulting presentation and may be cancelled.
const preference = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : null;
const active = new Set();
const channels = new WeakMap();
const settle = 'cubic-bezier(.22, 1, .36, 1)';

export const reducedMotion = () => preference?.matches ?? false;

function cancel(element, channel) {
  const group = channels.get(element)?.get(channel);
  if (!group) return;
  for (const animation of [...group]) animation.cancel();
  group.clear();
}

function play(element, channel, frames, options, hold = false) {
  if (!element?.animate || reducedMotion()) return null;
  const animation = element.animate(frames, { easing: settle, ...options });
  let groups = channels.get(element);
  if (!groups) channels.set(element, groups = new Map());
  let group = groups.get(channel);
  if (!group) groups.set(channel, group = new Set());
  group.add(animation);
  active.add(animation);
  const cleanup = () => {
    active.delete(animation);
    group.delete(animation);
  };
  animation.addEventListener('cancel', cleanup, { once: true });
  if (!hold) animation.addEventListener('finish', cleanup, { once: true });
  return animation;
}

preference?.addEventListener('change', () => {
  if (!reducedMotion()) return;
  for (const animation of [...active]) animation.cancel();
  active.clear();
});

const transform = element => {
  const value = getComputedStyle(element).transform;
  return value === 'none' ? '' : value;
};
const px = value => `${value.toFixed(3)}px`;

export function animateLayout(element, mutate, { duration = 480 } = {}) {
  const before = element?.getBoundingClientRect();
  cancel(element, 'layout');
  cancel(element, 'presence');
  mutate(); // Synchronous even when motion is disabled or the element is absent.
  if (!element || !before || reducedMotion()) return null;
  const after = element.getBoundingClientRect();
  if (!before.width || !before.height || !after.width || !after.height) return null;
  if (Math.abs(before.width - after.width) < .5 &&
      Math.abs(before.height - after.height) < .5 &&
      Math.abs(before.left - after.left) < .5 &&
      Math.abs(before.top - after.top) < .5) return null;

  const base = transform(element);
  const frames = [
    { width: px(before.width), height: px(before.height), transform: base || 'none' },
    { width: px(after.width), height: px(after.height), transform: base || 'none' }
  ];
  const animation = play(element, 'layout', frames, { duration });
  if (!animation) return null;

  // Measure the first sized frame. Centered/flex layouts already reposition
  // when dimensions change; calculating from the final frame would double it.
  animation.pause();
  animation.currentTime = 0;
  const start = element.getBoundingClientRect();
  frames[0].transform = `translate(${px(before.left - start.left)}, ${px(before.top - start.top)}) ${base}`;
  animation.effect.setKeyframes(frames);
  animation.play();
  return animation;
}

export function enterContent(element, { direction = 1 } = {}) {
  if (!element) return null;
  cancel(element, 'content');
  const base = transform(element);
  return play(element, 'content', [
    { opacity: .12, transform: `translateX(${direction < 0 ? -10 : 10}px) ${base}`, filter: 'blur(2px)' },
    { opacity: 1, transform: base || 'none', filter: 'blur(0px)' }
  ], { duration: 340 });
}

export function confirm(element) {
  if (!element) return [];
  cancel(element, 'confirmation');
  const base = transform(element);
  const standaloneSymbol = element.matches('svg');
  const animations = standaloneSymbol ? [] : [play(element, 'confirmation', [
    { opacity: 0, transform: `translateY(6px) ${base}` },
    { opacity: 1, transform: base || 'none' }
  ], { duration: 380 })];
  const symbol = standaloneSymbol ? element : element.querySelector('svg');
  if (symbol) {
    cancel(symbol, 'confirmation');
    const symbolBase = transform(symbol);
    animations.push(play(symbol, 'confirmation', [
      { opacity: .2, transform: `${symbolBase} scale(.76)`, transformOrigin: 'center' },
      { opacity: 1, transform: `${symbolBase} scale(1.1)`, transformOrigin: 'center', offset: .58 },
      { opacity: 1, transform: symbolBase || 'none', transformOrigin: 'center' }
    ], { duration: 400 }));
    for (const path of symbol.querySelectorAll('path, polyline')) {
      cancel(path, 'confirmation');
      try {
        const length = path.getTotalLength();
        if (length) animations.push(play(path, 'confirmation', [
          { strokeDasharray: `${length}`, strokeDashoffset: `${length}` },
          { strokeDasharray: `${length}`, strokeDashoffset: '0' }
        ], { duration: 300 }));
      } catch { /* A non-renderable SVG path needs no draw animation. */ }
    }
  }
  return animations.filter(Boolean);
}

export function swapPresence(from, to, { opening = false } = {}) {
  if (!from || !to) return null;
  const source = from.getBoundingClientRect();
  cancel(from, 'presence');
  cancel(to, 'presence');
  cancel(to, 'layout');
  from.hidden = true;
  to.hidden = false;
  if (from === to || reducedMotion()) return null;
  const destination = to.getBoundingClientRect();
  if (!destination.width || !destination.height) return null;
  const base = transform(to);
  const start = source.width && source.height
    ? `translate(${px(source.left - destination.left)}, ${px(source.top - destination.top)}) scale(${source.width / destination.width}, ${source.height / destination.height}) ${base}`
    : `translateY(6px) ${base}`;
  return play(to, 'presence', [
    { opacity: .05, transform: start, transformOrigin: 'top left' },
    { opacity: 1, transform: base || 'none', transformOrigin: 'top left' }
  ], { duration: opening ? 440 : 380 });
}

export function pressFeedback(root = document) {
  const pressed = new Map();
  const onDown = event => {
    if (event.button !== 0 || reducedMotion()) return;
    const element = event.target?.closest?.('button, a[href], [role="button"]');
    if (!element || !root.contains(element) || element.matches(':disabled') ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.closest('[inert], [data-no-press]') ||
        element.matches('input, textarea, select, .widget, .companion, .dock, .resting-pill')) return;
    cancel(element, 'press');
    const base = transform(element);
    pressed.set(event.pointerId, { element, base });
    play(element, 'press', [
      { transform: base || 'none' },
      { transform: `${base} scale(.975)` }
    ], { duration: 110, fill: 'forwards' }, true);
  };
  const onUp = event => {
    const entry = pressed.get(event.pointerId);
    if (!entry) return;
    pressed.delete(event.pointerId);
    const { element, base } = entry;
    const current = transform(element);
    cancel(element, 'press');
    if (element.isConnected) play(element, 'press', [
      { transform: current || 'none' },
      { transform: base || 'none' }
    ], { duration: 180 });
  };
  const clearPressed = () => {
    for (const { element } of pressed.values()) cancel(element, 'press');
    pressed.clear();
  };
  root.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('blur', clearPressed);
  return () => {
    root.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('blur', clearPressed);
    clearPressed();
  };
}
