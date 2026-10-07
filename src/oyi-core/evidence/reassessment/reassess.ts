import type { ArtifactItem, DerivedRanking } from "../judgment/types";
import { isOrdered, primaryGroup } from "../reference/derivedReference";
import { activeFacts, type ConversationFact } from "./facts";

// IQ-6 reassessment contract: a compact, structural record of "did the new information change what Oyi concluded". It stores no raw
// evidence, no reasoning chain and no fact text beyond what the conversation fact itself already holds.
export type ChangeClass = "UNCHANGED" | "CHANGED_ORDER" | "CHANGED_CONCLUSION" | "INSUFFICIENT_TO_REASSESS" | "NEEDS_CLARIFICATION" | "MISSING_CAPABILITY";
export type ReassessmentRecord = {
  v: 1;
  previous_ranking_id: string | null; previous_assessment_id: string | null; new_ranking_id: string | null; new_assessment_id: string | null;
  change_class: ChangeClass; ranking_changed: boolean; conclusion_changed: boolean;
  changed_factors: string[]; unverified_fact_ids: string[]; limitations: string[];
  sources_reused: number; sources_refreshed: number; affected_classes: string[];
  at: string; failure: string | null;
};

const idOf = (i: ArtifactItem) => `${i.ref.t || ""}|${i.ref.id || i.ref.label || ""}`;
const lab = (i: ArtifactItem) => i.ref.label || "that item";
const stripLabel = (i: ArtifactItem) => { const r = i.rationale.replace(/\.$/, ""); return i.ref.label && r.startsWith(`${i.ref.label}: `) ? r.slice(i.ref.label.length + 2) : r; };

export function classifyChange(oldA: DerivedRanking, newA: DerivedRanking): { change_class: ChangeClass; ranking_changed: boolean; conclusion_changed: boolean; changed_factors: string[] } {
  const o = primaryGroup(oldA), n = primaryGroup(newA);
  const oi = o.map(idOf), ni = n.map(idOf);
  const sameSet = oi.length === ni.length && oi.every(x => ni.includes(x));
  const sameOrder = sameSet && oi.every((x, k) => ni[k] === x);
  const factors: string[] = [];
  for (const it of n) {
    const before = o.find(x => idOf(x) === idOf(it)); if (!before) { factors.push(`${lab(it)} is now among the items considered`); continue; }
    for (const f of it.factors) { const b = before.factors.find(x => x.dimension === f.dimension); if (b && b.level !== f.level) factors.push(`${lab(it)}: ${f.dimension.replace("_", " ")} ${b.level} → ${f.level}`); }
    if (stripLabel(before) !== stripLabel(it) && it.group === "ranked" && newA.basis === "provider") factors.push(`${lab(it)}: the recorded reason changed`);
    if (before.state !== it.state && it.state) factors.push(`${lab(it)}: now ${it.state.replace(/_/g, " ")}`);
  }
  for (const b of o) if (!ni.includes(idOf(b))) factors.push(`${lab(b)} is no longer among the items considered`);
  const unchangedFactors = factors.length === 0;
  if (sameOrder && unchangedFactors) return { change_class: "UNCHANGED", ranking_changed: false, conclusion_changed: false, changed_factors: [] };
  if (isOrdered(newA) && sameSet && !sameOrder) return { change_class: "CHANGED_ORDER", ranking_changed: true, conclusion_changed: oi[0] !== ni[0], changed_factors: factors };
  if (sameOrder) return { change_class: "CHANGED_CONCLUSION", ranking_changed: false, conclusion_changed: true, changed_factors: factors };
  return { change_class: "CHANGED_CONCLUSION", ranking_changed: isOrdered(newA), conclusion_changed: true, changed_factors: factors };
}

const kind = (a: DerivedRanking) => ((a.artifact_type ?? "ranking") === "ranking" ? "ordering" : "assessment");
const list = (a: DerivedRanking) => primaryGroup(a).map(i => `${i.rank}. ${lab(i)}`).join("; ");
const claim = (f: ConversationFact) => `“${f.text.replace(/[.!\s]+$/, "")}”`;

export function composeReassessment(a: { old: DerivedRanking; next: DerivedRanking; cls: ReturnType<typeof classifyChange>; facts: ConversationFact[]; currentText: string; reused: number; refreshed: number }): string {
  const k = kind(a.old), f = a.facts.slice(0, 2);
  const using = f.length ? `Using your statement ${f.map(claim).join(" and ")} (your own statement, which I have not verified)` : "Reassessing from the evidence I can read now";
  const verdict = a.cls.change_class === "UNCHANGED" ? `it does not change the ${k}`
    : a.cls.change_class === "CHANGED_ORDER" ? `it changes the order` : `it changes the conclusion`;
  const bound = f.map(x => a.next.items.find(i => (x.target?.id && i.ref.id === x.target.id) || (x.target?.label && i.ref.label === x.target.label))).filter(Boolean) as ArtifactItem[];
  const records = bound.length ? (a.next.basis === "provider" ? ` The assessment of ${bound.map(i => `${lab(i)} now reads: ${stripLabel(i)}`).join("; ")}.` : ` The records I can read for ${bound.map(i => `${lab(i)} show: ${stripLabel(i)}`).join("; ")}.`) : "";
  const changed = a.cls.changed_factors.length ? ` What changed: ${a.cls.changed_factors.slice(0, 4).join("; ")}.` : "";
  const before = a.cls.change_class === "UNCHANGED" ? "" : ` Before: ${list(a.old)}.`;
  const evidence = ` I re-read ${a.refreshed} source${a.refreshed === 1 ? "" : "s"} and reused ${a.reused} unchanged one${a.reused === 1 ? "" : "s"}.`;
  return `${using}, ${verdict}.${records}${changed}${before}${evidence} Current assessment: ${a.currentText}`;
}

export function composeNotReassessed(reason: "evidence" | "judgment" | "capability" | "authority" | "no_prior" | "ambiguous", old: DerivedRanking | null, facts: ConversationFact[], detail?: string): string {
  const k = old ? kind(old) : "ordering";
  const f = facts.slice(0, 1).map(x => ` Your statement ${claim(x)} is noted as your own unverified statement.`).join("");
  if (reason === "no_prior") return `There was no earlier ordering to change: without a configured comparative judgment I could only count what is recorded, not rank it, so I have not recalculated anything.${f}`.replace(/\.\./g, ".");
  const why = reason === "evidence" ? "the current evidence it depends on could not be read" : reason === "judgment" ? "a comparative judgment could not be produced safely" : reason === "capability" ? `there is no source for ${detail || "that evidence"} in Oyi yet` : reason === "authority" ? "the access that evidence depends on has changed" : "I could not tell which item it concerns";
  return `That could affect the ${k}, but I can't safely recalculate it: ${why}. The earlier ${k} is still marked as not current and I have not changed it.${f}`;
}
export const unverifiedIds = (facts: ConversationFact[] | undefined) => activeFacts(facts).map(f => f.id);
