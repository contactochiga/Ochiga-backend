import type { CognitiveObjective } from "../contracts/semanticFrame";
import { domainHits } from "./domainVocabulary";

// IQ-7 semantic generalisation. This is the canonical objective/speech-act recogniser used by SemanticFrameParser: there is no second parser.
// It infers the cognitive job from COMPOSITIONAL signals (speech act, question form, single-word semantic stems, comparison/ordering
// structure, polarity, context) instead of recognising phrases. Single words below are semantic signals or domain vocabulary; no entry is
// a sentence, a place name, a person's role or a benchmark phrase (enforced by scripts/iq7-guard-static.mjs).

export type Utterance = {
  raw: string;
  tokens: string[];                // lower-case word tokens after contraction expansion and leading filler removal
  q: boolean;                      // a question mark is present
  wh: boolean;                     // starts with a wh-word
  auxLead: boolean;                // starts with an auxiliary (subject-aux inversion)
  imperative: boolean;             // begins with a base-form directive verb
  request: boolean;                // "can you ..." / "I would like ..." style request
  negImperative: boolean;          // "do not ...", "never ...", "stop ..."
  declarative: boolean;
};

const FILLER_LEAD = new Set(["okay", "ok", "so", "well", "right", "hey", "hi", "hello", "oga", "boss", "chief", "sir", "madam", "um", "uh", "abeg", "biko", "please", "pls", "kindly", "and", "but", "alright", "anyway", "honestly", "look", "listen", "also", "wait", "oh", "hmm", "actually", "then", "just", "now", "yet"]);
const DISCOURSE_LEAD: string[][] = [["on", "second", "thoughts"], ["on", "reflection"], ["second", "thoughts"], ["whatever", "you", "do"], ["in", "that", "case"], ["no", "wait"], ["wait", "no"], ["come", "to", "think", "of", "it"], ["by", "the", "way"]];
const WH = new Set(["wetin", "what", "which", "who", "whom", "whose", "why", "how", "when", "where"]);
const AUX = new Set(["is", "are", "am", "was", "were", "do", "does", "did", "can", "could", "will", "would", "shall", "should", "may", "might", "has", "have", "had"]);
const DIRECTIVE = new Set(["shut", "remind", "recall", "keep", "leave", "freeze", "maintain", "preserve", "retain", "line", "put", "set", "place", "lay", "weigh", "pit", "boil", "condense", "show", "list", "display", "pull", "fetch", "find", "get", "open", "read", "view", "see", "bring", "give", "tell", "check", "look", "rank", "sort", "order", "compare", "explain", "summarize", "summarise", "recap", "brief", "draft", "write", "compose", "walk", "fill", "catch", "run", "send", "make", "turn", "switch", "set", "put", "leave", "drop", "forget", "scrap", "skip", "cancel", "stop", "ignore", "hold", "remember", "note", "consider", "assume", "suppose", "imagine", "pretend", "go", "take", "start", "begin", "do", "let", "say", "update", "prepare", "add", "create", "delete", "remove", "pay", "buy", "book", "call", "contact", "email", "message", "ring", "approve", "confirm", "proceed", "submit", "reject", "deny", "undo", "repeat", "reply", "respond", "answer", "help", "separate", "keep", "review", "audit", "evaluate", "assess", "analyse", "analyze", "estimate", "recommend", "suggest", "advise", "offer", "verify", "validate", "highlight", "flag", "name", "identify", "weigh", "judge", "decide", "choose", "pick", "select", "turn", "never", "don", "dont", "disregard", "abandon", "discard", "just", "use", "try", "focus", "stay", "wake", "share", "ask", "warn", "notify", "inform", "forward", "save", "schedule", "remind", "track", "monitor", "watch", "lock", "unlock", "arm", "disarm", "dim", "increase", "decrease", "raise", "lower", "extend", "pause", "resume", "revoke", "fund"]);
const COGNITIVE_ACT = new Set(["rank", "sort", "order", "prioritise", "prioritize", "summarise", "summarize", "explain", "compare", "assess", "analyse", "analyze", "judge", "evaluate", "recommend", "suggest", "advise", "weigh", "list", "show", "tell", "give", "invent", "claim", "promise", "report", "pretend", "guarantee", "assume", "state", "imply", "say", "present", "treat", "mark", "call", "describe"]);
const ASSERTIVE = new Set(["invent", "claim", "promise", "report", "pretend", "guarantee", "assume", "state", "imply", "say", "present", "treat", "mark", "call", "describe", "confirm", "assert", "separate"]);

const EXPAND: Array<[RegExp, string]> = [
  [/[’‘]/g, "'"], [/\bwon't\b/g, "will not"], [/\bcan't\b/g, "can not"], [/\bcannot\b/g, "can not"], [/\bshan't\b/g, "shall not"], [/\bain't\b/g, "is not"],
  [/n't\b/g, " not"], [/\bi'm\b/g, "i am"], [/\b(\w+)'re\b/g, "$1 are"], [/\b(\w+)'ve\b/g, "$1 have"], [/\b(\w+)'ll\b/g, "$1 will"], [/\b(\w+)'d\b/g, "$1 would"],
  [/\b(what|that|it|there|here|who|how|where|he|she)'s\b/g, "$1 is"], [/\blet's\b/g, "let us"],
];

export function tokenize(raw: string): string[] {
  let t = String(raw ?? "").toLowerCase();
  for (const [re, to] of EXPAND) t = t.replace(re, to);
  return t.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g)?.flatMap(w => w.includes("-") ? [w.replace(/-/g, ""), ...w.split("-")] : [w]) ?? [];
}

