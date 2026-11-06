import { env } from 'cloudflare:workers';
import { describe, it, expect } from 'vitest';
import worker from '../src/worker';

async function call(path: string, token = 'test-desktop-only', value?: Record<string, unknown>) {
  return worker.fetch(new Request(`https://api.getsomae.ai${path}`, { method: value ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(value ? { 'content-type': 'application/json' } : {}) }, ...(value ? { body: JSON.stringify(value) } : {}) }), env);
}
async function op(value: Record<string, unknown>, token?: string) {
  const r = await call('/v1/operations', token, { idempotency_key: crypto.randomUUID(), ...value });
  const body = await r.json<Record<string, any>>();
  expect(r.status, JSON.stringify(body)).toBeLessThan(300);
  return body;
}

describe('private Somae Worker with real Durable Object SQLite and R2 bindings', () => {
  it('stops all data routes before any binding access while paused or not explicitly enabled', async () => {
    for (const flag of ['true', undefined]) {
      const pausedEnv = new Proxy({}, {
        get(_target, property) {
          if (property === 'SOMAE_SERVICE_PAUSED') return flag;
          throw new Error(`Paused service accessed ${String(property)}.`);
        },
      }) as Env;
      for (const [method, path] of [['GET', '/v1/library'], ['GET', '/v1/inbox'], ['GET', '/v1/originals/file'], ['POST', '/v1/operations'], ['POST', '/v1/artifacts']]) {
        const response = await worker.fetch(new Request(`https://api.getsomae.ai${path}`, { method }), pausedEnv);
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'service_paused', message: 'Somae cloud service is paused.' });
      }
    }
  });

  it('rejects unauthenticated access and never exports host snapshots', async () => {
    expect((await call('/v1/library', 'wrong')).status).toBe(401);
    const response = await call('/v1/library');
    expect(response.status).toBe(200);
    const body = await response.json<Record<string, unknown>>();
    expect(body).not.toHaveProperty('domain');
    expect(body).not.toHaveProperty('sessions');
    expect(body).not.toHaveProperty('operations');
    expect(body.question_feedback_supported).toBe(true);
    const health = await (await call('/health')).json<any>();
    expect(body.service_release).toBe(health.release);
  });

  it('stores actual original bytes, accepts exact-version feedback, preserves approval on revision and deduplicates a send', async () => {
    const session = await op({ type: 'session.register', session_id: 'session_test_1', workspace_id: 'private_workspace_test_1', title: 'Launch brief' });
    const key = crypto.randomUUID();
    const send = { type: 'message.send', connection_id: session.connection_id, text: 'Create a launch brief.', idempotency_key: key };
    const first = await op(send);
    expect(await op(send)).toEqual(first);
    const inbox = await (await call('/v1/inbox', session.endpoint_token)).json<any[]>();
    expect(inbox.filter(d => d.delivery_id === first.delivery_id)).toHaveLength(1);
    await op({ type: 'delivery.dispatch', delivery_id: first.delivery_id }, session.endpoint_token);
    await op({ type: 'delivery.ack', delivery_id: first.delivery_id }, session.endpoint_token);
    await op({ type: 'input.accept', delivery_id: first.delivery_id }, session.endpoint_token);
    const original = '# Launch\n\nHello creators.';
    const upload = await worker.fetch(new Request('https://api.getsomae.ai/v1/artifacts', { method: 'POST', headers: { authorization: `Bearer ${session.endpoint_token}`, 'x-somae-artifact': JSON.stringify({ idempotency_key: crypto.randomUUID(), conversation_id: first.conversation_id, title: 'Launch brief', filename: 'brief.md', media_type: 'text/markdown' }) }, body: original }), env);
    const artifact = await upload.json<any>();
    expect(upload.status, JSON.stringify(artifact)).toBe(201);
    await op({ type: 'version.approve', artifact_id: artifact.artifact_id, revision: 1, expected_sequence: 0 });
    const review = await op({ type: 'review.submit', conversation_id: first.conversation_id, artifacts: [{ artifact_id: artifact.artifact_id, revision: 1 }], comments: [{ artifact_id: artifact.artifact_id, revision: 1, kind: 'replace', text: 'Be specific.', replacement: 'independent creators', anchor: { type: 'text', block_id: 'block_1', start: 6, end: 14, quote: 'creators' } }], note: 'Warmer please.' });
    expect(review.review_id).toBeTruthy();
    const revised = await worker.fetch(new Request('https://api.getsomae.ai/v1/artifacts', { method: 'POST', headers: { authorization: `Bearer ${session.endpoint_token}`, 'x-somae-artifact': JSON.stringify({ idempotency_key: crypto.randomUUID(), conversation_id: first.conversation_id, title: 'Launch brief', filename: 'brief.md', media_type: 'text/markdown', artifact_id: artifact.artifact_id, expected_revision: 1, review_id: review.review_id }) }, body: '# Launch\n\nHello independent creators.' }), env);
    expect(revised.status, await revised.text()).toBe(201);
    const view = await (await call('/v1/library')).json<any>();
    const item = view.items.find((i: any) => i.id === artifact.artifact_id);
    expect(item.latest_revision).toBe(2);
    expect(item.approved.artifact_revision).toBe(1);
    expect(item.versions[1].review_id).toBe(review.review_id);
    expect(JSON.stringify(view)).not.toContain('private_workspace_test_1');
    const originalDownload = await call(`/v1/originals/${item.versions[0].digest}`);
    expect(await originalDownload.text()).toBe(original);
    const stale = await call('/v1/operations', 'test-desktop-only', { type: 'review.submit', idempotency_key: crypto.randomUUID(), conversation_id: first.conversation_id, artifacts: [{ artifact_id: artifact.artifact_id, revision: 1 }], comments: [], note: 'Stale review' });
    expect(stale.status).toBe(409);
  });

  it('a channel credential cannot access another channel, person library or person-only operations', async () => {
    const first = await op({ type: 'session.register', session_id: crypto.randomUUID(), workspace_id: crypto.randomUUID(), title: 'First' });
    const second = await op({ type: 'session.register', session_id: crypto.randomUUID(), workspace_id: crypto.randomUUID(), title: 'Second' });
    const message = await op({ type: 'message.send', connection_id: second.connection_id, text: 'Private second conversation' });
    expect((await call('/v1/library', first.endpoint_token)).status).toBe(403);
    const pending = await (await call('/v1/inbox', first.endpoint_token)).json<any[]>();
    expect(pending.some(d => d.conversation_id === message.conversation_id)).toBe(false);
    expect((await call('/v1/operations', first.endpoint_token, { type: 'message.send', idempotency_key: crypto.randomUUID(), connection_id: second.connection_id, text: 'Impersonate' })).status).toBe(403);
    const wrong = await call('/v1/operations', first.endpoint_token, { type: 'delivery.dispatch', idempotency_key: crypto.randomUUID(), delivery_id: message.delivery_id });
    expect(wrong.status).toBe(403);
  });

  it('opens a terminal-authored conversation and routes a required choice back to that same session', async () => {
    const session = await op({ type: 'session.register', session_id: crypto.randomUUID(), workspace_id: crypto.randomUUID(), title: 'Terminal' });
    const opened = await op({ type: 'agent.open', title: 'Terminal work', text: 'A person asked for this in the terminal.' }, session.endpoint_token);
    const question = await op({ type: 'agent.question', conversation_id: opened.conversation_id, text: 'Which finish?', choices: ['Terracotta', 'Cream'] }, session.endpoint_token);
    const view = await (await call('/v1/library')).json<any>();
    const signal = view.signals.find((s: any) => s.id === question.signal_id);
    const response = await op({ type: 'response.submit', signal_id: signal.id, expected_revision: signal.revision, interaction_id: signal.interaction.id, value: { option_id: '1' } });
    const pending = await (await call('/v1/inbox', session.endpoint_token)).json<any[]>();
    expect(pending.find(d => d.delivery_id === response.delivery_id).conversation_id).toBe(opened.conversation_id);
    expect(pending.find(d => d.delivery_id === response.delivery_id).content).toContain('Selected option 1: Terracotta');
    expect(pending.find(d => d.delivery_id === response.delivery_id).content).toContain('Which finish?');
  });

  it('commits an artifact review decision, exact signal response and all feedback as one durable delivery', async () => {
    for (const decision of ['approve', 'reject']) {
      const session = await op({ type: 'session.register', session_id: crypto.randomUUID(), workspace_id: crypto.randomUUID(), title: `Review ${decision}` });
      const opened = await op({ type: 'agent.open', title: 'Review this pair', text: 'Review work from this terminal.' }, session.endpoint_token);
      const publish = async (title: string, filename: string, media_type: string, bytes: string) => {
        const response = await worker.fetch(new Request('https://api.getsomae.ai/v1/artifacts', { method: 'POST', headers: { authorization: `Bearer ${session.endpoint_token}`, 'x-somae-artifact': JSON.stringify({ idempotency_key: crypto.randomUUID(), conversation_id: opened.conversation_id, title, filename, media_type }) }, body: bytes }), env);
        const result = await response.json<any>();
        expect(response.status, JSON.stringify(result)).toBe(201);
        return { artifact_id: result.artifact_id, revision: result.revision };
      };
      const document = await publish('Launch brief', 'brief.md', 'text/markdown', '# Launch\n\nHello creators.');
      const image = await publish('Launch cover', 'cover.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>');
      const request = await op({ type: 'agent.review', conversation_id: opened.conversation_id, text: 'Approve the launch brief and cover?', artifacts: [document, image] }, session.endpoint_token);
      const before = await (await call('/v1/library')).json<any>();
      const signal = before.signals.find((s: any) => s.id === request.signal_id);
      expect(signal.review_request.artifacts).toEqual([document, image]);
      expect(signal.kind).toBe('approval');
      const submission = { type: 'review.submit', idempotency_key: crypto.randomUUID(), conversation_id: opened.conversation_id, decision, expected_sequences: { [document.artifact_id]: 0, [image.artifact_id]: 0 }, source_request: { signal_id: signal.id, expected_revision: signal.revision, interaction_id: signal.interaction.id, value: { action_id: decision, terms_digest: signal.interaction.terms_digest } }, artifacts: [document, image], comments: [{ ...document, kind: 'replace', text: 'Be specific.', replacement: 'independent creators', anchor: { type: 'text', block_id: 'block_1', start: 6, end: 14, quote: 'creators' } }, { ...image, kind: 'comment', text: 'Keep this corner clear.', anchor: { type: 'region', x: 0.1, y: 0.2, width: 0.3, height: 0.4 } }], note: 'Both files have been checked.' };
      const invalid = await call('/v1/operations', 'test-desktop-only', { ...submission, expected_sequences: { [document.artifact_id]: 1, [image.artifact_id]: 0 } });
      expect(invalid.status).toBe(409);
      expect(await (await call('/v1/inbox', session.endpoint_token)).json()).toEqual([]);
      const accepted = await op(submission);
      expect(accepted.decision).toBe(decision);
      expect(accepted.response_id).toBeTruthy();
      expect(accepted.signal_id).toBe(signal.id);
      expect(await op(submission)).toEqual(accepted);
      const pending = await (await call('/v1/inbox', session.endpoint_token)).json<any[]>();
      expect(pending).toHaveLength(1);
      expect(pending[0].delivery_id).toBe(accepted.delivery_id);
      expect(pending[0].conversation_id).toBe(opened.conversation_id);
      expect(pending[0].artifact_refs).toEqual([document, image]);
      expect(pending[0].content).toContain(`Somae response to signal ${signal.id}, revision ${signal.revision}`);
      expect(pending[0].content).toContain('Approve the launch brief and cover?');
      expect(pending[0].content).toContain(`Selected action ${decision}:`);
      expect(pending[0].content).toContain(`Approval terms digest: ${signal.interaction.terms_digest}`);
      for (const included of ['Be specific.', 'independent creators', 'Keep this corner clear.', 'Both files have been checked.', accepted.review_id]) expect(pending[0].content).toContain(included);
      const view = await (await call('/v1/library')).json<any>();
      expect(view.signals.find((s: any) => s.id === signal.id).state).toBe('answered');
      expect(view.reviews.filter((r: any) => r.conversation_id === opened.conversation_id)).toHaveLength(1);
      for (const ref of [document, image]) {
        const item = view.items.find((i: any) => i.id === ref.artifact_id);
        expect(item.approved?.artifact_revision ?? null).toBe(decision === 'approve' ? 1 : null);
      }
      const other = await op({ type: 'session.register', session_id: crypto.randomUUID(), workspace_id: crypto.randomUUID(), title: 'Unrelated terminal' });
      expect(await (await call('/v1/inbox', other.endpoint_token)).json()).toEqual([]);
      expect((await call('/v1/operations', other.endpoint_token, { type: 'agent.review', idempotency_key: crypto.randomUUID(), conversation_id: opened.conversation_id, text: 'Foreign review', artifacts: [document] })).status).toBe(403);
    }
  });

  it('sends exact question answers with optional artifact comments without changing approvals', async () => {
    for (const withComments of [false, true]) {
      for (const choices of [[], ['Use cream', 'Use terracotta']]) {
        const session = await op({ type: 'session.register', session_id: crypto.randomUUID(), workspace_id: crypto.randomUUID(), title: 'Question with context' });
        const opened = await op({ type: 'agent.open', title: 'Choose a direction', text: 'Consider the document.' }, session.endpoint_token);
        const upload = await worker.fetch(new Request('https://api.getsomae.ai/v1/artifacts', { method: 'POST', headers: { authorization: `Bearer ${session.endpoint_token}`, 'x-somae-artifact': JSON.stringify({ idempotency_key: crypto.randomUUID(), conversation_id: opened.conversation_id, title: 'Brief', filename: 'brief.md', media_type: 'text/markdown' }) }, body: '# Launch\n\nHello creators.' }), env);
        const artifact = await upload.json<any>();
        expect(upload.status).toBe(201);
        const question = await op({ type: 'agent.question', conversation_id: opened.conversation_id, text: 'Which material should I use?', choices }, session.endpoint_token);
        const before = await (await call('/v1/library')).json<any>();
        const signal = before.signals.find((s: any) => s.id === question.signal_id);
        const value = choices.length ? { option_id: '2' } : { text: 'Try a warm ceramic finish.' };
        const submission = { type: 'review.submit', idempotency_key: crypto.randomUUID(), conversation_id: opened.conversation_id, artifacts: [{ artifact_id: artifact.artifact_id, revision: artifact.revision }], comments: withComments ? [{ artifact_id: artifact.artifact_id, revision: artifact.revision, kind: 'comment', text: 'Give this more space.', anchor: { type: 'text', block_id: 'block_1', start: 0, end: 5, quote: 'Hello' } }] : [], source_request: { signal_id: signal.id, expected_revision: signal.revision, interaction_id: signal.interaction.id, value } };
        const contradictory = await call('/v1/operations', 'test-desktop-only', { ...submission, decision: 'approve', expected_sequences: { [artifact.artifact_id]: 0 } });
        expect(contradictory.status).toBe(400);
        expect((await contradictory.json<any>()).error).toBe('review_request_invalid');
        expect(await (await call('/v1/inbox', session.endpoint_token)).json()).toEqual([]);
        const accepted = await op(submission);
        expect(accepted.decision).toBeUndefined();
        expect(accepted.response_id).toBeTruthy();
        expect(await op(submission)).toEqual(accepted);
        const after = await (await call('/v1/library')).json<any>();
        expect(after.signals.find((s: any) => s.id === signal.id).state).toBe('answered');
        const item = after.items.find((i: any) => i.id === artifact.artifact_id);
        expect(item.approved).toBeNull();
        expect(item.decision).toBeNull();
        const pending = await (await call('/v1/inbox', session.endpoint_token)).json<any[]>();
        expect(pending).toHaveLength(1);
        expect(pending[0].content).toContain(`Response value: ${JSON.stringify(value)}`);
        expect(pending[0].content).not.toContain('Decision: Approved');
        if (withComments) expect(pending[0].content).toContain('Give this more space.');
      }
    }
  });
});
