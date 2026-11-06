# Somae domain reference runtime

This package makes the [communication contract](../../docs/architecture/communication-contract.md) executable before the API or native apps exist. Its audience is developers and coding agents building Somae: they can inspect the entity model, find the rules governing a change, and verify those rules against executable scenarios. It is a dependency-free Node.js ESM reference boundary, with a machine-readable ontology, typed commands, guarded transitions, and adversarial integration scenarios. The prototype remains a separate visual mock; these fixtures are not integrations with product-connected agents.

## Start here

- [ontology.json](ontology.json): entities, relationships, enums, supported commands, and stable business-rule IDs, including review/library extensions. Rule records link to enforcing functions and exact ordinary test titles. The runtime consumes its command allowlists and domain enums.
- [ontology.schema.json](ontology.schema.json): JSON Schema for the ontology metadata.
- [index.d.ts](index.d.ts): discriminated commands, trusted principals, records, and return types for coding agents developing Somae and editor autocomplete.
- [index.js](index.js): authoritative command guards and relational state audit for this reference implementation.
- [conformance.test.js](conformance.test.js): all four integration fixtures and shared behavioral scenarios.
- [audit-regressions.test.js](audit-regressions.test.js): adversarial restoration, identity, pinning and idempotency cases.
- [response-content.test.js](response-content.test.js): a canonical answer and accompanying feedback share one message/delivery, with content validation, pinned artifacts, stale-request rejection and retry coverage.

Run `npm run verify` from the repository root. For only this package, run `npm run check --workspace=@somae/domain`. No install or network access is needed. Metadata validation checks schema, rule references, enforcing function locations, known test declarations, and fixture integrity. The test runner establishes whether the referenced scenarios pass; a name in the ontology is not a proof by itself.

## Use the guarded boundary

```js
import { createRuntime } from './index.js';
import { createFixture } from './fixtures.js';

const fixture = createFixture('custom_turn_based');
const runtime = createRuntime({ seed: fixture.seed });
const sent = runtime.execute({
  command: 'message.submit', idempotency_key: 'hello-1',
  connection_id: fixture.connection_id, title: 'Launch direction',
  content: [{ type: 'text', text: 'Show me two launch directions.' }],
}, fixture.person);

const published = runtime.execute({
  command: 'signal.publish', idempotency_key: 'choice-1',
  conversation_id: sent.conversation.id,
  kind: 'question', content: [{ type: 'text', text: 'Which direction?' }],
  interaction: {
    id: 'direction', mode: 'required', response_type: 'single_choice',
    actions: [{ id: 'quiet', label: 'Quiet' }, { id: 'bold', label: 'Bold' }],
    consequences: 'Starts a design pass. Does not publish the site.',
  },
  presentation: { type: 'native_choice' },
}, fixture.agent);

const accepted = runtime.execute({
  command: 'response.submit', idempotency_key: 'answer-1',
  signal_id: published.signal.id, expected_revision: 1,
  interaction_id: 'direction', value: { option_id: 'bold' },
}, fixture.mobile);

runtime.execute({ command: 'delivery.dispatch', idempotency_key: 'attempt-1',
  delivery_id: accepted.delivery.id }, { kind: 'system' });
runtime.execute({ command: 'delivery.ack', idempotency_key: 'receipt-1',
  delivery_id: accepted.delivery.id }, fixture.agent);
runtime.execute({ command: 'input.accept', idempotency_key: 'input-1',
  delivery_id: accepted.delivery.id }, fixture.agent);
```

Every execute call copies candidate state, validates authority and domain rules, applies the whole transition, audits invariants and immutability, then commits. A `DomainError` has a stable `code` and `ruleIds`; rejected commands leave canonical state unchanged. Messages, artifacts, responses and context snapshots are copied so caller mutation cannot edit accepted records. Inputs use snake_case throughout.

The host supplies the authenticated principal separately from the command. Never construct it from client `person_id`, `endpoint_id`, or `device_id` payload fields. Those authority fields are rejected on commands. Endpoints, registered devices and approved connections are initially provisioned through trusted seed data; invitations and authentication are deferred.

`runtime.execute()` results and `runtime.snapshot()` are **internal host records**, containing routing/session references and, for snapshots, all people and the idempotency/audit stores. Neither is a client DTO or an endpoint-wide export API. A future transport must implement authenticated, audience-scoped projections that remove private session/workspace references and unrelated context. The package deliberately exposes no HTTP endpoint. Mobile and browser clients consume the contract/types; the Node runtime is not directly importable there.

## Implemented policies

