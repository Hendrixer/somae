import { stripVTControlCharacters } from 'node:util';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export async function claudeExecutable() {
  const native = join(homedir(), '.local', 'bin', 'claude');
  try { await access(native); return native; } catch {}
  const found = Bun.which('claude');
  if (!found) throw new Error('Install Claude Code and sign in to connect it.');
  return found;
}

/** Keep a genuine interactive CLI in a PTY owned by Somae, without opening a terminal window. */
export async function launchClaude({ workspace, config, name, onOutput, resume, sessionId }: { workspace: string; config: string; name: string; onOutput?: (text: string) => void; resume?: string; sessionId?: string }) {
  const executable = await claudeExecutable();
  let startup = '';
  let confirmedDevelopmentChannel = false;
  const terminal = new Bun.Terminal({
    cols: 100, rows: 32,
    data(terminal, chunk) {
      const text = new TextDecoder().decode(chunk);
      onOutput?.(text);
      if (confirmedDevelopmentChannel) return;
      startup = (startup + stripVTControlCharacters(text)).slice(-32_000);
      const compact = startup.replace(/\s/g, '');
      // Only the known, pre-input development notice for our own channel.
      // Never interpret model text as a permission response or terminal command.
      if (compact.includes('WARNING:Loadingdevelopmentchannels') && compact.includes('server:somae') && compact.includes('Iamusingthisforlocaldevelopment')) {
        confirmedDevelopmentChannel = true;
        terminal.write('\r');
      }
    },
  });
  const args = [executable, '--mcp-config', config, '--dangerously-load-development-channels', 'server:somae', '--allowedTools', 'mcp__somae__acknowledge_input', 'mcp__somae__reply', 'mcp__somae__publish_artifact', 'mcp__somae__ask_question', 'mcp__somae__request_review', 'mcp__somae__open_conversation', '--name', name];
  if (resume) args.push('--resume', resume);
  else if (sessionId) args.push('--session-id', sessionId);
  const process = Bun.spawn(args, { cwd: workspace, terminal, env: { ...Bun.env } });
  return { process, terminal, stop() { process.kill(); terminal.close(); } };
}