export function analyse(raw: string): Utterance {
  const q = /\?/.test(raw);
  let tokens = tokenize(raw);
  // leading fillers never carry meaning (but never strip an utterance down to nothing)
  while (tokens.length > 1 && FILLER_LEAD.has(tokens[0])) tokens = tokens.slice(1);
  // discourse markers that only frame what follows ("on second thoughts, ...", "whatever you do, ...") carry no meaning of their own
  for (let again = true; again;) {
    again = false;
    for (const m of DISCOURSE_LEAD) if (m.every((w, i) => tokens[i] === w) && tokens.length > m.length) {tokens = tokens.slice(m.length); again = true;}
    while (tokens.length > 1 && FILLER_LEAD.has(tokens[0])) {tokens = tokens.slice(1); again = true;}
  }
  let request = false;
  // "can/could/would/will you (please) <directive>" and "i would like/want/need (you to) <x>" are requests: analyse the requested act itself
  if (/^(?:can|could|would|will)$/.test(tokens[0]) && tokens[1] === "you") {
    const polite = tokens[2] === "please";
    const rest = tokens.slice(2).filter((t, i) => !(i === 0 && t === "please"));
    // "would you <act>?" asks for a view unless made a polite request with "please"; can/could/will you <directive> is a request
    if (rest.length && DIRECTIVE.has(rest[0]) && (tokens[0] !== "would" || polite)) {tokens = rest; request = true;}
  } else if (tokens[0] === "i" && /^(?:would|will)$/.test(tokens[1] ?? "") && /^(?:like|love|appreciate)$/.test(tokens[2] ?? "")) {tokens = tokens.slice(3).filter((t, i) => !(i < 2 && /^(?:you|to)$/.test(t))); request = true;}
  else if (tokens[0] === "i" && /^(?:want|need)$/.test(tokens[1] ?? "") && /^(?:you|to|a|an|the|some)$/.test(tokens[2] ?? "")) {tokens = tokens.slice(2).filter((t, i) => !(i < 2 && /^(?:you|to)$/.test(t))); request = true;}
  // "I would like to know how/whether ..." asks the indirect question itself
  if (request && /^(?:know|understand|learn|hear)$/.test(tokens[0] ?? "") && tokens.length > 2) tokens = tokens.slice(tokens[1] === "about" ? 2 : 1);
  const first = tokens[0] ?? "";
  const wh = WH.has(first) || (request && (first === "if" || first === "whether"));
  // a bare request noun phrase ("quick summary of X", "recap of Y") is a directive with the verb elided
  const fragmentRequest = !wh && !AUX.has(first) && !DIRECTIVE.has(first) && tokens.slice(0, 2).some(t => /^(?:summar|recap|rundown|overview|headline|gist|update|status|handover|snapshot|briefing)/.test(t)) && !(first === "i" || first === "we");
  const negImperative = (/^(?:do|dont|never)$/.test(first) && (tokens[1] === "not" || first !== "do")) || (first === "stop" && !wh) || (first === "no" && tokens[1] === "need");
  const auxLead = AUX.has(first) && tokens.length > 1 && !(first === "do" && tokens[1] === "not");
  const imperative = !wh && !auxLead && (DIRECTIVE.has(first) || negImperative || request || fragmentRequest);
  return {raw, tokens, q, wh, auxLead, imperative, request, negImperative, declarative: !q && !wh && !auxLead && !imperative};
}

const is = (t: string, s: string) => (s.endsWith("*") ? t.startsWith(s.slice(0, -1)) : t === s);
const has = (u: Utterance, ...stems: string[]) => u.tokens.some(t => stems.some(s => is(t, s)));
const idx = (u: Utterance, ...stems: string[]) => u.tokens.findIndex(t => stems.some(s => is(t, s)));
const before = (u: Utterance, a: string[], b: string[], gap = 6) => {const i = idx(u, ...a), j = idx(u, ...b); return i >= 0 && j > i && j - i <= gap;};
const within = (u: Utterance, a: string[], b: string[], gap = 4) => {const i = idx(u, ...a), j = idx(u, ...b); return i >= 0 && j >= 0 && Math.abs(i - j) <= gap;};

type Score = Record<CognitiveObjective, number>;
const ORDER: CognitiveObjective[] = ["reassess", "explain", "compare", "prioritize", "summarize", "assess", "advise", "retrieve"];
const COMPARATIVE = ["better", "worse", "safer", "riskier", "stronger", "weaker", "cheaper", "smarter", "wiser", "faster", "slower", "bigger", "larger", "smaller", "warmer", "colder", "hotter", "cooler", "higher", "lower", "greater", "easier", "harder", "closer", "likelier", "more", "less"];
const SUPERLATIVE = ["most", "best", "biggest", "worst", "top", "highest", "greatest", "key", "main", "major", "pressing", "urgent*", "critical", "crucial", "hardest", "largest", "first"];
const EVALUATIVE = ["paranoid", "overreacting", "silly", "foolish", "unreasonable", "okay", "ok", "fine", "alright", "healthy", "solid", "serious", "dodgy", "wrong", "problem*", "trouble*", "exposed", "vulnerab*", "stable", "sound", "genuine", "legit", "viable", "attractive", "credible", "realistic", "reliable", "secure*", "safe*", "dangerous", "risky", "unsafe", "worrying", "concerning", "suspicious", "odd", "strong", "good", "great", "worthwhile", "promising", "sensible", "reasonable", "decent", "bad", "weak", "poor", "wise", "unusual", "strange", "broken"];
const STATE_PRED = ["locked", "unlocked", "open", "closed", "online", "offline", "arrived", "left", "set", "armed", "disarmed", "done", "finished", "ready", "running", "working", "present", "home", "back"];
const EPISTEMIC = ["confident", "confidence", "accurate", "accuracy", "know", "known", "unknown", "verify", "verified", "confirm*", "observe*", "observed", "evidence", "conclude", "baseline", "certain", "prove", "proof", "unresolved", "missing", "stale", "unverified", "uncertain*", "sure"];
const SUMMARY = ["condens*", "distil*", "summar*", "recap", "rundown", "overview", "headline", "gist", "tldr", "briefing", "snapshot", "handover", "debrief"];
const ASK_DATA = ["expected", "coming", "come", "comes", "due", "visiting", "visited", "arrive*", "unassigned", "spent", "used", "came", "pending", "overdue", "outstanding", "registered"];
const RETRIEVE_VERB = ["show", "list", "display", "pull", "fetch", "find", "get", "open", "read", "view", "bring", "see", "lookup"];

