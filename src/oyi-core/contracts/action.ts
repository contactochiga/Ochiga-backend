import type { CanonicalTarget } from "./target";
import type { OyiDomain } from "../runtime/languageUnderstanding";

export type OyiActionStatus =
  | "draft"
  | "awaiting_confirmation"
  | "approved"
  | "queued"
  | "sent"
  | "provider_accepted"
  | "provider_rejected"
  | "verifying"
  | "confirmed"
  | "unobservable"
  | "timed_out"
  | "failed"
  | "cancelled"
  | "superseded";

export type OyiAction = {
  action_id: string;
  workflow_id: string;
  thread_id: string | null;
  actor_id: string | null;
  capability_key: string;
  domain: OyiDomain;
  target: CanonicalTarget;
  requested_operation: string;
  requested_state: unknown;
  status: OyiActionStatus;
  idempotency_key: string;
  revision: number;
  approved_at: string | null;
  queued_at: string | null;
  sent_at: string | null;
  provider_accepted_at: string | null;
  verification_started_at: string | null;
  executed_at: string | null;
  completed_at: string | null;
  execution_id: string | null;
  verification_id: string | null;
  executor_reference: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  safe_error: Record<string, unknown> | null;
  evidence: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
};
