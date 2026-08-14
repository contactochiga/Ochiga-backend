import type { OyiSurface } from "../../services/oyiUnifiedIntelligenceService";
import { currentTurnAuthorityForTest, inheritedTargetEligibilityForTest, resolveCurrentTurnAuthorityDecision } from "../context/currentTurnAuthority";
import { roomPhraseFromMessage } from "../runtime/conversationTargetResolver";
import { isExplicitBroadHomeReadIntent } from "../interpretation/conversationIntentRouting";
import { safeDateLabel } from "../presentation/timeFreshness";
import {
  buildDeviceAvailabilityInventoryAnswer,
  buildMaintenanceRequestsAnswer,
  buildRecentChangesAnswer,
  buildVisitorAccessAnswer,
  buildWalletHistoryAnswer,
  tableBlockForContract,
} from "../presentation/conversationAnswerPresentation";
import {
  buildDeviceHealthAnswer,
} from "../domains/devices/deviceConversationAnswers";
import { dedupeIntelligenceFacts as dedupeFacts } from "../domains/devices/deviceEvidence";
import { buildReportAnswer } from "../domains/reports/reportConversationAnswers";
import { shapeObjectConversation } from "../presentation/objectFallbackPresentation";
import {
  buildClarificationContinuationResponse,
  matchPendingClarificationCandidate,
} from "../workflows/conversationClarification";
import {
  factFromObject,
  interpretSemanticOperation,
  presentationFactPredicates,
  presentationPolicyForContract,
  resolveIntentContract,
  resolvedConversationTurnFromContract,
} from "../runtime/canonicalTurnResolution";
import type {
  CanonicalConversationRequest,
  IntelligenceFact,
  OperationalObject,
  PendingClarification,
} from "../contracts/canonicalConversation";

export { isConversationContainerObject } from "../context/conversationTargetCandidates";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function severityFor(value: unknown) {
  const raw = text(value).toLowerCase();
  if (raw === "critical") return "critical";
  if (raw === "warning") return "warning";
  if (raw === "attention") return "attention";
  if (raw === "info") return "info";
  return "normal";
}

function truthStateFromCompatibility(response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const status = text(execution.status).toLowerCase();
  if (status === "pending_confirmation") return "pending_confirmation" as const;
  if (status === "permission_denied" || status === "denied") return "permission_restricted" as const;
  if (status === "unsupported" || status === "validation_required") return "unsupported" as const;
  if (status === "failed") return "observed" as const;
  if (status === "executed" || status === "processed") return "confirmed" as const;
  if (response.awareness && severityFor(recordOf(response.awareness).severity) !== "normal") return "observed" as const;
  if (Array.isArray(response.sources) && response.sources.length) return "observed" as const;
  return "inferred" as const;
}

export function canonicalTruthStateForTest(input: { status?: string | null; hasSources?: boolean; hasAwareness?: boolean; severity?: string | null }) {
  return truthStateFromCompatibility({
    execution: { status: input.status || null },
    sources: input.hasSources ? [{ id: "source:1" }] : [],
    awareness: input.hasAwareness ? { severity: input.severity || "info" } : null,
  });
}

export function canonicalInheritedTargetEligibilityForTest(input: { message: string; object?: Record<string, unknown> | null; request?: Partial<CanonicalConversationRequest> }) {
  return inheritedTargetEligibilityForTest(input, roomPhraseFromMessage);
}

export function canonicalCurrentTurnAuthorityForTest(input: { message: string; object?: Record<string, unknown> | null; request?: Partial<CanonicalConversationRequest> }) {
  return currentTurnAuthorityForTest(input, roomPhraseFromMessage);
}

export function canonicalIntelligenceContractForTest(input: { message: string; object?: OperationalObject | null; request?: Partial<CanonicalConversationRequest> }) {
  const request = {
    message: input.message,
    surface: "consumer",
    ...(input.request || {}),
  } as CanonicalConversationRequest;
  const authority = resolveCurrentTurnAuthorityDecision(request, input.object as any, {
    roomPhrase: roomPhraseFromMessage(input.message),
    broadReadOnlyDeviceIntent: isExplicitBroadHomeReadIntent(input.message, text(input.request?.scope_mode_hint)),
    semanticOperation: interpretSemanticOperation(input.message),
  });
  const object = authority.mayUseInheritedExactTarget || !["device", "device_channel"].includes(text(input.object?.object_type))
    ? input.object || null
    : authority.scope === "home_scope" && input.request?.home_id
      ? {
        object_type: "home",
        canonical_id: input.request.home_id,
        label: "Home",
        estate_id: input.request.estate_id || null,
        building_id: null,
        home_id: input.request.home_id,
        room_id: null,
        parent_id: null,
        source_module: "home",
        capabilities: ["conversation"],
        current_state: null,
        health: null,
        permissions: ["read"],
        relationships: {},
        evidence_references: [],
        metadata: {},
        freshness: null,
      } as OperationalObject
      : null;
  return resolveIntentContract(request, object, {
    objectType: object?.object_type || null,
    objectId: object?.canonical_id || null,
    objectName: object?.label || null,
  });
}

