import type { CapabilityContext } from "../contracts/capability";
import type { OyiEvidence } from "../contracts/evidence";
import type { SemanticFrame } from "../contracts/semanticFrame";
import { actorHasFacilityReadScope } from "../../intelligence-core/permissionEngine";

// An answer-scope invariant, not an authority engine. Eligibility remains canUse().
// Intent must not be overwritten by the scope that happens to be readable.
export type AnswerScopeProvenance = {
  requested: { population: "household" | "office" | "estate" | "public"; subject: string; home_references: string[] };
  authorized: { surface: string; estate_id: string | null; home_id: string | null };
  retrieved: Array<{ capability: string; estate_id: string | null; home_id: string | null; room_id: string | null }>;
  presented: "retrieved_scope" | "no_operational_evidence" | "withheld";
  decision: "compatible" | "denied";
  reason: string | null;
};
type Context = Pick<CapabilityContext, "actor" | "oisContext" | "input">;
const normalize = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const operational = /\b(?:wallets?|balances?|transactions?|maintenance|repairs?|visitors?|guests?|devices?|lights?|cameras?|security|utilities|payments?|spending|financial|incidents?)\b/i;
const operationalFrame = (raw: string, frame: SemanticFrame) => operational.test(raw)
  || [frame.domain, frame.concepts?.head_domain].some(d => ["wallet", "transactions", "maintenance", "visitors", "devices", "cameras", "security", "utilities", "financial"].includes(String(d)));

// Only server-verified operating-context members can resolve a display label.
// Selection narrows the current estate; it never grants a capability permission.
export function verifiedRequestedHome(context: Context, frame: SemanticFrame) {
  if (context.input.surface !== "facility" || !actorHasFacilityReadScope(context.actor?.role)) return null;
  const estate = context.oisContext?.estate_id;
  const refs = requestedAnswerScope(context, frame).home_references;
  if (!estate || refs.length !== 1) return null;
  const homes = [...(context.oisContext?.available_homes || []), ...(context.oisContext?.home ? [context.oisContext.home] : [])];
  const matches = homes.filter(h => h.estate_id === estate && [h.id, h.name, h.unit].some(v => v && normalize(v) === normalize(refs[0])));
  return new Set(matches.map(h => h.id)).size === 1 ? matches[0] : null;
}

