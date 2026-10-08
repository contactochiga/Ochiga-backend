import { contentTokens, type AnswerTarget } from "./answerTarget";
import { analyse } from "../interpretation/semanticObjective";
import { conceptOf } from "../interpretation/conceptLexicon";
import type { EnvelopeRecord, ResultEnvelope } from "./resultEnvelope";
import { clarificationQuestion, limitationAnswer } from "./limitationTarget";
import { acknowledgeConstraint } from "./constraintAck";

// IQ-8D canonical response projector. It consumes ONE carried AnswerTarget and ONE ResultEnvelope and returns the primary answer, separated from
// supporting detail. Small typed projections by response intent; no reasoning, ranking, judging, querying or authority. It never parses prose and
// never re-derives the target: the only text it receives from the user is `asked`, quoted back verbatim in limitation sentences.

export type Projection = { shape: string; primary: string; supporting: string[] };
const norm = (s: string) => s.toLowerCase();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const stem = (w: string) => w.replace(/(?:ing|ed|es|s)$/, "");
const GENERIC = new Set(["issue", "issues", "request", "requests", "item", "items", "problem", "ticket", "tickets", "lead", "leads", "report", "reports", "task", "tasks", "record", "records", "visitor", "visitors", "device", "devices", "transaction", "transactions", "opportunity", "opportunities", "project", "projects", "incident", "incidents", "access", "list", "names", "name", "estate", "home", "need", "needs", "attention", "waiting", "approval", "approve", "stand", "tell", "give", "display", "details", "guest", "guests", "pass", "passes", "deal", "deals", "prospect", "prospects", "job", "jobs", "event", "events", "document", "documents", "gadget", "gadgets", "appliance", "appliances", "sensor", "sensors"]);
const OPPOSITE: Record<string, string> = { closed: "open", resolved: "open", fixed: "open", completed: "open", done: "open", open: "resolved", active: "inactive", current: "expired", stale: "fresh", overdue: "on time" };

const wordsOf = (r: EnvelopeRecord) => analyse(r.label).tokens.filter(t => !/^wave\d*$/.test(t));
function scopeTokens(e: ResultEnvelope) { return new Set(contentTokens(analyse(`${e.subject.noun} ${e.subject.singular} ${e.subject.object_class ?? ""} ${e.subject.domain ?? ""}`).tokens)); }
function matches(r: EnvelopeRecord, q: string): boolean {
  const st = norm(r.status ?? ""), hay = norm(`${r.status ?? ""} ${r.detail ?? ""} ${r.fields ? Object.values(r.fields).join(" ") : ""}`);
  // IQ-9A4: a pass recorded active whose recorded expiry has passed is not "active" for a validity question (see visitorPassState)
  if (/^(?:active|valid|current|open)$/.test(q) && /past its recorded expiry/.test(st)) return false;
  if (q === "open") return !/\b(?:resolved|closed|completed|cancelled|canceled|expired|done|inactive)\b/.test(st) && (r.state ? r.state === "open" || r.state === "overdue" || r.state === "stale" : true);
  if (q === "resolved") return r.state === "resolved" || /\b(?:resolved|closed|completed|done)\b/.test(st);
  if (q === "stale") return r.state === "stale" || /\b(?:stale|expired|outdated|old)\b/.test(hay);
  if (q === "overdue") return r.state === "overdue" || /\boverdue|\blate\b/.test(hay);
  return hay.includes(stem(q));
}
const canon = (t: string) => { const c = conceptOf(t); return c === "open" || c === "resolved" || c === "stale" || c === "overdue" ? c : t; };
function qualifiers(t: AnswerTarget, e: ResultEnvelope) {
  const neg = new Set(t.negated_qualifiers.map(canon));
  const all = [...new Set(t.qualifier_tokens.map(canon))].map(q => (neg.has(q) ? (OPPOSITE[q] ?? q) : q));
  const pop = norm(e.subject.population ?? "");
  const inPopulation = all.filter(q => pop && pop.includes(stem(q)));
  return { all, inPopulation };
}
const label = (r: EnvelopeRecord) => `${r.label}${r.status ? ` (${r.status}${r.detail ? `; ${r.detail}` : ""})` : r.detail ? ` (${r.detail})` : ""}`;
const list = (rs: EnvelopeRecord[], max = 8) => rs.slice(0, max).map(label).join(", ") + (rs.length > max ? `, and ${rs.length - max} more` : "");

