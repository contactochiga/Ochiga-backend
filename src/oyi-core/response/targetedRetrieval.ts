import { analyse } from "../interpretation/semanticObjective";
import { contentTokens, type AnswerTarget } from "./answerTarget";

// IQ-8: shape the answer of a plain read capability around the question that was asked (list the items / give the number / state the status /
// answer yes-no). The capability supplies a compact structured view of what it read (`answer_rows`); Core decides the lead. The capability's own
// sentence is kept as supporting context, so counts, truncation notes and privacy notes (e.g. "access codes are never shared") are never lost.

export type AnswerRow = { label: string; status?: string; detail?: string };
export type AnswerRows = { noun: string; singular: string; rows: AnswerRow[]; total?: number | null; population?: string | null; truncated?: boolean };

const GENERIC = new Set(["issue", "issues", "request", "requests", "item", "items", "problem", "ticket", "tickets", "lead", "leads", "report", "reports", "task", "tasks", "record", "records", "visitor", "visitors", "device", "devices", "transaction", "transactions", "opportunity", "opportunities", "project", "projects", "incident", "incidents", "access", "list", "names", "name", "estate", "home", "need", "needs", "attention", "waiting", "approval", "approve", "stand", "tell", "give", "display", "details"]);
const QUAL = new Set(["open", "closed", "resolved", "unresolved", "stale", "expired", "overdue", "pending", "qualified", "new", "active", "inactive", "offline", "online", "high", "low", "urgent", "critical", "late", "outstanding", "unassigned", "approved", "historical"]);
const OPENISH = new Set(["open", "active", "unresolved", "ongoing", "outstanding", "pending", "current", "live"]);
const CLOSEDISH = new Set(["resolved", "fixed", "closed", "done", "completed", "repaired", "finished", "solved", "sorted"]);
const norm = (s: string) => s.toLowerCase();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const nameTokens = (s: string) => contentTokens(analyse(s).tokens).filter(t => !/^wave\d*$/.test(t));
const stem = (w: string) => w.replace(/(?:ing|ed|es|s)$/, "");
const OPEN_Q = new Set(["open", "unresolved", "outstanding", "active", "current", "pending", "ongoing"]), DONE_Q = new Set(["resolved", "closed", "fixed", "done", "completed", "solved"]);
const matchesQual = (r: AnswerRow, q: string) => { const st = norm(r.status ?? ""); if (OPEN_Q.has(q) && st) return !/\b(?:resolved|closed|completed|cancelled|canceled|expired|done)\b/.test(st); if (DONE_Q.has(q) && st) return /\b(?:resolved|closed|completed|done)\b/.test(st); const hay = norm(`${r.status ?? ""} ${r.detail ?? ""}`); return hay.includes(stem(q)) || (q === "overdue" && /overdue|late/.test(hay)) || (q === "open" && /^(?:open|new|pending|in_progress|active|qualified|review|planning)\b/.test(norm(r.status ?? ""))); };
const labelList = (rows: AnswerRow[], max = 8) => { const shown = rows.slice(0, max).map(r => `${r.label}${r.status ? ` (${r.status}${r.detail ? `; ${r.detail}` : ""})` : r.detail ? ` (${r.detail})` : ""}`); return shown.join(", ") + (rows.length > max ? `, and ${rows.length - max} more` : ""); };
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function rowsFromBlocks(blocks: Array<Record<string, unknown>> | undefined, noun: string, singular: string): AnswerRows | null {
  const b = (blocks || []).find(x => (x.type === "record_list" || x.type === "table") && Array.isArray(x.rows) && (x.rows as unknown[]).length);
  if (!b) return null;
  const cols = ((b.columns as Array<{ key: string; label: string }>) || []).map(c => c.key);
  const labelKey = ["name", "title", "visitor", "description", "device", "lead", "label"].find(k => cols.includes(k)) || cols[0];
  const statusKey = ["status", "state", "stage"].find(k => cols.includes(k)), detailKey = ["amount", "reason", "priority", "purpose", "stage"].find(k => cols.includes(k));
  const rows = (b.rows as Array<Record<string, unknown>>).map(r => ({ label: clean(String(r[labelKey] ?? "item")), ...(statusKey && r[statusKey] ? { status: clean(String(r[statusKey])) } : {}), ...(detailKey && r[detailKey] && clean(String(r[detailKey])).length <= 40 ? { detail: clean(String(r[detailKey])) } : {}) }));
  const tm = /^(overdue|stale|open|pending|expired)\b/i.exec(String(b.title ?? ""));
  return { noun, singular, rows, total: null, population: tm ? `that are ${tm[1].toLowerCase()}` : null };
}

