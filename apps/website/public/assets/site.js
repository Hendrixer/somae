// Somae website demos.
//
// index.html keeps the Beacon artboard's template syntax inside the two demo
// figures ([data-dc]): {{path}} holes in text and attributes, <sc-if value>,
// <sc-for list as>, and data-on-click handlers. compile() binds that markup once,
// then each render updates only the text, attributes and conditional blocks
// whose values changed, so focus and running CSS animations are kept.

const HOLE = /\{\{\s*([\w$.]+)\s*\}\}/g;
const ONLY_HOLE = /^\s*\{\{\s*([\w$.]+)\s*\}\}\s*$/;

export function lookup(scope, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), scope);
}

export function holes(template) {
  return [...template.matchAll(HOLE)].map(match => match[1]);
}

function fill(template, scope) {
  return template.replace(HOLE, (_, path) => {
    const value = lookup(scope, path);
    return value == null ? '' : String(value);
  });
}

function holePath(element, name) {
  const match = (element.getAttribute(name) ?? '').match(ONLY_HOLE);
  if (!match) throw new Error(`<${element.localName}> needs ${name}="{{path}}".`);
  return match[1];
}

export function compile(root) {
  const updates = [];
  for (const child of [...root.childNodes]) compileNode(child, updates);
  return scope => { for (const update of updates) update(scope); };
}

function compileNode(node, updates) {
  if (node.nodeType === 3) {
    const template = node.nodeValue;
    if (!template.includes('{{')) return;
    let last = template;
    updates.push(scope => {
      const next = fill(template, scope);
      if (next !== last) node.nodeValue = last = next;
    });
    return;
  }
  if (node.nodeType !== 1) return;

  // A conditional block keeps its <sc-if> element as a display: contents
  // wrapper, so nested blocks stay inside it. Showing it again remounts its
  // content, which replays entrance animations the same way the artboard did.
  if (node.localName === 'sc-if') {
    const path = holePath(node, 'value');
    const anchor = document.createComment('sc-if');
    node.before(anchor);
    node.remove();
    const update = compile(node);
    let shown = false;
    updates.push(scope => {
      const show = Boolean(lookup(scope, path));
      if (show) update(scope);
      if (show && !shown) anchor.after(node);
      if (!show && shown) node.remove();
      shown = show;
    });
    return;
  }

  if (node.localName === 'sc-for') {
    const path = holePath(node, 'list');
    const name = node.getAttribute('as') || 'item';
    const template = [...node.childNodes];
    for (const child of template) child.remove();
    let items = [];
    updates.push(scope => {
      const list = lookup(scope, path) ?? [];
      if (list.length !== items.length) {
        node.replaceChildren();
        items = list.map(() => {
          const holder = document.createDocumentFragment();
          holder.append(...template.map(child => child.cloneNode(true)));
          const update = compile(holder);
          node.append(holder);
          return update;
        });
      }
      items.forEach((update, index) => update({ ...scope, [name]: list[index] }));
    });
    return;
  }

  for (const attribute of [...node.attributes]) {
    if (!attribute.value.includes('{{')) continue;
    const { name, value: template } = attribute;
    if (name.startsWith('data-on-')) {
      const match = template.match(ONLY_HOLE);
      if (!match) throw new Error(`${name} needs a single {{path}}.`);
      node.removeAttribute(name);
      let handler;
      node.addEventListener(name.slice('data-on-'.length), event => handler?.(event));
      updates.push(scope => { handler = lookup(scope, match[1]); });
      continue;
    }
    let last = template;
    updates.push(scope => {
      const next = fill(template, scope);
      if (next !== last) node.setAttribute(name, last = next);
    });
  }
  for (const child of [...node.childNodes]) compileNode(child, updates);
}

// Scene clocks, ported from the Beacon artboard.

export const HERO_DURATIONS = [1800, 4400, 2800, 900, 1900, 500];
export const REVIEW_DURATIONS = [2500, 2700, 1100, 2400, 2400, 1000, 1500, 1300, 2300, 1100, 1800, 900, 2600];
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const NOOP = () => {};

function stepButtons(marks, labels, scene, pick) {
  let active = 0;
  marks.forEach((mark, index) => { if (scene >= mark) active = index; });
  return labels.map((label, index) => ({
    label,
    pressed: index === active ? 'true' : 'false',
    bg: index === active ? '#2a2a28' : '#0c0c0c',
    fg: index === active ? '#f4f4f2' : '#aaa9a5',
    border: index === active ? '#4a4a47' : '#262626',
    pick: () => pick(marks[index]),
  }));
}

