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
  if (module.risk_class && module.risk_class !== "read" && !hasDraft && !hasExecution) {
    throw new Error(`Enabled action capability ${module.key} has no draft or execution adapter`);
  }
  if (module.risk_class && ["consequential_action", "sensitive_action"].includes(module.risk_class) && hasExecution && typeof module.verify !== "function") {
    throw new Error(`Enabled consequential capability ${module.key} has no verification adapter`);
  }
}

export function rolloutStatusFromFlag(enabled: boolean, fallback: CapabilityRolloutStatus = "declared"): CapabilityRolloutStatus {
  return enabled ? "enabled" : fallback;
}
