import { resolveDeviceCurrentStates, type DeviceCurrentState } from "./deviceCurrentStateAuthority";

// Shape adaptation only: never classify observations or consult registry mirrors here.
export function currentDeviceOnline(current?: DeviceCurrentState | null): boolean | null {
  return current?.availability === "online" ? true : current?.availability === "offline" ? false : null;
}

// Older panel contracts have no "expired" enum; retain that distinction in
// current_state while presenting it as stale in the legacy visual contract.
export function currentDevicePanelProjection<T extends Record<string, any>>(value: T | null, current: DeviceCurrentState): T | null {
  if (!value) return null;
  const reasons: Record<string, string> = { online: "provider_reports_online", offline: "provider_reports_offline", stale: "last_success_too_old", expired: "last_success_too_old", provider_disconnected: "provider_connection_missing" };
  return {
    ...value,
    availability: current.availability === "expired" ? "stale" : current.availability,
    availabilityReason: reasons[current.availability] || "unknown",
    lastSeenAt: current.observedAt,
    ...(current.availability !== "online" ? {
      summary: `Current state unavailable (${current.availability.replace(/_/g, " ")})`,
      ...(value.primaryState ? { primaryState: { ...value.primaryState, confidence: "last_confirmed", label: `Last observed: ${value.primaryState.label || "unknown"}` } } : {}),
    } : {}),
  };
}

export async function projectDeviceCurrentStateRows<T extends Record<string, any>>(devices: T[]) {
  const states = await resolveDeviceCurrentStates(devices);
  return devices.map(device => {
    const current = states.get(String(device.id)) || null;
    return { ...device, registry_status: device.status || null, online: currentDeviceOnline(current), status: current?.availability || "unknown", current_state: current };
  });
}
