import type { CapabilityContext, CapabilityModule, CapabilityPresentationPolicy, CapabilityRolloutStatus, EvidenceRequirement, ScopeRequirement } from "../contracts/capability";
import type { DomainResult } from "../contracts/domainResult";
import type { OyiEvidence } from "../contracts/evidence";
import { evidenceEnvelope } from "../evidence/EvidenceEnvelope";
import type { IntelligenceFact } from "../contracts/canonicalConversation";
import type { OyiDomain } from "../runtime/languageUnderstanding";
import type { PresentationPolicy } from "../contracts/presentation";
import { resolveIntentContract, factAppliesToContract, isFailureFact, presentationFactPredicates } from "../runtime/canonicalTurnResolution";
import { loadHomeDeviceInventoryFacts, loadRecentDeviceChangeFacts, dedupeIntelligenceFacts } from "../domains/devices/deviceEvidence";
import { buildDeviceAvailabilityInventoryAnswer, buildRecentChangesAnswer, buildWalletHistoryAnswer, tableBlockForContract } from "../presentation/conversationAnswerPresentation";
import { buildDeviceFailureHistoryAnswer, buildDeviceDiagnosisAnswer, buildDeviceRelationshipsAnswer } from "../domains/devices/deviceConversationAnswers";
import { loadWalletTransactionFacts } from "../domains/wallet/walletEvidence";
import { loadUtilitySpendingFacts } from "../domains/utilities/utilityEvidence";
import { buildUtilitySpendingAnswer } from "../domains/utilities/utilityConversationAnswers";
import { loadMaintenanceRequestFacts } from "../domains/maintenance/maintenanceEvidence";
import { loadVisitorAccessFacts } from "../domains/visitors/visitorEvidence";
import { buildMaintenanceRequestsAnswer, buildVisitorAccessAnswer } from "../presentation/conversationAnswerPresentation";
import type { SemanticFrame } from "../contracts/semanticFrame";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeFreshness(value: unknown): OyiEvidence["freshness"] {
  const raw = text(value).toLowerCase();
  if (raw === "fresh" || raw === "stale" || raw === "expired" || raw === "unknown" || raw === "unobservable" || raw === "provider_disconnected") return raw;
  if (/^\d{4}-/.test(raw)) return "fresh";
  return "unknown";
}

function privacyForFact(fact: IntelligenceFact): OyiEvidence["privacy_class"] {
  const raw = text((fact as any).privacy_class).toLowerCase();
  if (/financial|wallet|transaction/.test(`${raw} ${fact.domain} ${fact.fact_type}`)) return "financial_sensitive";
  if (/security|credential|access/.test(`${raw} ${fact.domain} ${fact.fact_type}`)) return "security_sensitive";
  if (/resident|home|household|device/.test(raw)) return "household_private";
  return "household_private";
}

function evidenceFromFact(fact: IntelligenceFact): OyiEvidence {
  return evidenceEnvelope({
    evidence_id: `capability:${fact.fact_id}`,
    domain: fact.domain as OyiDomain,
    type: fact.fact_type,
    object_type: fact.object?.object_type || null,
    object_id: fact.object?.canonical_id || null,
    object_ref: {
      object_type: fact.object?.object_type || null,
      object_id: fact.object?.canonical_id || null,
      label: fact.object?.label || null,
    },
    source: "domain_adapter",
    source_type: fact.source_type as any,
    source_id: fact.source_id || fact.fact_id,
    observed_at: fact.observed_at || fact.occurred_at || null,
    freshness: normalizeFreshness(fact.freshness),
    truth_class: fact.truth_state === "permission_restricted" ? "permission_restricted" : fact.truth_state === "unavailable" ? "unavailable" : "source_record",
    privacy_class: privacyForFact(fact),
    permissions: fact.permissions || [],
    authorised_scope: {
      estate_id: fact.scope?.estate_id || null,
      building_id: (fact.scope as any)?.building_id || null,
      home_id: fact.scope?.home_id || null,
      room_id: fact.scope?.room_id || null,
    },
    confidence: Number(fact.confidence || 0.75),
    payload: { fact },
  });
}

function factsFromEvidence(evidence: OyiEvidence[]): IntelligenceFact[] {
  return evidence.map((item) => recordOf(item.payload).fact).filter((item): item is IntelligenceFact => Boolean(item && typeof item === "object"));
}

