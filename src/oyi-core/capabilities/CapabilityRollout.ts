import type { CapabilityModule, CapabilityRolloutStatus } from "../contracts/capability";

export function capabilityEnabled(module: CapabilityModule) {
  return module.rolloutStatus === "enabled";
}

export function assertEnabledCapabilityHasAdapter(module: CapabilityModule) {
  if (module.rolloutStatus !== "enabled") return;
  const hasRead = typeof module.buildReadResponse === "function";
  const hasDraft = typeof module.createDraft === "function";
  const hasExecution = typeof module.execute === "function";
  if (!hasRead && !hasDraft && !hasExecution) {
    throw new Error(`Enabled capability ${module.key} has no executable adapter`);
  }
}

export function rolloutStatusFromFlag(enabled: boolean, fallback: CapabilityRolloutStatus = "declared"): CapabilityRolloutStatus {
  return enabled ? "enabled" : fallback;
}
