import type { CapabilityContext, CapabilityModule } from "../../contracts/capability";
import type { DomainResult } from "../../contracts/domainResult";
import type { OyiEvidence } from "../../contracts/evidence";
import type { IntelligenceFact } from "../../contracts/canonicalConversation";
import { supabaseAdmin } from "../../../supabase/supabaseClient";
import { logger } from "../../../observability/logger";
import {
  readModule,
  evidenceFromFact,
  factsFromEvidence,
  requestContract,
  resultPresentation,
  readRequirement,
  homeScope,
} from "../../capabilities/ReadCapabilityModules";
import { HOME_CONTRIBUTORS } from "./homeContributors";
import { ROOM_CONTRIBUTORS } from "./roomContributors";
import { runContributors, composeAggregateResult } from "./aggregator";
import { buildAggregateSummary, buildAggregateActivitySummary } from "./roomHomeAnswers";
import { resolveRoomTargetFromMessage, roomPhraseForIntelligence } from "./roomTargetResolution";
import type { AggregateResult, AggregateOperation } from "./aggregateContract";
import type { ContributorContext } from "./contributorTypes";
import { loadHomeDeviceInventoryFacts, loadRecentDeviceChangeFacts } from "../devices/deviceEvidence";
import { buildContributorSummary } from "../contributorSummary";
import { buildResultSetContext, type ResultSetContext } from "../../context/resultSetContext";

function text(value: unknown) {
  return String(value ?? "").trim();
}

// Short-lived hand-off between a capability's collect() (which runs every
// contributor and composes the aggregate once) and its answer() (which
// only needs to turn the already-computed aggregate into a DomainResult).
// Keyed by conversation_request_id and deleted immediately after use — this
// avoids re-running every contributor twice or smuggling the aggregate
// through OyiEvidence.payload on a synthetic entry.
const pendingAggregates = new Map<string, AggregateResult>();
const pendingRoomUnresolved = new Map<string, DomainResult>();

function currentScope(context: CapabilityContext) {
  return {
    estate_id: context.input.estate_id || context.oisContext?.estate_id || null,
    home_id: context.input.home_id || context.oisContext?.home_id || null,
  };
}

function boundedFactsForEvidence(result: AggregateResult): IntelligenceFact[] {
  const attentionIds = new Set(result.attention_items.map((item) => item.dedup_key));
  const attentionFacts = result.facts.filter((fact) => fact.object && attentionIds.has(`${fact.object.object_type}:${fact.object.canonical_id}`));
  const remaining = result.facts.filter((fact) => !attentionFacts.includes(fact)).slice(0, 30 - attentionFacts.length);
  return [...attentionFacts, ...remaining].slice(0, 30);
}

// §54 observability — safe (no fact payloads, no PII), one line per
// aggregate run, whichever scope/operation produced it.
function logAggregateRun(input: { aggregateType: "home" | "room"; operation: AggregateOperation; capabilityKey: string; scope: { estate_id: string | null; home_id: string | null; room_id: string | null }; aggregate: AggregateResult; latencyByDomain: Record<string, number>; aggregateLatencyMs: number }) {
  const { aggregate } = input;
  logger.info("oyi_room_home_aggregate_completed", {
    aggregate_type: input.aggregateType,
    operation: input.operation,
    capability_key: input.capabilityKey,
    estate_id: input.scope.estate_id,
    home_id: input.scope.home_id,
    room_id: input.scope.room_id,
    contributors_requested: aggregate.coverage.requested,
    contributors_completed: aggregate.coverage.answered,
    contributors_empty: aggregate.coverage.empty,
    contributors_unavailable: aggregate.coverage.unavailable,
    contributors_degraded: aggregate.coverage.degraded,
    overall_severity: aggregate.overall_severity,
    overall_state: aggregate.overall_state,
    attention_count: aggregate.attention_items.length,
    coverage_status: aggregate.status,
    object_ref_count: aggregate.object_refs.length,
    latency_by_domain: input.latencyByDomain,
    aggregate_latency_ms: input.aggregateLatencyMs,
  });
}

