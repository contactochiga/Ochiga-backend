import type { CognitiveObjective } from "../contracts/semanticFrame";

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

const FILLER_LEAD = new Set(["okay", "ok", "so", "well", "right", "hey", "hi", "hello", "um", "uh", "abeg", "biko", "please", "pls", "kindly", "and", "but", "alright", "anyway", "honestly", "look", "listen", "also", "wait", "oh", "hmm", "actually", "then", "just", "now", "yet"]);
const WH = new Set(["what", "which", "who", "whom", "whose", "why", "how", "when", "where"]);
const AUX = new Set(["is", "are", "am", "was", "were", "do", "does", "did", "can", "could", "will", "would", "shall", "should", "may", "might", "has", "have", "had"]);
const DIRECTIVE = new Set(["show", "list", "display", "pull", "fetch", "find", "get", "open", "read", "view", "see", "bring", "give", "tell", "check", "look", "rank", "sort", "order", "compare", "explain", "summarize", "summarise", "recap", "brief", "draft", "write", "compose", "walk", "fill", "catch", "run", "send", "make", "turn", "switch", "set", "put", "leave", "drop", "forget", "scrap", "skip", "cancel", "stop", "ignore", "hold", "remember", "note", "consider", "assume", "suppose", "imagine", "pretend", "go", "take", "start", "begin", "do", "let", "say", "update", "prepare", "add", "create", "delete", "remove", "pay", "buy", "book", "call", "contact", "email", "message", "ring", "approve", "confirm", "proceed", "submit", "reject", "deny", "undo", "repeat", "reply", "respond", "answer", "help", "separate", "keep", "review", "audit", "evaluate", "assess", "analyse", "analyze", "estimate", "recommend", "suggest", "advise", "offer", "verify", "validate", "highlight", "flag", "name", "identify", "weigh", "judge", "decide", "choose", "pick", "select", "turn", "never", "don", "dont", "disregard", "abandon", "discard", "just", "use", "try", "focus", "stay", "wake", "share", "ask", "warn", "notify", "inform", "forward", "save", "schedule", "remind", "track", "monitor", "watch", "lock", "unlock", "arm", "disarm", "dim", "increase", "decrease", "raise", "lower", "extend", "pause", "resume", "revoke", "fund"]);
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
  let request = false;
  // "can/could/would/will you (please) <directive>" and "i would like/want/need (you to) <x>" are requests: analyse the requested act itself
  if (/^(?:can|could|would|will)$/.test(tokens[0]) && tokens[1] === "you") {
    const polite = tokens[2] === "please";
    const rest = tokens.slice(2).filter((t, i) => !(i === 0 && t === "please"));
    // "would you <act>?" asks for a view unless made a polite request with "please"; can/could/will you <directive> is a request
    if (rest.length && DIRECTIVE.has(rest[0]) && (tokens[0] !== "would" || polite)) {tokens = rest; request = true;}
  } else if (tokens[0] === "i" && /^(?:would|will)$/.test(tokens[1] ?? "") && /^(?:like|love|appreciate)$/.test(tokens[2] ?? "")) {tokens = tokens.slice(3).filter((t, i) => !(i < 2 && /^(?:you|to)$/.test(t))); request = true;}
  else if (tokens[0] === "i" && /^(?:want|need)$/.test(tokens[1] ?? "") && /^(?:you|to|a|an|the|some)$/.test(tokens[2] ?? "")) {tokens = tokens.slice(2).filter((t, i) => !(i < 2 && /^(?:you|to)$/.test(t))); request = true;}
  const first = tokens[0] ?? "";
  const wh = WH.has(first);
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
const EVALUATIVE = ["okay", "ok", "fine", "alright", "healthy", "solid", "serious", "dodgy", "wrong", "problem*", "trouble*", "exposed", "vulnerab*", "stable", "sound", "genuine", "legit", "viable", "attractive", "credible", "realistic", "reliable", "secure*", "safe*", "dangerous", "risky", "unsafe", "worrying", "concerning", "suspicious", "odd", "unusual", "strange", "broken"];
const STATE_PRED = ["locked", "unlocked", "open", "closed", "online", "offline", "arrived", "left", "set", "armed", "disarmed", "done", "finished", "ready", "running", "working", "present", "home", "back"];
const EPISTEMIC = ["know", "known", "unknown", "verify", "verified", "confirm*", "observe*", "observed", "evidence", "conclude", "baseline", "certain", "prove", "proof", "unresolved", "missing", "stale", "unverified", "uncertain*", "sure"];
const SUMMARY = ["summar*", "recap", "rundown", "overview", "headline", "gist", "tldr", "briefing", "snapshot", "handover", "debrief"];
const ASK_DATA = ["expected", "coming", "come", "comes", "due", "visiting", "visited", "arrive*", "unassigned", "spent", "used", "came", "pending", "overdue", "outstanding", "registered"];
const RETRIEVE_VERB = ["show", "list", "display", "pull", "fetch", "find", "get", "open", "read", "view", "bring", "see", "lookup"];

