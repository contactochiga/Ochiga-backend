import { analyse } from "./semanticObjective";
import { domainHits } from "./domainVocabulary";
import { conceptOf, type StateConcept } from "./conceptLexicon";
import type { OyiDomain } from "../runtime/languageUnderstanding";

// IQ-8B canonical concept bridge. IQ-7 already extracts domain nouns (domainVocabulary) and state concepts (conceptLexicon); this module turns them
// into ONE structured, typed view on the semantic frame (`frame.concepts`) so capability routing consumes meaning instead of re-reading the raw
// prompt. It adds no authority: a concept match never selects a capability the surface/actor is not eligible for (CapabilityService still decides).

export type ObjectClass = "lead" | "opportunity" | "report" | "task" | "project" | "document" | "wallet" | "visitor" | "device" | "camera" | "maintenance_request" | "incident" | "utility" | "room";
export type Facet = "balance" | "transactions" | "spending" | "usage" | "history" | "age" | "status" | "owner" | null;
export type SemanticConcepts = {
  domains: Array<{ domain: string; at: number }>;   // governed domain nouns by position (IQ-7 vocabulary)
  head_domain: string | null;                       // the domain of the head noun (a modifier noun does not decide)
  object: ObjectClass | null;                       // what kind of record is being asked about
  facet: Facet;                                     // which aspect of it (balance vs transactions, spending vs usage, status vs history)
  quantity: "count" | "list" | null;                // how many / which ones
  state: StateConcept | null;                       // open / resolved / stale / overdue / arrived / departed
};

const OBJECT_STEMS: Array<[ObjectClass, string[]]> = [
  ["lead", ["lead", "leads", "prospect*"]], ["opportunity", ["opportunit*", "deals", "jv"]], ["report", ["report*"]], ["task", ["task*", "todo", "chore*"]],
  ["project", ["project*", "development*"]], ["document", ["document*", "file*", "contract*"]], ["wallet", ["wallet", "balance", "bal", "transaction*", "spent", "spending", "topup", "topped", "deposit*"]],
  ["visitor", ["visitor*", "guest*", "pass", "passes", "invit*", "visit", "visits", "visiting", "visited"]], ["device", ["device*", "gadget*", "appliance*", "sensor*", "thermostat", "light", "lights", "lighting", "lamp*", "socket*", "plug*"]],
  ["camera", ["camera*", "cctv"]], ["maintenance_request", ["ticket*", "repair*", "request", "requests", "fault*", "leak*", "job", "jobs", "issue*", "problem*", "maintenance"]],
  ["incident", ["incident*", "alert*"]], ["utility", ["electricity", "energy", "power", "gas", "internet", "bill", "bills", "meter*", "tariff*", "kwh", "consumption", "usage"]], ["room", ["room", "rooms", "bedroom*", "kitchen", "lounge"]],
];
const match = (t: string, s: string) => (s.endsWith("*") ? t.startsWith(s.slice(0, -1)) : t === s);
const FACET_TOKENS: Record<Exclude<Facet, null>, string[]> = {
  owner: ["owner", "owners", "owns", "assignee"],
  balance: ["balance", "bal", "left", "remaining", "sitting", "funds", "available", "inside"],
  transactions: ["purchase", "purchases", "funding", "transaction", "transactions", "history", "statement", "ledger", "went", "gone", "through", "payments", "activity", "topup", "topped", "deposit", "deposited", "funded", "credited"],
  spending: ["spent", "spend", "spending", "cost", "costs", "paid", "bill", "bills", "price", "expenses"],
  usage: ["usage", "used", "use", "consumption", "consumed", "kwh", "burn", "burnt", "burned", "burning", "burns", "units"],
  history: ["since", "yesterday", "earlier", "previously", "before", "ago", "changed", "history"],
  status: ["state", "status", "condition", "standing", "stand", "stands", "doing", "going"],
  age: [],
};

