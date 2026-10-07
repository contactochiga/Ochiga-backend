import type { CognitiveObjective, SemanticFrame } from "../contracts/semanticFrame";
import type { CanonicalConversationRequest } from "../contracts/canonicalConversation";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import type { CapabilityModule } from "../contracts/capability";
import type { CompactEvidencePlanState } from "../evidence/planner/types";
import type { DerivedRanking } from "../evidence/judgment/types";

// Ephemeral conversational state, persisted ONLY by canonical conversation
// persistence. It contains neither evidence nor an execution directive.
export type ConversationAssessmentContext = {
  objective: CognitiveObjective;
  surface: string;
  domain: string | null;
  question: string;
  status: "evidence_needed" | "assessment_pending";
  // A read-only assessment may survive a temporary retrieval/action turn.
  // This flag never restores a workflow, confirmation or execution target.
  suspended?: boolean;
  requirement_purpose?: "ownership" | "privacy" | "safety" | "handoff" | "counterfactual" | null;
  result_set_id?: string | null;
  // An unverified, not-yet-bound conversational claim, never a live fact.
  pending_information?: string | null;
  subject_domains?: string[];
  subject_label?: string | null;
  required_evidence_domains?: string[];
  available_evidence_domains?: string[];
  missing_evidence_domains?: string[];
  restricted_evidence_domains?: string[];
  // Only an already-selected, same-scope result may bind an assertion.
  target_ref?: { canonical_id: string; object_type: string; label: string } | null;
  material_information?: { text: string; target_id: string; source: "user_assertion" } | null;
  // IQ-3B: the compact governed evidence-plan state for THIS assessment (counts, safe refs, a small
  // allowlisted projection). Never raw evidence. Carried across follow-ups and invalidated by the planner.
  evidence_plan?: CompactEvidencePlanState | null;
  // IQ-4: the canonical DERIVED ranking (a distinct cognitive artifact, never the raw result set it came from) and a compact
  // record of the last judgment. Concise evidence-linked rationale only; no reasoning chain is ever stored.
  derived_ranking?: DerivedRanking | null;
  judgment?: { assessment_id: string; mode: string; status: string; validated: boolean; judged_at: string } | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
};
export const ASSESSMENT_TTL_MS = 30 * 60 * 1000;
export const isAssessmentObjective = (objective: unknown): objective is Exclude<CognitiveObjective, "retrieve" | "summarize"> =>
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
  return /\b(?:go back|return|i mean|i meant)\b|\b(?:second|first|third|that one|the others|those|that project|that opportunity)\b|^\s*(?:why|what about|no[, ]+that|actually[, ]+forget)\b/i.test(text)
    || /^\s*(?:is|does|would|could|can|will|has|are|do)\s+(?:that|this|it|those|these|they)\b/i.test(text)
    || /^\s*(?:and now|so|then what|still|which one|the (?:first|second|third) one)[?.! ]*$/i.test(text)
    || /\b(?:that|this|it|those|these|they|them|earlier|still|given that)\b/i.test(text)
    || /\bthe (?:problem|issue|work|opportunity|project|room)\b/i.test(text)
    || (/\b(?:evidence|verification|uncertainty|missing|authority|authorization|measurement)\b/i.test(text)
      && !/\b(?:about|across|instead|i mean)\b/i.test(text))
    || isAssessmentInformation(text);
}

