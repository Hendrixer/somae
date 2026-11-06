import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule } from 'node:vm';
import type { DesktopPreferences } from '../main/host';

type PreferencesModule = {
  initPreferences(): Promise<DesktopPreferences>;
  setPreferences(patch: Partial<DesktopPreferences>): Promise<DesktopPreferences>;
  currentPreferences(): DesktopPreferences;
};

// Each module gets its own DOM, events and network. None of these substitutes
// touch the globals used by host/channel tests in the same Bun process.
async function isolatedView() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { hidden: false, documentElement: { dataset: {} } });
  const requests: { method: string; body: unknown; respond(value: DesktopPreferences): void; fail(error: Error): void }[] = [];
  const broadcasts: DesktopPreferences[] = [];
  const context = createContext({
    window, document, CustomEvent,
    matchMedia: () => ({ matches: false }),
    setInterval: () => 0,
    BroadcastChannel: class {
      addEventListener() {}
      postMessage(value: DesktopPreferences) { broadcasts.push(structuredClone(value)); }
    },
    fetch: (path: string, options?: RequestInit) => {
      expect(path).toBe('/api/preferences');
      return new Promise((resolve, reject) => requests.push({
        method: options?.method ?? 'GET',
        body: options?.body ? JSON.parse(String(options.body)) : undefined,
        respond: value => resolve({ ok: true, json: async () => structuredClone(value) }),
        fail: reject,
      }));
    },
  });
  const url = new URL('./preferences.js', import.meta.url);
  const module = new SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href });
  await module.link(() => { throw new Error('The appearance module must not import a privileged host.'); });
  await module.evaluate();
  return {
    api: module.namespace as unknown as PreferencesModule,
    requests, broadcasts,
    notify(value: DesktopPreferences) { window.dispatchEvent(new CustomEvent('somae:preferences', { detail: value })); },
  };
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('appearance keeps newer native preferences over delayed reads and sends rapid changes in order', async () => {
  const view = await isolatedView();
  const electric: DesktopPreferences = { theme: 'electric', show_beacon: true, reduced_motion: 'system', notifications: false };
  const infrared: DesktopPreferences = { ...electric, theme: 'infrared' };
  const initial = view.api.initPreferences();
  expect(view.requests.map(request => request.method)).toEqual(['GET']);
  view.notify(infrared);
  view.requests[0]!.respond(electric);
  await initial;
  expect(view.api.currentPreferences()).toEqual(infrared);

  const first = view.api.setPreferences({ theme: 'afterhours' });
  const second = view.api.setPreferences({ theme: 'electric' });
  await settle();
  const posts = () => view.requests.filter(request => request.method === 'POST');
  expect(posts()).toHaveLength(1);
  expect(posts()[0]!.body).toEqual({ theme: 'afterhours' });

  // The native event can contain another window's newer change while the
  // first POST's older full snapshot is still crossing back to this view.
  const latest: DesktopPreferences = { theme: 'afterhours', show_beacon: false, reduced_motion: 'reduce', notifications: false };
  view.notify(latest);
  posts()[0]!.respond({ ...electric, theme: 'afterhours' });
  expect(await first).toEqual(latest);
  await settle();
  expect(posts()).toHaveLength(2);
  expect(posts()[1]!.body).toEqual({ theme: 'electric' });
  expect(view.api.currentPreferences()).toEqual(latest);
  expect(view.broadcasts).toEqual([latest]);

  const final: DesktopPreferences = { ...latest, theme: 'electric' };
  posts()[1]!.respond(final);
  expect(await second).toEqual(final);
  expect(view.api.currentPreferences()).toEqual(final);
  expect(view.broadcasts).toEqual([latest, final]);

  const failedReadView = await isolatedView();
  const failedInitial = failedReadView.api.initPreferences();
  failedReadView.notify(latest);
  failedReadView.requests[0]!.fail(new Error('Local host temporarily unavailable.'));
  expect(await failedInitial).toEqual(latest);
  expect(failedReadView.api.currentPreferences()).toEqual(latest);
});
