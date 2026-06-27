import type { ConversationResponse } from "./conversation";
import type { NormalizedSignal, SignalEvidence } from "../contracts/operationalSignal";
import type { OperationalRecommendation } from "./operationalRecommendations";
import type { OperationalInsight } from "./operationalReasoning";
import type { AutomationPlan } from "./safeAutomation";
import type { OperationalAwareness } from "./contextAwareness";

export type ExecutivePeriod =
  | "morning"
  | "daily"
  | "weekly"
  | "monthly"
  | "incident"
  | "infrastructure"
  | "maintenance"
  | "financial"
  | "security"
  | "community"
  | "risk"
  | "portfolio";

export type ExecutiveBriefing = {
  id: string;
  period: ExecutivePeriod;
  generatedAt: string;
  overallOperationalHealth: string;
  infrastructurePosture: string;
  securityPosture: string;
  maintenancePosture: string;
  financialPosture: string;
  environmentalPosture: string;
  communityPosture: string;
  visitorPosture: string;
  operationalRisks: string[];
  criticalItems: string[];
  recommendations: string[];
  automationReadiness: string;
  emergingTrends: string[];
  unresolvedIssues: string[];
  executiveSummary: string;
  supportingEvidence: SignalEvidence[];
  confidence: number;
  portfolioImpact: string;
  nextActions: string[];
};

export type ExecutiveInput = {
  period?: ExecutivePeriod;
  signals?: NormalizedSignal[];
  awareness?: OperationalAwareness[];
  insights?: OperationalInsight[];
  recommendations?: OperationalRecommendation[];
  automationPlans?: AutomationPlan[];
  conversationSummaries?: ConversationResponse[];
  generatedAt?: string;
};