function narrow(t: AnswerTarget, e: ResultEnvelope) {
  const all = e.records || [], scope = scopeTokens(e);
  const names = new Set(t.subject_tokens.filter(w => !GENERIC.has(w) && !scope.has(w)));
  const named = all.filter(r => wordsOf(r).some(w => names.has(w) && !GENERIC.has(w)));
  let rows = named.length && named.length < all.length ? named : all;
  const q = qualifiers(t, e);
  const applicable = q.all.filter(x => rows.some(r => matches(r, x)) && !q.inPopulation.includes(x));
  if (applicable.length) rows = rows.filter(r => applicable.every(x => matches(r, x)));
  const unmatched = q.all.filter(x => !applicable.includes(x) && !q.inPopulation.includes(x));
  return { rows, named, applicable, inPopulation: q.inPopulation, unmatched, all, asked: q.all };
}

function limitationText(e: ResultEnvelope, asked: string, t: AnswerTarget): string {
  const k = e.limitations?.[0];
  if (e.availability === "denied" || k?.kind === "AUTHORITY_DENIED") return `I can't do that for you here: you are not authorised to use it from this surface or scope${asked ? ` (“${asked}”)` : ""}.`;
  if (k?.kind === "MISSING_CAPABILITY" || e.capability_status === "declared") return `I can't tell you that: ${k?.label ?? e.subject.noun} ${k?.label ? "are" : "is"} not available yet, so I would only be guessing.`;
  return limitationAnswer(t, asked);
}
const noRecords = (e: ResultEnvelope, scoped: string) => `There are no ${scoped}${e.subject.noun} in what I read.`;

/** Is the canonical projector obliged to answer this (valid target + an envelope that supports it)? Specialised owners are exempt. */
export function projectionRequired(t: AnswerTarget, e: ResultEnvelope): boolean {
  if (!(e.availability === "answered" || e.availability === "empty") || !e.records || e.held_facts) return false;
  return ["LIST", "COUNT", "STATUS", "DIRECT_ANSWER", "SUMMARY"].includes(t.response_intent) && !t.refusal_kind && !t.confirmation_kind;
}

function pickMeasures(t: AnswerTarget, e: ResultEnvelope) {
  const ms = e.measures || [];
  const dir = t.flow ? ms.filter(m => m.direction === t.flow) : [];
  if (dir.length) return dir;
  const toks = new Set([...t.subject_tokens, ...t.qualifier_tokens].map(stem));
  const hit = ms.filter(m => analyse(m.label).tokens.some(w => toks.has(stem(w)) && !GENERIC.has(w)));
  return hit.length ? hit : ms;
}
const money = (cur: string, n: number) => `${cur} ${Number(n).toLocaleString("en-NG")}`;
function measureText(e: ResultEnvelope, ms: NonNullable<ResultEnvelope["measures"]>): string {
  return ms.map(m => {
    const partial = m.partial ? " (the read hit its limit, so this may not cover everything)" : "";
    if (m.direction && m.n !== undefined) return m.n === 0 && !m.amount ? `Nothing ${m.direction === "out" ? "went out" : "came in"} in what I read.` : `${money(m.currency, m.amount)} ${m.direction === "out" ? "went out" : "came in"} across ${m.n} ${m.n === 1 ? e.subject.singular : e.subject.noun}${partial}.`;
    if (m.unit === "count") return `${cap(m.label)}: ${Number(m.amount).toLocaleString("en-NG")}${partial}.`;
    return `${cap(m.label)}: ${money(m.currency, m.amount)}${partial}.`;
  }).join(" ");
}

