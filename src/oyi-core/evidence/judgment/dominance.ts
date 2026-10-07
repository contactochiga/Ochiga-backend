import type { Candidate, Dimension } from "./types";

// A DECLARED qualitative dominance order over RECORDED typed fields. It is not a score and not a weighted sum:
//   1. lifecycle    active over unknown over historical (a resolved/expired item never outranks an active one)
//   2. importance   the recorded severity, else the recorded priority (critical > high > medium > low)
//   3. time pressure overdue over due within 48h over later
// A value the source did not record sorts AFTER any recorded value on that dimension and the rationale says so; nothing
// is invented. Candidates that remain equal stay TIED: the order never forces a distinction the evidence does not make.
const LIFE: Record<string, number> = { active: 2, unknown: 1, historical: 0 };
const IMP: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const TIME: Record<string, number> = { overdue: 3, due_within_48h: 2, later: 1 };

export const levelOf = (c: Candidate, d: Dimension) => c.factors.find(f => f.dimension === d)?.level ?? null;
export const keyOf = (c: Candidate): [number, number, number] => [LIFE[levelOf(c, "lifecycle") ?? "unknown"] ?? 1, IMP[levelOf(c, "importance") ?? ""] ?? 0, TIME[levelOf(c, "time_pressure") ?? ""] ?? 0];
export const compare = (a: Candidate, b: Candidate) => { const x = keyOf(a), y = keyOf(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; };

export type Tiered = { candidate: Candidate; rank: number; tier: number };

/** Stable order with tiers: equal keys share a tier (a tie). Rank is the 1-based position; tier is the 0-based distinct level. */
export function tiering(candidates: Candidate[]): Tiered[] {
  const sorted = candidates.map((c, i) => ({ c, i })).sort((p, q) => compare(p.c, q.c) || p.i - q.i);
  let tier = -1;
  return sorted.map((p, idx) => { if (idx === 0 || compare(sorted[idx - 1].c, p.c) !== 0) tier += 1; return { candidate: p.c, rank: idx + 1, tier }; });
}

const WORDS: Record<string, string> = { critical: "critical", high: "high", medium: "medium", low: "low", overdue: "overdue", due_within_48h: "due within 48 hours", later: "not due soon" };
// Plain statements of what is RECORDED, in the order the dominance order uses them.
export function describe(c: Candidate): string[] {
  const out: string[] = [];
  const life = levelOf(c, "lifecycle"); if (life) out.push(life === "historical" ? "resolved or past" : life === "active" ? "open/active" : "status not clear");
  const imp = levelOf(c, "importance"); out.push(imp ? `recorded ${c.source_key.startsWith("security") ? "severity" : "priority"} ${WORDS[imp] || imp}` : "no priority or severity recorded");
  const t = levelOf(c, "time_pressure"); if (t && t !== "later") out.push(WORDS[t] || t);
  return out;
}