export function heroView(state, actions = {}) {
  const hs = state.hs ?? 0;
  const hp = Boolean(state.hp);
  return {
    steps: stepButtons([0, 1, 2, 4], ['Working', 'Ready for review', '⌘ ⇧ Space', 'Set aside'], hs, actions.pickHero ?? NOOP),
    menuCount: hs >= 1 && hs <= 2,
    showBeacon: hs <= 1,
    beaconText: hs === 1 ? '1 signal' : 'Somae',
    waveAnim: hs === 1 && !hp ? `somae-wave 1100ms ${EASE} 4` : 'none',
    showWindow: hs >= 2,
    windowAnim: hs === 5 ? `somae-dismiss 170ms ${EASE} forwards` : (hs === 2 ? `somae-summon 350ms ${EASE} both` : 'none'),
    showSignal: hs === 2 || hs === 3,
    showClear: hs >= 4,
    later: hs === 3 ? { bg: '#232323', shift: 'translateY(1px)' } : { bg: '#181818', shift: 'none' },
    showKey: hs === 2 || hs === 3 || hs === 5,
    keyLabel: hs === 3 ? '⌘ ←' : (hs === 5 ? 'esc' : '⌘ ⇧ Space'),
    toggleText: hp ? 'Play' : 'Pause',
    toggleLabel: hp ? 'Play the desktop demo' : 'Pause the desktop demo',
    toggle: actions.toggleHero ?? NOOP,
  };
}

const NOTES = {
  film: { text: 'Hold the reveal a beat longer.', anchor: '0:04 · frame region', num: '1', typing: 1, saved: 2 },
  model: { text: 'Warmer rim light on the outer ring.', anchor: 'Turntable · 112°', num: '2', typing: 4, saved: 5 },
  site: { text: 'Tighten the headline on phones.', anchor: 'Phone · 390 px', num: '3', typing: 8, saved: 9 },
};
const TYPE_MS = 40;

export function reviewView(state, actions = {}) {
  const rs = state.rs ?? 0;
  const rp = Boolean(state.rp);
  const rt = state.rt ?? 0;
  const tab = rs <= 2 ? 'film' : (rs <= 5 ? 'model' : (rs <= 9 ? 'site' : 'logo'));
  const note = NOTES[tab];
  const typing = Boolean(note) && rs === note.typing;
  const typed = typing ? note.text.slice(0, Math.floor(rt / TYPE_MS)) : '';
  const on = { bg: '#181818', fg: '#f4f4f2' };
  const off = { bg: '#0c0c0c', fg: '#aaa9a5' };
  const tabState = (key, savedAt) => ({ ...(tab === key ? on : off), count: savedAt !== null && rs >= savedAt });
  const pin = saved => saved
    ? { border: '2px solid #0c0c0c', bg: '#f4f4f2', fg: '#0c0c0c' }
    : { border: '2px solid #d8d8d3', bg: '#0c0c0c', fg: '#f4f4f2' };
  const modelPin = pin(rs >= 5);
  const sitePin = pin(rs >= 9);
  const filmPct = rs === 0 ? Math.min(33.3, (33.3 * rt) / 2500) : 33.3;
  return {
    steps: stepButtons([0, 3, 6, 10, 12], ['Scrub a film', 'Orbit a 3D asset', 'Check a site', 'Review the logo', 'Approve v3'], rs, actions.pickReview ?? NOOP),
    title: { film: 'launch-film.mp4', model: 'ring.glb', site: 'morrow.site', logo: 'logo.svg' }[tab],
    versionLabel: rs === 12 ? 'Version 3 · approved' : 'Version 3',
    tabs: { film: tabState('film', 2), model: tabState('model', 5), site: tabState('site', 9), logo: tabState('logo', null) },
    onFilm: tab === 'film', onModel: tab === 'model', onSite: tab === 'site', onLogo: tab === 'logo',
    filmPlay: rs === 0 && !rp ? 'running' : 'paused',
    filmPlaying: rs === 0 && !rp,
    filmStopped: !(rs === 0 && !rp),
    filmSec: String(Math.min(4, Math.floor((4 * filmPct) / 33.3))),
    playPct: filmPct.toFixed(1),
    filmRegion: rs >= 1,
    filmRegionStyle: rs >= 2 ? 'solid' : 'dashed',
    filmMarker: rs >= 1,
    spin: rs === 3 && !rp ? 'running' : 'paused',
    modelPin: rs >= 4,
    modelPinBorder: modelPin.border, modelPinBg: modelPin.bg, modelPinFg: modelPin.fg,
    deskBg: rs >= 7 ? '#181818' : '#2a2a28',
    phoneBg: rs >= 7 ? '#2a2a28' : '#181818',
    siteW: rs >= 7 ? '340px' : '720px',
    siteRadius: rs >= 7 ? '22px' : '8px',
    siteHead: rs >= 7 ? '34px' : '52px',
    sitePin: rs >= 8,
    sitePinBorder: sitePin.border, sitePinBg: sitePin.bg, sitePinFg: sitePin.fg,
    count: tab !== 'logo' && note && rs >= note.saved ? '1' : '0',
    composer: typing,
    anchor: note ? note.anchor : '',
    typed,
    caret: typing && !rp && typed.length < note.text.length,
    card: Boolean(note) && rs >= note.saved,
    cardBg: note && rs === note.saved ? '#181818' : '#0c0c0c',
    cardNum: note ? note.num : '',
    cardText: note ? note.text : '',
    logoNote: tab === 'logo',
    approveShift: rs === 11 ? 'translateY(1px)' : 'none',
    approveFilter: rs === 11 ? 'brightness(1.08)' : 'none',
    history: rs === 12 ? 'Approved v3' : 'Approved v2',
    showToast: rs === 2 || rs === 5 || rs === 9 || rs === 12,
    toast: rs === 12 ? 'Approval sent with comments.' : 'Comment saved.',
    toggleText: rp ? 'Play' : 'Pause',
    toggleLabel: rp ? 'Play the review demo' : 'Pause the review demo',
    toggle: actions.toggleReview ?? NOOP,
  };
}

