import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const directory = resolve('artifacts/channel-proof');
const [command = 'status', content] = process.argv.slice(2);
if (command === 'setup') {
  await mkdir(resolve(directory, 'workspace'), { recursive: true });
  await writeFile(resolve(directory, 'mcp.json'), JSON.stringify({ mcpServers: { somae: {
    command: process.env.SOMAE_BUN ?? resolve(homedir(), '.bun/bin/bun'),
    args: [resolve('packages/claude-channel/src/server.ts')],
    env: { SOMAE_CHANNEL_DIRECTORY: directory, SOMAE_WORKSPACE: resolve(directory, 'workspace') },
  } } }, null, 2));
  console.log('Prepared artifacts/channel-proof/mcp.json. See packages/claude-channel/README.md for launch instructions.');
} else {
  const connection = JSON.parse(await readFile(resolve(directory, 'connection.json'), 'utf8'));
  if (command === 'send') {
    if (!content) throw new Error('Supply a message to send.');
    const response = await fetch(new URL('/messages', connection.url), { method: 'POST', headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ conversation_id: 'proof_review', input_id: `input_${crypto.randomUUID()}`, content }) });
    if (!response.ok) throw new Error(await response.text());
    console.log(await response.json());
  } else if (command === 'status') {
    const response = await fetch(new URL('/events', connection.url), { headers: { authorization: `Bearer ${connection.token}` } });
    if (!response.ok) throw new Error('Channel is not reachable.');
    const events = await response.json();
    console.log(JSON.stringify({ connected: true, events }, null, 2));
  } else throw new Error('Usage: node scripts/channel-proof.mjs setup|status|send "message"');
}
