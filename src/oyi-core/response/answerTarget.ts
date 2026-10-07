import { analyse, sentencesOf, isCancellationText, isCapabilityInquiryText, isCallbackRequest, isHoldDirective, objectiveOf, type Utterance } from "../interpretation/semanticObjective";
import { domainHits } from "../interpretation/domainVocabulary";
import { resolveConcepts, type Facet, type ObjectClass } from "../interpretation/conceptBridge";
import { conceptOf, type StateConcept } from "../interpretation/conceptLexicon";

// IQ-8 answer targeting. IQ-2/IQ-7 own UNDERSTANDING (the cognitive objective); this module derives only the SHAPE the answer must lead
// with. It is a pure, cheap function of the turn's wording and the objective already derived (no provider, no storage, no phrase list):
// the shape comes from speech-act structure (how many / which / why / aux-inversion / compare marker ...), never from a sentence.

export type ResponseIntent =
  | "LIST" | "COUNT" | "STATUS" | "SUMMARY" | "DIRECT_ANSWER" | "ASSESSMENT" | "RANKING" | "COMPARISON" | "EXPLANATION" | "YES_NO_WITH_REASON"
  | "ADVICE" | "CLARIFICATION" | "REFUSAL" | "LIMITATION" | "CONFIRMATION_STATE" | "ACTION_RESULT" | "NEXT_STEP" | "SAFETY_RISK" | "CAPABILITY_DISCOVERY";

export type YesNoKind = "state" | "inference" | "capability" | "change" | "action_result" | "advice" | "fact" | "submission";

export type AnswerTarget = {
  response_intent: ResponseIntent;
  subject_tokens: string[];            // content words naming what the question is about
  top_n: number | null;                // an explicit "top three" / "first two"
  quantity: "count" | "list" | "sum" | "value" | null; // count of records / the records / a total amount / a current value
  yes_no: { kind: YesNoKind } | null;
  compare_terms: string[][];           // the named sides of a comparison, as content-token groups
  qualifier_tokens: string[];          // status/filter words ("open", "stale", "qualified", "overdue" ...)
  safety_relevant: boolean;
  is_question: boolean;                // the turn asks or directs (as opposed to stating a fact)
  must_answer: string;                 // human-readable description of what the first sentence must deliver
  supporting_context_allowed: boolean; // supporting evidence may follow, never lead
  confirmation_kind?: "cancel" | "hold" | "callback" | "constraint";
  refusal_kind?: "authority" | "attribution";
  must_not_substitute: string[];       // what the lead must NOT be: "capability_menu", "count_for_list", "list_for_count", "evidence_readiness", "state_for_answer"
  // IQ-8D: the asked-about aspect, taken once from the IQ-7 concept view so downstream layers never re-read the wording
  object: ObjectClass | null;          // what kind of record is asked about
  facet: Facet;                        // balance | transactions | spending | usage | history | status
  state_concept: StateConcept | null;  // open / resolved / stale / overdue / arrived / departed
  negated_qualifiers: string[];        // qualifiers asked for in the negative ("not closed"): the projector inverts them
  flow: "out" | "in" | null;           // direction of money a sum asks about (went out / came in); null = unspecified
  clarify_reason?: "unresolved_reference" | "ambiguous_target" | "missing_selection" | null;
  constraint_kind?: "disclosure" | "channel" | "commitment" | "other";
  ask_facet: "recall" | "missing" | "sufficiency" | "commitment" | "submission" | null; // what a question about HELD (public) facts wants: what was shared / what is missing / enough? / any promise?
  fact_keys: string[];                 // held-fact keys the question names (structure, size, location, terms, title, owner, type)
  past_reference: boolean;             // the question is about an earlier point in time ("last week", "yesterday")
  refinements?: string[];              // typed refinements applied after derivation (never silent)
};

/** The only way a downstream layer may change a carried target: an explicit, recorded refinement. */
export function refineAnswerTarget(t: AnswerTarget, reason: string, patch: Partial<Pick<AnswerTarget, "response_intent" | "yes_no" | "qualifier_tokens" | "refusal_kind" | "confirmation_kind" | "clarify_reason">>): AnswerTarget {
  return { ...t, ...patch, refinements: [...(t.refinements || []), reason] };
}