export function canonicalDeviceHealthAnswerForTest(input: { object: OperationalObject; facts?: Record<string, unknown>; message?: string }) {
  return buildDeviceHealthAnswer(input.object, input.facts || {}, { factFromObject });
}

export function canonicalRecentChangesAnswerForTest(input: { facts: IntelligenceFact[]; message?: string }) {
  const contract = canonicalIntelligenceContractForTest({ message: input.message || "What changed recently?" });
  return buildRecentChangesAnswer(dedupeFacts(input.facts), contract, presentationFactPredicates);
}

export function canonicalConversationTableBlockForTest(input: { facts: IntelligenceFact[]; message?: string; object?: OperationalObject | null; request?: Partial<CanonicalConversationRequest> }) {
  const contract = canonicalIntelligenceContractForTest({ message: input.message || "What changed recently?", object: input.object || null, request: input.request });
  return tableBlockForContract(contract, dedupeFacts(input.facts), presentationFactPredicates);
}

export function canonicalResolvedTurnForTest(input: { message: string; object?: OperationalObject | null; surface?: OyiSurface; request?: Partial<CanonicalConversationRequest> }) {
  const request = {
    message: input.message,
    surface: input.surface || "consumer",
    ...(input.request || {}),
  } as CanonicalConversationRequest;
  const contract = canonicalIntelligenceContractForTest({ message: input.message, object: input.object || null, request });
  const object = contract.target.object_type === input.object?.object_type && contract.target.canonical_id === input.object?.canonical_id ? input.object || null : null;
  return {
    contract,
    resolved_turn: resolvedConversationTurnFromContract(request, contract, object),
    presentation_policy: presentationPolicyForContract(contract),
  };
}

export function canonicalTimeLabelForTest(value: unknown, mode: "time" | "date_time" | "relative" = "date_time") {
  return safeDateLabel(value, "Time unavailable", mode);
}

export function canonicalClarificationContinuationForTest(input: { message: string; pending: PendingClarification }) {
  const selected = matchPendingClarificationCandidate(input.pending, input.message);
  if (!selected) return null;
  return buildClarificationContinuationResponse({ message: input.message, surface: "consumer", thread_id: input.pending.thread_id } as CanonicalConversationRequest, input.pending, selected);
}

export function canonicalDeviceAvailabilityAnswerForTest(input: { facts: IntelligenceFact[]; message?: string }) {
  return buildDeviceAvailabilityInventoryAnswer(dedupeFacts(input.facts));
}

export function canonicalReportAnswerForTest(input: { facts: IntelligenceFact[]; object?: OperationalObject | null; message?: string }) {
  const contract = canonicalIntelligenceContractForTest({ message: input.message || "Generate today's home report", object: input.object || null });
  return buildReportAnswer(dedupeFacts(input.facts), input.object || null, contract, input.message || "Generate today's home report");
}

export function canonicalWalletHistoryAnswerForTest(input: { facts: IntelligenceFact[] }) {
  return buildWalletHistoryAnswer(dedupeFacts(input.facts));
}

export function canonicalMaintenanceRequestsAnswerForTest(input: { facts: IntelligenceFact[] }) {
  return buildMaintenanceRequestsAnswer(dedupeFacts(input.facts));
}

export function canonicalVisitorAccessAnswerForTest(input: { facts: IntelligenceFact[] }) {
  return buildVisitorAccessAnswer(dedupeFacts(input.facts));
}

export function canonicalObjectConversationForTest(input: { message: string; object: OperationalObject; response?: Record<string, unknown>; request?: Partial<CanonicalConversationRequest> }) {
  const request = {
    message: input.message,
    surface: "consumer" as const,
    ...input.request,
  } as CanonicalConversationRequest;
  return shapeObjectConversation(request, input.response || { message: "There are 27 devices connected.", execution: { status: "read_only" } }, input.object);
}
