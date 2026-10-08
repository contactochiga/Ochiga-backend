import type { ResultSetContext, ResultSetObjectRef } from "../context/resultSetContext";

function text(value: unknown) {
  return String(value ?? "").trim();
}

export type FollowUpIntent =
  | { type: "comparison" }
  | { type: "prioritize" }
  | { type: "temporal_followup" }
  | { type: "filter"; keyword: string }
  | { type: "attribute"; attribute: "unresolved" | "failed" | "expensive" | "highest" | "open" | "active" | "inactive" | "resolved" }
  | { type: "other" }
  | { type: "named_field"; phrase: string }
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
  ["devices", /\bdevices?\b/i],
  ["maintenance", /\bmaintenance\b/i],
  ["visitors", /\bvisitors?\b/i],
  ["security", /\bsecurity\b|\bincidents?\b/i],
  ["services", /\bservices?\b/i],
  ["community", /\bcommunity\b|\bannouncements?\b/i],
  ["scenes", /\bscenes?\b/i],
  ["automations", /\bautomations?\b/i],
  ["utilities", /\butilit(?:y|ies)\b|\belectricity\b/i],
  ["wallet", /\bwallet\b|\btransactions?\b/i],
  // Wave 11 Oma burn-down -- Office/Oma business-object domains were
  // missing from this list entirely, so "go back to that lead" / "what
  // about the meetings?" after switching away could never restore the
  // CRM/task/etc. result set the same way a Consumer/Facility domain
  // switch already could. Same domain strings the Office capability
  // modules themselves register under (see OfficeCorporateCapability
  // Modules.ts / OfficeActionCapabilityModules.ts).
  ["crm", /\bleads?\b|\bopportunit(?:y|ies)\b/i],
  ["office_tasks", /\btasks?\b/i],
  ["office_meetings", /\bmeetings?\b/i],
  ["office_support", /\bsupport\b/i],
  ["office_portfolio", /\bportfolio\b/i],
  ["corporate_partnerships", /\bpartnerships?\b/i],
];

export type DomainSwitchIntent = { type: "switch"; domain: string } | { type: "ambiguous" } | null;

