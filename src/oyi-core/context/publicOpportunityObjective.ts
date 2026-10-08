// Public/Osa progressive qualification -- the minimum ephemeral
// representation needed so a public prospect supplying facts across
// several turns ("I own land in VI." / "It's about 1,200 sqm." / "I am
// considering a JV." / "I do not want to sell.") is never asked to repeat
// them, and "What would you need from me?" can synthesize what's already
// known instead of restarting.
//
// Exact same shape/reasoning as goalProposal.ts/communicationProposal.ts:
// this is NOT a new memory system, not a durable GoalRuntime entry, and
// not an Osa-specific second brain -- it is a sibling key
// (public_opportunity_objective) under the SAME oyi_conversation_threads
// .metadata jsonb column every other ephemeral per-thread pointer in this
// codebase already uses (see resultSetContext.ts, pending_goal above,
// pending_action_proposal, pending_communication, etc.), persisted through
// the SAME canonicalConversationPersistence.ts upsert.
//
// Privacy containment: this state exists ONLY for the public_corporate
// surface. loadPublicOpportunityObjective cross-checks the thread's own
// persisted `surface` column (not just presence of the metadata key)
// before returning anything, so it can never be read back for a thread
// that isn't actually public_corporate -- there is no code path anywhere
// that lets this become a route around any other surface's capability
// authority, because no other surface's capabilities ever read or write
// this key.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";

// "development_partnership" reuses the existing JV assessment engine
// (developmentJv.ts's assessJvOpportunity) for known_facts reasoning.
// "technology_inquiry" is the generic fallback for any other progressive
// public inquiry (e.g. a facility/technology capability question heading
// toward a staff handoff) -- proves the same mechanism generalizes
// without a JV-shaped assessment engine behind it.
export type PublicOpportunityType = "development_partnership" | "technology_inquiry";

export type PublicOpportunityObjective = {
  objective_type: PublicOpportunityType;
  known_facts: Record<string, string>;
  constraints: string[];
  current_subject: string | null;
  next_move: string | null;
  // Last actual handoff result only; no promise or autonomous follow-up.
  handoff_stage?: "accepted_receipt_recorded" | "rejected" | "unavailable" | "attempted_no_receipt" | "contact_completed";
  turns: number;
  // IQ-6: what the caller's LAST update changed (field, previous value or null, new value). Caller-supplied, unverified; no raw message text.
  last_changes?: Array<{ field: string; from: string | null; to: string }>;
  // IQ-9A8: values the caller replaced, kept as provenance (never re-presented as current). Caller-supplied, unverified; no raw message text.
  superseded?: Array<{ field: string; value: string }>;
  created_at: string;
  updated_at: string;
};