const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "at", "for", "from", "by", "with", "about", "and", "or", "is", "are", "was", "were", "be", "been", "am", "do", "does", "did", "can", "could", "would", "will", "should", "shall", "may", "might", "has", "have", "had", "me", "my", "i", "we", "you", "your", "our", "us", "it", "its", "this", "that", "these", "those", "there", "here", "any", "some", "all", "what", "which", "who", "whom", "whose", "why", "how", "when", "where", "than", "then", "so", "not", "no", "yes", "please", "just", "also", "now", "today", "currently", "actually", "really", "still", "yet", "already", "right", "give", "tell", "show", "list", "display", "name", "bring", "pull", "get", "see", "let", "know", "need", "want", "like"]);
export const contentTokens = (tokens: string[]) => tokens.filter(t => !STOP.has(t) && t.length > 1);
const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const STATUS_WORDS = ["open", "closed", "resolved", "unresolved", "stale", "expired", "overdue", "pending", "qualified", "new", "active", "inactive", "offline", "online", "current", "historical", "high", "low", "urgent", "critical", "late", "waiting", "outstanding", "unassigned", "approved"];
const INFERENCE = ["take", "assume", "assumed", "conclude", "infer", "tell", "tells", "suggest", "suggests", "signal", "signals", "demonstrate", "demonstrates", "prove", "proves", "proved", "mean", "means", "meant", "imply", "implies", "establish", "establishes", "confirm", "confirms", "show", "shows", "enough", "justify", "justifies", "guarantee", "guarantees", "indicate", "indicates", "caused", "cause", "causes", "explain", "explains", "equal", "equals"];
const ACTION_VERBS = ["switch", "switched", "change", "changed", "alter", "altered", "turn", "turned", "send", "sent", "execute", "executed", "run", "ran", "do", "did", "modify", "modified", "touch", "touched", "update", "updated", "lock", "locked", "unlock", "unlocked", "set", "move", "moved", "book", "booked"];
const HAZARD = ["fumes", "fume", "gas", "smoke", "fire", "flame", "burning", "electrical", "electric", "wiring", "sparks", "shock", "flood", "flooding", "collapse", "explosion", "leak", "leaking", "unsafe", "dangerous", "hazard", "hazardous", "injury", "injured", "intruder", "burglar", "alarm", "carbon", "monoxide", "panel", "exposed", "threat", "smell"];
const RISK_ASK = ["hurt", "safety", "exposed", "dangerous", "unsafe", "hazard", "hazardous", "hazards", "danger", "safe", "secure", "risk", "risks", "risky", "threat", "worried", "worry", "concern", "concerning", "worrying", "harm", "vulnerable"];

const NEGATION = new Set(["no", "not", "never", "nothing", "without", "none", "isn", "aren", "hasn", "haven", "cannot", "neither"]);
/** A declarative report of a hazard (not a question, a negation or a supposition): safety-relevant, unverified. */
export function isHazardReport(text: string): boolean {
  const u = analyse(text), T = u.tokens;
  const pairedHazard = T.some(t => WET.includes(t)) && T.some(t => ELECTRIC.includes(t));
  if (!u.declarative || u.q || !(T.some(t => HAZARD.includes(t)) || pairedHazard) || T.some(t => NEGATION.has(t))) return false;
  return !["if", "suppose", "imagine", "assume", "what", "when", "hypothetically"].includes(T[0]);
}
const WET = ["water", "wet", "flooding", "flooded", "leaking", "liquid", "dripping", "damp"], ELECTRIC = ["socket", "sockets", "outlet", "outlets", "panel", "wiring", "wire", "wires", "cable", "cables", "plug", "fuse", "breaker", "electrical", "electric"];
export const isHazardText = (text: string) => { const t = analyse(text).tokens; return t.some(x => HAZARD.includes(x)); };