export function requestedAnswerScope(context: Context, frame: SemanticFrame) {
  const raw = String(frame.rawText || context.input.message || ""), surface = context.input.surface;
  // Structural dwelling identifiers, including possessive alphanumeric labels.
  // Do not resolve a label by looking up an unauthorised household.
  const explicit = [...raw.matchAll(/\b(?:home|flat|apartment|unit|household|residence)\s+(?:number\s+|#\s*)?([a-z0-9]+(?:[-/]\w+)*)/gi)]
    .map(m => m[1]).filter(x => /\d/.test(x));
  const named = [...raw.matchAll(/\b(?:home|flat|apartment|unit|household|residence)\s+(?:named|called)\s+["“]?([^"”?.!]+)/gi)].map(m => m[1].trim());
  const coded = operationalFrame(raw, frame) || /^(?:and|what about|how about)\s+[a-z]{1,3}-\d/i.test(raw.trim())
    ? [...raw.matchAll(/\b[a-z]{1,3}-\d{1,5}[a-z]?\b/gi)].map(m => m[0]) : [];
  const refs = [...new Set([...explicit, ...coded, ...named])];
  const household = operationalFrame(raw, frame) && (/\b(?:resident(?:s|[- ]private)?|households?|homes?|flats?|apartments?|tenants?|neighbou?rs?)\b/i.test(raw) || refs.length > 0);
  const namedPossessor = [...raw.matchAll(/\b([\p{L}]+)['’]s\s+(?:wallet|balance|transactions?|visitors?|guests?|devices?|maintenance|repairs?)\b/giu)]
    .some(m => !["home", "house", "estate", "building", "room", "office", "company", "organisation", "organization"].includes(m[1].toLowerCase()))
    || /\b(?:of|for)\s+(?:the\s+)?(?:resident|tenant|neighbou?r)\s+(?!myself\b|me\b)[\p{L}]+/iu.test(raw);
  return {
    population: (household || namedPossessor || surface === "consumer" ? "household" : surface === "office_internal" ? "office" : surface === "facility" ? "estate" : "public") as AnswerScopeProvenance["requested"]["population"],
    subject: namedPossessor ? "other" : frame.answerTarget?.subject_scope || "own",
    home_references: refs,
  };
}

export function answerScopeDecision(context: Context, frame: SemanticFrame): AnswerScopeProvenance {
  const requested = requestedAnswerScope(context, frame), surface = context.input.surface;
  // Resident memory and other canonical actor-scoped reads can legitimately
  // operate without OIS selection. Use the verified actor, never request IDs.
  const authorized = { surface, estate_id: context.oisContext?.estate_id || context.actor?.estate_id || null,
    home_id: context.oisContext?.home_id || (surface === "consumer" ? context.actor?.home_id : null) || null };
  const knownHome = context.oisContext?.home as { id?: string; name?: string } | null | undefined;
  const verifiedHome = verifiedRequestedHome(context, frame);
  const aliases = [authorized.home_id, knownHome?.id, knownHome?.name, verifiedHome?.id, verifiedHome?.name, verifiedHome?.unit].filter(Boolean).map(normalize);
  let reason: string | null = null;
  if (surface === "consumer" && requested.subject !== "own") reason = "requested_scope_not_authorized";
  if (requested.home_references.some(ref => !aliases.includes(normalize(ref)))) reason = "requested_home_not_verified";
  if (surface === "consumer" && context.input.home_id && context.input.home_id !== authorized.home_id) reason = "requested_home_not_verified";
  if ((surface === "office_internal" || surface === "public_corporate") && requested.population === "household") reason = "household_scope_not_available_on_surface";
  return { requested, authorized, retrieved: [], presented: reason ? "withheld" : "no_operational_evidence", decision: reason ? "denied" : "compatible", reason };
}

export function evidenceScopeProvenance(context: CapabilityContext, capability: string, evidence: OyiEvidence[], sourceScopes: AnswerScopeProvenance["retrieved"] = []): AnswerScopeProvenance {
  const p = answerScopeDecision(context, context.resolvedTurn.semantic_frame);
  for (const e of [...evidence.map(e => ({ capability, scope: e.authorised_scope })), ...sourceScopes.map(s => ({ capability: s.capability, scope: s }))]) {
    const s = e.scope;
    if (!s) continue; // do not invent an observed scope from the requested scope
    const r = { capability: e.capability, estate_id: s.estate_id || null, home_id: s.home_id || null, room_id: s.room_id || null };
    if (!p.retrieved.some(x => JSON.stringify(x) === JSON.stringify(r))) p.retrieved.push(r);
    if (context.input.surface === "consumer" && ((r.home_id && r.home_id !== p.authorized.home_id) || (r.estate_id && r.estate_id !== p.authorized.estate_id))) {
      p.decision = "denied"; p.reason = "evidence_scope_mismatch";
    }
    if ((context.input.surface === "office_internal" || context.input.surface === "public_corporate") && r.home_id) {
      p.decision = "denied"; p.reason = "evidence_scope_mismatch";
    }
    if (context.input.surface === "facility" && ((r.estate_id && r.estate_id !== p.authorized.estate_id)
      || (p.requested.home_references.length > 0 && (!p.authorized.home_id || r.home_id !== p.authorized.home_id)))) {
      p.decision = "denied"; p.reason = "evidence_scope_mismatch";
    }
  }
  p.presented = p.decision === "denied" ? "withheld" : p.retrieved.length ? "retrieved_scope" : "no_operational_evidence";
  // Denial metadata must not leak the existence or identity of rejected evidence.
  if (p.decision === "denied") p.retrieved = [];
  return p;
}

export const scopeDenialAnswer = "I can't provide operational or financial facts for that requested household or scope here. I haven't substituted your own home or an Office portfolio for it. Please make a separate request for a scope you are authorised to access.";
