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
  // declaredModule()'s placeholder evidence collector (ReadCapabilityModules.ts)
  // always exists as a function, so the check above alone cannot catch a
  // rollout_status mistakenly flipped to "enabled" while evidence loading is
  // still the "not enabled yet" stub. Direct evidence must be wired first.
  if ((module.collectEvidence as any)?.__isDeclaredStub) {
    throw new Error(`Enabled capability ${module.key} still uses the declared-module stub evidence collector — direct evidence has not been wired`);
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
