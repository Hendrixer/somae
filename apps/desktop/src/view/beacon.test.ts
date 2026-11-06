import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('beacon completes four waves for a new arrival and settles without opening, respecting reduced motion', async () => {
  const classes = new Set<string>();
  const timeouts = new Map<number, () => void>();
  let nextTimer = 0, reduced = false;
  const shell = { offsetWidth: 268, classList: {
    add: (...values: string[]) => values.forEach(value => classes.add(value)),
    remove: (...values: string[]) => values.forEach(value => classes.delete(value)),
    toggle: (value: string, selected: boolean) => selected ? classes.add(value) : classes.delete(value),
  } };
  const button = Object.assign(new EventTarget(), { disabled: false, setAttribute() {} });
  const count = { textContent: '' };
  const hand = {};
  const delays: number[] = [];
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { hidden: false, querySelector: (selector: string) => selector === '.beacon-shell' ? shell : selector === '.beacon-open' ? button : selector === '.beacon-hand' ? hand : count });
  const context = { window, document, CustomEvent, initPreferences: async () => {}, reduceMotion: () => reduced,
    setInterval: () => 0,
    getComputedStyle: (element: unknown) => { expect(element).toBe(hand); return { animationDuration: '1.1s', animationIterationCount: '4' }; },
    setTimeout: (callback: () => void, delay: number) => { delays.push(delay); const id = ++nextTimer; timeouts.set(id, callback); return id; },
    clearTimeout: (id: number) => timeouts.delete(id),
    fetch: async () => ({ ok: true, json: async () => ({ queue_count: 3, attention_sequence: 5 }) }),
  };
  const source = (await readFile(new URL('./beacon.js', import.meta.url), 'utf8')).replace("import { initPreferences, reduceMotion } from './preferences.js';", '');
  const run = new Function(...Object.keys(context), `return (async () => { ${source} })();`);
  await run(...Object.values(context));
  const event = (name: string, detail: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
  expect(classes.size).toBe(0); // Historical first load is quiet.
  event('somae:attention', { sequence: 5 });
  expect(classes.size).toBe(0);
  event('somae:attention', { sequence: 6 });
  expect(classes.has('is-waving')).toBe(true);
  expect(timeouts.size).toBe(1);
  expect(delays.at(-1)).toBe(4480);
  event('somae:attention', { sequence: 7 });
  expect(timeouts.size).toBe(1); // A later arrival restarts, rather than stacking timers.
  for (const callback of timeouts.values()) callback();
  timeouts.clear();
  expect(classes.size).toBe(0); // Stops even if Somae stays closed.
  event('somae:attention', { sequence: 7 });
  event('somae:queue', { count: 2 });
  expect(classes.size).toBe(0); // Polls and queue decrements are not arrivals.
  reduced = true;
  event('somae:attention', { sequence: 8 });
  expect(classes.has('is-waving')).toBe(false);
  expect(classes.has('has-arrival')).toBe(true);
  expect(delays.at(-1)).toBe(1180);
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  expect(classes.size).toBe(0);
  expect(timeouts.size).toBe(0);
  event('somae:attention', { sequence: 9 });
  expect(classes.size).toBe(0);
});
