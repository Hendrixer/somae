import { initPreferences, reduceMotion } from './preferences.js';

const button = document.querySelector('.beacon-open');
const label = document.querySelector('#beacon-count');
const shell = document.querySelector('.beacon-shell');
const hand = document.querySelector('.beacon-hand');
let fetching = false;
let sequence;
let waveTimer;

function showCount(value) {
  const count = Math.max(0, Math.trunc(Number(value) || 0));
  label.textContent = `${count} signal${count === 1 ? '' : 's'}`;
  button.setAttribute('aria-label', `Open Somae. ${count} signal${count === 1 ? '' : 's'}${count === 0 ? '. All clear' : ' waiting for you'}.`);
}

function attend(value, initial = false) {
  if (!Number.isSafeInteger(value) || value < 0) return;
  const previous = sequence;
  sequence = Math.max(sequence ?? value, value);
  if (initial || previous === undefined || value <= previous || document.hidden) return;
  clearTimeout(waveTimer);
  shell.classList.remove('is-waving', 'has-arrival');
  // Four brief waves per arrival, then idle even if the beacon stays closed.
  void shell.offsetWidth;
  const reduced = reduceMotion();
  shell.classList.add(reduced ? 'has-arrival' : 'is-waving');
  const animation = getComputedStyle(hand);
  const milliseconds = value => parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
  // Follow the actual CSS timing; the final swish trails the hand by 50ms.
  const duration = reduced ? 1180 : milliseconds(animation.animationDuration) * Number(animation.animationIterationCount) + 80;
  waveTimer = setTimeout(() => shell.classList.remove('is-waving', 'has-arrival'), duration);
}

async function refresh() {
  if (fetching || document.hidden) return;
  fetching = true;
  try {
    const response = await fetch('/api/shell');
    if (!response.ok) return;
    const state = await response.json();
    showCount(state.queue_count);
    attend(state.attention_sequence);
  } catch {
    // Keep the last known count while the local host reconnects.
  } finally { fetching = false; }
}

button.addEventListener('click', async () => {
  if (button.disabled) return;
  button.disabled = true;
  try {
    const response = await fetch('/api/show', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('Unable to open Somae');
  } catch { button.setAttribute('aria-label', 'Couldn’t open Somae. Try again.'); }
  finally { button.disabled = false; }
});
window.addEventListener('somae:queue', event => { showCount(event.detail?.count); attend(event.detail?.sequence, true); });
window.addEventListener('somae:attention', event => attend(event.detail?.sequence));
window.addEventListener('somae:beacon-hover', event => shell.classList.toggle('is-hovered', event.detail?.hovered === true));
window.addEventListener('somae:preferences-changed', () => {
  if (reduceMotion()) shell.classList.remove('is-waving');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(waveTimer); shell.classList.remove('is-waving', 'has-arrival'); }
  else void refresh();
});
await initPreferences().catch(() => {});
await refresh();
setInterval(() => void refresh(), 1500);
