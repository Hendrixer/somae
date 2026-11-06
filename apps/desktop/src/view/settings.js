import { initPreferences, currentPreferences, setPreferences } from './preferences.js';

const tabs = [...document.querySelectorAll('[data-tab]')];
const status = document.querySelector('#settings-status');
let activeTab = 'general';
let pending = 0;
let permissionPending = false;
const notificationToggle = document.querySelector('#notifications');
const notificationDescription = document.querySelector('#notification-permission');

function chooseTab(name, focus = false) {
  if (!tabs.some(tab => tab.dataset.tab === name)) return;
  activeTab = name;
  for (const tab of tabs) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
    if (selected && focus) tab.focus();
  }
}

function syncPreferences() {
  const preferences = currentPreferences();
  document.querySelector('#show-beacon').checked = preferences.show_beacon;
  if (!permissionPending) notificationToggle.checked = preferences.notifications;
  for (const option of document.querySelectorAll('[data-theme-choice]')) {
    const selected = option.dataset.themeChoice === preferences.theme;
    option.setAttribute('aria-checked', String(selected));
    option.tabIndex = selected ? 0 : -1;
  }
  for (const option of document.querySelectorAll('[data-motion]')) {
    const selected = option.dataset.motion === preferences.reduced_motion;
    option.setAttribute('aria-checked', String(selected));
    option.tabIndex = selected ? 0 : -1;
  }
}

async function save(patch) {
  pending++;
  status.classList.remove('error');
  status.textContent = 'Saving…';
  try {
    await setPreferences(patch);
    if (pending === 1) status.textContent = 'Saved on this Mac.';
  } catch {
    status.classList.add('error');
    status.textContent = 'Couldn’t save. Please try again.';
  } finally {
    pending--;
    syncPreferences();
  }
}

async function notificationState() {
  const response = await fetch('/api/notifications');
  if (!response.ok) throw new Error('Notification settings are unavailable.');
  const { status: permission } = await response.json();
  const messages = { unavailable: 'Available in the native Somae app.', denied: 'Blocked by macOS. Allow Somae in System Settings → Notifications.', error: 'macOS notifications are unavailable. Try again.', requesting: 'Choose Allow in the macOS permission prompt.' };
  notificationDescription.textContent = messages[permission] ?? 'New signals when Somae is closed. Silent by default.';
  return permission;
}
notificationToggle.addEventListener('change', async () => {
  if (!notificationToggle.checked) { await save({ notifications: false }); return; }
  permissionPending = true;
  notificationToggle.disabled = true;
  try {
    const response = await fetch('/api/notifications/permission', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('Notification permission could not be requested.');
    let permission = (await response.json()).status;
    const deadline = Date.now() + 90_000;
    while (permission === 'requesting' && Date.now() < deadline) {
      notificationDescription.textContent = 'Choose Allow in the macOS permission prompt.';
      await new Promise(resolve => setTimeout(resolve, 750));
      permission = await notificationState();
    }
    if (permission === 'allowed') await save({ notifications: true });
    await notificationState();
  } catch {
    notificationDescription.textContent = 'Couldn’t enable notifications. Please try again.';
  } finally {
    permissionPending = false;
    notificationToggle.disabled = false;
    syncPreferences();
  }
});
window.addEventListener('focus', () => { void notificationState().catch(() => {}); });
void notificationState().catch(() => {});
setInterval(() => { if (!document.hidden && !permissionPending) void notificationState().catch(() => {}); }, 3000);

tabs.forEach(tab => tab.addEventListener('click', () => chooseTab(tab.dataset.tab)));
document.querySelector('[role="tablist"]').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = tabs.findIndex(tab => tab.dataset.tab === activeTab);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  chooseTab(tabs[next].dataset.tab, true);
});
document.querySelector('#show-beacon').addEventListener('change', event => void save({ show_beacon: event.target.checked }));
for (const group of document.querySelectorAll('[role="radiogroup"]')) {
  const choices = [...group.querySelectorAll('[role="radio"]')];
  const select = option => void save(option.dataset.themeChoice ? { theme: option.dataset.themeChoice } : { reduced_motion: option.dataset.motion });
  choices.forEach(option => option.addEventListener('click', () => select(option)));
  group.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = Math.max(0, choices.indexOf(document.activeElement));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + choices.length) % choices.length;
    choices[next].focus();
    select(choices[next]);
  });
}
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === ',') event.preventDefault();
  if (((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w') || event.key === 'Escape') {
    event.preventDefault();
    void fetch('/api/settings/close', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {
      status.classList.add('error'); status.textContent = 'Couldn’t close settings. Please try again.';
    });
  }
});
window.addEventListener('somae:preferences-changed', syncPreferences);
try {
  await initPreferences();
  syncPreferences();
} catch {
  status.classList.add('error');
  status.textContent = 'Couldn’t load settings. Reopen this window to try again.';
}
