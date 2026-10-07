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
const matchesQual = (r: AnswerRow, q: string) => { const hay = norm(`${r.status ?? ""} ${r.detail ?? ""}`); return hay.includes(stem(q)) || (q === "overdue" && /overdue|late/.test(hay)) || (q === "open" && /^(?:open|new|pending|in_progress|active|qualified|review|planning)\b/.test(norm(r.status ?? ""))); };
const labelList = (rows: AnswerRow[], max = 8) => { const shown = rows.slice(0, max).map(r => `${r.label}${r.status ? ` (${r.status}${r.detail ? `; ${r.detail}` : ""})` : r.detail ? ` (${r.detail})` : ""}`); return shown.join(", ") + (rows.length > max ? `, and ${rows.length - max} more` : ""); };
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function rowsFromBlocks(blocks: Array<Record<string, unknown>> | undefined, noun: string, singular: string): AnswerRows | null {
  const b = (blocks || []).find(x => (x.type === "record_list" || x.type === "table") && Array.isArray(x.rows) && (x.rows as unknown[]).length);
  if (!b) return null;
  const cols = ((b.columns as Array<{ key: string; label: string }>) || []).map(c => c.key);
  const labelKey = ["name", "title", "visitor", "description", "device", "lead", "label"].find(k => cols.includes(k)) || cols[0];
  const statusKey = ["status", "state", "stage"].find(k => cols.includes(k)), detailKey = ["amount", "reason", "priority", "purpose", "stage"].find(k => cols.includes(k));
  const rows = (b.rows as Array<Record<string, unknown>>).map(r => ({ label: clean(String(r[labelKey] ?? "item")), ...(statusKey && r[statusKey] ? { status: clean(String(r[statusKey])) } : {}), ...(detailKey && r[detailKey] ? { detail: clean(String(r[detailKey])).slice(0, 60) } : {}) }));
  const tm = /^(overdue|stale|open|pending|expired)\b/i.exec(String(b.title ?? ""));
  return { noun, singular, rows, total: null, population: tm ? `that are ${tm[1].toLowerCase()}` : null };
}

export function targetedRetrieval(original: string, ar: AnswerRows, target: AnswerTarget, question: string): string | null {
  const intent = target.response_intent;
  if (!["LIST", "COUNT", "STATUS", "YES_NO_WITH_REASON"].includes(intent)) return null;
  if (intent === "YES_NO_WITH_REASON" && target.yes_no?.kind !== "state") return null;
  const T = analyse(question).tokens, q = new Set(T);
  const quals = [...new Set(T.filter(t => QUAL.has(t)))];
  // narrow to the rows the question names ("the Abuja JV", "the water issue"), then by qualifiers that actually describe rows
  const named = new Set(contentTokens(T).filter(t => !GENERIC.has(t) && !QUAL.has(t)));
  const namedRows = ar.rows.filter(r => nameTokens(r.label).some(t => named.has(t) && !GENERIC.has(t)));
  let rows = namedRows.length && namedRows.length < ar.rows.length ? namedRows : ar.rows;
  const popQuals = quals.filter(x => ar.population && norm(ar.population).includes(stem(x)));
  const applicable = quals.filter(x => rows.some(r => matchesQual(r, x)) && !popQuals.includes(x));
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
