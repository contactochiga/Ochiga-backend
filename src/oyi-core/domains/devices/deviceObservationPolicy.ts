import type { FreshnessPolicy } from "../../contracts/freshness";

export type DeviceObservationMode =
  | "currently_viewed_switch"
  | "inactive_switch"
  | "battery_lock"
  | "virtual_ir_appliance"
  | "provider_disconnected"
  | "disabled";

export const DEVICE_OBSERVATION_POLICIES: Record<DeviceObservationMode, FreshnessPolicy> = {
  currently_viewed_switch: { mode: "actively_polled", expected_ms: 30_000, stale_after_ms: 75_000, expired_after_ms: 180_000 },
  inactive_switch: { mode: "periodically_polled", expected_ms: 600_000, stale_after_ms: 720_000, expired_after_ms: 1_800_000 },
  battery_lock: { mode: "event_driven", expected_ms: null, stale_after_ms: null, expired_after_ms: null },
  virtual_ir_appliance: { mode: "parent_derived", expected_ms: null, stale_after_ms: 1_800_000, expired_after_ms: 86_400_000 },
  provider_disconnected: { mode: "provider_disconnected", expected_ms: null, stale_after_ms: null, expired_after_ms: null },
  disabled: { mode: "disabled", expected_ms: null, stale_after_ms: null, expired_after_ms: null },
};

export function observationPolicyForDevice(device: Record<string, unknown>, runtime?: Record<string, unknown> | null): FreshnessPolicy {
  const providerDisconnected = String(runtime?.authorization_state || runtime?.freshness || "").includes("disconnected");
  if (providerDisconnected) return DEVICE_OBSERVATION_POLICIES.provider_disconnected;
  if (device?.is_virtual || String(device?.control_profile || device?.device_type || "").toLowerCase().includes("ir")) return DEVICE_OBSERVATION_POLICIES.virtual_ir_appliance;
  if (String(device?.device_type || device?.control_profile || "").toLowerCase().includes("lock")) return DEVICE_OBSERVATION_POLICIES.battery_lock;
  if (runtime?.viewed_until_at) return DEVICE_OBSERVATION_POLICIES.currently_viewed_switch;
  return DEVICE_OBSERVATION_POLICIES.inactive_switch;
}
