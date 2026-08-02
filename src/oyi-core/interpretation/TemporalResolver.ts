import type { SemanticFrame } from "../contracts/semanticFrame";

export function resolveTemporalScope(normalizedText: string): SemanticFrame["temporalScope"] {
  const now = new Date();
  if (/\bthis month|current month\b/i.test(normalizedText)) {
    return {
      mode: "current_month",
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
      to: now.toISOString(),
    };
  }
  if (/\btoday\b/i.test(normalizedText)) return { mode: "today", from: null, to: null };
  if (/\byesterday\b/i.test(normalizedText)) return { mode: "yesterday", from: null, to: null };
  if (/\bhistory|transactions|activity\b/i.test(normalizedText)) return { mode: "history", from: null, to: null };
  if (/\brecent|recently|latest|last 30 days\b/i.test(normalizedText)) return { mode: "recent", from: null, to: null };
  return null;
}