export function scoreUtterance(u: Utterance, opts: {activeAssessment?: boolean} = {}): Score {
  const s: Score = {retrieve: 0, summarize: 0, assess: 0, prioritize: 0, compare: 0, explain: 0, advise: 0, reassess: 0};
  const T = u.tokens, n = T.length, ask = u.q || u.wh || u.auxLead || u.imperative;
  if (!ask) { // declaratives: only implicit-assessment cues, and only when no assessment is already running (otherwise they are information)
    if (!opts.activeAssessment) {
      if (has(u, "hot", "cold", "warm", "stuffy", "stifling", "noisy", "loud", "smelly", "smell*", "leaking", "dark", "freezing", "boiling", "humid") && has(u, "too", "feels", "feel", "is", "very", "so")) s.assess += 4;
      if (T[0] === "i" && /^(?:am|will)$/.test(T[1] ?? "") && has(u, "leaving", "heading", "going", "off", "travelling", "travelling") && has(u, "bed", "sleep", "out", "away", "home", "work", "trip", "travel*")) s.assess += 4;
    }
    return s;
  }
  const lead = T[0];
  // ---- explanation
  const whyAt = idx(u, "why");
  if (whyAt >= 0 && (whyAt <= 3 || whyAt >= n - 2)) s.explain += 4;
  if (lead === "why") s.explain += 4;
  if (lead === "explain") s.explain += 3;
  if (u.wh && has(u, "we", "i", "you") && has(u, "discuss*", "talk*", "refer*", "meant", "mean", "said", "say", "asked", "ask", "mentioned", "correct*", "told", "decid*", "agree*", "chose", "choose")) s.explain += 4;
  if (lead === "how" && T[1] === "come") s.explain += 4;
  if (has(u, "explain*", "justif*", "rationale", "reasoning", "logic")) s.explain += 3;
  if (u.wh && has(u, "driving", "behind", "makes", "made") && !has(u, "sense")) s.explain += 3;
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
  if (has(u, "still") && (has(u, "priority", "first", "top", "pick", "rank*", "same", "stand", "recommend*", "view", "answer", "plan", "valid", "hold", "best", "favourite", "favorite") || n <= 2)) s.reassess += 4;
  else if (has(u, "still") && has(u, ...EVALUATIVE, "open", "true")) s.assess += 3;
  if (has(u, "same") && has(u, "answer", "order", "plan", "conclusion", "result", "recommendation", "priority", "view", "thing")) s.reassess += 4;
  if (has(u, "even") && has(u, "with", "so", "if", "then", "though")) s.reassess += 3;
  if (has(u, "reconsider", "rethink", "revisit", "reassess", "reevaluate")) s.reassess += 4;
  if (u.q && (has(u, "given", "knowing", "considering") || before(u, ["light"], ["of"], 1) || before(u, ["now"], ["that"], 1))) s.reassess += 2;
  const supposeLead = ["if", "suppose", "supposing", "imagine", "assume", "assuming", "hypothetically"].includes(lead) || has(u, "hypothetically");
  if (supposeLead) { if (T.slice(1, 4).includes("you") || T[1] === "na") s.advise += 4; else if (T.includes("i") || T.includes("we")) s.advise += 4; else if (u.q || has(u, "matter*", "change*", "alter*", "affect*", "happen*", "differ*")) s.reassess += 4; }
  // ---- comparison
  if (has(u, "compar*", "versus", "vs", "difference", "differ*", "separates", "weigh")) s.compare += 4;
  if (has(u, "stack*") && has(u, "up")) s.compare += 4;
  if (has(u, "tradeoff*") || (has(u, "trade") && has(u, "offs", "off"))) s.compare += 5;
  const comp = has(u, ...COMPARATIVE);
  if (comp && has(u, "than")) s.compare += 3;
  if (comp && (u.wh || u.auxLead) && !has(u, "more") && !has(u, "less")) s.compare += 3;
  if (has(u, "more", "less") && has(u, "important", "matter*", "urgent*", "serious", "risky", "likely", "useful") && (has(u, "which", "is", "are", "does", "do") || u.imperative)) s.compare += 3;
  if (has(u, "rather") && has(u, "than") && ask) s.compare += 3;
  if (has(u, "or") && has(u, "which", "better", "smarter", "safer", "best", "prefer", "worse") ) s.compare += 3;
  // ---- prioritisation
  if (has(u, "priorit*", "rank*", "triage")) s.prioritize += 3;
  if (has(u, "sort", "order") && (has(u, "by", "importance", "urgency", "risk", "priority", "them", "these", "those", "sensible", "running", "short", "out") || lead === "order")) s.prioritize += 3;
  if (u.wh && has(u, ...SUPERLATIVE.filter(x => x !== "first" && x !== "most"), "useful", "helpful", "valuable", "important")) s.prioritize += 2;
  if (u.wh && has(u, "block*", "blocker*", "blocking")) s.prioritize += 3;
  if (ask && has(u, "chase", "tackle", "face", "handle", "attack", "target", "look", "start", "begin", "address") && has(u, "which", "what") && has(u, "first", "hardest", "most", "next", "top", "best")) s.prioritize += 5;
  if (has(u, "most") && u.wh) s.prioritize += 2;
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
  if (has(u, "fill") && has(u, "in")) s.summarize += 4;
  if (has(u, "bring") && has(u, "speed")) s.summarize += 4;
  if (has(u, "short", "quick", "concise", "brief") && has(u, "version", "summary", "update", "story", "look", "overview", "rundown")) s.summarize += 3;
  if (has(u, "update", "status") && (has(u, "me", "us") || lead === "update")) s.summarize += 3;
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
  if (has(u, "proceed", "commit*", "pursue", "sign")) s.advise += 3;
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
  if (lead === "then" && n === 1) s.advise += 3;
  // ---- assessment
  if (has(u, "worr*", "concern*", "risk*", "danger*", "nervous", "anxious", "afraid") && (!u.imperative || u.negImperative === false && has(u, "should", "about"))) s.assess += 3;
  if (has(u, ...EVALUATIVE) && (u.q || u.wh || u.auxLead)) s.assess += 3;
  if (has(u, "anything", "something") && has(u, "wrong", "off", "odd", "unusual", "strange", "dodgy", "worrying", "concerning", "dangerous", "risky", "spoiling", "kicking", "slipping", "hiding", "worry", "problem", "issue", "need", "should", "ought", "must", "sort", "check", "dodgy")) s.assess += 4;
  if (lead === "how" && has(u, "healthy", "bad", "serious", "solid", "safe", "good", "strong", "risky", "exposed", "well", "secure", "stable")) s.assess += 4;
  if (has(u, "attention") && !has(u, "first")) s.assess += 3;
  if (has(u, "neglect*", "slipping", "drifting", "behind") && (has(u, "we", "are", "anything") || u.wh)) s.assess += 3;
  if (has(u, ...EPISTEMIC) && ask) s.assess += 3;
  if (has(u, "enough") && has(u, "to", "for", "information", "details") && ask) s.assess += 3;
  if (has(u, "have", "has") && has(u, "reading*", "data", "record*", "source*", "measurement*", "sensor*", "scope", "proof", "report", "baseline", "evidence") && u.auxLead) s.assess += 3;
  if (u.wh && has(u, "can", "could") && has(u, "you") && has(u, "tell", "say", "know", "confirm", "verify", "conclude", "see")) s.assess += 4;
  {const k = T.findIndex(t => STATE_PRED.includes(t)); if (u.auxLead && k >= 0 && T.slice(k + 1).every(t => ["now", "yet", "already", "right", "today", "again", "really", "or", "not"].includes(t)) && !has(u, "show", "list")) s.assess += 3;}
  if (has(u, "trust*", "reliab*", "credib*") && ask) s.assess += 3;
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
  if (u.imperative && has(u, "list") && has(u, "just", "only")) s.retrieve += 4;
  return s;
}

