import { analyse, isCancellationText, isCapabilityInquiryText, sentencesOf } from "../../interpretation/semanticObjective";
import { domainHits } from "../../interpretation/domainVocabulary";
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

// Evidence classes a fact can affect, by domain (planner class names). Domain vocabulary only; see interpretation/domainVocabulary.ts.
const DOMAIN_CLASSES: Record<string, string[]> = {
  office_financial: ["office_financial", "office_development"], office_development: ["office_development", "office_reports"], crm: ["crm"], office_reports: ["office_reports"],
  maintenance: ["maintenance"], security: ["security"], cameras: ["cameras"], visitors: ["visitors"], devices: ["device_observed_value", "device_availability"],
  utilities: ["utilities_usage"], wallet: ["wallet"], rooms: ["device_observed_value", "device_availability"], environment: ["device_observed_value", "device_availability"],
  corporate_opportunity: ["corporate_opportunity", "office_development", "crm"],
};
export const affectedClasses = (text: string): string[] => [...new Set(domainHits(analyse(text).tokens).flatMap(h => DOMAIN_CLASSES[h.domain] ?? []))];

const STOP = new Set(["resolved", "unresolved", "open", "closed", "fixed", "repaired", "secured", "worse", "still", "already", "again", "yet", "back", "online", "offline", "none", "project", "projects", "opportunity", "opportunities", "lead", "leads", "request", "task", "report", "priority", "with", "from", "that", "this", "issue", "item", "lead", "the", "and", "for", "have", "has", "been", "there", "their", "they", "says", "said", "now", "just", "very", "more", "much", "than", "then", "actually", "it's", "its", "not", "also", "into", "about", "because", "which", "while", "when", "what", "were", "was", "are", "you", "your", "our", "can", "will"]);
const tokens = (t: string) => new Set(t.toLowerCase().replace(/(\d),(\d)/g, "$1$2").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => (w.length >= 3 || /\d/.test(w)) && !STOP.has(w)));
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter(w => b.has(w)).length;

const FIRST_PERSON = new Set(["i", "we"]);
const CONFIRM_VOCAB = new Set(["fine", "yes", "yeah", "yep", "yup", "sure", "correct", "right", "exactly", "confirmed", "indeed", "fair", "enough", "makes", "sense", "that", "is", "true", "got", "it", "ok", "okay", "agreed", "absolutely", "definitely", "thanks", "thank", "you", "good", "noted", "understood", "perfect", "great"]);
const SAY_VERBS = ["say", "says", "said", "tell", "tells", "told", "reckon", "reckons", "reckoned", "claim", "claims", "claimed", "insist", "insists", "swear", "swears", "promise", "promises", "promised", "mention", "mentions", "mentioned", "report", "reports", "reported", "heard", "hear", "hears", "informed", "assure", "assures", "assured", "believes", "thinks"];
const EMOTION = ["nervous", "worried", "unsure", "happy", "annoyed", "afraid", "anxious", "confused", "stressed", "uneasy", "unhappy", "uncertain", "doubtful", "sceptical", "skeptical", "excited", "relieved"];
const SENTIMENT = ["clunky", "slow", "confusing", "annoying", "ugly", "great", "awful", "terrible", "nice", "lovely", "horrible", "clumsy", "messy", "boring", "brilliant", "fantastic", "disappointing", "frustrating", "pointless", "useless", "impressive", "overrated", "overpriced", "pretty"];
// verb stems of consequential events or persistent faults: a statement that something happened or keeps happening is new information
const EVENT = ["resign", "quit", "withdr", "cancel", "delay", "fail", "collaps", "approv", "reject", "declin", "pull", "die", "died", "burst", "broke", "stopp", "keeps", "refus", "terminat", "lost", "won", "defaulted", "expire", "evict", "arrest", "strike", "striking", "walked", "shut", "asked", "got", "received", "signed", "found", "ran", "went", "gone"];
const OPINION_VERBS = ["think", "feel", "reckon", "guess", "believe", "prefer", "like", "dislike", "hate", "love", "doubt", "hope", "wish", "fear", "suspect"];
const hypothetical = (u: ReturnType<typeof analyse>, raw: string) => {const T = u.tokens, first = T[0]; return ["if", "suppose", "supposing", "imagine", "assume", "assuming", "hypothetically", "pretend", "say"].includes(first) || T.slice(0, 3).join(" ") === "let us say" || /\bwhat if\b/.test(raw.toLowerCase()) || (T.includes("hypothetically")) || (T.includes("if") && T.slice(0, 3).includes("if") ) ;};
const attributed = (u: ReturnType<typeof analyse>) => {const T = u.tokens; if (T.some(t => ["apparently", "reportedly", "supposedly", "allegedly", "rumour", "rumoured", "hearsay"].includes(t))) return true; if (["according to", "word is", "word has", "rumour has", "rumor has", "people say", "they say"].includes(T.slice(0, 2).join(" "))) return true;
  return T.some((t, i) => SAY_VERBS.includes(t) && i > 0 && ((!FIRST_PERSON.has(T[i - 1]) && T[i - 1] !== "you" && !(t === "say" && FIRST_PERSON.has(T[i - 1]))) || ((t === "told" || t === "informed" || t === "heard") && T.slice(Math.max(0, i - 3), i).some(x => FIRST_PERSON.has(x)))));};

