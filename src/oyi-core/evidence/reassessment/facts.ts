import { isAssessmentInformation } from "../../context/conversationAssessmentContext";
import type { ArtifactItem, DerivedRanking } from "../judgment/types";
import { itemsOfNoun, namedItems, parseDerivedReference, primaryGroup } from "../reference/derivedReference";

// IQ-6: conversational material facts. This is NOT a new fact parser: "is this a statement of information at all" is the IQ-2
// predicate (isAssessmentInformation); this module only sorts such a statement into a type, binds it to an assessed candidate and
// names the evidence classes it could affect. Every fact stays USER-SUPPLIED and UNVERIFIED unless authorised evidence says otherwise.
export type FactType = "material_new_fact" | "correction" | "confirmation" | "non_material_detail" | "opinion" | "hypothetical" | "question" | "unverified_claim";
export type ConversationFact = {
  id: string; text: string; type: FactType; status: "user_supplied_unverified"; attributed: boolean;
  target: { id: string | null; label: string | null } | null; target_status: "bound" | "ambiguous" | "none";
  classes: string[]; at: string; superseded_by: string | null; corrects: string | null;
};
export const MAX_FACTS = 6;

const CLASS_KEYWORDS: Array<[string[], RegExp]> = [
  [["office_financial", "office_development"], /financ|fund|capital|payment|cash|budget/i],
  [["office_development", "office_reports"], /\b(?:title|survey|approval|permit|blocker|blocked|dispute|disputed|planning|consent)\b/i],
  [["crm"], /\b(?:lead|prospect|opportunit|deal|feasibility|owner mandate|return|jv|buyer)\w*/i],
  [["maintenance"], /\b(?:leak|water|repair|repaired|plumb|maintenance|fixed|resolved|panel|pipe)\w*/i],
  [["security"], /\b(?:incident|break-?in|alarm|intruder|theft)\w*/i],
  [["cameras"], /\b(?:camera|cctv)\w*/i],
  [["visitors"], /\b(?:visitor|arriv|guest|expected|cleared)\w*/i],
  [["device_observed_value", "device_availability"], /\b(?:ac|lock|door|device|sensor|temperature|hot|cold|light|window)\b/i],
  [["corporate_opportunity"], /\b(?:sqm|land|family|sell|sale|lease|jv|lagos|abuja|lekki|epe|vi)\b|title/i],
];
export const affectedClasses = (text: string): string[] => [...new Set(CLASS_KEYWORDS.filter(([, re]) => re.test(text)).flatMap(([c]) => c))];

const STOP = new Set(["resolved", "unresolved", "open", "closed", "fixed", "repaired", "secured", "worse", "still", "already", "again", "yet", "back", "online", "offline", "none", "project", "projects", "opportunity", "opportunities", "lead", "leads", "request", "task", "report", "priority", "with", "from", "that", "this", "issue", "item", "lead", "wave11", "the", "and", "for", "have", "has", "been", "there", "their", "they", "says", "said", "now", "just", "very", "more", "much", "than", "then", "actually", "it's", "its", "not", "also", "into", "about", "because", "which", "while", "when", "what", "were", "was", "are", "you", "your", "our", "can", "will"]);
const tokens = (t: string) => new Set(t.toLowerCase().replace(/(\d),(\d)/g, "$1$2").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => (w.length >= 3 || /\d/.test(w)) && !STOP.has(w)));
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter(w => b.has(w)).length;

