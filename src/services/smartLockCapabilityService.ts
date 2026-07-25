import { summarizeDeviceFrontendContract } from "../device/runtime/deviceStateEnrichment";
import { buildSmartAccessProfile } from "./smartAccessCapabilityService";

function clean(value: any) {
  return String(value ?? "").trim().toLowerCase();
}

const LOCK_CATEGORY_HINTS = new Set([
  "jtmspro",
  "jtmsbh",
  "jtms",
  "doorlock",
  "door_lock",
  "smart_lock",
  "lock",
]);

export function summarizeSmartLockCapabilities(device: any, stateRow?: any | null) {
  const summary = summarizeDeviceFrontendContract(device || {}, stateRow || null);
  const smartAccess = buildSmartAccessProfile(device || {}, stateRow || null);
  const family = clean(summary.device_family);
  const profile = clean(summary.control_profile);
  const category = clean(device?.metadata?.raw?.category || device?.metadata?.category || device?.category || device?.type);
  const capabilityCodes = new Set((summary.capability_codes || []).map((item: any) => clean(item)).filter(Boolean));
  const controls = new Set((summary.supported_controls || []).map((item: any) => clean(item)).filter(Boolean));
  const functions = [
    ...(Array.isArray(device?.metadata?.functions) ? device.metadata.functions : []),
    ...(Array.isArray(device?.metadata?.raw?.functions) ? device.metadata.raw.functions : []),
  ];
  for (const fn of functions) {
    if (fn?.code) capabilityCodes.add(clean(fn.code));
  }

  const isLock =
    smartAccess.is_smart_access ||
    family === "lock" ||
    profile === "lock" ||
    LOCK_CATEGORY_HINTS.has(category) ||
    Array.from(capabilityCodes).some((code) => /lock|door|unlock|temporary|password|fingerprint|tamper|hijack|battery/.test(code));

  const canRemoteLock = isLock && smartAccess.capabilities?.control?.lock?.executableByOyi === true;
  const canRemoteUnlock = isLock && smartAccess.capabilities?.control?.unlock?.executableByOyi === true;

  return {
    is_lock: isLock,
    device_family: isLock ? "smart_access" : summary.device_family,
    control_profile: isLock ? "smart_access" : summary.control_profile,
    can_remote_lock: canRemoteLock,
    can_remote_unlock: canRemoteUnlock,
    supported_controls: Array.from(new Set([
      ...(summary.supported_controls || []).filter((control: any) => {
        const value = clean(control);
        if (value === "lock") return canRemoteLock;
        if (value === "unlock") return canRemoteUnlock;
        return true;
      }),
      ...(isLock ? ["smart_access", "lock_state", canRemoteLock ? "lock" : null, canRemoteUnlock ? "unlock" : null] : []),
    ].filter(Boolean) as string[])),
    smart_access: smartAccess,
    capability_codes: Array.from(capabilityCodes),
  };
}

export function assertSmartLockCommandAllowed(device: any, command: Record<string, any>) {
  const lock = summarizeSmartLockCapabilities(device);
  if (!lock.is_lock) return;
  const value = String(command?.lock ?? command?.locked ?? command?.state ?? command?.switch ?? "").toLowerCase();
  const wantsUnlock = value === "false" || value === "unlocked" || value === "unlock" || command?.unlock === true;
  const wantsLock = value === "true" || value === "locked" || value === "lock" || command?.lock === true || command?.locked === true;
  if (wantsUnlock && !lock.can_remote_unlock) {
    const reason = lock.smart_access?.capabilities?.control?.unlock?.status === "mapping_missing"
      ? "Remote unlock is declared by the provider, but Oyi does not have a verified command mapping for this connection."
      : "Remote unlock is not supported by this lock.";
    const error: any = new Error(reason);
    error.statusCode = 422;
    error.code = "LOCK_UNLOCK_MAPPING_MISSING";
    throw error;
  }
  if (wantsLock && !lock.can_remote_lock) {
    const reason = lock.smart_access?.capabilities?.control?.lock?.status === "mapping_missing"
      ? "Remote lock is declared by the provider, but Oyi does not have a verified command mapping for this connection."
      : "Remote lock is not supported by this lock.";
    const error: any = new Error(reason);
    error.statusCode = 422;
    error.code = "LOCK_LOCK_MAPPING_MISSING";
    throw error;
  }
}
