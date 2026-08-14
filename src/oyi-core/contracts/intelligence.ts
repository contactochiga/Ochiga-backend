import type { CanonicalTarget } from "./target";
import type { OyiEvidence, CanonicalResponseClaim, IntelligenceFact, IntelligenceInference } from "./evidence";
import type { OyiDomain } from "../runtime/languageUnderstanding";

export type IntelligenceHierarchyStage =
  | "raw_signal"
  | "canonical_evidence"
  | "intelligence_fact"
  | "inference"
  | "prediction"
  | "recommendation"
  | "canonical_claim";

export type IntelligenceArtifact =
  | { stage: "canonical_evidence"; value: OyiEvidence }
  | { stage: "intelligence_fact"; value: IntelligenceFact }
  | { stage: "inference"; value: IntelligenceInference }
  | { stage: "canonical_claim"; value: CanonicalResponseClaim };

export type ContributionStatus = "available" | "empty" | "unavailable" | "permission_restricted" | "not_applicable";

export type RecommendedIntelligenceAction = {
  action_key: string;
  label: string;
  risk_class: "read" | "low_risk_action" | "consequential_action" | "sensitive_action" | "secure_handoff_only";
  destination: string | null;
  requires_confirmation: boolean;
};

export type HomeContribution = {
  domain: OyiDomain;
  status: ContributionStatus;
  priority: "low" | "normal" | "attention" | "warning" | "critical";
  summary: string;
  evidence_ids: string[];
  freshness: OyiEvidence["freshness"];
  confidence: number;
  recommended_actions: RecommendedIntelligenceAction[];
  destination: string | null;
  availability: {
    available: boolean;
    reason: string | null;
  };
};

export type AuthorizedHomeContext = {
  actor_id: string | null;
  surface: string;
  estate_id: string | null;
  home_id: string;
  permissions: string[];
};

export interface HomeIntelligenceContributor {
  domain: OyiDomain;
  contribute(context: AuthorizedHomeContext): Promise<HomeContribution>;
}

export type RoomContribution = HomeContribution & {
  room_id: string;
  room_label: string | null;
};

export type AuthorizedRoomContext = AuthorizedHomeContext & {
  room_id: string;
  room_label: string | null;
};

export interface RoomIntelligenceContributor {
  domain: OyiDomain;
  contribute(context: AuthorizedRoomContext): Promise<RoomContribution>;
}

// Programme 3 note: these two types predate any real caller (grep confirms
// zero call sites before this pass) but their shape already matched the
// Programme 3 taxonomy closely, so they are MATURED in place — extended
// additively, not replaced — rather than introducing a second "Anomaly"/
// "Prediction" contract elsewhere. scope/object_refs are new; everything
// else is unchanged from the original definition.
export type OperationalScope = {
  estate_id: string | null;
  home_id: string | null;
  room_id: string | null;
};

export type OperationalAnomaly = {
  anomaly_id: string;
  domain: OyiDomain;
  anomaly_type: string;
  scope: OperationalScope;
  subject: CanonicalTarget | null;
  object_refs: CanonicalTarget[];
  generated_at: string;
  // What window of evidence this anomaly was detected over, and what made
  // it anomalous — a plain deviation description, not a fabricated
  // statistical model unless a detector genuinely computes one.
  window: { from: string | null; to: string | null } | null;
  baseline: string | null;
  observed: string | null;
  deviation: string | null;
  severity: "info" | "attention" | "warning" | "critical";
  confidence: number;
  evidence_ids: string[];
  status: "active" | "acknowledged" | "resolved" | "dismissed" | "expired";
  explanation: string;
  source_model: string;
  source_model_version: string;
  limitations: string[];
  payload: Record<string, unknown>;
};

export type OperationalPrediction = {
  prediction_id: string;
  domain: OyiDomain;
  prediction_type: string;
  scope: OperationalScope;
  subject: CanonicalTarget | null;
  object_refs: CanonicalTarget[];
  generated_at: string;
  horizon: string;
  predicted_value: unknown;
  probability: number | null;
  confidence: number;
  severity: "info" | "attention" | "warning" | "critical";
  evidence_ids: string[];
  reasoning_summary: string;
  model_name: string;
  model_version: string;
  model_type: "rule" | "statistical" | "machine_learning" | "hybrid";
  expires_at: string | null;
  status: "active" | "realized" | "not_realized" | "partial" | "expired" | "dismissed";
  limitations: string[];
};