// Subject vocabulary, not a capability registry or an execution plan. These
// existing domain names describe what the question is ABOUT. Permission is
// evaluated separately against the real registry before listing requirements.
export function assessmentSubjectDomains(frame: SemanticFrame, surface: string): string[] {
  const t = frame.rawText.split(/\b(?:i mean|i meant|instead of|rather than)\b/i).slice(-1)[0];
  if (/\b(?:across|estate-wide|estate overview|estate operations)\b|\b(?:everything|anything)\b.*\b(?:estate|home)\b/i.test(t)) return defaultSubject(surface);
  if (surface === "public_corporate" && /\b(?:land|opportunity|jv|title|ownership|planning|partnership|documents?)\b/i.test(t)) return ["corporate_opportunity"];
  if (/\b(?:water|light|repair|resolved|open)\b.*\b(?:issue|problem|leak)|\b(?:maintenance|leak)\b/i.test(t)) return ["maintenance"];
  if (/\b(?:opportunit(?:y|ies)|leads?|prospects?)\b/i.test(t)) return [surface === "public_corporate" ? "corporate_opportunity" : "crm"];
  if (/\b(?:developments?|projects?)\b/i.test(t)) return [surface === "office_internal" ? "office_development" : "corporate_development"];
  if (/\b(?:electricity|consumption|usage|meter)\b/i.test(t)) return ["utilities"];
  if (/\b(?:cameras?|cctv)\b/i.test(t)) return ["cameras"];
  if (/\b(?:visitors?|who.*(?:expected|coming)|arrival|arrived|expired access)\b/i.test(t)) return ["visitors"];
  if (/\b(?:bedroom|study|kitchen|living room|temperature|sensor)\b/i.test(t)) return ["rooms", "devices"];
  if (/\b(?:sensor|temperature|telemetry|hardware|devices?|ac|light|lock)\b/i.test(t)) return ["devices"];
  if (/\b(?:wallet|spent|spending|transactions?)\b/i.test(t)) return ["wallet"];
  if (/\b(?:secure|security|danger)\b/i.test(t)) return ["security"];
  if (/\b(?:financ|funding|funded)\w*\b/i.test(t)) return [surface === "office_internal" ? "office_financial" : "corporate_opportunity"];
  if (frame.domain && !["global", "reports", "home"].includes(frame.domain)) return [frame.domain];
  return [];
}

export function defaultAssessmentSubject(surface: string): string[] { return defaultSubject(surface); }
function defaultSubject(surface: string): string[] {
  if (surface === "office_internal") return ["crm", "office_development", "office_reports", "office_financial"];
  if (surface === "public_corporate") return ["corporate_opportunity"];
  if (surface === "facility") return ["maintenance", "security", "devices", "cameras", "utilities"];
  return ["home", "devices", "security", "visitors", "utilities"];
}

export function assessmentEvidenceRequirements(state: ConversationAssessmentContext, eligible: CapabilityModule[], available: string[] = state.available_evidence_domains || []): ConversationAssessmentContext {
  const subjects = state.subject_domains || (state.domain ? [state.domain] : defaultSubject(state.surface));
  const modules = eligible.filter(m => subjects.includes(m.domain) && m.risk_class === "read");
  const required = [...new Set(modules.flatMap(m => (m.evidence_requirements || []).map(e => e.domain)))].filter(d => d !== "unknown");
  const covered = subjects.filter(d => modules.some(m => m.domain === d));
  const present = required.filter(d => available.includes(d));
  return { ...state, subject_domains: subjects, required_evidence_domains: required,
    available_evidence_domains: present, missing_evidence_domains: required.filter(d => !present.includes(d)),
    restricted_evidence_domains: subjects.filter(d => !covered.includes(d)) };
}

export function assessmentSubjectLabel(state: ConversationAssessmentContext): string {
  const domains = (state.subject_domains || [state.domain || "current subject"]).map(d => ({crm:"opportunities and leads",office_development:"development projects",office_reports:"pending decisions and reports",office_financial:"financial position",corporate_opportunity:"the opportunity you are exploring",home:"home operations",devices:"device state",cameras:"camera state",utilities:"utility readings"} as Record<string,string>)[d] || d.replace(/^office_|^corporate_/, "").replace(/_/g," ")).join(", ");
  return state.subject_label ? `${domains} (${state.subject_label}, as described by you)` : domains;
}