async function runHomeAggregate(context: CapabilityContext, operation: AggregateOperation, devicesFacts: "inventory" | "recent", capabilityKey: string): Promise<AggregateResult> {
  const contract = requestContract(context);
  const scope = { ...currentScope(context), room_id: null };
  const contributorContext: ContributorContext = { input: context.input, oisContext: context.oisContext, contract, scope, operation };
  const contributors = devicesFacts === "recent"
    ? HOME_CONTRIBUTORS.map((contributor) => contributor.domain === "devices" ? recentDevicesHomeContributor : contributor)
    : HOME_CONTRIBUTORS;
  const { contributors: results, latencyByDomain, aggregateLatencyMs } = await runContributors(contributors, contributorContext);
  const summaryText = operation === "activity" ? "" : "";
  const aggregate = composeAggregateResult({
    scopeType: "home",
    scopeRef: { estate_id: scope.estate_id, home_id: scope.home_id, room_id: null, label: "home" },
    operation,
    contributors: results,
    summaryText,
  });
  aggregate.summary = operation === "activity" ? buildAggregateActivitySummary(aggregate) : buildAggregateSummary(aggregate);
  logAggregateRun({ aggregateType: "home", operation, capabilityKey, scope, aggregate, latencyByDomain, aggregateLatencyMs });
  return aggregate;
}

// Home activity questions ("what happened today?") want RECENT device
// changes, not the full inventory — same evidence family, different query,
// still devices.
const recentDevicesHomeContributor = {
  domain: "devices",
  supports: () => true,
  contribute: async (context: ContributorContext) => {
    const facts = await loadRecentDeviceChangeFacts(context.input, context.oisContext, context.contract, null);
    return buildContributorSummary({
      domain: "devices",
      facts,
      summary: facts.length ? `${facts.length} recent device change${facts.length === 1 ? "" : "s"}.` : "No recent device changes.",
    });
  },
};

async function runRoomAggregate(context: CapabilityContext, operation: AggregateOperation, capabilityKey: string): Promise<{ aggregate: AggregateResult | null; unresolved: DomainResult | null }> {
  const resolution = await resolveRoomTargetFromMessage(context.actor, context.oisContext, context.input);
  if (resolution.status === "no_phrase" || resolution.status === "not_found") {
    return {
      aggregate: null,
      unresolved: {
        status: "unsupported",
        answer: resolution.status === "not_found"
          ? `I could not find a room called "${resolution.phrase}" in this home.`
          : "I could not tell which room you mean.",
        presentation_policy: resultPresentation("text"),
      },
    };
  }
  if (resolution.status === "ambiguous") {
    const names = resolution.candidates.map((c) => c.label).join("; ");
    return {
      aggregate: null,
      unresolved: {
        status: "draft",
        answer: `I found more than one room matching "${resolution.phrase}" — did you mean: ${names}? Please tell me which one.`,
        presentation_policy: resultPresentation("text"),
        metadata: { followup_ambiguous: true, candidate_count: resolution.candidates.length },
      },
    };
  }
  const contract = requestContract(context);
  const scope = { ...currentScope(context), room_id: resolution.room_id };
  const contributorContext: ContributorContext = { input: context.input, oisContext: context.oisContext, contract, scope, operation };
  const { contributors: results, latencyByDomain, aggregateLatencyMs } = await runContributors(ROOM_CONTRIBUTORS, contributorContext);
  const aggregate = composeAggregateResult({
    scopeType: "room",
    scopeRef: { estate_id: scope.estate_id, home_id: scope.home_id, room_id: scope.room_id, label: resolution.label },
    operation,
    contributors: results,
    summaryText: "",
  });
  aggregate.summary = operation === "activity" ? buildAggregateActivitySummary(aggregate) : buildAggregateSummary(aggregate);
  logAggregateRun({ aggregateType: "room", operation, capabilityKey, scope, aggregate, latencyByDomain, aggregateLatencyMs });
  return { aggregate, unresolved: null };
}

// A Room/Home answer can name several domains in one turn (a maintenance
// request, an automation failure, an expected visitor). Each contributor
// domain that actually surfaced objects gets its OWN per-domain result set
// (not one result set arbitrarily tagged with the first domain's name) —
// this is what lets "tell me about the automation" / "what about the
// maintenance issue?" each resolve correctly via followUpResolver.ts's
// domain-aware switch, without a separate Room/Home follow-up system.
function resultSetsForAggregate(aggregate: AggregateResult, context: CapabilityContext): ResultSetContext[] {
  const contract = requestContract(context);
  const sets: ResultSetContext[] = [];
  for (const contributor of aggregate.contributors) {
    if (!contributor.facts.length) continue;
    // When a domain has attention items, those ARE the objects narrated in
    // the summary ("the AC maintenance request", "the automation that
    // failed") — use just those so "tell me about the automation" resolves
    // to one clear object instead of being ambiguous against every
    // definition + run fact the contributor happened to load. Domains with
    // nothing noteworthy keep their full fact list (e.g. room.status.read's
    // device listing, for "tell me about the second one").
    const facts = contributor.attention_items.length ? contributor.attention_items : contributor.facts;
    const resultSet = buildResultSetContext({
      domain: contributor.domain,
      capabilityKey: null,
      operation: aggregate.operation,
      facts,
      contract,
      message: context.input.message,
    });
    if (resultSet) sets.push(resultSet);
  }
  return sets;
}

