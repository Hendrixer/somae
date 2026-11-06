import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createLibrary, applyLibraryOperation } from '../library/index.js';

const waitFor = async (predicate: () => boolean, timeout = 4000) => {
  const until = performance.now() + timeout;
  while (!predicate()) {
    if (performance.now() >= until) throw new Error('Expected channel state did not arrive.');
    await Bun.sleep(10);
  }
};

async function shutdownFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'somae-channel-shutdown-'));
  const workspace = join(directory, 'workspace');
  await mkdir(workspace);
  const availability: boolean[] = [];
  let polls = 0;
  let releaseOffline!: () => void;
  const offlineResponse = new Promise<void>(resolve => { releaseOffline = resolve; });
  const service = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    expect(request.headers.get('authorization')).toBe('Bearer shutdown-test-secret');
    if (new URL(request.url).pathname === '/v1/inbox') { polls++; return Response.json([]); }
    const operation = await request.json() as { type: string; online: boolean };
    expect(operation.type).toBe('session.availability');
    availability.push(operation.online);
    if (!operation.online) await offlineResponse;
    return Response.json({});
  } });
  const config = join(directory, 'session.json');
  // No desktop callback is configured: this isolated child must never discover
  // or contact the person's running Somae instance during a transport test.
  await writeFile(config, JSON.stringify({ api_url: service.url.href, endpoint_token: 'shutdown-test-secret', directory, connection_id: 'shutdown_connection', endpoint_id: 'shutdown_endpoint' }));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'src/remote.ts')], {
    env: { ...process.env, SOMAE_SESSION_CONFIG: config, SOMAE_WORKSPACE: workspace }, stdin: 'pipe', stdout: 'ignore', stderr: 'pipe',
  });
  return {
    child, availability, get polls() { return polls; }, releaseOffline,
    async close() {
      releaseOffline();
      if (child.exitCode === null) child.kill('SIGKILL');
      await child.exited;
      service.stop(true);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('stdio EOF exits without a client kill, announces offline once and stops polling during shutdown', async () => {
  const fixture = await shutdownFixture();
  try {
    await waitFor(() => fixture.polls === 1);
    const started = performance.now();
    fixture.child.stdin.end();
    await waitFor(() => fixture.availability.includes(false));
    // Hold the response beyond a normal polling interval. The closed Claude
    // transport must not continue consuming inputs while shutdown is pending.
    await Bun.sleep(1250);
    expect(fixture.polls).toBe(1);
    expect(fixture.availability).toEqual([true, false]);
    fixture.releaseOffline();
    await waitFor(() => fixture.child.exitCode !== null);
    expect(await fixture.child.exited).toBe(0);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(fixture.availability).toEqual([true, false]);
  } finally { await fixture.close(); }
}, 10_000);

test('shutdown remains bounded and idempotent when offline delivery stalls and close signals repeat', async () => {
  const fixture = await shutdownFixture();
  try {
    await waitFor(() => fixture.polls === 1);
    const started = performance.now();
    fixture.child.stdin.end();
    await waitFor(() => fixture.availability.includes(false));
    fixture.child.kill('SIGINT');
    fixture.child.kill('SIGTERM');
    await waitFor(() => fixture.child.exitCode !== null, 2600);
    expect(await fixture.child.exited).toBe(0);
    expect(performance.now() - started).toBeLessThan(2200);
    expect(fixture.availability).toEqual([true, false]);
    expect(fixture.polls).toBe(1);
  } finally { await fixture.close(); }
}, 10_000);

test('persistent remote channel scopes tools, captures real bytes and never replays an uncertain handoff', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'somae-remote-'));
  const workspace = join(directory, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'brief.md'), '# A real brief');
  let state = createLibrary();
  const person = { kind: 'person' as const, person_id: 'person_local', device_id: 'desktop_local' };
  const register = applyLibraryOperation(state, { type: 'session.register', idempotency_key: 'register', title: 'Test', session_id: 'real_session', workspace_id: 'real_workspace' }, person);
  state = register.state;
  const agent = { kind: 'endpoint' as const, endpoint_id: register.result.endpoint_id! };
  const send = applyLibraryOperation(state, { type: 'message.send', idempotency_key: 'send', connection_id: register.result.connection_id, text: 'Make a brief.' }, person);
  state = send.state;
  let uploads = 0;
  let captured = new Uint8Array();
  const service = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    expect(request.headers.get('authorization')).toBe('Bearer endpoint-test-secret');
    const url = new URL(request.url);
    if (url.pathname === '/v1/inbox') return Response.json(Object.values(state.domain.deliveries).filter(d => d.state === 'queued' && !d.dispatched_at).map(d => ({ delivery_id: d.id, input_id: d.id, conversation_id: d.conversation_id, content: state.domain.messages[d.message_id].content.flatMap(block => block.type === 'text' || block.type === 'markdown' ? [block.text] : []).join('\n\n'), artifact_refs: state.domain.messages[d.message_id].artifact_refs })));
    try {
      let op;
      if (url.pathname === '/v1/artifacts') {
        uploads++;
        captured = new Uint8Array(await request.arrayBuffer());
        op = JSON.parse(Buffer.from(request.headers.get('x-somae-artifact')!.slice(4), 'base64').toString());
        op = { ...op, type: 'artifact.publish', digest: createHash('sha256').update(captured).digest('hex'), size: captured.length, source: new TextDecoder().decode(captured) };
      } else op = await request.json();
      const next = applyLibraryOperation(state, op, agent);
      state = next.state;
      return Response.json({ ...next.result, ...(next.result.conversation ? { conversation_id: next.result.conversation.id } : {}), ...(next.result.artifact ? { artifact_id: next.result.artifact.id, revision: next.result.artifact.revision } : {}), ...(next.result.signal ? { signal_id: next.result.signal.id, revision: next.result.signal.revision } : {}) });
    } catch (error) { return Response.json({ error: (error as any).code, message: String(error) }, { status: 400 }); }
  } });
  const config = join(directory, 'session.json');
  await writeFile(config, JSON.stringify({ api_url: service.url.href, endpoint_token: 'endpoint-test-secret', directory, connection_id: register.result.connection_id, endpoint_id: agent.endpoint_id }));
  const connect = async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dir, 'src/remote.ts')], env: { ...process.env, SOMAE_SESSION_CONFIG: config, SOMAE_WORKSPACE: workspace }, stderr: 'pipe' });
    const client = new Client({ name: 'somae-remote-test', version: '0.1' });
    const notifications: any[] = [];
    client.fallbackNotificationHandler = async n => { notifications.push(n); };
    await client.connect(transport);
    return { client, notifications };
  };
  const wait = async (predicate: () => boolean) => { for (let i = 0; i < 100; i++) { if (predicate()) return; await Bun.sleep(40); } throw new Error('Expected channel state did not arrive.'); };
  let live = await connect();
  try {
    await wait(() => live.notifications.some(n => n.method === 'notifications/claude/channel'));
    const event = live.notifications.find(n => n.method === 'notifications/claude/channel').params.meta;
    expect(state.domain.deliveries[event.input_id].input_state).toBe('unknown');
    expect((await live.client.callTool({ name: 'reply', arguments: { ...event, conversation_id: 'foreign', text: 'No' } })).isError).toBe(true);
    expect((await live.client.callTool({ name: 'acknowledge_input', arguments: event })).isError).toBeUndefined();
    expect(state.domain.deliveries[event.input_id].input_state).toBe('accepted');
    const args = { ...event, title: 'A café brief', path: join(workspace, 'brief.md') };
    const first: any = await live.client.callTool({ name: 'publish_artifact', arguments: args });
    expect(first.isError).toBeUndefined();
    expect((await live.client.callTool({ name: 'publish_artifact', arguments: args })).isError).toBeUndefined();
    expect(uploads).toBe(1);
    expect(new TextDecoder().decode(captured)).toBe('# A real brief');
    expect((await live.client.callTool({ name: 'publish_artifact', arguments: { ...args, path: config } })).isError).toBe(true);
    const published = JSON.parse(first.content[0].text);
    const reviewArgs = { ...event, text: 'Please review this exact brief.', artifacts: [{ artifact_id: published.artifact_id, revision: published.revision }] };
    const offered = (await live.client.listTools()).tools.find(tool => tool.name === 'request_review');
    expect(offered?.inputSchema.required).toContain('artifacts');
    expect((await live.client.callTool({ name: 'request_review', arguments: { ...reviewArgs, artifacts: [] } })).isError).toBe(true);
    const signalCount = Object.keys(state.domain.signals).length;
    for (const custom of [{ choices: ['Approve all', 'Discuss'] }, { actions: [{ id: 'approve', label: 'Discuss' }] }, { approve_label: 'Ship it' }]) {
      expect((await live.client.callTool({ name: 'request_review', arguments: { ...reviewArgs, ...custom } })).isError).toBe(true);
      expect(Object.keys(state.domain.signals)).toHaveLength(signalCount);
    }
    const receipt: any = await live.client.callTool({ name: 'request_review', arguments: reviewArgs });
    expect(receipt.isError).toBeUndefined();
    expect(await live.client.callTool({ name: 'request_review', arguments: reviewArgs })).toEqual(receipt);
    const request = JSON.parse(receipt.content[0].text);
    const signal = state.domain.signals[request.signal_id];
    expect(signal.kind).toBe('approval');
    expect(signal.state).toBe('active');
    expect(signal.interaction?.response_type).toBe('approval');
    const reviewBlock = state.items[published.artifact_id].versions[1].blocks![0];
    const reviewed = applyLibraryOperation(state, { type: 'review.submit', idempotency_key: 'review_decision', conversation_id: event.conversation_id, decision: 'approve', expected_sequences: { [published.artifact_id]: 0 }, source_request: { signal_id: signal.id, expected_revision: signal.revision, interaction_id: signal.interaction!.id, value: { action_id: 'approve', terms_digest: signal.interaction!.terms_digest } }, artifacts: reviewArgs.artifacts, comments: [{ artifact_id: published.artifact_id, revision: 1, kind: 'comment', text: 'This heading works.', anchor: { type: 'text', block_id: reviewBlock.id, start: 0, end: reviewBlock.text.length, quote: reviewBlock.text } }], note: 'Ready for the next step.' }, person);
    state = reviewed.state;
    await wait(() => live.notifications.some(n => n.params?.meta?.input_id === reviewed.result.delivery!.id));
    const decisionEvent = live.notifications.find(n => n.params?.meta?.input_id === reviewed.result.delivery!.id).params;
    expect(decisionEvent.content).toContain('This heading works.');
    expect(decisionEvent.content).toContain('Ready for the next step.');
    expect(decisionEvent.content).toContain(reviewed.result.review!.id);
    expect((await live.client.callTool({ name: 'acknowledge_input', arguments: decisionEvent.meta })).isError).toBeUndefined();
    const opened: any = await live.client.callTool({ name: 'open_conversation', arguments: { title: 'Terminal work', text: 'Made from my terminal.' } });
    expect(opened.isError).toBeUndefined();
    const context = JSON.parse(opened.content[0].text);
    expect((await live.client.callTool({ name: 'reply', arguments: { conversation_id: context.conversation_id, text: 'Here it is.' } })).isError).toBeUndefined();
    // A second input is forwarded, then the bridge disappears before Claude accepts it.
    const second = applyLibraryOperation(state, { type: 'message.send', idempotency_key: 'second', conversation_id: event.conversation_id, text: 'One more.' }, person);
    state = second.state;
    await wait(() => live.notifications.filter(n => n.method === 'notifications/claude/channel').length === 3);
    await live.client.close();
    live = await connect();
    await wait(() => state.domain.deliveries[second.result.delivery!.id].input_state === 'ambiguous');
    expect(live.notifications.filter(n => n.method === 'notifications/claude/channel')).toHaveLength(0);
    expect(JSON.parse(await readFile(config, 'utf8')).endpoint_token).toBe('endpoint-test-secret');
  } finally { await live.client.close(); service.stop(); await rm(directory, { recursive: true, force: true }); }
}, 20_000);
