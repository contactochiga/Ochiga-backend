function text(value: unknown) {
  return String(value ?? "").trim();
}

export function visitorAccessStatus(value: unknown) {
  const raw = text(value).toLowerCase();
  if (/inactive|expired|revoked|denied|cancelled/i.test(raw)) return "inactive";
  if (/arrived|entered|checked_in|active|approved|valid/i.test(raw)) return "active";
  if (/pending|waiting|requested/i.test(raw)) return "pending";
  return raw || "unknown";
}

// IQ-9A4: the ONE definition of a visitor pass's state, shared by the record read, the deterministic judgment and response projection.
// A pass is "active" only when its recorded status is active AND no recorded expiry has passed. A pass recorded active whose expiry time has
// passed is a conflict, not an active pass and not (on the status alone) an expired one: its validity cannot be confirmed from the records.
export type VisitorPassState = "active" | "active_past_expiry" | "inactive" | "pending" | "unknown";
export function visitorPassState(input: { status: unknown; expires_at?: unknown }, now: number = Date.now()): VisitorPassState {
  const status = visitorAccessStatus(input.status);
  if (status === "inactive") return "inactive";
  if (status === "pending") return "pending";
  if (status !== "active") return "unknown";
  const expiry = Date.parse(text(input.expires_at));
  return Number.isFinite(expiry) && expiry <= now ? "active_past_expiry" : "active";
}
export function visitorPassLabel(state: VisitorPassState, rawStatus?: unknown): string {
  return state === "active_past_expiry" ? "active, past its recorded expiry" : state === "unknown" ? (text(rawStatus).toLowerCase() || "unknown") : state;
}

