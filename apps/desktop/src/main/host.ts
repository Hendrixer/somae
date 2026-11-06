import { mkdir, readFile, writeFile, realpath, stat, copyFile, rename } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Terminal as TerminalScreen } from '@xterm/headless';
import { apiClient, ApiError } from '../../../../packages/claude-channel/src/api-client';
import { launchClaude, claudeExecutable } from '../../../../packages/claude-channel/src/launch';

type Session = { session_id: string; workspace: string; name: string; connection_id: string; endpoint_id: string; endpoint_token: string; directory: string; config: string; mode: 'managed' | 'terminal'; heartbeat?: number };
export type DesktopPreferences = { theme: 'electric' | 'infrared' | 'afterhours'; show_beacon: boolean; reduced_motion: 'system' | 'reduce'; notifications: boolean };
export type DesktopLayout = { view: 'inbox' | 'library' | 'review' | 'connections' | 'onboarding'; width: number; height: number };
export type IncomingSignal = { id: string; title: string; sender: string };
export type NotificationStatus = 'unavailable' | 'not_determined' | 'denied' | 'allowed' | 'requesting' | 'error';
export type DesktopView = 'main' | 'settings' | 'beacon';
type ServiceView = Record<string, unknown> & { review_decisions_supported?: boolean; question_feedback_supported?: boolean };
type Options = { uiDirectory: string; bridgeBundle: string; runtime?: string; directory?: string; onHide?: () => void; onShow?: () => void; onFocus?: () => void; onSettingsOpen?: () => void; onSettingsClose?: () => void; onOpenExternal?: (url: string) => void; onExpand?: (expanded: boolean) => void; onLayout?: (layout: DesktopLayout) => void; onPreferences?: (preferences: DesktopPreferences) => void; onQueueCount?: (count: number) => void; onSignals?: (signals: IncomingSignal[], sequence: number) => void; notificationStatus?: () => NotificationStatus; requestNotifications?: () => NotificationStatus; windowState?: () => { visible: boolean } };
const defaultPreferences: DesktopPreferences = { theme: 'electric', show_beacon: true, reduced_motion: 'system', notifications: false };
const viewPaths: Record<DesktopView, string> = { main: '/', settings: '/settings', beacon: '/beacon' };
const safeEqual = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function updatePreferences(value: unknown, current: DesktopPreferences): DesktopPreferences {
  if (!isRecord(value) || Object.keys(value).some(key => !Object.hasOwn(defaultPreferences, key)) ||
    ('theme' in value && (typeof value.theme !== 'string' || !['electric', 'infrared', 'afterhours'].includes(value.theme))) ||
    ('show_beacon' in value && typeof value.show_beacon !== 'boolean') ||
    ('notifications' in value && typeof value.notifications !== 'boolean') ||
    ('reduced_motion' in value && (typeof value.reduced_motion !== 'string' || !['system', 'reduce'].includes(value.reduced_motion)))) throw new Error('Choose a supported appearance preference.');
  return { ...current, ...value } as DesktopPreferences;
}

