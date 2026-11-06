// Local appearance is shared by all three windows; changing it never re-renders a draft.
const defaults = { theme: 'electric', show_beacon: true, reduced_motion: 'system', notifications: false };
let preferences = { ...defaults };
let initialized;
let epoch = 0;
let writes = Promise.resolve();
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('somae-preferences') : null;

function apply(value) {
  if (!value || !['electric', 'infrared', 'afterhours'].includes(value.theme) || typeof value.show_beacon !== 'boolean' || !['system', 'reduce'].includes(value.reduced_motion) || (value.notifications !== undefined && typeof value.notifications !== 'boolean')) return;
  const changed = JSON.stringify(preferences) !== JSON.stringify(value);
  preferences = { theme: value.theme, show_beacon: value.show_beacon, reduced_motion: value.reduced_motion, notifications: value.notifications === true };
  document.documentElement.dataset.theme = preferences.theme;
  document.documentElement.dataset.reducedMotion = String(preferences.reduced_motion === 'reduce');
  if (changed) {
    epoch++;
    window.dispatchEvent(new CustomEvent('somae:preferences-changed', { detail: currentPreferences() }));
  }
}

async function read() {
  const started = epoch;
  const response = await fetch('/api/preferences');
  if (!response.ok) throw new Error('Appearance could not be loaded.');
  const value = await response.json();
  if (started === epoch) apply(value);
  return currentPreferences();
}

export function currentPreferences() { return { ...preferences }; }
export function reduceMotion() { return preferences.reduced_motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches; }
export function initPreferences() {
  if (!initialized) {
    apply(preferences);
    initialized = read().catch(() => currentPreferences());
  }
  return initialized;
}
export function setPreferences(patch) {
  const next = writes.catch(() => {}).then(async () => {
    const started = ++epoch;
    const response = await fetch('/api/preferences', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? 'Appearance could not be saved.');
    if (started === epoch) apply(result);
    channel?.postMessage(currentPreferences());
    return currentPreferences();
  });
  writes = next;
  return next;
}
window.addEventListener('somae:preferences', event => apply(event.detail));
channel?.addEventListener('message', event => apply(event.data));
document.addEventListener('visibilitychange', () => { if (!document.hidden) void read().catch(() => {}); });
// A low-cost localhost fallback for webviews without BroadcastChannel. No cloud request.
setInterval(() => { if (!document.hidden) void read().catch(() => {}); }, 3000);