// Advance the clocks by one 100 ms tick. Each demo only runs while it is on
// screen and not paused; reduced motion starts both paused on a still scene.
export function tick(state, clock, visible = { hero: true, review: true }) {
  const next = {};
  if (!state.hp && visible.hero) {
    clock.hero += 100;
    const scene = state.hs ?? 0;
    if (clock.hero >= HERO_DURATIONS[scene]) { clock.hero = 0; next.hs = (scene + 1) % HERO_DURATIONS.length; }
  }
  if (!state.rp && visible.review) {
    clock.review += 100;
    const scene = state.rs ?? 0;
    if (clock.review >= REVIEW_DURATIONS[scene]) { clock.review = 0; next.rs = (scene + 1) % REVIEW_DURATIONS.length; next.rt = 0; }
    else if ([0, 1, 4, 8].includes(scene)) next.rt = clock.review;
  }
  return next;
}

// Below its design width, a demo stage ([data-fit] frame) renders at that width
// and scales down like a screenshot instead of reflowing into a cramped layout.
export function fitScale(available, design) {
  return available > 0 && available < design ? available / design : 1;
}

function fitStages() {
  const frames = [...document.querySelectorAll('[data-fit]')];
  const apply = frame => {
    const stage = frame.firstElementChild;
    const design = Number(frame.dataset.fit);
    const scale = fitScale(frame.clientWidth, design);
    if (scale === 1) {
      stage.style.removeProperty('width');
      stage.style.removeProperty('transform');
      frame.style.removeProperty('height');
      return;
    }
    stage.style.width = `${design}px`;
    stage.style.transformOrigin = '0 0';
    stage.style.transform = `scale(${scale})`;
    frame.style.height = `${stage.offsetHeight * scale}px`;
  };
  frames.forEach(apply);
  if (!('ResizeObserver' in window)) return;
  // Watch the frame for width and the stage for height; review scenes differ in height.
  const observer = new ResizeObserver(entries => {
    for (const frame of new Set(entries.map(entry => entry.target.closest('[data-fit]')))) apply(frame);
  });
  for (const frame of frames) { observer.observe(frame); observer.observe(frame.firstElementChild); }
}

export function initialState(reduceMotion) {
  return reduceMotion
    ? { hs: 2, hp: true, rs: 2, rp: true, rt: 99999 }
    : { hs: 0, hp: false, rs: 0, rp: false, rt: 0 };
}

function start() {
  const hero = document.querySelector('[data-dc="hero"]');
  const review = document.querySelector('[data-dc="review"]');
  if (!hero || !review) return;

  let reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
  const state = initialState(reduceMotion);
  const clock = { hero: 0, review: 0 };
  const visible = { hero: true, review: false };

  const actions = {
    pickHero: scene => { clock.hero = 0; setState({ hs: scene, hp: true }); },
    toggleHero: () => { clock.hero = 0; setState({ hp: !state.hp }); },
    pickReview: scene => { clock.review = 0; setState({ rs: scene, rp: true, rt: 99999 }); },
    toggleReview: () => { clock.review = 0; setState({ rp: !state.rp }); },
  };

  const renderHero = compile(hero);
  const renderReview = compile(review);
  function render() {
    renderHero({ h: heroView(state, actions) });
    renderReview({ r: reviewView(state, actions) });
  }
  function setState(patch) {
    Object.assign(state, patch);
    render();
  }

  render();
  fitStages();
  hero.setAttribute('data-dc-bound', '');
  review.setAttribute('data-dc-bound', '');

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) visible[entry.target === hero ? 'hero' : 'review'] = entry.isIntersecting;
    }, { threshold: 0.2 });
    observer.observe(hero);
    observer.observe(review);
  } else {
    visible.review = true;
  }

  setInterval(() => {
    if (document.hidden) return;
    const next = tick(state, clock, visible);
    if (Object.keys(next).length) setState(next);
  }, 100);
}

if (typeof document !== 'undefined') start();