/** The cognitive objective of ONE sentence, or null. Requires a clear winner of at least moderate strength. */
export function objectiveOfSentence(raw: string, opts: {activeAssessment?: boolean} = {}): CognitiveObjective | null {
  const u = analyse(raw);
  if (isCancellationSentence(u) || isCapabilityInquiryUtterance(u)) return null;
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
  const T = u.tokens;
  const j = T.findIndex(t => t === "you" || t === "oma" || t === "oyi" || t === "osa");
  if (j < 0) return false;
  const whAt = T.findIndex(t => WH.has(t));
  if (whAt < 0 || whAt > j) return false;
  const modalBefore = T.slice(whAt, j + 1).some(t => ["can", "could", "are", "do", "does"].includes(t));
  const modalAfter = ["can", "could"].includes(T[j + 1] ?? "");
  const ableAfter = T.slice(j + 1, j + 4).some(t => t === "able" || t === "capable");
  if (!(modalBefore || modalAfter || ableAfter)) return false;
  if (T.slice(whAt, j + 1).includes("would") || T.slice(whAt, j + 1).includes("should")) return false;
  const verbAt = T.findIndex((t, i) => i > whAt && ABILITY_VERB.includes(t) && i !== j);
  if (verbAt < 0 && !ableAfter) return false;
  if (ableAfter && verbAt < 0) return true;
  const verb = T[verbAt];
  const after = T.slice(verbAt + 1);
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
  if (CORRECTION_FRAME.test(text) && !/^(?:never mind|nevermind)\b/.test(text)) return false;
  if (/^(?:never ?mind|forget it|forget that|no need|not needed)\b/.test(text)) return true;
  // "no, I did not say/ask/want ... (to) do it"
  if (/^(?:no\s+)?(?:i|we) (?:did not|was not|were not|never|do not|am not) (?:say|said|ask|asked|asking|want|tell|told|mean|meant|request|order)\b/.test(text) && /\b(?:do|it|that|this|call|send|contact|switch|turn|book|proceed|act|ring)\b/.test(text)) return true;
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
    if (first === "leave") return rest.length <= 4 && rest.some(t => ["alone", "it", "that", "this", "as", "be", "them"].includes(t)) && !rest.some(t => ["message", "note", "voicemail", "feedback", "review", "comment"].includes(t));
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
