import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopHost, type DesktopLayout, type DesktopPreferences } from './host';

test('desktop boot ticket, origin guard, private projections and drafts survive restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'somae-host-'));
  let unavailable = false;
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    expect(request.headers.get('authorization')).toBe('Bearer test-desktop-secret');
    if (unavailable) return Response.json({ error: 'offline' }, { status: 503 });
    return Response.json({ connections: [], items: [{ id: 'saved_item' }], drafts: {} });
  } });
  await mkdir(join(directory, 'ui'));
  await writeFile(join(directory, 'ui/index.html'), '<h1>Local Somae</h1>');
  for (const asset of ['controls.js', 'controls.css', 'claude.svg', 'signal-content.js', 'annotation-drafts.js']) await writeFile(join(directory, 'ui', asset), `fixture-${asset}`);
  await writeFile(join(directory, 'desktop.json'), JSON.stringify({ api_url: upstream.url.href, desktop_token: 'test-desktop-secret' }));
  let host = await createDesktopHost({ directory, uiDirectory: join(directory, 'ui'), bridgeBundle: '/unused', windowState: () => ({ visible: true }) });
  try {
    expect((await fetch(host.server.url)).status).toBe(401);
    const boot = await fetch(host.url, { redirect: 'manual' });
    expect(boot.status).toBe(303);
    const cookie = boot.headers.get('set-cookie')!.split(';')[0];
    expect(boot.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
    expect((await fetch(host.url, { redirect: 'manual' })).status).toBe(401);
    const page = await fetch(host.server.url, { headers: { cookie } });
    expect(page.headers.get('content-security-policy')).toContain("frame-src 'none'");
    for (const asset of ['controls.js', 'controls.css', 'claude.svg', 'signal-content.js', 'annotation-drafts.js']) {
      const response = await fetch(new URL(asset, host.server.url), { headers: { cookie } });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(`fixture-${asset}`);
    }
    const call = (path: string, body?: unknown, origin = host.server.url.origin) => fetch(new URL(path, host.server.url), { headers: { cookie, origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    expect((await call('/api/drafts', { key: 'new_message', draft: { message: 'Keep these words.' } }, 'https://foreign.example')).status).toBe(403);
    expect((await call('/api/operations', { type: 'session.register' })).status).toBe(403);
    expect((await call('/api/operations', { type: 'message.send', connection_id: 'unavailable' })).status).toBe(409);
    expect((await call('/api/drafts', { key: '../unsafe', draft: {} })).status).toBe(400);
    expect((await call('/api/drafts', { key: 'new_message', draft: { message: 'Keep these words.' } })).status).toBe(200);
    const view = await (await call('/api/state')).json();
    expect(JSON.stringify(view)).not.toContain('test-desktop-secret');
    expect(view.items[0].id).toBe('saved_item');
    expect(view.native_window.visible).toBe(true);
    await host.stop();
    unavailable = true;
    host = await createDesktopHost({ directory, uiDirectory: join(directory, 'ui'), bridgeBundle: '/unused' });
    const nextBoot = await fetch(host.url, { redirect: 'manual' });
    const nextCookie = nextBoot.headers.get('set-cookie')!.split(';')[0];
    expect(nextCookie).not.toBe(cookie);
    const restored = await (await fetch(new URL('/api/state', host.server.url), { headers: { cookie: nextCookie } })).json();
    expect(restored.offline).toBe(true);
    expect(restored.items[0].id).toBe('saved_item');
    expect(restored.drafts.new_message.message).toBe('Keep these words.');
    expect(JSON.parse(await readFile(join(directory, 'drafts.json'), 'utf8')).new_message.message).toBe('Keep these words.');
  } finally { await host.stop(); upstream.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('signal web links require a deliberate authenticated request and never open local or privileged schemes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'somae-links-'));
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({}) });
  await writeFile(join(directory, 'desktop.json'), JSON.stringify({ api_url: upstream.url.href, desktop_token: 'fictional-link-token' }));
  const opened: string[] = [];
  let host = await createDesktopHost({ directory, uiDirectory: directory, bridgeBundle: '/unused', onOpenExternal: url => { opened.push(url); } });
  try {
    const boot = await fetch(host.url, { redirect: 'manual' });
    const cookie = boot.headers.get('set-cookie')!.split(';')[0];
    const endpoint = new URL('/api/links/open', host.server.url);
    const call = (body: unknown, origin = host.server.url.origin) => fetch(endpoint, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await fetch(endpoint, { method: 'POST', headers: { origin: host.server.url.origin, 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com' }) })).status).toBe(401);
    expect((await call({ url: 'https://example.com' }, 'https://foreign.example')).status).toBe(403);
    for (const body of [{}, null, [], { url: 12 }, { url: 'https://example.com', extra: true }, { url: 'https://example.com/' + 'x'.repeat(4096) }, ...['javascript:alert(1)', 'data:text/html,evil', 'file:///tmp/private', '/api/operations', '//example.com', 'somae://send', 'http://user:secret@example.com', 'https://exa\nmple.com', ' https://example.com', 'https://'].map(url => ({ url }))]) expect((await call(body)).status).toBe(400);
    expect(opened).toEqual([]);
    expect((await call({ url: 'https://example.com/path?a=1&b=2' })).status).toBe(200);
    expect(opened).toEqual(['https://example.com/path?a=1&b=2']);
    expect((await call({ url: 'http://example.com' })).status).toBe(200);
    expect(opened[1]).toBe('http://example.com/');
    await host.stop();
    host = await createDesktopHost({ directory, uiDirectory: directory, bridgeBundle: '/unused' });
    const nextBoot = await fetch(host.url, { redirect: 'manual' });
    const unavailable = await fetch(new URL('/api/links/open', host.server.url), { method: 'POST', headers: { cookie: nextBoot.headers.get('set-cookie')!.split(';')[0], origin: host.server.url.origin, 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com' }) });
    expect(unavailable.status).toBe(503);
    expect(opened).toHaveLength(2);
  } finally { await host.stop(); upstream.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('local settings, independent window tickets and layout requests stay authenticated and survive restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'somae-settings-'));
  let upstreamCalls = 0;
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    expect(request.headers.get('authorization')).toBe('Bearer private-cloud-token');
    upstreamCalls++;
    return Response.json({ signals: [
      { state: 'active', cleared: false },
      { state: 'active', cleared: false, view: { set_aside: true } },
      { state: 'active', cleared: true },
      { state: 'withdrawn', cleared: false },
    ] });
  } });
  const uiDirectory = join(directory, 'ui');
  await mkdir(uiDirectory);
  for (const asset of ['index.html', 'settings.html', 'settings.js', 'settings.css', 'beacon.html', 'beacon.js', 'beacon.css', 'preferences.js', 'layout.js', 'image-gesture.js', 'review-context.js']) await writeFile(join(uiDirectory, asset), `fixture-${asset}`);
  await writeFile(join(directory, 'desktop.json'), JSON.stringify({ api_url: upstream.url.href, desktop_token: 'private-cloud-token' }));
  const applied: DesktopPreferences[] = [];
  const layouts: DesktopLayout[] = [];
  const actions: string[] = [];
  let host = await createDesktopHost({ directory, uiDirectory, bridgeBundle: '/unused', onPreferences: p => { applied.push(p); }, onLayout: p => { layouts.push(p); }, onHide: () => { actions.push('hide'); }, onShow: () => { actions.push('show'); }, onFocus: () => { actions.push('focus'); }, onSettingsOpen: () => { actions.push('settings-open'); }, onSettingsClose: () => { actions.push('settings-close'); } });
  try {
    const initial: DesktopPreferences = { theme: 'electric', show_beacon: true, reduced_motion: 'system', notifications: false };
    expect(host.getPreferences()).toEqual(initial);
    host.getPreferences().show_beacon = false;
    expect(host.getPreferences()).toEqual(initial);
    const cookieFor = async (url: string, path: string) => {
      const boot = await fetch(url, { redirect: 'manual' });
      expect(boot.status).toBe(303);
      expect(boot.headers.get('location')).toBe(path);
      expect(boot.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict; Path=/');
      expect((await fetch(url, { redirect: 'manual' })).status).toBe(401);
      return boot.headers.get('set-cookie')!.split(';')[0];
    };
    const cookie = await cookieFor(host.url, '/');
    const settingsUrl = host.viewUrl('settings');
    const wrongPath = new URL(settingsUrl); wrongPath.pathname = '/beacon';
    expect((await fetch(wrongPath, { redirect: 'manual' })).status).toBe(401);
    const settingsCookie = await cookieFor(settingsUrl, '/settings');
    expect(settingsCookie).toBe(cookie);
    expect(await cookieFor(host.viewUrl('beacon'), '/beacon')).toBe(cookie);
    expect(() => host.viewUrl('foreign' as 'main')).toThrow('Unknown Somae window');
    for (const path of ['/settings', '/settings.html', '/settings.js', '/settings.css', '/beacon', '/beacon.html', '/beacon.js', '/beacon.css', '/preferences.js', '/layout.js', '/image-gesture.js', '/review-context.js']) {
      expect((await fetch(new URL(path, host.server.url))).status).toBe(401);
      const page = await fetch(new URL(path, host.server.url), { headers: { cookie } });
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toContain("frame-src 'none'");
      expect(await page.text()).toBe(`fixture-${path === '/settings' ? 'settings.html' : path === '/beacon' ? 'beacon.html' : path.slice(1)}`);
    }
    const call = (path: string, body?: unknown, origin = host.server.url.origin) => fetch(new URL(path, host.server.url), { headers: { cookie, origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    expect(await (await call('/api/preferences')).json()).toEqual(initial);
    expect(await (await call('/api/shell')).json()).toEqual({ queue_count: 0, attention_sequence: 0, preferences: initial });
    expect(upstreamCalls).toBe(0);
    await host.refresh();
    expect(await (await call('/api/shell')).json()).toEqual({ queue_count: 1, attention_sequence: 0, preferences: initial });
    expect(upstreamCalls).toBe(1);
    for (const invalid of [null, [], { theme: 'foreign' }, { theme: ['electric'] }, { show_beacon: 1 }, { notifications: 1 }, { reduced_motion: 'never' }, { reduced_motion: 'full' }, { reduced_motion: ['system'] }, { desktop_token: 'replacement' }, { theme: 'infrared', unknown: true }]) {
      expect((await call('/api/preferences', invalid)).status).toBe(400);
      expect(host.getPreferences()).toEqual(initial);
    }
    expect((await call('/api/preferences', { theme: 'infrared' }, 'https://foreign.example')).status).toBe(403);
    expect((await call('/api/preferences', { theme: 'infrared' })).status).toBe(200);
    expect((await call('/api/preferences', { reduced_motion: 'reduce', show_beacon: false })).status).toBe(200);
    const selected: DesktopPreferences = { theme: 'infrared', show_beacon: false, reduced_motion: 'reduce', notifications: false };
    expect(host.getPreferences()).toEqual(selected);
    expect(applied).toEqual([{ ...initial, theme: 'infrared' }, selected]);
    const persisted = await readFile(join(directory, 'preferences.json'), 'utf8');
    expect(JSON.parse(persisted)).toEqual(selected);
    expect(persisted).not.toContain('private-cloud-token');
    expect(JSON.stringify(await (await call('/api/shell')).json())).not.toContain('private-cloud-token');
    const layout: DesktopLayout = { view: 'inbox', width: 680, height: 410 };
    expect((await call('/api/layout', layout)).status).toBe(200);
    expect(layouts).toEqual([layout]);
    for (const invalid of [null, [], { ...layout, unknown: true }, { width: 680, height: 410 }, { ...layout, view: 'settings' }, { ...layout, view: ['inbox'] }, { ...layout, width: '680' }, { ...layout, width: 479 }, { ...layout, width: 1401 }, { ...layout, height: 239 }, { ...layout, height: 1601 }, { ...layout, height: null }]) expect((await call('/api/layout', invalid)).status).toBe(400);
    expect((await call('/api/layout', layout, 'https://foreign.example')).status).toBe(403);
    expect(layouts).toEqual([layout]);
    for (const [path, action] of [['/api/hide', 'hide'], ['/api/show', 'show'], ['/api/focus', 'focus'], ['/api/settings/open', 'settings-open'], ['/api/settings/close', 'settings-close']]) {
      expect((await fetch(new URL(path!, host.server.url), { method: 'POST', headers: { origin: host.server.url.origin, 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
      expect((await call(path!, {}, 'https://foreign.example')).status).toBe(403);
      expect(actions).not.toContain(action!);
      expect((await call(path!, {})).status).toBe(200);
      expect(actions.at(-1)).toBe(action!);
    }
    await host.stop();
    host = await createDesktopHost({ directory, uiDirectory, bridgeBundle: '/unused' });
    expect(host.getPreferences()).toEqual(selected);
    const restoredCookie = await cookieFor(host.viewUrl('settings'), '/settings');
    expect(restoredCookie).not.toBe(cookie);
    const shell = await (await fetch(new URL('/api/shell', host.server.url), { headers: { cookie: restoredCookie } })).json();
    expect(shell).toEqual({ queue_count: 1, attention_sequence: 0, preferences: selected });
    expect(upstreamCalls).toBe(1);
  } finally { await host.stop(); upstream.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('review decisions wait for explicit stateful service support without posting or discarding drafts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'somae-review-rollout-'));
  let supported: boolean | undefined;
  let questionSupported: boolean | undefined;
  const posted: Record<string, unknown>[] = [];
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    expect(request.headers.get('authorization')).toBe('Bearer rollout-test-secret');
    if (new URL(request.url).pathname === '/v1/library') return Response.json({ service_release: supported ? 'current' : 'previous', ...(supported === undefined ? {} : { review_decisions_supported: supported }), ...(questionSupported === undefined ? {} : { question_feedback_supported: questionSupported }), signals: [], drafts: {} });
    posted.push(await request.json() as Record<string, unknown>);
    return Response.json({ review_id: 'review_saved_once', delivery_id: 'delivery_saved_once' });
  } });
  const uiDirectory = join(directory, 'ui');
  await mkdir(uiDirectory);
  await writeFile(join(uiDirectory, 'index.html'), 'Isolated rollout fixture');
  await writeFile(join(directory, 'desktop.json'), JSON.stringify({ api_url: upstream.url.href, desktop_token: 'rollout-test-secret' }));
  // A fresh older projection must override an earlier supported cache too.
  await writeFile(join(directory, 'library-cache.json'), JSON.stringify({ review_decisions_supported: true }));
  const host = await createDesktopHost({ directory, uiDirectory, bridgeBundle: '/unused' });
  try {
    const boot = await fetch(host.url, { redirect: 'manual' });
    const cookie = boot.headers.get('set-cookie')!.split(';')[0];
    const call = (path: string, body?: unknown) => fetch(new URL(path, host.server.url), { headers: { cookie, origin: host.server.url.origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    const draft = { comments: [{ artifact_id: 'artifact_review', revision: 1, text: 'Keep these notes.' }], note: 'Ready with these details.' };
    expect((await call('/api/drafts', { key: 'conversation_review', draft })).status).toBe(200);
    const review = { type: 'review.submit', idempotency_key: 'decision_one', conversation_id: 'conversation_review', decision: 'approve', artifacts: [{ artifact_id: 'artifact_review', revision: 1 }], comments: draft.comments, note: draft.note };
    const legacy = { type: 'version.approve', artifact_id: 'artifact_review', revision: 1, expected_sequence: 0 };
    for (const capability of [undefined, false]) {
      supported = capability;
      for (const operation of [review, legacy]) {
        const response = await call('/api/operations', operation);
        expect(response.status).toBe(503);
        expect((await response.json()).error).toBe('service_updating');
      }
      expect(posted).toEqual([]);
      expect(JSON.parse(await readFile(join(directory, 'drafts.json'), 'utf8')).conversation_review).toEqual(draft);
      const view = await (await call('/api/state')).json();
      expect(view.drafts.conversation_review).toEqual(draft);
    }
    supported = true;
    const question = { type: 'review.submit', idempotency_key: 'answer_one', conversation_id: 'conversation_review', artifacts: review.artifacts, comments: draft.comments, source_request: { signal_id: 'original_question', expected_revision: 1, interaction_id: 'question_interaction', value: { option_id: 'opaque_option' } } };
    for (const capability of [undefined, false]) {
      questionSupported = capability;
      const response = await call('/api/operations', question);
      expect(response.status).toBe(503);
      expect((await response.json()).error).toBe('service_updating');
      expect(posted).toEqual([]);
      expect(JSON.parse(await readFile(join(directory, 'drafts.json'), 'utf8')).conversation_review).toEqual(draft);
    }
    questionSupported = true;
    expect((await call('/api/operations', question)).status).toBe(200);
    expect(posted).toEqual([question]);
    expect((await call('/api/operations', review)).status).toBe(200);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toEqual(review);
    expect(JSON.parse(await readFile(join(directory, 'drafts.json'), 'utf8'))).not.toHaveProperty('conversation_review');
  } finally { await host.stop(); upstream.stop(); await rm(directory, { recursive: true, force: true }); }
});