export function assessmentCaveats(state: ConversationAssessmentContext, frame: SemanticFrame, options: { judged?: boolean } = {}): string {
  const references = /\b(?:second|third|other one|that project)\b/i.test(frame.rawText) && !state.target_ref
    ? " Which item do you mean? No assessed or ranked target has been established, so I won't substitute an older list." : "";
  const roomReference = /\bwhich room\b.*\bdiscuss/i.test(frame.rawText) && !state.subject_label
    ? " Which room do you mean? I don't have a confirmed active room reference, so I won't pick one from a room list." : "";
  const claim = isAssessmentInformation(frame.rawText) ? state.target_ref
    ? ` I am treating your information about ${state.target_ref.label} as an unverified user assertion, not confirmed operational evidence.`
    : " Your information is unverified. Which item should it attach to?" : "";
  const historical = /\b(?:yesterday|baseline|changed|earlier)\b/i.test(frame.rawText) ? " A comparison also requires a comparable earlier observation; current records alone do not prove a change." : "";
  const scope = /\b(?:tower|building|scope)\b/i.test(frame.rawText) ? " A building label is not a verified building scope; estate-wide records cannot establish that narrower view." : "";
  const policy = /\b(?:authority|authorization|confirmation)\b/i.test(frame.rawText) ? " Any proposed action must still pass its own permission, scope and confirmation checks; this assessment grants none." : "";
  const attribution = /\b(?:who|which resident)\b.*\bcaus/i.test(frame.rawText) ? " Identifying a cause or a person responsible requires corroborating evidence; an open issue alone does not establish blame." : "";
  const purpose = state.requirement_purpose;
  const specific = purpose === "privacy" ? " The missing requirement is authorized scope and consent/ownership status for the information, not its private contents. Do not send third-party documents, credentials or unnecessary personal details; use the authorized reporting channel."
    : purpose === "ownership" ? " The missing requirement is an authoritative assignment or ownership/representation status for this work. I cannot infer a responsible person from an opportunity list or invent a staff member."
    : purpose === "safety" ? " The missing requirement is current incident/device observability and the authorized operating procedure for the proposed intervention. Until those are verified, do not attempt an unapproved physical intervention."
    : purpose === "handoff" ? " The requirement is an authorized maintenance/support reporting route and its permitted scope. Describe the concern without another resident's private records; submission or follow-up is not confirmed here."
    : purpose === "counterfactual" ? " This asks which evidence could change the assessment, not whether a change has already occurred. It requires evidence that resolves the current blocker or uncertainty; no changed recommendation is asserted."
    : "";
  const comparison = !options.judged && frame.cognitiveObjective === "compare" && /\b(?:compare|stronger|other one)\b/i.test(frame.rawText) && !state.target_ref ? " The subject categories are retained, but no compared candidate set is established. Which items should be compared?" : "";
  return `${specific}${comparison}${references}${roomReference}${claim}${historical}${scope}${policy}${attribution}`;
}

export function assessmentEvidenceAnswer(state: ConversationAssessmentContext, frame: SemanticFrame): string {
  const subject = assessmentSubjectLabel(state);
  const requirements = (state.missing_evidence_domains?.length ? state.missing_evidence_domains : state.required_evidence_domains) || [];
  const names = assessmentSubjectLabel({ ...state, subject_domains: requirements, subject_label: null });
  const job = ({assess:"assess",prioritize:"prioritize",compare:"compare",explain:"explain",advise:"recommend a next step for",reassess:"reassess",summarize:"summarize",retrieve:"inspect"})[frame.cognitiveObjective || state.objective];
  const need = requirements.length ? `The evidence requirement is current ${names} evidence within your permitted scope.`
    : "There is no eligible read-evidence contract for that subject in this scope; I cannot claim access to it.";
  const caveats = assessmentCaveats(state, frame);
  return `To ${job} ${subject}, ${need.charAt(0).toLowerCase()+need.slice(1)} I have not loaded additional sources or established a new recommendation.${caveats}`;
}

export function isAssessmentInformation(text: string): boolean {
  return /^(?:(?:actually|but)[, ]+)?(?:the|my|our|their|there|that|this|it|they|he|she)\b[^?!]*\b(?:is|are|was|were|has|have|says|said|can|could|promises?|feels?|needs?|wants?)\b/i.test(text) && !text.includes("?");
}