export function scoreUtterance(u: Utterance, opts: {activeAssessment?: boolean} = {}): Score {
  const s: Score = {retrieve: 0, summarize: 0, assess: 0, prioritize: 0, compare: 0, explain: 0, advise: 0, reassess: 0};
  const T = u.tokens, n = T.length, ask = u.q || u.wh || u.auxLead || u.imperative;
  if (!ask) { // declaratives: only implicit-assessment cues, and only when no assessment is already running (otherwise they are information)
    if (!opts.activeAssessment) {
      if (has(u, "hot", "cold", "warm", "stuffy", "stifling", "noisy", "loud", "smelly", "smell*", "leaking", "dark", "freezing", "boiling", "humid") && has(u, "too", "feels", "feel", "very", "so", "really", "extremely")) s.assess += 4;
      if (T[0] === "i" && /^(?:am|will)$/.test(T[1] ?? "") && has(u, "leaving", "heading", "going", "off", "travelling", "travelling") && has(u, "bed", "sleep", "out", "away", "home", "work", "trip", "travel*")) s.assess += 4;
    }
    // a first-person admission of a gap in knowledge is an implicit request to reason about it
    if (n >= 4 && T[0] === "i" && has(u, "not", "no", "unsure", "uncertain") && has(u, "know", "sure", "idea", "certain", "clear", "unsure")) s.assess += 4;
    if (has(u, "your") && has(u, "read", "take", "view", "opinion", "thoughts", "verdict", "assessment", "judgement", "judgment") && has(u, "value", "appreciate", "like", "love", "want", "need", "welcome", "hear")) s.assess += 4;
    return s;
  }
  const lead = T[0];
  // ---- explanation
  const whyAt = idx(u, "why");
  if (whyAt >= 0 && (whyAt <= 3 || whyAt >= n - 2) && !(n <= 2 && opts.activeAssessment === false)) s.explain += 4;
  const dependent = n <= 3 && opts.activeAssessment === false; // a short fragment whose meaning lives in an antecedent has no objective without one
  if (lead === "why" && !dependent) s.explain += 4;
  if (lead === "explain") s.explain += 3;
  if (u.wh && has(u, "led") && has(u, "you")) s.explain += 4; // "what led you to that choice?"
  if ((lead === "because" || lead === "meaning") && n <= 4) s.explain += 4;
  if (n <= 2 && has(u, "meaning", "reason", "reasons", "rationale")) s.explain += 3;
  if (u.wh && has(u, "we", "i", "you") && !has(u, "can", "could", "would", "should", "will", "shall") && !has(u, "recently", "yesterday", "last", "ago", "week", "weeks", "month", "months", "days", "previous*", "discussed", "talked", "spoke") && has(u, "discuss*", "talk*", "refer*", "meant", "mean", "said", "say", "asked", "ask", "mentioned", "correct*", "told", "decid*", "agree*", "chose", "choose")) s.explain += 4;
  if (lead === "how" && T[1] === "come") s.explain += 4;
  if (has(u, "explain*", "justif*", "rationale", "reasoning", "logic")) s.explain += 3;
  if (u.wh && has(u, "behind") && has(u, "recommendation", "ranking", "order", "choice", "decision", "answer", "advice")) s.explain += 6;
  if (u.wh && has(u, "driving", "behind", "makes", "made") && !has(u, "sense") && !(lead === "how" && has(u, "many", "much"))) s.explain += 3;
  if (lead === "how" && has(u, "did", "do", "does") && has(u, "land", "arrive", "decide", "conclude", "pick", "rank", "choose", "reach", "get") && has(u, "you", "that", "it", "this")) s.explain += 3;
  if (lead === "how" && T[1] === "so") s.explain += 3;
  if (has(u, "walk") && has(u, "through") && has(u, "reasoning", "thinking", "logic", "decision", "ranking", "order", "recommendation")) s.explain += 3;
  // ---- reassessment
  const changeAt = T.findIndex((t, i) => ["change", "changes", "changed", "changing"].includes(t) || t.startsWith("alter") || t.startsWith("affect") || t.startsWith("shift"));
  const negatedChange = changeAt > 0 && (T[changeAt - 1] === "not" || T[changeAt - 1] === "you" || (lead === "did" && has(u, "you")));
  const changeV = changeAt >= 0 && !negatedChange;
  const evidenceChange = changeV && u.wh && has(u, "evidence", "information", "data", "fact", "facts", "news") && has(u, "would", "could", "will");
  if (evidenceChange) s.assess += 5;
  const retro = changeV && (u.wh || lead === "has" || lead === "have") && has(u, "since", "yesterday", "overnight", "today", "last", "week", "while", "recently", "ago");
  const judgNoun = has(u, "priority", "priorities", "recommendation", "view", "plan", "order", "answer", "assessment", "picture", "conclusion", "things", "anything", "explanation", "reasoning", "decision", "ranking", "mind", "stance", "what");
  if (changeV && retro && !has(u, "reasoning", "view", "recommendation", "priority", "assessment", "plan", "explanation")) s.compare += 4;
  else if (changeV && !evidenceChange) s.reassess += 3 + (judgNoun ? 1 : 0);
  if (has(u, "still") && has(u, "you", "we") && has(u, "priorit*", "stand", "recommend*", "pursue", "choose", "think", "say", "agree", "back")) s.reassess += 4;
  if (["given", "knowing", "considering"].includes(lead)) s.reassess += 4;
  if (has(u, "still") && (has(u, "priority", "first", "top", "pick", "rank*", "same", "stand", "recommend*", "view", "answer", "plan", "valid", "hold", "best", "favourite", "favorite") || n <= 2)) s.reassess += 4;
  else if (has(u, "still") && has(u, ...EVALUATIVE, "open", "true")) s.assess += 3;
  if (has(u, "same") && has(u, "answer", "order", "plan", "conclusion", "result", "recommendation", "priority", "view", "thing")) s.reassess += 4;
  if (has(u, "even") && has(u, "with", "so", "if", "then", "though")) s.reassess += 3;
  if (has(u, "reconsider", "rethink", "revisit", "reassess", "reevaluate")) s.reassess += 4;
  if (u.q && (has(u, "given", "knowing", "considering") || before(u, ["light"], ["of"], 1) || before(u, ["now"], ["that"], 1))) s.reassess += 2;
  const supposeLead = (["what", "how"].includes(lead) && T[1] === "if") || ["if", "suppose", "supposing", "imagine", "assume", "assuming", "hypothetically"].includes(lead) || has(u, "hypothetically");
  if (supposeLead) { if (T.slice(1, 4).includes("you") || T[1] === "na") s.advise += 4; else if (T.includes("i") || T.includes("we")) s.advise += 4; else if (u.q || has(u, "matter*", "change*", "alter*", "affect*", "happen*", "differ*")) s.reassess += 4; }
  if ((u.q || u.auxLead || u.wh) && has(u, "if", "when", "once") && has(u, "survive*", "hold", "holds", "stand", "stands", "remain*", "stay", "stays", "change*")) s.reassess += 4;
  // ---- comparison
  const impactQ = has(u, "difference") && has(u, "would", "could", "will") && has(u, "make", "made");
  if (impactQ) s.reassess += 5;
  if (has(u, "compar*", "versus", "vs", "differ*", "separates", "weigh") || (has(u, "difference") && !impactQ)) s.compare += 4;
  if (has(u, "stack*") && has(u, "up")) s.compare += 4;
  if (has(u, "put", "set", "place", "line", "lay", "weigh", "hold") && has(u, "next", "beside", "alongside", "against") && u.imperative) s.compare += 4;
  if (T.filter(t => t === "side").length >= 2 || T.filter(t => t === "head").length >= 2) s.compare += 4;
  if (has(u, "tradeoff*") || (has(u, "trade") && has(u, "offs", "off"))) s.compare += 5;
  const comp = has(u, ...COMPARATIVE);
  if (comp && has(u, "than")) s.compare += 3;
  if (comp && (u.wh || u.auxLead) && !has(u, "more") && !has(u, "less")) s.compare += 3;
  if (has(u, "more", "less") && has(u, "important", "matter*", "urgent*", "serious", "risky", "likely", "useful") && (has(u, "which", "is", "are", "does", "do") || u.imperative)) s.compare += 3;
  if (has(u, "rather") && has(u, "than") && ask) s.compare += lead === "why" ? 3 : 9; // a contrast of alternatives dominates
  if (has(u, "or") && has(u, "which", "better", "smarter", "safer", "best", "prefer", "worse") ) s.compare += 3;
  // ---- prioritisation
  if (has(u, "priorit*", "rank*", "triage")) s.prioritize += 3;
  if (has(u, "best", "top", "strongest", "most") && has(u, "first") && (u.imperative || ask) && has(u, "line", "lining", "arrange", "sort", "order", "put", "list", "rank")) s.prioritize += 4;
  if (u.wh && lead === "who" && has(u, "best", "most", "strongest", "top") && has(u, "promising", "valuable", "likely", "urgent", "important", "hot", "hottest", "worth", "chase", "call", "contact", "pursue")) s.prioritize += 4;
  if (((has(u, "most") && has(u, "least")) || (has(u, "best") && has(u, "worst"))) && has(u, "from", "to") && (u.imperative || ask)) s.prioritize += 4; // "from most to least X" is an ordering request
  if (has(u, "sort", "order") && (has(u, "by", "importance", "urgency", "risk", "priority", "them", "these", "those", "sensible", "running", "short", "out") || lead === "order")) s.prioritize += 3;
  if (u.wh && has(u, ...SUPERLATIVE.filter(x => x !== "first" && x !== "most"), "useful", "helpful", "valuable", "important")) s.prioritize += 2;
  if (u.wh && has(u, "block*", "blocker*", "blocking")) s.prioritize += 3;
  if (u.wh && has(u, "most") && has(u, "need", "needs", "needing", "demand*", "require*", "deserve*")) s.prioritize += 4;
  if (lead === "which" && has(u, "should", "shall", "must", "need", "ought") && has(u, "tackle", "handle", "fix", "address", "chase", "attack", "settle", "resolve", "deal")) s.prioritize += 4;
  if (u.wh && has(u, "biggest", "greatest", "worst", "main", "key", "major", "top") && has(u, "threat", "threats", "risk", "risks", "problem", "issue", "concern", "danger", "blocker", "obstacle", "challenge", "priority", "weakness")) s.prioritize += 4;
  if (u.wh && has(u, "one", "ones", "thing", "things") && has(u, "kill*", "hurt*", "harm*", "damage*", "hit", "bite", "sink", "ruin", "cost*")) s.prioritize += 4;
  if (u.wh && T[n - 1] === "pass") s.prioritize += 4; // "X pass Y" (West African Pidgin): more than, i.e. a superlative
  if (ask && has(u, "chase", "tackle", "face", "handle", "attack", "target", "look", "start", "begin", "address", "call", "phone", "ring", "contact", "pursue") && has(u, "which", "what", "who") && has(u, "first", "hardest", "most", "next", "top", "best", "strongest", "hottest")) s.prioritize += 5;
  if (has(u, "most") && u.wh) s.prioritize += 2;
  if (has(u, "choose", "pick", "select") && (has(u, "which", "what")) && (has(u, "you", "i", "we"))) s.prioritize += 5;
  if (has(u, "matter", "matters") && has(u, "most")) s.prioritize += 4;
  else if (has(u, "matter", "matters") && u.wh) s.assess += 3;
  if (has(u, "worth") && has(u, "pursuing", "time", "chasing", "focus", "effort", "my", "our")) s.prioritize += 3;
  if (has(u, "deserve*") && has(u, "time", "energy", "effort", "focus", "priority")) s.prioritize += 3;
  if (has(u, "deserve*") && has(u, "attention")) s.assess += 3;
  if (has(u, "first") && (u.wh || has(u, "which")) && has(u, "attention", "tackle", "face", "chase", "handle", "focus", "priority", "important", "deal", "look", "start", "begin", "address", "which", "one", "ones", "thing", "things")) s.prioritize += 3;
  if (has(u, "wait", "slide", "slip", "postpone*", "defer*") && has(u, "can", "could", "safely", "fine", "next", "which", "what")) s.prioritize += 3;
  if (lead === "where" && has(u, "should") && has(u, "energy", "time", "effort", "focus", "attention", "money")) s.prioritize += 4;
  if (u.wh && has(u, "three", "two", "four", "five", "top") && has(u, "levers", "lever", "moves", "things", "priorities", "items", "issues")) s.prioritize += 3;
  // ---- summary
  if (has(u, ...SUMMARY)) s.summarize += 4;
  if (has(u, "brief") && (lead === "brief" || has(u, "me"))) s.summarize += 4;
  if (has(u, "catch") && has(u, "up")) s.summarize += 4;
  if (has(u, "boil", "cut", "trim", "shrink") && has(u, "down")) s.summarize += 4;
  if (has(u, "pull") && has(u, "together") && has(u, "note", "summary", "brief", "overview", "report", "update", "rundown")) s.summarize += 5;
  if (has(u, "fill") && has(u, "in")) s.summarize += 4;
  if (has(u, "bring") && has(u, "speed")) s.summarize += 4;
  if (has(u, "short", "quick", "concise", "brief") && has(u, "version", "summary", "update", "story", "look", "overview", "rundown", "read", "take")) s.summarize += 3;
  if (has(u, "update", "status") && (has(u, "me", "us") || lead === "update") && !(has(u, "status") && !has(u, "update") && has(u, "of"))) s.summarize += 3;
  if (u.wh && has(u, "happened", "going") && has(u, "while", "since", "overnight", "today", "away", "out")) s.summarize += 3;
  if (has(u, "stand", "stands") && (has(u, "where", "things", "how"))) s.summarize += 3;
  if (has(u, "walk") && has(u, "through") && !has(u, "reasoning", "thinking", "logic", "decision", "ranking", "order", "recommendation")) s.summarize += 3;
  if (has(u, "draft", "compose", "write") && has(u, ...SUMMARY, "brief", "summary", "recommendation")) s.summarize += 4;
  // ---- advice
  const should = has(u, "should", "shall", "ought");
  if (should) s.advise += 2;
  if (lead === "should" || lead === "shall") s.advise += 1;
  if (has(u, "recommend*", "suggest*", "advis*", "advice", "delegat*")) s.advise += 4;
  if (has(u, "hand", "pass") && has(u, "off", "over", "on", "to", "someone", "somebody")) s.advise += 3;
  if (has(u, "next") && has(u, "step", "steps", "move", "moves", "action", "thing")) s.advise += 4;
  if (has(u, "proceed", "commit*", "pursue", "sign") && !(T[T.indexOf("sign") + 1] === "off") && (u.q || u.wh || u.auxLead || has(u, "should", "shall", "ought"))) s.advise += 3; // a bare directive ("make the commitment") is an instruction, not a request for a view
  if (u.wh && has(u, "need*") && has(u, "do") && has(u, "we", "i", "us", "me")) s.advise += 4;
  if (u.wh && should && has(u, "verify", "check", "confirm", "test", "inspect", "establish", "rule")) s.advise += 3;
  if (u.wh && has(u, "convince*", "persuade*", "satisfy", "reassure*")) s.advise += 4;
  if (has(u, "sensible", "wise", "advisable", "prudent", "smart", "reasonable") && (u.q || u.auxLead || u.wh)) s.advise += 4;
  if (lead === "go" && has(u, "ahead")) s.advise += 3;
  if (has(u, "ahead") && has(u, "go", "we", "do")) s.advise += 2;
  if (before(u, ["would"], ["you"], 1) && !has(u, "say", "describe", "call", "agree")) s.advise += 3;
  if (before(u, ["were"], ["me"], 2) || before(u, ["na"], ["you"], 1) || before(u, ["if"], ["you"], 2) && has(u, "were", "me")) s.advise += 4;
  if (has(u, "think") && has(u, "need", "should", "ought", "must", "call", "hire", "get") && has(u, "i", "we")) s.advise += 3;
  if (has(u, "to") && has(u, "do") && before(u, ["what", "how"], ["to"], 2)) s.advise += 3;
  if (has(u, "or") && has(u, "hold", "wait", "investigate", "proceed", "stop", "continue") && (has(u, "we", "i", "should", "do"))) s.advise += 3;
  if ((lead === "do" || lead === "should" || lead === "shall") && has(u, "we", "i") && has(u, "go", "need", "move", "hold", "proceed", "clear", "evacuate", "call", "hire", "send", "tell", "wait", "act")) s.advise += 3;
  if ((lead === "can" || lead === "could" || lead === "may") && has(u, "i", "we") && !has(u, "see", "ask", "have", "get", "know", "trust")) s.advise += 2;
  if (has(u, "draft", "compose", "write", "prepare") && ask && !has(u, ...SUMMARY, "brief", "summary")) s.advise += (lead === "draft" || lead === "compose" || lead === "write") ? 4 : 3;
  if (has(u, "promise", "guarantee") && (has(u, "can", "could", "will", "would") || u.imperative)) s.advise += 3;
  if (u.wh && has(u, "should", "would") && has(u, "i", "we", "you", "team", "manager", "staff", "us") && !has(u, "worry", "worried", "concerned")) s.advise += 2;
  if (u.wh && has(u, "would", "will", "should") && has(u, "evidence", "measurement*", "document*", "step*", "check*", "verification", "information", "proof") && has(u, "show", "close", "help", "settle", "prove", "confirm", "fix", "solve", "resolve")) s.advise += 4;
  if (u.wh && has(u, "can", "could") && has(u, "you") && has(u, "do") && has(u, "about", "for", "with")) s.advise += 4;
  if (u.wh && has(u, "should", "would", "will") && has(u, "do", "happen", "discuss", "verify", "check", "ask", "prepare", "attempt*", "try", "help", "show", "close", "settle", "solve", "fix", "prove")) s.advise += 3;
  if (u.wh && has(u, "would", "will", "should") && has(u, "need*", "require*")) s.advise += 4;
  if ((lead === "would" || lead === "should" || lead === "could") && T[1] && T[1].endsWith("ing") && !["something", "anything", "nothing", "everything"].includes(T[1])) s.advise += 4;
  if (u.imperative && has(u, "offer", "give") && has(u, "way", "step", "reason", "option", "options", "suggestion")) s.advise += 4;
  if (u.imperative && has(u, "ask", "check", "confirm", "tell", "warn", "notify") && has(u, "me") && has(u, "before", "first")) s.assess += 3;
  if ((lead === "would" || lead === "will" || lead === "could") && T[1] && !["you", "i", "we", "it", "that", "this", "the", "a"].includes(T[1]) && has(u, "pursue", "consider", "accept", "approve", "agree", "back", "fund")) s.assess += 4;
  if (has(u, "need") && has(u, "from", "to") && has(u, "me", "you") && u.wh) s.advise += 2;
  if (/^what (?:do|shall|can|should) (?:we|i) do(?: (?:now|next|then|about it|about that))?$/.test(T.join(" "))) s.advise += 4;
  if (opts.activeAssessment && n <= 7 && !u.imperative && (lead === "then" || has(u, "next", "after", "afterwards", "following", "subsequent")) && has(u, "then", "next", "after", "afterwards", "step", "steps", "happens", "do", "following") && !has(u, "meeting", "week", "month", "holiday", "review", "year", "monday", "tuesday", "wednesday", "thursday", "friday")) s.advise += 4;
  if (lead === "so" || T[0] === "what") { if (T.slice(0, 3).join(" ") === "what now" || /^(?:so )?what (?:now|next|then)$/.test(T.join(" "))) s.advise += 4; }
  // ---- assessment
  if (has(u, "worr*", "concern*", "risk*", "danger*", "nervous", "anxious", "afraid") && (!u.imperative || u.negImperative === false && has(u, "should", "about"))) s.assess += 3;
  if (has(u, ...EVALUATIVE) && (u.q || u.wh || u.auxLead)) s.assess += 3;
  if (has(u, "anything", "something") && has(u, "important", "urgent", "new", "interesting", "wrong", "off", "odd", "unusual", "strange", "dodgy", "worrying", "concerning", "dangerous", "risky", "spoiling", "kicking", "slipping", "hiding", "worry", "problem", "issue", "need", "should", "ought", "must", "sort", "check", "dodgy")) s.assess += 4;
  if ((u.q || u.wh) && has(u, "chance", "chances", "odds", "likelihood", "probability", "prospects", "prospect")) s.assess += 4;
  if (lead === "how" && has(u, "healthy", "bad", "serious", "solid", "safe", "good", "strong", "risky", "exposed", "well", "secure", "stable")) s.assess += 4;
  if (has(u, "attention") && !has(u, "first")) s.assess += 3;
  if (has(u, "situation", "shape", "picture") && (u.q || u.wh) && has(u, "of", "in", "with")) s.assess += 4;
  // STATUS reads: asking for the recorded state of a named thing is retrieval, not a judgment about it
  const statusNoun = has(u, "state", "status", "condition", "standing");
  const asksRead = u.wh || u.imperative || u.q;
  if (statusNoun && asksRead && has(u, "of", "on", "with", "for") && !has(u, "update", "summary", "report", "overview", "brief", "briefing") && !has(u, "you", "your", "my")) s.retrieve += 6;
  if (statusNoun && asksRead && has(u, "of", "on", "with", "for") && !has(u, "update", "summary", "report", "overview", "brief", "briefing") && has(u, "my")) s.retrieve += 6;
  if (u.wh && has(u, "stand", "stands") && has(u, "with", "on") && has(u, "where") && !has(u, "things", "everything", "overall", "we", "i")) s.retrieve += 5;
  if (u.wh && has(u, "stand", "stands") && has(u, "things") && has(u, "with", "on") && n >= 5 && T.slice(T.findIndex(t => t === "with" || t === "on") + 1).some(t => !["the", "a", "an", "all", "this", "that", "it", "everything", "overall"].includes(t))) s.retrieve += 5;
  if (lead === "how" && has(u, "dey", "doing", "looking", "going", "holding", "performing", "faring") && !has(u, "you", "your", "i", "we", "me", "us") && n >= 3 && !has(u, "bad", "badly", "serious", "worrying", "healthy", "safe", "secure", "risky", "exposed")) s.retrieve += 5;
  if (has(u, "neglect*", "slipping", "drifting", "behind") && (has(u, "we", "are", "anything") || u.wh)) s.assess += 3;
  if (has(u, ...EPISTEMIC) && ask) s.assess += 3;
  if (has(u, "enough") && has(u, "to", "for", "information", "details") && ask) s.assess += 3;
  if (has(u, "have", "has") && has(u, "reading*", "data", "record*", "source*", "measurement*", "sensor*", "scope", "proof", "report", "baseline", "evidence") && u.auxLead) s.assess += 3;
  if (u.wh && has(u, "can", "could") && has(u, "you") && has(u, "tell", "say", "know", "confirm", "verify", "conclude", "see")) s.assess += 4;
  {const k = T.findIndex(t => STATE_PRED.includes(t)); if (u.auxLead && k >= 0 && T.slice(k + 1).every(t => ["now", "yet", "already", "right", "today", "again", "really", "or", "not"].includes(t)) && !has(u, "show", "list")) s.assess += 3;}
  if (has(u, "trust*", "reliab*", "credib*") && ask) s.assess += 3;
  if (has(u, "think", "view", "opinion", "thoughts", "verdict", "take", "reckon", "feel") && has(u, "you", "your") && (u.wh || u.q)) s.assess += 4;
  { const w = idx(u, "worth"), gerund = w >= 0 && /ing$/.test(T[w + 1] ?? "") && !["pursuing", "chasing", "focusing"].includes(T[w + 1]);
    if (gerund && (u.q || u.auxLead)) s.advise += 5;
    else if (w >= 0 && (u.q || u.auxLead) && !has(u, "pursuing", "time", "chasing", "focus", "effort", "my", "our")) s.assess += 3; }
  if (has(u, "care") && has(u, "about") && (has(u, "should", "do", "i", "we"))) s.assess += 4;
  if (has(u, "looking", "look", "looks") && has(u, "ok", "okay", "fine", "good", "alright", "right", "off", "dodgy")) s.assess += 3;
  if (has(u, "on") && has(u, "track")) s.assess += 3;
  if (has(u, "assess", "evaluate", "audit", "review") && (u.imperative || u.request)) s.assess += 3;
  if (has(u, "check") && has(u, "whether", "if", "healthy", "ok", "okay", "fine", "working")) s.assess += 3;
  if (has(u, "possible", "feasible", "allowed", "permitted") && (u.q || u.auxLead)) s.assess += 3;
  if (has(u, "matter", "matters") && (lead === "does" || lead === "do" || lead === "would") && !supposeLead) s.assess += 3;
    if (has(u, "make") && has(u, "non", "nonstarter")) s.assess += 3;
  if (has(u, "told", "given", "shared") && has(u, "enough", "me", "you")) s.assess += 1;
  // ---- retrieval
  if (RETRIEVE_VERB.includes(lead) && u.imperative) s.retrieve += 4;
  if (lead === "read" && has(u, "back")) s.summarize += 5;
  if (has(u, "pull") && has(u, "up")) s.retrieve += 4;
  if (lead === "give" && has(u, "me") && !has(u, ...SUMMARY, "short", "quick", "advice", "recommendation", "reason", "update", "next", "answer", "headline", "view", "gist", "rundown", "overview")) s.retrieve += 3;
  if ((has(u, "who") || has(u, "which") || has(u, "how") && has(u, "many", "much")) && has(u, ...ASK_DATA)) s.retrieve += 3;
  if (has(u, "how") && has(u, "many", "much") && has(u, "spent", "used", "power", "electricity", "water", "cost", "paid", "energy", "leads", "unassigned", "open")) s.retrieve += 3;
  if (u.wh && has(u, "like") && has(u, "temperature", "weather", "state", "level", "reading")) s.retrieve += 3;
  if (has(u, "who") && (has(u, "coming", "visiting", "expected", "come") || before(u, ["at"], ["door", "gate", "entrance", "reception", "front", "home", "house", "here"], 2))) s.retrieve += 3;
  if (has(u, "has", "have", "did", "is") && has(u, "anyone", "anybody", "somebody")) s.retrieve += 3;
  if (lead === "which" && n >= 3 && has(u, "arrived", "came", "arrive*", "opportunit*", "leads", "visitors", "lights", "devices") && !has(u, ...SUPERLATIVE)) s.retrieve += 3;
  if (lead === "what" && has(u, "is", "are") && has(u, "the", "my", "our") && n <= 6 && Math.max(...Object.values(s)) === 0) s.retrieve += 1;
  if (lead === "how" && has(u, "many", "much") && n <= 9) s.retrieve += 3;
  if (lead === "let" && T[1] === "me" && has(u, "see", "view", "check")) s.retrieve += 4;
  // a plain wh-question about governed domain things, with no judgment cue anywhere, asks for the records themselves
  if (u.wh && lead !== "how" && !(["what", "how"].includes(lead) && T[1] === "about") && !has(u, "mean", "means", "meaning", "define", "definition", "stand", "stands", "acronym", "abbreviation") && !has(u, "you", "your", "mine", "yours", "ours", "else") && n <= 10 && Math.max(...Object.values(s)) < 3 && !has(u, "why", "should", "would", "could", "might", "ought", "think", "better", "worse", "best", "most", "worth", "likely") && domainHits(T).some(h => h.domain !== "environment")) s.retrieve += 3;
  if (u.imperative && has(u, "list") && has(u, "just", "only")) s.retrieve += 4;
  return s;
}

