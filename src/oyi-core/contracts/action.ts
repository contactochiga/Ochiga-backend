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
  domain: OyiDomain;
  target: CanonicalTarget;
  requested_operation: string;
  requested_state: unknown;
  status: OyiActionStatus;
  idempotency_key: string;
  approved_at: string | null;
  executed_at: string | null;
  completed_at: string | null;
  execution_id: string | null;
  verification_id: string | null;
  result: Record<string, unknown> | null;
  evidence: Array<Record<string, unknown>>;
};