export type OverviewView = { maintenance: Array<{ label: string; status: string; priority?: string }>; incidents: Array<{ label: string; status: string }>; unavailable: string[] };
/** Facility overview: risk, list, count and yes/no asks are answered from the open maintenance and security records it read. */
export function targetedOverview(original: string, v: OverviewView, target: AnswerTarget, question: string): string | null {
  const T = analyse(question).tokens, intent = target.response_intent;
  const items = [...v.maintenance.map(m => ({ label: m.label, status: m.status, detail: m.priority ? `${m.priority} priority` : undefined, kind: "maintenance" })), ...v.incidents.map(i => ({ label: i.label, status: i.status, detail: undefined, kind: "security incident" }))];
  const scope = v.unavailable.length ? `${[...new Set(v.unavailable)].join(" and ")} evidence is unavailable, so this is not a complete verdict.` : "This covers maintenance and security records only, so I cannot rule out anything else.";
  const list = (xs: typeof items) => xs.slice(0, 5).map(x => `${x.label} (${x.status}${x.detail ? `; ${x.detail}` : ""})`).join(", ");
  const sup = (lead: string) => `${lead}\n\nSupporting detail: ${clean(original)}`;
  if (intent === "SAFETY_RISK") {
    const inc = v.incidents.length ? `${v.incidents.length} open security incident${v.incidents.length === 1 ? "" : "s"}: ${v.incidents.slice(0, 3).map(i => i.label).join(", ")}.` : "No security incident is open in the records I read.";
    const m = v.maintenance.length ? ` The open maintenance item${v.maintenance.length === 1 ? "" : "s"} that could matter for safety: ${list(items.filter(x => x.kind === "maintenance"))}.` : " No open maintenance request is recorded.";
    return sup(`${inc}${m} ${scope}`);
  }
  if (intent === "LIST" || (intent === "YES_NO_WITH_REASON" && target.yes_no?.kind === "state")) {
    if (!T.some(t => ["open", "unresolved", "pending", "outstanding", "active", "need", "needs", "attention", "any", "anything"].includes(t)) && intent === "LIST") return null;
    if (intent === "YES_NO_WITH_REASON") return sup(items.length ? `Yes — ${items.length} open: ${list(items)}.` : "No — nothing is open in the maintenance and security records I read.");
    return sup(items.length ? `Still open: ${list(items)}.` : "Nothing is open in the maintenance and security records I read.");
  }
  if (intent === "COUNT") return sup(`There ${items.length === 1 ? "is" : "are"} ${items.length} open item${items.length === 1 ? "" : "s"} (${v.maintenance.length} maintenance, ${v.incidents.length} security).`);
  return null;
}