function aggregateToDomainResult(aggregate: AggregateResult, context: CapabilityContext): DomainResult {
  return {
    status: aggregate.status === "unavailable" ? "unavailable" : "answered",
    answer: aggregate.summary,
    presentation_policy: resultPresentation("text"),
    metadata: {
      overall_state: aggregate.overall_state,
      overall_severity: aggregate.overall_severity,
      coverage: aggregate.coverage,
      attention_count: aggregate.attention_items.length,
      object_ref_count: aggregate.object_refs.length,
      result_set: resultSetsForAggregate(aggregate, context),
    },
  };
}

function homeCapability(key: string, operation: AggregateOperation, devicesFacts: "inventory" | "recent", supports: CapabilityModule["supports"]): CapabilityModule {
  return readModule({
    key,
    domain: "home",
    operations: ["summarize", "inspect"],
    supportedSurfaces: ["consumer"],
    permissions: ["devices.read", "maintenance.read", "visitors.read", "security.read", "utilities.read", "wallet.read", "services.read", "community.read", "automations.read", "scenes.read"],
    scopeRequirements: homeScope,
    evidenceRequirements: [readRequirement("home", "composed_context")],
    supports,
    collect: async (context) => {
      const aggregate = await runHomeAggregate(context, operation, devicesFacts, key);
      pendingAggregates.set(context.resolvedTurn.request_id, aggregate);
      return boundedFactsForEvidence(aggregate).map(evidenceFromFact);
    },
    answer: (context, evidence) => {
      const requestId = context.resolvedTurn.request_id;
      const aggregate = pendingAggregates.get(requestId);
      pendingAggregates.delete(requestId);
      if (!aggregate) {
        logger.warn("oyi_home_aggregate_missing_at_answer", { capability_key: key });
        const facts = factsFromEvidence(evidence);
        return { status: facts.length ? "answered" : "empty", answer: "I could not compose a home summary right now.", presentation_policy: resultPresentation("text") };
      }
      return aggregateToDomainResult(aggregate, context);
    },
    primary: "text",
  });
}

function roomCapability(key: string, operation: AggregateOperation, supports: CapabilityModule["supports"]): CapabilityModule {
  return readModule({
    key,
    domain: "rooms",
    operations: ["summarize", "inspect"],
    supportedSurfaces: ["consumer"],
    permissions: ["devices.read", "maintenance.read", "security.read"],
    scopeRequirements: homeScope,
    evidenceRequirements: [readRequirement("rooms", "composed_context")],
    supports,
    collect: async (context) => {
      const { aggregate, unresolved } = await runRoomAggregate(context, operation, key);
      const requestId = context.resolvedTurn.request_id;
      if (unresolved) {
        pendingAggregates.delete(requestId);
        pendingRoomUnresolved.set(requestId, unresolved);
        return [];
      }
      pendingAggregates.set(requestId, aggregate as AggregateResult);
      return boundedFactsForEvidence(aggregate as AggregateResult).map(evidenceFromFact);
    },
    answer: (context, evidence) => {
      const requestId = context.resolvedTurn.request_id;
      const aggregate = pendingAggregates.get(requestId);
      pendingAggregates.delete(requestId);
      const unresolved = pendingRoomUnresolved.get(requestId);
      pendingRoomUnresolved.delete(requestId);
      if (unresolved) return unresolved;
      if (!aggregate) {
        const facts = factsFromEvidence(evidence);
        return { status: facts.length ? "answered" : "empty", answer: "I could not compose a room summary right now.", presentation_policy: resultPresentation("text") };
      }
      return aggregateToDomainResult(aggregate, context);
    },
    primary: "text",
  });
}

