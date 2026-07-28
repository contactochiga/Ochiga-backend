import type { AuthUser } from "../../middleware/auth";
import type { OisContext } from "../../types/oisContext";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";
import { hydrateCanonicalDevicePanel } from "../../services/canonicalDevicePanelHydrationService";
import type { OperationalObject, OperationalObjectType, TruthState } from "./canonicalConversationRuntime";
import type { ResolvedConversationTarget } from "./conversationTargetResolver";

export type HydrationStatus =
  | "hydrated"
  | "not_found"
  | "permission_denied"
  | "scope_mismatch"
  | "query_failed"
  | "unavailable"
  | "unsupported";

export type CanonicalHydrationRequest = {
  actor: AuthUser | null;
  oisContext: OisContext | null | undefined;
  target: ResolvedConversationTarget;
  activeContext: Record<string, unknown> | null;
  visibleState: Record<string, unknown> | null;
};

export type CanonicalHydrationResult = {
  status: HydrationStatus;
  object: OperationalObject | null;
  facts: Record<string, unknown>;
  evidence: Array<Record<string, unknown>>;
  freshness: string | null;
  truth_state: Exclude<TruthState, "predicted">;
  source: "canonical_backend" | "runtime_cache" | "persistent_snapshot" | "provider_refresh" | "validated_visible_state" | "none";
  reason: string | null;
  duration_ms: number;
};

type CheckedMaybeSingleResult<T> =
  | { status: "hydrated"; data: T }
  | { status: "not_found"; data: null }
  | { status: "query_failed"; data: null; error_code: string | null; reason: string };

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function sanitizeReason(value: unknown, fallback = "query_failed") {
  const raw = text(value);
  return raw ? raw.slice(0, 180) : fallback;
}

function nowMs() {
  return Date.now();
}

