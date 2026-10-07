import { createHash } from "node:crypto";
import type { ArtifactItem, DerivedRanking } from "../judgment/types";

// IQ-5: deterministic reference continuity against the ONE derived assessment artifact (ranking, comparison pair or assessment
// set). Pure functions: no I/O, no model, no retrieval. A pointer ("the second one", "the other one", "that project") is resolved
// from the artifact's own structure; a model is never asked what "second" means.

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const COUNTS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
const ORD = Object.keys(ORDINALS).join("|");
const NOUN = "priorit(?:y|ies)|rank(?:ing|ed)?|leads?|opportunit(?:y|ies)|projects?|reports?|tasks?|issues?|incidents?|problems?|concerns?|tickets?|requests?|meetings?|items?|things?|ones?";

export type ReferenceIntent = "why" | "why_not" | "detail" | "compare" | "wait" | "severity" | "which_first" | "unspecified";
export type DerivedReference = {
  intent: ReferenceIntent;
  positions: number[];             // 1-based positions named from the start, in the order named
  fromEnd: boolean;                // "last" / "bottom"
  topN: number | null;             // "the top two"
  other: boolean;                  // "the other one" / "the others"
  ret: boolean;                    // "go back to ..."
  demonstrative: boolean;          // "that one", "that project", "this"
  plural: boolean;                 // "those", "these", "the others"
  noun: string | null;             // the type noun the user used ("lead", "priority", "issue" ...)
  explicitArtifact: boolean;       // the wording itself names the derived artifact ("priority", "ranking", "top", "those priorities")
  numeric: boolean;                // "#2", "number 2", "2nd"
  now: boolean;                    // asks for the CURRENT state ("now", "currently", "today")
  any: boolean;                    // the turn carries a derived-reference cue at all
};

const CARD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const CARD_RE = Object.keys(CARD).join("|");
const NUM_RE = new RegExp(`(?:^|[\\s(])(?:#\\s*(\\d{1,2})|(?:number|no\\.?|num)\\s*(\\d{1,2}))\\b|\\b(\\d{1,2})(?:st|nd|rd|th)\\b|\\b(?:number|no\\.?|#)\\s*(${CARD_RE})\\b`, "gi");

export const DERIVED_REFERENCE_CUE = new RegExp(
  `\\b(?:the\\s+)?(?:${ORD}|last|top|bottom)\\s+(?:one|${NOUN})\\b|\\b(?:the\\s+)?(?:${ORD}|last)\\b|\\b(?:the\\s+)?(?:top|bottom)\\s+(?:two|three|four|five|\\d)\\b|(?:#\\s*\\d|\\bnumber\\s*(?:\\d|${CARD_RE})\\b|\\bno\\.?\\s*\\d|\\b\\d(?:st|nd|rd|th)\\b)|\\b(?:the\\s+)?other\\s+(?:one|two|ones)\\b|\\bthe\\s+others\\b|\\bwhich\\s+of\\s+(?:those|these|them)\\b|\\b(?:those|these)\\s+(?:${NOUN})\\b|\\bgo\\s+back\\s+to\\b`, "i");

