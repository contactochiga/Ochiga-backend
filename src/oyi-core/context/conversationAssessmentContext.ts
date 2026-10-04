import type { CognitiveObjective, SemanticFrame } from "../contracts/semanticFrame";
import type { CanonicalConversationRequest } from "../contracts/canonicalConversation";
import { supabaseAdmin } from "../../supabase/supabaseClient";

// Ephemeral conversational state, persisted ONLY by canonical conversation
// persistence. It contains neither evidence nor an execution directive.
export type ConversationAssessmentContext = {
  objective: CognitiveObjective;
  surface: string;
  domain: string | null;
  question: string;
  status: "evidence_needed" | "assessment_pending";
  result_set_id?: string | null;
  // An unverified, not-yet-bound conversational claim, never a live fact.
  pending_information?: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
};
export const ASSESSMENT_TTL_MS = 30 * 60 * 1000;
export const isAssessmentObjective = (objective: unknown): objective is CognitiveObjective =>
  ["assess", "prioritize", "compare", "explain", "advise", "reassess"].includes(String(objective));

export function validAssessment(value: unknown, surface: string, now = Date.now()): ConversationAssessmentContext | null {
  const v = value as ConversationAssessmentContext | null;
  if (!v || !isAssessmentObjective(v.objective) || v.surface !== surface || typeof v.question !== "string"
    || !["evidence_needed", "assessment_pending"].includes(v.status)
    || !Number.isFinite(Date.parse(v.expires_at)) || Date.parse(v.expires_at) <= now
    || Date.parse(v.expires_at) > now + ASSESSMENT_TTL_MS) return null;
  return v;
}

// Caller must already have passed canonical thread ownership admission. Actor
// and surface checks here are defence in depth, not a replacement for public
// session ownership or estate/home authorization.
export async function loadConversationAssessment(request: CanonicalConversationRequest, actorId: string | null): Promise<ConversationAssessmentContext | null> {
  if (!request.thread_id) return null;
  const { data, error } = await supabaseAdmin.from("oyi_conversation_threads")
    .select("metadata,surface,user_id").eq("id", request.thread_id).maybeSingle();
  if (error) throw error;
  if (!data || data.surface !== request.surface || data.user_id !== actorId) return null;
  return validAssessment(data.metadata?.conversation_assessment, request.surface);
}

export function assessmentContinuation(text: string): boolean {
  return /\b(?:second|first|third|that one|the others|those|that project|that opportunity)\b|^\s*(?:why|what about|no[, ]+that|actually[, ]+forget)\b/i.test(text)
    || /^\s*(?:is|does|would|could|can|will|has|are|do)\s+(?:that|this|it|those|these|they)\b/i.test(text)
    || isAssessmentInformation(text);
}

export function isAssessmentInformation(text: string): boolean {
  return /^(?:the|my|our|that|this|it|they|he|she)\b[^?!]*\b(?:is|are|was|were|has|have|says|said)\b/i.test(text) && !text.includes("?");
}

export function nextConversationAssessment(previous: ConversationAssessmentContext | null, frame: SemanticFrame, surface: string, now = Date.now()): ConversationAssessmentContext | null {
  const old = validAssessment(previous, surface, now);
  if (frame.operation === "cancel" || frame.mutationIntent || frame.capabilityInquiry || frame.cognitiveObjective === "retrieve") return null;
  const answeringPending = Boolean(old?.pending_information && !frame.cognitiveObjective
    && !/^(?:what|why|who|when|where|how|show|list|open|now)\b/i.test(frame.rawText));
  const followUp = old && (answeringPending || assessmentContinuation(frame.rawText) || isAssessmentObjective(frame.cognitiveObjective));
  if (!isAssessmentObjective(frame.cognitiveObjective) && !followUp) return null;
  const correction = /\b(?:i mean|i meant|instead|forget)\b/i.test(frame.rawText);
  const explicitDomain = frame.domain === "corporate_development" && surface === "office_internal" ? "office_development"
    : frame.domain && !["global", "unknown"].includes(frame.domain) ? frame.domain : null;
  const switched = explicitDomain && old?.domain && explicitDomain !== old.domain && !assessmentContinuation(frame.rawText);
  const retain = old && (!switched || answeringPending);
  const stamp = new Date(now).toISOString();
  return {
    objective: frame.cognitiveObjective && isAssessmentObjective(frame.cognitiveObjective) ? frame.cognitiveObjective : old!.objective,
    surface,
    domain: correction || !retain ? explicitDomain : old.domain || explicitDomain,
    question: retain && !correction && !["assess", "prioritize", "compare"].includes(frame.cognitiveObjective || "")
      ? old.question : frame.rawText.slice(0, 1000),
    status: "assessment_pending",
    pending_information: retain && isAssessmentInformation(frame.rawText) ? frame.rawText.slice(0, 1000)
      : retain ? old.pending_information || null : null,
    created_at: retain ? old.created_at : stamp,
    updated_at: stamp,
    expires_at: new Date(now + ASSESSMENT_TTL_MS).toISOString(),
  };
}
