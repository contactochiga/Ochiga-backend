// Wave 7 Slice 5 -- Canonical Decision object.
//
// A Decision is the durable answer to "what course of action has Oyi
// actually selected?" -- distinct from every neighboring object:
//   Recommendation answers "what could/should happen" (advisory, may
//     never be acted on).
//   Decision answers "this specific course of action, for this specific
//     entity, HAS been selected" -- under either deterministic policy or
//     human authorization.
//   Goal answers "what sustained objective are we pursuing" (GoalRuntime,
//     unchanged by this slice).
//   Plan answers "what staged route gets there" (unchanged, unconverged).
//   Approval answers "may this specific selected action proceed"
//     (automation_approvals/GovernedActionProposal, unchanged, coexisting).
//   Execution answers "did the attempt to perform it succeed" (Wave 5,
//     frozen, untouched).
//
// A Decision never executes anything itself (see DecisionStore.ts) and
// never replaces any of the above -- it is a new, additive record of
// selection, modeled on automation_approvals' own proven shape but
// generalized to entity_type/entity_id per the accepted Slice 0 roadmap.
export type DecisionStatus =
  | "selected"
  | "awaiting_human"
  | "approved"
  | "rejected"
  | "superseded"
  | "cancelled";

export const DECISION_TERMINAL_STATUSES: DecisionStatus[] = ["rejected", "superseded", "cancelled"];

// Who/what authorized this specific selection to become a Decision.
// "deterministic_policy" -- a real, existing, evidence-driven policy
//   function (not a human, not a guess) selected this course of action
//   (e.g. relationshipCommunicationPolicyForJv()).
// "human_selection" -- a human directly chose this course of action
//   (reserved for a future producer; not used by this slice's own
//   first producer).
export type DecisionAuthorityMode = "deterministic_policy" | "human_selection";

export type DecisionRecord = {
  id: string;
  // Stable semantic identity -- never positional/index-derived (Slice 2's
  // own lesson). Replaying the same real-world selection must resolve to
  // the same decision_key, so retries/replays never duplicate a row.
  decision_key: string;

  entity_type: string;
  entity_id: string;

  // The course of action itself -- a real, existing vocabulary value
  // from whatever domain produced this Decision (e.g. a
  // RelationshipCommunicationPolicy value), never invented here.
  action_type: string;
  title: string;
  reason: string | null;

  status: DecisionStatus;
  requires_human: boolean;

  selected_by: string; // 'system' | a real actor id
  authority_mode: DecisionAuthorityMode;
  policy_source: string | null; // which real policy/detector produced this, when known

  // Lineage -- all honestly nullable. No Decision is required to trace
  // back to a Recommendation or a Goal; a real Decision can exist with
  // none of these (see docs, "Decision without a recommendation").
  canonical_signal_key: string | null;
  recommendation_key: string | null;
  goal_id: string | null;
  plan_id: string | null;
  incident_id: string | null;
  awareness_key: string | null;

  superseded_by: string | null;
  metadata: Record<string, unknown>;

  created_at: string;
  updated_at: string;
  decided_at: string | null;
  closed_at: string | null;
};

export type CreateDecisionInput = {
  decision_key: string;
  entity_type: string;
  entity_id: string;
  action_type: string;
  title: string;
  reason?: string | null;
  status: DecisionStatus;
  requires_human: boolean;
  selected_by: string;
  authority_mode: DecisionAuthorityMode;
  policy_source?: string | null;
  canonical_signal_key?: string | null;
  recommendation_key?: string | null;
  goal_id?: string | null;
  plan_id?: string | null;
  incident_id?: string | null;
  awareness_key?: string | null;
  metadata?: Record<string, unknown>;
};
