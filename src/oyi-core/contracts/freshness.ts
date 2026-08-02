export type FreshnessMode =
  | "actively_polled"
  | "periodically_polled"
  | "event_driven"
  | "parent_derived"
  | "unobservable"
  | "provider_disconnected"
  | "disabled";

export type FreshnessPolicy = {
  mode: FreshnessMode;
  expected_ms: number | null;
  stale_after_ms: number | null;
  expired_after_ms: number | null;
};

export type FreshnessClassification = "fresh" | "stale" | "expired" | "unknown" | "unobservable" | "provider_disconnected";

export function classifyFreshness(policy: FreshnessPolicy, observedAt: string | null, nowMs = Date.now()): FreshnessClassification {
  if (policy.mode === "unobservable") return "unobservable";
  if (policy.mode === "provider_disconnected") return "provider_disconnected";
  if (policy.mode === "disabled") return "unknown";
  if (!observedAt) return "unknown";
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) return "unknown";
  const age = Math.max(0, nowMs - observed);
  if (policy.expired_after_ms !== null && age > policy.expired_after_ms) return "expired";
  if (policy.stale_after_ms !== null && age > policy.stale_after_ms) return "stale";
  return "fresh";
}