export function projectResponse(t: AnswerTarget, e: ResultEnvelope, ctx: { asked: string; raw?: string }): Projection | null {
  const sup = (...xs: string[]) => xs.filter(Boolean);
  const done = (shape: string, primary: string, ...more: string[]): Projection => ({ shape, primary, supporting: sup(...more) });
  const legacy = e.legacy_prose;
  const intent = t.response_intent;
  if (t.confirmation_kind === "constraint") return done("CONSTRAINT", acknowledgeConstraint(ctx.raw ?? ctx.asked));
  if (intent === "CLARIFICATION") return done("CLARIFICATION", clarificationQuestion(t));
  if (intent === "LIMITATION") return done("LIMITATION", limitationAnswer(t, ctx.asked));
  if (intent === "CAPABILITY_DISCOVERY" || intent === "CONFIRMATION_STATE" || intent === "ACTION_RESULT") return null; // specialized owners
  if (intent === "REFUSAL") return done("REFUSAL", limitationAnswer(t, ctx.asked));
  // 1. availability / limitation first: a capability that did not answer is projected as the specific limitation, never as an answer
  if (e.availability === "denied" || e.availability === "unsupported" || e.availability === "unavailable") return done("LIMITATION", limitationText(e, ctx.asked, t));
  // 2. held (public) facts
  if (e.held_facts) return projectHeld(t, e, ctx);
  // 3. facet the capability cannot provide (consumption from a spending source, an earlier point in time from a current-only source)
  if (t.facet === "usage" && !e.subject.facets.includes("usage")) return done("LIMITATION", `I can't tell you how much you used: I can see what was spent, but consumption (usage) readings are not available yet.`, legacy);
  if (t.past_reference && !e.subject.facets.includes("history") && (intent === "STATUS" || intent === "LIST" || intent === "COUNT" || intent === "DIRECT_ANSWER" || e.value))
    return done("HISTORY", `I can only give the current ${e.value ? "value" : e.subject.noun}, not an earlier one: I have no earlier snapshot to compare with.`, legacy);
  // 4. named amounts the capability computed (totals / aggregates), independent of whether any records exist
  if (e.measures?.length && (t.quantity === "sum" || t.quantity === "value" || !e.records?.length)) return done("AGGREGATE_VALUE", measureText(e, pickMeasures(t, e)), legacy);
  if (t.quantity === "sum") return done("LIMITATION", `I can't give you a total amount for ${e.subject.noun}: what I read lists individual entries but no total, and I won't add up partial information.`, legacy);
  // 5. current value (balance)
  if (e.value && (t.quantity === "value" || ["STATUS", "DIRECT_ANSWER", "LIST", "COUNT", "SUMMARY", "ASSESSMENT"].includes(intent))) {
    const v = e.value; return done("VALUE", `${cap(v.label ?? "Balance")}: ${v.currency} ${Number(v.amount).toLocaleString("en-NG")}${v.as_of ? ` (as of ${v.as_of})` : ""}${v.frozen ? ". This wallet is currently frozen" : ""}.`, legacy);
  }
  if (t.facet === "balance" && !e.subject.facets.includes("balance") && !e.value && e.subject.object_class === "wallet") return null; // wrong source for the facet: left to routing (IQ-8E)
  if (intent === "YES_NO_WITH_REASON" && (t.yes_no?.kind === "state" || t.yes_no?.kind === "capability")) {
    if (e.subject.object_class === "camera" && e.limitations?.some(l => l.kind === "UNOBSERVED")) return done("YES_NO", `I can't tell — the camera's current video state is unknown, which is neither an outage nor normal operation.`, legacy);
    if (e.hints?.permission_only && t.state_concept && (t.state_concept === "arrived" || t.state_concept === "departed")) return done("YES_NO", `I can't tell — a visitor access record is permission, not evidence that anyone has arrived or left.`, legacy);
  }
  if (!e.records && e.hints?.requires_judgment && (intent === "RANKING" || intent === "COMPARISON")) return done("LIMITATION", "I can't put them in order or pick one: that takes comparative judgment on their recorded notes, which I don't have here.", legacy);
  // an empty read whose capability could not load its source is an unavailable source, never "there are none"
  const unavailable = e.limitations?.find(l => l.kind === "UNAVAILABLE" && l.label);
  if (unavailable && !e.records?.length && ["LIST", "COUNT", "STATUS", "DIRECT_ANSWER", "SUMMARY", "YES_NO_WITH_REASON"].includes(intent)) return done("LIMITATION", `I could not load a current ${unavailable.label}, so I can't tell you what is there — that is not the same as there being none.`, legacy);
  if (!e.records) return null;
  const n = narrow(t, e), rows = n.rows, noun = e.subject.noun, one = e.subject.singular;
  const askedN = (c: number) => `${c} ${c === 1 ? one : noun}`;
  const trunc = e.truncated || (e.total_count != null && !e.total_qualifier && e.total_count > (e.count ?? 0));
  const support = sup(legacy);
  const eff = intent === "DIRECT_ANSWER" || intent === "SUMMARY" || (intent === "LIST" && !t.top_n) ? (n.named.length === 1 ? "STATUS" : intent === "LIST" ? "LIST" : "LIST") : intent;
  // IQ-9A4: an expiry conflict is never presented as a confirmed active pass, nor as "none active": the conflict is stated.
  const expiryConflicts = (e.records || []).filter(r => /past its recorded expiry/i.test(r.status || ""));
  if (expiryConflicts.length && (n.asked.some(q => /^(?:active|valid|current)$/.test(q)) || (e.hints?.permission_only && /\b(?:valid|active|current(?:ly)?|usable|in\s+date)\b/i.test(ctx.raw || ""))) && ["COUNT", "YES_NO_WITH_REASON", "LIST"].includes(eff)) {
    const confirmed = (e.records || []).filter(r => matches(r, "active") && !/inactive/i.test(r.status || ""));
    return done(eff === "LIST" ? "LIST" : eff === "COUNT" ? "COUNT" : "YES_NO", `${(e.records || []).length} ${(e.records || []).length === 1 ? one : noun} on record. ${confirmed.length ? `${confirmed.length} ${confirmed.length === 1 ? one : noun} ${confirmed.length === 1 ? "is" : "are"} confirmed active (${confirmed.map(r => r.label).join(", ")}). ` : "I can't confirm that any is currently valid. "}${expiryConflicts.length} ${expiryConflicts.length === 1 ? "is" : "are"} recorded as active but ${expiryConflicts.length === 1 ? "its" : "their"} recorded expiry time has passed (${expiryConflicts.map(r => r.label).join(", ")}), so ${expiryConflicts.length === 1 ? "its" : "their"} validity isn't confirmed from these records. These are permission records, not proof of anyone's arrival.`, ...support);
  }
  // IQ-9A5: a permission-only record answers permission questions; a presence question about it is answered with that limit, then the records
  if (e.hints?.permission_only && /\b(?:at\s+the\s+(?:door|gate)|outside|inside|arrived|is\s+here|here\s+(?:now|yet))\b/i.test(ctx.raw || "") && ["STATUS", "DIRECT_ANSWER", "LIST", "SUMMARY"].includes(intent) && e.records?.length) {
    return done("YES_NO", `I can't say anyone is at the door or has arrived: visitor access records show permission (active or inactive), not whether anyone has turned up, is here or has left. What is recorded: ${list(e.records, 4)}.`, ...support);
  }
  // IQ-9A5: a comparison of RECORDED days since activity between named records is a field comparison, not a business judgment
      if ((eff === "COMPARISON" || eff === "LIST") && n.named.length >= 2 && /\b(?:longer|longest|more\s+recent|less\s+recent|older|newer|which)\b/i.test(ctx.raw || "") && n.named.every(r => r.age_days != null) && /\bactivity\b/i.test(ctx.raw || "")) {
        const byAge = [...n.named].sort((a, b) => (b.age_days as number) - (a.age_days as number));
        if (byAge[0].age_days === byAge[1].age_days) return done("COMPARISON", `${byAge.map(r => `${r.label}: ${r.age_days} days since its last recorded activity`).join("; ")}. They are level on that recorded field; this is not a judgment of which matters more.`, ...support);
        return done("COMPARISON", `${byAge[0].label} has gone longer without recorded activity: ${byAge.map(r => `${r.label} ${r.age_days} days`).join(", ")} since last recorded activity. This compares a recorded field only; it is not a judgment of which matters more.`, ...support);
      }
  switch (eff) {
    case "COUNT": {
      const useTotal = e.total_count != null && e.total_qualifier === "open" && n.asked.includes("open") && !n.applicable.includes("open");
      const c = useTotal ? e.total_count! : rows.length;
      const qual = [...n.applicable, ...n.inPopulation].join(" and ");
      if (c === 0) { const zq = [qual, ...(e.records!.length ? [] : n.unmatched)].filter(Boolean).join(" and "); return done("COUNT", noRecords(e, zq ? `${zq} ` : ""), ...support); }
      if (useTotal) return done("COUNT", `There ${c === 1 ? "is" : "are"} ${c} open ${c === 1 ? one : noun}; ${rows.length} of them ${rows.length === 1 ? "needs" : "need"} attention.`, ...support);
      return done("COUNT", `There ${c === 1 ? "is" : "are"} ${trunc ? "at least " : ""}${c} ${qual ? qual + " " : ""}${c === 1 ? one : noun}${e.subject.population && !n.applicable.length && !n.inPopulation.length ? ` ${e.subject.population}` : ""}.`, ...support);
    }
    case "LIST": {
      if (!e.records.length) return done("LIST", `${cap(noRecords(e, ""))}`, ...support);
      if (!rows.length) return done("LIST", `None of the ${noun} I read match that.`, ...support);
      const head = cap(e.subject.population ? `${noun} ${e.subject.population}` : noun);
      const note = n.unmatched.length && !n.applicable.length ? ` I could not filter by "${n.unmatched.join(", ")}" from the records I read, so this is the full list.` : "";
      return done("LIST", `${head}${n.applicable.length ? ` (${n.applicable.join(", ")})` : ""}: ${list(rows)}.${trunc ? ` This is a truncated view${e.total_count != null ? ` (${e.total_count} in total)` : ""}.` : ""}${e.limitations?.some(l => l.kind === "STALE") ? " These readings are stale, so none of them shows a current condition (including whether anything is offline)." : ""}${note}`, ...support);
    }
    case "STATUS": {
      if (!e.records.length) return done("STATUS", `I do not see any ${noun} on record in what I read — that is what the records show, not proof that nothing is wrong.`, ...support);
      if (n.named.length === 1) { const r = n.named[0]; const extra = r.fields ? Object.entries(r.fields).filter(([k, v]) => v !== null && v !== "" && !["name", "title", "id", "status", "stage", "reason"].includes(k)).slice(0, 3).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`) : []; return done("DETAIL", `${r.label}: ${r.status ?? "recorded"}${r.detail ? `; ${r.detail}` : ""}${r.age_days != null ? `; ${r.age_days} days since its last recorded activity` : ""}${extra.length ? ` (${extra.join(", ")})` : ""}.`, ...support); }
      const by = new Map<string, EnvelopeRecord[]>(); for (const r of rows) by.set(norm(r.status || "recorded"), [...(by.get(norm(r.status || "recorded")) || []), r]);
      const parts = [...by].map(([s, rs]) => `${rs.length} ${s}${rs.length <= 3 ? ` (${rs.map(r => r.label).join(", ")})` : ""}`);
      const fresh = e.limitations?.some(l => l.kind === "STALE") ? " The readings behind this are stale, so they show no current condition." : "";
      return done("STATUS", `${cap(askedN(rows.length))} on record: ${parts.join("; ")}.${fresh}`, ...support);
    }
    case "YES_NO_WITH_REASON": {
      const kind = t.yes_no?.kind;
      if (kind === "inference") return done("YES_NO", `No — that does not establish it: what I can read only covers what is recorded, and a record showing nothing is not an all-clear.`, ...support);
      if (kind !== "state" && kind !== "capability") return null;
      // IQ-9A10 R6: a state question about ONE named device is answered from that device's own record, never from the aggregate of every device
      if (kind === "state" && e.subject.domain === "devices" && n.named.length === 1 && /\b(?:on|off)\b/i.test(ctx.raw || ctx.asked || "")) {
        const r = n.named[0], wantOn = /\bon\b/i.test(ctx.raw || ctx.asked || ""), st = String(r.status || "");
        const stale = Boolean(e.limitations?.some(l => l.kind === "STALE" || l.kind === "UNOBSERVED")) || /stale|expired|unknown|unobserved|offline/i.test(st) || !/\b(?:on|off)\b/i.test(st);
        if (stale) return done("YES_NO", `I can't tell whether ${r.label} is ${wantOn ? "on" : "off"}: its latest reading is not current, so it shows no confirmed state. Nothing has been sent to it.`, ...support);
        const isOn = /\bon\b/i.test(st);
        return done("YES_NO", `${isOn === wantOn ? "Yes" : "No"} — ${r.label} is ${isOn ? "on" : "off"} (${st}).`, ...support);
      }
      if (n.named.length === 1 && (t.state_concept === "open" || t.state_concept === "resolved")) {
        const r = n.named[0], closed = r.state === "resolved" || /resolved|closed|completed|done/i.test(r.status || ""), yes = t.state_concept === "resolved" ? closed : !closed;
        if (/\b(?:open|unresolved|pending|still\s+open)\s+or\s+(?:resolved|closed|done|fixed)\b|\b(?:resolved|closed|done|fixed)\s+or\s+(?:still\s+)?(?:open|unresolved|pending)\b/i.test(ctx.raw || "")) return done("YES_NO", `${cap(r.label)} is ${closed ? "resolved" : "still open"}${r.detail ? ` (${r.detail})` : ""}.`, ...support);
        return done("YES_NO", `${yes ? "Yes" : "No"} — ${r.label} is ${closed ? "resolved" : "still open"}${r.detail ? ` (${r.detail})` : ""}.`, ...support);
      }
      if (kind === "capability") return null;
      // IQ-9A4: a YES that someone is attending to / working on / handling a record needs a record that says so (progress status, acknowledgement or
      // assignment). The existence of the request licenses nothing about attendance; unknown stays unknown.
      if (/\b(?:looked\s+(?:at|into|after)|looking\s+(?:at|into|after)|attend(?:ed|ing)\s+to|working\s+on|worked\s+on|dealt\s+with|dealing\s+with|being\s+(?:handled|addressed|actioned|fixed|seen\s+to)|(?:started|begun)\s+(?:work(?:ing)?|on)|taken\s+care\s+of|picked\s+up|acknowledged|assigned\s+to)\b/i.test(ctx.raw || "")) {
        const attended = rows.filter(r => /\b(?:in[ _]progress|acknowledged|assigned|dispatched|attending|started)\b/i.test(`${r.status ?? ""} ${r.detail ?? ""}`) || Boolean(r.fields && (r.fields as Record<string, unknown>).assigned_to));
        if (attended.length) return done("YES_NO", `Yes — recorded as in progress or assigned: ${list(attended, 4)}.`, ...support);
        return done("LIMITATION", `I can't confirm that anyone is working on ${rows.length === 1 ? "it" : "them"}. ${rows.length ? `What is recorded: ${list(rows, 4)}. ` : ""}A recorded ${one} doesn't show that anyone has picked it up, and these records carry no acknowledgement or assignment — so whether it is being looked at is unknown, not a no.`, ...support);
      }
      // IQ-9A truth licence: a YES must be licensed by the records. Presence of unrelated records licenses nothing, and a permission-only record
      // (visitor access) never licenses a claim about presence, arrival, departure or location.
      const licensed = t.existential || n.applicable.length > 0 || n.named.length > 0 || (t.state_concept && ["open", "resolved", "stale", "overdue"].includes(t.state_concept));
      if (e.hints?.permission_only && !(n.applicable.length > 0 || (t.state_concept && ["open", "resolved", "stale", "overdue"].includes(t.state_concept)) || t.existential)) return done("YES_NO", `I can't confirm that from visitor access records: they show permission (active or inactive), not whether anyone has arrived, is here, has left or needs action.`, ...support);
      if (!licensed) return done("LIMITATION", `I can't confirm that from these records: they show the ${noun} and their recorded status, but nothing that answers what you asked.`, ...support);
      return done("YES_NO", rows.length ? `Yes — ${askedN(rows.length)}${n.applicable.length ? ` ${n.applicable.join(" and ")}` : ""}: ${list(rows, 4)}.` : `No — I found no ${n.applicable.length ? n.applicable.join(" and ") + " " : ""}${noun} in what I read.`, ...support);
    }
    case "EXPLANATION": {
      if (n.named.length === 1) { const r = n.named[0]; if (r.detail || r.status) return done("EXPLANATION", `${r.label} is ${r.status ?? "on record"}${r.detail ? `: ${r.detail}` : ""}${r.age_days != null ? `; ${r.age_days} days since its last recorded activity` : ""}.`, ...support); }
      return done("LIMITATION", `I can't give a reason for that from these records: they show each ${one} and its recorded status, but not why.`, ...support);
    }
    case "RANKING": case "COMPARISON": case "ADVICE": case "NEXT_STEP": {
      if (!e.hints?.requires_judgment) return null;
      return done("RANKING", `${rows.length ? `${cap(e.subject.population ? `${noun} ${e.subject.population}` : noun)}: ${list(rows)}.\n\n` : ""}I can't put them in order or pick one: that takes comparative judgment on their recorded notes, which I don't have here.`, ...support);
    }
    case "SAFETY_RISK": {
      if (e.subject.domain !== "facility") return null;
      const m = (e.records || []).filter(r => r.fields?.kind === "maintenance request"), inc = (e.records || []).filter(r => r.fields?.kind === "security incident");
      const scope = e.limitations?.some(l => l.kind === "UNAVAILABLE") ? "Some evidence is unavailable, so this is not a complete verdict." : "This covers maintenance and security records only, so I cannot rule out anything else.";
      return done("SAFETY_RISK", `${inc.length ? `${inc.length} open security incident${inc.length === 1 ? "" : "s"}: ${inc.slice(0, 3).map(r => r.label).join(", ")}.` : "No security incident is open in the records I read."}${m.length ? ` The open maintenance item${m.length === 1 ? "" : "s"} that could matter for safety: ${list(m, 5)}.` : " No open maintenance request is recorded."} ${scope}`, ...support);
    }
    default: return null;
  }
}