function targetRecord(context: CapabilityContext) {
  return {
    objectType: context.resolvedTurn.target?.object_type || null,
    objectId: context.resolvedTurn.target?.canonical_id || null,
    objectName: context.resolvedTurn.target?.label || null,
  };
}

function requestContract(context: CapabilityContext) {
  return resolveIntentContract(context.input, null, targetRecord(context));
}

function capabilityPresentation(primary: CapabilityPresentationPolicy["primary"]): CapabilityPresentationPolicy {
  return { primary, expose_evidence: "summary", allow_internal_ids: false };
}

function resultPresentation(primary: PresentationPolicy["primary"]): PresentationPolicy {
  return {
    primary,
    allowed_supporting_blocks: primary === "table" ? ["text", "table"] : primary === "list" ? ["text", "list"] : ["text"],
    allowed_action_types: [],
    suppress_awareness: true,
    suppress_context_chips: true,
    suppress_duplicate_status: true,
    snapshot_mode: primary === "table" || primary === "list" ? "current_state_snapshot" : "none",
    auto_navigation: false,
  };
}

function readRequirement(domain: OyiDomain, evidenceType: string): EvidenceRequirement {
  return { domain, evidence_type: evidenceType, freshness: ["fresh", "stale", "expired", "unknown", "provider_disconnected"], required: true };
}

const homeScope: ScopeRequirement[] = [{ scope: "home", required: true }];
// Estate-level requirement — used by capabilities whose loaders branch
// scope by surface (home_id for consumer, estate_id for facility), so a
// facility-surface estate-wide read is never rejected for lacking a home_id.
const estateScope: ScopeRequirement[] = [{ scope: "estate", required: true }];

type ReadModuleInput = {
  key: string;
  domain: OyiDomain;
  operations: string[];
  supportedSurfaces: CapabilityModule["supported_surfaces"];
  permissions: string[];
  evidenceRequirements: EvidenceRequirement[];
  scopeRequirements?: ScopeRequirement[];
  supports: (frame: SemanticFrame) => boolean;
  collect: (context: CapabilityContext) => Promise<OyiEvidence[]>;
  answer: (context: CapabilityContext, evidence: OyiEvidence[]) => Promise<DomainResult> | DomainResult;
  rolloutStatus?: CapabilityRolloutStatus;
  primary?: CapabilityPresentationPolicy["primary"];
};

function readModule(input: ReadModuleInput): CapabilityModule {
  return {
    key: input.key,
    domain: input.domain,
    rolloutStatus: input.rolloutStatus || "enabled",
    operations: input.operations,
    supported_surfaces: input.supportedSurfaces,
    scope_requirements: input.scopeRequirements || [],
    permission_requirements: input.permissions,
    risk_class: "read",
    confirmation_policy: "none",
    evidence_requirements: input.evidenceRequirements,
    presentation_policy: capabilityPresentation(input.primary || "text"),
    supports: input.supports,
    async resolve() {
      return { supported: true, reason: null };
    },
    collectEvidence: input.collect,
    buildReadResponse: async (context, evidence) => input.answer(context, evidence),
  };
}

// Sentinel so a mis-flipped rollout_status can be caught at registration
// time (see assertEnabledCapabilityHasAdapter in CapabilityRollout.ts)
// rather than silently advertising a capability whose evidence collector
// never actually loads anything.
function declaredModuleStubCollect(): Promise<OyiEvidence[]> {
  return Promise.resolve([]);
}
(declaredModuleStubCollect as any).__isDeclaredStub = true;

function declaredModule(input: {
  key: string;
  domain: OyiDomain;
  operations: string[];
  supportedSurfaces: CapabilityModule["supported_surfaces"];
  status: CapabilityRolloutStatus;
  permissions?: string[];
  evidence?: EvidenceRequirement[];
  supports?: (frame: SemanticFrame) => boolean;
}) {
  return readModule({
    key: input.key,
    domain: input.domain,
    operations: input.operations,
    supportedSurfaces: input.supportedSurfaces,
    permissions: input.permissions || [],
    evidenceRequirements: input.evidence || [],
    rolloutStatus: input.status,
    supports: input.supports || ((frame) => frame.domain === input.domain),
    collect: declaredModuleStubCollect,
    answer: () => ({ status: "unsupported", answer: `${input.key} is not enabled yet.`, presentation_policy: resultPresentation("text") }),
  });
}

