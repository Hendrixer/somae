#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mkdir, appendFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, extname } from 'node:path';
import { channelInstructions, tools, validateEvent } from './protocol.js';

const directory = resolve(process.env.SOMAE_CHANNEL_DIRECTORY ?? 'artifacts/claude-channel');
const workspace = await realpath(process.env.SOMAE_WORKSPACE ?? process.cwd());
await mkdir(directory, { recursive: true, mode: 0o700 });
const token = process.env.SOMAE_CHANNEL_TOKEN ?? crypto.randomUUID();
const accepted = new Map<string, { conversation_id: string; input_id: string; content: string }>();
const events: object[] = [];
let sequence = 0;
const record = async (event: object) => {
  const entry = { sequence: ++sequence, at: new Date().toISOString(), ...event };
  await appendFile(resolve(directory, 'events.jsonl'), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  events.push(entry);
  return entry;
};

const mcp = new Server({ name: 'somae', version: '0.1.0' }, {
  capabilities: { experimental: { 'claude/channel': {} }, tools: {} },
  instructions: channelInstructions,
});
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.filter(t => ['acknowledge_input', 'reply', 'publish_artifact'].includes(t.name)) }));
mcp.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const args = request.params.arguments ?? {};
    const input = accepted.get(String(args.input_id));
    if (!input || input.conversation_id !== args.conversation_id) throw new Error('Unknown or mismatched Somae input.');
    let result: object;
    if (request.params.name === 'acknowledge_input') {
      result = await record({ type: 'input.accepted', conversation_id: input.conversation_id, input_id: input.input_id });
    } else if (request.params.name === 'reply') {
      if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 100_000) throw new Error('Reply must contain text.');
      result = await record({ type: 'reply', conversation_id: input.conversation_id, input_id: input.input_id, text: args.text });
    } else if (request.params.name === 'publish_artifact') {
      if (typeof args.path !== 'string' || typeof args.title !== 'string' || !args.title.trim()) throw new Error('Path and title are required.');
      const path = await realpath(resolve(workspace, args.path));
      const rel = relative(workspace, path);
      if (rel.startsWith('..') || !rel || rel.split('/').some(p => p.startsWith('.'))) throw new Error('Artifact must be a visible file inside the selected project.');
      if (!['.md', '.txt', '.html', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(extname(path).toLowerCase())) throw new Error('Unsupported review file.');
      const file = Bun.file(path);
      if (file.size > 20 * 1024 * 1024) throw new Error('Artifact exceeds 20 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const digest = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
      const destination = resolve(directory, 'blobs', digest);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, bytes, { mode: 0o600, flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      result = await record({ type: 'artifact', conversation_id: input.conversation_id, input_id: input.input_id, title: args.title, filename: path.split('/').at(-1), media_type: file.type, size: file.size, digest, artifact_id: args.artifact_id, expected_revision: args.expected_revision });
    } else throw new Error('Unknown tool.');
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Publication failed.' }] };
  }
});

await mcp.connect(new StdioServerTransport());
const server = Bun.serve({
  hostname: '127.0.0.1', port: Number(process.env.SOMAE_CHANNEL_PORT ?? 0),
  async fetch(request) {
    if (request.headers.get('authorization') !== `Bearer ${token}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/events') return Response.json(events);
    if (request.method === 'GET' && url.pathname === '/health') return Response.json({ connected: true, workspace });
    if (request.method !== 'POST' || url.pathname !== '/messages') return new Response('Not found', { status: 404 });
    try {
      if (Number(request.headers.get('content-length') ?? 0) > 150_000) throw new Error('Message is too large.');
      const event = validateEvent(await request.json());
      const previous = accepted.get(event.input_id);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(event)) return Response.json({ error: 'idempotency_conflict' }, { status: 409 });
        return Response.json({ input_id: event.input_id, status: 'already_forwarded' });
      }
      await record({ type: 'input.saved', ...event });
      accepted.set(event.input_id, event);
      await mcp.notification({ method: 'notifications/claude/channel', params: { content: event.content, meta: { conversation_id: event.conversation_id, input_id: event.input_id } } });
      await record({ type: 'input.forwarded', input_id: event.input_id, conversation_id: event.conversation_id });
      return Response.json({ input_id: event.input_id, status: 'forwarded_not_yet_accepted' }, { status: 202 });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Invalid message.' }, { status: 400 });
    }
  },
});
await writeFile(resolve(directory, 'connection.json'), JSON.stringify({ url: server.url.href, token, workspace, pid: process.pid }), { mode: 0o600 });
process.stderr.write(`Somae channel ready on 127.0.0.1:${server.port}\n`);

