import { test, expect, spyOn } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopHost } from './host';

async function sessionFixture(registrationDelay = 0) {
  const directory = await mkdtemp(join(tmpdir(), 'somae-sessions-'));
  const uiDirectory = join(directory, 'ui');
  const workspace = join(directory, 'workspace');
  await Promise.all([mkdir(uiDirectory), mkdir(workspace)]);
  await writeFile(join(uiDirectory, 'index.html'), '<h1>Fictional session test</h1>');
  const registrations: Record<string, unknown>[] = [];
  const history = {
    connections: [{ id: 'saved_connection' }],
    conversations: [{ id: 'saved_conversation', connection_id: 'saved_connection' }],
    items: [{ id: 'saved_original', title: 'An existing original' }],
    reviews: [{ id: 'saved_review', artifact_revision: 1 }],
    signals: [], drafts: {},
  };
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    expect(request.headers.get('authorization')).toBe('Bearer fictional-desktop-token');
    const path = new URL(request.url).pathname;
    if (path === '/v1/library') return Response.json(history);
    if (path !== '/v1/operations' || request.method !== 'POST') return Response.json({ error: 'not_found' }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    expect(body.type).toBe('session.register');
    registrations.push(body);
    if (registrationDelay) await Bun.sleep(registrationDelay);
    const id = String(body.session_id);
    return Response.json({ connection_id: `connection-${id}`, endpoint_id: `endpoint-${id}`, endpoint_token: `fictional-endpoint-${id}` }, { status: 201 });
  } });
  await writeFile(join(directory, 'desktop.json'), JSON.stringify({ api_url: upstream.url.href, desktop_token: 'fictional-desktop-token' }));
  const options = { directory, uiDirectory, bridgeBundle: '/unused-test-bridge' };
  let host = await createDesktopHost(options);
  let bridgeToken = '';
  let cookie = '';
  const authenticate = async () => {
    bridgeToken = JSON.parse(await readFile(join(directory, 'bridge.json'), 'utf8')).token;
    const boot = await fetch(host.url, { redirect: 'manual' });
    expect(boot.status).toBe(303);
    cookie = boot.headers.get('set-cookie')!.split(';')[0]!;
  };
  await authenticate();
  return {
    directory, workspace, history, registrations,
    bridge(path: string, body: unknown, authorization: string | null = `Bearer ${bridgeToken}`) {
      return fetch(new URL(path, host.server.url), { method: 'POST', headers: { 'content-type': 'application/json', ...(authorization === null ? {} : { authorization }) }, body: JSON.stringify(body) });
    },
    async state() {
      const response = await fetch(new URL('/api/state', host.server.url), { headers: { cookie } });
      expect(response.status).toBe(200);
      return response.json();
    },
    async restart() { await host.stop(); host = await createDesktopHost(options); await authenticate(); },
    async dispose() { await host.stop(); upstream.stop(); await rm(directory, { recursive: true, force: true }); },
  };
}