export function resolveConcepts(text: string): SemanticConcepts {
  const T = analyse(text).tokens, hits = domainHits(T).filter(h => h.domain !== "environment");
  // head noun: in a compound ("light issue", "water leak") the LAST governed noun decides when the later one is a fault/record noun
  let head = hits[0]?.domain ?? null;
  // in a noun compound the LAST noun is the head ("VI Development opportunity" is an opportunity; "light issue" is an issue)
  for (let i = 0; i + 1 < hits.length; i++) if (hits[i + 1].at === hits[i].at + 1) head = hits[i + 1].domain;
  // IQ-9A14: head-subject precedence. A generic money word never outranks the record class the question is about (a development project, wallet transactions);
  // an explicit consumption/billing word keeps utilities.
  const GENERIC_MONEY = new Set(["money", "cash", "fund", "funds", "capital", "budget", "budgets"]);
  const financialOnlyGeneric = hits.filter(h => h.domain === "office_financial").every(h => GENERIC_MONEY.has(T[h.at] ?? ""));
  if (head === "office_financial" && financialOnlyGeneric && hits.some(h => h.domain === "office_development") && T.some(t => ["project", "projects", "development", "developments"].includes(t))) head = "office_development";
  const TX_NOUNS = ["purchase", "purchases", "funding", "funded", "topup", "deposit", "deposits", "transaction", "transactions", "transfer", "transfers", "payment", "payments"];
  const CONSUMPTION = ["usage", "used", "consumption", "consumed", "kwh", "units", "meter", "meters", "tariff", "tariffs", "rate", "rates"];
  if (["utilities", "office_financial"].includes(head ?? "") && hits.some(h => h.domain === "wallet") && T.some(t => TX_NOUNS.includes(t)) && !T.some(t => CONSUMPTION.includes(t))) head = "wallet";
  // "top up" is one money-in word
  const topUp = T.some((t, i) => (t === "top" && T[i + 1] === "up") || t === "topup" || t === "topped");
  if (topUp && !head) head = "wallet";
  const hit = (cls: ObjectClass) => OBJECT_STEMS.find(([c]) => c === cls)![1];
  const objectAt = T.map((t, i) => ({ i, c: OBJECT_STEMS.find(([, stems]) => stems.some(s => match(t, s)))?.[0] ?? null })).filter(x => x.c);
  // the object is the first object-class noun that is not just the modifier of a later record noun ("light issue" -> maintenance_request)
  let object: ObjectClass | null = objectAt[0]?.c ?? null;
  for (let k = 0; k + 1 < objectAt.length; k++) if (objectAt[k + 1].i === objectAt[k].i + 1) object = objectAt[k + 1].c;
  // Interrogative person-location is a presence question, not an incident report.
  // Permission records may inform it but can never establish physical presence.
  const presenceQuestion = ["is", "are", "who"].includes(T[0]) && T.some(t => ["anyone", "someone", "anybody", "somebody", "who"].includes(t)) && T.some(t => ["gate", "compound", "inside", "outside", "door"].includes(t)) && !T.some(t => ["intruder", "burglar", "danger", "attack", "incident"].includes(t));
  if (presenceQuestion) { head = "visitors"; object = "visitor"; hits.splice(0, hits.length, {domain:"visitors",at:0}); }
  if (topUp && !object) object = "wallet";
  void hit;
  const has = (c: Exclude<Facet, null>) => T.some(t => FACET_TOKENS[c].includes(t)) || (c === "transactions" && topUp);
  // how long since something last happened is an activity-AGE fact, not a history comparison
  const age = T.some(t => ["since", "ago"].includes(t)) && T.some(t => ["days", "weeks", "months", "long", "time"].includes(t));
  // An owner mentioned as the recipient of a promise/action is not an ownership lookup.
  const ownerRead = has("owner") && (T.some(t => ["who", "whose"].includes(t)) || (T.some(t => ["show", "list", "identify"].includes(t)) && !T.some(t => ["send", "promise", "fund", "pay", "call", "email"].includes(t))));
  const facet: Facet = object === "wallet" || T.includes("wallet") ? (has("transactions") || (has("spending") && !has("balance")) ? "transactions" : has("balance") || (T.includes("wallet") && T.includes("in") && !has("spending")) ? "balance" : null)
    : object === "utility" || head === "utilities" ? (has("usage") && !has("spending") ? "usage" : has("spending") ? "spending" : null)
    : ownerRead ? "owner" : age ? "age" : has("history") && T.some(t => ["changed", "since", "yesterday", "earlier", "ago"].includes(t)) ? "history" : has("status") ? "status" : null;
  const quantity = T[0] === "how" && ["many", "much"].includes(T[1] ?? "") || (T.includes("number") && T.includes("of")) || T.includes("count") ? "count" : null;
  // state concepts in priority order; arrival/departure only count for visitor language ("the deal has gone cold" is not a departure)
  const found = new Set(T.map(conceptOf).filter(Boolean));
  const state = (["stale", "overdue", "open", "resolved"] as StateConcept[]).find(c => found.has(c)) ?? (head === "visitors" || object === "visitor" ? (["arrived", "departed"] as StateConcept[]).find(c => found.has(c)) ?? null : null);
  return { domains: hits, head_domain: head, object, facet, quantity, state };
}