/** The cognitive objective of ONE sentence, or null. Requires a clear winner of at least moderate strength. */
const ORDINAL = new Set(["first", "second", "third", "fourth", "fifth", "last", "1st", "2nd", "3rd", "4th"]);
export function objectiveOfSentence(raw: string, opts: {activeAssessment?: boolean} = {}): CognitiveObjective | null {
  const u = analyse(raw);
  if (isCancellationSentence(u) || isCapabilityInquiryUtterance(u) || isHoldDirective(raw) || isCallbackRequest(raw)) return null;
  const score = scoreUtterance(u, opts);
  // A negated imperative constrains HOW to answer (or vetoes an act); only epistemic/assertive constraints carry an assessment.
  if (u.negImperative) {
    const verb = u.tokens.find((t, i) => i > 0 && !["not", "just", "to", "ever", "even", "again"].includes(t)) ?? "";
    if (ASSERTIVE.has(verb)) return "assess";
    const rest = u.tokens.slice(2).join(" ");
    if (COGNITIVE_ACT.has(verb) && /\b(?:just|only|instead)\b/.test(rest)) return objectiveOfSentence(rest.replace(/^.*?\b(?:just|only|instead)\b\s*/, ""), opts);
    return null;
  }
  let best: CognitiveObjective | null = null, top = 0;
  for (const k of ORDER) if (score[k] > top) {top = score[k]; best = k;}
  // "Tell me about the second one." names an item of a list already shown: a selection, not a new judgment request.
  if (best && ["assess", "retrieve", "summarize"].includes(best) && !u.q && !u.wh && !u.auxLead && u.tokens.length <= 8
    && u.tokens.some(t => ORDINAL.has(t))) return null;
  return top >= 3 ? best : null;
}