export async function createDesktopHost(options: Options) {
  const directory = options.directory ?? join(homedir(), 'Library/Application Support/Somae');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const configuration = JSON.parse(await readFile(join(directory, 'desktop.json'), 'utf8'));
  const api = apiClient(configuration.api_url, configuration.desktop_token);
  const token = crypto.randomUUID() + crypto.randomUUID();
  const tickets = new Map<string, string>();
  let server: ReturnType<typeof Bun.serve>;
  let sessions: Session[] = [];
  const registrations = new Map<string, Promise<Session>>();
  const children = new Map<string, Awaited<ReturnType<typeof launchClaude>>>();
  const terminals = new Map<string, TerminalScreen>();
  let drafts: Record<string, unknown> = {};
  let cachedView: ServiceView = {};
  let preferences = { ...defaultPreferences };
  let queueCount = 0;
  let attentionSequence = 0;
  let signalsInitialized = false;
  const seenSignals = new Set<string>();
  const load = async (name: string, fallback: unknown) => { try { return JSON.parse(await readFile(join(directory, name), 'utf8')); } catch { return fallback; } };
  // Presence is a live lease, never evidence restored from a previous app run.
  sessions = (await load('sessions.json', []) as Session[]).map(session => ({ ...session, heartbeat: 0 }));
  drafts = await load('drafts.json', {});
  cachedView = await load('library-cache.json', {});
  try { preferences = updatePreferences(await load('preferences.json', {}), defaultPreferences); } catch { /* Invalid local settings never change the supported defaults. */ }
  const countQueue = () => {
    const signals = cachedView.signals as { state: string; cleared: boolean; view?: { set_aside?: boolean } }[] | undefined;
    queueCount = signals?.filter(s => s.state === 'active' && !s.cleared && !s.view?.set_aside).length ?? 0;
  };
  countQueue();
  const writes = new Map<string, Promise<void>>();
  const save = (name: string, value: unknown) => {
    const serialized = JSON.stringify(value);
    const next = (writes.get(name) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const temporary = join(directory, `${name}.${crypto.randomUUID()}.tmp`);
      await writeFile(temporary, serialized, { mode: 0o600 });
      await rename(temporary, join(directory, name));
    });
    writes.set(name, next);
    return next;
  };
  const operation = (value: Record<string, unknown>) => api.operation({ idempotency_key: crypto.randomUUID(), ...value });
  let refreshing: Promise<boolean> | undefined;
  const refresh = () => refreshing ??= (async () => {
    try {
      cachedView = await api.json('/v1/library');
      await save('library-cache.json', cachedView);
      countQueue();
      options.onQueueCount?.(queueCount);
      // Identity, not count: returning a set-aside signal, revisions and replies
      // never replay attention. The first successful sync establishes baseline.
      const signals = Array.isArray(cachedView.signals) ? cachedView.signals as Record<string, unknown>[] : [];
      const incoming = signals.filter(signal => typeof signal.id === 'string' && !seenSignals.has(signal.id) &&
        signal.state === 'active' && !signal.cleared && !(signal.view as { set_aside?: boolean } | undefined)?.set_aside);
      for (const signal of signals) if (typeof signal.id === 'string') seenSignals.add(signal.id);
      if (signalsInitialized && incoming.length) {
        attentionSequence++;
        const connections = Array.isArray(cachedView.connections) ? cachedView.connections as Record<string, unknown>[] : [];
        const conversations = Array.isArray(cachedView.conversations) ? cachedView.conversations as Record<string, unknown>[] : [];
        options.onSignals?.(incoming.map(signal => {
          const conversation = conversations.find(conversation => conversation.id === signal.conversation_id);
          const connection = connections.find(connection => connection.id === (conversation?.connection_id ?? signal.connection_id));
          const content = Array.isArray(signal.content) ? signal.content as Record<string, unknown>[] : [];
          const text = content.find(block => (block.type === 'text' || block.type === 'markdown') && typeof block.text === 'string' && block.text.trim())?.text;
          const firstLine = typeof text === 'string' ? text.split(/\r?\n/).find(line => line.trim())?.trim() : undefined;
          return { id: String(signal.id),
            title: (firstLine || (typeof signal.title === 'string' ? signal.title.trim() : '') || 'A new signal is waiting for you.').slice(0, 240),
            sender: String(connection?.agent ?? connection?.name ?? 'Somae').slice(0, 80),
          };
        }), attentionSequence);
      }
      signalsInitialized = true;
      return true;
    } catch { return false; } finally { refreshing = undefined; }
  })();
  const publicSessions = () => sessions.map(s => ({ id: s.connection_id, name: s.name, workspace: s.workspace, mode: s.mode, online: Date.now() - (s.heartbeat ?? 0) < 12_000, managed: children.has(s.connection_id) }));

  async function register(workspaceInput: string, sessionId: string, title: string, mode: Session['mode']) {
    if (typeof workspaceInput !== 'string' || !/^[a-f0-9-]{36}$/i.test(sessionId) || !title.trim() || title.length > 160) throw new Error('A project folder, short name and exact Claude session ID are required.');
    const workspace = await realpath(workspaceInput);
    if (!(await stat(workspace)).isDirectory()) throw new Error('Choose a project folder.');
    const existing = sessions.find(s => s.session_id === sessionId);
    if (existing) {
      if (existing.workspace !== workspace) throw new Error('This Claude session is bound to a different project folder.');
      return existing;
    }
    const pending = registrations.get(sessionId);
    if (pending) {
      const session = await pending;
      if (session.workspace !== workspace) throw new Error('This Claude session is bound to a different project folder.');
      return session;
    }
    const registration = (async () => {
      const result = await operation({ type: 'session.register', idempotency_key: `session:${sessionId}`, session_id: sessionId, workspace_id: createHash('sha256').update(workspace).digest('hex'), title });
      const sessionDirectory = join(directory, 'sessions', sessionId);
      await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
      const session: Session = { session_id: sessionId, workspace, name: title, connection_id: result.connection_id, endpoint_id: result.endpoint_id, endpoint_token: result.endpoint_token, directory: sessionDirectory, config: join(sessionDirectory, 'channel.json'), mode };
      await writeFile(join(sessionDirectory, 'session.json'), JSON.stringify({ api_url: configuration.api_url, ...session, callback_url: server.url.href, callback_token: token }), { mode: 0o600 });
      await writeFile(session.config, JSON.stringify({ mcpServers: { somae: { command: options.runtime ?? process.execPath, args: [options.bridgeBundle], env: { SOMAE_SESSION_CONFIG: join(sessionDirectory, 'session.json'), SOMAE_WORKSPACE: workspace } } } }), { mode: 0o600 });
      sessions.push(session);
      await save('sessions.json', sessions);
      return session;
    })();
    registrations.set(sessionId, registration);
    try { return await registration; }
    finally { registrations.delete(sessionId); }
  }

  async function start(workspace: string, title?: string, connectionId?: string) {
    const previous = connectionId ? sessions.find(s => s.connection_id === connectionId) : undefined;
    if (previous && children.has(previous.connection_id)) return { connection_id: previous.connection_id };
    const session = previous ?? await register(workspace, crypto.randomUUID(), title?.trim() || basename(workspace), 'managed');
    // Refresh callback port/credential after an app restart without changing the bound Claude session.
    await writeFile(join(session.directory, 'session.json'), JSON.stringify({ api_url: configuration.api_url, ...session, callback_url: server.url.href, callback_token: token }), { mode: 0o600 });
    terminals.get(session.connection_id)?.dispose();
    const screen = new TerminalScreen({ cols: 100, rows: 32, scrollback: 300, allowProposedApi: true });
    terminals.set(session.connection_id, screen);
    const child = await launchClaude({ workspace: session.workspace, config: session.config, name: `Somae · ${session.name}`, onOutput: text => screen.write(text), ...(previous ? { resume: session.session_id } : { sessionId: session.session_id }) });
    children.set(session.connection_id, child);
    void child.process.exited.then(async () => {
      children.delete(session.connection_id);
      session.heartbeat = 0;
      await apiClient(configuration.api_url, session.endpoint_token).operation({ type: 'session.availability', idempotency_key: `offline:${crypto.randomUUID()}`, online: false }).catch(() => {});
    });
    return { connection_id: session.connection_id };
  }

  async function installTerminal() {
    const runtime = options.runtime ?? process.execPath;
    const installed = join(directory, 'bridge', 'server.js');
    await mkdir(join(directory, 'bridge'), { recursive: true, mode: 0o700 });
    await copyFile(options.bridgeBundle, installed);
    const claude = await claudeExecutable();
    let userConfig: { mcpServers?: Record<string, { command?: string; args?: string[] }> } = {};
    try { userConfig = JSON.parse(await readFile(join(homedir(), '.claude.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Claude’s user configuration could not be read. Keep it intact and repair it before connecting.'); }
    const existing = userConfig.mcpServers?.somae;
    if (existing && (existing.command !== runtime || JSON.stringify(existing.args) !== JSON.stringify([installed]))) throw new Error('A different Somae MCP configuration already exists. Keep it intact and choose its scope explicitly.');
    if (!existing) {
      const added = Bun.spawn([claude, 'mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'somae', '--', runtime, installed], { stdout: 'ignore', stderr: 'ignore' });
      if (await added.exited !== 0) throw new Error('Claude could not install the Somae connection.');
    }
    const bin = join(homedir(), '.local', 'bin');
    await mkdir(bin, { recursive: true });
    const entry = join(directory, 'bridge', 'terminal.js');
    await writeFile(entry, `const args=process.argv.slice(2);const resume=args.indexOf('--resume');if(resume>=0&&!/^[a-f0-9-]{36}$/i.test(args[resume+1]??'')){console.error('Resume an exact session with somae-claude --resume <session-id>.');process.exit(1);}const session=resume>=0?args[resume+1]:crypto.randomUUID();const command=${JSON.stringify(claude)};const child=Bun.spawn([command,'--dangerously-load-development-channels','server:somae',...(resume>=0?[]:['--session-id',session]),...args],{stdin:'inherit',stdout:'inherit',stderr:'inherit',env:{...process.env,SOMAE_SESSION_ID:session}});process.exitCode=await child.exited;`);
    const wrapper = join(bin, 'somae-claude');
    try { const current = await readFile(wrapper, 'utf8'); if (!current.includes(entry)) throw new Error('An unrelated somae-claude command already exists.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
    await writeFile(wrapper, `#!/bin/sh\nexec ${quote(runtime)} ${quote(entry)} "$@"\n`, { mode: 0o700 });
    return { command: wrapper, installed: true };
  }

  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  server = Bun.serve({
    hostname: '127.0.0.1', port: 0, idleTimeout: 30, maxRequestBodySize: 512 * 1024,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.origin !== server.url.origin) return json({ error: 'host_disallowed' }, 403);
      const ticket = url.searchParams.get('ticket');
      if (request.method === 'GET' && ticket && tickets.get(ticket) === url.pathname) {
        tickets.delete(ticket);
        return new Response(null, { status: 303, headers: { location: url.pathname, 'set-cookie': `somae_session=${token}; HttpOnly; SameSite=Strict; Path=/`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
      }
      const bridge = url.pathname.startsWith('/bridge/');
      const provided = bridge ? request.headers.get('authorization')?.replace(/^Bearer /, '') : request.headers.get('cookie')?.match(/(?:^|; )somae_session=([^;]+)/)?.[1];
      if (!provided || !safeEqual(provided, token)) return json({ error: 'unauthorized', message: 'Open this window from Somae.' }, 401);
      if (!bridge && request.method !== 'GET' && request.headers.get('origin') !== server.url.origin) return json({ error: 'origin_disallowed' }, 403);
      try {
        if (bridge) {
          if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
          const body = await request.json() as Record<string, string | number>;
          if (url.pathname === '/bridge/register') {
            const session = await register(String(body.workspace), String(body.session_id), String(body.title), 'terminal');
            return json({ api_url: configuration.api_url, ...session, callback_url: server.url.href, callback_token: token });
          }
          if (url.pathname === '/bridge/heartbeat' || url.pathname === '/bridge/disconnect') {
            const session = sessions.find(s => s.connection_id === body.connection_id);
            if (!session) return json({ error: 'not_found' }, 404);
            session.heartbeat = url.pathname === '/bridge/disconnect' ? 0 : Date.now();
            return json({ ok: true });
          }
        }
        if (url.pathname === '/api/state' && request.method === 'GET') {
          const offline = !await refresh();
          return json({ ...cachedView, drafts: { ...(cachedView.drafts as object ?? {}), ...drafts }, local_sessions: publicSessions(), offline, native_window: options.windowState?.() });
        }
        if (url.pathname === '/api/preferences' && request.method === 'GET') return json(preferences);
        if (url.pathname === '/api/preferences' && request.method === 'POST') {
          const next = updatePreferences(await request.json(), preferences);
          if (next.notifications && !preferences.notifications && options.notificationStatus?.() !== 'allowed')
            return json({ error: 'notification_permission', message: 'Allow notifications in macOS before enabling them.' }, 409);
          preferences = next;
          const saved = { ...preferences };
          await save('preferences.json', saved);
          options.onPreferences?.(saved);
          return json(saved);
        }
        if (url.pathname === '/api/notifications' && request.method === 'GET') return json({ status: options.notificationStatus?.() ?? 'unavailable' });
        if (url.pathname === '/api/notifications/permission' && request.method === 'POST') return json({ status: options.requestNotifications?.() ?? 'unavailable' });
        if (url.pathname === '/api/links/open' && request.method === 'POST') {
          const body = await request.json();
          if (!isRecord(body) || Object.keys(body).length !== 1 || typeof body.url !== 'string' || body.url.length > 4096 ||
            !/^https?:\/\//i.test(body.url) || /[\u0000-\u001f\u007f]/.test(body.url)) return json({ error: 'link_invalid' }, 400);
          let link: URL;
          try { link = new URL(body.url); } catch { return json({ error: 'link_invalid' }, 400); }
          if (!['http:', 'https:'].includes(link.protocol) || !link.hostname || link.username || link.password) return json({ error: 'link_invalid' }, 400);
          if (!options.onOpenExternal) return json({ error: 'link_unavailable', message: 'Open links from the native Somae app.' }, 503);
          options.onOpenExternal(link.href);
          return json({ ok: true });
        }
        if (url.pathname === '/api/shell' && request.method === 'GET') return json({ queue_count: queueCount, attention_sequence: attentionSequence, preferences });
        if (url.pathname === '/api/operations' && request.method === 'POST') {
          const body = await request.json() as Record<string, unknown>;
          const allowed = ['message.send', 'review.submit', 'version.approve', 'draft.save', 'inbox.mark', 'response.submit'];
          if (!allowed.includes(String(body.type))) return json({ error: 'operation_unsupported' }, 403);
          if (body.type === 'version.approve' || body.type === 'review.submit' && Object.hasOwn(body, 'decision')) {
            // Worker and Durable Object rollouts can briefly run different code.
            // An older object accepts review.submit but ignores its verdict, so
            // require support reported by the stateful service before posting.
            await refresh();
            if (cachedView.review_decisions_supported !== true) return json({ error: 'service_updating', message: 'Somae is finishing an update. Your feedback is saved; try sending this decision again shortly.' }, 503);
          }
          if (body.type === 'review.submit' && !Object.hasOwn(body, 'decision') && isRecord(body.source_request)) {
            await refresh();
            if (cachedView.question_feedback_supported !== true) return json({ error: 'service_updating', message: 'Somae is finishing an update. Your answer and comments are saved; try again shortly.' }, 503);
          }
          if (body.type === 'message.send') {
            const view = cachedView as { conversations?: { id: string; connection_id: string }[] };
            const connection = body.connection_id ?? view.conversations?.find(c => c.id === body.conversation_id)?.connection_id;
            const local = sessions.find(s => s.connection_id === connection);
            if (!local || Date.now() - (local.heartbeat ?? 0) >= 12_000) return json({ error: 'endpoint_unavailable', message: 'Reconnect this Claude session before starting new work.' }, 409);
          }
          if (body.type === 'draft.save') { drafts[String(body.conversation_id)] = body.draft; await save('drafts.json', drafts); }
          const result = await operation(body);
          if (body.type === 'review.submit') { delete drafts[String(body.conversation_id)]; await save('drafts.json', drafts); }
          return json(result);
        }
        if (url.pathname === '/api/sessions/start' && request.method === 'POST') {
          const body = await request.json() as { workspace: string; title?: string; connection_id?: string };
          return json(await start(body.workspace, body.title, body.connection_id));
        }
        if (url.pathname === '/api/sessions/terminal') {
          const connectionId = url.searchParams.get('connection') ?? '';
          const child = children.get(connectionId);
          if (!child) return json({ error: 'session_unavailable', message: 'This session is not running inside Somae.' }, 409);
          if (request.method === 'GET') {
            const buffer = terminals.get(connectionId)?.buffer.active;
            const lines = buffer ? Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) ?? '') : [];
            return json({ output: lines.join('\n').trimEnd(), running: true });
          }
          if (request.method === 'POST') {
            const body = await request.json() as { key: string };
            const keys: Record<string, string> = { enter: '\r', escape: '\x1b', up: '\x1b[A', down: '\x1b[B', '1': '1', '2': '2', '3': '3', '4': '4' };
            if (!Object.hasOwn(keys, body.key)) return json({ error: 'key_invalid' }, 400);
            child.terminal.write(keys[body.key]);
            return json({ sent: true });
          }
        }
        if (url.pathname === '/api/terminal/install' && request.method === 'POST') return json(await installTerminal());
        if (url.pathname === '/api/drafts' && request.method === 'POST') {
          const body = await request.json() as { key: string; draft: unknown };
          if (!/^[a-zA-Z0-9_-]{1,160}$/.test(body.key) || JSON.stringify(body.draft).length > 200_000) return json({ error: 'draft_invalid' }, 400);
          drafts[body.key] = body.draft;
          await save('drafts.json', drafts);
          return json({ saved: true });
        }
        if (url.pathname === '/api/hide' && request.method === 'POST') { options.onHide?.(); return json({ ok: true }); }
        if (url.pathname === '/api/show' && request.method === 'POST') { options.onShow?.(); return json({ ok: true }); }
        if (url.pathname === '/api/focus' && request.method === 'POST') { options.onFocus?.(); return json({ ok: true }); }
        if (url.pathname === '/api/settings/open' && request.method === 'POST') { options.onSettingsOpen?.(); return json({ ok: true }); }
        if (url.pathname === '/api/settings/close' && request.method === 'POST') { options.onSettingsClose?.(); return json({ ok: true }); }
        if (url.pathname === '/api/layout' && request.method === 'POST') {
          const body: unknown = await request.json();
          if (!isRecord(body) || Object.keys(body).length !== 3 || Object.keys(body).some(key => !['view', 'width', 'height'].includes(key)) ||
            typeof body.view !== 'string' || !['inbox', 'library', 'review', 'connections', 'onboarding'].includes(body.view) ||
            typeof body.width !== 'number' || !Number.isFinite(body.width) || body.width < 480 || body.width > 1400 ||
            typeof body.height !== 'number' || !Number.isFinite(body.height) || body.height < 240 || body.height > 1600) return json({ error: 'layout_invalid' }, 400);
          options.onLayout?.(body as DesktopLayout);
          return json({ ok: true });
        }
        if (url.pathname === '/api/expand' && request.method === 'POST') { options.onExpand?.(!!(await request.json() as { expanded: boolean }).expanded); return json({ ok: true }); }
        if (url.pathname.startsWith('/api/originals/')) {
          const digest = url.pathname.split('/').at(-1)!;
          if (!/^[a-f0-9]{64}$/.test(digest)) return json({ error: 'not_found' }, 404);
          const response = await api.request(`/v1/originals/${digest}`);
          return new Response(response.body, { headers: { 'content-type': response.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', ...(url.searchParams.has('download') ? { 'content-disposition': response.headers.get('content-disposition') ?? 'attachment' } : {}), 'content-security-policy': "default-src 'none'; sandbox" } });
        }
        const files: Record<string, string> = { '/': 'index.html', '/app.js': 'app.js', '/app.css': 'app.css', '/controls.js': 'controls.js', '/controls.css': 'controls.css', '/preferences.js': 'preferences.js', '/layout.js': 'layout.js', '/image-gesture.js': 'image-gesture.js', '/review-context.js': 'review-context.js', '/signal-content.js': 'signal-content.js', '/annotation-drafts.js': 'annotation-drafts.js', '/settings': 'settings.html', '/settings.html': 'settings.html', '/settings.js': 'settings.js', '/settings.css': 'settings.css', '/beacon': 'beacon.html', '/beacon.html': 'beacon.html', '/beacon.js': 'beacon.js', '/beacon.css': 'beacon.css', '/tokens.css': 'tokens.css', '/wave.svg': 'wave.svg', '/claude.svg': 'claude.svg' };
        if (request.method === 'GET' && files[url.pathname]) return new Response(Bun.file(join(options.uiDirectory, files[url.pathname])), { headers: { 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'", 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
        return json({ error: 'not_found' }, 404);
      } catch (error) { return json({ error: error instanceof ApiError ? error.code : 'operation_failed', message: error instanceof Error ? error.message : 'Try again.' }, error instanceof ApiError ? error.status : 400); }
    },
  });
  await save('bridge.json', { url: server.url.href, token });
  const viewUrl = (view: DesktopView) => {
    if (!Object.hasOwn(viewPaths, view)) throw new Error('Unknown Somae window.');
    const ticket = crypto.randomUUID();
    tickets.set(ticket, viewPaths[view]);
    return new URL(`${viewPaths[view]}?ticket=${ticket}`, server.url).href;
  };
  return {
    url: viewUrl('main'), viewUrl, getAttentionSequence: () => attentionSequence, getPreferences: () => ({ ...preferences }),
    server, start, installTerminal, refresh,
    async stop() { await Promise.all([...writes.values()]); for (const child of children.values()) child.stop(); for (const screen of terminals.values()) screen.dispose(); server.stop(); },
  };
}