export function parseDerivedReference(text: string): DerivedReference {
  const t = text.toLowerCase();
  const positions: number[] = [];
  const found: Array<{ i: number; n: number }> = [];
  for (const m of t.matchAll(new RegExp(`\\b(${ORD})\\b`, "g"))) found.push({ i: m.index!, n: ORDINALS[m[1]] });
  for (const m of t.matchAll(NUM_RE)) { const n = m[4] ? CARD[m[4].toLowerCase()] : Number(m[1] || m[2] || m[3]); if (n >= 1 && n <= 99) found.push({ i: m.index!, n }); }
  for (const f of found.sort((a, b) => a.i - b.i)) if (!positions.includes(f.n)) positions.push(f.n);
  const topM = /\b(?:top|best|first)\s+(two|three|four|five|\d)\b/.exec(t);
  const topN = topM ? (COUNTS[topM[1]] ?? Number(topM[1])) : null;
  const fromEnd = /\b(?:last|bottom|final)\b/.test(t) && !/\blast\s+(?:week|month|year|night|time|update|turn)\b/.test(t);
  const other = /\b(?:the\s+)?other\s+(?:one|two|ones)\b|\bthe\s+others\b|\banother\s+one\b/.test(t);
  const ret = /\b(?:go\s+back|return|back)\s+to\b|^\s*go\s+back\b/.test(t);
  const plural = /\b(?:those|these|the\s+others|them|all\s+of\s+(?:them|those))\b/.test(t);
  const demonstrative = /\b(?:that|this)\s+(?:one|thing|item|issue|problem|concern|project|opportunity|lead|task|ownership issue)\b|\bwhy\s+(?:that|this)\b|\b(?:is|was|does)\s+(?:that|this)\b|\bwhat about\s+(?:that|this|it)\b/.test(t) || /^\s*(?:and\s+)?(?:why|how)\s*(?:so)?\s*[?.!]*\s*$/.test(t);
  const nm = new RegExp(`\\b(?:${ORD}|last|top|bottom|that|this|those|these|other|another)\\s+(${NOUN})\\b`).exec(t) || new RegExp(`\\b(?:number|no\\.?|#)\\s*\\d+\\s+(${NOUN})\\b`).exec(t) || new RegExp(`\\b(priorit(?:y|ies)|ranking)\\b`).exec(t);
  const noun = nm ? singular(nm[1]) : null;
  const explicitArtifact = /\bpriorit(?:y|ies)\b|\branking\b|\branked\b|\btop\s+(?:two|three|four|five|\d|one)\b|\bwhich\s+(?:first|matters?\s+most)\b|\bmost\s+important\b/.test(t) || noun === "priority" || noun === "ranking" || noun === "rank";
  const intent: ReferenceIntent = /\bwhy\s+not\b/.test(t) ? "why_not" : /\bwhy\b|\bhow\s+come\b|\bwhat\s+makes\b/.test(t) ? "why"
    : /\bcompare\b|\bversus\b|\bvs\.?\b|\brather\s+than\b|\bor\s+the\b|\bcompared\b/.test(t) ? "compare"
    : /\b(?:can|could)\b.*\bwait\b|\bnot\s+urgent\b|\bless\s+(?:important|urgent)\b/.test(t) ? "wait"
    : /\b(?:danger(?:ous)?|safe|serious|worry|worried|risky|urgent|bad|a\s+problem)\b/.test(t) ? "severity"
    : /\bwhich\b.*\bfirst\b|\bwhich\s+one\b/.test(t) ? "which_first"
    : /\b(?:tell\s+me\s+more|more\s+about|what\s+about|detail|explain|go\s+back)\b|\bwhat\s+is\b/.test(t) ? "detail" : "unspecified";
  const now = /\b(?:now|currently|right\s+now|today|at\s+the\s+moment|latest|these\s+days)\b/.test(t);
  const any = DERIVED_REFERENCE_CUE.test(text) || other || ret || topN !== null || demonstrative || (plural && /\b(?:wait|first|matter)\b/.test(t));
  return { intent, positions, fromEnd, topN, other, ret, demonstrative, plural, noun, explicitArtifact, numeric: new RegExp(`#\\s*\\d|number\\s*(?:\\d|${CARD_RE})\\b|no\\.?\\s*\\d|\\b\\d(?:st|nd|rd|th)\\b`).test(t), now, any };
}
function singular(n: string) { return n.replace(/ies$/, "y").replace(/s$/, ""); }

// Which type nouns point at raw domain objects rather than at the derived artifact. A specific noun must also match an item.
const NOUN_MATCH: Record<string, (i: ArtifactItem) => boolean> = {
  lead: i => /^crm\.leads/.test(i.source_key || ""), opportunity: i => /^crm\.opp|corporate/.test(i.source_key || ""),
  project: i => /^development/.test(i.source_key || ""), report: i => /^reports/.test(i.source_key || ""),
  task: i => i.kind === "task", meeting: i => i.kind === "event",
  issue: i => i.kind === "issue", incident: i => i.kind === "issue", problem: i => i.kind === "issue", ticket: i => i.kind === "issue", request: i => i.kind === "issue", concern: i => i.kind === "issue",
};
const GENERIC = new Set(["item", "thing", "one", "priority", "ranking", "rank", "ranked"]);

export type RawSetFacts = { created_at: string; domain: string | null; object_nouns: string[] } | null;
export type ReferenceEnv = { artifact: DerivedRanking; now: number; raw: RawSetFacts; scopeOk: boolean; authorityOk: boolean };

