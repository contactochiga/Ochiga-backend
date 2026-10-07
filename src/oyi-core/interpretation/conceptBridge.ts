import { analyse } from "./semanticObjective";
import { domainHits } from "./domainVocabulary";
import { conceptOf, type StateConcept } from "./conceptLexicon";
import type { OyiDomain } from "../runtime/languageUnderstanding";

// IQ-8B canonical concept bridge. IQ-7 already extracts domain nouns (domainVocabulary) and state concepts (conceptLexicon); this module turns them
// into ONE structured, typed view on the semantic frame (`frame.concepts`) so capability routing consumes meaning instead of re-reading the raw
// prompt. It adds no authority: a concept match never selects a capability the surface/actor is not eligible for (CapabilityService still decides).

export type ObjectClass = "lead" | "opportunity" | "report" | "task" | "project" | "document" | "wallet" | "visitor" | "device" | "camera" | "maintenance_request" | "incident" | "utility" | "room";
export type Facet = "balance" | "transactions" | "spending" | "usage" | "history" | "status" | null;
export type SemanticConcepts = {
  domains: Array<{ domain: string; at: number }>;   // governed domain nouns by position (IQ-7 vocabulary)
  head_domain: string | null;                       // the domain of the head noun (a modifier noun does not decide)
  object: ObjectClass | null;                       // what kind of record is being asked about
  facet: Facet;                                     // which aspect of it (balance vs transactions, spending vs usage, status vs history)
  quantity: "count" | "list" | null;                // how many / which ones
  state: StateConcept | null;                       // open / resolved / stale / overdue / arrived / departed
};

const OBJECT_STEMS: Array<[ObjectClass, string[]]> = [
  ["lead", ["lead", "leads", "prospect*"]], ["opportunity", ["opportunit*", "deals"]], ["report", ["report*"]], ["task", ["task*", "todo", "chore*"]],
  ["project", ["project*", "development*"]], ["document", ["document*", "file*", "contract*"]], ["wallet", ["wallet", "balance", "transaction*", "spent", "spending"]],
  ["visitor", ["visitor*", "guest*", "pass", "passes", "invit*"]], ["device", ["device*", "gadget*", "appliance*", "sensor*", "thermostat", "light", "lights", "lighting", "lamp*", "socket*", "plug*"]],
  ["camera", ["camera*", "cctv"]], ["maintenance_request", ["ticket*", "repair*", "request", "requests", "fault*", "leak*", "job", "jobs", "issue*", "problem*", "maintenance"]],
  ["incident", ["incident*", "alert*"]], ["utility", ["electricity", "energy", "power", "gas", "internet", "bill", "bills", "meter*", "tariff*", "kwh", "consumption", "usage"]], ["room", ["room", "rooms", "bedroom*", "kitchen", "lounge"]],
];
const match = (t: string, s: string) => (s.endsWith("*") ? t.startsWith(s.slice(0, -1)) : t === s);
const FACET_TOKENS: Record<Exclude<Facet, null>, string[]> = {
  balance: ["balance", "left", "remaining", "sitting", "funds"],
  transactions: ["transaction", "transactions", "history", "statement", "ledger", "went", "payments", "purchases", "activity"],
  spending: ["spent", "spend", "spending", "cost", "costs", "paid", "bill", "bills", "price", "expenses"],
  usage: ["usage", "used", "use", "consumption", "consumed", "kwh", "burn", "burnt", "units"],
  history: ["since", "yesterday", "earlier", "previously", "before", "ago", "changed", "history"],
  status: ["state", "status", "condition", "standing", "stand", "stands", "doing", "going"],
};

export function resolveConcepts(text: string): SemanticConcepts {
  const T = analyse(text).tokens, hits = domainHits(T).filter(h => h.domain !== "environment");
  // head noun: in a compound ("light issue", "water leak") the LAST governed noun decides when the later one is a fault/record noun
  let head = hits[0]?.domain ?? null;
  for (let i = 0; i + 1 < hits.length; i++) if (hits[i + 1].at === hits[i].at + 1 && hits[i + 1].domain === "maintenance") head = "maintenance";
  const hit = (cls: ObjectClass) => OBJECT_STEMS.find(([c]) => c === cls)![1];
  const objectAt = T.map((t, i) => ({ i, c: OBJECT_STEMS.find(([, stems]) => stems.some(s => match(t, s)))?.[0] ?? null })).filter(x => x.c);
  // the object is the first object-class noun that is not just the modifier of a later record noun ("light issue" -> maintenance_request)
  let object: ObjectClass | null = objectAt[0]?.c ?? null;
  for (let k = 0; k + 1 < objectAt.length; k++) if (objectAt[k + 1].i === objectAt[k].i + 1 && objectAt[k + 1].c === "maintenance_request") object = "maintenance_request";
  void hit;
  const has = (c: Exclude<Facet, null>) => T.some(t => FACET_TOKENS[c].includes(t));
  const facet: Facet = object === "wallet" || T.includes("wallet") ? (has("transactions") || (has("spending") && !has("balance")) ? "transactions" : has("balance") || T.includes("wallet") ? "balance" : null)
    : object === "utility" || head === "utilities" ? (has("usage") && !has("spending") ? "usage" : has("spending") ? "spending" : null)
    : has("history") && T.some(t => ["changed", "since", "yesterday", "earlier", "ago"].includes(t)) ? "history" : has("status") ? "status" : null;
  const quantity = T[0] === "how" && ["many", "much"].includes(T[1] ?? "") || (T.includes("number") && T.includes("of")) || T.includes("count") ? "count" : null;
  const state = T.map(conceptOf).find(Boolean) ?? null;
  return { domains: hits, head_domain: head, object, facet, quantity, state };
}

// Governed domain for a concept view. Used to reconcile the legacy lexical domain: a missing domain is filled from the vocabulary, and a SOFT
// legacy domain yields to a clearly more specific head domain. Explicit billing/consumption words keep utilities.
const HARD = new Set(["maintenance", "security", "visitors", "cameras", "wallet", "office_tasks", "crm", "office_reports", "office_financial"]);
const SOFT = new Set(["devices", "utilities", "home", "rooms", "incidents", "messages", "community", "services"]);
const VOCAB_TO_DOMAIN: Record<string, OyiDomain> = { devices: "devices", visitors: "visitors", maintenance: "maintenance", security: "security", cameras: "cameras", utilities: "utilities", wallet: "wallet", rooms: "rooms", crm: "crm", office_reports: "office_reports", office_financial: "office_financial", office_tasks: "office_tasks" };
export function reconcileDomain(legacy: OyiDomain | null, c: SemanticConcepts, text: string): OyiDomain | null {
  const target = c.head_domain ? VOCAB_TO_DOMAIN[c.head_domain] ?? null : null;
  if (!legacy) return target;
  if (!target || target === legacy) return legacy;
  const billing = analyse(text).tokens.some(t => ["bill", "bills", "usage", "consumption", "meter", "tariff", "kwh", "electricity", "energy", "gas", "internet", "token"].includes(t));
  if (SOFT.has(legacy) && HARD.has(c.head_domain ?? "") && !(legacy === "utilities" && billing)) return target;
  return legacy;
}