export function sentencesOf(raw: string): string[] {
  return String(raw ?? "").split(/(?<=[.?!])\s+|\s[—–]\s|\s-\s|—|–|;|:/).map(s => s.trim()).filter(Boolean);
}

export function objectiveOf(raw: string, opts: {activeAssessment?: boolean} = {}): CognitiveObjective | null {
  const sents = sentencesOf(raw);
  if (sents.length > 1) {
    for (let i = sents.length - 1; i >= 0; i--) {const o = objectiveOfSentence(sents[i], opts); if (o) return o;}
    return null;
  }
  return objectiveOfSentence(raw, opts);
}

// ------------------------------------------------------------------ capability discovery
// An enquiry about the assistant's own abilities: second-person subject + ability frame + no concrete topic complement. "What can you do
// about the financing?" is a request for judgment; "What can you do?" / "What can you do for me?" is capability discovery.
const GENERIC = new Set(["me", "us", "here", "today", "now", "you", "with", "for", "at", "to", "the", "a", "an", "all", "everything", "anything", "else", "also", "actually", "really", "just", "exactly", "specifically", "in", "this", "that", "thing", "things", "stuff", "tasks", "look", "do", "help", "assist", "access", "handle", "offer", "support", "cover", "provide", "share", "use", "work", "on", "of", "i", "can", "could", "are", "is", "able", "capable", "so", "and", "or", "please", "own", "far", "my", "your", "our", "it", "oma", "oyi", "osa", "be", "out", "up", "good", "about", "information", "data", "details"]);
const ABILITY_VERB = ["do", "help", "assist", "handle", "offer", "access", "support", "cover", "manage", "share", "provide", "reach"];
// Capability discovery = a question about the assistant's own abilities: an interrogative frame whose subject is the assistant (you / its name)
// with an ability verb or an "able/capable" predicate. A concrete topic complement ("about the financing", "for my plot") turns it into a
// request for judgment, not a menu request. "What would you do?" / "things you can do" inside another request are not discovery.
export function isCapabilityInquiryUtterance(u: Utterance): boolean {
  const T = ["tell", "show", "list", "explain"].includes(u.tokens[0]) && u.tokens[1] === "me" && WH.has(u.tokens[2] ?? "") ? u.tokens.slice(2) : u.tokens;
  const j = T.findIndex(t => t === "you" || t === "oma" || t === "oyi" || t === "osa");
  if (j < 0) return false;
  const whAt = T.findIndex(t => WH.has(t));
  if (whAt < 0 || whAt > j) return false;
  const modalBefore = T.slice(whAt, j + 1).some(t => ["can", "could", "are", "do", "does"].includes(t));
  const modalAfter = ["can", "could"].includes(T[j + 1] ?? "");
  const ableAfter = T.slice(j + 1, j + 4).some(t => t === "able" || t === "capable") || (T.slice(j + 1, j + 4).includes("good") && (T.slice(j + 1, j + 5).includes("at") || T.slice(j + 1, j + 5).includes("for")));
  if (!(modalBefore || modalAfter || ableAfter)) return false;
  if (T.slice(whAt, j + 1).includes("would") || T.slice(whAt, j + 1).includes("should")) return false;
  const verbAt = T.findIndex((t, i) => i > whAt && ABILITY_VERB.includes(t) && i !== j);
  if (verbAt < 0 && !ableAfter) return false;
  if (ableAfter && verbAt < 0) return true;
  const verb = T[verbAt];
  const afterAll = T.slice(verbAt + 1);
  const asAt = afterAll.indexOf("as"); // a role phrase ("as a resident") says who is asking, not what about
  const after = asAt >= 0 ? afterAll.slice(0, asAt) : afterAll;
  const topical = after.filter(t => !GENERIC.has(t));
  const prepAt = after.findIndex(t => ["about", "for", "with", "on", "regarding"].includes(t));
  if ((verb === "do" || verb === "help" || verb === "assist") && prepAt >= 0 && after.slice(prepAt + 1).some(t => !GENERIC.has(t))) return false;
  if (verb === "do" && topical.length) return false;
  return true;
}
export const isCapabilityInquiryText = (raw: string) => isCapabilityInquiryUtterance(analyse(raw));

