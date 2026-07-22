import type { AuthUser } from "../middleware/auth";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { hasWatchScope } from "./watchPolicy";
import {
  isTechnicalDeviceHiddenFromResidents,
  resolveCanonicalIrChildForProviderRemote,
} from "./deviceInventoryVisibility";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DeviceOnlineState = {
  state: "online" | "offline" | "unknown";
  authoritative: boolean;
  source: string;
};

export type DeviceRuntimeScope = {
  estateId?: string | null;
  homeId?: string | null;
  /** Facility operators can work across an estate after the caller has checked devices.read/control. */
  estateWide?: boolean;
};

export type DeviceTimeline = {
  /** When Oyi most recently stored a state payload for this device. */
  latest_state_at: string | null;
  /** When the provider most recently confirmed the device was reachable/online. */
  last_seen_at: string | null;
  /** Provider-supplied event time, when present in the state payload. */
  provider_reported_at: string | null;
};

export function normalizeDeviceOnlineState(row: any): DeviceOnlineState {
  const booleanCandidates: Array<[unknown, string]> = [
    [row?.online, "online"],
    [row?.is_online, "is_online"],
    [row?.isOnline, "isOnline"],
    [row?.connected, "connected"],
    [row?.metadata?.online, "metadata.online"],
  ];
  for (const [value, source] of booleanCandidates) {
    if (typeof value === "boolean") {
      return { state: value ? "online" : "offline", authoritative: true, source };
    }
  }

  const text = String(row?.status || row?.state || row?.metadata?.status || "").toLowerCase();
  if (text.includes("online") || text.includes("active") || text.includes("connected")) {
    return { state: "online", authoritative: false, source: "registry_status" };
  }
  if (text.includes("offline") || text.includes("error") || text.includes("lost") || text.includes("disconnected")) {
    return { state: "offline", authoritative: false, source: "registry_status" };
  }
  return { state: "unknown", authoritative: false, source: "unknown" };
}

function timestamp(value: unknown) {
  const text = String(value || "").trim();
  if (!text || Number.isNaN(new Date(text).getTime())) return null;
  return text;
}

function firstTimestamp(...values: unknown[]) {
  for (const value of values) {
    const resolved = timestamp(value);
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Keeps state receipt, reachability, and provider event time distinct. They may
 * legitimately differ when a provider sync lags a state report or a command is queued.
 */
export function buildDeviceTimeline(device: any, deviceState?: any | null): DeviceTimeline {
  const state = deviceState?.status && typeof deviceState.status === "object" ? deviceState.status : {};
  const timeline = state?._oyi_timeline && typeof state._oyi_timeline === "object" ? state._oyi_timeline : {};
  const metadata = device?.metadata && typeof device.metadata === "object" ? device.metadata : {};
  const online = normalizeDeviceOnlineState(device).state === "online" || state?.online === true;
  return {
    latest_state_at: firstTimestamp(
      deviceState?.updated_at,
      timeline?.received_at,
      deviceState?.last_seen,
      device?.last_event_at,
      device?.updated_at,
    ),
    last_seen_at: firstTimestamp(
      device?.last_seen_at,
      online ? deviceState?.last_seen : null,
    ),
    provider_reported_at: firstTimestamp(
      timeline?.provider_reported_at,
      state?.provider_reported_at,
      state?.providerReportedAt,
      state?.reported_at,
      state?.reportedAt,
      state?.event_time,
      state?.eventTime,
      metadata?.provider_reported_at,
      metadata?.providerReportedAt,
    ),
  };
}

export function isDeviceDefinitelyOffline(row: any) {
  const normalized = normalizeDeviceOnlineState(row);
  return normalized.state === "offline" && normalized.authoritative;
}

export function resolveDeviceRuntimeScope(actor: Pick<AuthUser, "estate_id" | "home_id">, scope: DeviceRuntimeScope = {}) {
  return {
    estateId: scope.estateId || actor.estate_id || null,
    homeId: scope.estateWide ? null : scope.homeId || actor.home_id || null,
    estateWide: Boolean(scope.estateWide),
  };
}

function applyVisibleDeviceScope(query: any, actor: AuthUser, scope: DeviceRuntimeScope = {}) {
  const resolved = resolveDeviceRuntimeScope(actor, scope);
  if (resolved.estateId) query = query.eq("estate_id", resolved.estateId);
  // Preserve the pre-unification behavior: an estate-scoped device may be used by the active home.
  if (resolved.homeId) {
    query = resolved.estateId
      ? query.or(`home_id.is.null,home_id.eq.${resolved.homeId}`)
      : query.eq("home_id", resolved.homeId);
  }
  return query;
}

export async function listVisibleDevices(actor: AuthUser, limit = 50, scope: DeviceRuntimeScope = {}) {
  if (!hasWatchScope(actor)) return [];
  let query = supabaseAdmin.from("devices").select("*").limit(Math.max(1, Math.min(limit, 500)));
  query = applyVisibleDeviceScope(query, actor, scope);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  const irParentIds = new Set(
    rows
      .filter((device: any) => device?.is_virtual && device?.metadata?.ir_appliance?.remote_id)
      .map((device: any) => String(device?.parent_device_id || "").trim())
      .filter(Boolean),
  );
  return rows.filter((device: any) =>
    !isTechnicalDeviceHiddenFromResidents(device, { parentHasIrChildren: irParentIds.has(String(device?.id || "")) }),
  );
}

export async function resolveVisibleDevice(actor: AuthUser, ref: unknown, scope: DeviceRuntimeScope = {}) {
  const deviceRef = String(ref || "").trim();
  if (!deviceRef || !hasWatchScope(actor)) return null;
  let query = supabaseAdmin.from("devices").select("*");
  query = applyVisibleDeviceScope(query, actor, scope);
  query = UUID_RE.test(deviceRef) ? query.eq("id", deviceRef) : query.eq("external_id", deviceRef);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const canonicalChild = await resolveCanonicalIrChildForProviderRemote(data);
  if (canonicalChild?.id) return canonicalChild;
  if (isTechnicalDeviceHiddenFromResidents(data)) return null;
  return data;
}

export function logDeviceCommandDiagnostic(label: string, input: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production" && process.env.OYI_SAFE_COMMAND_LOGS !== "1") return;
  console.info(`[${label}]`, {
    action_id: input.action_id || null,
    device_id: input.device_id || null,
    matched_device_id: input.matched_device_id || null,
    home_id: input.home_id || null,
    estate_id: input.estate_id || null,
    normalized_online_state: input.normalized_online_state || null,
    command: input.command || null,
    provider_result: input.provider_result || null,
  });
}