const nice = (k: string) => k.replace(/_/g, " ");
const joinList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
function projectHeld(t: AnswerTarget, e: ResultEnvelope, ctx: { asked: string }): Projection | null {
  const h = e.held_facts!, modelled = h.missing !== null, missing = h.missing ?? [];
  const done = (shape: string, primary: string): Projection => ({ shape, primary, supporting: [e.legacy_prose].filter(Boolean) });
  if (!t.is_question) return null;
  if (t.ask_facet === "submission" || t.yes_no?.kind === "submission") {
    const st = e.actions?.submission ?? "unknown";
    return done("SUBMISSION_STATE", st === "submitted" ? "Yes — what you told me has been handed to the team." : st === "not_submitted" ? "No — nothing has been submitted to the team yet." : "I can't confirm that: I have no handoff receipt for this conversation, so I can't say your details have reached the team. I'm only holding what you've told me here.");
  }
  const knownText = Object.entries(h.known).map(([a, b]) => `${nice(a)}: ${b}`).join("; ");
  if (t.ask_facet === "outcome") return done("YES_NO", "I can't say how that will turn out, and I can't promise or guarantee it or commit Ochiga to anything; the team reviews each opportunity and decides.");
  if (t.ask_facet === "commitment") return done("YES_NO", t.response_intent === "ADVICE" || t.response_intent === "NEXT_STEP" ? "I can't commit Ochiga or advise you to sign anything; that is for you and the team after a proper review." : "No — I can't promise or guarantee that, or commit Ochiga to anything; the team reviews each opportunity and decides.");
  if (t.ask_facet === "sufficiency" && modelled) return done("YES_NO", missing.length ? `Not yet — for a first look I would still need: ${joinList(missing.map(nice))}.` : "Yes — that is everything we typically need to take a first look.");
  if (t.fact_keys.length && (t.response_intent === "YES_NO_WITH_REASON" || t.response_intent === "STATUS" || t.response_intent === "DIRECT_ANSWER" || t.response_intent === "LIST" || t.response_intent === "EXPLANATION")) {
    const have = t.fact_keys.filter(k => h.known[k]), lack = t.fact_keys.filter(k => !h.known[k]);
    // IQ-9A10 R6: an "X or Y?" choice question is answered with the recorded alternative, never a bare Yes
    const chM = t.compare_terms.length !== 2 ? /\b([a-z]{3,})\s+or\s+(?:an?\s+|the\s+)?([a-z]{3,})\b/i.exec(((ctx as { raw?: string }).raw || ctx.asked) || "") : null;
    const choice = t.compare_terms.length === 2 ? t.compare_terms : chM && (t.yes_no?.kind === "state" || t.yes_no?.kind === "fact") ? [[chM[1].toLowerCase()], [chM[2].toLowerCase()]] : null;
    if (choice && (t.response_intent === "YES_NO_WITH_REASON" || t.yes_no?.kind === "fact")) {
      const sides = choice.map(g => g.join(" ")).filter(Boolean), vals = have.map(k => String(h.known[k]).toLowerCase());
      const hit = choice.map((g, i) => ({ g, i })).filter(({ g }) => g.some(tok => tok.length > 2 && vals.some(v => v.includes(tok.slice(0, Math.max(3, tok.length - 2))))));
      if (hit.length === 1) return done("YES_NO", `${cap(sides[hit[0].i])}, as you told me (${have.map(k => `${nice(k)}: ${h.known[k]}`).join("; ")}). You haven't said it is ${sides[1 - hit[0].i]}.`);
      if (have.length) return done("YES_NO", `You haven't told me it is ${sides[0]} or ${sides[1]}. What I have recorded is ${have.map(k => `${nice(k)}: ${h.known[k]}`).join("; ")}.`);
    }
    if (t.response_intent === "YES_NO_WITH_REASON" || t.yes_no?.kind === "fact") return done("YES_NO", have.length ? `Yes — you have told me ${have.map(k => `${nice(k)}: ${h.known[k]}`).join("; ")}.` : t.compare_terms.length === 2 ? `You haven't told me ${joinList(lack.map(nice))} yet, so I can't say which of those you meant.` : `No — you haven't told me ${joinList(lack.map(nice))} yet.`);
    return done("RECALL", have.length ? `${have.map(k => `${cap(nice(k))}: ${h.known[k]}`).join("; ")}.` : `You haven't told me ${joinList(lack.map(nice))} yet.`);
  }
  if (t.ask_facet === "missing" && modelled) return done("LIST", missing.length ? `What I still need from you: ${joinList(missing.map(nice))}.` : "I don't need anything further for a first look.");
  if (t.ask_facet === "recall" || (t.response_intent === "SUMMARY")) return done("RECALL", Object.keys(h.known).length ? `So far you have told me: ${knownText}.` : "You haven't given me any opportunity details yet.");
  if (t.response_intent === "RANKING") return modelled && missing.length ? done("RANKING", `The most important thing I still need is ${nice(missing[0])}.`) : null;
  if (t.response_intent === "COMPARISON") {
    if (t.subject_tokens.includes("versus") || (t.subject_tokens.includes("know") && t.subject_tokens.some(w => ["check", "need", "missing", "unknown"].includes(w)))) return done("LIST", `What I know: ${knownText || "very little so far"}. What still needs checking: ${modelled && missing.length ? joinList(missing.map(nice)) : "nothing further for a first look"}.`);
    const sides = t.compare_terms.map(g => g.join(" ")).filter(Boolean);
    if (sides.length < 2) {
      const differs = t.subject_tokens.some(x => /^differ/.test(x) || x === "approach" || x === "different");
      return done("LIMITATION", `I can't ${differs ? "say yet whether the approach would differ" : "weigh that yet"}: that depends on what you want from it${modelled && missing.length ? ` and on ${joinList(missing.slice(0, 2).map(nice))}, which I don't have` : ""}.`);
    }
    return done("LIMITATION", `I can't say which of ${sides.length === 2 ? `${sides[0]} or ${sides[1]}` : "those"} suits you better yet: that depends on what you want from the property${modelled && missing.length ? ` and on ${joinList(missing.slice(0, 2).map(nice))}, which I don't have` : ""}.`);
  }
  if ((t.response_intent === "ADVICE" || t.response_intent === "NEXT_STEP") && modelled && missing.length) return done("ADVICE", `The first thing that would help is ${joinList(missing.slice(0, 2).map(nice))}.`);
  void ctx; return null;
}
