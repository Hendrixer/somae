import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDesktopHost, type IncomingSignal, type NotificationStatus } from './host';
import { createNativeNotifications } from './notifications';

test('signal attention baselines startup and deduplicates identity across revisions, set aside, returns and offline recovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'somae-attention-'));
  let offline = false;
  let signals: Record<string, unknown>[] = [{ id: 'historical', state: 'active', revision: 1 }];
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    return offline ? new Response('', { status: 503 }) : Response.json({ signals, conversations: [{ id: 'work-conversation', connection_id: 'claude' }, { id: 'custom-conversation', connection_id: 'custom' }], connections: [{ id: 'claude', name: 'Notes project', agent: 'Claude Code' }, { id: 'custom', name: 'Research agent' }] });
  } });
  await mkdir(join(directory, 'ui'));
  await writeFile(join(directory, 'desktop.json'), JSON.stringify({ api_url: upstream.url.href, desktop_token: 'fictional-notification-token' }));
  const arrivals: { signals: IncomingSignal[]; sequence: number }[] = [];
  let host = await createDesktopHost({ directory, uiDirectory: join(directory, 'ui'), bridgeBundle: '/unused', onSignals: (signals, sequence) => arrivals.push({ signals, sequence }) });
  try {
    await host.refresh();
    expect(arrivals).toHaveLength(0);
    signals = [{ id: 'historical', state: 'active', revision: 2 }, { id: 'aside', state: 'active', view: { set_aside: true } }];
    await host.refresh();
    signals = signals.map(signal => ({ ...signal, view: { set_aside: false } }));
    await host.refresh();
    expect(arrivals).toHaveLength(0);
    signals.push({ id: 'fresh', state: 'active', conversation_id: 'work-conversation', content: [{ type: 'text', text: '\n  Review these files  \nExtra details stay in Somae.' }] });
    await host.refresh();
    expect(arrivals).toEqual([{ signals: [{ id: 'fresh', title: 'Review these files', sender: 'Claude Code' }], sequence: 1 }]);
    signals = signals.map(signal => ({ ...signal, state: 'withdrawn' }));
    await host.refresh();
    signals = signals.map(signal => ({ ...signal, state: 'active' }));
    await host.refresh();
    offline = true;
    expect(await host.refresh()).toBe(false);
    offline = false;
    signals.push({ id: 'offline-new', state: 'active', conversation_id: 'custom-conversation', content: [{ type: 'text', text: '  ' }, { type: 'markdown', text: '  Research is ready\nMore context.' }] });
    await host.refresh();
    expect(arrivals).toHaveLength(2);
    expect(arrivals[1]).toEqual({ signals: [{ id: 'offline-new', title: 'Research is ready', sender: 'Research agent' }], sequence: 2 });
    await host.stop();
    host = await createDesktopHost({ directory, uiDirectory: join(directory, 'ui'), bridgeBundle: '/unused', onSignals: (signals, sequence) => arrivals.push({ signals, sequence }) });
    await host.refresh();
    expect(arrivals).toHaveLength(2);
  } finally { await host.stop(); upstream.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('notification permission is explicit, origin guarded and never enabled by permission request alone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'somae-notification-pref-'));
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ signals: [] }) });
  await mkdir(join(directory, 'ui'));
  await writeFile(join(directory, 'desktop.json'), JSON.stringify({ api_url: upstream.url.href, desktop_token: 'fictional-notification-token' }));
  let permission: NotificationStatus = 'not_determined';
  let requests = 0;
  const host = await createDesktopHost({ directory, uiDirectory: join(directory, 'ui'), bridgeBundle: '/unused', notificationStatus: () => permission, requestNotifications: () => { requests++; return permission; } });
  try {
    expect(requests).toBe(0);
    expect(host.getPreferences().notifications).toBe(false);
    const boot = await fetch(host.url, { redirect: 'manual' });
    const cookie = boot.headers.get('set-cookie')!.split(';')[0]!;
    const call = (path: string, body?: unknown, origin = host.server.url.origin) => fetch(new URL(path, host.server.url), { headers: { cookie, origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    expect((await call('/api/preferences', { notifications: true })).status).toBe(409);
    expect((await call('/api/notifications/permission', {}, 'https://other.example')).status).toBe(403);
    expect(requests).toBe(0);
    expect(await (await call('/api/notifications/permission', {})).json()).toEqual({ status: 'not_determined' });
    expect(requests).toBe(1);
    expect(host.getPreferences().notifications).toBe(false);
    permission = 'denied';
    expect((await call('/api/preferences', { notifications: true })).status).toBe(409);
    permission = 'allowed';
    expect((await call('/api/preferences', { notifications: true })).status).toBe(200);
    expect(JSON.parse(await readFile(join(directory, 'preferences.json'), 'utf8')).notifications).toBe(true);
    expect((await call('/api/preferences', { notifications: false })).status).toBe(200);
    expect(host.getPreferences().notifications).toBe(false);
  } finally { await host.stop(); upstream.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('native notification bridge stays unavailable in unbundled tests and cannot prompt or deliver', () => {
  const notifications = createNativeNotifications(resolve('dist/native/shortcut.dylib'), () => { throw new Error('No test notification should activate.'); });
  try {
    expect(notifications.status()).toBe('unavailable');
    expect(notifications.request()).toBe('unavailable');
    notifications.setVisible(false);
    expect(notifications.post({ id: 'test', title: 'Do not send', sender: 'Fixture' })).toBe(false);
  } finally { notifications.dispose(); }
});