const constraintKind = (T: string[], channel: boolean): NonNullable<AnswerTarget["constraint_kind"]> => channel ? "channel" : T.some(t => ["promise", "promises", "guarantee", "commit", "assure", "pledge"].includes(t)) ? "commitment" : T.some(t => ["share", "pass", "tell", "send", "give", "disclose", "reveal", "forward", "show", "expose", "publish"].includes(t)) ? "disclosure" : "other";
const splitSides = (tokens: string[]): string[][] => {
  // two content groups joined by a comparison marker (or / with / versus / than / against / and)
  const cut = tokens.findIndex((t, i) => i > 0 && ["or", "with", "versus", "vs", "than", "against", "and", "from", "rather"].includes(t));
  if (cut < 0) return [];
  const a = contentTokens(tokens.slice(0, cut)), b = contentTokens(tokens.slice(cut + 1));
  return a.length && b.length ? [a, b] : [];
};

export function deriveAnswerTarget(text: string, opts: { objective?: string | null; activeAssessment?: boolean; ambiguity?: { required: boolean; reason: string | null }; pronounRef?: boolean } = {}): AnswerTarget {
  // a turn that opens with context ("I just got into the office. What needs my attention?") is shaped by its last question or directive
  // a leading condition ("if nothing was logged, does that ...?") frames the question that follows it
  const cond = /^\s*(?:if|when|once|assuming|given|because|since|as)\b[^,]{3,80},\s*(.+\?\s*)$/i.exec(text);
  if (cond) return deriveAnswerTarget(cond[1], opts);
  const sents = sentencesOf(text);
  if (sents.length > 1) { const last = analyse(sents[sents.length - 1]); if (last.q || last.wh || last.auxLead || last.imperative) { const inner = deriveAnswerTarget(sents[sents.length - 1], opts); return { ...inner, safety_relevant: inner.safety_relevant || isHazardText(text) }; } }
  const u: Utterance = analyse(text), T = u.tokens, lead = T[0] ?? "";
  const objective = opts.objective !== undefined ? opts.objective : objectiveOf(text, { activeAssessment: opts.activeAssessment });
  const content = contentTokens(T), qualifiers = T.filter(t => STATUS_WORDS.includes(t));
  const hazard = T.some(t => HAZARD.includes(t)), riskAsk = T.some(t => RISK_ASK.includes(t));
  const cpt = resolveConcepts(text);
  const FACT_KEY: Array<[string, string[]]> = [["commercial_terms", ["terms", "price", "pricing", "offer"]], ["structure_offered", ["structure", "lease", "sale", "jv", "venture", "partnership", "sell", "selling"]], ["land_size", ["size", "big", "sqm", "hectares", "acres", "area"]], ["location", ["where", "location", "located", "area", "city"]], ["title_document_status", ["title", "document", "documents", "papers"]], ["landowner_expectation", ["owner", "owners", "ownership", "expectation", "expect", "expects"]], ["opportunity_type", ["type", "kind"]]];
  const tk = T.filter(t => !STOP.has(t));
  const fact_keys = FACT_KEY.filter(([, ws]) => ws.some(w => tk.includes(w))).map(([k]) => k);
  const COMMIT_ASK = ["promise", "promises", "guarantee", "guarantees", "assure", "assurance", "assured", "ensure", "commit", "committing", "committed", "definitely", "firm", "certain", "confirm", "sign", "signing", "accept", "enter", "bind"];
  const futureOutcome = T.some(t => ["going", "gonna", "will", "would"].includes(t)) && T.some(t => ["approved", "approve", "buy", "accept", "accepted", "take", "purchase", "sign", "reject", "rejected"].includes(t));
  const ask_facet: AnswerTarget["ask_facet"] = futureOutcome ? "commitment" : T.some(t => COMMIT_ASK.includes(t)) && T.some(t => ["approve", "approved", "sale", "buy", "buyer", "price", "decision", "deal", "outcome", "return", "project", "week", "today", "back", "commit", "committing", "committed", "promise", "guarantee", "fetch", "worth", "value", "offer"].includes(t) || COMMIT_ASK.includes(t)) ? "commitment"
    : T.some(t => ["enough", "sufficient", "adequate", "ready", "complete"].includes(t)) ? "sufficiency"
    : T.some(t => ["lack", "lacking", "missing", "need", "still", "else", "further"].includes(t)) || (T.includes("more") && T.some(t => ["know", "need", "want", "tell"].includes(t))) ? "missing"
    : T.some(t => ["told", "shared", "given", "noted", "recorded", "captured", "supplied", "provided", "mentioned", "stated", "said", "gave", "held", "reflect", "recap", "remind", "summarise", "summarize"].includes(t)) ? "recall" : null;
  const past_reference = cpt.facet === "history" || (T.includes("last") && T.some(t => ["week", "month", "year", "night", "quarter"].includes(t))) || T.includes("ago") || T.includes("previously");
  const stateTok = (t: string) => STATUS_WORDS.includes(t) || ["open", "resolved", "stale", "overdue"].includes(conceptOf(t) ?? "");
  const qualifiersAll = T.filter(stateTok);
  const negQual = qualifiersAll.filter(q => { const i = T.indexOf(q); return i > 0 && ["not", "never", "isn", "hasn", "haven", "no"].includes(T[i - 1]); });
  const MONEY = ["money", "amount", "total", "spent", "spend", "spending", "paid", "pay", "cost", "costs", "funds", "cash", "naira", "income", "revenue", "balance", "worth"];
  const OUT = ["spent", "spend", "spending", "paid", "pay", "debit", "debited", "withdrew", "withdrawn", "outflow", "out", "cost", "costs", "gone"], IN = ["received", "receive", "funded", "funding", "deposit", "deposited", "credited", "credit", "income", "earned", "came", "inflow"];
  const flow: AnswerTarget["flow"] = T.some(t => OUT.includes(t)) ? "out" : T.some(t => IN.includes(t)) ? "in" : null;
  const moneyish = T.some(t => MONEY.includes(t)) || ["transactions", "spending", "balance"].includes(cpt.facet as string);
  const submitAsk = (u.auxLead || u.wh || u.q) && T.some(t => ["submitted", "submit", "forwarded", "forward", "escalated", "handed", "passed", "sent"].includes(t)) && (T.includes("you") || T.some(t => ["team", "ochiga", "office", "staff"].includes(t))) && T.some(t => ["details", "information", "info", "enquiry", "inquiry", "application", "request", "proposal", "opportunity", "it", "them"].includes(t));
  const base = (intent: ResponseIntent, over: Partial<AnswerTarget> = {}): AnswerTarget => ({ object: cpt.object, facet: cpt.facet, state_concept: cpt.state, response_intent: intent, subject_tokens: content.filter(t => !stateTok(t)), negated_qualifiers: negQual, ask_facet: submitAsk ? "submission" : ask_facet, flow, fact_keys, past_reference, top_n: null, quantity: cpt.facet === "balance" ? "value" : null, yes_no: null, compare_terms: [], qualifier_tokens: qualifiersAll,
    safety_relevant: hazard || riskAsk, is_question: u.q || u.wh || u.auxLead || u.imperative, must_answer: "", supporting_context_allowed: true, must_not_substitute: ["capability_menu"], ...over });

  if (opts.ambiguity?.required) return base("CLARIFICATION", { clarify_reason: "ambiguous_target", must_answer: "ask which one is meant", must_not_substitute: ["capability_menu", "evidence_readiness", "nothing_pending"] });
  if (isCapabilityInquiryText(text)) return base("CAPABILITY_DISCOVERY", { must_answer: "what Oyi can help with", must_not_substitute: [] });
  const standingMarker = T.some(t => ["while", "during", "whenever", "until", "always", "ever", "never", "rest", "session", "anyone", "anybody", "nobody"].includes(t)) || T.slice(0, 3).join(" ") === "from now on";
  const onlyChannel = /^\s*(?:please\s+)?(?:only|just)\s+(?:contact|call|email|message|text|reach|whatsapp|ping)\b/i.test(text);
  if (onlyChannel && !u.q && !u.wh) return base("CONFIRMATION_STATE", { confirmation_kind: "constraint", constraint_kind: "channel", is_question: false, must_answer: "acknowledge the constraint and state it is in force", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer", "callback"] });
  if (isCancellationText(text) && standingMarker && T.length > 5 && !isCallbackRequest(text)) return base("CONFIRMATION_STATE", { confirmation_kind: "constraint", must_answer: "acknowledge the constraint and state it is in force", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  // a negative imperative about disclosing ("don't share / pass on / tell ...", optionally closed by a tag like "ok?") is a standing constraint, not a cancellation
  const tagClose = /[,\s](?:ok|okay|right|alright|yeah|yes)\s*\?\s*$/i.test(text);
  if (u.negImperative && T.some(t => ["share", "pass", "tell", "send", "give", "disclose", "reveal", "forward", "show", "expose", "publish"].includes(t)) && !(T.some(t => ["it", "that", "this", "anything", "everything", "something"].includes(t)) && !T.some(t => ["my", "our", "mine"].includes(t))) && !u.wh && (!u.q || tagClose) && !isCallbackRequest(text)) return base("CONFIRMATION_STATE", { confirmation_kind: "constraint", constraint_kind: constraintKind(T, false), is_question: false, must_answer: "acknowledge the constraint and state it is in force", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  if (isCancellationText(text) || isHoldDirective(text) || isCallbackRequest(text)) return base("CONFIRMATION_STATE", { confirmation_kind: isCallbackRequest(text) ? "callback" : isHoldDirective(text) ? "hold" : "cancel", must_answer: "what is now in force (nothing is executed)", must_not_substitute: ["capability_menu", "evidence_readiness"] });
  // a standing constraint on how Oyi behaves ("don't claim / share / invent ...", "from now on ...", "do not turn anything on or off")
  // a tag question ("... so we are fine, right?") asks for confirmation of the statement before it
  const tagQ = /,\s*(?:right|correct|yeah|ok|okay)\s*\?\s*$/i.test(text) && T.some(t => ["fine", "safe", "ok", "okay", "well", "clear", "good", "secure"].includes(t));
  if (tagQ) return base("YES_NO_WITH_REASON", { yes_no: { kind: "inference" }, must_answer: "yes / no first, then the reason", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  const neg = u.negImperative || (T[0] === "no" && /ing$/.test(T[1] ?? "")) || (/^(?:from now on|going forward|please do not|please don t)/.test(T.join(" ")) && T.includes("not"));
  const fromNow = T.slice(0, 3).join(" ") === "from now on";
  const confidentiality = T[0] === "keep" && T.some(t => ["between", "private", "confidential", "secret", "yourself"].includes(t));
  if ((neg || fromNow || confidentiality) && !u.q && !u.wh && !/\b(?:just|only|instead)\b/i.test(text)) return base("CONFIRMATION_STATE", { confirmation_kind: "constraint", constraint_kind: constraintKind(T, false), must_answer: "acknowledge the constraint and state it is in force", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });

  // how many / how much / the number of / count of
  const howMany = T.findIndex((t, i) => t === "how" && ["many", "much"].includes(T[i + 1] ?? "")) >= 0;
  const countAsk = howMany || lead === "count" || (u.imperative && T.slice(0, 3).includes("count")) || (lead === "how" && ["many", "much"].includes(T[1] ?? "")) || (T.includes("number") && T.includes("of") && (u.wh || u.q || u.imperative)) || (T.includes("count") && T.includes("of")) || (u.wh && T.includes("total"));
  // a bare directive whose only object is a pronoun ("do it again", "update it"): nothing says what it refers to, so the ask is a clarification
  const FILLER = new Set(["do", "does", "did", "it", "that", "this", "them", "again", "update", "redo", "repeat", "undo", "please", "now", "turn", "switch", "set", "on", "off", "change", "same", "one", "more", "once", "back", "go", "ahead", "just", "then", "like", "before", "as", "earlier", "previous", "last", "time", "so", "ok", "okay"]);
  if (opts.pronounRef && !u.q && !u.wh && T.length <= 6 && contentTokens(T).filter(t => !FILLER.has(t)).length === 0) return base("CLARIFICATION", { clarify_reason: "unresolved_reference", is_question: true, must_answer: "ask which one is meant", must_not_substitute: ["capability_menu", "evidence_readiness", "nothing_pending"] });
  const muchAsk = T.some((t, i) => t === "how" && T[i + 1] === "much");
  if ((muchAsk || (u.wh && T.includes("total"))) && moneyish && cpt.facet !== "usage") {
    if (cpt.facet === "balance") return base("STATUS", { quantity: "value", must_answer: "the current value", must_not_substitute: ["capability_menu", "list_for_count", "count_for_value"] });
    return base("DIRECT_ANSWER", { quantity: "sum", must_answer: "the total amount (not a count of records)", must_not_substitute: ["capability_menu", "count_for_sum", "list_for_sum"] });
  }
  if (submitAsk) return base("YES_NO_WITH_REASON", { yes_no: { kind: "submission" }, must_answer: "what is known about whether anything was handed over", must_not_substitute: ["capability_menu", "acknowledgement", "promise"] });
  if (countAsk) return base("COUNT", { quantity: "count", must_answer: "the number first", must_not_substitute: ["capability_menu", "list_for_count", "evidence_readiness"] });

  // did/have you <done something>? -> truth about actions taken in this conversation
  const youDid = ["did", "have", "has", "was", "were"].includes(T[0]) && (T[1] === "you" || T.includes("anything") || T.includes("oyi")) && T.some(x => ACTION_VERBS.includes(x));
  if (youDid && !/\b(?:prove|mean)\b/.test(T.join(" "))) return base("ACTION_RESULT", { yes_no: { kind: "action_result" }, must_answer: "whether anything was actually changed (yes/no first)", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });

  // an action with only a pronoun for its object ("turn that off") cannot be carried out until it is clear what is meant
  if (u.imperative && ["turn", "switch", "set", "lock", "unlock", "open", "close", "start", "stop", "shut", "power", "kill", "disable", "enable", "activate", "deactivate", "dim", "boost"].includes(lead) && T.some(t => ["that", "this", "those", "them"].includes(t)) && contentTokens(T).filter(t => !["turn", "switch", "set", "lock", "unlock", "open", "close", "start", "stop", "shut", "power", "kill", "disable", "enable", "activate", "deactivate", "dim", "boost", "on", "off", "up", "down", "that", "this", "those", "them"].includes(t)).length === 0 && !T.includes("it")) return base("CLARIFICATION", { clarify_reason: "unresolved_reference", must_answer: "ask which one is meant", must_not_substitute: ["capability_menu", "evidence_readiness"] });
  // an instruction to ignore a boundary, or to treat the user as someone they are not, is declined whatever role is claimed
  if (T.some(t => ["ignore", "bypass", "override", "disregard", "pretend", "impersonate", "circumvent"].includes(t)) && T.some(t => ["privacy", "boundary", "boundaries", "permission", "permissions", "rule", "rules", "authority", "restriction", "restrictions", "policy", "owner", "admin", "manager", "role", "security", "limits"].includes(t)))
    return base("REFUSAL", { refusal_kind: "authority", must_answer: "decline to bypass a privacy/permission boundary, whatever role is claimed", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  // attributing a problem to a named kind of person is not something the evidence supports (and is private by default)
  const person = T.some(t => ["resident", "tenant", "neighbour", "neighbor", "person", "someone", "who", "staff", "guard", "visitor"].includes(t));
  if (person && u.wh && T.some(t => ["causing", "caused", "responsible", "reported", "blame", "complained", "reporting", "behind", "complaint", "complaints", "made", "raised", "filed", "logged"].includes(t))) return base("REFUSAL", { must_answer: "decline to identify or blame an individual, then say what can be said", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  // recall of the conversation itself
  if (u.wh && (T.includes("did") || T.includes("have")) && T.includes("i") && T.some(t => ["say", "said", "correct", "corrected", "mention", "mentioned", "ask", "asked", "tell", "told", "mean", "meant", "give", "gave", "given", "provided", "shared"].includes(t))) return base("DIRECT_ANSWER", { must_answer: "what the user said/corrected earlier", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  // recall of what the conversation is about ("which room are we discussing?")
  if (u.wh && T.some(t => /^(?:discuss|talk|referr|speak)/.test(t)) && T.some(t => ["we", "i", "you"].includes(t))) return base("DIRECT_ANSWER", { must_answer: "what the conversation is currently about", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  // "what changed since yesterday": a change over time needs an earlier snapshot to compare with
  if (u.wh && T.some(t => ["changed", "change", "different", "new"].includes(t)) && T.some(t => ["since", "yesterday", "ago", "earlier", "last", "before"].includes(t))) return base("DIRECT_ANSWER", { must_answer: "what changed since the earlier point, or that no earlier snapshot exists to compare with", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  if (u.wh && T.includes("reasoning") && T.some(t => ["changed", "change"].includes(t))) return base("EXPLANATION", { must_answer: "whether the reasoning changed and why", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  const topN = (() => { const i = T.findIndex(t => ["top", "first", "best"].includes(t)); if (i >= 0 && T[i + 1] && NUM[T[i + 1]]) return NUM[T[i + 1]]; const m = T.find(t => /^\d+$/.test(t)); return m && (T.includes("top") || T.includes("first")) ? Number(m) : null; })();

  if (lead === "why" && T.includes("rather") && T.includes("than")) return base("COMPARISON", { compare_terms: splitSides(T.slice(1)), must_answer: "why one rather than the other (the contrast itself)", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  if (objective === "compare") return base("COMPARISON", { compare_terms: splitSides(T.filter(t => !["compare", "comparing", "difference", "differ", "differs", "versus"].includes(t) || t === "versus")), top_n: topN, must_answer: "the comparison itself (which, how they differ), not two independent summaries", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  if (objective === "prioritize") return base("RANKING", { top_n: topN, must_answer: "the ordering (or why none can be given) first", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  if (objective === "explain" || lead === "why") return base("EXPLANATION", { must_answer: "the supported reason first", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  // asking where something stands is a status read; explicit list asks are lists whatever the judgment cue words
  const standing = u.wh && T.some(t => ["stand", "stands"].includes(t)) && T.some(t => ["where", "how"].includes(t)) && contentTokens(T).filter(t => !["stand", "stands", "things", "overall", "everything"].includes(t)).length > 0;
  if (standing) return base("STATUS", { must_answer: "the current state of the thing asked about", must_not_substitute: ["capability_menu", "count_for_list"] });
  const judgeWords = T.some(t => ["worry", "worried", "should", "why", "compare", "rank", "matter", "matters", "priority", "important", "urgent", "better", "worse", "safe", "risk", "concern"].includes(t));
  const listVerb = ["show", "list", "display", "name", "bring", "pull"].includes(lead) || (["give", "tell"].includes(lead) && T[1] === "me" && T.some(t => ["names", "name", "list", "which", "all", "every"].includes(t)));
  const whichList = lead === "which" && T.length <= 9 && !T.some(t => ["or", "more", "most", "less", "worse", "better", "first", "should"].includes(t));
  if (!judgeWords && (listVerb || whichList))
    return base("LIST", { quantity: "list", top_n: topN, must_answer: "the items themselves (names/records), with any count only as support", must_not_substitute: ["capability_menu", "count_for_list"] });
  if (objective === "summarize") return base("SUMMARY", { must_answer: "the summary itself", must_not_substitute: ["capability_menu"] });
  if (objective === "advise" && u.auxLead && ["can", "could", "would", "should", "shall", "will", "may"].includes(lead) && !T.includes("or") && T.length <= 12) {
    const k: YesNoKind = ["can", "could"].includes(lead) && T[1] === "you" ? "capability" : "advice";
    return base("YES_NO_WITH_REASON", { yes_no: { kind: k }, must_answer: "yes / no / insufficient first, then the reason", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  }
  if ((u.wh || T.includes("what")) && objective === "reassess" && T.some(t => ["changes", "change", "different"].includes(t))) return base("DIRECT_ANSWER", { must_answer: "what would change", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  if (u.wh && ["which", "what"].includes(lead) && T.some(t => ["remains", "remain", "missing", "unresolved", "unknown", "stale", "open", "pending", "overdue", "needs", "need", "evidence", "information", "confirmation", "unassigned"].includes(t)) && !(T[0] === "what" && T[1] === "do" && ["we", "i"].includes(T[2] ?? "")) && (objective === "assess" || objective === "advise" || objective === null))
    return base("LIST", { quantity: "list", must_answer: "the items themselves (what is open / unknown / missing), first", must_not_substitute: ["capability_menu", "count_for_list", "evidence_readiness"] });
  if (u.wh && T.some(t => ["conclude", "say", "tell", "know"].includes(t)) && T.includes("you") && (objective === "assess" || objective === null)) return base("DIRECT_ANSWER", { must_answer: "what can be said, then its limits", must_not_substitute: ["capability_menu", "evidence_readiness"] });
  if (objective === "advise") return base(lead === "what" && T.includes("next") ? "NEXT_STEP" : "ADVICE", { must_answer: "the recommendation (or the limit on giving one)", must_not_substitute: ["capability_menu"] });

  // risk questions and statements that carry a safety hazard
  if (objective === "assess" && T.some(t => ["first", "priority"].includes(t)) && (T.includes("anything") || T.includes("which") || T.includes("what"))) return base("RANKING", { must_answer: "the one thing to look at first", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  if ((objective === "assess" || objective === null) && (riskAsk && (u.q || u.wh || u.auxLead || u.imperative)) && !(u.auxLead && T.some(t => INFERENCE.includes(t)))) {
    const yn = u.auxLead && !T.includes("anything");
    return base("SAFETY_RISK", { yes_no: yn ? { kind: "state" } : null, must_answer: "the safety-relevant conclusion or uncertainty first", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  }
  if ((hazard || isHazardReport(text)) && u.declarative && !u.wh) return base("SAFETY_RISK", { must_answer: "surface the unverified safety-relevant report without claiming it is verified", must_not_substitute: ["capability_menu", "evidence_readiness"] });

  // yes/no questions (subject-auxiliary inversion)
  if (u.auxLead && !u.imperative) {
    const kind: YesNoKind = fact_keys.length && T.some(t => ["i", "my", "me", "mine", "ve"].includes(t)) && T.some(t => ["told", "say", "said", "ask", "asked", "mention", "mentioned", "gave", "give", "shared", "provided", "wanted", "want", "stated", "offered", "tell"].includes(t)) ? "fact"
      : T.some(t => INFERENCE.includes(t)) ? "inference"
      : (["can", "could"].includes(lead) && T[1] === "you") || (lead === "do" && T[1] === "you" && T.some(t => ["know", "have", "see", "verify", "access"].includes(t))) || (lead === "are" && T[1] === "you") ? "capability"
      : T.includes("change") || T.includes("changes") || T.includes("changed") || (T.includes("still") && objective === "reassess") ? "change"
      : ["should", "would", "shall"].includes(lead) ? "advice" : "state";
    return base("YES_NO_WITH_REASON", { yes_no: { kind }, must_answer: "yes / no / insufficient first, then the reason", must_not_substitute: ["capability_menu", "evidence_readiness", "state_for_answer"] });
  }
  if (objective === "retrieve" || (objective === null && (u.imperative || u.wh))) {
    const status = T.some(t => ["state", "status", "condition", "standing", "stand", "stands", "balance", "happening"].includes(t)) || (T.includes("going") && T.includes("on")) || (lead === "how" && T.some(t => ["doing", "going", "looking", "dey"].includes(t)));
    if (status) return base("STATUS", { must_answer: "the current state of the thing asked about", must_not_substitute: ["capability_menu", "count_for_list"] });
    return base("LIST", { quantity: "list", top_n: topN, must_answer: "the items themselves (names/records), with any count only as support", must_not_substitute: ["capability_menu", "count_for_list"] });
  }
  if (objective === "assess" || objective === "reassess") return base("ASSESSMENT", { must_answer: "the judgment first, then the support", must_not_substitute: ["capability_menu", "state_for_answer"] });
  return base("DIRECT_ANSWER", { must_answer: "the requested information", must_not_substitute: ["capability_menu"] });
}
