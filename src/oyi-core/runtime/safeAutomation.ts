import type { NormalizedSignal, SignalSeverity } from "../contracts/operationalSignal";
import type { OperationalRecommendation, RecommendationActionType } from "./operationalRecommendations";
import type { OperationalInsight } from "./operationalReasoning";
import type { OperationalAwareness, OperationalContext } from "./contextAwareness";

export type AutomationDomain =
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

export type AutomationExecutionMode = "suggest_only" | "prepare_workflow" | "request_approval" | "execute_safe";
export type AutomationPlanStatus = "planned" | "awaiting_approval" | "prepared" | "expired" | "cancelled";

export type AutomationPlan = {
  id: string;
  title: string;
  summary: string;
  domain: AutomationDomain;
  sourceRecommendationId: string;
  actionType: RecommendationActionType;
  actionIntent: string;
  targetEntity: { id?: string | null; type?: string | null; name?: string | null };
  targetContext: { estate?: string | null; building?: string | null; room?: string | null; owner?: string | null };
  owner: string;
  severity: SignalSeverity;
  confidence: number;
  approvalRequired: boolean;
  verificationRequired: boolean;
  safeToExecute: boolean;
  executionMode: AutomationExecutionMode;
  preconditions: string[];
  safetyChecks: string[];
  requiredPermissions: string[];
  rollbackPlan: string;
  auditReason: string;
  expectedOutcome: string;
  relatedSignals: string[];
  relatedAwareness: string[];
  relatedInsights: string[];
  relatedRecommendations: string[];
  status: AutomationPlanStatus;
  generatedAt: string;
  expiresAt: string;
  nextStep: string;
};

export type AutomationInput = {
  recommendations: OperationalRecommendation[];
  insights?: OperationalInsight[];
  awareness?: OperationalAwareness[];
  signals?: NormalizedSignal[];
  context?: OperationalContext;
  permissions?: string[];
  generatedAt?: string;
};

function addHours(timestamp: string, hours: number) {
  return new Date(new Date(timestamp).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function executionMode(recommendation: OperationalRecommendation, permissions: string[]): AutomationExecutionMode {
  if (recommendation.approvalRequired) return "request_approval";
  const required = permissionsForAction(recommendation.actionType, recommendation.domain);
  const hasPermissions = required.every((permission) => permissions.includes(permission));
  if (!hasPermissions) return "suggest_only";
  if (["schedule_preventive_inspection", "respond_to_complaints", "prepare_management_review"].includes(recommendation.actionType)) return "prepare_workflow";
  return recommendation.safeToAutomate ? "execute_safe" : "suggest_only";
}

function permissionsForAction(actionType: RecommendationActionType, domain: AutomationDomain) {
  if (domain === "financial") return ["wallets.manage"];
  if (domain === "security") return ["support.assign", "notifications.manage"];
  if (domain === "visitor") return ["visitors.manage"];
  if (domain === "maintenance") return ["support.assign"];
  if (["infrastructure", "environmental", "utility"].includes(domain)) return ["devices.control"];
  if (domain === "community") return ["community.moderate"];
  if (actionType === "prepare_management_review") return ["office.read"];
  return [];
}

function safeToExecute(mode: AutomationExecutionMode, recommendation: OperationalRecommendation) {
  return mode === "execute_safe" && !["financial", "security", "visitor"].includes(recommendation.domain);
}

export function buildAutomationPlans(input: AutomationInput): AutomationPlan[] {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const signals = input.signals || [];
  return input.recommendations.map((recommendation) => {
    const requiredPermissions = permissionsForAction(recommendation.actionType, recommendation.domain);
    const mode = executionMode(recommendation, input.permissions || []);
    const signal = signals.find((item) => recommendation.relatedSignals.includes(item.id));
    return {
      id: `automation:${recommendation.domain}:${recommendation.id}`,
      title: `${recommendation.title} Automation Plan`,
      summary: `${recommendation.summary} This plan prepares the next step without bypassing approval or safety rules.`,
      domain: recommendation.domain,
      sourceRecommendationId: recommendation.id,
      actionType: recommendation.actionType,
      actionIntent:
        mode === "prepare_workflow"
          ? "prepare_non_executing_workflow"
          : mode === "request_approval"
          ? "request_operator_approval"
          : mode === "execute_safe"
          ? "execute_internal_low_risk_step"
          : "suggest_next_action",
      targetEntity: {
        id: signal?.entity.id || null,
        type: signal?.entity.type || recommendation.domain,
        name: signal?.entity.name || recommendation.title,
      },
      targetContext: {
        estate: signal?.estate.id || null,
        building: signal?.building.id || null,
        room: signal?.room.id || null,
        owner: recommendation.owner || null,
      },
      owner: recommendation.owner || "Operational owner",
      severity: recommendation.severity,
      confidence: recommendation.confidence,
      approvalRequired: recommendation.approvalRequired,
      verificationRequired: recommendation.verificationRequired,
      safeToExecute: safeToExecute(mode, recommendation),
      executionMode: mode,
      preconditions: [
        "Recommendation remains active and unexpired.",
        "Supporting evidence is still available for operator review.",
      ],
      safetyChecks: [
        "Do not bypass permissions or role boundaries.",
        "Do not auto-execute irreversible or resident-facing actions.",
      ],
      requiredPermissions,
      rollbackPlan:
        mode === "prepare_workflow"
          ? "Cancel the prepared workflow and return ownership to the originating operational queue."
          : mode === "request_approval"
          ? "Reject the approval request and leave the recommendation in review state."
          : mode === "execute_safe"
          ? "Cancel the internal automation task and reopen the recommendation for operator review."
          : "No automated action is executed; cancel by closing the suggestion.",
      auditReason: `${recommendation.reason} Recommendation ${recommendation.id} produced a ${mode} automation plan.`,
      expectedOutcome:
        mode === "prepare_workflow"
          ? `Prepare a safe workflow for: ${recommendation.recommendedAction}`
          : mode === "request_approval"
          ? `Gather operator approval before proceeding with: ${recommendation.recommendedAction}`
          : mode === "execute_safe"
          ? `Perform a low-risk internal automation step related to: ${recommendation.recommendedAction}`
          : `Provide operator-ready guidance for: ${recommendation.recommendedAction}`,
      relatedSignals: [...recommendation.relatedSignals],
      relatedAwareness: [...recommendation.relatedAwareness],
      relatedInsights: [...recommendation.relatedInsights],
      relatedRecommendations: [recommendation.id],
      status: mode === "request_approval" ? "awaiting_approval" : mode === "prepare_workflow" ? "prepared" : "planned",
      generatedAt,
      expiresAt: addHours(generatedAt, 24),
      nextStep:
        mode === "prepare_workflow"
          ? "Prepare the workflow and route it to the correct operator queue."
          : mode === "request_approval"
          ? "Request operator approval before any further action."
          : mode === "execute_safe"
          ? "Run the reversible internal step and retain the audit trail."
          : "Present the plan as guidance only.",
    };
  });
}