// Governed domain for a concept view. Used to reconcile the legacy lexical domain: a missing domain is filled from the vocabulary, and a SOFT
// legacy domain yields to a clearly more specific head domain. Explicit billing/consumption words keep utilities.
const HARD = new Set(["maintenance", "security", "visitors", "cameras", "wallet", "office_tasks", "crm", "office_reports", "office_financial"]);
const SOFT = new Set(["devices", "utilities", "home", "rooms", "incidents", "messages", "community", "services"]);
const VOCAB_TO_DOMAIN: Record<string, OyiDomain> = { devices: "devices", visitors: "visitors", maintenance: "maintenance", security: "security", cameras: "cameras", utilities: "utilities", wallet: "wallet", rooms: "rooms", crm: "crm", office_reports: "office_reports", office_financial: "office_financial", office_tasks: "office_tasks" };
// the governed domain a record class belongs to when nothing else names one (a domain label that is not governed, like "transactions", counts as none)
const OBJECT_DOMAIN: Partial<Record<ObjectClass, OyiDomain>> = { lead: "crm", opportunity: "crm", report: "office_reports", task: "office_tasks", wallet: "wallet", visitor: "visitors", device: "devices", camera: "cameras", maintenance_request: "maintenance", incident: "security" };
export function reconcileDomain(legacyIn: OyiDomain | null, c: SemanticConcepts, text: string): OyiDomain | null {
  const legacy = (legacyIn as string | null) === "transactions" ? null : legacyIn;
  if (c.head_domain === "visitors" && c.object === "visitor" && c.domains.length === 1 && c.domains[0].at === 0) return "visitors";
  // A transactional population is distinct from consumption even when its purchase is electricity.
  if (c.head_domain === "wallet" && c.facet === "transactions" && ["utilities", "reports"].includes(legacy ?? "") && analyse(text).tokens.some(t => ["purchase", "purchases", "funding", "funded", "topup", "deposit", "transaction", "transactions", "transfer", "transfers", "payment", "payments"].includes(t))) return "wallet";
  if (c.head_domain === "office_development" && c.object === "project" && legacy === "office_financial") return "office_development";
  if (c.object === "maintenance_request" && c.facet === "status" && [null, "devices", "utilities", "home"].includes(legacy)) return "maintenance";
  const target = c.head_domain ? VOCAB_TO_DOMAIN[c.head_domain] ?? null : null;
  if (!legacy && !target && c.object && OBJECT_DOMAIN[c.object]) return OBJECT_DOMAIN[c.object]!;
  if (!legacy) return target;
  if (!target || target === legacy) return legacy;
  const billing = analyse(text).tokens.some(t => ["bill", "bills", "usage", "consumption", "meter", "tariff", "kwh", "electricity", "energy", "gas", "internet", "token"].includes(t));
  if (SOFT.has(legacy) && HARD.has(c.head_domain ?? "") && !(legacy === "utilities" && billing)) return target;
  return legacy;
}
