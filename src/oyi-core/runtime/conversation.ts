import type { NormalizedSignal, SignalEvidence } from "../contracts/operationalSignal";
import type { OperationalRecommendation } from "./operationalRecommendations";
import type { OperationalInsight } from "./operationalReasoning";
import type { AutomationPlan } from "./safeAutomation";
import type { OperationalAwareness, OperationalContext } from "./contextAwareness";

export type ConversationIntent =
  | "information"
  | "explanation"
  | "status"
  | "operational_summary"
  | "infrastructure"
  | "security"
  | "maintenance"
  | "utilities"
  | "community"
  | "visitor"
  | "financial"
  | "governance"
  | "executive"
  | "recommendation"
  | "automation"
  | "navigation"
  | "registry_lookup"
  | "comparison"
  | "trend"
  | "forecast_request"
  | "health_check"
  | "verification"
  | "evidence";

export type ConversationRequest = {
  id: string;
  query: string;
  estateId?: string | null;
  buildingId?: string | null;
  unitId?: string | null;
  actor?: { id?: string | null; name?: string | null; role?: string | null; permissions?: string[] };
  context?: OperationalContext;
  requestedDomain?: string | null;
  generatedAt?: string;
};

export type ConversationResponse = {
  id: string;
  intent: ConversationIntent;
  confidence: number;
  entities: string[];
  filters: Record<string, string[]>;
  requestedDomain: string;
  summary: string;
  answer: string;
  supportingEvidence: SignalEvidence[];
  relatedSignals: string[];
  relatedAwareness: string[];
  relatedInsights: string[];
  relatedRecommendations: string[];
  relatedAutomationPlans: string[];
  suggestedFollowUps: string[];
  availableActions: Array<{ title: string; type: "navigation" | "recommendation" | "automation" | "verification"; target?: string }>;
  permissionsRequired: string[];
  approvalRequired: boolean;
  safeActions: string[];
  unsafeActions: string[];
  generatedAt: string;
  source: "conversation_runtime";
};

export type ConversationInput = {
  request: ConversationRequest;
  signals?: NormalizedSignal[];
  awareness?: OperationalAwareness[];
  insights?: OperationalInsight[];
  recommendations?: OperationalRecommendation[];
  automationPlans?: AutomationPlan[];
  context?: OperationalContext;
  permissions?: string[];
};