export const PUBLIC_OPPORTUNITY_OBJECTIVE_TTL_MS = 30 * 60 * 1000;
// Caller-supplied correction, never verified ownership/title evidence.
// Title status as the caller states it (never verified title evidence).
export function extractTitleStatus(message: string): string | null {
  // A named document is a caller claim, never verification or perfected title.
  const documentClaim = /\b(?:(?:do\s+not|don't|does\s+not|doesn't|not|never|no\s+longer)\s+)?(?:have|has|hold|holds|with|got|obtained|without|awaiting)\s+(?:(?:a|the|no|not|yet)\s+)*(?:c\s+of\s+o|certificate\s+of\s+occupancy)\b/i.exec(message);
  if (documentClaim && !/^\s*(?:what|which|how|do|does|can|could|should|would|is)\b/i.test(message)) return /\b(?:no|not|never|don't|doesn't|without|awaiting)\b/i.test(documentClaim[0]) ? "C of O not available (caller supplied)" : "C of O held (caller supplied, not verified)";
  if (!/\btitle\b/i.test(message)) return null;
  // IQ-9A11 R7: "no title papers yet" states that title documents are not available; it is not a statement that title is perfected
  if (/\bno\s+title\s+(?:papers?|documents?|deeds?)\b|\btitle\s+(?:papers?|documents?|deeds?)\s+(?:are\s+)?(?:not|yet\s+to)\b|\bwithout\s+title\s+(?:papers?|documents?)\b/i.test(message)) return "documents not yet available";
  if (/\bnot\b|\bisn'?t\b|\bnever\b|unperfected|\bno\b/i.test(message) && /perfect|regist|clean|clear|valid|sorted|good|certif/i.test(message)) return "not perfected";
  if (/\b(?:in\s+dispute|disputed|contested|unclear|defect\w*|problem\w*|missing)\b/i.test(message)) return /dispute|contest/i.test(message) ? "disputed" : "not perfected";
  if (/\b(?:perfected|registered|clean|clear|valid|sorted|good|certified)\b/i.test(message)) return "perfected";
  return null;
}
export function correctedPublicFacts(prior: PublicOpportunityObjective | null, message: string): Record<string,string> | null {
  if (!prior) return null;
  const facts = { ...prior.known_facts }; let changed = false;
  const location = message.match(/^(?:sorry|actually)[, ]+(?:(?:it['’]s|it is)\s+)?([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,2}),?\s+not\s+(.+?)[.!]?$/i);
  if (location && facts.location && location[2].toLowerCase().replace(/[.!]$/,'') === facts.location.toLowerCase()) { facts.location=location[1]; changed=true; }
  if (/\b(?:actually|closer to|correction|i meant|not|was wrong|sorry)\b/i.test(message)) {
    const areas=[...message.matchAll(/(\d[\d,]*\s*(?:sqm|square\s*meters?|hectares?|acres?))/gi)];
    if(areas.length){ facts.land_size=areas[areas.length-1][1]; changed=true; }
    const correctedAmount=message.match(/\b(?:closer to|i meant)\s+(\d[\d,]*)[.!]?$/i);
    const unit=(facts.land_size || '').match(/(?:sqm|square\s*meters?|hectares?|acres?)$/i)?.[0];
    if(correctedAmount&&unit){facts.land_size=`${correctedAmount[1]} ${unit}`;changed=true;}
  }
  const title = extractTitleStatus(message); if (title && facts.title_document_status !== title) { facts.title_document_status = title; changed = true; }
  {const shared=message.match(/\b(family|relatives?|siblings?|shared|jointly|co-?owned|partners?|heirs?)\b/i); if (shared && /\bnot\s+(?:mine|my|owned\s+by\s+me|only\s+mine|mine\s+alone)\b/i.test(message)) {facts.ownership_status=`${/^family$/i.test(shared[1]) ? 'family property' : 'shared ownership'}; personal ownership not asserted`;changed=true;}}
  return changed ? facts : null;
}
const TTL_MS = PUBLIC_OPPORTUNITY_OBJECTIVE_TTL_MS;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function isValidPublicOpportunityObjective(value: unknown): value is PublicOpportunityObjective {
  const record = recordOf(value);
  return Boolean(record.objective_type) && typeof record.known_facts === "object" && Array.isArray(record.constraints);
}

export async function loadPublicOpportunityObjective(threadId: string | null | undefined): Promise<PublicOpportunityObjective | null> {
  if (!threadId) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("oyi_conversation_threads")
      .select("metadata,surface")
      .eq("id", threadId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    // The privacy boundary: a stored objective is only ever honoured for
    // a thread whose OWN persisted surface is public_corporate, regardless
    // of what key happens to be present in its metadata.
    if (text((data as any).surface) !== "public_corporate") return null;
    const stored = recordOf((data as any).metadata).public_opportunity_objective;
    if (!isValidPublicOpportunityObjective(stored)) return null;
    if (!stored.updated_at || Date.now() - Date.parse(stored.updated_at) > TTL_MS) return null;
    return stored;
  } catch (error) {
    logger.warn("oyi_public_opportunity_objective_load_failed", { thread_id: threadId, error });
    return null;
  }
}

// IQ-3A -- evidence-planning read of this thread's own objective. Unlike
// loadPublicOpportunityObjective, it separates absence from failure and proves
// ownership: the thread row must belong to the same public principal and surface.
export type PublicOpportunityObjectiveRead =
  | { status: "found"; objective: PublicOpportunityObjective }
  | { status: "none" }
  | { status: "expired" }
  | { status: "thread_not_found" }
  | { status: "not_owned" }
  | { status: "error" };

export async function readPublicOpportunityObjective(threadId: string | null | undefined, actorId: string | null | undefined, db: { from: (table: string) => { select: (...a: any[]) => any } } = supabaseAdmin as any): Promise<PublicOpportunityObjectiveRead> {
  if (!threadId || !actorId) return { status: "thread_not_found" };
  try {
    const { data, error } = await db
      .from("oyi_conversation_threads")
      .select("metadata,surface,user_id")
      .eq("id", threadId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { status: "thread_not_found" };
    if (text((data as any).surface) !== "public_corporate" || text((data as any).user_id) !== actorId) return { status: "not_owned" };
    const stored = recordOf((data as any).metadata).public_opportunity_objective;
    if (!isValidPublicOpportunityObjective(stored)) return { status: "none" };
    if (!stored.updated_at || Date.now() - Date.parse(stored.updated_at) > TTL_MS) return { status: "expired" };
    return { status: "found", objective: stored };
  } catch (error) {
    logger.warn("oyi_public_opportunity_objective_read_failed", { thread_id: threadId, error });
    return { status: "error" };
  }
}