// New — no forecast contract existed before Programme 3. Only enabled for
// metrics with real historical numerical data (see forecastProviders.ts) —
// confidence_interval is null (not fabricated) when the method cannot
// justify an uncertainty estimate; data_quality is then the honest signal
// instead.
export type OperationalForecast = {
  forecast_id: string;
  domain: OyiDomain;
  metric: string;
  scope: OperationalScope;
  object_refs: CanonicalTarget[];
  generated_at: string;
  forecast_horizon: string;
  time_points: string[];
  predicted_values: number[];
  confidence_interval: { lower: number[]; upper: number[] } | null;
  baseline: { method: string; values: number[] } | null;
  historical_window: { from: string; to: string; sample_count: number };
  method: string;
  method_version: string;
  evidence_ids: string[];
  data_quality: "sufficient" | "limited" | "stale" | "sparse" | "unavailable" | "unsupported";
  status: "active" | "expired" | "evaluated";
};

// New — first-class recommendation object, distinct from the lighter
// RecommendedIntelligenceAction (a UI action affordance) already defined
// above. A recommendation may reference an actionable capability, but
// Programme 3 never executes it — see recommendationPlanner.ts.
export type OperationalRecommendation = {
  recommendation_id: string;
  domain: OyiDomain;
  scope: OperationalScope;
  object_refs: CanonicalTarget[];
  created_at: string;
  severity: "info" | "attention" | "warning" | "critical";
  title: string;
  summary: string;
  reason: string;
  evidence_ids: string[];
  suggested_action: string;
  actionability: "informational" | "review" | "actionable";
  requires_confirmation: boolean;
  capability_key: string | null;
  expires_at: string | null;
  status: "open" | "accepted" | "dismissed" | "executed" | "expired" | "superseded";
  dedup_key: string;
};

export type PredictionOutcome = {
  prediction_id: string;
  evaluated_at: string;
  outcome: "realized" | "not_realized" | "partial";
  actual_value: unknown;
  prediction_error: number | null;
  time_to_event_ms: number | null;
  confidence_calibration: number | null;
  evidence_ids: string[];
};

export type ForecastOutcome = {
  forecast_id: string;
  evaluated_at: string;
  time_point: string;
  predicted_value: number;
  actual_value: number;
  absolute_error: number;
  percentage_error: number | null;
  within_confidence_interval: boolean | null;
  evidence_ids: string[];
};

export type RecommendationOutcome = {
  recommendation_id: string;
  actor_id: string | null;
  outcome: "accepted" | "dismissed" | "ignored" | "helpful" | "not_helpful" | "issue_resolved" | "issue_not_resolved";
  recorded_at: string;
  metadata: Record<string, unknown>;
};

export type ActionOutcome = {
  action_id: string;
  outcome: "verified_success" | "failed" | "partial" | "reverted" | "problem_resolved" | "problem_recurred";
  recorded_at: string;
  evidence_ids: string[];
  metadata: Record<string, unknown>;
};

export type IntelligenceTraceEvent =
  | "request_received"
  | "context_loaded"
  | "turn_interpreted"
  | "workflow_restored"
  | "target_resolved"
  | "authority_resolved"
  | "capability_selected"
  | "evidence_planned"
  | "evidence_loaded"
  | "domain_invoked"
  | "response_composed"
  | "action_created"
  | "execution_started"
  | "verification_completed"
  | "turn_persisted"
  | "response_sent";

export const REQUIRED_INTELLIGENCE_TRACE_EVENTS: IntelligenceTraceEvent[] = [
  "request_received",
  "context_loaded",
  "turn_interpreted",
  "workflow_restored",
  "target_resolved",
  "authority_resolved",
  "capability_selected",
  "evidence_planned",
  "evidence_loaded",
  "domain_invoked",
  "response_composed",
  "turn_persisted",
  "response_sent",
];

export function unavailableContribution(domain: OyiDomain, reason: string): HomeContribution {
  return {
    domain,
    status: "unavailable",
    priority: "normal",
    summary: reason,
    evidence_ids: [],
    freshness: "unknown",
    confidence: 0,
    recommended_actions: [],
    destination: null,
    availability: { available: false, reason },
  };
}

export function rankHomeContributions(contributions: HomeContribution[]) {
  const severity = { critical: 5, warning: 4, attention: 3, normal: 2, low: 1 };
  return [...contributions].sort((a, b) => {
    const delta = severity[b.priority] - severity[a.priority];
    if (delta) return delta;
    return b.confidence - a.confidence;
  });
}