function text(value: unknown, fallback = "") {
  const next = String(value ?? "").trim();
  return next || fallback;
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function parseIntent(query: string): { intent: ConversationIntent; domain: string; confidence: number } {
  const q = lower(query);
  if (/automation|approval|workflow|safely/.test(q)) return { intent: "automation", domain: "automation", confidence: 0.9 };
  if (/recommendation|recommend|what should/.test(q)) return { intent: "recommendation", domain: "recommendation", confidence: 0.9 };
  if (/why|explain/.test(q)) return { intent: "explanation", domain: "operational", confidence: 0.82 };
  if (/trend|since yesterday|overnight/.test(q)) return { intent: "trend", domain: "operational", confidence: 0.8 };
  if (/health|healthy|posture/.test(q)) return { intent: "health_check", domain: "operational", confidence: 0.84 };
  if (/verify|verification|evidence/.test(q)) return { intent: /evidence/.test(q) ? "evidence" : "verification", domain: "operational", confidence: 0.83 };
  if (/security|gate|camera|access/.test(q)) return { intent: "security", domain: "security", confidence: 0.84 };
  if (/visitor/.test(q)) return { intent: "visitor", domain: "visitor", confidence: 0.84 };
  if (/maintenance|repair/.test(q)) return { intent: "maintenance", domain: "maintenance", confidence: 0.84 };
  if (/utility|water|energy|power/.test(q)) return { intent: "utilities", domain: "utility", confidence: 0.84 };
  if (/financial|wallet|collection|payment/.test(q)) return { intent: "financial", domain: "financial", confidence: 0.84 };
  if (/community|complaint/.test(q)) return { intent: "community", domain: "community", confidence: 0.84 };
  if (/infrastructure|device|offline/.test(q)) return { intent: "infrastructure", domain: "infrastructure", confidence: 0.84 };
  if (/executive|briefing|portfolio/.test(q)) return { intent: "executive", domain: "executive", confidence: 0.82 };
  if (/summary|summarize|attention/.test(q)) return { intent: "operational_summary", domain: "operational", confidence: 0.86 };
  return { intent: "information", domain: "operational", confidence: 0.62 };
}

function queryEntities(query: string) {
  return [...new Set(text(query).split(/[^A-Za-z0-9_-]+/).map((part) => part.trim()).filter((part) => part.length > 2))].slice(0, 8);
}

function domainMatch(domain: string, value: string) {
  if (domain === "operational" || domain === "recommendation" || domain === "automation") return true;
  return lower(value).includes(lower(domain));
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
  for (const plan of automationPlans.slice(0, 1)) {
    found.set(`automation:${plan.id}`, {
      id: `automation:${plan.id}`,
      type: "automation_plan",
      source: "conversation_runtime",
      summary: plan.summary,
      timestamp: plan.generatedAt,
      metadata: { executionMode: plan.executionMode, requiredPermissions: plan.requiredPermissions },
    });
  }
  return [...found.values()].slice(0, 8);
}

export function buildConversationResponse(input: ConversationInput): ConversationResponse {
  const generatedAt = input.request.generatedAt || new Date().toISOString();
  const { intent, domain, confidence } = parseIntent(input.request.query);
  const signals = (input.signals || []).filter((item) => domainMatch(domain, `${item.domain} ${item.type} ${item.entity.type}`));
  const awareness = (input.awareness || []).filter((item) => domainMatch(domain, item.kind));
  const insights = (input.insights || []).filter((item) => domainMatch(domain, item.domain));
  const recommendations = (input.recommendations || []).filter((item) => domainMatch(domain, item.domain));
  const automationPlans = (input.automationPlans || []).filter((item) => domainMatch(domain, item.domain));
  const evidence = evidenceFrom(signals, awareness, insights, recommendations, automationPlans);
  const known = [insights[0]?.summary, recommendations[0]?.summary, awareness[0]?.summary].filter(Boolean);
  const likely = insights[0]?.reason || recommendations[0]?.reason || "";
  const unknown = !signals.length && !awareness.length && !insights.length && !recommendations.length && !automationPlans.length;
  const permissionsRequired = [...new Set(automationPlans.flatMap((item) => item.requiredPermissions))];
  const approvalRequired = automationPlans.some((item) => item.approvalRequired) || recommendations.some((item) => item.approvalRequired);
  const safeActions = automationPlans.filter((item) => item.safeToExecute).map((item) => item.title);
  const unsafeActions = automationPlans.filter((item) => !item.safeToExecute).map((item) => item.title);

  return {
    id: `conversation-response:${input.request.id}`,
    intent,
    confidence,
    entities: queryEntities(input.request.query),
    filters: { domain: [domain], intent: [intent] },
    requestedDomain: input.request.requestedDomain || domain,
    summary: unknown
      ? "Oyi Core does not currently have enough runtime evidence to answer this with confidence."
      : `Oyi Core found ${insights.length || awareness.length || recommendations.length || signals.length} relevant operational item(s) for this request.`,
    answer: [
      known.length ? `Known: ${known.join(" ")}` : "Known: No direct matching operational artifact was found.",
      likely ? `Likely: ${likely}` : "Likely: No strong causal pattern was available from current runtime artifacts.",
      unknown ? "Unknown: Additional runtime evidence or verification is required." : "Requires verification: Review supporting evidence before closing the loop.",
    ].join(" "),
    supportingEvidence: evidence,
    relatedSignals: signals.map((item) => item.id),
    relatedAwareness: awareness.map((item) => item.id),
    relatedInsights: insights.map((item) => item.id),
    relatedRecommendations: recommendations.map((item) => item.id),
    relatedAutomationPlans: automationPlans.map((item) => item.id),
    suggestedFollowUps:
      intent === "automation"
        ? ["Which automation plans are waiting for approval?", "Which plans are safe only to prepare, not execute?"]
        : ["What requires attention?", "What changed since yesterday?"],
    availableActions: [
      ...recommendations.slice(0, 2).map((item) => ({ title: item.title, type: "recommendation" as const })),
      ...automationPlans.slice(0, 2).map((item) => ({ title: item.title, type: "automation" as const })),
    ].slice(0, 5),
    permissionsRequired,
    approvalRequired,
    safeActions,
    unsafeActions,
    generatedAt,
    source: "conversation_runtime",
  };
}