async function deviceInventoryEvidence(context: CapabilityContext) {
  const facts = await loadHomeDeviceInventoryFacts(context.input, context.oisContext);
  return dedupeIntelligenceFacts(facts).map(evidenceFromFact);
}

async function recentDeviceEvidence(context: CapabilityContext) {
  const contract = requestContract(context);
  const facts = await loadRecentDeviceChangeFacts(context.input, context.oisContext, contract, null);
  return dedupeIntelligenceFacts(facts).map(evidenceFromFact);
}

function deviceStatusSupports(frame: SemanticFrame) {
  return frame.domain === "devices" && ["inform", "inspect", "list", "summarize", "device.status"].includes(frame.operation);
}

export function buildPhaseBReadCapabilities(): CapabilityModule[] {
  const deviceEvidence = [readRequirement("devices", "device_availability")];
  const activityEvidence = [readRequirement("devices", "execution_history")];
  const walletEvidence = [readRequirement("wallet", "wallet_transaction")];
  return [
    readModule({
      key: "global.capabilities.read",
      domain: "global",
      operations: ["inform", "list"],
      supportedSurfaces: ["consumer", "facility", "office_internal", "public_corporate"],
      permissions: [],
      evidenceRequirements: [],
      supports: (frame) => frame.domain === "global" && /\bwhat can you do|help|capabilit/i.test(frame.normalizedText),
      collect: async () => [],
      answer: () => ({ status: "answered", answer: "Capability listing is generated from the registry.", presentation_policy: resultPresentation("list") }),
      primary: "list",
    }),
    readModule({
      key: "devices.status.read",
      domain: "devices",
      operations: ["inform", "inspect", "list", "device.status"],
      supportedSurfaces: ["consumer", "facility"],
      permissions: ["devices.read"],
      scopeRequirements: homeScope,
      evidenceRequirements: deviceEvidence,
      supports: deviceStatusSupports,
      collect: deviceInventoryEvidence,
      answer: (context, evidence) => {
        const facts = factsFromEvidence(evidence);
        const contract = requestContract(context);
        const answer = buildDeviceAvailabilityInventoryAnswer(facts, contract, context.input.message);
        const block = tableBlockForContract(contract, facts, presentationFactPredicates);
        return { status: facts.length ? "answered" : "empty", answer, blocks: block ? [block as any] : [], presentation_policy: resultPresentation("table") };
      },
      primary: "table",
    }),
    readModule({
      key: "devices.availability.read",
      domain: "devices",
      operations: ["list", "summarize", "device.availability"],
      supportedSurfaces: ["consumer", "facility"],
      permissions: ["devices.read"],
      scopeRequirements: homeScope,
      evidenceRequirements: deviceEvidence,
      supports: (frame) => frame.domain === "devices" && (frame.operation === "device.availability" || /\boffline|online|available|availability|devices?\b/i.test(frame.normalizedText)),
      collect: deviceInventoryEvidence,
      answer: (context, evidence) => {
        const facts = factsFromEvidence(evidence);
        const contract = requestContract(context);
        const answer = buildDeviceAvailabilityInventoryAnswer(facts, contract, context.input.message);
        const block = tableBlockForContract(contract, facts, presentationFactPredicates);
        return { status: facts.length ? "answered" : "empty", answer, blocks: block ? [block as any] : [], presentation_policy: resultPresentation("table") };
      },
      primary: "table",
    }),
    readModule({
      key: "devices.activity.read",
      domain: "devices",
      operations: ["device.activity", "list"],
      supportedSurfaces: ["consumer", "facility"],
      permissions: ["devices.read"],
      scopeRequirements: homeScope,
      evidenceRequirements: activityEvidence,
      supports: (frame) => frame.domain === "devices" && (frame.operation === "device.activity" || /\bactivity|history|what happened|changed|changes\b/i.test(frame.normalizedText)),
      collect: recentDeviceEvidence,
      answer: (context, evidence) => {
        const facts = factsFromEvidence(evidence);
        const contract = requestContract(context);
        const answer = buildRecentChangesAnswer(facts, contract, presentationFactPredicates);
        const block = tableBlockForContract(contract, facts, presentationFactPredicates);
        return { status: facts.length ? "answered" : "empty", answer, blocks: block ? [block as any] : [], presentation_policy: resultPresentation("table") };
      },
      primary: "table",
    }),
    readModule({
      key: "devices.failures.read",
      domain: "devices",
      operations: ["device.failures", "list"],
      supportedSurfaces: ["consumer", "facility"],
      permissions: ["devices.read"],
      scopeRequirements: homeScope,
      evidenceRequirements: activityEvidence,
      supports: (frame) => frame.domain === "devices" && (frame.operation === "device.failures" || /\bfailures?|failed|faults?|offline\b/i.test(frame.normalizedText)),
      collect: async (context) => {
        const evidence = await recentDeviceEvidence(context);
        return evidence.filter((item) => isFailureFact(recordOf(item.payload).fact as IntelligenceFact));
      },
      answer: (context, evidence) => {
        const facts = factsFromEvidence(evidence);
        const contract = requestContract(context);
        return { status: facts.length ? "answered" : "empty", answer: buildDeviceFailureHistoryAnswer(facts, contract, { factAppliesToContract, isFailureFact }), presentation_policy: resultPresentation("list") };
      },
      primary: "list",
    }),
    readModule({
      key: "devices.diagnosis.read",
      domain: "devices",
      operations: ["device.diagnosis", "inspect"],
      supportedSurfaces: ["consumer", "facility"],
      permissions: ["devices.read"],
      scopeRequirements: homeScope,
      evidenceRequirements: activityEvidence,
      supports: (frame) => frame.domain === "devices" && (frame.operation === "device.diagnosis" || /\bdiagnose|why|investigate\b/i.test(frame.normalizedText)),
      collect: recentDeviceEvidence,
      answer: (context, evidence) => {
        const facts = factsFromEvidence(evidence);
        const answer = facts.length
          ? buildRecentChangesAnswer(facts, requestContract(context), presentationFactPredicates)
          : "I do not see enough confirmed device evidence to diagnose this from the authorised scope.";
        return { status: facts.length ? "answered" : "empty", answer, presentation_policy: resultPresentation("text") };
      },
    }),
    readModule({
      key: "devices.relationships.read",
      domain: "devices",
      operations: ["device.relationships", "inspect"],
      supportedSurfaces: ["consumer", "facility"],
      permissions: ["devices.read"],
      scopeRequirements: homeScope,
      evidenceRequirements: deviceEvidence,
      supports: (frame) => frame.domain === "devices" && (frame.operation === "device.relationships" || /\brelationships?|what controls|scenes?|automations?\b/i.test(frame.normalizedText)),
      collect: deviceInventoryEvidence,
      answer: (context, evidence) => {
        const facts = factsFromEvidence(evidence);
        if (!facts.length) return { status: "empty", answer: "I could not load authorised device relationship evidence for this home.", presentation_policy: resultPresentation("text") };
        const rooms = Array.from(new Set(facts.map((fact) => text(recordOf(fact.value).room_name)).filter(Boolean)));
        return {
          status: "answered",
          answer: `${facts.length} authorised device${facts.length === 1 ? "" : "s"} are visible in this home${rooms.length ? ` across ${rooms.slice(0, 5).join(", ")}` : ""}. Scene and automation links remain read-only in this capability.`,
          presentation_policy: resultPresentation("text"),
        };
      },
    }),
    readModule({
      key: "devices.capabilities.read",
      domain: "devices",
      operations: ["inspect", "inform"],
      supportedSurfaces: ["consumer", "facility"],
      permissions: ["devices.read"],
      scopeRequirements: homeScope,
      evidenceRequirements: deviceEvidence,
      supports: (frame) => frame.domain === "devices" && /\bcapabilit|what can|controls?|supports?\b/i.test(frame.normalizedText),
      collect: deviceInventoryEvidence,
      answer: (_context, evidence) => {
        const facts = factsFromEvidence(evidence);
        const families = Array.from(new Set(facts.map((fact) => text(recordOf(fact.value).device_family)).filter(Boolean)));
        return {
          status: facts.length ? "answered" : "empty",
          answer: facts.length
            ? `Oyi can read status, availability, recent activity, failure evidence, and safe relationship metadata for ${facts.length} authorised device${facts.length === 1 ? "" : "s"}${families.length ? ` (${families.slice(0, 6).join(", ")})` : ""}. No device command was sent.`
            : "I could not load authorised device capability evidence for this home.",
          presentation_policy: resultPresentation("text"),
        };
      },
    }),
    readModule({
      key: "wallet.transactions.read",
      domain: "wallet",
      operations: ["wallet.history", "list"],
      supportedSurfaces: ["consumer"],
      permissions: ["wallet.read"],
      scopeRequirements: homeScope,
      evidenceRequirements: walletEvidence,
      supports: (frame) => frame.domain === "wallet" && (frame.operation === "wallet.history" || /\btransactions?|history|wallet\b/i.test(frame.normalizedText)),
      collect: async (context) => {
        const facts = await loadWalletTransactionFacts(context.input, context.oisContext, requestContract(context));
        return facts.map(evidenceFromFact);
      },
      answer: (context, evidence) => {
        const facts = factsFromEvidence(evidence);
        if (facts.some((fact) => fact.truth_state === "unavailable")) {
          return {
            status: "unavailable",
            answer: "Wallet transaction evidence is unavailable right now. I did not treat that as an empty wallet history.",
            presentation_policy: resultPresentation("text"),
          };
        }
        const contract = requestContract(context);
        const block = tableBlockForContract(contract, facts, presentationFactPredicates);
        return { status: facts.length ? "answered" : "empty", answer: buildWalletHistoryAnswer(facts), blocks: block ? [block as any] : [], presentation_policy: resultPresentation("table") };
      },
      primary: "table",
    }),
    readModule({
      key: "utilities.spending.read",
      domain: "utilities",
      operations: ["utilities.spending", "summarize"],
      supportedSurfaces: ["consumer"],
      permissions: ["wallet.read", "services.read"],
      scopeRequirements: homeScope,
      evidenceRequirements: [readRequirement("utilities", "utility_spending")],
      supports: (frame) => frame.domain === "utilities" && (frame.operation === "utilities.spending" || /\bspent|spending|how much|costs?|paid|payment\b/i.test(frame.normalizedText)),
      collect: async (context) => {
        const facts = await loadUtilitySpendingFacts(context.input, context.oisContext, requestContract(context));
        return facts.map(evidenceFromFact);
      },
      answer: (context, evidence) => {
        const facts = factsFromEvidence(evidence);
        const contract = requestContract(context);
        const block = tableBlockForContract({ ...contract, intent: "wallet_operation", answer_builder: "utility_spending" }, facts, presentationFactPredicates);
        return { status: facts.length ? "answered" : "empty", answer: buildUtilitySpendingAnswer(facts), blocks: block ? [block as any] : [], presentation_policy: resultPresentation("table") };
      },
      primary: "table",
    }),
    declaredModule({ key: "utilities.active.read", domain: "utilities", operations: ["utilities.active", "list", "inspect"], supportedSurfaces: ["consumer", "facility"], status: "implemented", permissions: ["utilities.read"], evidence: [readRequirement("utilities", "utility_status")], supports: (frame) => frame.domain === "utilities" && frame.operation === "utilities.active" }),
    declaredModule({ key: "utilities.usage.read", domain: "utilities", operations: ["utilities.usage", "inspect"], supportedSurfaces: ["consumer", "facility"], status: "declared", permissions: ["utilities.read"], evidence: [readRequirement("utilities", "utility_usage")], supports: (frame) => frame.domain === "utilities" && frame.operation === "utilities.usage" }),
    declaredModule({ key: "utilities.balance.read", domain: "utilities", operations: ["utilities.balance", "inspect"], supportedSurfaces: ["consumer"], status: "declared", permissions: ["utilities.read"], evidence: [readRequirement("utilities", "utility_balance")], supports: (frame) => frame.domain === "utilities" && frame.operation === "utilities.balance" }),
    declaredModule({ key: "utilities.meter.read", domain: "utilities", operations: ["utilities.meter", "inspect"], supportedSurfaces: ["consumer", "facility"], status: "declared", permissions: ["utilities.read"], evidence: [readRequirement("utilities", "meter_status")], supports: (frame) => frame.domain === "utilities" && frame.operation === "utilities.meter" }),
    readModule({
      key: "maintenance.requests.read",
      domain: "maintenance",
      operations: ["list", "inspect"],
      supportedSurfaces: ["consumer", "facility"],
      permissions: ["maintenance.read"],
      scopeRequirements: estateScope,
      evidenceRequirements: [readRequirement("maintenance", "maintenance_request")],
      supports: (frame) => frame.domain === "maintenance" && (frame.operation === "list" || frame.operation === "inspect" || /\bmaintenance|repair|fix|broken\b/i.test(frame.normalizedText)),
      collect: async (context) => {
        const facts = await loadMaintenanceRequestFacts(context.input, context.oisContext, requestContract(context));
        return facts.map(evidenceFromFact);
      },
      answer: (context, evidence) => {
        const facts = factsFromEvidence(evidence);
        if (facts.some((fact) => fact.truth_state === "unavailable")) {
          return {
            status: "unavailable",
            answer: "Maintenance request evidence is unavailable right now. I did not treat that as no open requests.",
            presentation_policy: resultPresentation("text"),
          };
        }
        return { status: facts.length ? "answered" : "empty", answer: buildMaintenanceRequestsAnswer(facts), presentation_policy: resultPresentation("list") };
      },
      primary: "list",
    }),
    readModule({
      key: "visitors.pending.read",
      domain: "visitors",
      operations: ["list", "inspect"],
      supportedSurfaces: ["consumer", "facility"],
      permissions: ["visitors.read"],
      scopeRequirements: estateScope,
      evidenceRequirements: [readRequirement("visitors", "visitor_access")],
      supports: (frame) => frame.domain === "visitors" && (frame.operation === "list" || frame.operation === "inspect" || /\bvisitors?|guest|access code|pending arrival\b/i.test(frame.normalizedText)),
      collect: async (context) => {
        const facts = await loadVisitorAccessFacts(context.input, context.oisContext, requestContract(context));
        return facts.map(evidenceFromFact);
      },
      answer: (context, evidence) => {
        const facts = factsFromEvidence(evidence);
        if (facts.some((fact) => fact.truth_state === "unavailable")) {
          return {
            status: "unavailable",
            answer: "Visitor access evidence is unavailable right now. I did not treat that as no visitors on file.",
            presentation_policy: resultPresentation("text"),
          };
        }
        return { status: facts.length ? "answered" : "empty", answer: buildVisitorAccessAnswer(facts), presentation_policy: resultPresentation("list") };
      },
      primary: "list",
    }),
    declaredModule({ key: "security.incidents.read", domain: "security", operations: ["list", "inspect"], supportedSurfaces: ["consumer", "facility"], status: "implemented", permissions: ["security.read"], evidence: [readRequirement("security", "relationship_context")] }),
    declaredModule({ key: "services.active.read", domain: "services", operations: ["list", "inspect"], supportedSurfaces: ["consumer"], status: "implemented", permissions: ["services.read"], evidence: [readRequirement("services", "relationship_context")] }),
    declaredModule({ key: "community.latest.read", domain: "community", operations: ["list", "inspect"], supportedSurfaces: ["consumer", "facility"], status: "implemented", permissions: ["community.read"], evidence: [readRequirement("community", "relationship_context")] }),
    declaredModule({ key: "messages.unread.read", domain: "messages", operations: ["list", "inspect"], supportedSurfaces: ["consumer"], status: "implemented", permissions: ["messages.read"], evidence: [readRequirement("messages", "relationship_context")] }),
    declaredModule({ key: "scenes.list.read", domain: "scenes", operations: ["list", "inspect"], supportedSurfaces: ["consumer"], status: "implemented", permissions: ["scenes.read"], evidence: [readRequirement("scenes", "route_contract")] }),
    declaredModule({ key: "automations.list.read", domain: "automations", operations: ["list", "inspect"], supportedSurfaces: ["consumer"], status: "implemented", permissions: ["automations.read"], evidence: [readRequirement("automations", "route_contract")] }),
    declaredModule({ key: "reports.period_summary.read", domain: "reports", operations: ["summarize", "inspect"], supportedSurfaces: ["consumer", "facility"], status: "shadow", permissions: [], evidence: [readRequirement("reports", "cross_domain_summary")] }),
    declaredModule({ key: "home.summary.read", domain: "home", operations: ["summarize"], supportedSurfaces: ["consumer"], status: "shadow", permissions: ["devices.read"], evidence: [readRequirement("home", "composed_context")] }),
    declaredModule({ key: "rooms.inventory.read", domain: "rooms", operations: ["list"], supportedSurfaces: ["consumer", "facility"], status: "shadow", permissions: ["homes.read"], evidence: [readRequirement("rooms", "composed_context")] }),
  ];
}
