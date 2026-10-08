// Wave 11 Osa burn-down -- the public/Osa progressive qualification
// capability. Reuses:
//   - the canonical conversation/thread context for its ephemeral state
//     (publicOpportunityObjective.ts; a sibling of pending_goal etc.,
//     NOT a new memory system, agent, or durable GoalRuntime entry);
//   - the existing JV assessment engine (developmentJv.ts) for
//     known-facts/missing-information reasoning when the objective is a
//     development/JV opportunity;
//   - the existing governed callback/handoff mechanism
//     (officeHandoffBridge.ts's requestOfficeHandoff) for "can somebody
//     call me?"; Office remains the sole authority for creating/routing
//     the handoff, exactly as that module's own header states.
//
// Generalization: the merge/compose logic below never branches on a
// literal value (a place name, an area number, "JV" vs "lease", "land"
// vs "existing building") -- only on the SHAPE of what was said. The
// same code path also serves objective_type "technology_inquiry" (a
// non-JV public capability inquiry progressing toward staff handoff)
// with a simpler generic requirements composer, proving the mechanism
// itself generalizes, not just its JV vocabulary.
import type { CapabilityModule, CapabilityContext } from "../contracts/capability";
import { projectResponse } from "../response/projector";
import { heldFactsEnvelope } from "../response/envelopeMappers";
import type { AnswerTarget } from "../response/answerTarget";
import type { DomainResult } from "../contracts/domainResult";
import type { OyiEvidence } from "../contracts/evidence";
import { publicOpportunityOutcome } from "../evidence/sources/publicReads";
import type { SemanticFrame } from "../contracts/semanticFrame";
import { isAssessmentObjective } from "../context/conversationAssessmentContext";
import { correctedPublicFacts, extractTitleStatus } from "../context/publicOpportunityObjective";
import { evidenceEnvelope } from "../evidence/EvidenceEnvelope";
import { readModule, resultPresentation } from "./ReadCapabilityModules";
import { canonicalCorporateAnswer } from "./corporateKnowledgeAnswer";
import {
  readPublicOpportunityObjective,
  type PublicOpportunityObjective,
  type PublicOpportunityType,
} from "../context/publicOpportunityObjective";
import { assessJvOpportunity, type JvEvidence } from "../domains/development/developmentJv";
import { publicFallbackAnswer } from "../response/fallbackTarget";
import { threadActionTruth } from "../response/actionTruth";
import { requestOfficeHandoff, type OfficeHandoffRequestInput, type OfficeHandoffRequestResult } from "../ingress/officeHandoffBridge";

const publicEvidence: OyiEvidence["privacy_class"] = "public";

function text(value: unknown) {
  return String(value ?? "").trim();
}

// ---------------------------------------------------------------------
// Extraction -- generic shape-matching only, never a literal value.
// ---------------------------------------------------------------------
function extractLocation(message: string): string | null {
  // Sentence-bounded: a period followed by a new capitalized word starts
  // a NEW sentence, not a continuation of the place name (found live:
  // "I own land in VI. What is..." was misread as location "VI. What").
  const sentence = message.split(/(?<=[.!?])\s+/)[0] || message;
  const match = sentence.match(/\bin\s+([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,2})/);
  return match ? match[1].replace(/[.,]+$/, "").trim() : null;
}

function extractArea(message: string): string | null {
  const area = message.match(/(\d[\d,]*\s*(?:sqm|square\s*meters?|hectares?|acres?))/i);
  if (area) return area[1].replace(/\s+/g, " ").trim();
  const units = message.match(/(\d+[\s-]*units?)/i);
  return units ? units[1].replace(/\s+/g, " ").trim() : null;
}

function extractStructurePreference(message: string): string | null {
  const match = message.match(/\b(joint\s*venture|jv|leasing|lease|outright\s+sale|sale|partnership)\b/i);
  if (!match) return null;
  const raw = match[1].toLowerCase();
  if (/joint\s*venture|jv/.test(raw)) return "JV";
  if (/leas/.test(raw)) return "lease";
  if (/sale/.test(raw)) return "sale";
  return "partnership";
}

