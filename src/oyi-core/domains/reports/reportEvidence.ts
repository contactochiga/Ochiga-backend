import type {
  CanonicalConversationRequest,
  IntelligenceFact,
  OperationalObject,
} from "../../contracts/canonicalConversation";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";

export type ReportEvidenceLoaders = {
  loadRecentChangeFacts: (
    input: CanonicalConversationRequest,
    oisContext: any,
    contract: IntelligenceRequestContract,
    object: OperationalObject | null,
  ) => Promise<IntelligenceFact[]>;
  dedupeFacts: (facts: IntelligenceFact[]) => IntelligenceFact[];
};

function text(value: unknown) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function isBroadReportRequest(message: string, currentTurnDomain?: string | null) {
  const lower = text(message).toLowerCase();
  if (/\breport\b[\s\S]{0,24}\b(problem|issue|fault|repair|broken|not working)\b/i.test(lower)) return false;
  if (!/\b(report|analytics?|trend|compare|comparison|summary|performance)\b/i.test(lower)) return false;
  if (/\b(compare|comparison)\b[\s\S]{0,30}\b(it|that|same)\b|\b(it|that|same)\b[\s\S]{0,30}\b(compare|comparison)\b/i.test(lower)) return false;
  if (/\b(this|that|it|same|selected|current)\b[\s\S]{0,24}\b(device|meter|request|visitor|incident|scene|automation|thread|post)\b/i.test(lower)) return false;
  if (/\bhow has this\b|\bthis meter\b|\bthis device\b|\bselected\b/i.test(lower)) return false;
  return ["reports", "home", "utilities", "wallet", "maintenance", "visitors", "security", "services", "community", "devices"].includes(text(currentTurnDomain))
    || /\b(home|house|building|facility|estate|portfolio|operations?|utilities?|electricity|power|maintenance|visitors?|security|services?|devices?)\b/i.test(lower);
}

export function reportGenerationRequested(message: string) {
  return /\b(generate|create|produce|export|save)\b[\s\S]{0,30}\b(report|monthly report|operations report)\b/i.test(text(message));
}

export async function loadReportEvidence(
  input: CanonicalConversationRequest,
  oisContext: any,
  contract: IntelligenceRequestContract,
  object: OperationalObject | null,
  baseFacts: IntelligenceFact[],
  loaders: ReportEvidenceLoaders,
) {
  const recentFacts = await loaders.loadRecentChangeFacts(input, oisContext, contract, object);
  return loaders.dedupeFacts([...baseFacts, ...recentFacts]);
}

export function reportEvidenceProfile(facts: IntelligenceFact[], contract: IntelligenceRequestContract) {
  const unresolved = facts.filter((fact) => /failed|unavailable|warning|critical|timeout|denied/i.test(`${fact.statement} ${JSON.stringify(fact.value)}`));
  const domains = new Set(facts.map((fact) => text(recordOf(fact.value).domain || fact.object?.object_type || fact.fact_type)).filter(Boolean));
  return {
    scope_mode: contract.scope_mode,
    temporal_scope: contract.temporal_scope,
    evidence_count: facts.length,
    unresolved_count: unresolved.length,
    domains: Array.from(domains).slice(0, 8),
    generation_requested: false,
  };
}