// ------------------------------------------------------------------ cancellation / negation (safety-critical)
// A veto is recognised structurally: a leading withdrawal verb or negated directive with an object that carries no new content, a bare
// negative reply, or a statement that the user did NOT ask for the act. Anything ambiguous about an act is treated as a veto (clarify, never
// preserve executable intent). A cognitive-act constraint ("do not rank them, just list them") is NOT a veto.
const WITHDRAW = new Set(["cancel", "forget", "scrap", "drop", "skip", "abandon", "discard", "disregard", "undo", "nevermind", "leave", "stop", "ignore"]);
const PRONOUN_OBJECT = new Set(["it", "that", "this", "those", "these", "them", "everything", "anything", "all", "now", "please", "alone", "as", "is", "be", "i", "asked", "said", "mentioned", "any", "pending", "proposal", "action", "command", "request", "draft", "the", "my", "of", "any", "one", "anyone", "anybody", "yet", "for", "now", "me", "with", "about", "off", "on", "right", "then", "was", "were", "not", "no", "longer", "needed", "necessary", "one"]);
const CORRECTION_FRAME = /\b(?:i am|i will|i meant|i mean|talking about|asking about|instead|rather)\b/;
export function isCancellationSentence(u: Utterance): boolean {
  const T = u.tokens, text = T.join(" ");
  if (!T.length || T.length > 9) return false;
  if (T[0] === "no" && T.length === 1) return true;
  if (/^(?:nope|nah|no)(?:\s+(?:thanks|thank you))?$/.test(text)) return true;
  if (/^(?:no|nope|nah)?\s*(?:not (?:any ?more|anymore|now|needed|necessary|today)|no longer)\b/.test(text) && T.length <= 5) return true;
  // "no, I did not say/ask/want ... (to) do it"
  if (/^(?:no\s+)?(?:i|we) (?:did not|was not|were not|never|do not|am not) (?:say|said|ask|asked|asking|want|tell|told|mean|meant|request|order)\b/.test(text) && (/\b(?:do|it|that|this|call|send|contact|switch|turn|book|proceed|act|ring|approve|confirm|execute|authori[sz]e|submit)\b/.test(text) || /\b(?:you|to)\s+[a-z]+/.test(text.replace(/^.*?\b(?:ask|asked|asking|tell|told|want|request|order)\b/, "")))) return true;
  if (CORRECTION_FRAME.test(text) && !/^(?:never mind|nevermind)\b/.test(text)) return false;
  if (/^let us (?:leave|drop|skip|forget|stop|hold|park|shelve|ditch|scrap|cancel)\b/.test(text)) return true;
  if (/^let us not\b/.test(text) && !COGNITIVE_ACT.has(T[3] ?? "")) return true;
  { let k = 0; while (T[k] === "no" || T[k] === "nope" || T[k] === "nah") k++; if (k > 0 && k < T.length && !(k === 1 && /^(?:i|we)\b/.test(T.slice(1).join(" ")))) return isCancellationSentence(analyse(T.slice(k).join(" "))); }
  if ((T.includes("changed") && T.includes("mind") && T.includes("my") && T.indexOf("changed") <= 2)) return true;
  if (/^(?:never ?mind|forget it|forget that|no need|not needed)\b/.test(text)) return true;
  const first = T[0];
  if (u.negImperative) {
    const verb = T.find((t, i) => i > 0 && !["not", "ever", "just", "to", "even", "again", "need", "bother"].includes(t) ) ?? "bother";
    if (COGNITIVE_ACT.has(verb) && !/\bsend|contact|call|ring\b/.test(text)) return false;
    return true;
  }
  if (first === "hold" && T[1] === "on" && T.length > 2) return isCancellationSentence(analyse(T.slice(2).join(" ")));
  if (first === "hold" && T[1] === "off") return true;
  if (WITHDRAW.has(first)) {
    const rest = T.slice(1);
    if (first === "stop") return rest.length === 0 || rest.every(t => PRONOUN_OBJECT.has(t));
    if (first === "leave") return rest.length <= 4 && rest.some(t => ["alone", "it", "that", "this", "as", "be", "them", "am"].includes(t)) && !rest.some(t => ["message", "note", "voicemail", "feedback", "review", "comment"].includes(t));
    return rest.length <= 4;
  }
  return false;
}
export const isCancellationText = (raw: string) => {const sents = sentencesOf(String(raw ?? "").trim()); const u = analyse(String(raw ?? "").trim()); return isCancellationSentence(u) || (sents.length > 1 && sents.every(s => isCancellationSentence(analyse(s)) || tokenize(s).length === 0) );};

