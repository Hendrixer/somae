import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Database } from 'bun:sqlite';
import { mkdir, realpath, writeFile, readFile } from 'node:fs/promises';
import { resolve, relative, extname, basename, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { channelInstructions, tools } from './protocol.js';
import { apiClient } from './api-client';

type Input = { delivery_id: string; input_id: string; conversation_id: string; content: string; artifact_refs: { artifact_id: string; revision: number }[] };
type Row = { id: string; payload: string; stage: string };
const home = join(homedir(), 'Library/Application Support/Somae');
const workspace = await realpath(process.env.SOMAE_WORKSPACE ?? process.cwd());
let configuration: { api_url: string; endpoint_token: string; connection_id: string; endpoint_id: string; directory: string; callback_url?: string; callback_token?: string };
if (process.env.SOMAE_SESSION_CONFIG) configuration = JSON.parse(await readFile(process.env.SOMAE_SESSION_CONFIG, 'utf8'));
else {
  const bootstrap = JSON.parse(await readFile(join(home, 'bridge.json'), 'utf8'));
  const response = await fetch(new URL('/bridge/register', bootstrap.url), { method: 'POST', headers: { authorization: `Bearer ${bootstrap.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ workspace, session_id: process.env.SOMAE_SESSION_ID ?? crypto.randomUUID(), title: basename(workspace) }) });
  if (!response.ok) throw new Error('Open Somae before connecting this Claude session.');
  configuration = await response.json();
}
await mkdir(configuration.directory, { recursive: true, mode: 0o700 });
const db = new Database(join(configuration.directory, 'handoff.sqlite'), { create: true });
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS inputs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, stage TEXT NOT NULL); CREATE TABLE IF NOT EXISTS results (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS contexts (id TEXT PRIMARY KEY)');
const api = apiClient(configuration.api_url, configuration.endpoint_token);
const operation = (type: string, key: string, values: Record<string, unknown> = {}) => api.operation({ type, idempotency_key: key, ...values });
const rowFor = (id: string) => db.query<Row, [string]>('SELECT * FROM inputs WHERE id=?').get(id);
const setStage = (id: string, stage: string) => db.query('UPDATE inputs SET stage=? WHERE id=?').run(stage, id);
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest('hex');
let online = true;
const pollingAbort = new AbortController();
let onlineAnnouncement: Promise<unknown> = Promise.resolve();
let shutdown: Promise<void> | undefined;
const mcp = new Server({ name: 'somae', version: '0.1.0' }, { capabilities: { experimental: { 'claude/channel': {} }, tools: {} }, instructions: channelInstructions });
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

async function accepted(input: Input) {
  await operation('input.accept', `accept:${input.input_id}`, { delivery_id: input.delivery_id });
  setStage(input.input_id, 'accepted');
}

mcp.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const args = request.params.arguments ?? {};
    const tool = request.params.name;
    if (tool === 'request_review' && Object.keys(args).some(key => !['conversation_id', 'input_id', 'text', 'artifacts'].includes(key))) throw new Error('request_review accepts conversation_id, optional input_id, text and exact artifacts only. Somae supplies Approve and Request changes; do not provide choices or custom actions.');
    if (tool === 'open_conversation') {
      if (typeof args.title !== 'string' || typeof args.text !== 'string') throw new Error('A title and opening message are required.');
      const result = await operation('agent.open', `open:${hash(args)}`, { title: args.title, text: args.text });
      db.query('INSERT OR IGNORE INTO contexts(id) VALUES(?)').run(result.conversation_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
    let input: Input | undefined;
    if (args.input_id !== undefined) {
      const row = rowFor(String(args.input_id));
      if (!row) throw new Error('Unknown Somae input.');
      input = JSON.parse(row.payload);
      if (input!.conversation_id !== args.conversation_id) throw new Error('Conversation does not match this input.');
      await accepted(input!);
    } else if (!db.query('SELECT id FROM contexts WHERE id=?').get(String(args.conversation_id))) throw new Error('Use the exact channel input IDs, or open_conversation for work requested in the terminal.');
    if (tool === 'acknowledge_input') {
      if (!input) throw new Error('Only an actual Somae input can be acknowledged.');
      return { content: [{ type: 'text' as const, text: 'Input accepted in this Claude session.' }] };
    }
    let bytes: Uint8Array | undefined;
    let metadata: Record<string, unknown> | undefined;
    if (tool === 'publish_artifact') {
      if (typeof args.path !== 'string' || typeof args.title !== 'string' || !args.title.trim()) throw new Error('A file path and title are required.');
      const path = await realpath(resolve(workspace, args.path));
      const inside = relative(workspace, path);
      if (!inside || inside.startsWith('..') || inside.split('/').some(p => p.startsWith('.'))) throw new Error('Publish a visible file inside this selected project.');
      const media: Record<string, string> = { '.md': 'text/markdown', '.txt': 'text/plain', '.html': 'text/html', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      const mediaType = media[extname(path).toLowerCase()];
      const file = Bun.file(path);
      if (!mediaType || file.size > 20 * 1024 * 1024) throw new Error('Supported documents/images must be at most 20 MB.');
      bytes = new Uint8Array(await file.arrayBuffer());
      const digest = createHash('sha256').update(bytes).digest('hex');
      await mkdir(join(configuration.directory, 'originals'), { recursive: true, mode: 0o700 });
      await writeFile(join(configuration.directory, 'originals', digest), bytes, { mode: 0o600 });
      metadata = { conversation_id: args.conversation_id, title: args.title, filename: basename(path), media_type: mediaType, ...(args.artifact_id ? { artifact_id: args.artifact_id, expected_revision: args.expected_revision } : {}), ...(args.review_id ? { review_id: args.review_id } : {}) };
    } else if (tool !== 'reply' && tool !== 'ask_question' && tool !== 'request_review') throw new Error('Unknown tool.');
    const key = `publish:${hash([input?.input_id ?? args.conversation_id, tool, metadata ?? args, bytes ? createHash('sha256').update(bytes).digest('hex') : null])}`;
    const cached = db.query<{ value: string }, [string]>('SELECT value FROM results WHERE key=?').get(key);
    let result;
    if (cached) result = JSON.parse(cached.value);
    else if (metadata && bytes) {
      result = await (await api.request('/v1/artifacts', { method: 'POST', headers: { 'x-somae-artifact': `b64:${Buffer.from(JSON.stringify({ ...metadata, idempotency_key: key })).toString('base64')}` }, body: bytes })).json();
      db.query('INSERT INTO results(key,value) VALUES(?,?)').run(key, JSON.stringify(result));
    } else {
      if (typeof args.text !== 'string' || !args.text.trim()) throw new Error('A message is required.');
      if (tool === 'request_review' && (!Array.isArray(args.artifacts) || !args.artifacts.length || args.artifacts.length > 20 || args.artifacts.some(ref => !ref || typeof ref !== 'object' || typeof ref.artifact_id !== 'string' || !ref.artifact_id.trim() || !Number.isInteger(ref.revision) || ref.revision < 1 || Object.keys(ref).some(key => !['artifact_id', 'revision'].includes(key))))) throw new Error('Review a bounded, nonempty list of exact artifact versions.');
      result = await operation(tool === 'ask_question' ? 'agent.question' : tool === 'request_review' ? 'agent.review' : 'agent.reply', key, { conversation_id: args.conversation_id, text: args.text, ...(tool === 'ask_question' ? { choices: args.choices ?? [] } : tool === 'request_review' ? { artifacts: args.artifacts } : {}) });
      db.query('INSERT INTO results(key,value) VALUES(?,?)').run(key, JSON.stringify(result));
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Somae could not save this yet; retry the same publication.' }] };
  }
});
async function callback(path: string, body: Record<string, unknown>, signal: AbortSignal) {
  if (!configuration.callback_url || !configuration.callback_token) return;
  const current = JSON.parse(await readFile(join(home, 'bridge.json'), 'utf8').catch(() => '{}'));
  if (current.url && current.token) { configuration.callback_url = current.url; configuration.callback_token = current.token; }
  await fetch(new URL(path, configuration.callback_url), { method: 'POST', headers: { authorization: `Bearer ${configuration.callback_token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
}

function stop() {
  if (shutdown) return shutdown;
  online = false;
  pollingAbort.abort();
  // EOF, transport close and signals can arrive together. Announce once, and do
  // not keep a dead Claude session alive while waiting for an unreachable API.
  shutdown = Promise.resolve().then(async () => {
    const offline = onlineAnnouncement.catch(() => {}).then(() => operation('session.availability', `offline:${crypto.randomUUID()}`, { online: false }));
    const disconnected = callback('/bridge/disconnect', { connection_id: configuration.connection_id }, AbortSignal.timeout(1500));
    await Promise.race([Promise.allSettled([offline, disconnected, mcp.close()]), Bun.sleep(1800)]);
    process.exit(0);
  });
  return shutdown;
}
process.stdin.on('end', stop);
process.stdin.on('close', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
mcp.onclose = stop;
await mcp.connect(new StdioServerTransport());
if (process.stdin.readableEnded) void stop();

async function poll() {
  // A previous process might have emitted the input just before crashing. Never guess by injecting it again.
  for (const row of db.query<Row, []>("SELECT * FROM inputs WHERE stage IN ('forwarding','forwarded')").all()) {
    if (!online) return;
    const input: Input = JSON.parse(row.payload);
    try { await operation('input.unknown', `unknown:${input.input_id}`, { delivery_id: input.delivery_id, reason: 'The local bridge restarted after forwarding. Check the Claude session before sending again.' }); setStage(row.id, 'uncertain'); } catch {}
  }
  let announced = false;
  while (online) {
    try {
      if (!announced) {
        onlineAnnouncement = operation('session.availability', `online:${crypto.randomUUID()}`, { online: true });
        await onlineAnnouncement;
        if (!online) break;
        announced = true;
      }
      await callback('/bridge/heartbeat', { connection_id: configuration.connection_id, pid: process.pid }, AbortSignal.any([pollingAbort.signal, AbortSignal.timeout(1000)])).catch(() => {});
      if (!online) break;
      const fresh = await api.json('/v1/inbox') as Input[];
      if (!online) break;
      for (const input of fresh) db.query('INSERT OR IGNORE INTO inputs(id,payload,stage) VALUES(?,?,?)').run(input.input_id, JSON.stringify(input), 'saved');
      for (const row of db.query<Row, []>("SELECT * FROM inputs WHERE stage IN ('saved','received')").all()) {
        if (!online) break;
        const input: Input = JSON.parse(row.payload);
        await operation('delivery.dispatch', `dispatch:${input.input_id}`, { delivery_id: input.delivery_id });
        if (!online) break;
        await operation('delivery.ack', `received:${input.input_id}`, { delivery_id: input.delivery_id });
        if (!online) break;
        setStage(input.input_id, 'forwarding');
        await mcp.notification({ method: 'notifications/claude/channel', params: { content: input.content, meta: { conversation_id: input.conversation_id, input_id: input.input_id } } });
        db.query("UPDATE inputs SET stage='forwarded' WHERE id=? AND stage='forwarding'").run(input.input_id);
      }
    } catch (error) { if (online) process.stderr.write(`Somae connection: ${error instanceof Error ? error.message : 'temporarily unavailable'}\n`); }
    await Bun.sleep(1200);
  }
}
const loop = poll();
await loop;