export function nextConversationAssessment(previous: ConversationAssessmentContext | null, frame: SemanticFrame, surface: string, now = Date.now()): ConversationAssessmentContext | null {
  const old = validAssessment(previous, surface, now);
  if (frame.operation === "cancel" || frame.capabilityInquiry) return null;
  if (frame.mutationIntent || frame.cognitiveObjective === "retrieve") return old
    ? { ...old, suspended: true, ...(frame.mutationIntent ? { target_ref: null, result_set_id: null, material_information: null } : {}) } : null;
  const answeringPending = Boolean(old?.pending_information && !frame.cognitiveObjective
    && !/^(?:what|why|who|when|where|how|show|list|open|now)\b/i.test(frame.rawText));
  const followUp = old && (answeringPending || assessmentContinuation(frame.rawText) || isAssessmentObjective(frame.cognitiveObjective) || frame.cognitiveObjective === "summarize");
  if (!isAssessmentObjective(frame.cognitiveObjective) && !followUp) return null;
  const correction = /\b(?:i mean|i meant|instead|forget|actually.*\bnot\b)\b/i.test(frame.rawText);
  const subjects = assessmentSubjectDomains(frame, surface);
  const explicitDomain = subjects.length === 1 ? subjects[0] : null;
  const switched = explicitDomain && old?.domain && explicitDomain !== old.domain && !assessmentContinuation(frame.rawText);
  const retain = old && (!switched || answeringPending) && (!old.suspended || assessmentContinuation(frame.rawText)
    || subjects.some(d => old.subject_domains?.includes(d)));
  const anaphoric = assessmentContinuation(frame.rawText) && !correction;
  const explicitSubjectQuestion = /^(?:(?:what|how) about|go back|return)\b/i.test(frame.rawText) && subjects.length > 0
    && !/^(?:what|how) about (?:this|that|it|them|the (?:first|second|third) one)\b/i.test(frame.rawText);
  const subjectDomains = correction || explicitSubjectQuestion ? subjects : retain && anaphoric ? old.subject_domains
    : subjects.length ? subjects : retain ? old.subject_domains : undefined;
  const nextSubjects = subjectDomains?.length ? subjectDomains : defaultSubject(surface);
  const broadScope = /\b(?:estate-wide|across the estate|whole estate|home-wide|whole home)\b/i.test(frame.rawText);
  const label = frame.rawText.match(/\b(?:tower\s+[A-Z0-9]+|building\s+[A-Z0-9]+)\b/i)?.[0]
    || (nextSubjects.some(d => d === "rooms" || d === "devices")
      ? frame.rawText.match(/\b(?:master bedroom|bedroom|living room|study|kitchen)\b/i)?.[0] : null) || null;
  const subjectChanged = Boolean(old && JSON.stringify(nextSubjects) !== JSON.stringify(old.subject_domains));
  const replaceCandidates = correction || subjectChanged || !retain || (!anaphoric && ["prioritize", "compare"].includes(frame.cognitiveObjective || ""));
  const stamp = new Date(now).toISOString();
  return {
    objective: frame.cognitiveObjective && isAssessmentObjective(frame.cognitiveObjective) ? frame.cognitiveObjective : old!.objective,
    surface,
    domain: nextSubjects.length === 1 ? nextSubjects[0] : null,
    subject_domains: nextSubjects,
    subject_label: broadScope ? null : label || (retain && !correction ? old.subject_label : null),
    suspended: false,
    requirement_purpose: /\b(?:privacy|private documents?|third.party)\b/i.test(frame.rawText) ? "privacy"
      : /\b(?:own the work|staff member|ownership|representation|assigned|responsible person)\b/i.test(frame.rawText) ? "ownership"
      : /\b(?:not be attempted|unsafe|safety procedure|dangerous intervention)\b/i.test(frame.rawText) ? "safety"
      : /\b(?:raise|report)\b.*\b(?:concern|issue)\b/i.test(frame.rawText) ? "handoff"
      : /\b(?:what|which) evidence\b.*\b(?:would|could)\b.*\bchange\b/i.test(frame.rawText) ? "counterfactual"
      : retain && anaphoric ? old.requirement_purpose : null,
    available_evidence_domains: retain && !correction && now - Date.parse(old.created_at) < ASSESSMENT_TTL_MS ? old.available_evidence_domains || [] : [],
    target_ref: !replaceCandidates ? old!.target_ref : null,
    result_set_id: !replaceCandidates ? old!.result_set_id : null,
    question: retain && !correction && !["assess", "prioritize", "compare"].includes(frame.cognitiveObjective || "")
      ? old.question : frame.rawText.slice(0, 1000),
    status: "assessment_pending",
    pending_information: retain && !correction && isAssessmentInformation(frame.rawText) ? frame.rawText.slice(0, 1000)
      : retain && !correction && (!subjectChanged || answeringPending) ? old.pending_information || null : null,
    material_information: retain && !correction && !subjectChanged ? old.material_information : null,
    evidence_plan: retain && !correction ? old.evidence_plan ?? null : null,
    derived_ranking: retain && !correction ? old.derived_ranking ?? null : null,
    judgment: retain && !correction ? old.judgment ?? null : null,
    created_at: retain ? old.created_at : stamp,
    updated_at: stamp,
    expires_at: new Date(now + ASSESSMENT_TTL_MS).toISOString(),
  };
}