// Two distinct triggers: an explicit "go back to X" always means switch (and
// asks for clarification if no domain is named), while a plain "tell me
// about the automation" / "what about the maintenance issue?" only switches
// when a domain IS named — otherwise it's left for the normal
// active-domain pronoun/detail resolution in parseFollowUpIntent (e.g.
// "tell me about that" with no domain keyword must keep working exactly as
// before). This is what makes cross-domain drill-down after a Room/Home
// Intelligence answer work without "go back" phrasing — see §23/§50 of the
// Programme 2 spec.
export function parseDomainSwitchIntent(message: string): DomainSwitchIntent {
  const m = text(message).toLowerCase();
  const isExplicitGoBack = /\bgo back\b|\bback to\b|\bswitch back\b/.test(m);
  const isDomainReference = /\btell me about\b|\bwhat about\b|\bexplain\b/.test(m);
  if (!isExplicitGoBack && !isDomainReference) return null;
  for (const [domain, re] of DOMAIN_KEYWORDS) {
    if (re.test(m)) return { type: "switch", domain };
  }
  return isExplicitGoBack ? { type: "ambiguous" } : null;
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

  // A request to decide what to handle first is a continuation over the
  // already-authorised result set, not a new broad CRM/operations query.
  // Keep this intentionally semantic and domain-neutral: ranking only uses
  // evidence attributes that the preceding capability actually supplied.
  if (
    (/\bwhich ones?\b|\bwhat should i\b/.test(m) && /\b(need attention|follow up|prioriti[sz]e|handle first)\b/.test(m)) ||
    /\bwhat should i (?:do|handle) first\b/.test(m) ||
    // A bare "Which ones?" (no qualifier) immediately after a list is the
    // same request without the extra words -- still a continuation over
    // the existing result set, not a new query.
    /^which ones?\??$/.test(m)
  ) {
    return { type: "prioritize" };
  }

  // A fresh imperative query ("Show meetings this week.") names its own
  // capability and must route there, not be swallowed as a continuation
  // over whatever result set happens to already be active -- the same
  // "never reuse an unrelated result set" principle the ordinal resolver
  // enforces elsewhere. Only messages that read as a genuine continuation
  // (a continuation cue word, or short with no query verb of their own)
  // count.
  const looksLikeFreshQuery = /^(?:please\s+)?(show|open|list|display|give me)\b/i.test(m);
  const isShortContinuation = !looksLikeFreshQuery && (/^(what about|and|how about|what's|whats)\b/.test(m) || m.split(/\s+/).filter(Boolean).length <= 4);
  if (isShortContinuation && (/\b(this|current)\s+week\b/.test(m) || /\b(last|previous)\s+week\b/.test(m) || /\b(this|current)\s+month\b/.test(m) || /\b(last|previous)\s+month\b/.test(m))) {
    return { type: "temporal_followup" };
  }

  // Filter continuity: "show only the high priority ones" / "just the open
  // ones" narrows the previously presented LIST (possibly to more than one
  // item) rather than selecting a single object — checked before the
  // single-object "the X one" attribute rules below, since "only"/"just"
  // is the disambiguating cue even when the keyword itself looks singular.
  //
  // Milestone 2 -- also "which ones are critical?" / "which are high
  // priority?", without "only"/"just" at all. Found in live production
  // verification: this exact phrasing (one of the brief's own examples,
  // "Which ones are critical?") fell through the filter check entirely,
  // fell through every other rule below too, and ended up in normal
  // capability routing with no domain noun to match a list capability's
  // supports() -- landing on the single-record module instead, which
  // honestly (but wrongly) reported no record was open.
  if ((/\b(only|just)\b/.test(m) && /\bones?\b/.test(m)) || /^which\s+(?:ones\s+are|are)\b/.test(m)) {
    const keyword = m
      .replace(/^(show|give|list)?\s*(me\s+)?(only|just)\s+(the\s+)?/, "")
      .replace(/^which\s+(ones?\s+)?(are|is)\s+/, "")
      .replace(/\bones?\b\.?$/, "")
      .replace(/\?$/, "")
      .trim();
    if (keyword) return { type: "filter", keyword };
  }

  // "the other one" / "which is the active one": a reference to a member of
  // the carried result set, never to an unrelated stale result.
  if (/\bother\s+one\b|^(?:and\s+|what about\s+)?the other\b/.test(m)) return { type: "other" };
  const stateOne = !/\bwhich\b/.test(m) ? null : m.match(/\b(active|inactive|resolved|closed|completed|current)\s+one\b/);
  if (stateOne) return { type: "attribute", attribute: stateOne[1] === "inactive" ? "inactive" : /resolved|closed|completed/.test(stateOne[1]) ? "resolved" : "active" };
  if (/\bunresolved\s+one\b|\bthe unresolved\b/.test(m)) return { type: "attribute", attribute: "unresolved" };
  if (/\bfailed\s+one\b|\bthe failed\b/.test(m)) return { type: "attribute", attribute: "failed" };
  if (/\bexpensive\s+one\b|\bmost expensive\b/.test(m)) return { type: "attribute", attribute: "expensive" };
  if (/\bhighest\s+one\b|\bthe highest\b/.test(m)) return { type: "attribute", attribute: "highest" };
  if (/\bopen\s+one\b|\bonly the open\b/.test(m)) return { type: "attribute", attribute: "open" };

  // Negative lookahead added in Phase 4 (Oyi Conversational Runtime
  // Completion Programme) -- found live in production: "the first" alone
  // matched "the first two"/"the first 3", a COUNT reference, not a
  // single-ordinal one, so a genuine batch request ("move the first two
  // to Monday") was being swallowed here as "give me the first item" and
  // never reaching the capability that actually handles multi-target
  // batches (office_tasks.write's own parseBatchTargetIntent). This
  // generic resolver only ever narrows to ONE object, so it must not
  // claim a phrase that names a count.
  if (/\bfirst\s+one\b/.test(m) || /\bthe first\b(?!\s+(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\b)/.test(m)) {
    return { type: "ordinal", ordinal: "first" };
  }
  if (/\bsecond\s+one\b|\bthe second\b/.test(m)) return { type: "ordinal", ordinal: "second" };
  if (/\bthird\s+one\b|\bthe third\b/.test(m)) return { type: "ordinal", ordinal: "third" };
  // "been X longest" is a duration superlative, not a count: the item whose
  // status has held longest is the one with the earliest occurred_at, i.e.
  // the same resolution as "oldest" (mirrors the newest/latest group below).
  if (/\boldest\b|\blongest\b/.test(m)) return { type: "ordinal", ordinal: "oldest" };
  if (/\bnewest\b|\blatest\b|\bmost recent\b/.test(m)) return { type: "ordinal", ordinal: "latest" };
  if (/\blast\s+one\b|\bthe last\b/.test(m)) return { type: "ordinal", ordinal: "last" };

  if (/\bwhy\b/.test(m) && m.split(/\s+/).filter(Boolean).length <= 8) return { type: "why" };

  if (/^(is|was|did|does)\s+(it|that|this|they|he|she)\b/.test(m)) return { type: "status_check" };
  if (/^(?:and\s+)?what\s+happened\s+(?:to|with)\s+(?:that|this|it)(?:\s+\w+)?\s*\??$/.test(m)) return { type: "status_check" };

  // "How much electricity have I used?" names its own topic (a utility)
  // and must reach that capability fresh, not be read as "how much did
  // THAT cost" against whatever result set happens to be active -- found
  // live: a prior wallet-history turn's transaction facts get tagged with
  // a utility category (e.g. "electricity"), so a bare "how much" here
  // would otherwise resolve to that unrelated transaction's amount and
  // report it as usage data, which is a fabrication, not an answer.
  if (/\bhow much\b/.test(m) && !/\b(electricity|water|gas|power|utility|utilities|internet)\b/i.test(m)) return { type: "field", field: "amount" };
  if (/^where\b/.test(m)) return { type: "field", field: "where" };
  if (/^when\b/.test(m)) return { type: "field", field: "when" };
  if (/^who\b/.test(m)) return { type: "field", field: "who" };

  if (/\btell me more\b|\bmore details?\b|\bmore info(rmation)?\b/.test(m)) return { type: "detail" };

  // "and units sold for that?": a named field of the subject just discussed
  const named = m.match(/^(?:and\s+|what about\s+|how about\s+)?(?:the\s+)?([a-z][a-z ]{2,40}?)\s+for\s+(?:that|this|it|them)\s*\??$/);
  if (named && !/^(?:how much|how many|who|when|where|why|what)\b/.test(named[1])) return { type: "named_field", phrase: named[1].trim() };

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
    active: ["active", "open", "in_progress", "pending", "unresolved", "checked_in", "arrived", "expected", "on"],
    inactive: ["inactive", "off", "resolved", "closed", "completed", "cancelled", "expired"],
    resolved: ["resolved", "closed", "completed", "done"],
  };
  const wanted = statusSynonyms[attribute] || [attribute];
  const matches = refs.filter((ref) => ref.status && (wanted.includes(ref.status) || (attribute === "active" && /^active\b/.test(ref.status) && !/^inactive/.test(ref.status))));
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

function priorityRank(ref: ResultSetObjectRef): number {
  const priority = (ref.attributes.priority || ref.attributes.severity || "").toLowerCase();
  if (["critical", "urgent"].includes(priority)) return 0;
  if (priority === "high") return 1;
  if (ref.attributes.overdue === "true" || /\boverdue\b/i.test(ref.attributes.reason || "")) return 2;
  if (priority === "medium") return 3;
  if (priority === "low") return 4;
  return 5;
}

// Stable sort preserves the source capability's explicit presentation order
// when the supplied evidence contains no stronger priority signal.  It never
// invents a score, fetches new records, or treats an absent field as a fact.
export function prioritizeResultSet(resultSet: ResultSetContext | null): ResultSetObjectRef[] {
  if (!resultSet) return [];
  return resultSet.object_refs
    .map((ref, index) => ({ ref, index, rank: priorityRank(ref) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.ref);
}

// "The other one": only meaningful relative to a selected object (or a pair).
// With more than two candidates and no selection it is genuinely ambiguous and
// the caller asks, naming the candidates.
// IQ-9A8 R4 precedence 5 (previous conversational subject): when no object is selected, the ONE record whose name the turn that produced this result set
// itself named ("is the Expected Visitor here yet?") is the subject. Zero or several named records mean there is no such subject; nothing is inferred.
const NAME_NOISE = new Set(["wave11", "the", "a", "an", "of", "and", "my", "your", "our", "issue", "request", "requests", "item", "visitor", "visitors", "record", "records"]);
function subjectNamedInSource(resultSet: ResultSetContext): ResultSetObjectRef | null {
  const sourceTokens = text(resultSet.source_message).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!sourceTokens.length) return null;
  const named = resultSet.object_refs.filter((ref) => {
    const tokens = text(ref.label).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !/^wave\d*$/.test(t));
    if (!tokens.length || tokens.every((t) => NAME_NOISE.has(t))) return false;
    // the whole name, as a contiguous run of exactly the same words ("expected visitor"; the plural "expected visitors" in a list question does not name one record)
    for (let i = 0; i + tokens.length <= sourceTokens.length; i++) if (tokens.every((t, k) => sourceTokens[i + k] === t)) return true;
    return false;
  });
  return named.length === 1 ? named[0] : null;
}

function resolveOther(resultSet: ResultSetContext): FollowUpResolution {
  const refs = resultSet.object_refs;
  if (refs.length < 2) return { status: "unresolved" };
  const selected = resultSet.selected_object_ref ?? subjectNamedInSource(resultSet);
  const rest = selected ? refs.filter((ref) => ref.canonical_id !== selected.canonical_id) : refs;
  if (selected && rest.length === 1) return { status: "resolved", ref: rest[0] };
  if (!selected && refs.length === 2) return { status: "ambiguous", candidates: refs };
  return { status: "ambiguous", candidates: rest };
}

function resolvePronoun(resultSet: ResultSetContext): FollowUpResolution {
  if (resultSet.selected_object_ref) return { status: "resolved", ref: resultSet.selected_object_ref };
  if (resultSet.object_refs.length > 1) { const named = subjectNamedInSource(resultSet); if (named) return { status: "resolved", ref: named }; }
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
  if (intent.type === "other") return resolveOther(resultSet);
  if (intent.type === "attribute") return resolveAttribute(resultSet, intent.attribute);
  if (intent.type === "pronoun" || intent.type === "named_field" || intent.type === "detail" || intent.type === "why" || intent.type === "status_check" || intent.type === "field") {
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

/** IQ-9A8 R4: a named field ("units sold") the subject's record does not carry is stated as absent, with what IS recorded; a carried field is read from the record, never invented. */
export function namedFieldAnswer(label: string, phrase: string, carried: Record<string, string>, status?: string | null): string {
  const tokens = text(phrase).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !["the", "and", "for", "that", "this", "any", "figure", "number"].includes(t));
  const hit = Object.entries(carried).find(([k, v]) => tokens.some((t) => k.toLowerCase().includes(t) || text(v).toLowerCase().includes(t)));
  if (hit) return `${label}: ${hit[0].replace(/_/g, " ")} ${hit[1]}${hit[0] === "units_sold" && carried.units_total ? ` of ${carried.units_total} units` : ""}${carried.status ? `; status ${carried.status}` : ""}.`;
  const recorded = Object.entries(carried).filter(([k, v]) => text(v) && k !== "status").slice(0, 4).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`);
  return `The record I listed for ${label} doesn't include a “${text(phrase)}” figure, so I can't give one. What it shows: ${[status ? `status ${status}` : "", ...recorded].filter(Boolean).join("; ") || "no further fields"}.`;
}
