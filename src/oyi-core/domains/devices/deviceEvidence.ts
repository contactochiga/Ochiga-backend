import { evidenceEnvelope } from "../../evidence/EvidenceEnvelope";
import { classifyFreshness } from "../../contracts/freshness";
import { observationPolicyForDevice } from "./deviceObservationPolicy";
import { supabaseAdmin } from "../../../supabase/supabaseClient";
import { logger } from "../../../observability/logger";
import { safeDateLabel } from "../../presentation/timeFreshness";
import type {
  CanonicalConversationRequest,
  IntelligenceFact,
  OperationalObject,
  TruthState,
} from "../../contracts/canonicalConversation";
import type { OisContext } from "../../../types/oisContext";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";

export function runtimeEvidenceForDevice(input: {
  device: Record<string, unknown>;
  runtime: Record<string, unknown> | null;
  scope: { estate_id: string | null; home_id: string | null; room_id: string | null };
}) {
  const policy = observationPolicyForDevice(input.device, input.runtime);
  const observedAt = String(input.runtime?.provider_timestamp || input.runtime?.runtime_timestamp || input.runtime?.last_refresh || "") || null;
  return evidenceEnvelope({
    domain: "devices",
    type: "runtime_state",
    object_type: "device",
    object_id: String(input.device.id || input.runtime?.device_id || "") || null,
    source: "runtime",
    observed_at: observedAt,
    freshness: classifyFreshness(policy, observedAt),
    authorised_scope: input.scope,
    confidence: input.runtime ? 0.82 : 0.2,
    payload: {
      policy,
      runtime_available: Boolean(input.runtime),
      provider_timestamp: input.runtime?.provider_timestamp || null,
      runtime_timestamp: input.runtime?.runtime_timestamp || null,
    },
  });
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function human(value: unknown) {
  return text(value).replace(/_/g, " ");
}

function cleanLabel(value: unknown, fallback = "Item") {
  const raw = text(value);
  if (!raw) return fallback;
  return raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function conversationScope(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  return {
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
    room_id: input.room_id || text(recordOf(input.context).room_id || recordOf(input.context).roomId) || null,
  };
}

export function deviceFreshnessFromTimestamp(value: unknown) {
  const ts = Date.parse(text(value));
  if (!Number.isFinite(ts)) return { freshness: "unknown", truth_state: "unavailable" as TruthState, age_ms: null as number | null };
  const ageMs = Date.now() - ts;
  if (ageMs <= 2 * 60 * 1000) return { freshness: "fresh", truth_state: "confirmed" as TruthState, age_ms: ageMs };
  if (ageMs <= 15 * 60 * 1000) return { freshness: "stale", truth_state: "observed" as TruthState, age_ms: ageMs };
  return { freshness: "expired", truth_state: "observed" as TruthState, age_ms: ageMs };
}

export function canonicalDeviceAvailabilityStatus(input: {
  online: unknown;
  freshness: string;
  providerHealth?: unknown;
}) {
  const provider = text(input.providerHealth).toLowerCase();
  if (["provider_disconnected", "disconnected", "integration_expired", "authentication_failed"].includes(provider)) return "provider_disconnected";
  if (input.freshness === "fresh" && input.online === true) return "online";
  if (input.freshness === "fresh" && input.online === false) return "offline";
  if (input.freshness === "stale") return "stale";
  if (input.freshness === "expired") return "expired";
  return "unknown";
}

function humanCommandDirection(value: unknown) {
  const command = recordOf(value);
  for (const [key, raw] of Object.entries(command)) {
    if (/^switch_\d+$/i.test(key) || ["switch", "power", "on"].includes(key)) {
      if (typeof raw === "boolean") return raw ? "On" : "Off";
    }
  }
  return "";
}

export function residentCommandStatement(input: {
  channel?: string | null;
  status?: string | null;
  command?: unknown;
  safeError?: string | null;
  confirmationStatus?: string | null;
  physicalEffectStatus?: string | null;
}) {
  const channel = text(input.channel);
  const target = channel ? channel.replace(/^switch_/i, "Channel ") : "Device";
  const direction = humanCommandDirection(input.command);
  const status = text(input.status).toLowerCase();
  const confirmation = text(input.confirmationStatus).toLowerCase();
  const physical = text(input.physicalEffectStatus).toLowerCase();
  const prefix = direction ? `${target} ${direction}` : `${target} command`;
  if (confirmation === "not_observable" || physical === "unknown" || physical === "not_observable") return `${prefix} was accepted by the controller; Oyi cannot directly observe the physical response.`;
  if (/state_confirmed|executed|confirmed/.test(status)) return `${prefix} was confirmed.`;
  if (/provider_rejected|failed|state_mismatch|confirmation_timed_out|timeout/.test(status)) {
    return `${prefix} did not complete${input.safeError ? `: ${input.safeError}` : ""}.`;
  }
  if (/accepted|dispatching|awaiting/.test(status)) return `${prefix} was sent and is waiting for confirmation.`;
  return `${prefix} was recorded.`;
}

export function dedupeIntelligenceFacts(facts: IntelligenceFact[]) {
  const seen = new Set<string>();
  const result: IntelligenceFact[] = [];
  for (const fact of facts) {
    const key = [
      fact.domain,
      fact.object?.canonical_id || "scope",
      fact.fact_type,
      JSON.stringify(fact.value),
      fact.source_id || "",
      fact.occurred_at ? fact.occurred_at.slice(0, 16) : "",
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(fact);
  }
  return result;
}

export function internalEventReason(value: unknown) {
  const haystack = typeof value === "string" ? value : JSON.stringify(value || {});
  if (/\bproximity\.(?:awareness\.checked|awareness_evaluated)\b/i.test(haystack)) return "proximity_awareness";
  if (/\baudit\.recorded\b/i.test(haystack)) return "audit_recorded";
  if (/\b(?:ai|oyi)\.(?:response\.generated|tool\.(?:requested|executed)|command\.received|system\.signal\.received)\b/i.test(haystack)) return "oyi_internal_lifecycle";
  if (/\b(?:tool\.(?:requested|executed)|response\.generated|command\.received)\b/i.test(haystack)) return "runtime_internal_lifecycle";
  if (/\bproximity alone\b|\bsuspicious access\b/i.test(haystack)) return "internal_reasoning";
  if (/\bsystem event\b/i.test(haystack)) return "generic_system_event";
  return null;
}

export function isResidentVisibleOperationalFact(fact: IntelligenceFact) {
  const reason = internalEventReason({
    statement: fact.statement,
    domain: fact.domain,
    fact_type: fact.fact_type,
    value: fact.value,
    source_id: fact.source_id,
    evidence: fact.evidence,
  });
  if (!reason) return true;
  logger.info("conversation_internal_event_suppressed", {
    reason,
    fact_id: fact.fact_id,
    source_type: fact.source_type,
    source_id: fact.source_id,
    domain: fact.domain,
  });
  return false;
}

export function truthFromFreshness(freshness: unknown, source?: unknown): IntelligenceFact["truth_state"] {
  const value = text(freshness).toLowerCase();
  const sourceText = text(source).toLowerCase();
  if (sourceText === "validated_visible_state") return "inferred";
  if (value === "fresh") return "confirmed";
  if (["stale", "ageing", "cached", "last_confirmed"].includes(value)) return "observed";
  if (["expired", "unknown", "unavailable", "provider_disconnected"].includes(value)) return "unavailable";
  return value ? "observed" : "unavailable";
}

export function factFromOperationalObject(
  object: OperationalObject,
  hydrationFacts: Record<string, unknown>,
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  options: { objectStateLine?: (object: OperationalObject) => string } = {},
): IntelligenceFact {
  const scope = conversationScope(input, oisContext);
  const stateFacts = recordOf(hydrationFacts.state);
  const truth = truthFromFreshness(object.freshness, recordOf(object.metadata).source);
  const statement = options.objectStateLine ? options.objectStateLine(object) : `${object.label} is ${human(object.current_state || "unknown")}.`;
  return {
    fact_id: `object_state:${object.object_type}:${object.canonical_id}:${object.freshness || "unknown"}`,
    domain: object.object_type === "device" || object.object_type === "device_channel" ? "devices" : object.source_module || object.object_type,
    fact_type: "current_state",
    scope,
    object: { object_type: object.object_type, canonical_id: object.canonical_id, label: object.label },
    statement,
    value: {
      state: object.current_state,
      health: object.health,
      provider_health: stateFacts.provider_health || recordOf(object.metadata).provider_health || null,
      freshness: object.freshness,
    },
    previous_value: null,
    occurred_at: object.freshness,
    observed_at: new Date().toISOString(),
    source_type: "live_state",
    source_id: object.evidence_references[0] || null,
    truth_state: truth,
    confidence: truth === "confirmed" ? 0.9 : truth === "observed" ? 0.74 : 0.54,
    freshness: object.freshness || "unknown",
    privacy_class: object.home_id ? "resident_device_private" : "building_operational",
    permissions: object.permissions || [],
    evidence: [{ type: "hydration", facts: hydrationFacts }],
  };
}

export async function loadHomeDeviceInventoryFacts(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  const scope = conversationScope(input, oisContext);
  if (!scope.home_id) return [];
  try {
    const { data: devices, error: deviceError } = await supabaseAdmin
      .from("devices")
      .select("id,name,estate_id,home_id,room_id,parent_device_id,is_virtual,category,type,online,status,capabilities,metadata,last_seen_at,updated_at")
      .eq("home_id", scope.home_id)
      .limit(100);
    if (deviceError) throw deviceError;
    const ids = (devices || []).map((device: any) => String(device.id)).filter(Boolean);
    const roomIds = Array.from(new Set((devices || []).map((device: any) => text(device.room_id)).filter(Boolean)));
    const rooms = roomIds.length
      ? await supabaseAdmin.from("rooms").select("id,name").in("id", roomIds)
      : { data: [], error: null };
    if (rooms.error) logger.warn("conversation_home_room_names_load_failed", { error: rooms.error, home_id: scope.home_id });
    const roomById = new Map((rooms.data || []).map((row: any) => [String(row.id), cleanLabel(row.name, "")]));
    const states = ids.length
      ? await supabaseAdmin.from("device_states").select("device_id,status,last_seen,updated_at").in("device_id", ids)
      : { data: [], error: null };
    if (states.error) throw states.error;
    const stateByDevice = new Map((states.data || []).map((row: any) => [String(row.device_id), row]));
    return (devices || [])
      .filter((device: any) => !scope.room_id || String(device.room_id || "") === String(scope.room_id))
      .map((device: any): IntelligenceFact => {
        const stateRow = stateByDevice.get(String(device.id)) as Record<string, unknown> | undefined;
        const status = recordOf(stateRow?.status || device.status);
        const normalized = recordOf(status.normalized_state);
        const onlineValue = status.online ?? normalized.online ?? device.online;
        const observedAt = stateRow?.last_seen || stateRow?.updated_at || device.last_seen_at || device.updated_at || null;
        const freshness = deviceFreshnessFromTimestamp(observedAt);
        const providerHealth = status.provider_health || normalized.provider_health || recordOf(device.metadata).provider_health;
        const availability = canonicalDeviceAvailabilityStatus({ online: onlineValue, freshness: freshness.freshness, providerHealth });
        const label = cleanLabel(device.name, "Device");
        const roomName = roomById.get(String(device.room_id)) || text(recordOf(device.metadata).room_name || recordOf(device.metadata).roomName) || null;
        return {
          fact_id: `home-device:${device.id}`,
          domain: "devices",
          fact_type: "device_availability",
          scope: { estate_id: device.estate_id || scope.estate_id, home_id: device.home_id || scope.home_id, room_id: device.room_id || null },
          object: { object_type: "device", canonical_id: String(device.id), label },
          statement: `${label}: ${availability.replace(/_/g, " ")}.`,
          value: {
            availability,
            online: onlineValue ?? null,
            category: device.category || null,
            type: device.type || null,
            is_virtual: Boolean(device.is_virtual),
            parent_device_id: device.parent_device_id || null,
            parent_device_name: recordOf(device.metadata).parent_device_name || recordOf(device.metadata).parentDeviceName || null,
            device_family: device.category || device.type || "device",
            room_name: roomName,
            provider_health: providerHealth || null,
            freshness: freshness.freshness,
            age_ms: freshness.age_ms,
          },
          previous_value: null,
          occurred_at: observedAt ? String(observedAt) : null,
          observed_at: new Date().toISOString(),
          source_type: "database",
          source_id: String(device.id),
          truth_state: freshness.truth_state,
          confidence: freshness.freshness === "fresh" ? 0.86 : freshness.freshness === "stale" ? 0.68 : 0.48,
          freshness: freshness.freshness,
          privacy_class: "resident_device_private",
          permissions: ["read"],
          evidence: [{ source: "device_states", device_id: String(device.id), observed_at: observedAt, freshness: freshness.freshness }],
        };
      });
  } catch (error) {
    logger.warn("conversation_home_device_inventory_load_failed", { error, home_id: scope.home_id, estate_id: scope.estate_id });
    return [];
  }
}

export async function loadRecentDeviceChangeFacts(
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  contract: IntelligenceRequestContract,
  object: OperationalObject | null,
) {
  const scope = conversationScope(input, oisContext);
  const fromIso = contract.temporal_scope.from || new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const facts: IntelligenceFact[] = [];
  const executionSelect = "id,device_id,home_id,estate_id,action,execution_status,result_summary,requested_at,completed_at,error_message,metadata,verified,verification_method";
  try {
    let q = supabaseAdmin.from("ai_execution_ledger").select(executionSelect).gte("requested_at", fromIso).order("requested_at", { ascending: false }).limit(25);
    if (object?.canonical_id && (object.object_type === "device" || object.object_type === "device_channel")) q = q.eq("device_id", object.object_type === "device_channel" ? object.parent_id || object.canonical_id.split(":")[0] : object.canonical_id);
    else if (scope.home_id) q = q.eq("home_id", scope.home_id);
    else if (scope.estate_id) q = q.eq("estate_id", scope.estate_id);
    const { data, error } = await q;
    if (error) throw error;
    const executionDeviceIds = Array.from(new Set((Array.isArray(data) ? data : []).map((row: any) => text(row.device_id)).filter(Boolean)));
    const executionDevices = executionDeviceIds.length
      ? await supabaseAdmin.from("devices").select("id,name,room_id,category,type,metadata").in("id", executionDeviceIds)
      : { data: [], error: null };
    if (executionDevices.error) logger.warn("conversation_recent_changes_device_names_load_failed", { error: executionDevices.error, home_id: scope.home_id });
    const executionRoomIds = Array.from(new Set((executionDevices.data || []).map((row: any) => text(row.room_id)).filter(Boolean)));
    const executionRooms = executionRoomIds.length
      ? await supabaseAdmin.from("rooms").select("id,name").in("id", executionRoomIds)
      : { data: [], error: null };
    if (executionRooms.error) logger.warn("conversation_recent_changes_room_names_load_failed", { error: executionRooms.error, home_id: scope.home_id });
    const roomNameById = new Map((executionRooms.data || []).map((row: any) => [String(row.id), cleanLabel(row.name, "")]));
    const deviceById = new Map((executionDevices.data || []).map((row: any) => [String(row.id), row]));
    for (const row of Array.isArray(data) ? data : []) {
      const result = recordOf(recordOf(row.metadata).result);
      const deviceInfo = deviceById.get(String(row.device_id)) as Record<string, unknown> | undefined;
      const roomId = text(result.room_id || deviceInfo?.room_id || scope.room_id) || null;
      if (contract.scope_mode === "room_scope" && scope.room_id && roomId !== scope.room_id) {
        logger.info("conversation_room_evidence_filtered", {
          reason: "execution_room_mismatch",
          requested_room_id: scope.room_id,
          fact_room_id: roomId,
          source_id: row.id,
        });
        continue;
      }
      const roomName = roomId ? roomNameById.get(roomId) || text(recordOf(deviceInfo?.metadata).room_name || recordOf(deviceInfo?.metadata).roomName) || null : null;
      const channel = text(result.channel_code);
      if (object?.object_type === "device_channel" && contract.target.channel_code && channel && channel !== contract.target.channel_code) continue;
      const finalStatus = text(result.final_status || result.confirmation_status || row.execution_status);
      const label = text(result.device_name || deviceInfo?.name) || "Device command";
      const confirmed = /state_confirmed|executed/i.test(finalStatus) || row.verified;
      const commandValue = result.normalized_command || result.expected_state || null;
      const statement = residentCommandStatement({
        channel,
        status: finalStatus,
        command: commandValue,
        safeError: text(result.safe_error_message || row.error_message) || null,
        confirmationStatus: text(result.confirmation_status) || null,
        physicalEffectStatus: text(result.physical_effect_status) || null,
      });
      facts.push({
        fact_id: `execution:${row.id}`,
        domain: "devices",
        fact_type: "command_execution",
        scope: { estate_id: row.estate_id || scope.estate_id, home_id: row.home_id || scope.home_id, room_id: roomId },
        object: { object_type: channel ? "device_channel" : "device", canonical_id: channel ? `${row.device_id}:${channel}` : String(row.device_id || ""), label: channel ? `${label} ${channel}` : label },
        statement,
        value: { status: finalStatus, command: commandValue, channel_code: channel || null, safe_error_message: text(result.safe_error_message || row.error_message) || null, room_name: roomName, device_family: text(deviceInfo?.category || deviceInfo?.type || result.device_family) || null },
        previous_value: result.previous_state || null,
        occurred_at: row.completed_at || row.requested_at || null,
        observed_at: new Date().toISOString(),
        source_type: "execution_ledger",
        source_id: String(row.id),
        truth_state: confirmed ? "confirmed" : "observed",
        confidence: confirmed ? 0.94 : 0.8,
        freshness: row.completed_at || row.requested_at || "unknown",
        privacy_class: row.home_id ? "resident_device_private" : "building_operational",
        permissions: [],
        evidence: [{ type: "execution_ledger", id: row.id, verification_method: row.verification_method || null, error: row.error_message || null }],
      });
    }
  } catch (error) {
    logger.warn("conversation_recent_changes_execution_load_failed", { error, home_id: scope.home_id, estate_id: scope.estate_id });
  }
  try {
    let q = supabaseAdmin.from("audit_events").select("id,action,resource_type,resource_id,estate_id,metadata,status,created_at").gte("created_at", fromIso).order("created_at", { ascending: false }).limit(20);
    if (scope.estate_id) q = q.eq("estate_id", scope.estate_id);
    const { data, error } = await q;
    if (error) throw error;
    for (const row of Array.isArray(data) ? data : []) {
      const metadata = recordOf(row.metadata);
      const privacy = text(metadata.privacy_class);
      const hiddenReason = internalEventReason({ action: row.action, metadata, resource_type: row.resource_type });
      const auditOnly = /^device\./.test(text(row.action)) || Boolean(hiddenReason);
      if (auditOnly) {
        if (hiddenReason) logger.info("conversation_internal_event_suppressed", { reason: hiddenReason, source_type: "audit", source_id: row.id, domain: row.resource_type });
        continue;
      }
      if (scope.home_id && text(metadata.home_id) && text(metadata.home_id) !== scope.home_id) continue;
      facts.push({
        fact_id: `audit:${row.id}`,
        domain: text(row.resource_type) || "operations",
        fact_type: "audit_change",
        scope: { estate_id: row.estate_id || scope.estate_id, home_id: text(metadata.home_id) || scope.home_id, room_id: text(metadata.room_id) || null },
        object: row.resource_id ? { object_type: text(row.resource_type) || "record", canonical_id: String(row.resource_id), label: text(metadata.object_name || row.resource_type || row.action) || "Record" } : null,
        statement: `${human(row.action)} was recorded at ${safeDateLabel(row.created_at)}.`,
        value: { action: row.action, status: row.status },
        previous_value: null,
        occurred_at: row.created_at || null,
        observed_at: new Date().toISOString(),
        source_type: "audit",
        source_id: String(row.id),
        truth_state: "observed",
        confidence: 0.75,
        freshness: row.created_at || "unknown",
        privacy_class: privacy || "home_private",
        permissions: [],
        evidence: [{ type: "audit_events", id: row.id }],
      });
    }
  } catch (error) {
    logger.warn("conversation_recent_changes_audit_load_failed", { error, home_id: scope.home_id, estate_id: scope.estate_id });
  }
  const recentExecutions = Array.isArray(input.recent_executions) ? input.recent_executions : Array.isArray(recordOf(recordOf(object?.relationships).recent_executions)) ? recordOf(object?.relationships).recent_executions as any[] : [];
  for (const row of recentExecutions.map(recordOf).slice(0, 8)) {
    const summary = text(row.summary || row.result_summary || row.status);
    if (!summary) continue;
    const hiddenReason = internalEventReason({ summary, row });
    if (hiddenReason) {
      logger.info("conversation_internal_event_suppressed", { reason: hiddenReason, source_type: "visible_recent_execution", source_id: text(row.id || row.command_execution_id) || null, domain: "devices" });
      continue;
    }
    facts.push({
      fact_id: `visible_execution:${row.id || row.command_execution_id || summary}`,
      domain: "devices",
      fact_type: "command_execution",
      scope,
      object: object ? { object_type: object.object_type, canonical_id: object.canonical_id, label: object.label } : null,
      statement: summary,
      value: row,
      previous_value: null,
      occurred_at: text(row.completed_at || row.requested_at || row.created_at) || null,
      observed_at: new Date().toISOString(),
      source_type: "execution_ledger",
      source_id: text(row.id || row.command_execution_id) || null,
      truth_state: "observed",
      confidence: 0.78,
      freshness: text(row.completed_at || row.requested_at || row.created_at) || "unknown",
      privacy_class: object?.home_id ? "resident_device_private" : "building_operational",
      permissions: [],
      evidence: [{ type: "visible_recent_execution" }],
    });
  }
  const deduped = dedupeIntelligenceFacts(facts.filter(isResidentVisibleOperationalFact)).sort((a, b) => Date.parse(b.occurred_at || b.observed_at) - Date.parse(a.occurred_at || a.observed_at));
  logger.info("conversation_fact_deduplicated", {
    source_count: facts.length,
    final_fact_count: deduped.length,
    grouping_keys: ["domain", "object", "fact_type", "value_transition", "source_id", "timestamp_window"],
  });
  return deduped;
}

export async function loadLatestCommandFact(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined, object: OperationalObject | null) {
  const scope = conversationScope(input, oisContext);
  try {
    let q = supabaseAdmin.from("ai_execution_ledger").select("id,device_id,home_id,estate_id,action,execution_status,result_summary,requested_at,completed_at,error_message,metadata,verified,verification_method").order("requested_at", { ascending: false }).limit(1);
    if (object?.canonical_id && (object.object_type === "device" || object.object_type === "device_channel")) q = q.eq("device_id", object.object_type === "device_channel" ? object.parent_id || object.canonical_id.split(":")[0] : object.canonical_id);
    else if (scope.home_id) q = q.eq("home_id", scope.home_id);
    else if (scope.estate_id) q = q.eq("estate_id", scope.estate_id);
    const { data, error } = await q;
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return null;
    const result = recordOf(recordOf(row.metadata).result);
    const channel = text(result.channel_code);
    if (object?.object_type === "device_channel" && text(recordOf(object.metadata).channel_code) && channel && channel !== text(recordOf(object.metadata).channel_code)) return null;
    const status = text(result.final_status || result.confirmation_status || row.execution_status);
    const safeError = text(result.safe_error_message || row.error_message);
    return {
      id: String(row.id),
      device_id: text(row.device_id),
      channel_code: channel || null,
      status,
      provider_status: text(result.provider_status) || null,
      confirmation_status: text(result.confirmation_status) || null,
      physical_effect_status: text(result.physical_effect_status) || null,
      requested_at: row.requested_at || null,
      completed_at: row.completed_at || null,
      safe_error_message: safeError || null,
      verified: Boolean(row.verified),
      expected_state: result.expected_state || null,
      observed_state: result.observed_state || null,
    };
  } catch (error) {
    logger.warn("conversation_latest_command_load_failed", { error, home_id: scope.home_id, estate_id: scope.estate_id });
    return null;
  }
}