export type Resolution =
  | { status: "none" }
  | { status: "defer_raw"; reason: "newer_raw_result_set" | "type_noun_names_other_objects" | "no_matching_items" }
  | { status: "resolved"; items: ArtifactItem[]; ref: DerivedReference; how: string; focusDefaulted?: boolean }
  | { status: "out_of_range"; wanted: number; count: number; group: string }
  | { status: "ambiguous"; reason: "parked_subject" | "no_focus" | "no_basis_for_other" | "several_matches"; options: ArtifactItem[] }
  | { status: "unavailable"; reason: "expired" | "scope" | "authority" | "stale_current" | "not_ordered" | "no_items" };

export const primaryGroup = (a: DerivedRanking): ArtifactItem[] => {
  const g = a.items.some(i => i.group === "ranked") ? "ranked" : a.items.some(i => i.group === "compared") ? "compared" : "attention";
  return a.items.filter(i => (i.group ?? "ranked") === g || (g === "attention" && !i.group));
};
export const isOrdered = (a: DerivedRanking) => (a.artifact_type ?? "ranking") === "ranking";
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export function namedItems(text: string, a: DerivedRanking): ArtifactItem[] {
  const t = ` ${norm(text)} `;
  return a.items.filter(i => { const l = norm(i.ref.label || ""); return l.length >= 3 && t.includes(` ${l} `); });
}

export function isExpired(a: DerivedRanking, now: number) { return !(Date.parse(a.expires_at) > now); }

export function resolveDerivedReference(text: string, env: ReferenceEnv): Resolution {
  const ref = parseDerivedReference(text);
  const a = env.artifact;
  const named = namedItems(text, a);
  if (!ref.any && !named.length) return { status: "none" };
  if (!env.scopeOk) return { status: "unavailable", reason: "scope" };
  if (!env.authorityOk) return { status: "unavailable", reason: "authority" };
  if (isExpired(a, env.now)) return { status: "unavailable", reason: "expired" };
  const primary = primaryGroup(a);
  const all = a.items;
  // 1. An explicit type noun that names raw domain objects (and no derived-artifact wording) belongs to the raw result set, unless
  //    nothing raw of that type exists to take it.
  const specific = ref.noun && !GENERIC.has(ref.noun) ? ref.noun : null;
  if (specific && !ref.explicitArtifact) {
    const matching = all.filter(NOUN_MATCH[specific] || (() => false));
    if (!matching.length) return { status: "defer_raw", reason: "no_matching_items" };
    if (env.raw && env.raw.object_nouns.includes(specific) && !ref.demonstrative) return { status: "defer_raw", reason: "type_noun_names_other_objects" };
  }
  // 2. A raw result set presented AFTER the artifact owns a bare pointer; the artifact needs an explicit cue to win it back.
  const cued = ref.explicitArtifact || ref.ret || ref.topN !== null || named.length > 0 || ref.other || ref.demonstrative || ref.plural;
  if (env.raw && Date.parse(env.raw.created_at) > Date.parse(a.updated_at || a.created_at) && !cued && !ref.explicitArtifact) return { status: "defer_raw", reason: "newer_raw_result_set" };
  // 3. A parked artifact (another subject is active) is restored only by a return cue, an explicit artifact cue or a named item.
  if (a.parked && !(ref.ret || ref.explicitArtifact || ref.topN !== null || named.length)) return { status: "ambiguous", reason: "parked_subject", options: primary.slice(0, 5) };
  // 4. Asking for what is current from a judgment that predates a material fact: say so; do not present it as current.
  if (a.stale && ref.now && (ref.positions.length || ref.topN !== null || ref.fromEnd || ref.intent === "which_first")) return { status: "unavailable", reason: "stale_current" };
  if (!all.length) return { status: "unavailable", reason: "no_items" };
  const focus = a.focus && primary.find(i => i.rank === a.focus) ? a.focus : null;
  const byRank = (n: number) => primary.find(i => i.rank === n);
  // Named items resolve directly.
  if (named.length && !ref.positions.length && !ref.other && ref.topN === null) return { status: "resolved", items: named.slice(0, 2), ref, how: "named" };
  // Ordered vocabulary on an unordered artifact: positions are positions in what I listed, never "priority"; top/bottom claim an order.
  if ((ref.topN !== null || (ref.fromEnd && /bottom/i.test(text)) || ref.intent === "which_first" || /\btop\b|\bbottom\b/i.test(text)) && !isOrdered(a)) return { status: "unavailable", reason: "not_ordered" };
  if (ref.topN !== null) {
    const items = primary.filter(i => i.rank <= ref.topN!);
    return items.length ? { status: "resolved", items, ref, how: `top_${ref.topN}` } : { status: "unavailable", reason: "no_items" };
  }
  if (ref.positions.length) {
    const picked: ArtifactItem[] = [];
    for (const n of ref.positions) {
      const it = byRank(n);
      if (!it) return { status: "out_of_range", wanted: n, count: primary.length, group: primary[0]?.group ?? "ranked" };
      picked.push(it);
    }
    return { status: "resolved", items: picked, ref, how: ref.numeric ? "numeric_position" : "ordinal_position" };
  }
  if (ref.fromEnd) { const last = primary[primary.length - 1]; return last ? { status: "resolved", items: [last], ref, how: "last" } : { status: "unavailable", reason: "no_items" }; }
  if (ref.other) {
    if (primary.length === 2) {
      const f = focus ?? 1; const o = primary.find(i => i.rank !== f);
      return o ? { status: "resolved", items: [o], ref, how: "other_of_pair", focusDefaulted: focus === null } : { status: "unavailable", reason: "no_items" };
    }
    if (focus !== null) return { status: "resolved", items: primary.filter(i => i.rank !== focus), ref, how: "others_than_focus" };
    return { status: "ambiguous", reason: "no_basis_for_other", options: primary.slice(0, 5) };
  }
  if (ref.intent === "wait" || (ref.plural && /\bwait\b/i.test(text))) return { status: "resolved", items: primary, ref, how: "which_can_wait" };
  if (ref.ret) {
    if (specific) { const m = primary.filter(NOUN_MATCH[specific] || (() => false)); if (m.length === 1) return { status: "resolved", items: m, ref, how: "return_to_item" }; }
    return { status: "resolved", items: primary, ref, how: "return_to_artifact" };
  }
  if (ref.intent === "which_first" || ref.explicitArtifact && ref.plural) return { status: "resolved", items: primary, ref, how: "artifact_set" };
  if ((ref.intent === "why" || ref.intent === "detail") && focus === null && primary.length > 1 && /^\s*(?:and\s+)?(?:why|how)\s*(?:so)?\s*[?.!]*\s*$/i.test(text)) return { status: "resolved", items: primary, ref, how: "explain_set" };
  if (ref.demonstrative || ref.plural) {
    if (specific) {
      const m = primary.filter(NOUN_MATCH[specific] || (() => false));
      if (m.length === 1) return { status: "resolved", items: m, ref, how: "demonstrative_with_noun" };
      if (focus !== null && m.some(i => i.rank === focus)) return { status: "resolved", items: [byRank(focus)!], ref, how: "focus" };
      if (m.length > 1) return { status: "ambiguous", reason: "several_matches", options: m.slice(0, 5) };
    }
    if (focus !== null) return { status: "resolved", items: [byRank(focus)!], ref, how: "focus" };
    if (primary.length === 1) return { status: "resolved", items: primary, ref, how: "only_item" };
    if (ref.plural) return { status: "resolved", items: primary, ref, how: "artifact_set" };
    return { status: "ambiguous", reason: "no_focus", options: primary.slice(0, 5) };
  }
  return { status: "none" };
}