export function classifyUpdate(text: string, facts: ConversationFact[] = []): { type: FactType; attributed: boolean } {
  const raw = String(text ?? "").trim(), u = analyse(raw), T = u.tokens, att = attributed(u);
  if (!T.length) return { type: "question", attributed: false };
  // a supposition is never a fact, even when worded as a question about it
  if (hypothetical(u, raw)) return { type: "hypothetical", attributed: att };
  if (isCancellationText(raw) || isCapabilityInquiryText(raw)) return { type: "question", attributed: false };
  if (/\b(?:i meant|i mean|talking about|asking about|referring to)\b/.test(raw.toLowerCase()) && !raw.includes("?")) return { type: "correction", attributed: att };
  if (T.some(t => ["ignore", "bypass", "override", "disregard"].includes(t))) return { type: "question", attributed: false };
  const sents = sentencesOf(raw).map(analyse);
  if (sents.length > 1 && sents.some(x => !x.declarative)) return { type: "question", attributed: false };
  if (!u.declarative) return { type: "question", attributed: false };
  const lower = raw.toLowerCase();
  if (T.length <= 6 && T.every(t => CONFIRM_VOCAB.has(t))) return { type: "confirmation", attributed: false };
  // first-person feelings and attitudes are not facts about the world
  const fp = T.findIndex(t => FIRST_PERSON.has(t));
  if (fp >= 0 && fp <= 1 && T.slice(fp + 1, fp + 3).some(t => ["stopped", "stop", "quit"].includes(t)) && T.some(t => /^(?:worr|bother|car|mind)/.test(t))) return { type: "non_material_detail", attributed: false };
  if (fp >= 0 && fp <= 1 && (T.slice(fp + 1, fp + 3).some(t => OPINION_VERBS.includes(t)) || (T.slice(fp + 1, fp + 3).some(t => ["am", "feel"].includes(t)) && T.some(t => EMOTION.includes(t))))) return { type: "opinion", attributed: false };
  if (/\b(?:in my opinion|personally|to me|if you ask me)\b/.test(lower)) return { type: "opinion", attributed: false };
  // a sentiment adjective predicated of something that is no governed domain noun is an opinion about it ("the app feels clunky")
  if (!domainHits(T).length && T.some(t => ["feels", "seems", "looks", "feel", "seem", "look"].includes(t)) && T.some(t => SENTIMENT.includes(t))) return { type: "opinion", attributed: false };
  // correction: an explicit retraction, a replaced value, or a stated re-targeting
  if (/^(?:actually|sorry|correction|scratch that|no wait|wait no|no|nope)\b[,\s]/.test(lower) || T.some(t => ["wrong", "mistake", "misspoke", "misread", "mixed"].includes(t)) && T.some(t => FIRST_PERSON.has(t) || t === "figure" || t === "number" || t === "area" || t === "size")
    || /\b(?:i meant|i mean|than i (?:said|thought|told)|talking about|asking about)\b/.test(lower) || /\bnot\b[^.,;]{1,40}[,;]\s*(?:it['’]?s|it is|but)\b/.test(lower) || /\b(?:figure|number|area|size|date|name|amount)\b[^.]{0,30}\b(?:was|were)\b[^.]{0,12}\bwrong\b/.test(lower)) return { type: "correction", attributed: att };
  const t = tokens(raw);
  if (facts.some(f => !f.superseded_by && t.size > 0 && overlap(t, tokens(f.text)) / t.size >= 0.8)) return { type: "confirmation", attributed: att };
  if (att) return { type: "unverified_claim", attributed: true };
  const discovery = T.slice(0, 2).join(" ") === "turns out" || /\b(?:turns out|it seems|looks like|just found|found out|discovered)\b/.test(lower);
  if (domainHits(T).length || discovery || T.some(t => EVENT.some(e => t.startsWith(e)))) return { type: "material_new_fact", attributed: false };
  return { type: "non_material_detail", attributed: false };
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
