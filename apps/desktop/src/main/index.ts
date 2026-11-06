import { app, BrowserWindow, Tray, ApplicationMenu } from 'electrobun/main';
import { RESOURCES_FOLDER, VIEWS_FOLDER } from 'electrobun/main/paths';
import { openExternal } from 'electrobun/main/utils';
import { join } from 'node:path';
import { createDesktopHost, type DesktopPreferences, type DesktopLayout } from './host';
import { registerSummonShortcut } from './shortcut';
import { styleCompanionWindow } from './window';
import { createNativeNotifications } from './notifications';

let window: BrowserWindow | undefined;
let settings: BrowserWindow | undefined;
let beacon: BrowserWindow | undefined;
let windowAppearance: ReturnType<typeof styleCompanionWindow> | undefined;
let settingsAppearance: ReturnType<typeof styleCompanionWindow> | undefined;
let beaconAppearance: ReturnType<typeof styleCompanionWindow> | undefined;
let tray: Tray;
let shortcutRegistered = false;
let shortcutInvocations = 0;
let queueCount = 0;
let layoutMeasured = false;
let lastLayout: DesktopLayout | undefined;
let motionPoll: ReturnType<typeof setInterval> | undefined;
const nativeBridge = join(RESOURCES_FOLDER, 'app/native/shortcut.dylib');
const notifications = createNativeNotifications(nativeBridge, id => {
  show();
  emit(window, 'somae:signal-open', { id });
});
const host = await createDesktopHost({
  uiDirectory: join(VIEWS_FOLDER, 'mainview'),
  bridgeBundle: join(RESOURCES_FOLDER, 'app/bridge/server.js'),
  onHide: hide,
  notificationStatus: notifications.status,
  requestNotifications: notifications.request,
  onSignals: (signals, sequence) => {
    if (window?.isVisible()) return;
    if (beacon?.isVisible()) emit(beacon, 'somae:attention', { sequence });
    if (host.getPreferences().notifications) for (const signal of signals) notifications.post(signal);
  },
  onShow: show,
  onFocus: focusMain,
  onOpenExternal: url => { openExternal(url); },
  onSettingsOpen: openSettings,
  onSettingsClose: closeSettings,
  onPreferences: preferencesChanged,
  onLayout: resizeToContent,
  // Older views can still request an initial canvas size. Current views report
  // their measured content and then own subsequent sizing.
  onExpand: expanded => {
    if (!layoutMeasured) windowAppearance?.resize(expanded ? 1180 : 680,
      expanded ? 820 : 480, expanded);
  },
  onQueueCount: count => {
    tray?.setTitle(count ? `◒ ${count}` : '◒');
    if (count === queueCount) return;
    queueCount = count;
    emit(beacon, 'somae:queue', { count });
  },
  windowState: () => ({
    visible: window?.isVisible() ?? false,
    ...(window?.getFrame() ?? { x: 0, y: 0, width: 0, height: 0 }),
    beacon_visible: beacon?.isVisible() ?? false,
    settings_visible: settings?.isVisible() ?? false,
    shortcut_registered: shortcutRegistered,
    shortcut_invocations: shortcutInvocations,
    motion: windowAppearance?.motionState(),
  }),
});

function emit(target: BrowserWindow | undefined, name: string, detail?: unknown) {
  target?.webview.executeJavascript(`window.dispatchEvent(new CustomEvent(${JSON.stringify(name)}, {detail:${JSON.stringify(detail ?? null)}}))`);
}

function preventClose(event: unknown) {
  // Electrobun checks this response before destroying the native view. Hiding
  // retains the webview, its draft and the agent-owned processes.
  (event as { response: { allow: boolean } }).response = { allow: false };
}

function createMain() {
  layoutMeasured = false;
  window = new BrowserWindow({ title: 'Somae', url: host.viewUrl('main'),
    titleBarStyle: 'hidden', transparent: true, hidden: true,
    frame: { width: 680, height: 480 }, styleMask: { Closable: false } });
  windowAppearance = styleCompanionWindow(nativeBridge, window.ptr);
  window.on('will-close', event => { preventClose(event); hide(); });
  window.on('close', () => {
    windowAppearance?.dispose();
    windowAppearance = undefined;
    window = undefined;
    showBeacon();
  });
}

function show() {
  if (!window) createMain();
  beacon?.hide();
  window!.show();
  notifications.setVisible(true);
  focusMain();
  emit(window, 'somae:summon');
}

function focusMain() {
  if (!window?.isVisible()) return;
  window.activate();
  windowAppearance?.focusContent();
  emit(window, 'somae:focus');
}

function showBeacon() {
  if (!host.getPreferences().show_beacon || window?.isVisible()) {
    beacon?.hide();
    return;
  }
  if (!beacon) {
    beacon = new BrowserWindow({ title: 'Somae beacon', url: host.viewUrl('beacon'),
      titleBarStyle: 'hidden', transparent: true, hidden: true, activate: false,
      frame: { width: 268, height: 48 },
      styleMask: { Closable: false, Miniaturizable: false, Resizable: false } });
    beaconAppearance = styleCompanionWindow(nativeBridge, beacon.ptr,
      { kind: 'beacon', radius: 24, minimumWidth: 268, minimumHeight: 48,
        isVisible: () => beacon?.isVisible() ?? false,
        onOpen: show,
        onHover: hovered => emit(beacon, 'somae:beacon-hover', { hovered }),
      });
    beacon.on('will-close', event => { preventClose(event); beacon?.hide(); });
    beacon.on('close', () => {
      beaconAppearance?.dispose();
      beaconAppearance = undefined;
      beacon = undefined;
    });
  }
  if (!beacon.isVisible()) beaconAppearance?.placeBeacon();
  beacon.showInactive();
  emit(beacon, 'somae:queue', { count: queueCount, sequence: host.getAttentionSequence() });
}

