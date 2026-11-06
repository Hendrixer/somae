import type { State, Principal, CommandResult, ArtifactRef } from '../domain/index.js';
export type Block = { id: string; type: string; text: string };
export type Comment = { artifact_id: string; revision: number; kind: 'comment' | 'replace'; text: string; replacement?: string; anchor: { type: 'text'; block_id: string; start: number; end: number; quote: string } | { type: 'region'; x: number; y: number; width: number; height: number } };
export type ReviewDecision = 'approve' | 'reject';
/** An exact original interaction value explicitly chosen by the person. */
export type ReviewSourceRequest = { signal_id: string; expected_revision: number; interaction_id: string; value: Record<string, unknown> };
export type ReviewRequest = { signal_id: string; revision: number; artifacts: ArtifactRef[] };
export type Review = { id: string; conversation_id: string; artifacts: ArtifactRef[]; comments: Comment[]; note: string; created_at: string; person_id: string; message_id: string; delivery_id: string; decision?: ReviewDecision; source_request?: ReviewSourceRequest; response_id?: string };
export type Approval = { id: string; artifact_id: string; artifact_revision: number; person_id: string; at: string; sequence: number; previous_id: string | null };
export type ArtifactDecision = Approval & { decision: ReviewDecision; review_id: string };
/** Question sources carry their offered value without decision/sequences; structured review sources require the binary decision. Comments are optional for either response. */
export type SubmitReviewOperation = { type: 'review.submit'; idempotency_key: string; conversation_id: string; artifacts: ArtifactRef[]; comments: Comment[]; note?: string; source_request?: ReviewSourceRequest } & ({ decision: ReviewDecision; expected_sequences: Record<string, number> } | { decision?: never; expected_sequences?: never });
export type RequestReviewOperation = { type: 'agent.review'; idempotency_key: string; conversation_id: string; text: string; artifacts: ArtifactRef[] };
export type Item = { id: string; title: string; filename: string; conversation_id: string; latest_revision: number; created_at: string; updated_at: string; versions: Record<number, { filename: string; blocks: Block[] | null; review_id: string | null }> };
export type Session = { connection_id: string; endpoint_id: string; session_id: string; workspace_id: string; title: string };
export type OperationResult = CommandResult & { connection_id?: string; endpoint_id?: string; review?: Review; approval?: Approval; saved?: boolean };
export type LibraryState = { version: number; identity: { person_id: string; device_id: string; machine_id: string }; domain: State; sessions: Record<string, Session>; items: Record<string, Item>; reviews: Record<string, Review>; review_requests?: Record<string, ReviewRequest>; drafts: Record<string, unknown>; decisions?: Record<string, ArtifactDecision>; decision_history?: Record<string, ArtifactDecision>; approvals: Record<string, Approval>; approval_history: Record<string, Approval>; cleared: Record<string, { person_id: string; at: string }>; operations: Record<string, { input: unknown; result: unknown }> };
export class LibraryError extends Error { code: string; constructor(code: string, message: string); }
export function createLibrary(identity?: Partial<LibraryState['identity']>): LibraryState;
export function applyLibraryOperation(before: LibraryState, operation: Record<string, unknown>, principal: Principal, options?: { now?: string; origin?: string; id?: (prefix: string) => string }): { state: LibraryState; result: OperationResult };
export function validateAnchor(state: LibraryState, refs: ArtifactRef[], comment: Comment): void;
export function formatReview(review: Review): string;
export function projectLibrary(state: LibraryState, principal: Principal): {
  connections: { id: string; name: string; agent: string; online: boolean; state: string }[];
  conversations: { id: string; title: string; connection_id: string; created_at: string }[];
  signals: unknown[]; messages: unknown[]; items: unknown[]; reviews: Review[]; drafts: Record<string, unknown>; deliveries: unknown[];
};