function elapsed(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

function activeScope(request: CanonicalHydrationRequest) {
  const activeScope = recordOf(request.activeContext?.scope);
  return {
    estate_id: text(request.oisContext?.estate_id || activeScope.estate_id) || null,
    home_id: text(request.oisContext?.home_id || activeScope.home_id) || null,
    room_id: text((request.oisContext as any)?.room_id || activeScope.room_id) || null,
  };
}

function baseResult(input: Partial<CanonicalHydrationResult> & Pick<CanonicalHydrationResult, "status">, startedAt: number): CanonicalHydrationResult {
  return {
    status: input.status,
    object: input.object || null,
    facts: input.facts || {},
    evidence: input.evidence || [],
    freshness: input.freshness || null,
    truth_state: input.truth_state || (input.status === "permission_denied" ? "permission_restricted" : input.status === "unsupported" ? "unsupported" : "unavailable"),
    source: input.source || "none",
    reason: input.reason || null,
    duration_ms: input.duration_ms ?? elapsed(startedAt),
  };
}

function safeLogContext(request: CanonicalHydrationRequest) {
  const scope = activeScope(request);
  return {
    request_id: text((request.activeContext as any)?.request_id) || null,
    context_id: text(request.activeContext?.context_id) || null,
    context_version: Number((request.activeContext as any)?.context_version) || null,
    object_type: request.target.objectType || null,
    canonical_id: request.target.objectId || null,
    target_source: request.target.source,
    target_confidence: request.target.confidence,
    estate_id: scope.estate_id,
    home_id: scope.home_id,
    room_id: scope.room_id,
  };
}

export function checkedMaybeSingleOutcomeForTest<T>(input: { data?: T | null; error?: { code?: string | null; message?: string | null } | null }): CheckedMaybeSingleResult<T> {
  if (input.error) {
    return {
      status: "query_failed",
      data: null,
      error_code: input.error.code || null,
      reason: sanitizeReason(input.error.message, "query_failed"),
    };
  }
  if (!input.data) return { status: "not_found", data: null };
  return { status: "hydrated", data: input.data };
}

async function checkedMaybeSingle<T>(table: string, select: string, id: string, objectType: string): Promise<CheckedMaybeSingleResult<T>> {
  const { data, error } = await supabaseAdmin.from(table).select(select).eq("id", id).maybeSingle();
  const outcome = checkedMaybeSingleOutcomeForTest<T>({ data: data as T | null, error: error as any });
  if (outcome.status === "query_failed") {
    logger.warn("canonical_target_hydration_query_failed", {
      table,
      object_type: objectType,
      canonical_id: id,
      error_code: outcome.error_code,
      reason: outcome.reason,
    });
  }
  return outcome;
}

function freshnessTruthState(freshness: unknown): CanonicalHydrationResult["truth_state"] {
  const value = text(freshness).toLowerCase();
  if (["fresh", "live", "confirmed"].includes(value)) return "confirmed";
  if (["stale", "ageing", "cached", "last_confirmed"].includes(value)) return "observed";
  if (["expired", "provider_disconnected", "unavailable", "offline"].includes(value)) return "unavailable";
  return "observed";
}

function canonicalCapabilities(panel: Record<string, unknown>) {
  return Array.from(new Set([
    ...arrayOfStrings(panel.supported_controls),
    ...arrayOfStrings(panel.capability_codes),
    ...arrayOfStrings(recordOf(panel.canonical_presentation).supportedActions),
    ...arrayOfStrings(recordOf(panel.canonical_presentation).executableActions),
  ]));
}

function channelDefinitions(panel: Record<string, unknown>) {
  const direct = Array.isArray(panel.channel_definitions) ? panel.channel_definitions : [];
  const state = recordOf(panel.state);
  const stateChannels = Array.isArray(state.channel_definitions) ? state.channel_definitions : [];
  return (direct.length ? direct : stateChannels).filter((entry) => entry && typeof entry === "object") as Array<Record<string, unknown>>;
}

function channelKeysFromPanel(panel: Record<string, unknown>) {
  const channels = channelDefinitions(panel).map((entry) => text(entry.code || entry.channel_code)).filter(Boolean);
  const normalized = recordOf(panel.normalized_state || recordOf(panel.state).normalized_state);
  const switches = recordOf(normalized.switches);
  return Array.from(new Set([
    ...channels,
    ...Object.keys(switches),
    ...canonicalCapabilities(panel).filter((key) => /^switch_\d+$/i.test(key)),
  ]));
}

function panelToOperationalObject(panel: Record<string, unknown>, device: Record<string, unknown>, source: CanonicalHydrationResult["source"]): OperationalObject {
  const presentation = recordOf(panel.canonical_presentation || panel.presentation);
  const assignment = recordOf(presentation.assignment);
  const classification = recordOf(panel.classification);
  const deviceId = text(panel.device_id || panel.id || device.id);
  return {
    object_type: "device",
    canonical_id: deviceId,
    label: text(panel.name || device.name) || "Device",
    estate_id: text(panel.estate_id || device.estate_id) || null,
    building_id: text(panel.building_id || device.building_id) || null,
    home_id: text(panel.home_id || assignment.homeId || device.home_id) || null,
    room_id: text(panel.room_id || assignment.roomId || device.room_id) || null,
    parent_id: text(panel.parent_device_id || device.parent_device_id) || null,
    source_module: "devices",
    capabilities: canonicalCapabilities(panel),
    current_state: text(panel.primary_state || presentation.summary || recordOf(presentation.primaryState).label) || null,
    health: text(panel.health_status || recordOf(panel.provider_health).status || presentation.availability) || null,
    permissions: [],
    relationships: {
      room_name: text(panel.room_name || assignment.roomName) || null,
      parent_device_id: text(panel.parent_device_id || device.parent_device_id) || null,
      active_scenes: Array.isArray(panel.active_scenes) ? panel.active_scenes : [],
      active_automations: Array.isArray(panel.active_automations) ? panel.active_automations : [],
      recent_executions: Array.isArray(panel.recent_executions) ? panel.recent_executions : [],
      active_incidents: Array.isArray(panel.active_incidents) ? panel.active_incidents : [],
    },
    evidence_references: [`device_runtime_v2:${deviceId}:${source}`],
    metadata: {
      source,
      provider: panel.provider || device.provider || device.vendor || null,
      external_id: panel.external_id || null,
      family: panel.device_family || classification.device_family || null,
      category: panel.category || device.category || null,
      type: panel.type || device.type || null,
      control_profile: panel.control_profile || classification.control_profile || null,
      supported_controls: panel.supported_controls || [],
      capability_codes: panel.capability_codes || [],
      channel_definitions: channelDefinitions(panel),
      provider_health: panel.provider_health || null,
      runtime_timestamp: panel.runtime_timestamp || null,
      provider_timestamp: panel.provider_timestamp || null,
    },
    freshness: text(recordOf(panel.freshness).state || panel.freshness || panel.runtime_freshness || panel.state_confirmed_at || panel.updated_at) || null,
  };
}

export function mapDevicePanelToHydrationForTest(input: { panel: Record<string, unknown>; device?: Record<string, unknown>; source?: CanonicalHydrationResult["source"] }) {
  const object = panelToOperationalObject(input.panel, input.device || {}, input.source || "runtime_cache");
  return {
    object,
    channel_keys: channelKeysFromPanel(input.panel),
    capabilities: object.capabilities,
  };
}

function deviceFacts(panel: Record<string, unknown>, device: Record<string, unknown>, source: CanonicalHydrationResult["source"]) {
  const presentation = recordOf(panel.canonical_presentation || panel.presentation);
  const freshness = text(recordOf(panel.freshness).state || panel.freshness || panel.runtime_freshness || panel.state_confirmed_at || panel.updated_at) || null;
  return {
    identity: {
      canonical_device_id: text(panel.device_id || panel.id || device.id) || null,
      display_name: text(panel.name || device.name) || null,
      room_id: text(panel.room_id || device.room_id) || null,
      room_name: text(panel.room_name || recordOf(presentation.assignment).roomName) || null,
      home_id: text(panel.home_id || device.home_id) || null,
      provider: panel.provider || device.provider || device.vendor || null,
    },
    classification: {
      device_family: panel.device_family || recordOf(panel.classification).device_family || null,
      category: panel.category || device.category || null,
      type: panel.type || device.type || null,
      control_profile: panel.control_profile || recordOf(panel.classification).control_profile || null,
      capabilities: canonicalCapabilities(panel),
      supported_controls: panel.supported_controls || [],
      capability_codes: panel.capability_codes || [],
    },
    state: {
      primary_state: panel.primary_state || recordOf(presentation.primaryState) || null,
      canonical_state: panel.canonical_state || null,
      normalized_state: panel.normalized_state || recordOf(panel.state).normalized_state || null,
      health_status: panel.health_status || null,
      provider_health: panel.provider_health || null,
      availability: presentation.availability || panel.availability || null,
      freshness,
      runtime_timestamp: panel.runtime_timestamp || null,
      provider_timestamp: panel.provider_timestamp || null,
      last_successful_refresh: panel.last_successful_provider_contact_at || panel.last_refresh || null,
      provider_warning: panel.provider_warning || panel.last_provider_error_classification || null,
    },
    channels: {
      channel_definitions: channelDefinitions(panel),
      channel_keys: channelKeysFromPanel(panel),
      switch_states: recordOf(recordOf(panel.normalized_state || recordOf(panel.state).normalized_state).switches),
    },
    relationships: {
      active_scenes: Array.isArray(panel.active_scenes) ? panel.active_scenes : [],
      active_automations: Array.isArray(panel.active_automations) ? panel.active_automations : [],
      recent_executions: Array.isArray(panel.recent_executions) ? panel.recent_executions : [],
      active_incidents: Array.isArray(panel.active_incidents) ? panel.active_incidents : [],
    },
    evidence_summary: { source, freshness },
  };
}

function parseDeviceChannelTarget(canonicalId: string) {
  const value = text(canonicalId);
  const idx = value.lastIndexOf(":");
  if (idx <= 0 || idx >= value.length - 1) return { parent_device_id: value, channel_code: "" };
  return {
    parent_device_id: value.slice(0, idx),
    channel_code: value.slice(idx + 1),
  };
}

export function parseDeviceChannelTargetForTest(canonicalId: string) {
  return parseDeviceChannelTarget(canonicalId);
}

async function loadCanonicalDeviceFacts(request: CanonicalHydrationRequest, deviceId: string, startedAt: number): Promise<CanonicalHydrationResult> {
  const scope = activeScope(request);
  const hydration = await hydrateCanonicalDevicePanel({
    deviceId,
    estateId: scope.estate_id,
    homeId: scope.home_id,
    includeIntelligence: true,
    includeTimeline: false,
  });
  if (hydration.status !== "hydrated") {
    return visibleStateFallback(request, startedAt, hydration.status, hydration.reason);
  }
  const object = panelToOperationalObject(hydration.panel, hydration.device, hydration.source);
  const facts = deviceFacts(hydration.panel, hydration.device, hydration.source);
  return baseResult({
    status: "hydrated",
    object,
    facts,
    evidence: [{
      type: "device_runtime_v2_snapshot",
      source: hydration.source,
      canonical_device_id: object.canonical_id,
      runtime_timestamp: hydration.panel.runtime_timestamp || null,
      provider_timestamp: hydration.panel.provider_timestamp || null,
      freshness: object.freshness,
    }],
    freshness: object.freshness,
    truth_state: freshnessTruthState(object.freshness),
    source: hydration.source,
  }, startedAt);
}

async function loadCanonicalDeviceChannelFacts(request: CanonicalHydrationRequest, canonicalId: string, startedAt: number): Promise<CanonicalHydrationResult> {
  const parsed = parseDeviceChannelTarget(canonicalId);
  if (!parsed.parent_device_id || !parsed.channel_code) {
    return baseResult({ status: "unsupported", reason: "invalid_device_channel_target", truth_state: "unsupported" }, startedAt);
  }
  const parentResult = await loadCanonicalDeviceFacts({
    ...request,
    target: { ...request.target, objectType: "device", objectId: parsed.parent_device_id },
  }, parsed.parent_device_id, startedAt);
  if (parentResult.status !== "hydrated" || !parentResult.object) return parentResult;
  const channelKeys = arrayOfStrings(recordOf(parentResult.facts.channels).channel_keys);
  if (!channelKeys.includes(parsed.channel_code)) {
    return visibleStateFallback(request, startedAt, "unsupported", "device_channel_not_exposed");
  }
  const channels = Array.isArray(recordOf(parentResult.facts.channels).channel_definitions)
    ? recordOf(parentResult.facts.channels).channel_definitions as Array<Record<string, unknown>>
    : [];
  const selectedChannel = channels.find((entry) => text(entry.code || entry.channel_code) === parsed.channel_code) || null;
  const selectedState = Object.prototype.hasOwnProperty.call(recordOf(recordOf(parentResult.facts.channels).switch_states), parsed.channel_code)
    ? recordOf(recordOf(parentResult.facts.channels).switch_states)[parsed.channel_code]
    : null;
  const channelObject: OperationalObject = {
    ...parentResult.object,
    object_type: "device_channel",
    canonical_id: `${parsed.parent_device_id}:${parsed.channel_code}`,
    label: text(selectedChannel?.name || selectedChannel?.label) || `${parentResult.object.label} · ${parsed.channel_code}`,
    parent_id: parsed.parent_device_id,
    capabilities: [parsed.channel_code, ...parentResult.object.capabilities],
    current_state: typeof selectedState === "boolean" ? (selectedState ? "on" : "off") : text(selectedState) || parentResult.object.current_state,
    relationships: {
      ...parentResult.object.relationships,
      parent_device_id: parsed.parent_device_id,
      channel_code: parsed.channel_code,
      selected_channel: selectedChannel,
    },
    metadata: {
      ...parentResult.object.metadata,
      selected_channel: selectedChannel,
      channel_code: parsed.channel_code,
      parent_device_id: parsed.parent_device_id,
    },
  };
  return baseResult({
    status: "hydrated",
    object: channelObject,
    facts: {
      ...parentResult.facts,
      selected_channel: {
        parent_device_id: parsed.parent_device_id,
        channel_code: parsed.channel_code,
        channel: selectedChannel,
        state: selectedState,
      },
    },
    evidence: parentResult.evidence,
    freshness: parentResult.freshness,
    truth_state: parentResult.truth_state,
    source: parentResult.source,
  }, startedAt);
}

function visibleStateTargetIds(request: CanonicalHydrationRequest) {
  const visible = recordOf(request.visibleState);
  const summary = recordOf(visible.summary);
  return {
    object_id: text(visible.object_id || summary.object_id || summary.canonical_device_id || summary.device_id),
    parent_device_id: text(visible.parent_device_id || summary.parent_device_id || summary.device_id),
    home_id: text(visible.home_id || summary.home_id),
    source: text(visible.source || summary.source),
    fetched_at: text(visible.fetched_at || summary.fetched_at),
  };
}

function visibleStateFallback(request: CanonicalHydrationRequest, startedAt: number, previousStatus: HydrationStatus, previousReason: string | null): CanonicalHydrationResult {
  const visible = recordOf(request.visibleState);
  const summary = recordOf(visible.summary);
  const source = text(visible.source || summary.source);
  const targetType = text(request.target.objectType);
  const targetId = text(request.target.objectId);
  const scope = activeScope(request);
  const ids = visibleStateTargetIds(request);
  const fetchedAtMs = Date.parse(ids.fetched_at || text(visible.data_version));
  const ageMs = Number.isFinite(fetchedAtMs) ? nowMs() - fetchedAtMs : Number.POSITIVE_INFINITY;
  const isDeviceChannel = targetType === "device_channel";
  const parsed = isDeviceChannel ? parseDeviceChannelTarget(targetId) : null;
  const expectedId = isDeviceChannel ? parsed?.parent_device_id : targetId;
  const visibleObjectId = isDeviceChannel ? (ids.parent_device_id || ids.object_id.split(":")[0]) : ids.object_id;
  const sourceOk = source === "device_runtime_v2";
  const idOk = Boolean(expectedId && visibleObjectId && expectedId === visibleObjectId);
  const homeOk = !scope.home_id || !ids.home_id || ids.home_id === scope.home_id;
  const ageOk = ageMs <= 5 * 60 * 1000;
  if (!sourceOk || !idOk || !homeOk || !ageOk) {
    logger.info("conversation_inventory_fallback_blocked", {
      target_id: targetId || null,
      targeted_intent: request.target.source,
      reason: !sourceOk ? "visible_state_not_runtime_v2" : !idOk ? "visible_state_target_mismatch" : !homeOk ? "visible_state_home_mismatch" : "visible_state_expired",
    });
    return baseResult({ status: previousStatus, reason: previousReason || previousStatus }, startedAt);
  }
  const channelDefinitions = Array.isArray(summary.channel_definitions) ? summary.channel_definitions as Array<Record<string, unknown>> : [];
  const channelKeys = Array.from(new Set([
    ...channelDefinitions.map((entry) => text(entry.code || entry.channel_code)).filter(Boolean),
    ...arrayOfStrings(summary.capability_codes).filter((key) => /^switch_\d+$/i.test(key)),
  ]));
  if (isDeviceChannel && parsed?.channel_code && !channelKeys.includes(parsed.channel_code)) {
    return baseResult({ status: "unsupported", reason: "visible_state_channel_not_exposed", truth_state: "unsupported" }, startedAt);
  }
  const label = text(isDeviceChannel ? request.target.objectName : recordOf(request.activeContext?.primary_object).label) || text(summary.name || summary.display_name) || "Device";
  const object: OperationalObject = {
    object_type: isDeviceChannel ? "device_channel" : "device",
    canonical_id: targetId,
    label,
    estate_id: scope.estate_id,
    building_id: null,
    home_id: scope.home_id,
    room_id: scope.room_id,
    parent_id: isDeviceChannel ? parsed?.parent_device_id || null : null,
    source_module: "devices",
    capabilities: Array.from(new Set([...arrayOfStrings(summary.supported_controls), ...arrayOfStrings(summary.capability_codes), ...(isDeviceChannel && parsed?.channel_code ? [parsed.channel_code] : [])])),
    current_state: text(isDeviceChannel ? recordOf(summary.channel_states)[parsed?.channel_code || ""] : visible.current_state) || null,
    health: text(visible.health || summary.health || summary.health_status) || null,
    permissions: [],
    relationships: {
      channel_definitions: channelDefinitions,
      selected_channel: isDeviceChannel ? parsed : null,
    },
    evidence_references: [`visible_state:${targetId}`],
    metadata: summary,
    freshness: text(visible.freshness || summary.freshness) || null,
  };
  logger.info("conversation_visible_state_fallback_used", {
    object_type: targetType,
    canonical_id: targetId,
    snapshot_age_ms: Math.max(0, ageMs),
    freshness: object.freshness,
  });
  return baseResult({
    status: "hydrated",
    object,
    facts: {
      identity: { canonical_device_id: isDeviceChannel ? parsed?.parent_device_id : targetId, display_name: label, home_id: scope.home_id },
      state: { current_state: object.current_state, health: object.health, freshness: object.freshness },
      channels: { channel_definitions: channelDefinitions, channel_keys: channelKeys },
      selected_channel: isDeviceChannel ? { channel_code: parsed?.channel_code, state: object.current_state } : null,
      visible_state_source: "device_runtime_v2",
    },
    evidence: [{ type: "validated_visible_state", object_id: targetId, fetched_at: ids.fetched_at, freshness: object.freshness }],
    freshness: object.freshness,
    truth_state: object.freshness && text(object.freshness).toLowerCase() === "fresh" ? "observed" : "inferred",
    source: "validated_visible_state",
  }, startedAt);
}

async function genericExactLoader(request: CanonicalHydrationRequest, startedAt: number): Promise<CanonicalHydrationResult> {
  const type = text(request.target.objectType) as OperationalObjectType;
  const id = text(request.target.objectId);
  const scope = activeScope(request);
  const config: Partial<Record<OperationalObjectType, { table: string; select: string; label: string; module: string }>> = {
    room: { table: "rooms", select: "id,name,home_id,updated_at", label: "Room", module: "spaces" },
    scene: { table: "consumer_scenes", select: "id,name,estate_id,home_id,enabled,updated_at,actions", label: "Scene", module: "scenes" },
    automation: { table: "consumer_automations", select: "id,name,estate_id,home_id,enabled,next_run_at,last_run_status,updated_at,actions,trigger", label: "Automation", module: "automations" },
    maintenance_request: { table: "maintenance_requests", select: "id,title,estate_id,home_id,status,assigned_to,updated_at", label: "Maintenance request", module: "maintenance" },
    transaction: { table: "wallet_transactions", select: "id,wallet_id,status,reference,created_at,amount,currency", label: "Transaction", module: "wallet" },
    visitor: { table: "visitors", select: "id,name,estate_id,home_id,status,updated_at", label: "Visitor", module: "visitors" },
    access_pass: { table: "visitor_access", select: "id,visitor_name,estate_id,home_id,status,updated_at,purpose,expires_at", label: "Access pass", module: "visitors" },
    service_account: { table: "home_service_accounts", select: "id,estate_id,home_id,service_key,provider,status,account_ref,meter_id,updated_at", label: "Service account", module: "services" },
    community_post: { table: "community_posts", select: "id,title,estate_id,updated_at", label: "Community post", module: "community" },
    notification: { table: "notifications", select: "id,title,body,user_id,estate_id,home_id,read,created_at,metadata", label: "Notification", module: "notifications" },
    operational_incident: { table: "operational_incidents", select: "id,title,estate_id,home_id,status,severity,updated_at,current_summary", label: "Incident", module: "incidents" },
    infrastructure_asset: { table: "facility_assets", select: "id,name,estate_id,building_id,status,health_status,updated_at,metadata", label: "Infrastructure asset", module: "infrastructure" },
    camera: { table: "facility_cameras", select: "id,name,estate_id,room_id,status,health_status,updated_at,dvr_id", label: "Camera", module: "cameras" },
    meter: { table: "utility_meters", select: "id,name,estate_id,home_id,status,updated_at,metadata", label: "Meter", module: "meters" },
    wallet: { table: "wallets", select: "id,user_id,currency,is_frozen,updated_at", label: "Wallet", module: "wallet" },
  };
  const item = config[type];
  if (!item || !id) return baseResult({ status: "unsupported", reason: "unsupported_target_type", truth_state: "unsupported" }, startedAt);
  const outcome = await checkedMaybeSingle<Record<string, unknown>>(item.table, item.select, id, type);
  if (outcome.status !== "hydrated") return baseResult({ status: outcome.status, reason: outcome.status === "query_failed" ? outcome.reason : "target_not_found", source: "none" }, startedAt);
  const row = outcome.data;
  const rowHome = text(row.home_id);
  const rowEstate = text(row.estate_id);
  if (scope.home_id && rowHome && rowHome !== scope.home_id) return baseResult({ status: "scope_mismatch", reason: "target_outside_active_home" }, startedAt);
  if (scope.estate_id && rowEstate && rowEstate !== scope.estate_id) return baseResult({ status: "scope_mismatch", reason: "target_outside_active_estate" }, startedAt);
  const label = text(row.name || row.title || row.visitor_name || row.service_key || row.reference) || item.label;
  const object: OperationalObject = {
    object_type: type,
    canonical_id: id,
    label,
    estate_id: rowEstate || scope.estate_id,
    building_id: text(row.building_id) || null,
    home_id: rowHome || scope.home_id,
    room_id: text(row.room_id) || null,
    parent_id: text(row.home_id || row.estate_id || row.wallet_id || row.user_id) || null,
    source_module: item.module,
    capabilities: ["inspect"],
    current_state: text(row.status || row.last_run_status || (row.enabled === false ? "paused" : row.enabled === true ? "enabled" : null)) || null,
    health: text(row.health_status || row.severity) || null,
    permissions: [],
    relationships: {},
    evidence_references: [`canonical_backend:${item.table}:${id}`],
    metadata: row,
    freshness: text(row.updated_at || row.created_at) || null,
  };
  return baseResult({
    status: "hydrated",
    object,
    facts: { record: row, source_table: item.table },
    evidence: [{ type: "canonical_backend_record", table: item.table, id }],
    freshness: object.freshness,
    truth_state: "observed",
    source: "canonical_backend",
  }, startedAt);
}

export async function hydrateCanonicalTarget(request: CanonicalHydrationRequest): Promise<CanonicalHydrationResult> {
  const startedAt = nowMs();
  const targetType = text(request.target.objectType);
  const targetId = text(request.target.objectId);
  logger.info("conversation_target_hydration_started", {
    ...safeLogContext(request),
    loader: targetType || "none",
  });
  let result: CanonicalHydrationResult;
  if (!targetType || !targetId || request.target.ambiguous) {
    result = baseResult({ status: "unavailable", reason: request.target.clarificationQuestion || "target_ambiguous" }, startedAt);
  } else if (targetType === "device") {
    result = await loadCanonicalDeviceFacts(request, targetId, startedAt);
  } else if (targetType === "device_channel") {
    result = await loadCanonicalDeviceChannelFacts(request, targetId, startedAt);
  } else {
    result = await genericExactLoader(request, startedAt);
  }
  if (result.status === "hydrated") {
    logger.info("conversation_target_hydrated", {
      ...safeLogContext(request),
      loader: targetType,
      source: result.source,
      freshness: result.freshness,
      truth_state: result.truth_state,
      duration_ms: result.duration_ms,
    });
  } else {
    logger.info("conversation_target_hydration_failed", {
      ...safeLogContext(request),
      loader: targetType,
      status: result.status,
      reason: result.reason,
      duration_ms: result.duration_ms,
    });
  }
  return result;
}

export function validateVisibleStateFallbackForTest(input: {
  target: Pick<ResolvedConversationTarget, "objectType" | "objectId" | "source" | "confidence" | "ambiguous" | "objectName">;
  visibleState: Record<string, unknown>;
  homeId?: string | null;
}) {
  return visibleStateFallback({
    actor: null,
    oisContext: { home_id: input.homeId || null, estate_id: null } as any,
    target: {
      clarificationQuestion: null,
      ...input.target,
      objectName: input.target.objectName || null,
    } as ResolvedConversationTarget,
    activeContext: { scope: { home_id: input.homeId || null } },
    visibleState: input.visibleState,
  }, nowMs(), "not_found", "test_previous_failure");
}
