// IQ-9A14: conversational disclosure constraints ("don't mention visitor names today") are enforced where a response is projected, within the conversation that
// stated them. The underlying records stay readable (counts, states, permissions are still answered); only the withheld field is not revealed.
// Scope claim: this conversation thread only. Nothing here is durable across threads.

const WITHHOLD_VERB = /\b(?:mention|say|show|name|reveal|disclose|share|use|include|give|list|repeat|state)\b/i;
const NEGATION = /\b(?:don'?t|do\s+not|dont|never|stop|no\s+more|without|please\s+don'?t|avoid|refrain\s+from)\b/i;

/** Constraint codes stated by a user message. Currently: visitor_names. */
export function disclosureConstraintsIn(message: string): string[] {
  const out: string[] = [];
  const t = String(message || "").replace(/’/g, "'");
  const names = /\b(?:visitor|visitors|guest|guests)(?:'s|s')?\s+names?\b|\bnames?\s+of\s+(?:my\s+|the\s+)?(?:visitors?|guests?)\b/i;
  if (names.test(t) && (NEGATION.test(t) && WITHHOLD_VERB.test(t) || /\bno\s+(?:visitor|guest)\s+names?\b/i.test(t))) out.push("visitor_names");
  return out;
}
/** A lifting message ("you can mention names again") removes the constraint. */
export function disclosureConstraintLifted(message: string): string[] {
  const t = String(message || "").replace(/’/g, "'");
  if (disclosureConstraintsIn(t).length) return [];
  const lifted: string[] = [];
  if (/\b(?:you\s+can|feel\s+free\s+to|it'?s\s+(?:fine|ok|okay)\s+to|go\s+ahead\s+and)\b[^.]*\b(?:visitor|guest)s?'?\s*names?\b/i.test(t) || /\b(?:names?\s+(?:are\s+)?(?:fine|ok|okay)\s+again|lift|cancel|ignore)\b[^.]*\b(?:visitor|guest)s?'?\s*names?\b/i.test(t)) lifted.push("visitor_names");
  return lifted;
}
/** Active constraints after replaying the thread's user messages in order, then the current one. */
export function activeDisclosureConstraints(messagesInOrder: string[]): string[] {
  const active = new Set<string>();
  for (const m of messagesInOrder) { for (const c of disclosureConstraintLifted(m)) active.delete(c); for (const c of disclosureConstraintsIn(m)) active.add(c); }
  return [...active];
}
export const VISITOR_PLACEHOLDER = "a visitor record";
export function withheldNote(constraint: string) { return constraint === "visitor_names" ? "Visitor names are withheld in this conversation, as you asked." : ""; }

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
/** Replace each withheld name (longest first) in a string; returns the new string and whether anything changed. */
export function redactNames(value: string, names: string[]): { text: string; changed: boolean } {
  let text = value, changed = false;
  for (const n of [...new Set(names.map(x => String(x || "").trim()).filter(x => x.length > 1))].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(escapeRe(n), "gi");
    if (re.test(text)) { text = text.replace(re, VISITOR_PLACEHOLDER); changed = true; }
  }
  // a doubled placeholder produced by overlapping label forms ("a visitor record a visitor record")
  text = text.replace(/(a visitor record)(?:[,;]?\s+a visitor record)+/gi, "$1");
  return { text, changed };
}
export function deepRedact<T>(value: T, names: string[]): { value: T; changed: boolean } {
  let changed = false;
  const walk = (v: any): any => {
    if (typeof v === "string") { const r = redactNames(v, names); if (r.changed) changed = true; return r.text; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), changed };
}
