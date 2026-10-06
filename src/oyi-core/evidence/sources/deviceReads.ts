// Evidence-read adapters for the shared device boundary. PURE READ: this module may only
// import readers and pure helpers (see PURE_READ_ALLOWED_IMPORTS); it never writes state.
import type { CapabilityContext } from "../../contracts/capability";
import type { EvidenceReadOutcome, EvidenceReadScope, OyiEvidence } from "../../contracts/evidence";
import type { IntelligenceFact } from "../../contracts/canonicalConversation";
import { evidenceReadOutcome } from "../EvidenceReadOutcome";
import { resolveIntentContract } from "../../runtime/canonicalTurnResolution";
import { loadHomeDeviceInventoryFacts, readHomeDeviceInventory, readRecentDeviceChanges, dedupeIntelligenceFacts, DEVICE_INVENTORY_ROW_LIMIT, DEVICE_LEDGER_ROW_LIMIT } from "../../domains/devices/deviceEvidence";
import { evidenceFromFact } from "./evidenceFromFact";

function requestContract(context: CapabilityContext) {
  const target = {
    objectType: context.resolvedTurn.target?.object_type || null,
    objectId: context.resolvedTurn.target?.canonical_id || null,
    objectName: context.resolvedTurn.target?.label || null,
  };
  return resolveIntentContract(context.input, null, target);
}

export async function deviceInventoryEvidence(context: CapabilityContext) {
  const facts = await loadHomeDeviceInventoryFacts(context.input, context.oisContext);
  return dedupeIntelligenceFacts(facts).map(evidenceFromFact);
}

// A device with no observation yet is a registered device whose current state is
// unknown. It is NOT a failure sentinel: the evidence outcome drops
// truth_class "unavailable" records, which would hide the device and turn
// "state unknown" into "no device". Keep the record, mark it unobserved.
function deviceRecordEvidence(fact: IntelligenceFact): OyiEvidence {
  const evidence = evidenceFromFact(fact);
  return fact.fact_type === "device_availability" && fact.truth_state === "unavailable"
    ? { ...evidence, truth_class: "source_record", freshness: "unobservable", confidence: 0 }
    : evidence;
}

function deviceReadBase(key: string, scope: EvidenceReadScope, population: string) {
  return {
    capability_key: key, domain: "devices" as const, requested_scope: scope, effective_scope: scope,
    authority: "allowed" as const, scope: "enforced" as const, query_executed: true, availability: "available" as const,
    population, complete: false, truncated: false, freshness: "unknown" as const, records: [] as OyiEvidence[],
  };
}

// Shared device inventory boundary for devices.status / devices.availability. A failed
// query is error/unavailable, never an empty list; an empty room must be shown to belong
// to the verified home; row-limit truncation is reported; room scope is applied in the
// query so a large home cannot hide valid room devices behind the row limit.
export function deviceInventoryRead(key: string) {
  return async (context: CapabilityContext, scope: EvidenceReadScope): Promise<EvidenceReadOutcome> => {
    const input = { ...context.input, estate_id: scope.estate_id, home_id: scope.home_id, room_id: scope.room_id || undefined } as any;
    const population = scope.room_id
      ? `registered_devices_in_verified_room_of_verified_home_limit_${DEVICE_INVENTORY_ROW_LIMIT}`
      : `registered_devices_in_verified_home_limit_${DEVICE_INVENTORY_ROW_LIMIT}`;
    const base = deviceReadBase(key, scope, population);
    const read = await readHomeDeviceInventory(input, context.oisContext);
    if (read.reason === "home_scope_missing") return evidenceReadOutcome({ ...base, scope: "insufficient", query_executed: false });
    if (read.reason === "room_not_in_home") return evidenceReadOutcome({ ...base, scope: "insufficient" });
    if (read.availability !== "available") return evidenceReadOutcome({ ...base, availability: read.availability });
    const records = dedupeIntelligenceFacts(read.facts).map(deviceRecordEvidence);
    return evidenceReadOutcome({
      ...base, records, complete: !read.truncated, truncated: read.truncated,
      // The registry read is current; a device whose own state is unobserved keeps
      // per-record unobservable freshness and cannot be promoted by the read.
      freshness: records.some(r => r.freshness === "unobservable") ? "unknown" : "current",
      degraded_sources: read.degraded,
    });
  };
}

// Shared device history boundary for devices.activity / devices.failures. Only the
// home-scoped execution ledger is read: audit events are estate-wide with optional
// home attribution, and caller-supplied history is not a source. A ledger failure is an
// error; reaching the ledger bound is truncation; zero is proven only for the visible
// population inside the declared window.
export function deviceHistoryRead(key: string, select: (facts: IntelligenceFact[]) => IntelligenceFact[]) {
  return async (context: CapabilityContext, scope: EvidenceReadScope): Promise<EvidenceReadOutcome> => {
    const input = { ...context.input, estate_id: scope.estate_id, home_id: scope.home_id, room_id: undefined, recent_executions: undefined } as any;
    const contract = requestContract({ ...context, input } as CapabilityContext);
    const read = await readRecentDeviceChanges(input, context.oisContext, contract, null, { audit: false });
    const base = deviceReadBase(key, scope, `resident_visible_device_command_executions_in_execution_ledger_for_verified_home_since_${read.window_from}_limit_${DEVICE_LEDGER_ROW_LIMIT}`);
    const facts = select(dedupeIntelligenceFacts(read.facts));
    // Past events are history, not a live observation: keep their timestamps but never
    // let age make the whole read stale or fresh.
    const records = facts.map(fact => ({ ...evidenceFromFact(fact), freshness: "unknown" as const }));
    return evidenceReadOutcome({
      ...base, records, complete: !read.ledger_truncated, truncated: read.ledger_truncated,
      freshness: "current", degraded_sources: read.degraded,
      lifecycle: records.map(r => ({ evidence_id: r.evidence_id, relevance: "historical" as const })),
    });
  };
}

export async function recentDeviceEvidence(context: CapabilityContext) {
  const contract = requestContract(context);
  const read = await readRecentDeviceChanges(context.input, context.oisContext, contract, null);
  const evidence = dedupeIntelligenceFacts(read.facts).map(evidenceFromFact);
  // A failed primary history query must not read as "no recent activity".
  return read.ledger === "failed" ? [...evidence, deviceHistoryUnavailableEvidence(context)] : evidence;
}

function deviceHistoryUnavailableEvidence(context: CapabilityContext) {
  const scope = { estate_id: context.input.estate_id || context.oisContext?.estate_id || null, home_id: context.input.home_id || context.oisContext?.home_id || null, room_id: null };
  return evidenceFromFact({
    fact_id: `device-history-unavailable:${context.resolvedTurn.request_id}`, domain: "devices", fact_type: "device_history_unavailable",
    scope, object: null, statement: "Recent device activity could not be loaded.", value: null, previous_value: null,
    occurred_at: null, observed_at: new Date().toISOString(), source_type: "database", source_id: null, truth_state: "unavailable",
    confidence: 0, freshness: "unavailable", privacy_class: "resident_device_private", permissions: [], evidence: [{ type: "execution_ledger", status: "unavailable" }],
  } as IntelligenceFact);
}

export const HISTORY_UNAVAILABLE_TEXT = "I could not load recent device activity just now, so I cannot say nothing changed or nothing failed. Please try again shortly.";
export function historyUnavailable(facts: IntelligenceFact[]) {
  return facts.some(f => f.fact_type === "device_history_unavailable");
}