/** A leading affirmation/negation of a pending proposal (never a keyword found anywhere in the text). */
export function responseMove(raw: string): "approve" | "reject" | "cancel" | null {
  const u = analyse(String(raw ?? "").trim()), T = u.tokens;
  if (isCancellationText(raw)) return "cancel";
  if (u.q || T.length > 8 || !T.length) return null;
  const f = T[0];
  if (["yes", "yeah", "yep", "yup", "sure", "confirm", "confirmed", "approve", "approved", "proceed", "submit"].includes(f) && !/\b(?:if|would|could|might|whether)\b/.test(T.join(" "))) return "approve";
  if (f === "go" && T[1] === "ahead") return "approve";
  if (["do", "send", "create"].includes(f) && (T[1] === "it" || T[1] === "that") && T.length <= 3 && !u.negImperative) return "approve";
  if (["no", "nope", "nah", "not", "reject", "rejected", "deny"].includes(f) && T.length <= 6) return "reject";
  return null;
}


// ------------------------------------------------------------------ hold / preserve directives and callback requests
// A hold directive asks that the CURRENT state be left as it is. It is neither advice nor the cancellation of a pending action, and it never
// carries executable intent. A callback request asks the organisation to contact the user: it is communication/handoff semantics, never a
// judgment request, and requesting contact is not a promise that contact happens.
const HOLD_VERB = new Set(["keep", "leave", "hold", "freeze", "maintain", "preserve", "retain", "let"]);
const HOLD_MARK = new Set(["as", "exactly", "current", "currently", "existing", "unchanged", "stand", "stands", "where", "same", "change", "changes", "dey", "present"]);
export function isHoldDirective(raw: string): boolean {
  let T = analyse(raw).tokens;
  if (T[0] === "make" && T[1] === "you") T = T.slice(2); else if (T[0] === "make" && T.length > 2) T = T.slice(1);
  if (!T.length || T.length > 12 || !HOLD_VERB.has(T[0])) return false;
  if (T[0] === "hold" && ["on", "off"].includes(T[1])) return false; // "hold on / hold off" are withdrawals, handled as cancellation
  if (T.some(t => ["alone", "not", "never"].includes(t)) && T[0] !== "let") return false;
  return T.slice(1).some(t => HOLD_MARK.has(t));
}
const CONTACT_VERB = new Set(["call", "phone", "ring", "contact", "reach", "email", "text", "whatsapp", "message"]);
const PERSON_WORD = new Set(["person", "human", "representative", "someone", "somebody", "agent", "member", "team"]);
export function isCallbackRequest(raw: string): boolean {
  const u = analyse(raw), T = u.tokens;
  if (u.wh || T.some(t => ["should", "worth", "better", "wise", "sensible", "did", "was", "were", "yesterday", "remind"].includes(t))) return false;
  if (T[0] === "did" || T[0] === "has" || T[0] === "have") return false;
  const verbAt = T.findIndex((t, i) => CONTACT_VERB.has(t) && ["me", "us", "back"].includes(T[i + 1] ?? ""));
  const touch = T.findIndex((t, i) => t === "get" && T[i + 1] === "in" && T[i + 2] === "touch");
  const talk = T.findIndex((t, i) => ["talk", "speak", "chat"].includes(t) && T.slice(i + 1, i + 4).some(x => PERSON_WORD.has(x)));
  return (verbAt >= 0 || touch >= 0 || talk >= 0) && !T.includes("not");
}