| Area | Guarded behavior |
| --- | --- |
| Authority | Stable identity, registered active device, one person and one endpoint per conversation; endpoint support ∩ connection capabilities ∩ person permissions. |
| Local initiation | `message.submit` requires a desktop on the registered machine and an online local adapter, even for an existing conversation. Hosted input can queue when durable delivery is supported. |
| Local responses | A remote or offline reply requires an explicit unexpired continuation matching the conversation's existing session/workspace. Remote replies also require `responses.remote_continuation`. It cannot start another local session. |
| Signals | Exact revision check, append-only presentation history, one terminal response, no reopening terminal signals. Read/set-aside only changes a person-owned view. |
| Interaction | Text limits; unique single/multiple choice IDs; required primitive form fields with enums/bounds and no unknown properties; explicit approve/reject actions. Unsupported schema keywords fail closed. |
| Response feedback | Optional response `content` follows the canonical answer in the same human message and outbox delivery. Existing content and pinned-artifact guards apply; invalid feedback rejects the entire response. |
| Approval | Concrete operation/scope/target/cost and artifact versions, with a canonical SHA256 terms digest. The response must carry that exact digest. |
| Artifacts | Endpoint-published metadata and immutable contiguous versions, conversation scope, readable description, explicit origin/access policy, paired presentation pins. Re-sending an existing artifact checks receive permission, media type and size. |
| Context | Explicit consent and purpose on each submission, stored copied snapshot and precise connection/endpoint audience. No blanket context grant. |
| Delivery | Atomic response/message/signal/outbox commit; separate stored, dispatched, received, and input outcome facts; deadlines at submit/dispatch. Offline queuing is distinct from incapability or revocation. |
| Pause/revoke | Pause rejects new inputs/publications and suspends undispatched delivery; allows withdrawal and dispatched receipts. Revoke terminates undispatched input and withdraws active signals. Dispatched effects cannot be recalled; authenticated receipts can finish. |
| Retry | Stable person/endpoint + command idempotency, independent of device. Exact payload retry returns the original result only after checking current authority. Changed payload conflicts. At-least-once dispatch retains the same delivery ID. |
| Ambiguity | `input.unknown` records an ambiguous provider handoff and blocks automatic reinjection. No claim of exactly-once external execution. |
| Audit | Canonical foreign keys, contiguous conversation sequences, response/delivery pins, receipt provenance, event audience and cache scope validated on trusted seed import and every transition. |

`conversation.bind` is an owning endpoint operation: the adapter can bind an initially unbound conversation once, and cannot silently replace its session or workspace. The local fixture includes an already bound `session_1` / `workspace_1` conversation. The four fixtures are `local_coding`, `hosted_coding`, `custom_turn_based`, and `custom_durable`; they exercise shared communication, not actual provider behavior.

The command fields and actor allowlists are listed in `ontology.commands`, with types in `index.d.ts`. Commands always require an `idempotency_key`. Use an `expected_revision` for signal changes, response submission, grant changes, and existing artifact revisions. Fresh message/signal publication must include a `connection_id` or an existing `conversation_id`. All content contains a text/Markdown fallback; optional rich blocks are structured JSON data or explicit pinned artifact references. Arbitrary custom applications are deferred.

## Review/library extension

`packages/library` reuses this command boundary for version-bound feedback and content-review decisions. Its host state contains immutable reviews, explicit request-to-signal/artifact associations, per-artifact decision history, approval pins and drafts. `agent.review` publishes an artifact-pinned approval signal whose terms cover content review only. `review.submit` accepts approve/reject with optional notes and exact current decision sequences. Both decisions create one communication delivery, including when no notes were added; rejection retains any approved older copy.

A review's optional `source_request` carries an exact signal revision, interaction ID and offered response value. Structured review requests require the full pinned artifact set and matching decision/digest. The library uses `response.submit` with the complete review as appended content, so the review, response, answered signal, decision records, one message/outbox and draft removal commit as one candidate. Questions keep their original choices or free-text response: the artifact canvas submits the exact answer with optional comments and no review decision. Zero-comment answers are valid. A question response does not create artifact approvals or decision records, regardless of the option's wording. Only structured `agent.review` requests show the fixed Approve / Request changes actions; labels are never interpreted as approval actions. Execution approvals and unrelated requests cannot be answered through artifact feedback. Without a source request, feedback or an independent decision sends a standalone message. The one-artifact `version.approve` compatibility alias also sends available compatible notes; unfinished drafts fail safely, and existing cached historical results are not redelivered.

Additional entity/rule records in the same ontology point to this library boundary and its ordinary tests. The kernel does not directly interpret library collections. The Worker persists the combined candidate atomically; importing ontology metadata alone does not enforce these application policies. Exact request/artifact revisions, continuation policy, pinned terms and retry authority checks remain kernel requirements.

The domain module now imports ontology JSON as a bundlable module rather than reading it from a filesystem. Node and Bun still run the same guards; Worker builds enable Node compatibility for hashing. Worker integration tests check the resulting storage and authorization paths separately from this memory reference.

## Limits before production

This is a serialized **in-memory** reference implementation, not a durable server. A process crash loses state. Atomicity here is one synchronous candidate-state commit; a production database must transact the canonical entities, revision compare-and-set, idempotency record and outbox together. Multiple processes need database serialization/locks. Invariant audits are intentionally expensive and are not a scalable storage architecture.

The relational audit rejects malformed or inconsistent imported records. It cannot prove historical authenticity or detect a malicious edit that changes an immutable record and all related evidence consistently. Persistence import is a trusted host operation. Protect production writes, credentials, event integrity and migration access outside this package, and pass the same conformance suite against that implementation.

Artifact URL/digest/access metadata is validated, but this runtime does not fetch content, verify bytes against their digest, scan uploads, or enforce storage ACLs. Person upload/publication, invitation/OAuth flows, transport signatures, real provider adapters, access-scoped projections, replay cursors, storage retention/deletion, ongoing context grants and custom embedded apps remain explicitly deferred in the ontology. Native apps, adapters and APIs must extend verification for their own output before launch.

Application receipts trust the authenticated integration to report the actual destination outcome. Somae does not establish that an agent performed an operation, finished work, or deduplicated external side effects merely by accepting a response. After an ambiguous handoff, reconciliation belongs in an adapter with evidence; this reference runtime offers no automatic recovery shortcut.
