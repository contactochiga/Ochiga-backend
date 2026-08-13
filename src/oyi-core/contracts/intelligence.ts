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

export type OperationalAnomaly = {
  anomaly_id: string;
  domain: OyiDomain;
  anomaly_type: string;
  subject: CanonicalTarget | null;
  generated_at: string;
  severity: "info" | "attention" | "warning" | "critical";
  confidence: number;
  evidence_ids: string[];
  status: "active" | "acknowledged" | "resolved" | "dismissed" | "expired";
  limitations: string[];
  payload: Record<string, unknown>;
};

export type OperationalPrediction = {
  prediction_id: string;
  domain: OyiDomain;
  prediction_type: string;
  subject: CanonicalTarget | null;
  generated_at: string;
  horizon: string;
  predicted_value: unknown;
  probability: number | null;
  confidence: number;
  severity: "info" | "attention" | "warning" | "critical";
  evidence_ids: string[];
  model_name: string;
  model_version: string;
  model_type: "rule" | "statistical" | "machine_learning" | "hybrid";
  expires_at: string | null;
  status: "active" | "realized" | "not_realized" | "partial" | "expired" | "dismissed";
  limitations: string[];
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
