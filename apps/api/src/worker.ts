import { DurableObject } from 'cloudflare:workers';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createLibrary, applyLibraryOperation, projectLibrary } from '../../../packages/library/index.js';

type LibraryState = ReturnType<typeof createLibrary>;
type Principal = { kind: 'person'; person_id: string; device_id: string } | { kind: 'endpoint'; endpoint_id: string };
type Role = { kind: 'person' } | { kind: 'endpoint'; endpoint_id: string };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const signature = (endpoint: string, secret: string) => createHmac('sha256', secret).update(`somae-test:${endpoint}`).digest('hex');
const release = 'desktop-test-20261025-paused';

async function boundedBytes(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw Object.assign(new Error('Request is too large.'), { code: 'payload_too_large' }); }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export class Workspace extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS workspace_state (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL)');
    if (!ctx.storage.sql.exec('SELECT id FROM workspace_state WHERE id=1').toArray().length) {
      ctx.storage.sql.exec('INSERT INTO workspace_state (id,value) VALUES (1,?)', JSON.stringify(createLibrary()));
    }
  }
  private load(): LibraryState {
    return JSON.parse(this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM workspace_state WHERE id=1').one().value);
  }
  private principal(role: Role, state: LibraryState): Principal {
    return role.kind === 'person' ? { kind: 'person', person_id: state.identity.person_id, device_id: state.identity.device_id } : role;
  }
  view(role: Role) {
    if (role.kind !== 'person') throw Object.assign(new Error('Person access required.'), { code: 'unauthorized' });
    const state = this.load();
    return { ...projectLibrary(state, this.principal(role, state)), service_release: release, review_decisions_supported: true, question_feedback_supported: true };
  }
  change(operation: Record<string, unknown>, role: Role) {
    return this.ctx.storage.transactionSync(() => {
      const state = this.load();
      const transition = applyLibraryOperation(state, operation, this.principal(role, state));
      this.ctx.storage.sql.exec('UPDATE workspace_state SET value=? WHERE id=1', JSON.stringify(transition.state));
      const result = transition.result;
      return {
        ...(result.connection_id ? { connection_id: result.connection_id, endpoint_id: result.endpoint_id } : {}),
        ...(result.conversation ? { conversation_id: result.conversation.id } : {}),
        ...(result.message ? { message_id: result.message.id } : {}),
        ...(result.delivery ? { delivery_id: result.delivery.id, delivery_state: result.delivery.state, input_state: result.delivery.input_state } : {}),
        ...(result.artifact ? { artifact_id: result.artifact.id, revision: result.artifact.revision } : {}),
        ...(result.signal ? { signal_id: result.signal.id, revision: result.signal.revision } : {}),
        ...(result.review ? { review_id: result.review.id, ...(result.review.decision ? { decision: result.review.decision } : {}) } : {}),
        ...(result.response ? { response_id: result.response.id } : {}),
        ...(result.approval ? { approved_revision: result.approval.artifact_revision, sequence: result.approval.sequence } : {}),
        ...(result.saved ? { saved: true } : {}),
      };
    });
  }
  pending(role: Role) {
    if (role.kind !== 'endpoint') throw Object.assign(new Error('Endpoint access required.'), { code: 'unauthorized' });
    const state = this.load();
    return Object.values(state.domain.deliveries).filter(d => d.endpoint_id === role.endpoint_id && d.state === 'queued' && !d.dispatched_at && d.input_state === 'unknown').map(d => {
      const message = state.domain.messages[d.message_id];
      let content = message.content.flatMap(b => b.type === 'text' || b.type === 'markdown' ? [b.text] : []).join('\n\n');
      if (d.response_id) {
        const response = state.domain.responses[d.response_id];
        const signal = state.domain.signals[response.signal_id];
        const offered = signal.revisions.find(r => r.revision === response.signal_revision)!;
        const question = state.domain.messages[offered.message_id].content.flatMap(b => b.type === 'text' || b.type === 'markdown' ? [b.text] : []).join('\n\n');
        const selected = offered.interaction?.response_type === 'single_choice' ? offered.interaction.actions.find(a => a.id === (response.value as { option_id?: string }).option_id) : undefined;
        const action = offered.interaction?.response_type === 'approval' ? offered.interaction.actions.find(a => a.id === (response.value as { action_id?: string }).action_id) : undefined;
        content = `Somae response to signal ${signal.id}, revision ${response.signal_revision}:\n${question}\n\n${selected ? `Selected option ${selected.id}: ${selected.label}\n` : ''}${action ? `Selected action ${action.id}: ${action.label}\nApproval terms digest: ${offered.interaction!.terms_digest}\n` : ''}Response value: ${JSON.stringify(response.value)}\n\nPerson's submitted message:\n${content}`;
      }
      return { delivery_id: d.id, conversation_id: d.conversation_id, input_id: d.id, content, artifact_refs: message.artifact_refs };
    });
  }
  original(digest: string, role: Role) {
    const state = this.load();
    const artifact = Object.values(state.domain.artifacts).find(a => a.digest === digest && (role.kind === 'person' || state.domain.conversations[a.conversation_id].endpoint_id === role.endpoint_id));
    if (!artifact) throw Object.assign(new Error('File unavailable.'), { code: 'not_found' });
    return { media_type: artifact.media_type, filename: state.items[artifact.id]?.versions[artifact.revision]?.filename ?? 'original' };
  }
  canPublish(conversationId: string, role: Role) {
    const state = this.load();
    const conversation = state.domain.conversations[conversationId];
    if (role.kind !== 'endpoint' || conversation?.endpoint_id !== role.endpoint_id || state.domain.connections[conversation.connection_id].state !== 'active') throw Object.assign(new Error('Publication not authorized.'), { code: 'unauthorized' });
  }
}

