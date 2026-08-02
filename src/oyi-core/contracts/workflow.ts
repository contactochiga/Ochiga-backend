import type { AuthorityDecision } from "./authority";
import type { CanonicalTarget } from "./target";
import type { OyiDomain, OyiOperation } from "../runtime/languageUnderstanding";

export type WorkflowStatus =
  | "collecting_inputs"
  | "awaiting_clarification"
  | "ready_for_review"
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "verifying"
  | "answered"
  | "empty"
  | "unavailable"
  | "unsupported"
  | "permission_restricted"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"
  | "superseded";

export type OyiWorkflow = {
  workflow_id: string;
  thread_id: string;
  request_id: string;
  capability_key: string;
  domain: OyiDomain;
  operation: OyiOperation | string;
  status: WorkflowStatus;
  target: CanonicalTarget | null;
  inputs: Record<string, { value: unknown; source: string; validated: boolean }>;
  unresolved_inputs: string[];
  authority_decision: AuthorityDecision | null;
  proposed_action: Record<string, unknown> | null;
  execution_record: Record<string, unknown> | null;
  evidence: Array<Record<string, unknown>>;
  revision: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};
