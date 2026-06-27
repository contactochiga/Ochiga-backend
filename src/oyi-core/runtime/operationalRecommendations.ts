import type { NormalizedSignal, SignalEvidence, SignalSeverity } from "../contracts/operationalSignal";
import type { OperationalInsight } from "./operationalReasoning";
import type { OperationalAwareness, OperationalContext } from "./contextAwareness";

export type OperationalRecommendationDomain =
  | "infrastructure"
  | "security"
  | "maintenance"
  | "utility"
  | "environmental"
  | "visitor"
  | "financial"
  | "community"
  | "operational_governance"
  | "executive";

export type RecommendationUrgency = "monitor" | "review" | "act" | "urgent";
export type RecommendationActionType =
  | "verify_power"
  | "verify_network"
  | "inspect_hardware"
  | "review_access_event"
  | "check_camera_availability"
  | "schedule_preventive_inspection"
  | "escalate_overdue_issue"
  | "review_energy_spike"
  | "inspect_water_anomaly"
  | "restore_climate_device"
  | "inspect_environmental_sensor"
  | "verify_visitor_identity"
  | "check_access_policy"
  | "review_collection_drop"
  | "respond_to_complaints"
  | "assign_owner"
  | "verify_evidence"
  | "request_operator_decision"
  | "prepare_management_review";

export type OperationalRecommendationStatus = "open" | "monitoring" | "expired" | "resolved";

export type OperationalRecommendation = {
  id: string;
  title: string;
  summary: string;
  domain: OperationalRecommendationDomain;
  severity: SignalSeverity;
  urgency: RecommendationUrgency;
  confidence: number;
  reason: string;
  recommendedAction: string;
  actionType: RecommendationActionType;
  owner: string;
  expectedImpact: string;
  estimatedBenefit: string;
  verificationRequired: boolean;
  approvalRequired: boolean;
  safeToAutomate: boolean;
  relatedSignals: string[];
  relatedAwareness: string[];
  relatedInsights: string[];
  supportingEvidence: SignalEvidence[];
  generatedAt: string;
  expiresAt: string;
  status: OperationalRecommendationStatus;
  nextStep: string;
  source: "operational_recommendation_runtime";
};

export type RecommendationInput = {
  signals?: NormalizedSignal[];
  awareness?: OperationalAwareness[];
  insights?: OperationalInsight[];
  context?: OperationalContext;
  policies?: Record<string, unknown> | null;
  generatedAt?: string;
};

function text(value: unknown, fallback = "") {
  const next = String(value ?? "").trim();
  return next || fallback;
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function addHours(timestamp: string, hours: number) {
  return new Date(new Date(timestamp).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function urgencyFrom(value: SignalSeverity): RecommendationUrgency {
  if (value === "critical") return "urgent";
  if (value === "warning") return "act";
  if (value === "attention") return "review";
  return "monitor";
}

function actionTypeFor(domain: OperationalRecommendationDomain, insight: OperationalInsight): RecommendationActionType {
  const haystack = lower(`${insight.title} ${insight.summary} ${insight.reason}`);
  if (domain === "infrastructure") return /failed|error/.test(haystack) ? "inspect_hardware" : /offline|unreachable/.test(haystack) ? "verify_network" : "verify_power";
  if (domain === "security") return /camera/.test(haystack) ? "check_camera_availability" : "review_access_event";
  if (domain === "maintenance") return "schedule_preventive_inspection";
  if (domain === "utility") return /water/.test(haystack) ? "inspect_water_anomaly" : "review_energy_spike";
  if (domain === "environmental") return /sensor/.test(haystack) ? "inspect_environmental_sensor" : "restore_climate_device";
  if (domain === "visitor") return /policy/.test(haystack) ? "check_access_policy" : "verify_visitor_identity";
  if (domain === "financial") return "review_collection_drop";
  if (domain === "community") return "respond_to_complaints";
  if (domain === "executive") return "prepare_management_review";
  return "request_operator_decision";
}

function approvalRequired(domain: OperationalRecommendationDomain, actionType: RecommendationActionType) {
  if (domain === "financial") return true;
  if (domain === "security" && !["review_access_event", "check_camera_availability"].includes(actionType)) return true;
  if (["verify_visitor_identity", "check_access_policy", "prepare_management_review"].includes(actionType)) return true;
  return false;
}

function safeToAutomate(domain: OperationalRecommendationDomain) {
  return !["financial", "security", "visitor", "executive"].includes(domain);
}

function mergeEvidence(insight: OperationalInsight, awareness: OperationalAwareness[], signals: NormalizedSignal[]) {
  const found = new Map<string, SignalEvidence>();
  for (const item of insight.evidence) found.set(text(item.id || `${item.type}:${item.timestamp}`), item);
  for (const item of awareness.filter((entry) => insight.relatedAwareness.includes(entry.id)).flatMap((entry) => entry.supporting_evidence)) {
    found.set(text(item.id || `${item.type}:${item.timestamp}`), item);
  }
  for (const item of signals.filter((entry) => insight.relatedSignals.includes(entry.id)).flatMap((entry) => entry.evidence)) {
    found.set(text(item.id || `${item.type}:${item.timestamp}`), item);
  }
  return [...found.values()].slice(0, 8);
}

export function buildOperationalRecommendations(input: RecommendationInput): OperationalRecommendation[] {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const signals = input.signals || [];
  const awareness = input.awareness || [];
  const insights = input.insights || [];
  const unique = new Map<string, OperationalRecommendation>();

  for (const insight of insights) {
    const domain = (insight.domain === "community" ? "community" : insight.domain) as OperationalRecommendationDomain;
    const actionType = actionTypeFor(domain, insight);
    const recommendation: OperationalRecommendation = {
      id: `recommendation:${domain}:${insight.id}`,
      title: `Review ${insight.title}`,
      summary: insight.summary,
      domain,
      severity: insight.severity,
      urgency: urgencyFrom(insight.severity),
      confidence: insight.confidence,
      reason: insight.reason,
      recommendedAction: insight.recommendedAction,
      actionType,
      owner: insight.owner || "Operational owner",
      expectedImpact: insight.impact,
      estimatedBenefit: "Reduces repeat exposure and improves operational clarity.",
      verificationRequired: true,
      approvalRequired: approvalRequired(domain, actionType),
      safeToAutomate: safeToAutomate(domain),
      relatedSignals: [...insight.relatedSignals],
      relatedAwareness: [...insight.relatedAwareness],
      relatedInsights: [insight.id],
      supportingEvidence: mergeEvidence(insight, awareness, signals),
      generatedAt,
      expiresAt: addHours(generatedAt, 12),
      status: "open",
      nextStep: insight.nextStep,
      source: "operational_recommendation_runtime",
    };
    const key = `${recommendation.domain}:${recommendation.actionType}:${recommendation.relatedSignals.sort().join(",")}`;
    if (!unique.has(key)) unique.set(key, recommendation);
  }

  return [...unique.values()];
}
