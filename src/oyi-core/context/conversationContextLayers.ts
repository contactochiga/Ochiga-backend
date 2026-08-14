import type {
  CanonicalConversationRequest,
  OperationalObject,
} from "../contracts/canonicalConversation";
import type {
  CanonicalIntent,
  IntelligenceRequestContract,
  OperationClass,
  ScopeMode,
} from "../interpretation/conversationIntentRouting";

export type TurnInterpretation = {
  rawMessage: string;
  intent: CanonicalIntent;
  operationClass: OperationClass;
  requestedScope: ScopeMode;
  explicitObjectReferences: Array<{
    objectType: string | null;
    objectId: string | null;
    objectName: string | null;
    parentId: string | null;
    channelCode: string | null;
    sourceText: string;
    confidence: number;
  }>;
  pronounReference: {
    used: boolean;
    phrase: string | null;
    resolvedFrom: "thread_memory" | "page_launch" | null;
  };
  temporalScope: IntelligenceRequestContract["temporal_scope"];
  desiredPresentation: "sentence" | "status" | "list" | "table" | "detail" | "report" | "handoff";
  requiresLiveEvidence: boolean;
  requiresConfirmation: boolean;
  interpretationSource: string;
  confidence: number;
};

export type ConversationContextLayers = {
  pageLaunchContext: Record<string, unknown> | null;
  threadMemoryContext: Record<string, unknown> | null;
  currentTurnInterpretation: TurnInterpretation;
  liveEvidenceContext: Record<string, unknown> | null;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

// Monday-anchored week start, matching how residents actually talk about
// "this week"/"last week" (not a rolling 7-day window).
function startOfWeek(date: Date) {
  const next = startOfDay(date);
  const day = next.getDay();
  const diffFromMonday = day === 0 ? 6 : day - 1;
  next.setDate(next.getDate() - diffFromMonday);
  return next;
}

export function temporalScopeFor(message: string): IntelligenceRequestContract["temporal_scope"] {
  const now = new Date();
  // Week/month-relative phrasing is checked before the generic "last"
  // catch-all below — "last week"/"last month" both contain the word
  // "last" and would otherwise fall through to a 6-hour "recent" window,
  // silently dropping the requested period bound.
  if (/\b(this|current)\s+week\b/i.test(message)) {
    const start = startOfWeek(now);
    return { mode: "this_week", from: start.toISOString(), to: now.toISOString() };
  }
  if (/\b(last|previous)\s+week\b/i.test(message)) {
    const thisWeekStart = startOfWeek(now);
    const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { mode: "last_week", from: lastWeekStart.toISOString(), to: thisWeekStart.toISOString() };
  }
  if (/\b(this|current)\s+month\b/i.test(message)) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { mode: "custom", from: start.toISOString(), to: now.toISOString() };
  }
  if (/\b(last|previous)\s+month\b/i.test(message)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    return { mode: "last_month", from: start.toISOString(), to: end.toISOString() };
  }
  if (/\byesterday\b/i.test(message)) {
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    return { mode: "yesterday", from: start.toISOString(), to: end.toISOString() };
  }
  if (/\btoday\b/i.test(message)) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { mode: "today", from: start.toISOString(), to: now.toISOString() };
  }
  if (/\brecent|changed|activity|history|last\b/i.test(message)) {
    return { mode: "recent", from: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(), to: now.toISOString() };
  }
  if (/\bforecast|predict|trend\b/i.test(message)) return { mode: "forecast", from: null, to: null };
  return { mode: "current", from: null, to: now.toISOString() };
}

export function desiredPresentationFor(intent: CanonicalIntent, scopeMode: ScopeMode): TurnInterpretation["desiredPresentation"] {
  if (intent === "report" || intent === "home_operational_summary") return "report";
  if (intent === "device_availability_inventory" || intent === "activity_history" || intent === "failure_history" || intent === "recent_changes") return "list";
  if (intent === "diagnosis" || intent === "investigation" || intent === "relationships" || intent === "evidence") return "detail";
  if (intent === "current_state" || intent === "health_check") return "status";
  if (scopeMode === "explicit_broad_scope" || scopeMode === "home_scope" || scopeMode === "building_scope") return "report";
  return "sentence";
}

export function turnInterpretationFromContract(
  input: CanonicalConversationRequest,
  contract: IntelligenceRequestContract,
  targetResolution: Record<string, unknown>,
  source: string,
): TurnInterpretation {
  const message = text(input.message);
  const pronoun = message.match(/\b(it|this|that|this channel|that device|same device|same channel)\b/i);
  const explicitRefs: TurnInterpretation["explicitObjectReferences"] = [];
  if (contract.target.canonical_id || contract.target.label) {
    explicitRefs.push({
      objectType: contract.target.object_type,
      objectId: contract.target.canonical_id,
      objectName: contract.target.label,
      parentId: contract.target.parent_id,
      channelCode: contract.target.channel_code,
      sourceText: text(contract.target.label || contract.target.canonical_id || "current target"),
      confidence: Number(targetResolution.confidence) || contract.confidence || 0.72,
    });
  }
  return {
    rawMessage: message,
    intent: contract.intent,
    operationClass: contract.operation_class,
    requestedScope: contract.scope_mode,
    explicitObjectReferences: explicitRefs,
    pronounReference: {
      used: Boolean(pronoun),
      phrase: pronoun ? pronoun[0] : null,
      resolvedFrom: pronoun ? (source === "thread_state" ? "thread_memory" : "page_launch") : null,
    },
    temporalScope: contract.temporal_scope,
    desiredPresentation: desiredPresentationFor(contract.intent, contract.scope_mode),
    requiresLiveEvidence: contract.evidence_requirements.current_state || contract.evidence_requirements.provider_state,
    requiresConfirmation: contract.mutation.requested || contract.mutation.confirmed,
    interpretationSource: "canonical_backend",
    confidence: contract.confidence || Number(targetResolution.confidence) || 0.72,
  };
}