async function authenticate(request: Request, env: Env): Promise<Role | null> {
  const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? '';
  if (!env.SOMAE_DESKTOP_TOKEN || !env.SOMAE_BRIDGE_TOKEN) return null;
  if (same(bearer, env.SOMAE_DESKTOP_TOKEN)) return { kind: 'person' };
  const match = bearer.match(/^(endpoint_[a-zA-Z0-9_-]+)\.([a-f0-9]{64})$/);
  if (match && same(match[2], signature(match[1], env.SOMAE_BRIDGE_TOKEN))) return { kind: 'endpoint', endpoint_id: match[1] };
  return null;
}

const personOperations = new Set(['session.register', 'message.send', 'review.submit', 'version.approve', 'draft.save', 'inbox.mark', 'response.submit']);
const endpointOperations = new Set(['session.availability', 'delivery.dispatch', 'delivery.ack', 'input.accept', 'input.reject', 'input.unknown', 'agent.open', 'agent.reply', 'agent.question', 'agent.review']);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const paused = env.SOMAE_SERVICE_PAUSED !== 'false';
    if (url.pathname === '/health' && request.method === 'GET') return json({ service: 'somae-test', protocol: '0.1', release, paused, configured: !!env.SOMAE_DESKTOP_TOKEN && !!env.SOMAE_BRIDGE_TOKEN });
    // An operator stop must reject stale clients before any DO lookup or R2 use.
    // Missing configuration also stays paused; resuming requires an explicit change.
    if (paused) return json({ error: 'service_paused', message: 'Somae cloud service is paused.' }, 503);
    const role = await authenticate(request, env);
    if (!role) return json({ error: 'unauthorized', message: 'Connect this desktop installation to the private test service.' }, 401);
    const workspace = env.WORKSPACES.getByName('personal-test');
    try {
      if (url.pathname === '/v1/library' && request.method === 'GET') return json(await workspace.view(role));
      if (url.pathname === '/v1/inbox' && request.method === 'GET') return json(await workspace.pending(role));
      if (url.pathname.startsWith('/v1/originals/') && request.method === 'GET') {
        const digest = url.pathname.split('/').at(-1)!;
        if (!/^[a-f0-9]{64}$/.test(digest)) return json({ error: 'not_found' }, 404);
        const metadata = await workspace.original(digest, role);
        const object = await env.ORIGINALS.get(digest);
        if (!object) return json({ error: 'not_found' }, 404);
        const filename = metadata.filename.replace(/[^a-zA-Z0-9._ -]/g, '_');
        return new Response(object.body, { headers: { 'content-type': metadata.media_type, 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
      }
      if (url.pathname === '/v1/artifacts' && request.method === 'POST') {
        if (role.kind !== 'endpoint') return json({ error: 'unauthorized' }, 403);
        const metadataHeader = request.headers.get('x-somae-artifact');
        if (!metadataHeader || metadataHeader.length > 20_000) return json({ error: 'artifact_invalid' }, 400);
        const metadata = JSON.parse(metadataHeader.startsWith('b64:') ? new TextDecoder().decode(Uint8Array.from(atob(metadataHeader.slice(4)), char => char.charCodeAt(0))) : metadataHeader);
        await workspace.canPublish(metadata.conversation_id, role);
        const bytes = await boundedBytes(request, 20 * 1024 * 1024);
        const digest = createHash('sha256').update(bytes).digest('hex');
        const allowed = ['text/plain', 'text/markdown', 'text/html', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
        if (!allowed.includes(metadata.media_type)) return json({ error: 'artifact_unsupported' }, 400);
        const source = metadata.media_type.startsWith('text/') ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes) : undefined;
        await env.ORIGINALS.put(digest, bytes, { sha256: digest, onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: metadata.media_type } });
        const result = await workspace.change({ ...metadata, type: 'artifact.publish', digest, size: bytes.length, ...(source === undefined ? {} : { source }) }, role);
        return json(result, 201);
      }
      if (url.pathname === '/v1/operations' && request.method === 'POST') {
        const body = JSON.parse(new TextDecoder().decode(await boundedBytes(request, 250_000)));
        if (!(role.kind === 'person' ? personOperations : endpointOperations).has(body.type)) return json({ error: 'operation_unsupported' }, 403);
        const result = await workspace.change(body, role);
        if (body.type === 'session.register') return json({ ...result, endpoint_token: `${result.endpoint_id}.${signature(result.endpoint_id!, env.SOMAE_BRIDGE_TOKEN)}` }, 201);
        return json(result);
      }
      return json({ error: 'not_found' }, 404);
    } catch (error) {
      const safe = error as Error & { code?: string };
      const code = safe.code ?? 'invalid_request';
      const status = code === 'unauthorized' ? 403 : code === 'not_found' ? 404 : code.includes('stale') || code === 'idempotency_conflict' ? 409 : code === 'payload_too_large' ? 413 : 400;
      return json({ error: code, message: safe.message }, status);
    }
  },
} satisfies ExportedHandler<Env>;
