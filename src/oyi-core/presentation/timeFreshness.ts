function text(value: unknown) {
  return value === undefined || value === null ? "" : String(value).trim();
}

export function safeDateLabel(value: unknown, fallback = "time unavailable", mode: "time" | "date_time" | "relative" = "time") {
  const raw = text(value);
  if (!raw) return fallback;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const date = new Date(parsed);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  if (mode === "relative") {
    const ageMs = Date.now() - parsed;
    if (ageMs >= 0 && ageMs < 60_000) return "just now";
    if (ageMs >= 0 && ageMs < 60 * 60_000) return `${Math.max(1, Math.round(ageMs / 60_000))} min ago`;
    if (ageMs >= 0 && ageMs < 24 * 60 * 60_000) return `${Math.max(1, Math.round(ageMs / (60 * 60_000)))} hr ago`;
  }
  if (mode === "date_time") {
    if (parsed >= startOfToday.getTime()) return `Today, ${time}`;
    if (parsed >= startOfYesterday.getTime() && parsed < startOfToday.getTime()) return `Yesterday, ${time}`;
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleString([], sameYear
      ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  return time;
}

export function freshnessLabelFromEvidence(freshness: unknown, truthState: unknown, source: unknown, timestamp?: unknown) {
  const freshnessText = text(freshness).toLowerCase();
  const truth = text(truthState).toLowerCase();
  const sourceText = text(source).toLowerCase();
  const age = safeDateLabel(timestamp || freshness, "", "relative");
  if (truth === "inferred" || sourceText === "validated_visible_state") return { prefix: "the app last showed", caveat: age ? `That displayed state was captured ${age}.` : "A live provider reading was not available." };
  if (freshnessText === "fresh" && (truth === "confirmed" || truth === "observed")) return { prefix: "the latest reading confirms", caveat: age ? `Updated ${age}.` : "Updated recently.", current: true };
  if (["stale", "ageing", "cached", "last_confirmed"].includes(freshnessText) || truth === "observed") return { prefix: "the last available reading showed", caveat: age ? `Last updated ${age}; this is stale.` : "This is not a live confirmation.", current: false };
  if (["expired", "unknown", "unavailable", "provider_disconnected"].includes(freshnessText) || truth === "unavailable") return { prefix: "does not have a recently confirmed state for", caveat: "Status is not recently confirmed." };
  return { prefix: "the latest evidence shows", caveat: age ? `Evidence time: ${age}.` : "", current: false };
}
