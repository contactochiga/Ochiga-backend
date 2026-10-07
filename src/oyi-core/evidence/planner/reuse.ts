import { createHash } from "node:crypto";
import type { CompactEvidencePlanState, Contribution, PlanStep } from "./types";

// Evidence gathered for the SAME active assessment is reused instead of re-fetched when nothing has
// invalidated it. Cosmetic wording changes ("Why?", "What would you do?") never invalidate.
export const REFRESH_REQUEST = /\b(?:refresh|re-?check|check again|check (?:it )?now|right now|just now|latest|most recent|up[- ]to[- ]date|live)\b/i;

export const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 16);

export type ReuseDecision = { reusable: Map<string, Contribution>; invalidation: string[] };

export function decideReuse(args: {
  previous: CompactEvidencePlanState | null | undefined; steps: PlanStep[]; scope_key: string; subject_key: string; input_fingerprint: string | null;
  material_hash: string | null; refresh: boolean; affected_classes?: string[] | null; now: number; authorised: (sourceKey: string) => boolean;
}): ReuseDecision {
  const reusable = new Map<string, Contribution>(); const invalidation: string[] = [];
  const prev = args.previous;
  if (!prev || prev.v !== 1) return { reusable, invalidation };
  if (prev.surface !== undefined && prev.scope_key !== args.scope_key) { invalidation.push("scope_change"); return { reusable, invalidation }; }
  if (prev.subject_key !== args.subject_key) { invalidation.push("subject_change"); return { reusable, invalidation }; }
  if (args.refresh) { invalidation.push("explicit_refresh"); return { reusable, invalidation }; }
  // IQ-6: a changed material fact invalidates ONLY the evidence classes it can affect when the caller says which those are; unaffected
  // fresh evidence is reused. Without that information (the IQ-3B default) it still invalidates everything.
  const materialChanged = (prev.material_hash || null) !== (args.material_hash || null);
  if (materialChanged) { invalidation.push("material_fact_changed"); if (!args.affected_classes) return { reusable, invalidation }; }
  if ((prev.input_fingerprint || null) !== (args.input_fingerprint || null)) { invalidation.push("supplied_snapshot_changed"); return { reusable, invalidation }; }
  for (const step of args.steps) {
    const c = prev.contributions.find(x => x.source_key === step.source_key && x.evidence_class === step.class && x.scope_class === step.scope_class);
    if (!c) continue;
    // A failed, denied or timed-out read is retried, never reused as if it were evidence.
    if (materialChanged && args.affected_classes!.includes(step.class)) { invalidation.push(`affected_class:${step.class}`); continue; }
    if (c.availability !== "available") { invalidation.push(`retry_${c.availability}:${c.source_key}`); continue; }
    if (Date.parse(c.fresh_until) <= args.now) { invalidation.push(`source_freshness_expired:${c.source_key}`); continue; }
    // Authority is re-checked at reuse time; permission is never cached beyond the governed turn.
    if (!args.authorised(c.source_key)) { invalidation.push(`authority_changed:${c.source_key}`); continue; }
    reusable.set(c.source_key, { ...c, reused: true });
  }
  return { reusable, invalidation };
}