test('bridge presence expires, disconnects only the authenticated exact session and keeps durable records and history', async () => {
  const fixture = await sessionFixture();
  let now = Date.now();
  const clock = spyOn(Date, 'now').mockImplementation(() => now);
  try {
    const sessions = [];
    for (const title of ['First terminal', 'Second terminal']) {
      const response = await fixture.bridge('/bridge/register', { workspace: fixture.workspace, session_id: crypto.randomUUID(), title });
      expect(response.status).toBe(200);
      sessions.push(await response.json());
    }
    const [first, second] = sessions;
    expect((await fixture.state()).local_sessions.every((session: { online: boolean }) => !session.online)).toBe(true);
    for (const session of sessions) expect((await fixture.bridge('/bridge/heartbeat', { connection_id: session.connection_id })).status).toBe(200);
    const online = await fixture.state();
    expect(online.local_sessions.every((session: { online: boolean }) => session.online)).toBe(true);
    now += 11_999;
    expect((await fixture.state()).local_sessions.every((session: { online: boolean }) => session.online)).toBe(true);
    now++;
    expect((await fixture.state()).local_sessions.every((session: { online: boolean }) => !session.online)).toBe(true);
    for (const session of sessions) await fixture.bridge('/bridge/heartbeat', { connection_id: session.connection_id });

    for (const authorization of [null, 'Bearer wrong-test-token']) {
      expect((await fixture.bridge('/bridge/disconnect', { connection_id: first.connection_id }, authorization)).status).toBe(401);
      expect((await fixture.bridge('/bridge/heartbeat', { connection_id: first.connection_id }, authorization)).status).toBe(401);
    }
    expect((await fixture.state()).local_sessions.every((session: { online: boolean }) => session.online)).toBe(true);
    expect((await fixture.bridge('/bridge/disconnect', { connection_id: 'unknown-connection' })).status).toBe(404);
    expect((await fixture.bridge('/bridge/disconnect', { connection_id: first.connection_id })).status).toBe(200);
    const disconnected = await fixture.state();
    expect(disconnected.local_sessions.find((session: { id: string }) => session.id === first.connection_id).online).toBe(false);
    expect(disconnected.local_sessions.find((session: { id: string }) => session.id === second.connection_id).online).toBe(true);
    expect(disconnected.local_sessions).toHaveLength(2);
    for (const key of ['connections', 'conversations', 'items', 'reviews'] as const) expect(disconnected[key]).toEqual(fixture.history[key]);

    // Older hosts could save a recent heartbeat while writing another session.
    // A restart must still require a fresh lease from the live bridge.
    const priorRecords = JSON.parse(await readFile(join(fixture.directory, 'sessions.json'), 'utf8'));
    priorRecords.find((session: { connection_id: string }) => session.connection_id === second.connection_id).heartbeat = now;
    await writeFile(join(fixture.directory, 'sessions.json'), JSON.stringify(priorRecords));
    await fixture.restart();
    const restored = await fixture.state();
    expect(restored.local_sessions.map((session: { id: string }) => session.id)).toEqual(sessions.map(session => session.connection_id));
    expect(restored.local_sessions.every((session: { online: boolean }) => !session.online)).toBe(true);
    for (const key of ['connections', 'conversations', 'items', 'reviews'] as const) expect(restored[key]).toEqual(fixture.history[key]);
    const persisted = JSON.parse(await readFile(join(fixture.directory, 'sessions.json'), 'utf8'));
    expect(persisted.map((session: { session_id: string }) => session.session_id)).toEqual(sessions.map(session => session.session_id));
    expect(fixture.registrations).toHaveLength(2);
  } finally { clock.mockRestore(); await fixture.dispose(); }
});

test('concurrent bridge registrations share one local session and one upstream registration', async () => {
  const fixture = await sessionFixture(50);
  try {
    const registration = { workspace: fixture.workspace, session_id: crypto.randomUUID(), title: 'One Claude session' };
    const responses = await Promise.all(Array.from({ length: 8 }, () => fixture.bridge('/bridge/register', registration)));
    expect(responses.map(response => response.status)).toEqual(Array(8).fill(200));
    const registered = await Promise.all(responses.map(response => response.json()));
    expect(new Set(registered.map(session => session.connection_id)).size).toBe(1);
    expect(new Set(registered.map(session => session.endpoint_id)).size).toBe(1);
    expect(new Set(registered.map(session => session.config)).size).toBe(1);
    expect(fixture.registrations).toHaveLength(1);
    expect((await fixture.state()).local_sessions).toHaveLength(1);
    const persisted = JSON.parse(await readFile(join(fixture.directory, 'sessions.json'), 'utf8'));
    expect(persisted).toHaveLength(1);
    expect(persisted[0].session_id).toBe(registration.session_id);
    expect((await fixture.bridge('/bridge/register', registration)).status).toBe(200);
    expect(fixture.registrations).toHaveLength(1);
  } finally { await fixture.dispose(); }
});

test('distinct Claude sessions in one folder remain distinct and an existing session cannot change folders', async () => {
  const fixture = await sessionFixture();
  try {
    const firstId = crypto.randomUUID();
    const responses = await Promise.all([firstId, crypto.randomUUID()].map(session_id => fixture.bridge('/bridge/register', { workspace: fixture.workspace, session_id, title: 'Same project' })));
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const sessions = await Promise.all(responses.map(response => response.json()));
    expect(sessions[0].connection_id).not.toBe(sessions[1].connection_id);
    expect((await fixture.state()).local_sessions).toHaveLength(2);
    expect(fixture.registrations).toHaveLength(2);
    expect(fixture.registrations[0]!.workspace_id).toBe(fixture.registrations[1]!.workspace_id);
    const otherWorkspace = join(fixture.directory, 'another-workspace');
    await mkdir(otherWorkspace);
    const rejected = await fixture.bridge('/bridge/register', { workspace: otherWorkspace, session_id: firstId, title: 'Same project' });
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).message).toContain('different project folder');
    expect(fixture.registrations).toHaveLength(2);
    expect((await fixture.state()).local_sessions).toHaveLength(2);
  } finally { await fixture.dispose(); }
});
