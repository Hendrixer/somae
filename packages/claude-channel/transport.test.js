import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('real MCP transport gates local input, deduplicates forwarding and preserves published file bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'somae-channel-'));
  const workspace = join(dir, 'workspace');
  const journal = join(dir, 'journal');
  await mkdir(workspace);
  await writeFile(join(workspace, 'brief.md'), '# A real file');
  const transport = new StdioClientTransport({ command: process.env.SOMAE_BUN ?? 'bun', args: [resolve('packages/claude-channel/src/server.ts')], env: { ...process.env, SOMAE_CHANNEL_DIRECTORY: journal, SOMAE_WORKSPACE: workspace, SOMAE_CHANNEL_TOKEN: 'test-local-token' }, stderr: 'pipe' });
  const client = new Client({ name: 'somae-protocol-test', version: '0.1.0' });
  const notifications = [];
  client.fallbackNotificationHandler = async notification => { notifications.push(notification); };
  try {
    await client.connect(transport);
    let connection;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { connection = JSON.parse(await readFile(join(journal, 'connection.json'), 'utf8')); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(connection, 'Channel descriptor created');
    const event = { conversation_id: 'conversation_1', input_id: 'input_1', content: 'Review the brief.' };
    const send = value => fetch(new URL('/messages', connection.url), { method: 'POST', headers: { authorization: 'Bearer test-local-token', 'content-type': 'application/json' }, body: JSON.stringify(value) });
    assert.equal((await fetch(new URL('/events', connection.url))).status, 401);
    assert.equal((await send(event)).status, 202);
    assert.equal((await send(event)).status, 200);
    assert.equal((await send({ ...event, content: 'Changed content' })).status, 409);
    assert.equal((await send({ ...event, input_id: 'bad"metadata' })).status, 400);
    assert.equal(notifications.filter(n => n.method === 'notifications/claude/channel').length, 1);
    const ack = await client.callTool({ name: 'acknowledge_input', arguments: { conversation_id: event.conversation_id, input_id: event.input_id } });
    assert.equal(ack.isError, undefined);
    const wrong = await client.callTool({ name: 'reply', arguments: { conversation_id: 'foreign', input_id: event.input_id, text: 'Not authorized' } });
    assert.equal(wrong.isError, true);
    const published = await client.callTool({ name: 'publish_artifact', arguments: { conversation_id: event.conversation_id, input_id: event.input_id, title: 'Brief', path: join(workspace, 'brief.md') } });
    assert.equal(published.isError, undefined);
    const artifact = JSON.parse(published.content[0].text);
    assert.equal(await readFile(join(journal, 'blobs', artifact.digest), 'utf8'), '# A real file');
    const outside = await client.callTool({ name: 'publish_artifact', arguments: { conversation_id: event.conversation_id, input_id: event.input_id, title: 'Outside', path: resolve('README.md') } });
    assert.equal(outside.isError, true);
  } finally {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  }
});
