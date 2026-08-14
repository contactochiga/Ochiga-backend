import type { ResultSetContext, ResultSetObjectRef } from "../context/resultSetContext";

function text(value: unknown) {
  return String(value ?? "").trim();
}

export type FollowUpIntent =
  | { type: "comparison" }
  | { type: "temporal_followup" }
  | { type: "filter"; keyword: string }
  | { type: "attribute"; attribute: "unresolved" | "failed" | "expensive" | "highest" | "open" }
  | { type: "ordinal"; ordinal: "first" | "second" | "third" | "last" | "latest" | "oldest" }
  | { type: "why" }
  | { type: "status_check" }
  | { type: "field"; field: "who" | "when" | "where" | "amount" }
  | { type: "detail" }
  | { type: "pronoun" };

// Domain-switch-back ("go back to that maintenance issue") is parsed
// separately from FollowUpIntent because it doesn't resolve against the
// currently active result set — it picks WHICH domain's result set to
// resolve against next. Keyword list intentionally mirrors the domain
// names this codebase actually uses (see ReadCapabilityModules.ts).
const DOMAIN_KEYWORDS: Array<[string, RegExp]> = [
  ["maintenance", /\bmaintenance\b/i],
  ["visitors", /\bvisitors?\b/i],
  ["security", /\bsecurity\b|\bincidents?\b/i],
  ["services", /\bservices?\b/i],
  ["community", /\bcommunity\b|\bannouncements?\b/i],
  ["scenes", /\bscenes?\b/i],
  ["automations", /\bautomations?\b/i],
  ["utilities", /\butilit(?:y|ies)\b|\belectricity\b/i],
  ["wallet", /\bwallet\b|\btransactions?\b/i],
];

export type DomainSwitchIntent = { type: "switch"; domain: string } | { type: "ambiguous" } | null;

export function parseDomainSwitchIntent(message: string): DomainSwitchIntent {
  const m = text(message).toLowerCase();
  if (!/\bgo back\b|\bback to\b|\bswitch back\b/.test(m)) return null;
  for (const [domain, re] of DOMAIN_KEYWORDS) {
    if (re.test(m)) return { type: "switch", domain };
  }
  return { type: "ambiguous" };
}