// "facility"/"site" deliberately excluded -- both appear naturally in a
// technology/facility CAPABILITY inquiry ("Oyi for our new facility")
// that has no real-estate opportunity at all; only words that
// specifically imply an existing physical structure being offered stay
// in this list.
function extractPropertyKind(message: string): "land" | "existing_building" | null {
  const land = message.search(/\b(?:land|plots?)\b/i), building = message.search(/\b(?:building|property|house|estate)\b/i);
  // IQ-9A8: in a correction ("actually, a different plot: a building in Asaba") the kind named LAST is the corrected one
  if (land >= 0 && building >= 0 && /\b(?:actually|different|instead|rather|correction|i\s+mean)\b/i.test(message)) return building > land ? "existing_building" : "land";
  if (land >= 0) return "land";
  if (building >= 0) return "existing_building";
  return null;
}

/** Records the caller's stated contact preference into the thread's opportunity objective (conversation-scoped note; no facts are invented). */
export function recordContactPreference(prior: PublicOpportunityObjective | null, message: string): PublicOpportunityObjective | null {
  if (contactConstraintsIn(message).length === 0) return null;
  return mergeObjective(prior, message, new Date().toISOString());
}

/** Contact-channel preferences stated by the caller (kept as objective constraints; conversation-scoped notes, not enforced rules). */
export function contactConstraintsIn(message: string): string[] {
  const out: string[] = [];
  if (/\b(?:never|don'?t|do\s+not|stop)\b[^.?!,]{0,30}\b(?:call|phone|ring)\b|\bnot\s+by\s+phone\b|\bno\s+phone\s+calls?\b/i.test(message)) out.push("no_phone_contact");
  if (/\b(?:never|don'?t|do\s+not|stop)\b[^.?!,]{0,30}\b(?:e-?mail)\b/i.test(message)) out.push("no_email_contact");
  const only = message.match(/\b(?:only|just)\s+(?:contact|reach|message|text|whatsapp|e-?mail)\b[^.?!]{0,20}\b(?:by|via|on|through)?\s*(whatsapp|e-?mail|text|sms)\b/i);
  if (only) out.push(`only_${only[1].toLowerCase().replace("-", "")}`);
  return out;
}

function assertsOwnership(message: string): boolean {
  return /\bi\s+own\b/i.test(message);
}


function assertsNoSale(message: string): boolean {
  return /\b(?:do\s+not|don'?t)\s+want\s+to\s+sell\b|\bnot\s+(?:for\s+sale|selling)\b|\bnot\s+interested\s+in\s+(?:a\s+)?sale\b/i.test(message);
}

function isRequirementsCheck(message: string): boolean {
  return /\bwhat\s+(?:would|do)\s+you\s+need\s+from\s+me\b|\bwhat\s+(?:info(?:rmation)?|details)\s+do\s+you\s+need\b|\bwhat\s+else\s+do\s+you\s+need\b/i.test(message);
}

function isCallbackRequest(message: string): boolean {
  return /\bcan\s+(?:somebody|someone|anybody|anyone)\s+call\s+me\b|\bcould\s+(?:somebody|someone)\s+(?:call|reach\s+out\s+to)\s+me\b|\brequest\s+a\s+call(?:back)?\b|\bhave\s+someone\s+(?:call|contact)\s+me\b/i.test(message);
}

function isGeneralJvInfoQuestion(message: string): boolean {
  return /\b(?:documents?|structure)\b[\s\S]{0,40}\bjv\b|\bjv\b[\s\S]{0,40}\b(?:documents?|structure)\b/i.test(message);
}

function hasLandSignal(message: string, prior: PublicOpportunityObjective | null): boolean {
  return Boolean(
    assertsOwnership(message) ||
      extractPropertyKind(message) ||
      extractArea(message) ||
      extractStructurePreference(message) ||
      (prior && extractTitleStatus(message)) ||
      assertsNoSale(message) ||
      (prior && prior.objective_type === "development_partnership")
  );
}

// ---------------------------------------------------------------------
// Merge -- additive only. A fact already known is never overwritten with
// nothing, and a turn that supplies nothing new leaves known_facts alone.
// ---------------------------------------------------------------------
/** True when a message states opportunity facts (land, location, size, structure, title...): the public opportunity module owns such a turn, not the assessment planner. */
export function suppliesOpportunityFacts(message: string): boolean {
  try { return Object.keys(mergeObjective(null, message, new Date().toISOString()).known_facts).filter((k) => k !== "opportunity_type").length > 0; } catch { return false; }
}

function mergeObjective(prior: PublicOpportunityObjective | null, message: string, now: string): PublicOpportunityObjective {
  const landSignal = hasLandSignal(message, prior);
  const objectiveType: PublicOpportunityType = prior?.objective_type || (landSignal ? "development_partnership" : "technology_inquiry");
  const knownFacts: Record<string, string> = { ...(prior?.known_facts || {}) };
  const constraints = [...(prior?.constraints || [])];

  // "in <Place>" is only trustworthy as a location when the surrounding
  // statement is actually property-shaped -- otherwise "I'm interested in
  // Oyi for..." would misread "Oyi" itself as a location.
  const location = landSignal ? extractLocation(message) : null;
  if (location) knownFacts.location = location;

  const area = extractArea(message);
  if (area) knownFacts[objectiveType === "development_partnership" ? "land_size" : "size"] = area;

  const structure = extractStructurePreference(message);
  if (structure) knownFacts.structure_offered = structure;

  const propertyKind = extractPropertyKind(message);
  if (propertyKind) knownFacts.opportunity_type = propertyKind;
  else if (assertsOwnership(message) && !knownFacts.opportunity_type) knownFacts.opportunity_type = "land";

  const titleStatus = extractTitleStatus(message); if (titleStatus) knownFacts.title_document_status = titleStatus;
  if (assertsNoSale(message) && !constraints.includes("no_sale")) constraints.push("no_sale");
  for (const c of contactConstraintsIn(message)) if (!constraints.includes(c)) constraints.push(c);

  return {
    objective_type: objectiveType,
    known_facts: knownFacts,
    constraints,
    current_subject: location || prior?.current_subject || null,
    next_move: prior?.next_move || null,
    turns: (prior?.turns || 0) + 1,
    last_changes: prior ? changesBetween(prior, knownFacts) : [],
    superseded: [...(prior?.superseded || []), ...(prior ? changesBetween(prior, knownFacts).filter(c => c.from).map(c => ({ field: c.field, value: c.from as string })) : [])].slice(-6),
    created_at: prior?.created_at || now,
    updated_at: now,
  };
}

type FactChange = { field: string; from: string | null; to: string };
const changesBetween = (prior: PublicOpportunityObjective | null, next: Record<string, string>): FactChange[] =>
  Object.keys(next).filter(k => (prior?.known_facts || {})[k] !== next[k]).map(k => ({ field: k, from: prior?.known_facts?.[k] ?? null, to: next[k] }));
const openItems = (facts: Record<string, string>) => assessJvOpportunity(jvEvidenceFromKnownFacts(facts)).missing_information.filter(f => !NOT_YET_USEFUL_TO_ASK.has(f));
// What changed, in the caller's own terms, and what it does to the first-look picture. Everything stays caller-supplied; nothing is a decision.
function describeChanges(changes: FactChange[], before: Record<string, string>, after: Record<string, string>): string {
  const parts = changes.map(c => c.from ? `${c.field.replace(/_/g, " ")} from ${c.from} to ${c.to}` : `${c.field.replace(/_/g, " ")}: ${c.to}`);
  const supersededNote = changes.some(c => c.from) ? ", and I no longer treat the earlier value as current" : "";
  const effects: string[] = [];
  if (changes.some(c => c.field === "ownership_status")) effects.push("Who can authorise a JV on the family's behalf is not established by that.");
  const title = changes.find(c => c.field === "title_document_status");
  if (title && /not perfected|disputed/.test(title.to)) effects.push("A title that is not yet perfected leaves ownership and the right to enter a JV open; that is a gap to resolve, and nothing here is a decision or a commitment by Ochiga.");
  else if (title) effects.push("That removes one open question about title, but it is still your statement and I cannot verify it.");
  const b = openItems(before).length, a = openItems(after).length;
  if (a < b) effects.push(`That leaves ${a} detail${a === 1 ? "" : "s"} still to confirm instead of ${b}.`);
  else if (a > b) effects.push(`That leaves ${a} details still to confirm instead of ${b}.`);
  const verb = changes.some(c => c.from) ? "changed" : "added";
  return `I have ${verb} ${parts.join("; ")}${supersededNote}. These are details you have supplied, not independently verified. ${effects.join(" ")}`.trim();
}

function composeAcknowledgement(prior: PublicOpportunityObjective | null, updated: PublicOpportunityObjective): string {
  const CLOSER = "Is there anything else about it you'd like to add, or would you like to know what we'd need from you?";
  if (!prior) {
    const bits: string[] = [];
    if (updated.known_facts.location) bits.push(`in ${updated.known_facts.location}`);
    if (updated.known_facts.land_size) bits.push(updated.known_facts.land_size);
    const detail = bits.length ? ` ${bits.join(", ")}` : "";
    return `Thanks for sharing that${detail}. I can help start a conversation about this -- feel free to tell me more, or ask what we'd need from you.`;
  }
  const newlyConstrained = updated.constraints.filter((constraint) => !prior.constraints.includes(constraint));
  if (newlyConstrained.includes("no_sale")) {
    return `Understood -- noted that a sale isn't of interest; a JV or lease can still work. ${CLOSER}`;
  }
  const newlyKnown = Object.keys(updated.known_facts).filter((key) => prior.known_facts[key] !== updated.known_facts[key]);
  if (updated.known_facts.structure_offered && newlyKnown.includes("structure_offered")) {
    return `Got it -- a ${updated.known_facts.structure_offered} could work. ${CLOSER}`;
  }
  if (newlyKnown.length) return `Thanks, noted. ${CLOSER}`;
  return `Understood. ${CLOSER}`;
}

function jvEvidenceFromKnownFacts(knownFacts: Record<string, string>): JvEvidence {
  return {
    opportunityType: knownFacts.opportunity_type || null,
    location: knownFacts.location || null,
    landSize: knownFacts.land_size || null,
    structureOffered: knownFacts.structure_offered || null,
    landownerExpectation: knownFacts.landowner_expectation || null,
    titleDocumentStatus: knownFacts.title_document_status || null,
    commercialTerms: knownFacts.commercial_terms || null,
  };
}

// Title/document status is naturally established once an opportunity
// progresses (see developmentJv.ts's own considerations text), not
// something a first-contact prospect is expected to volunteer up front
// -- excluded from what we actively ask for here so the answer only
// requests genuinely useful next information.
const NOT_YET_USEFUL_TO_ASK = new Set(["title_document_status"]);

function composeJvRequirementsAnswer(objective: PublicOpportunityObjective): string {
  const assessment = assessJvOpportunity(jvEvidenceFromKnownFacts(objective.known_facts));
  const knownEntries = Object.entries(assessment.known_facts);
  const known = knownEntries.length ? knownEntries.map(([key, value]) => `${key.replace(/_/g, " ")}: ${value}`).join("; ") : "very little so far";
  const constraintsText = objective.constraints.length ? ` You've also mentioned: ${objective.constraints.map((c) => c.replace(/_/g, " ")).join(", ")}.` : "";
  const stillMissing = assessment.missing_information.filter((field) => !NOT_YET_USEFUL_TO_ASK.has(field));
  const missingText = stillMissing.length
    ? ` To move this forward, it would help to know: ${stillMissing.map((field) => field.replace(/_/g, " ")).join(", ")}.`
    : " That's everything we typically need to take a first look.";
  const ownership = objective.known_facts.ownership_status ? ` Your stated ownership status: ${objective.known_facts.ownership_status}.` : "";
  return `Here's what I have so far -- ${known}.${ownership}${constraintsText}${missingText}`.replace(/\s+/g, " ").trim();
}

function composeGenericRequirementsAnswer(objective: PublicOpportunityObjective): string {
  const knownEntries = Object.entries(objective.known_facts);
  const known = knownEntries.length ? knownEntries.map(([key, value]) => `${key.replace(/_/g, " ")}: ${value}`).join("; ") : "very little so far";
  const constraintsText = objective.constraints.length ? ` You've also mentioned: ${objective.constraints.map((c) => c.replace(/_/g, " ")).join(", ")}.` : "";
  return `Here's what I have so far -- ${known}.${constraintsText} If there's anything specific you'd like us to know before someone follows up, feel free to share it -- otherwise I can arrange for someone to reach out.`;
}

// IQ-9A4: the stages a callback/handoff can reach, each claimed only on the evidence it needs.
//   requested -> attempted -> (accepted_receipt_recorded | rejected | unavailable | attempted_no_receipt) -> contact_completed (only if the Office receipt itself says so)
export type HandoffStage = "accepted_receipt_recorded" | "rejected" | "unavailable" | "attempted_no_receipt" | "contact_completed";
const COMPLETED_STATUS = /^(?:completed|contacted|contact_completed|called|done)$/i;
export function classifyHandoff(result: OfficeHandoffRequestResult): HandoffStage {
  if (!result.ok) return /^(?:office_rejected|office_http_4\d\d|rejected|invalid|forbidden|unauthori[sz]ed)/i.test(result.reason) || /reject/i.test(result.reason) ? "rejected" : "unavailable";
  if (/failed|rejected|cancelled/i.test(`${result.status} ${result.routing_status}`)) return "rejected";
  if (!result.handoff_id) return "attempted_no_receipt";
  return COMPLETED_STATUS.test(String(result.status || "").trim()) ? "contact_completed" : "accepted_receipt_recorded";
}

export async function composeCallbackAnswer(context: CapabilityContext, objective: PublicOpportunityObjective | null, requester: (input: OfficeHandoffRequestInput) => Promise<OfficeHandoffRequestResult> = requestOfficeHandoff): Promise<{ status: "answered" | "unavailable"; answer: string; metadata: Record<string, unknown> }> {
  const summary = objective
    ? `Public opportunity inquiry (${objective.objective_type}): ${Object.entries(objective.known_facts).map(([key, value]) => `${key}=${value}`).join(", ") || "no details yet"}${objective.constraints.length ? `; constraints: ${objective.constraints.join(", ")}` : ""}`
    : "Public inquiry requesting a callback with no prior details captured in this conversation.";
  const leadId = text(context.input.thread_id) || context.resolvedTurn.request_id;
  const result = await requester({
    lead_id: leadId,
    business_unit: objective?.objective_type === "development_partnership" ? "development" : "general",
    requested_capability: "callback_request",
    reason: summary,
    priority: "normal",
  });
  const stage = classifyHandoff(result);
  const accepted = stage === "accepted_receipt_recorded" || stage === "contact_completed";
  const kept = objective ? " Your opportunity details remain in this conversation; you don't need to start again." : "";
  const retry = " You can repeat your callback request to try again, or contact the team at ochiga.com.ng/contact.";
  const answer = stage === "contact_completed"
    ? "The team's record shows this callback as completed. I can only report that because the team's own record says so; I haven't spoken to anyone."
    : stage === "accepted_receipt_recorded"
      ? "The team has received your callback request. A call has not been booked or confirmed, and no one has contacted you yet." + (objective && Object.keys(objective.known_facts).length ? " What you've told me so far was included with the request." : "")
      : stage === "rejected"
        ? "The team's system did not accept your callback request, so no callback is arranged and no callback is confirmed." + retry + kept
        : stage === "attempted_no_receipt"
          ? "I sent your callback request but did not get a receipt back, so I can't say the team has it and no callback is confirmed." + retry + kept
          : "I couldn't pass your callback request to the team, so no callback is confirmed." + retry + kept;
  return { status: accepted ? "answered" : "unavailable", answer, metadata: {
    office_handoff_requested: true, office_handoff_ok: accepted,
    office_handoff_status: accepted ? "accepted" : stage,
    office_handoff_id: result.ok ? result.handoff_id || null : null,
    office_handoff_retryable: !accepted,
    // requested by the visitor -> attempted -> receipt; "contact_completed" only when the Office receipt itself reports completion
    handoff_stage: stage,
    contact_completed: stage === "contact_completed",
  } };
}

// IQ-8: the lead of an assessment-style answer comes from what was asked; the existing qualification text follows as supporting detail.
function targetedPublicLead(objective: PublicOpportunityObjective, target: AnswerTarget | undefined, raw?: string): string | null {
  try {
    if (!target) return null;
    const jv = objective.objective_type === "development_partnership";
    const assessment = assessJvOpportunity(jvEvidenceFromKnownFacts(objective.known_facts));
    const missing = jv ? assessment.missing_information.filter((field) => !NOT_YET_USEFUL_TO_ASK.has(field)) : null;
    const lead = projectResponse(target, heldFactsEnvelope({ known: Object.fromEntries(Object.entries(objective.known_facts).map(([k, v]) => [k, String(v).replace(/_/g, " ")])), missing, constraints: objective.constraints }), { asked: "", raw })?.primary ?? null;
    // provenance of a correction: what was replaced is named as superseded, never re-presented as current
    const replaced = (objective.superseded || []).filter(x => objective.known_facts[x.field] !== x.value);
    const contact = objective.constraints.filter(c => c.endsWith("_contact") || c.startsWith("only_")).map(c => c.replace(/_/g, " "));
    const notes = [replaced.length && target.ask_facet === "recall" ? `Earlier you mentioned ${replaced.map(x => `${x.field.replace(/_/g, " ")} ${x.value}`).join(", ")}; I no longer treat that as current.` : "", contact.length && target.ask_facet === "recall" ? `You also asked for: ${contact.join(", ")} (a note for this conversation only).` : ""].filter(Boolean);
    return lead && notes.length ? `${lead} ${notes.join(" ")}` : lead;
  } catch { return null; }
}

const CORPORATE_JV_STRUCTURE_FALLBACK =
  "A typical Ochiga JV moves through Introduce, Review, Structure, Align, Execute. Early on we usually look at opportunity type, location, land size, and any documents already in hand (title, survey, or existing approvals if a building already exists); " +
  "a target equity split is discussed once those are clear, subject to negotiation. Start a conversation at ochiga.com.ng/partnerships or ochiga.com.ng/contact.";

function publicOpportunityEvidence(objective: PublicOpportunityObjective | null, loadFailed = false): OyiEvidence {
  return evidenceEnvelope({
    domain: "corporate_opportunity",
    type: "public_opportunity_objective",
    object_type: null,
    object_id: null,
    source: "domain_adapter",
    observed_at: objective?.updated_at || null,
    freshness: "unknown",
    privacy_class: publicEvidence,
    confidence: 0.85,
    authorised_scope: { estate_id: null, building_id: null, home_id: null, room_id: null },
    payload: { objective, load_failed: loadFailed },
  });
}

export function publicOpportunityReadModule(): CapabilityModule {
  return readModule({
    key: "corporate.opportunity.read",
    domain: "corporate_opportunity",
    operations: ["inform", "inspect", "summarize", "reject"],
    supportedSurfaces: ["public_corporate"],
    permissions: [],
    evidenceRequirements: [{ domain: "corporate_opportunity", evidence_type: "public_opportunity_objective", freshness: ["unknown"], required: false }],
    supports: (frame: SemanticFrame) => frame.domain === "corporate_opportunity",
    certifiedSource: { module: "src/oyi-core/evidence/sources/publicReads.ts", kind: "public_thread", scopes: ["public_thread"], population: "unexpired_caller_supplied_opportunity_objective_of_owned_public_thread", read: publicOpportunityOutcome },
    collect: async (context) => {
      const read = await readPublicOpportunityObjective(text(context.input.thread_id), context.actor?.id);
      return [publicOpportunityEvidence(read.status === "found" ? read.objective : null, read.status === "error")];
    },
    answer: async (context, evidence): Promise<DomainResult> => {
      const prior = (evidence[0]?.payload as { objective: PublicOpportunityObjective | null } | undefined)?.objective || null;
      // A failed objective load is not "no earlier details": answering as if the caller had
      // supplied nothing would merge this turn over, and so overwrite, what they already gave.
      if ((evidence[0]?.payload as { load_failed?: boolean } | undefined)?.load_failed) {
        return { status: "unavailable", answer: "I couldn't load the details you gave earlier just now, so I haven't changed anything. Please try again in a moment.", presentation_policy: resultPresentation("text") };
      }
      const message = text(context.input.message);
      const corrected = correctedPublicFacts(prior, message);
      if (prior && corrected) {
        const changes = changesBetween(prior, corrected);
        const updated = { ...prior, known_facts: corrected, current_subject: corrected.location || prior.current_subject, updated_at: new Date().toISOString(), turns: prior.turns + 1, last_changes: changes };
        return { status: "answered", answer: `${changes.length ? describeChanges(changes, prior.known_facts, corrected) : "I have replaced the earlier detail with your correction. These remain details supplied by you, not independently verified."} ${composeJvRequirementsAnswer(updated)}`,
          presentation_policy: resultPresentation("text"), metadata: { public_opportunity_objective: updated } };
      }

      // General informational JV question, asked ad hoc -- governed
      // static content, regardless of whether a qualification objective
      // is active. Never requires or restarts one.
      if (isGeneralJvInfoQuestion(message)) {
        const answer = await canonicalCorporateAnswer("backend:corporate-jv-structure", CORPORATE_JV_STRUCTURE_FALLBACK);
        return { status: "answered", answer, presentation_policy: resultPresentation("text") };
      }

      // IQ-9A5: asks that are NOT a callback request (email me a summary, book a call, withdraw a callback, what can you do to connect me, which structure is best,
      // has it been passed on) are answered from the held facts and the thread's action records; they never trigger a handoff to the team.
      const callbackAsk = isCallbackRequest(message);
      const sf = context.resolvedTurn.semantic_frame;
      if (!callbackAsk && sf.answerTarget) {
        const held = prior && Object.keys(prior.known_facts).length ? Object.fromEntries(Object.entries(prior.known_facts).map(([k, v]) => [k, String(v)])) : null;
        const direct = publicFallbackAnswer(sf.answerTarget, { surface: "public_corporate", raw: message, truth: await threadActionTruth(text(context.input.thread_id)), pending_approval: false, held_facts: held, constraints: prior?.constraints || [] });
        if (direct) return { status: "answered", answer: direct.answer, presentation_policy: resultPresentation("text"), metadata: { public_opportunity_objective: direct.key.endsWith("public_callback_withdrawn") && prior ? mergeObjective(prior, message, new Date().toISOString()) : prior, answer_target: sf.answerTarget.response_intent, public_direct_answer: direct.key } };
      }

      // IQ-9A2: the canonical answer target recognises natural callback wording ("Call me back.") that this module's own regex does not.
      if (callbackAsk || (context.resolvedTurn.semantic_frame.answerTarget?.confirmation_kind === "callback" && /\b(?:call|ring|phone|contact|reach)\b/i.test(message) && !/\b(?:e-?mail|send)\b/i.test(message))) {
        // IQ-9A8: facts and contact preferences stated in the same message are recorded before the request is handled
        const merged = mergeObjective(prior, message, new Date().toISOString());
        const stated = Object.keys(merged.known_facts).some(k => merged.known_facts[k] !== prior?.known_facts?.[k]) || merged.constraints.some(c => !(prior?.constraints || []).includes(c));
        const working = stated ? merged : prior;
        if (working?.constraints.includes("no_phone_contact") && /\b(?:call|ring|phone)\b/i.test(message)) {
          // an earlier "do not call me" is respected: no handoff is made until the caller says how they want to be reached
          return { status: "answered", answer: "You told me not to contact you by phone, so I haven't passed a callback request to the team. Tell me how you'd like to be reached instead (email or WhatsApp), or say you do want a phone call after all. That preference is a note for this conversation only; I haven't stored it as a standing rule.", presentation_policy: resultPresentation("text"), metadata: { public_opportunity_objective: working, handoff_stage: "not_attempted_contact_preference", contact_completed: false } };
        }
        const { status, answer, metadata } = await composeCallbackAnswer(context, working);
        // A callback request doesn't change the objective -- preserve it
        // verbatim rather than letting persistence's undefined-fallback
        // reload path run twice.
        return { status, answer, presentation_policy: resultPresentation("text"), metadata: { ...metadata, public_opportunity_objective: working } };
      }

      // Existing bounded qualification assessment; no company commitment,
      // new evidence source, provider call or autonomous goal. Caller facts
      // remain caller-supplied, not verified title/financing evidence.
      if (prior && context.resolvedTurn.semantic_frame.cognitiveObjective === "reassess") {
        const last = prior.last_changes || [];
        const lead = last.length ? `Yes, what you last told me changed the picture: ${describeChanges(last, Object.fromEntries(Object.entries(prior.known_facts).map(([k, v]) => [k, last.find(c => c.field === k)?.from ?? v]).filter(([k]) => !last.some(c => c.field === k && c.from === null))), prior.known_facts)}`
          : "No: nothing you have told me has changed since I last summarised it, so the first-look picture stands.";
        const requirements = prior.objective_type === "development_partnership" ? composeJvRequirementsAnswer(prior) : composeGenericRequirementsAnswer(prior);
        return { status: "answered", answer: `${lead} Based on what you've told me, not independent verification: ${requirements} This is preliminary qualification, not a commitment by Ochiga to proceed.`, presentation_policy: resultPresentation("text"), metadata: { public_opportunity_objective: prior } };
      }
      if (prior && (isAssessmentObjective(context.resolvedTurn.semantic_frame.cognitiveObjective) || context.resolvedTurn.semantic_frame.cognitiveObjective === "summarize")) {
        const requirements = prior.objective_type === "development_partnership"
          ? composeJvRequirementsAnswer(prior) : composeGenericRequirementsAnswer(prior);
        const leadOne = targetedPublicLead(prior, context.resolvedTurn.semantic_frame.answerTarget, message);
        const leadMany = (context.resolvedTurn.semantic_frame.answerTarget?.clauses || []).map(c => targetedPublicLead(prior, c.target, c.text)).filter((x): x is string => Boolean(x));
        const lead = leadMany.length >= 2 ? [...new Set(leadMany)].join("\n\n") : leadOne;
        return { status: "answered", answer: `${lead ? `${lead}\n\nSupporting detail: ` : ""}Based on what you've told me, not independent verification: ${requirements} This is preliminary qualification, not a commitment by Ochiga to proceed.`,
          presentation_policy: resultPresentation("text"), metadata: { public_opportunity_objective: prior } };
      }

      if (isRequirementsCheck(message)) {
        if (!prior) {
          return {
            status: "answered",
            answer: "I don't have any opportunity details from you yet -- could you tell me a bit about it first?",
            presentation_policy: resultPresentation("text"),
          };
        }
        const answer0 = prior.objective_type === "development_partnership" ? composeJvRequirementsAnswer(prior) : composeGenericRequirementsAnswer(prior);
        const leadSingle = targetedPublicLead(prior, context.resolvedTurn.semantic_frame.answerTarget, message);
        const leadsMany = (context.resolvedTurn.semantic_frame.answerTarget?.clauses || []).map(c => targetedPublicLead(prior, c.target, c.text)).filter((x): x is string => Boolean(x));
        const lead0 = leadsMany.length >= 2 ? [...new Set(leadsMany)].join("\n\n") : leadSingle;
        const answer = lead0 ? `${lead0}\n\nSupporting detail: ${answer0}` : answer0;
        return { status: "answered", answer, presentation_policy: resultPresentation("text"), metadata: { public_opportunity_objective: prior } };
      }

      // IQ-8: a QUESTION about what is held / needed / possible is answered as such, never acknowledged as if it were a new fact.
      // a turn that SUPPLIES a new fact and does not ask anything ("I want a JV.") is a fact update, never a question about what is held
      const suppliesFact = Boolean(prior) && (() => { const next = mergeObjective(prior, message, new Date().toISOString()).known_facts; return Object.keys(next).some((k) => next[k] !== prior!.known_facts[k]); })() && !/\?/.test(message) && !/^\s*(?:what|which|who|how|do|does|did|can|could|is|are|have|has|tell|show|list)\b/i.test(message);
      if (prior && !suppliesFact) {
        const askedSingle = targetedPublicLead(prior, context.resolvedTurn.semantic_frame.answerTarget, message);
        // IQ-9A7: several held-fact questions in one turn ("what have you got from me, and what do you still need?") are each answered, in order
        const clauseLeads = (context.resolvedTurn.semantic_frame.answerTarget?.clauses || []).map(c => targetedPublicLead(prior, c.target, c.text)).filter((x): x is string => Boolean(x));
        const asked = clauseLeads.length >= 2 ? [...new Set(clauseLeads)].join("\n\n") : askedSingle;
        if (asked) {
          const supporting = prior.objective_type === "development_partnership" ? composeJvRequirementsAnswer(prior) : composeGenericRequirementsAnswer(prior);
          return { status: "answered", answer: `${asked}\n\nSupporting detail: ${supporting}`, presentation_policy: resultPresentation("text"), metadata: { public_opportunity_objective: prior } };
        }
      }
      // Otherwise: this turn supplies or updates a fact. Merge and
      // acknowledge without re-asking for anything already known.
      const updated = mergeObjective(prior, message, new Date().toISOString());
      // IQ-9A6: a turn that both supplies facts and asks what is held / missing gets the facts recorded AND the question answered from what is now held
      const nowLeads = (context.resolvedTurn.semantic_frame.answerTarget?.clauses || []).map(c => targetedPublicLead(updated, c.target, c.text)).filter((x): x is string => Boolean(x));
      const askedNow = /\?/.test(message) ? (nowLeads.length >= 2 ? [...new Set(nowLeads)].join("\n\n") : targetedPublicLead(updated, context.resolvedTurn.semantic_frame.answerTarget, message)) : null;
      if (askedNow) {
        const supportingNow = updated.objective_type === "development_partnership" ? composeJvRequirementsAnswer(updated) : composeGenericRequirementsAnswer(updated);
        return { status: "answered", answer: `${composeAcknowledgement(prior, updated)}\n\n${askedNow}\n\nSupporting detail: ${supportingNow}`, presentation_policy: resultPresentation("text"), metadata: { public_opportunity_objective: updated } };
      }
      return {
        status: "answered",
        answer: composeAcknowledgement(prior, updated),
        presentation_policy: resultPresentation("text"),
        metadata: { public_opportunity_objective: updated },
      };
    },
    primary: "text",
  });
}