function text(value: unknown, fallback = "") {
  const next = String(value ?? "").trim();
  return next || fallback;
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function confidence(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0.65;
  return Math.max(0, Math.min(1, valid.reduce((sum, value) => sum + value, 0) / valid.length));
}

function severityRank(value: string) {
  return { critical: 3, warning: 2, attention: 1, info: 0, urgent: 3, act: 2, review: 1, monitor: 0 }[lower(value)] ?? 0;
}

function posture(domain: string, insights: OperationalInsight[], awareness: OperationalAwareness[]) {
  const matchingInsights = insights.filter((item) => lower(item.domain).includes(lower(domain)));
  const matchingAwareness = awareness.filter((item) => lower(item.kind).includes(lower(domain)));
  const topSeverity = Math.max(
    0,
    ...matchingInsights.map((item) => severityRank(item.severity)),
    ...matchingAwareness.map((item) => severityRank(item.urgency))
  );
  if (!matchingInsights.length && !matchingAwareness.length) return "Stable";
  if (topSeverity >= 3) return "Critical attention required";
  if (topSeverity === 2) return "Watch closely";
  return "Stable with review items";
}

function evidenceFrom(
  signals: NormalizedSignal[],
  awareness: OperationalAwareness[],
  insights: OperationalInsight[],
  recommendations: OperationalRecommendation[],
  automationPlans: AutomationPlan[]
) {
  const found = new Map<string, SignalEvidence>();
  for (const signal of signals.slice(0, 3)) {
    for (const item of signal.evidence) found.set(text(item.id || `${item.type}:${item.timestamp}`), item);
  }
  for (const item of awareness.slice(0, 2).flatMap((entry) => entry.supporting_evidence)) {
    found.set(text(item.id || `${item.type}:${item.timestamp}`), item);
  }
  for (const item of insights.slice(0, 2).flatMap((entry) => entry.evidence)) {
    found.set(text(item.id || `${item.type}:${item.timestamp}`), item);
  }
  for (const item of recommendations.slice(0, 2).flatMap((entry) => entry.supportingEvidence)) {
    found.set(text(item.id || `${item.type}:${item.timestamp}`), item);
  }
  for (const plan of automationPlans.slice(0, 2)) {
    found.set(`automation:${plan.id}`, {
      id: `automation:${plan.id}`,
      type: "automation_plan",
      source: "executive_runtime",
      summary: plan.summary,
      timestamp: plan.generatedAt,
      metadata: { executionMode: plan.executionMode, approvalRequired: plan.approvalRequired },
    });
  }
  return [...found.values()].slice(0, 10);
}

export function buildExecutiveBriefing(input: ExecutiveInput): ExecutiveBriefing {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const period = input.period || "daily";
  const signals = input.signals || [];
  const awareness = input.awareness || [];
  const insights = input.insights || [];
  const recommendations = input.recommendations || [];
  const automationPlans = input.automationPlans || [];
  const conversationSummaries = input.conversationSummaries || [];

  const criticalItems = insights.filter((item) => item.severity === "critical").map((item) => item.summary).slice(0, 5);
  const operationalRisks = insights.filter((item) => item.severity === "critical" || item.severity === "warning").map((item) => `${item.domain}: ${item.reason}`).slice(0, 6);
  const unresolvedIssues = recommendations.filter((item) => item.status === "open" || item.status === "monitoring").map((item) => item.summary).slice(0, 6);
  const emergingTrends = conversationSummaries.filter((item) => item.intent === "trend" || item.intent === "forecast_request" || item.intent === "comparison").map((item) => item.summary).slice(0, 4);
  const execRecommendations = recommendations.map((item) => item.recommendedAction).slice(0, 5);
  const awaitingApproval = automationPlans.filter((item) => item.status === "awaiting_approval").length;
  const prepared = automationPlans.filter((item) => item.status === "prepared").length;
  const overallOperationalHealth =
    criticalItems.length > 0
      ? "Operational posture is mixed with critical risks requiring executive visibility."
      : operationalRisks.length > 0
      ? "Operational posture is stable with focused risks under active review."
      : "Operational posture is stable.";

  return {
    id: `executive-briefing:${period}:${new Date(generatedAt).getTime()}`,
    period,
    generatedAt,
    overallOperationalHealth,
    infrastructurePosture: posture("infrastructure", insights, awareness),
    securityPosture: posture("security", insights, awareness),
    maintenancePosture: posture("maintenance", insights, awareness),
    financialPosture: posture("financial", insights, awareness),
    environmentalPosture: posture("environmental", insights, awareness),
    communityPosture: posture("community", insights, awareness),
    visitorPosture: posture("visitor", insights, awareness),
    operationalRisks,
    criticalItems,
    recommendations: execRecommendations,
    automationReadiness: prepared || awaitingApproval ? `${prepared} plan(s) prepared and ${awaitingApproval} awaiting approval.` : "No prepared or approval-blocked automation plans are currently visible.",
    emergingTrends,
    unresolvedIssues,
    executiveSummary: [
      overallOperationalHealth,
      criticalItems.length ? `${criticalItems.length} critical item(s) require executive attention.` : "No critical items are currently active.",
      awaitingApproval ? `${awaitingApproval} automation plan(s) await approval.` : "No automation approvals are currently blocking progress.",
      unresolvedIssues.length ? `${unresolvedIssues.length} unresolved issue(s) remain in active queues.` : "No major unresolved issue backlog is visible from current runtime evidence.",
    ].join(" "),
    supportingEvidence: evidenceFrom(signals, awareness, insights, recommendations, automationPlans),
    confidence: confidence([
      ...insights.map((item) => item.confidence),
      ...recommendations.map((item) => item.confidence),
      ...conversationSummaries.map((item) => item.confidence),
    ]),
    portfolioImpact:
      criticalItems.length > 0
        ? "Executive follow-up is recommended because current risks may affect estate continuity, trust, or portfolio performance."
        : operationalRisks.length > 0
        ? "Portfolio impact appears contained, but current risks should remain under executive visibility."
        : "No material portfolio-level disruption is indicated by current runtime evidence.",
    nextActions: [...execRecommendations.slice(0, 3), ...(criticalItems.length ? ["Review critical items in the next executive operating window."] : [])].slice(0, 5),
  };
}