// Generic, domain-agnostic follow-up classification — no domain names
// appear anywhere in this function. Order matters: more specific cues
// (comparison, temporal, attribute, ordinal, why) are checked before the
// generic pronoun/detail catch-alls, so e.g. "Who was the latest?" resolves
// as an ordinal (latest) rather than being swallowed by a bare "who" rule
// that doesn't exist here for exactly this reason.
export function parseFollowUpIntent(message: string): FollowUpIntent | null {
  const m = text(message).toLowerCase();
  if (!m) return null;

  if (/\bwhich (one )?(was|is)\s+(higher|lower|more|less|bigger|smaller)\b/.test(m) || /\bcompare\b/.test(m) || /\bhigher or lower\b/.test(m)) {
    return { type: "comparison" };
  }

  const isShortContinuation = /^(what about|and|how about|what's|whats)\b/.test(m) || m.split(/\s+/).filter(Boolean).length <= 4;
  if (isShortContinuation && (/\b(this|current)\s+week\b/.test(m) || /\b(last|previous)\s+week\b/.test(m) || /\b(this|current)\s+month\b/.test(m) || /\b(last|previous)\s+month\b/.test(m))) {
    return { type: "temporal_followup" };
  }

  // Filter continuity: "show only the high priority ones" / "just the open
  // ones" narrows the previously presented LIST (possibly to more than one
  // item) rather than selecting a single object — checked before the
  // single-object "the X one" attribute rules below, since "only"/"just"
  // is the disambiguating cue even when the keyword itself looks singular.
  if (/\b(only|just)\b/.test(m) && /\bones?\b/.test(m)) {
    const keyword = m
      .replace(/^(show|give|list)?\s*(me\s+)?(only|just)\s+(the\s+)?/, "")
      .replace(/\bones?\b\.?$/, "")
      .trim();
    if (keyword) return { type: "filter", keyword };
  }

  if (/\bunresolved\s+one\b|\bthe unresolved\b/.test(m)) return { type: "attribute", attribute: "unresolved" };
  if (/\bfailed\s+one\b|\bthe failed\b/.test(m)) return { type: "attribute", attribute: "failed" };
  if (/\bexpensive\s+one\b|\bmost expensive\b/.test(m)) return { type: "attribute", attribute: "expensive" };
  if (/\bhighest\s+one\b|\bthe highest\b/.test(m)) return { type: "attribute", attribute: "highest" };
  if (/\bopen\s+one\b|\bonly the open\b/.test(m)) return { type: "attribute", attribute: "open" };

  if (/\bfirst\s+one\b|\bthe first\b/.test(m)) return { type: "ordinal", ordinal: "first" };
  if (/\bsecond\s+one\b|\bthe second\b/.test(m)) return { type: "ordinal", ordinal: "second" };
  if (/\bthird\s+one\b|\bthe third\b/.test(m)) return { type: "ordinal", ordinal: "third" };
  if (/\boldest\b/.test(m)) return { type: "ordinal", ordinal: "oldest" };
  if (/\bnewest\b|\blatest\b|\bmost recent\b/.test(m)) return { type: "ordinal", ordinal: "latest" };
  if (/\blast\s+one\b|\bthe last\b/.test(m)) return { type: "ordinal", ordinal: "last" };

  if (/\bwhy\b/.test(m) && m.split(/\s+/).filter(Boolean).length <= 8) return { type: "why" };

  if (/^(is|was|did|does)\s+(it|that|this|they|he|she)\b/.test(m)) return { type: "status_check" };

  if (/\bhow much\b/.test(m)) return { type: "field", field: "amount" };
  if (/^where\b/.test(m)) return { type: "field", field: "where" };
  if (/^when\b/.test(m)) return { type: "field", field: "when" };
  if (/^who\b/.test(m)) return { type: "field", field: "who" };

  if (/\btell me more\b|\bmore details?\b|\bmore info(rmation)?\b/.test(m)) return { type: "detail" };

  if (/^(that one|this one|that|this|it)\b/.test(m) || /\bthe one you mentioned\b/.test(m)) return { type: "pronoun" };

  return null;
}

export type FollowUpResolution =
  | { status: "resolved"; ref: ResultSetObjectRef }
  | { status: "ambiguous"; candidates: ResultSetObjectRef[] }
  | { status: "unresolved" };

function byOccurredAt(order: "asc" | "desc") {
  return (a: ResultSetObjectRef, b: ResultSetObjectRef) => {
    const at = new Date(a.occurred_at || 0).getTime();
    const bt = new Date(b.occurred_at || 0).getTime();
    return order === "asc" ? at - bt : bt - at;
  };
}

function resolveOrdinal(resultSet: ResultSetContext, ordinal: string): FollowUpResolution {
  const refs = resultSet.object_refs;
  if (!refs.length) return { status: "unresolved" };
  if (ordinal === "first") return refs[0] ? { status: "resolved", ref: refs[0] } : { status: "unresolved" };
  if (ordinal === "second") return refs[1] ? { status: "resolved", ref: refs[1] } : { status: "unresolved" };
  if (ordinal === "third") return refs[2] ? { status: "resolved", ref: refs[2] } : { status: "unresolved" };
  if (ordinal === "last") return { status: "resolved", ref: refs[refs.length - 1] };
  const dated = refs.filter((ref) => ref.occurred_at);
  if (!dated.length) return { status: "unresolved" };
  const sorted = dated.slice().sort(byOccurredAt(ordinal === "oldest" ? "asc" : "desc"));
  return { status: "resolved", ref: sorted[0] };
}

function resolveAttribute(resultSet: ResultSetContext, attribute: string): FollowUpResolution {
  const refs = resultSet.object_refs;
  if (attribute === "expensive" || attribute === "highest") {
    const metriced = refs.filter((ref) => ref.metric_value !== null);
    if (!metriced.length) return { status: "unresolved" };
    const sorted = metriced.slice().sort((a, b) => (b.metric_value as number) - (a.metric_value as number));
    return { status: "resolved", ref: sorted[0] };
  }
  const statusSynonyms: Record<string, string[]> = {
    unresolved: ["open", "unresolved", "pending", "active", "in_progress"],
    failed: ["failed", "error"],
    open: ["open", "unresolved", "pending"],
  };
  const wanted = statusSynonyms[attribute] || [attribute];
  const matches = refs.filter((ref) => ref.status && wanted.includes(ref.status));
  if (!matches.length) return { status: "unresolved" };
  if (matches.length === 1) return { status: "resolved", ref: matches[0] };
  return { status: "ambiguous", candidates: matches };
}

export type FilterResolution =
  | { status: "resolved"; matched: ResultSetObjectRef[]; keyword: string }
  | { status: "unresolved" };

// Generic filter matcher: a keyword like "high priority" matches a ref if
// EVERY word in the keyword appears somewhere across that ref's status plus
// its attribute keys+values (e.g. attributes={priority:"high"} contributes
// both "priority" and "high" to the haystack, so "priority" matches the
// field name and "high" matches its value) — no per-domain field-name
// knowledge required.
export function resolveFilterFollowUp(resultSet: ResultSetContext | null, keyword: string): FilterResolution {
  if (!resultSet || !keyword) return { status: "unresolved" };
  const words = keyword.split(/\s+/).filter(Boolean);
  if (!words.length) return { status: "unresolved" };
  const matched = resultSet.object_refs.filter((ref) => {
    const haystack = [ref.status || "", ...Object.entries(ref.attributes || {}).flatMap(([k, v]) => [k, v])].join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  if (!matched.length) return { status: "unresolved" };
  return { status: "resolved", matched, keyword };
}

function resolvePronoun(resultSet: ResultSetContext): FollowUpResolution {
  if (resultSet.selected_object_ref) return { status: "resolved", ref: resultSet.selected_object_ref };
  if (resultSet.object_refs.length === 1) return { status: "resolved", ref: resultSet.object_refs[0] };
  if (resultSet.object_refs.length > 1) return { status: "ambiguous", candidates: resultSet.object_refs };
  return { status: "unresolved" };
}

// Resolves a follow-up reference to a single canonical object against the
// PREVIOUS turn's result set only — never an arbitrary broad re-query (see
// §6 of the programme spec: "not rerun a broad unrelated query unless
// necessary").
export function resolveFollowUpReference(resultSet: ResultSetContext | null, intent: FollowUpIntent): FollowUpResolution {
  if (!resultSet) return { status: "unresolved" };
  if (intent.type === "ordinal") return resolveOrdinal(resultSet, intent.ordinal);
  if (intent.type === "attribute") return resolveAttribute(resultSet, intent.attribute);
  if (intent.type === "pronoun" || intent.type === "detail" || intent.type === "why" || intent.type === "status_check" || intent.type === "field") {
    return resolvePronoun(resultSet);
  }
  return { status: "unresolved" };
}

export function clarificationCandidatesFromRefs(candidates: ResultSetObjectRef[]) {
  return candidates.slice(0, 6).map((ref) => ({
    id: ref.canonical_id,
    object_type: ref.object_type,
    label: ref.label,
    occurred_at: ref.occurred_at,
    status: ref.status,
  }));
}