const HOME_BROAD_QUESTION = /\b(how is|how's|hows)\s+(my\s+)?home\b|\bis everything (ok|okay|fine)\b|\banything (i should know|wrong)\b|\bwhat needs (my )?attention\b|\bhome summary\b|\bwhat happened (today|overnight)\b|\bgive me a summary\b/i;
const ROOM_BROAD_QUESTION = /\bwhat('?s| is) happening\b|\bhow is\b|\banything wrong\b|\bwhat changed\b|\bwhat happened\b|\bneeds attention\b/i;

// A room capability only claims a turn when the message actually contains a
// room noun (living room/kitchen/etc.) — otherwise "How is my home?" would
// ambiguously match both ROOM_BROAD_QUESTION's bare "how is" and
// HOME_BROAD_QUESTION, since both patterns are deliberately loose on their
// own. roomPhraseForIntelligence is the same extractor collect() uses to
// resolve the actual target, so supports()/collect() never disagree about
// whether a room was named.
function isRoomBroadQuestion(normalizedText: string): boolean {
  return ROOM_BROAD_QUESTION.test(normalizedText) && Boolean(roomPhraseForIntelligence(normalizedText));
}

function roomsInventoryCapability(): CapabilityModule {
  return readModule({
    key: "rooms.inventory.read",
    domain: "rooms",
    operations: ["list", "inspect"],
    supportedSurfaces: ["consumer", "facility"],
    permissions: ["homes.read"],
    scopeRequirements: homeScope,
    evidenceRequirements: [readRequirement("rooms", "composed_context")],
    supports: (frame) => frame.domain === "rooms" && (frame.operation === "list" || /\bwhat rooms\b|\blist rooms\b|\brooms do i have\b/i.test(frame.normalizedText)),
    collect: async (context) => {
      const facts = await loadRoomsInventoryFacts(context);
      return facts.map(evidenceFromFact);
    },
    answer: (context, evidence) => {
      const facts = factsFromEvidence(evidence);
      const answer = facts.length
        ? `${facts.length} room${facts.length === 1 ? "" : "s"} on record: ${facts.slice(0, 10).map((fact) => fact.object?.label).filter(Boolean).join(", ")}.`
        : "I do not see any registered rooms for this home.";
      return { status: facts.length ? "answered" : "empty", answer, presentation_policy: resultPresentation("list") };
    },
    primary: "list",
  });
}

export function buildRoomHomeCapabilities(): CapabilityModule[] {
  return [
    homeCapability("home.summary.read", "summary", "inventory", (frame) => HOME_BROAD_QUESTION.test(frame.normalizedText) && !/\b(attention|overnight|today|happened)\b/i.test(frame.normalizedText) && !roomPhraseForIntelligence(frame.normalizedText)),
    homeCapability("home.attention.read", "attention", "inventory", (frame) => /\bneeds? (my )?attention\b|\banything (i should know|wrong)\b|\bis everything (ok|okay|fine)\b/i.test(frame.normalizedText) && !roomPhraseForIntelligence(frame.normalizedText)),
    homeCapability("home.activity.read", "activity", "recent", (frame) => /\bwhat happened\b|\bwhat changed\b|\bovernight\b|\bwhile i was away\b/i.test(frame.normalizedText) && /\bhome|house\b/i.test(frame.normalizedText) && !roomPhraseForIntelligence(frame.normalizedText)),
    roomCapability("room.status.read", "status", (frame) => isRoomBroadQuestion(frame.normalizedText) && !/\bwrong|attention|changed|happened\b/i.test(frame.normalizedText)),
    roomCapability("room.attention.read", "attention", (frame) => (/\banything wrong\b|\bneeds attention\b/i.test(frame.normalizedText)) && Boolean(roomPhraseForIntelligence(frame.normalizedText))),
    roomCapability("room.activity.read", "activity", (frame) => (/\bwhat changed\b|\bwhat happened\b/i.test(frame.normalizedText)) && Boolean(roomPhraseForIntelligence(frame.normalizedText))),
    roomsInventoryCapability(),
  ];
}

export async function loadRoomsInventoryFacts(context: CapabilityContext): Promise<IntelligenceFact[]> {
  const scope = currentScope(context);
  if (!scope.home_id) return [];
  const { data, error } = await supabaseAdmin.from("rooms").select("id,name,home_id,estate_id,type,floor,created_at").eq("home_id", scope.home_id).limit(100);
  if (error) {
    logger.warn("oyi_rooms_inventory_load_failed", { home_id: scope.home_id, error });
    return [];
  }
  const rows = Array.isArray(data) ? data : [];
  return rows.map((row: any): IntelligenceFact => ({
    fact_id: `room:${row.id}`,
    domain: "rooms",
    fact_type: "room",
    scope: { estate_id: row.estate_id || scope.estate_id, home_id: row.home_id || scope.home_id, room_id: String(row.id) },
    object: { object_type: "room", canonical_id: String(row.id), label: text(row.name) || "Room" },
    statement: `${text(row.name) || "Room"}${row.type ? ` (${text(row.type)})` : ""}.`,
    value: { name: text(row.name), type: text(row.type) || null, floor: row.floor ?? null },
    previous_value: null,
    occurred_at: text(row.created_at) || null,
    observed_at: new Date().toISOString(),
    source_type: "database",
    source_id: String(row.id),
    truth_state: "confirmed",
    confidence: 0.9,
    freshness: text(row.created_at) || "historical",
    privacy_class: "resident_home_private",
    permissions: ["homes.read"],
    evidence: [{ type: "rooms", id: row.id }],
  }));
}