// Authority/scope binding: the artifact stores no authority, only the scope it was made in. Both are re-checked on every dereference.
export const scopeBinding = (surface: string, oisContext: { estate_id?: string | null; home_id?: string | null } | null | undefined) =>
  createHash("sha256").update([surface, oisContext?.estate_id || "", oisContext?.home_id || ""].join("|")).digest("hex").slice(0, 16);

// --- composing: Core composes the text, only from strings the artifact already holds (they passed validation when it was minted) ---
const WORD: Record<string, string> = { critical: "critical", high: "high", medium: "medium", low: "low", overdue: "overdue", due_within_48h: "due within 48 hours", later: "not due soon", active: "open", historical: "resolved or past", unknown: "status not clear" };
const DIM: Record<string, string> = { lifecycle: "whether it is still open", importance: "the recorded priority or severity", time_pressure: "timing" };
const lv = (i: ArtifactItem, d: string) => i.factors.find(f => f.dimension === d)?.level ?? null;
const label = (i: ArtifactItem) => i.ref.label || "that item";
// The stored rationale begins "Label: ..."; when the answer already names the item, say only the reason.
const reason = (i: ArtifactItem) => { const r = i.rationale.replace(/\.$/, ""); const l = i.ref.label; return l && r.startsWith(`${l}: `) ? r.slice(l.length + 2) : r; };