export function targetedRetrieval(original: string, ar: AnswerRows, target: AnswerTarget, question: string): string | null {
  const intent = target.response_intent;
  if (!["LIST", "COUNT", "STATUS", "YES_NO_WITH_REASON"].includes(intent)) return null;
  if (intent === "YES_NO_WITH_REASON" && target.yes_no?.kind !== "state") return null;
  const T = analyse(question).tokens, q = new Set(T);
  const quals = [...new Set(T.filter(t => QUAL.has(t)))];
  // narrow to the rows the question names, then by qualifiers that actually describe rows
  const named = new Set(contentTokens(T).filter(t => !GENERIC.has(t) && !QUAL.has(t)));
  const namedRows = ar.rows.filter(r => nameTokens(r.label).some(t => named.has(t) && !GENERIC.has(t)));
  let rows = namedRows.length && namedRows.length < ar.rows.length ? namedRows : ar.rows;
  const popQuals = quals.filter(x => ar.population && norm(ar.population).includes(stem(x)));
  // "not closed" / "never resolved": a negated qualifier asks for the opposite state
  const OPPOSITE: Record<string, string> = { closed: "open", resolved: "unresolved", fixed: "unresolved", completed: "open", done: "open", open: "closed", unresolved: "resolved", active: "inactive", current: "expired" };
  const negated = new Set(quals.filter(x => { const i = T.indexOf(x); return i > 0 && ["not", "never", "isn", "hasn", "haven"].includes(T[i - 1]); }));
  const quals2 = quals.map(x => negated.has(x) ? (OPPOSITE[x] ?? x) : x);
  const applicable = quals2.filter(x => rows.some(r => matchesQual(r, x)) && !popQuals.includes(x));
  if (applicable.length) rows = rows.filter(r => applicable.every(x => matchesQual(r, x)));
  const noun = ar.noun, one = ar.singular, support = clean(original);
  if (!rows.length && !ar.rows.length && intent === "STATUS") return `There are no ${noun} on record in what I read — that is what the records show, not proof that nothing is wrong.`;
  const withSupport = (lead: string) => (support && !norm(lead).includes(norm(support).slice(0, 40)) ? `${lead}\n\nSupporting detail: ${support}` : lead);
  const asked = (n: number) => `${n} ${n === 1 ? one : noun}`;
  if (intent === "COUNT") {
    const useTotal = ar.total != null && quals.includes("open") && !applicable.includes("open");
    const n = useTotal ? ar.total! : rows.length;
    const qual = applicable.length || popQuals.length ? `${[...applicable, ...popQuals].join(" and ")} ` : "";
    const lead = n === 0 ? `There are no ${qual}${noun} in what I read.` : useTotal ? `There ${n === 1 ? "is" : "are"} ${n} open ${n === 1 ? one : noun}; ${rows.length} of them ${rows.length === 1 ? "needs" : "need"} attention.` : `There ${n === 1 ? "is" : "are"} ${n} ${qual}${n === 1 ? one : noun}${ar.population && !applicable.length && !popQuals.length ? ` ${ar.population}` : ""}.`;
    return withSupport(lead);
  }
  if (intent === "LIST") {
    if (!rows.length) return withSupport(`None of the ${noun} I read match that.`);
    const empty = quals.length > 0 && !applicable.length;
    return withSupport(`${cap(ar.population ? `${noun} ${ar.population}` : noun)}${applicable.length ? ` (${applicable.join(", ")})` : ""}: ${labelList(rows)}.${empty ? ` I could not filter by "${quals.join(", ")}" from the records I read, so this is the full list.` : ""}`);
  }
  if (intent === "STATUS") {
    const by = new Map<string, AnswerRow[]>(); for (const r of rows) by.set(norm(r.status || "recorded"), [...(by.get(norm(r.status || "recorded")) || []), r]);
    const parts = [...by].map(([s, rs]) => `${rs.length} ${s}${rs.length <= 3 ? ` (${rs.map(r => r.label).join(", ")})` : ""}`);
    return withSupport(`${cap(asked(rows.length))} on record: ${parts.join("; ")}.`);
  }
  // yes / no about the state of a named record, or whether any record exists
  if (namedRows.length === 1 && (T.some(t => OPENISH.has(t)) || T.some(t => CLOSEDISH.has(t)))) {
    const r = namedRows[0], closed = /resolved|closed|completed|done/i.test(r.status || ""), asksClosed = T.some(t => CLOSEDISH.has(t));
    const yes = asksClosed ? closed : !closed;
    return withSupport(`${yes ? "Yes" : "No"} — ${r.label} is ${closed ? "resolved" : "still open"}${r.detail ? ` (${r.detail})` : ""}.`);
  }
  if (T.includes("any") || T.includes("anything") || T.includes("have") || T.includes("is") || T.includes("are")) {
    return withSupport(rows.length ? `Yes — ${asked(rows.length)}${applicable.length ? ` ${applicable.join(" and ")}` : ""}: ${labelList(rows, 4)}.` : `No — I found no ${applicable.length ? applicable.join(" and ") + " " : ""}${noun} in what I read.`);
  }
  return null;
}