function hide() {
  window?.hide();
  notifications.setVisible(false);
  if (!settings?.isVisible()) windowAppearance?.releaseFocus();
  showBeacon();
}

function openSettings() {
  if (!settings) {
    settings = new BrowserWindow({ title: 'Somae Settings', url: host.viewUrl('settings'),
      titleBarStyle: 'hiddenInset', transparent: true, hidden: true,
      frame: { width: 760, height: 600 }, trafficLightOffset: { x: 16, y: 16 },
      styleMask: { Closable: true, Miniaturizable: false, Resizable: true } });
    settingsAppearance = styleCompanionWindow(nativeBridge, settings.ptr,
      { kind: 'settings', minimumWidth: 640, minimumHeight: 480 });
    settingsAppearance.resize(760, 600);
    settings.on('will-close', event => { preventClose(event); closeSettings(); });
    settings.on('close', () => {
      settingsAppearance?.dispose();
      settingsAppearance = undefined;
      settings = undefined;
    });
  }
  settings.show();
  settings.activate();
  emit(settings, 'somae:preferences', host.getPreferences());
}

function closeSettings() {
  settings?.hide();
  if (window?.isVisible()) focusMain();
  else settingsAppearance?.releaseFocus();
}

function preferencesChanged(preferences: DesktopPreferences) {
  for (const target of [window, settings, beacon]) emit(target, 'somae:preferences', preferences);
  if (window?.isVisible()) beacon?.hide();
  else showBeacon();
  if (preferences.reduced_motion === 'reduce' && lastLayout) resizeToContent(lastLayout);
}

function resizeToContent(layout: DesktopLayout) {
  const animate = layoutMeasured && host.getPreferences().reduced_motion !== 'reduce';
  layoutMeasured = true;
  lastLayout = layout;
  const expanded = layout.view === 'review' || layout.view === 'library';
  windowAppearance?.resize(Math.min(expanded ? 1180 : 680, layout.width),
    layout.height, expanded, animate);
  if (motionPoll) clearInterval(motionPoll);
  motionPoll = undefined;
  if (!windowAppearance?.motionActive()) { emit(window, 'somae:layout-settled'); return; }
  emit(window, 'somae:layout-start');
  // AppKit drives frames. This observes completion only; Bun never steps the
  // window geometry or calls back from the native animation's main thread.
  motionPoll = setInterval(() => {
    if (windowAppearance?.motionActive()) return;
    clearInterval(motionPoll);
    motionPoll = undefined;
    emit(window, 'somae:layout-settled');
  }, 32);
}

show();
const summon = () => { shortcutInvocations++; if (window?.isVisible()) hide(); else show(); };
app.on('reopen', show);
const shortcut = registerSummonShortcut(nativeBridge, summon);
shortcutRegistered = shortcut.registered;
if (!shortcutRegistered) console.error(`Somae could not reserve Cmd Shift Space (macOS status ${shortcut.status}). Use Show Somae in the menu bar.`);
tray = new Tray({ title: '◒', template: true });
tray.setMenu([
  { type: 'normal', label: 'Show Somae', action: 'show' },
  { type: 'normal', label: 'Settings…', action: 'settings' },
  { type: 'normal', label: 'Quit Somae', action: 'quit' },
]);
const poll = setInterval(() => { void host.refresh(); }, 4000);
void host.refresh();
let quitting = false;
const quit = async () => {
  if (quitting) return;
  quitting = true;
  clearInterval(poll);
  if (motionPoll) clearInterval(motionPoll);
  shortcut.dispose();
  notifications.dispose();
  for (const appearance of [windowAppearance, settingsAppearance, beaconAppearance]) appearance?.dispose();
  await host.stop();
  process.exit(0);
};
process.on('SIGTERM', () => { void quit(); });
process.on('SIGINT', () => { void quit(); });
tray.on('tray-clicked', (event: unknown) => {
  const action = (event as { data: { action: string } }).data.action;
  if (action === 'quit') void quit();
  else if (action === 'settings') openSettings();
  else show();
});
ApplicationMenu.setApplicationMenu([
  { label: 'Somae', submenu: [
    { label: 'Settings…', action: 'settings', accelerator: ',' },
    { type: 'separator' },
    { label: 'Hide Somae', action: 'hide', accelerator: 'h' },
    { label: 'Quit Somae', action: 'quit', accelerator: 'q' },
  ] },
  { label: 'File', submenu: [{ label: 'Close Window', action: 'close', accelerator: 'w' }] },
  { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
]);
ApplicationMenu.on('application-menu-clicked', (event: unknown) => {
  const action = (event as { data: { action: string } }).data.action;
  if (action === 'quit') void quit();
  else if (action === 'settings') openSettings();
  else if (action === 'close' && settingsAppearance?.isKey()) closeSettings();
  else if (action === 'hide') {
    settings?.hide();
    hide();
  } else if (action === 'close') hide();
});
