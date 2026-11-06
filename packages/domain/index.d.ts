/** Node.js host-only reference runtime. Raw results/snapshots contain private routing. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type PersonPrincipal = { kind: 'person'; person_id: string; device_id: string };
export type EndpointPrincipal = { kind: 'endpoint'; endpoint_id: string };
export type SystemPrincipal = { kind: 'system' };
export type Principal = PersonPrincipal | EndpointPrincipal | SystemPrincipal;
export type StableActor = Omit<PersonPrincipal, 'device_id'> | EndpointPrincipal | SystemPrincipal;
export type Capability = 'messages.start' | 'messages.continue' | 'messages.publish' | 'signals.publish' | 'signals.update' | 'signals.withdraw' | 'responses.receive' | 'responses.remote_continuation' | 'artifacts.publish' | 'artifacts.receive' | 'context.receive';
export type ArtifactRef = { artifact_id: string; revision: number };
export type Block = { type: 'text' | 'markdown'; text: string } | { type: 'data'; value: Json } | ({ type: 'artifact' } & ArtifactRef);
export type Continuity = { session_id: string; workspace_id: string };
export type Continuation = Continuity & { valid_until: string };
export type ContextShare = { consent: true; purpose: string; snapshot: Record<string, Json> };
export type Action = { id: string; label: string };
export type ApprovalTerms = { operation: string; scope: string; target: string; cost?: { amount: number; currency: string }; artifact_refs: ArtifactRef[] };
export type PrimitiveSchema = { type: 'string' | 'number' | 'integer' | 'boolean'; enum?: (string | number | boolean | null)[]; minLength?: number; maxLength?: number; minimum?: number; maximum?: number };
export type FormSchema = { type: 'object'; properties: Record<string, PrimitiveSchema>; required: string[]; additionalProperties: false };
type InteractionBase = { id: string; mode: 'required' | 'optional'; consequences: string };
export type Interaction = InteractionBase & (
  | { response_type: 'text'; max_length?: number }
  | { response_type: 'single_choice' | 'multiple_choice'; actions: Action[] }
  | { response_type: 'form'; schema: FormSchema }
  | { response_type: 'approval'; actions: [{ id: 'approve'; label: string }, { id: 'reject'; label: string }] | [{ id: 'reject'; label: string }, { id: 'approve'; label: string }]; terms: ApprovalTerms }
);
export type StoredInteraction = Interaction & { terms_digest?: string };
export type ResponseValue = { text: string } | { option_id: string } | { option_ids: string[] } | { fields: Record<string, string | number | boolean> } | { action_id: 'approve' | 'reject'; terms_digest: string };
export type Presentation = ({ type: 'native' | 'native_choice' | 'native_form' } & ({ artifact_id?: never; artifact_revision?: never } | { artifact_id: string; artifact_revision: number })) | { type: 'artifact'; artifact_id: string; artifact_revision: number };
type BaseCommand = { idempotency_key: string };
type Publication = { connection_id?: string; conversation_id?: string; title?: string; content: Block[]; artifact_refs?: ArtifactRef[]; in_reply_to_message_id?: string };
type SignalFields = { kind: 'result' | 'notice' | 'question' | 'approval'; content: Block[]; artifact_refs?: ArtifactRef[]; interaction: Interaction | null; presentation: Presentation; expires_at?: string | null; continuation?: Continuation | null; in_reply_to_message_id?: string };
export type MessageSubmit = BaseCommand & Publication & { command: 'message.submit'; context?: ContextShare };
export type MessagePublish = BaseCommand & Publication & { command: 'message.publish'; continuity?: Continuity };
export type SignalPublish = BaseCommand & Publication & SignalFields & { command: 'signal.publish'; continuity?: Continuity; supersedes_signal_id?: string };
export type SignalUpdate = BaseCommand & SignalFields & { command: 'signal.update'; signal_id: string; expected_revision: number };
export type SignalWithdraw = BaseCommand & { command: 'signal.withdraw'; signal_id: string; expected_revision: number; reason: string };
export type SignalExpire = BaseCommand & { command: 'signal.expire'; signal_id: string; expected_revision: number };
export type ResponseSubmit = BaseCommand & { command: 'response.submit'; signal_id: string; expected_revision: number; interaction_id: string; value: ResponseValue; content?: Block[]; artifact_refs?: ArtifactRef[]; context?: ContextShare };
export type ArtifactPublish = BaseCommand & { command: 'artifact.publish'; conversation_id: string; artifact_id?: string; expected_revision?: number; media_type: string; presentation_type: 'document' | 'image' | 'code' | 'data'; content_ref: { uri: string; origin: string; access: 'conversation' }; digest: string; size: number; description: string };
export type ConnectionChange = BaseCommand & { command: 'connection.pause' | 'connection.resume' | 'connection.revoke'; connection_id: string; expected_revision: number };
export type ConversationBind = BaseCommand & Continuity & { command: 'conversation.bind'; conversation_id: string };
export type DeliveryCommand = BaseCommand & { command: 'delivery.dispatch' | 'delivery.ack' | 'input.accept'; delivery_id: string };
export type InputFailure = BaseCommand & { command: 'input.reject' | 'input.unknown'; delivery_id: string; reason: string };
export type Availability = BaseCommand & { command: 'endpoint.set_availability'; endpoint_id: string; online: boolean };
export type InboxMark = BaseCommand & { command: 'inbox.mark'; signal_id: string; read?: boolean; set_aside?: boolean };
export type Command = MessageSubmit | MessagePublish | SignalPublish | SignalUpdate | SignalWithdraw | SignalExpire | ResponseSubmit | ArtifactPublish | ConnectionChange | ConversationBind | DeliveryCommand | InputFailure | Availability | InboxMark;
export type Person = { id: string; handle: string };
export type Device = { id: string; person_id: string; kind: 'desktop' | 'mobile'; machine_id: string; state: 'active' | 'revoked' };
export type Endpoint = { id: string; agent_id: string; hosting: 'local' | 'hosted'; execution: 'turn_based' | 'durable'; machine_id?: string; online: boolean; durable_delivery: boolean; capabilities: Capability[]; interaction_types: string[]; receive_media_types: string[]; max_artifact_bytes: number };
export type Connection = { id: string; person_id: string; agent_id: string; endpoint_id: string; state: 'pending' | 'active' | 'paused' | 'revoked'; permissions: Capability[]; capabilities: Capability[]; created_at: string; revision: number; machine_id?: string };
export type Conversation = { id: string; person_id: string; connection_id: string; endpoint_id: string; created_at: string; title: string; sequence: number; continuity: Continuity | null };
export type Message = { id: string; conversation_id: string; author: PersonPrincipal | EndpointPrincipal; created_at: string; sequence: number; content: Block[]; artifact_refs: ArtifactRef[]; context_snapshot_refs: { snapshot_id: string; revision: number }[]; in_reply_to_message_id?: string };
export type SignalRevision = { revision: number; message_id: string; kind: SignalFields['kind']; interaction: StoredInteraction | null; presentation: Presentation; expires_at: string | null; continuation: Continuation | null };
export type Signal = SignalRevision & { id: string; conversation_id: string; connection_id: string; state: 'active' | 'answered' | 'withdrawn' | 'expired'; created_at: string; updated_at: string; response_id: string | null; revisions: SignalRevision[]; withdrawal_reason?: string; supersedes_signal_id?: string };
export type Response = { id: string; signal_id: string; signal_revision: number; interaction_id: string; conversation_id: string; message_id: string; person_id: string; origin_device_id: string; submitted_at: string; value: ResponseValue; artifact_refs: ArtifactRef[]; delivery_id: string; terms_digest?: string };
export type Artifact = Omit<ArtifactPublish, 'command' | 'idempotency_key' | 'expected_revision' | 'artifact_id'> & { id: string; revision: number; publisher: EndpointPrincipal; created_at: string };
export type ContextSnapshot = { id: string; revision: number; conversation_id: string; person_id: string; audience: { endpoint_id: string; connection_id: string }; purpose: string; consent: true; created_at: string; value: Record<string, Json> };
export type Delivery = { id: string; connection_id: string; endpoint_id: string; conversation_id: string; message_id: string; response_id: string | null; created_at: string; state: 'queued' | 'paused' | 'received' | 'failed' | 'expired' | 'revoked'; input_state: 'unknown' | 'accepted' | 'rejected' | 'ambiguous'; valid_until: string | null; attempts: number; dispatched_at: string | null; received_at: string | null; receipt?: { endpoint_id: string; at: string; hop: 'integration' }; input_receipt: { endpoint_id: string; at: string; hop: 'agent_input'; reason: string | null } | null; continuation: Continuation | null; signal_revision: number | null };
export type InboxView = { person_id: string; signal_id: string; read: boolean; set_aside: boolean };
export type DomainEvent = { id: string; protocol_version: '0.1'; cursor: number; type: string; source: Principal; timestamp: string; audience: { person_id: string | null; endpoint_id: string | null }; entity_id: string; entity_revision: number | null; conversation_id: string | null; conversation_sequence: number | null; causation: { command: Command['command']; idempotency_key: string } };
export type CommandResult = { conversation?: Conversation; message?: Message; signal?: Signal; response?: Response; artifact?: Artifact; delivery?: Delivery; connection?: Connection; endpoint?: Endpoint; view?: InboxView };
export type IdempotencyRecord = { actor: StableActor; command: Command['command']; key: string; payload: Command; payload_digest: string; result: CommandResult; created_at: string };
/** INTERNAL HOST snapshot, includes all people, private session references and audit/cache. */
export type State = { protocol_version: '0.1'; persons: Record<string, Person>; devices: Record<string, Device>; endpoints: Record<string, Endpoint>; connections: Record<string, Connection>; conversations: Record<string, Conversation>; messages: Record<string, Message>; signals: Record<string, Signal>; responses: Record<string, Response>; artifacts: Record<string, Artifact>; context_snapshots: Record<string, ContextSnapshot>; deliveries: Record<string, Delivery>; inbox_views: Record<string, InboxView>; idempotency: Record<string, IdempotencyRecord>; events: DomainEvent[] };
export type ResultFor<C extends Command> = C extends MessageSubmit ? { conversation: Conversation; message: Message; delivery: Delivery } : C extends MessagePublish ? { conversation: Conversation; message: Message } : C extends SignalPublish | SignalUpdate ? { conversation: Conversation; message: Message; signal: Signal } : C extends SignalWithdraw | SignalExpire ? { signal: Signal } : C extends ResponseSubmit ? { response: Response; message: Message; delivery: Delivery; signal: Signal } : C extends ArtifactPublish ? { artifact: Artifact } : C extends ConnectionChange ? { connection: Connection } : C extends ConversationBind ? { conversation: Conversation } : C extends Availability ? { endpoint: Endpoint } : C extends InboxMark ? { view: InboxView } : { delivery: Delivery };
export type Runtime = { /** Trusted host principal only; return value requires client projection. */ execute<C extends Command>(command: C, principal: Principal): ResultFor<C>; /** Host export; never transmit directly to clients. */ snapshot(): State };
export type Ontology = { id: string; version: string; status: string; path_base: string; enums: Record<string, string[]>; entities: { name: string; collection: string; identity: string; description: string; immutable?: boolean }[]; relationships: { from: string; field: string; to: string; cardinality: string }[]; commands: Record<string, { actor: Principal['kind']; capability?: string; required: string[]; optional: string[] }>; rules: { id: string; status: 'implemented-reference'; description: string; enforcement: string[]; tests: string[] }[]; deferred: string[] };
export class DomainError extends Error { code: string; ruleIds: string[]; constructor(code: string, message: string, ruleIds?: string[]); }
export const CAPABILITIES: readonly Capability[];
export function getOntology(): Ontology;
export function emptyState(): State;
export function verifyState(state: unknown): { message: string; ruleIds: string[] }[];
export function createRuntime(options?: { seed?: State; clock?: () => string | Date; idFactory?: (prefix: string) => string }): Runtime;