function differsBy(upper: ArtifactItem, lower: ArtifactItem): string | null {
  for (const d of ["lifecycle", "importance", "time_pressure"]) {
    const x = lv(upper, d), y = lv(lower, d);
    if (x !== y) return `${DIM[d]}: ${label(upper)} is recorded as ${x ? WORD[x] || x : "not recorded"}, ${label(lower)} as ${y ? WORD[y] || y : "not recorded"}`;
  }
  return null;
}

function basisLine(a: DerivedRanking): string {
  const partial = (a.limitations || []).some(l => /partial|bounded|only what/i.test(l)) || (a.uncertainties || []).length > 0;
  return `This rests only on the evidence recorded when I produced it${partial ? ", which was partial or not fully current" : ""}; I have not looked at the records again.`;
}
const stalePrefix = (a: DerivedRanking) => a.stale ? ` This was produced before you told me something that may change it, and I have not reassessed it, so treat it as the earlier assessment, not the current one.` : "";
const place = (a: DerivedRanking, i: ArtifactItem) => isOrdered(a) ? `number ${i.rank} in the order I gave` : (a.artifact_type === "comparison" ? `${i.rank === 1 ? "the first" : "the second"} of the pair I compared (I did not rank them)` : `item ${i.rank} of those I listed (a listing, not a priority order)`);

function explainOne(a: DerivedRanking, i: ArtifactItem, intent: ReferenceIntent): string {
  const primary = primaryGroup(a);
  const typed = i.kind === "issue" || i.kind === "task" || i.kind === "event";
  const parts: string[] = [`${label(i)} was ${place(a, i)}: ${reason(i)}.`];
  if (isOrdered(a) && (intent === "why" || intent === "why_not" || intent === "detail")) {
    const above = primary.find(x => x.rank === i.rank - 1);
    const below = primary.find(x => x.rank === i.rank + 1);
    if (a.basis === "provider") {
      // Business records differ in recorded notes, not in typed fields: the order is a comparative judgment, and its reason is the
      // evidence-linked rationale recorded with each item. Core does not invent a typed difference that does not exist.
      if (above) parts.push(`It was placed below ${label(above)} (${reason(above)}).`);
      if (below) parts.push(`It was placed above ${label(below)} (${reason(below)}).`);
      parts.push("That order came from a comparative judgment on the recorded notes, not from a single recorded field, so it is a considered view rather than a measurement.");
    } else {
      if (above) { const d = differsBy(above, i); parts.push(d ? `It sat below ${label(above)} on ${d}.` : `${label(above)} and ${label(i)} are equal on everything I recorded, so the evidence gives no basis to separate them; they only appear in that sequence.`); }
      if (below) { const d = differsBy(i, below); parts.push(d ? `It sat above ${label(below)} on ${d}.` : `${label(below)} is equal to it on what is recorded.`); }
    }
    if (!above && !below && primary.length === 1) parts.push("It was the only item in that ordering.");
  }
  if (i.state === "not_a_current_concern") parts.push("It is recorded as resolved or past, so it was not treated as a current concern.");
  if (i.state === "cannot_confirm") parts.push("Its status is not clear in the records, so I could not confirm whether it is current.");
  if (typed && !lv(i, "importance")) parts.push("No priority or severity was recorded for it, which I did not fill in.");
  return parts.join(" ");
}

