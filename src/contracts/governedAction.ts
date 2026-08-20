// Oyi Conversational Runtime Completion Programme, Phase 3 — Governed
// Action Proposals.
//
// A conversational mutation request ("move this to in progress") is never
// executed directly. It's turned into one of these, tracked through a
// confirm/cancel round-trip, and only the record's OWN canonical mutation
// path (Office's updateOperationalRecord, already permission-checked and
// audited) ever actually writes the change -- Backend has no direct
// database access to Office's tasks/meetings/support tables at all (a
// separate Supabase project), so it cannot execute these itself. See
// officeActionProposal.ts for the full design note.
//
// risk_level intentionally reuses CapabilityRiskClass's own vocabulary
// (see contracts/capability.ts) rather than inventing a parallel scale --
// only "low_risk_action" and "consequential_action" are reachable in this
// phase; "sensitive_action"/"secure_handoff_only"-tier operations are not
// enabled here at all (financial, external, destructive).
import type { CapabilityRiskClass } from "../oyi-core/contracts/capability";

export type OfficeMutationRiskLevel = Extract<CapabilityRiskClass, "low_risk_action" | "consequential_action">;

export type OfficeActionProposalStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "expired"
  | "superseded"
  | "executed"
  | "execution_failed"
  | "verification_failed"
  | "verified";

export type OfficeActionAuthorization = {
  allowed: boolean;
  reason: string | null;
  required_permissions: string[];
};

export type OfficeActionValidation = {
  valid: boolean;
  reason: string | null;
};

export type OfficeActionVerificationResult = {
  verified: boolean;
  observed_state: Record<string, unknown> | null;
  reason: string | null;
};

// The one piece of information Office's frontend actually needs to
// perform the real mutation once a proposal is confirmed -- namespace/
// collection/record_id/patch map 1:1 onto office.js's EXISTING
// apiPatchOperational(namespace, collection, id, patch) call. Backend
// never calls this itself; it only ever describes it.
export type OfficeActionExecuteDirective = {
  namespace: string;
  collection: string;
  record_id: string;
  patch: Record<string, unknown>;
};

export type GovernedActionProposal = {
  proposal_id: string;
  thread_id: string;
  actor_id: string;
  domain: string;
  target_entity_type: string;
  target_entity_id: string;
  operation: string;
  parameters: Record<string, unknown>;
  description: string;
  previous_state: Record<string, unknown> | null;
  proposed_state: Record<string, unknown> | null;
  authorization: OfficeActionAuthorization;
  validation: OfficeActionValidation;
  confirmation_required: boolean;
  risk_level: OfficeMutationRiskLevel;
  idempotency_key: string;
  status: OfficeActionProposalStatus;
  execution_reference: string | null;
  created_at: string;
  expires_at: string;
  executed_at: string | null;
  verification_result: OfficeActionVerificationResult | null;
  failure_reason: string | null;
  execute_directive: OfficeActionExecuteDirective | null;
};

// Public-facing projection surfaced to Office over the wire (in
// OfficeInternalOyiCoreResponse.pending_action) -- deliberately excludes
// actor_id/thread_id (already known client-side) and keeps execute_
// directive only when the proposal has just been confirmed, never while
// merely pending (the client should not be able to skip the confirm step).
export type OfficeActionProposalView = {
  proposal_id: string;
  domain: string;
  target_entity_type: string;
  target_entity_id: string;
  operation: string;
  description: string;
  previous_state: Record<string, unknown> | null;
  proposed_state: Record<string, unknown> | null;
  risk_level: OfficeMutationRiskLevel;
  status: OfficeActionProposalStatus;
  execute_directive: OfficeActionExecuteDirective | null;
};
