import {
  normalizeSignal,
  signalDeduplicationKey,
  signalPriority,
  validateSignal,
  type NormalizedSignal,
  type SignalPriority,
} from "../contracts/operationalSignal";

export type SignalRuntimeOutput =
  | "operational_intelligence"
  | "infrastructure_registry"
  | "activity"
  | "notifications"
  | "automation"
  | "conversation"
  | "digital_twin"
  | "reports"
  | "executive_intelligence"
  | "future_ai";

export type SignalRuntimeReceipt = {
  signal: NormalizedSignal;
  accepted: boolean;
  duplicate: boolean;
  priority: SignalPriority;
  outputs: SignalRuntimeOutput[];
  issues: string[];
  receivedAt: string;
  auditId: string;
};

function outputsFor(signal: NormalizedSignal): SignalRuntimeOutput[] {
  if (signal.domain === "smart_access_private" || signal.domain === "resident_device_private") {
    if (signal.severity === "critical" || signal.severity === "warning") return ["activity", "notifications", "executive_intelligence"];
    return ["activity"];
  }
  const outputs = new Set<SignalRuntimeOutput>(["operational_intelligence", "activity", "reports", "future_ai"]);
  const haystack = `${signal.type} ${signal.source} ${signal.domain} ${signal.entity.type}`.toLowerCase();
  if (/device|edge|infrastructure|telemetry|meter|camera|onvif|tuya|mqtt|ble|matter/.test(haystack)) {
    outputs.add("infrastructure_registry");
    outputs.add("digital_twin");
  }
  if (/notification|communication|message|security|visitor|maintenance|financial|wallet|community/.test(haystack)) outputs.add("notifications");
  if (/automation|rule|scene|device|edge|visitor|maintenance/.test(haystack)) outputs.add("automation");
  if (/ai|oyi|conversation|message|communication/.test(haystack)) outputs.add("conversation");
  if (/executive|financial|security|critical|governance/.test(haystack) || signal.severity === "critical") outputs.add("executive_intelligence");
  return [...outputs];
}

export class UniversalSignalRuntime {
  private dedupe = new Map<string, number>();
  private auditTrail: SignalRuntimeReceipt[] = [];

  constructor(private options: { outputs?: SignalRuntimeOutput[]; dedupeTtlMs?: number; auditLimit?: number } = {}) {}

  receive(input: Partial<NormalizedSignal> & Record<string, unknown>, receivedAt = new Date().toISOString()) {
    const signal = this.timestamp(this.normalize(input), receivedAt);
    const validation = this.validate(signal);
    const duplicate = this.deduplicate(signal, receivedAt);
    const priority = this.prioritize(signal);
    const outputs = this.publishTargets(signal);
    const receipt: SignalRuntimeReceipt = {
      signal,
      accepted: validation.ok && !duplicate,
      duplicate,
      priority,
      outputs,
      issues: validation.issues,
      receivedAt,
      auditId: `signal-audit:${signal.id}:${receivedAt}`,
    };
    this.audit(receipt);
    return receipt;
  }

  normalize(input: Partial<NormalizedSignal> & Record<string, unknown>) {
    return normalizeSignal(input);
  }

  validate(signal: NormalizedSignal) {
    return validateSignal(signal);
  }

  timestamp(signal: NormalizedSignal, receivedAt = new Date().toISOString()): NormalizedSignal {
    return { ...signal, timestamp: signal.timestamp || receivedAt, metadata: { ...signal.metadata, received_at: receivedAt } };
  }

  deduplicate(signal: NormalizedSignal, receivedAt = new Date().toISOString()) {
    const key = signalDeduplicationKey(signal);
    const now = new Date(receivedAt).getTime();
    const previous = this.dedupe.get(key);
    for (const [entryKey, expiresAt] of this.dedupe.entries()) {
      if (expiresAt <= now) this.dedupe.delete(entryKey);
    }
    if (previous && previous > now) return true;
    this.dedupe.set(key, now + (this.options.dedupeTtlMs ?? 60000));
    return false;
  }

  prioritize(signal: NormalizedSignal) {
    return signalPriority(signal);
  }

  publishTargets(signal: NormalizedSignal) {
    const allowed = new Set(
      this.options.outputs || [
        "operational_intelligence",
        "infrastructure_registry",
        "activity",
        "notifications",
        "automation",
        "conversation",
        "digital_twin",
        "reports",
        "executive_intelligence",
        "future_ai",
      ]
    );
    return outputsFor(signal).filter((output) => allowed.has(output));
  }

  audit(receipt: SignalRuntimeReceipt) {
    this.auditTrail = [receipt, ...this.auditTrail].slice(0, this.options.auditLimit ?? 250);
  }

  auditLog() {
    return [...this.auditTrail];
  }
}

export const universalSignalRuntime = new UniversalSignalRuntime();