export function composeReferenceAnswer(a: DerivedRanking, res: Extract<Resolution, { status: "resolved" }>, text: string): string {
  const intent = res.ref.intent;
  const lines: string[] = [];
  if (res.focusDefaulted) lines.push(`I took "the other one" to mean the one besides ${label(primaryGroup(a)[0])}, which I led with.`);
  const items = res.items;
  if (res.how === "which_can_wait" || intent === "wait") {
    const wait = a.items.filter(i => i.group === "wait" || i.group === "past" || i.state === "not_a_current_concern");
    const lowest = isOrdered(a) ? primaryGroup(a).slice(-1)[0] : null;
    if (wait.length) lines.push(`Of what I set out, these were recorded as able to wait or not a current concern: ${wait.map(i => `${label(i)} (${i.rationale.replace(/^.*?:\s*/, "").replace(/\.$/, "")})`).join("; ")}.`);
    else lines.push("Nothing in what I set out was recorded as resolved or able to wait.");
    if (lowest && !wait.some(i => i.ref.id && i.ref.id === lowest.ref.id)) lines.push(`${label(lowest)} was lowest in the order, but the records alone do not show that it can wait; that depends on what is not recorded.`);
  } else if (items.length >= 2 && (intent === "compare" || res.how.startsWith("top_") || res.how === "ordinal_position" || res.how === "numeric_position")) {
    const [x, y] = items;
    lines.push(`${label(x)} (${place(a, x)}) and ${label(y)} (${place(a, y)}).`);
    lines.push(`${label(x)}: ${reason(x)}. ${label(y)}: ${reason(y)}.`);
    const d = differsBy(x, y) || differsBy(y, x);
    if (a.basis === "provider" && isOrdered(a)) lines.push(`${label(x)} was placed above ${label(y)} by a comparative judgment on the recorded notes, not by a single recorded field.`);
    else lines.push(isOrdered(a) || a.artifact_type === "comparison" ? (d ? `They differ on ${d}.` : "They are equal on everything I recorded, so the evidence gives no basis to separate them.") : "I listed them without ranking them.");
    for (const extra of items.slice(2)) lines.push(`${label(extra)}: ${extra.rationale.replace(/\.$/, "")}.`);
  } else if (items.length === 1 || res.how === "others_than_focus") {
    for (const i of items) lines.push(explainOne(a, i, intent));
  } else if (res.how === "explain_set") {
    lines.push(isOrdered(a) ? "Here is why they are in that order, from what was recorded:" : "Here is what was recorded about each item I listed (it was not a ranking):");
    items.forEach((i, n) => { lines.push(`${i.rank}. ${i.rationale.replace(/\.$/, "")}.`); const nx = items[n + 1]; if (isOrdered(a) && nx) { const d = differsBy(i, nx); lines.push(d ? `${label(i)} sits above ${label(nx)} on ${d}.` : `${label(i)} and ${label(nx)} are equal on what is recorded.`); } });
  } else if (res.how === "return_to_artifact" || res.how === "artifact_set") {
    const noun = isOrdered(a) ? "the order I gave" : a.artifact_type === "comparison" ? "the pair I compared" : "what I listed";
    lines.push(`Going back to ${noun}: ${items.map(i => `${i.rank}. ${i.rationale.replace(/\.$/, "")}`).join("; ")}.`);
    if (!isOrdered(a)) lines.push("That was not a ranking, so no item comes before another.");
  } else {
    for (const i of items) lines.push(explainOne(a, i, intent));
  }
  if (intent === "severity") lines.push("That is what the records show. It does not establish whether this is dangerous or safe: anything that was not recorded or observed is not evidence either way.");
  const unc = (a.uncertainties || []).slice(0, 2); if (unc.length) lines.push(`What I could not confirm then: ${unc.map(u => u.replace(/[.\s]*$/, "")).join("; ")}.`);
  lines.push(basisLine(a) + stalePrefix(a));
  return lines.join(" ");
}

export function composeNonResolution(res: Exclude<Resolution, { status: "none" } | { status: "resolved" } | { status: "defer_raw" }>, a: DerivedRanking | null): string {
  const names = (o: ArtifactItem[]) => o.map(i => `${i.rank}. ${label(i)}`).join("; ");
  if (res.status === "out_of_range") return `That ${isOrdered(a!) ? "ordering" : "list"} only has ${res.count} item${res.count === 1 ? "" : "s"}, so there is no number ${res.wanted}. I am not going to substitute an item from somewhere else.`;
  if (res.status === "ambiguous") {
    if (res.reason === "parked_subject") return `We have moved to a different topic since I set those out. Do you mean the earlier ${a && isOrdered(a) ? "ordering" : "list"}? It was: ${names(res.options)}. Tell me which item you want, or say "go back to those" and I will return to it.`;
    if (res.reason === "no_basis_for_other") return `I am not sure which one you are setting aside. The items were: ${names(res.options)}. Which do you mean?`;
    return `More than one of them could be what you mean: ${names(res.options)}. Which one?`;
  }
  switch (res.reason) {
    case "expired": return "That assessment is no longer current: I only hold one for a short time and it has expired. I would need to assess again from current records before saying anything about its items.";
    case "scope": return "That assessment was made for a different scope than the one this conversation is in now, so I will not use it here.";
    case "authority": return "I can no longer use that earlier assessment: the access it depended on has changed, so I will not repeat its items.";
    case "stale_current": return `I cannot say what comes first now. The ordering I gave was made before you told me something that may change it, and I have not reassessed it. I can still explain why items were ordered as they were at the time.`;
    case "not_ordered": return "I did not rank these. I named them as what the records show needs attention, so there is no top or bottom to point to; I can tell you about any of them by name or by their place in the list.";
    default: return "There is nothing in that assessment to point to.";
  }
}