const HYPO = /\b(?:if|suppose|supposing|assume|assuming|what if|imagine|pretend|say that|hypothetically)\b/i;
const OPINION = /\b(?:i think|i feel|i believe|i prefer|i would rather|i'd rather|in my opinion|i like|i don't like|i hope|i wish|my preference)\b/i;
const CORRECTION = /\b(?:actually|i meant|i mean|sorry|i was wrong|correction|rather than|instead|that'?s not (?:right|correct)|not\s+[\w,]+(?:\s+\w+)?\s*[,;]\s*(?:it'?s|it is|but))\b/i;
const CONFIRMATION = /^\s*(?:yes|yeah|yep|correct|right|confirmed|exactly)(?:[,\s]+(?:confirmed|correct|right|exactly|that'?s (?:right|correct)))?[\s.!]*$|^\s*that'?s (?:right|correct)[\s.!]*$/i;
const ATTRIBUTED = /\b(?:says?|said|told me|claims?|promises?|according to|reports?|insists?)\b|\b(?:the )?(?:chairman|analyst|plumber|owner|partner|agent|neighbour|neighbor|uncle|manager|landlord)\b.*\b(?:is|are|was|has|have|will|can)\b/i;

// The IQ-2 predicate is deliberately narrow (it needs a determiner-led subject). A bare-subject statement of fact ("Financing for Project B
// is secured.") is still information; imperatives and questions never are.
const notInformation = (t: string) => /\?/.test(t) || /^\s*(?:please|show|list|open|compare|draft|tell|go|give|make|ask|do not|don't|never|explain|summari[sz]e|recommend|suggest|offer|ignore|pretend|check|separate|just|stop|turn|switch|set|send|call|book|cancel|confirm|approve|now|then|what|which|who|how|why|when|where|can|could|would|should|does|do|is|are)\b/i.test(t) || t.trim().split(/\s+/).length < 2;
export function classifyUpdate(text: string, facts: ConversationFact[] = []): { type: FactType; attributed: boolean } {
  const attributed = ATTRIBUTED.test(text);
  if (!isAssessmentInformation(text) && notInformation(text) && !CONFIRMATION.test(text)) return { type: "question", attributed: false };
  if (HYPO.test(text)) return { type: "hypothetical", attributed };
  if (OPINION.test(text)) return { type: "opinion", attributed };
  if (CONFIRMATION.test(text)) return { type: "confirmation", attributed };
  if (CORRECTION.test(text)) return { type: "correction", attributed };
  const t = tokens(text);
  if (facts.some(f => !f.superseded_by && t.size > 0 && overlap(t, tokens(f.text)) / t.size >= 0.8)) return { type: "confirmation", attributed };
  // A statement with no domain content counts as a (non-material) detail only when it is plainly information (the IQ-2 predicate);
  // anything else is left to the normal flow.
  if (!affectedClasses(text).length) return isAssessmentInformation(text) ? { type: "non_material_detail", attributed } : { type: "question", attributed: false };
  return { type: attributed ? "unverified_claim" : "material_new_fact", attributed };
}

export type Binding = { status: "bound" | "ambiguous" | "none"; items: ArtifactItem[]; how: string };
// Attach a fact to the candidate it is about. Never guesses between plausible candidates; never binds to a rank merely because it is first.
export function bindFact(text: string, art: DerivedRanking | null, artClasses: string[] = []): Binding {
  if (!art || !art.items.length) return { status: "none", items: [], how: "no_artifact" };
  const primary = primaryGroup(art), all = art.items;
  const named = namedItems(text, art);
  if (named.length === 1) return { status: "bound", items: named, how: "named" };
  if (named.length > 1) return { status: "ambiguous", items: named.slice(0, 4), how: "several_named" };
  const ref = parseDerivedReference(text);
  const focus = art.focus ? primary.find(i => i.rank === art.focus) : null;
  if (ref.positions.length === 1) { const it = primary.find(i => i.rank === ref.positions[0]); if (it) return { status: "bound", items: [it], how: "position" }; }
  if (ref.noun && !["priority", "ranking", "rank", "item", "thing", "one"].includes(ref.noun)) {
    const m = itemsOfNoun(art, ref.noun);
    if (m.length === 1) return { status: "bound", items: m, how: "noun" };
    if (m.length > 1) return focus && m.includes(focus) ? { status: "bound", items: [focus], how: "noun_and_focus" } : { status: "ambiguous", items: m.slice(0, 4), how: "several_of_type" };
  }
  const t = tokens(text), hit = all.filter(i => overlap(tokens(i.ref.label || ""), t) > 0);
  if (hit.length === 1) return { status: "bound", items: hit, how: "shared_word" };
  if (hit.length > 1) return { status: "ambiguous", items: hit.slice(0, 4), how: "several_shared_words" };
  if (ref.demonstrative && focus) return { status: "bound", items: [focus], how: "focus" };
  // A lone item is bound only when the fact is about the same kind of thing; "the bedroom is hot" does not attach to a water leak.
  if (primary.length === 1 && affectedClasses(text).some(c => artClasses.includes(c))) return { status: "bound", items: primary, how: "single_salient" };
  return { status: "none", items: [], how: "no_basis" };
}

export function makeFact(text: string, cls: { type: FactType; attributed: boolean }, binding: Binding, facts: ConversationFact[], now: number): ConversationFact {
  const id = `f${facts.length + 1}-${now.toString(36)}`;
  const target = binding.status === "bound" ? { id: binding.items[0].ref.id, label: binding.items[0].ref.label } : null;
  // A correction supersedes the active fact it is about: same bound target, or the most shared content words. Both values are never current.
  let corrects: string | null = null;
  if (cls.type === "correction") {
    const t = tokens(text); let best = 0;
    for (const f of facts) if (!f.superseded_by) { const s = overlap(t, tokens(f.text)) + (target && f.target?.id === target.id ? 2 : 0); if (s > best) { best = s; corrects = f.id; } }
  }
  return { id, text: text.slice(0, 300), type: cls.type, status: "user_supplied_unverified", attributed: cls.attributed, target, target_status: binding.status, classes: affectedClasses(text), at: new Date(now).toISOString(), superseded_by: null, corrects };
}

export function addFact(facts: ConversationFact[], fact: ConversationFact): ConversationFact[] {
  const next = facts.map(f => (fact.corrects === f.id ? { ...f, superseded_by: fact.id } : f)).concat(fact);
  while (next.length > MAX_FACTS) { const i = next.findIndex(f => f.superseded_by); next.splice(i >= 0 ? i : 0, 1); }
  return next;
}
export const activeFacts = (facts: ConversationFact[] | undefined | null) => (facts || []).filter(f => !f.superseded_by && ["material_new_fact", "unverified_claim", "correction"].includes(f.type));
