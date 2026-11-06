import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchClaude } from '../packages/claude-channel/src/launch';

const root = resolve(import.meta.dir, '..');
const parent = resolve(root, 'artifacts/managed-channel-proof');
await mkdir(parent, { recursive: true, mode: 0o700 });
const directory = await mkdtemp(resolve(parent, 'run-'));
const workspace = resolve(root, 'artifacts/channel-proof/workspace');
const config = resolve(directory, 'mcp.json');
await writeFile(config, JSON.stringify({ mcpServers: { somae: { command: process.execPath, args: [resolve(root, 'packages/claude-channel/src/server.ts')], env: { SOMAE_CHANNEL_DIRECTORY: directory, SOMAE_WORKSPACE: workspace } } } }));
const launched = await launchClaude({ workspace, config, name: 'Somae managed proof', onOutput: text => { appendFileSync(resolve(directory, 'terminal.log'), text, { mode: 0o600 }); } });
console.log('Managed interactive Claude started without an external terminal window.');
try {
  let connection;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (launched.process.exitCode !== null) throw new Error('Claude exited before channel startup.');
    try { connection = JSON.parse(await readFile(resolve(directory, 'connection.json'), 'utf8')); break; } catch {}
    await Bun.sleep(250);
  }
  if (!connection) throw new Error('Channel startup timed out; inspect the private terminal log.');
  console.log('Channel connected. Sending a real message.');
  const response = await fetch(new URL('/messages', connection.url), { method: 'POST', headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ conversation_id: 'managed_proof', input_id: 'managed_1', content: 'Acknowledge this input and reply through Somae with exactly: Managed Somae session works.' }) });
  if (!response.ok) throw new Error('Channel did not accept the test message.');
  for (let attempt = 0; attempt < 90; attempt++) {
    const events = await (await fetch(new URL('/events', connection.url), { headers: { authorization: `Bearer ${connection.token}` } })).json();
    const acknowledged = events.some((event: { type: string }) => event.type === 'input.accepted');
    const replied = events.some((event: { type: string; text?: string }) => event.type === 'reply' && event.text === 'Managed Somae session works.');
    if (acknowledged && replied) {
      await writeFile(resolve(root, 'artifacts/verification/claude-managed-channel.json'), JSON.stringify({ checked_at: new Date().toISOString(), real_model: true, managed_pty: true, external_terminal_window: false, acknowledged, replied, events: events.filter((event: { type: string }) => event.type !== 'input.saved') }, null, 2));
      console.log('PASS: managed session acknowledged and replied through Somae.');
      process.exitCode = 0;
      break;
    }
    if (attempt === 89) throw new Error('No real reply within 90 seconds.');
    await Bun.sleep(1000);
  }
} finally { launched.stop(); }
