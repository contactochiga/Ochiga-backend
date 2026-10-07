// Wave 6 Slice 13 -- Device Current-State Authority.
//
// ONE AUTHORITY PER FACT:
//   provisioning/identity  -> devices table (caller's own responsibility, not this module)
//   observed runtime state -> deviceRuntimeStateService (cache, backed by persisted device_states)
//   current-state freshness -> deviceObservationPolicy.ts's per-device-class policy via
//                               contracts/freshness.ts::classifyFreshness (the same classifier
//                               runtimeEvidenceForDevice already uses -- reused, not reinvented)
//   availability verdict   -> canonicalDeviceAvailabilityStatus (existing, unchanged)
//
// This module answers "what is CURRENT for this device" for consumers that previously read
// `devices`/`device_states` directly and derived their own freshness verdict. It deliberately
// does NOT touch deviceRuntimeStateService's own internal fresh/stale/expired cache-TTL model
// (10s/60s) -- that model governs the service's OWN refresh-scheduling decisions and must not be
// changed by this slice (Section 25: no over-polling regression). The classification here is a
// separate, consumer-facing concept: "how should Oyi honestly describe this observation's age."
import { deviceRuntimeStateService, type DeviceRuntimeSnapshot } from "../../../services/deviceRuntimeStateService";
import { classifyFreshness, type FreshnessClassification } from "../../contracts/freshness";
import { observationPolicyForDevice } from "./deviceObservationPolicy";
import { canonicalDeviceAvailabilityStatus } from "./deviceEvidence";
import { deviceCurrentStateInput } from "./deviceCurrentStateInput";

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export type DeviceCurrentState = {
  deviceId: string;
  observedState: Record<string, unknown> | null;
  availability: string;
  source: "runtime" | "persistent_snapshot" | "unavailable";
  provider: string | null;
  observedAt: string | null;
  receivedAt: string | null;
  freshness: FreshnessClassification;
  providerHealth: string | null;
  onlineRaw: boolean | null;
  reason: string | null;
};

function unavailableState(deviceId: string, reason: string): DeviceCurrentState {
  return {
    deviceId,
    observedState: null,
    availability: "unknown",
    source: "unavailable",
    provider: null,
    observedAt: null,
    receivedAt: null,
    freshness: "unknown",
    providerHealth: null,
    onlineRaw: null,
    reason,
  };
}

// Batched: one DB round-trip for every device missing from the in-memory cache (device_states,
// via deviceRuntimeStateService.hydrateMany's existing .in("device_id", ids) query), never a
// live provider poll -- callers that need N devices' current state get O(1) provider calls, not
// O(N) (Section 25/30).
export async function resolveDeviceCurrentStates(devices: Array<Record<string, unknown>>, db?: { from: (table: string) => { select: (...a: any[]) => any } }): Promise<Map<string, DeviceCurrentState>> {
  const now = Date.now();
  const result = new Map<string, DeviceCurrentState>();
  const withIds = devices.filter((device) => device?.id).map(deviceCurrentStateInput);
  if (!withIds.length) return result;
  // The planner passes its read-only evidence db so hydration reads through it; ordinary callers use the
  // service default. The runtime cache is the canonical current-state authority and is only ever read here.
  await deviceRuntimeStateService.hydrateMany(withIds, db ? async (ids: string[]) => {
    const { data, error } = await db.from("device_states").select("device_id,status,last_seen,updated_at").in("device_id", ids);
    if (error) throw error;
    return data || [];
  } : undefined);
  for (const device of withIds) {
    const deviceId = String(device.id);
    const snapshot = deviceRuntimeStateService.get(deviceId);
    result.set(deviceId, interpretDeviceCurrentState(device, snapshot, now));
  }
  return result;
}

// The same interpretation for callers that already possess an authorized runtime
// snapshot. No hydration, provider polling, or independent freshness rules.
export function interpretDeviceCurrentState(input: Record<string, unknown>, snapshot: DeviceRuntimeSnapshot | null, now = Date.now()): DeviceCurrentState {
    const device = deviceCurrentStateInput(input);
    const deviceId = String(device.id);
    if (!snapshot) return unavailableState(deviceId, "no_observation");
    const state = recordOf(snapshot.state);
    const normalized = recordOf(state.normalized_state);
    const observedAt = snapshot.provider_timestamp || snapshot.runtime_timestamp || snapshot.last_refresh || null;
    const policy = observationPolicyForDevice(device, snapshot as unknown as Record<string, unknown>);
    const freshness = classifyFreshness(policy, observedAt, now);
    const providerHealth = (state.provider_health as string) || (normalized.provider_health as string) || (recordOf(device.metadata).provider_health as string) || null;
    // Runtime authority wins over devices.online whenever a runtime observation exists --
    // devices.online is provisioning-era mirror, not consulted here (Section 11).
    const onlineRaw = typeof state.online === "boolean" ? state.online : typeof normalized.online === "boolean" ? normalized.online : null;
    const availability = canonicalDeviceAvailabilityStatus({ online: onlineRaw, freshness, providerHealth });
    return {
      deviceId,
      observedState: state,
      availability,
      source: snapshot.source,
      provider: String(device.adapter || device.provider || device.vendor || "") || null,
      observedAt: observedAt ? String(observedAt) : null,
      receivedAt: snapshot.runtime_timestamp || null,
      freshness,
      providerHealth,
      onlineRaw,
      reason: null,
    };
}
