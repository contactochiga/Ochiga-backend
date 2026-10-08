import type { CognitiveObjective, SemanticFrame, SemanticConstraint, SemanticEntity, SemanticOperation } from "../contracts/semanticFrame";
import { type OyiDomain, isBusinessDomain } from "../runtime/languageUnderstanding";
import { normalizeLanguage } from "./LanguageNormalizer";
import { resolveReferences } from "./ReferenceResolver";
import { resolveTemporalScope } from "./TemporalResolver";
import { resolveConcepts, reconcileDomain } from "./conceptBridge";
import { deriveAnswerTarget, hasWithdrawalVerb } from "../response/answerTarget";
import { analyse, isCallbackRequest, isHoldDirective, isCancellationText, isCapabilityInquiryText, objectiveOf } from "./semanticObjective";

const ROOM_PATTERN = /\b(Bedroom(?:\s*\d+)?|living room|master bedroom|kitchen|bathroom|study|room\s+\d+)\b/i;
const DEVICE_PATTERN = /\b([A-Za-z0-9' -]+?(?:light|switch|socket|plug|tv|air conditioner|ac|camera|channel\s*\d+))\b/i;

// IQ-7: capability discovery, cognitive objective and cancellation are recognised COMPOSITIONALLY by semanticObjective.ts (speech act +
// single-word semantic signals + structure). This file remains the one canonical parser; the helper is not a second parser.
export function isCapabilityInquiry(text: string): boolean {
  return isCapabilityInquiryText(text);
}

export function cognitiveObjectiveFor(text: string, opts: { activeAssessment?: boolean } = {}): CognitiveObjective | null {
  if (isCancellationUtterance(text) || isCapabilityInquiry(text)) return null;
  return objectiveOf(text, opts);
}

// Shared by interpretation and device workflow continuation: a negated or withdrawn instruction must never become a positive command while
// cancellation fails to recognize it. This is an intent veto, not an execution permission.
export function isCancellationUtterance(message: unknown): boolean {
  const text = String(message ?? "").trim();
  if (isCancellationText(text)) return true;
  // IQ-9A: an explicit withdrawal ("scratch that, leave the light as it is") is a cancellation even when the sentence carries domain words; a negated
  // preference or a correction that introduces a new proposition ("forget the JV, I'm thinking sale") is not (see deriveAnswerTarget).
  return hasWithdrawalVerb(text) && deriveAnswerTarget(text).confirmation_kind === "cancel";
}

function deviceOperation(text: string): SemanticOperation | null {
  if (/\bturn\s+on|switch\s+on\b/i.test(text)) return "device.power.on";
  if (/\bturn\s+off|switch\s+off\b/i.test(text)) return "device.power.off";
  // a leading kill / shut off / cut imperative aimed at a device is a power-off request
  if (/^\s*(?:please\s+)?(?:kill|cut|shut(?:\s+(?:off|down))?)\b[^.!?]{0,60}\b(?:devices?|lights?|lamps?|switch(?:es)?|sockets?|plugs?|tv|ac|air conditioner|fans?|heater)\b/i.test(text)) return "device.power.off";
  // Natural target-first imperatives ("turn the second device off") are
  // still mutations, not device availability reads or ordinal drill-downs.
  if (/\b(?:turn|switch)\b[^.!?]{0,80}\b(?:device|light|switch|socket|plug|tv|ac|air conditioner|it|one)\b[^.!?]{0,80}\boff\b/i.test(text)) return "device.power.off";
  if (/\b(?:turn|switch)\b[^.!?]{0,80}\b(?:device|light|switch|socket|plug|tv|ac|air conditioner|it|one)\b[^.!?]{0,80}\bon\b/i.test(text)) return "device.power.on";
  if (/\bdevices?\b.*\b(offline|online|available|availability|unavailable|down)\b|\b(offline|online|available|availability|unavailable|down)\b.*\bdevices?\b/i.test(text)) return "device.availability";
  if (/\bshow\b.*\bactivity\b/i.test(text)) return "device.activity";
  if (/\bshow\b.*\b(failures|failed|faults)\b/i.test(text)) return "device.failures";
  if (/\bdiagnose|why\b/i.test(text)) return "device.diagnosis";
  if (/\brelationships|related\b/i.test(text)) return "device.relationships";
  // a bare "status" names a device only when no other record noun is in the question ("status of VI Development" asks about a project)
  if (/\bis\b.*\bon\b|\bworking\b/i.test(text) || (/\bstatus\b/i.test(text) && !/\b(?:project|development|opportunit\w*|leads?|reports?|tasks?|meetings?|requests?|incidents?|visitors?|wallet|transactions?|deal)\b/i.test(text))) return "device.status";
  return null;
}

function operationFor(text: string, fallback: string): SemanticOperation {
  if (isCancellationUtterance(text)) return "cancel";
  const device = deviceOperation(text);
  if (device) return device;
  if (/\b(wallet|transactions?)\b.*\b(history|transactions?|recent)\b|\bshow wallet history\b|\brecent transactions?\b/i.test(text)) return "wallet.history";
  if (/\butilities?\b.*\b(active|enabled|connected|available|on)\b|\bwhich utilities?\b.*\b(active|enabled|connected|available|on)\b/i.test(text)) return "utilities.active";
  if (/\butilities?\b.*\b(usage|use|consumption|used)\b|\b(electricity|power|water|internet|gas)\b.*\b(usage|use|consumption|used)\b/i.test(text)) return "utilities.usage";
  if (/\b(meter|utility)\b.*\b(balance|credit)\b|\b(balance|credit)\b.*\b(meter|utility)\b/i.test(text)) return "utilities.balance";
  if (/\bmeter\b/i.test(text)) return "utilities.meter";
  if (/\butilities?\b.*\b(spent|spend|spending|cost|costs?|paid|payment)\b|\b(how much|spend|spent|spending|cost|costs?|paid)\b.*\b(utilities?|electricity|power|water|internet|gas)\b/i.test(text)) return "utilities.spending";
  // A bare spending question with no utility keyword ("What did I spend
  // this week?") is a wallet question by default -- the utilities.spending
  // branch above already wins whenever a utility keyword IS present, so
  // this generic fallback only ever fires once that's been ruled out.
  if (/\b(?:what did i|how much (?:did i|have i))\b[^.!?]{0,20}\b(?:spend|spent|pay|paid)\b/i.test(text)) return "wallet.history";
  return fallback as SemanticOperation;
}

function domainFor(text: string, normalizedDomain: OyiDomain | null, operation: SemanticOperation): OyiDomain | null {
  // classifyDomain (languageUnderstanding.ts) deliberately checks office/
  // corporate business phrasing before any Consumer/Facility smart-home
  // pattern, specifically so office_internal/public_corporate questions
  // never get stolen by generic branches like "reports" or "home" -- but
  // that ordering only protects against classifyDomain's OWN later
  // branches. This function's device/wallet/utilities operation heuristic
  // is a separate, independent override that ran unconditionally, so a
  // business question that happened to also contain device-operation
  // vocabulary (e.g. "how many devices are online in this portfolio?" --
  // "devices...online" reads as device.availability) would silently be
  // reclassified as "devices" and lose its already-correct business
  // domain entirely. Caught via live capabilityService.resolve() testing
  // during the Portfolio capability's regression pass, not by capability-
  // level tests (which call buildReadResponse directly and never exercise
  // this classifier at all) -- a caution for testing every future domain
  // the same way. Once classifyDomain has already resolved one of these
  // domains, nothing here should be allowed to override it.
  if (isBusinessDomain(normalizedDomain)) return normalizedDomain;
  // an operation inferred from a generic word ("status", "position") never overrides a domain the text names explicitly, unless a device is named
  if (operation.startsWith("device.") && (!normalizedDomain || operation.startsWith("device.power") || /\b(?:devices?|lights?|switch(?:es)?|sockets?|plugs?|tv|ac|air conditioner|thermostats?|sensors?|locks?|channel\s*\d+|heater|fan)\b/i.test(text))) return "devices";
  if (operation.startsWith("wallet.")) return "wallet";
  if (operation.startsWith("utilities.")) return "utilities";
  if (/\b(devices?|light|switch|socket|plug|tv|air conditioner|ac|channel\s*\d+)\b/i.test(text)) return "devices";
  return normalizedDomain;
}

function entityFor(text: string, domain: OyiDomain | null): SemanticEntity | null {
  if (domain === "devices") {
    const device = text.match(DEVICE_PATTERN)?.[0] || (/\b(light|switch|socket|plug|tv|ac)\b/i.test(text) ? RegExp.lastMatch : "");
    if (device) return { type: "device", text: device, normalizedText: device.replace(/\s+/g, " ").trim(), confidence: 0.82 };
  }
  if (domain === "rooms") {
    const room = text.match(ROOM_PATTERN)?.[0];
    if (room) return { type: "room", text: room, normalizedText: room.replace(/\s+/g, " ").trim(), confidence: 0.88 };
  }
  if (domain === "wallet") return { type: "wallet", text: "wallet", normalizedText: "wallet", confidence: 0.9 };
  if (domain === "utilities") return { type: "utility", text: "utilities", normalizedText: "utilities", confidence: 0.84 };
  return null;
}

function constraintsFor(text: string, domain: OyiDomain | null): SemanticConstraint[] {
  const constraints: SemanticConstraint[] = [];
  const room = text.match(ROOM_PATTERN)?.[0];
  if (room && domain !== "rooms") {
    constraints.push({ type: "room", text: room, normalizedText: room.replace(/\s+/g, " ").trim(), confidence: 0.88 });
  }
  const channel = text.match(/\bchannel\s*\d+\b/i)?.[0];
  if (channel) constraints.push({ type: "channel", text: channel, normalizedText: channel.replace(/\s+/g, " ").trim(), confidence: 0.9 });
  return constraints;
}

export function parseSemanticFrame(rawText: unknown, opts: { activeAssessment?: boolean; surface?: string } = {}): SemanticFrame {
  const normalized = normalizeLanguage(rawText);
  // Explicit self-correction names the intended scope; rejected vocabulary
  // earlier in the same turn must not win lexical domain precedence.
  const correctedScope = normalized.normalized_text.match(/\b(?:i mean|i meant)\s+(.+)$/i)?.[1];
  const intended = correctedScope ? normalizeLanguage(correctedScope) : normalized;
  const cognitiveObjective = cognitiveObjectiveFor(normalized.normalized_text, opts);
  // A generic "why" is not device diagnosis. Explicit device questions still
  // use the existing device worker; objective metadata does not choose it.
  const genericExplanation = cognitiveObjective === "explain" && !/\b(devices?|light|switch|socket|plug|tv|air conditioner|ac)\b/i.test(normalized.normalized_text);
  const parsedOperation = genericExplanation ? normalized.operation as SemanticOperation : operationFor(normalized.normalized_text, normalized.operation);
  // Hypothetical/advisory questions about an action are not commands. They
  // may discuss a device without creating a confirmable power proposal.
  const advisory = cognitiveObjective !== null && !["retrieve", "summarize"].includes(cognitiveObjective);
  const meaningCorrection = /\bnot what i (?:mean|meant)\b/i.test(normalized.normalized_text);
  // Existential absence is evidence, not a rejection/confirmation command.
  // Keep imperative cancellation and compound instructions on their existing
  // governed path; this only removes authority from a declarative statement.
  const absenceStatement = /^there\s+(?:is|are|was|were)\s+no\b[^;?!]*[.!]?$/i.test(normalized.normalized_text)
    && !/\b(?:then|please|confirm|execute|send|turn|approve|cancel)\b/i.test(normalized.normalized_text);
  const operation = absenceStatement ? "inform" : meaningCorrection ? "clarify" : /\b(?:draft|compose)\b/i.test(normalized.normalized_text) && cognitiveObjective ? "compose" : advisory && parsedOperation.startsWith("device.power.") ? "inform"
    : /\b(?:show|list)\b.*\b(?:spent|spending)\b/i.test(normalized.normalized_text) && !/\b(?:utilities|electricity|water)\b/i.test(normalized.normalized_text) ? "wallet.history" : parsedOperation;
  const domainCandidate = /\bwho\b.*\b(?:expected|coming)\b/i.test(normalized.normalized_text) ? "visitors"
    : domainFor(intended.normalized_text, intended.domain, operation)
    || (correctedScope && /\bdevelopments?\b/i.test(correctedScope) ? "corporate_development" : null);
  const concepts = resolveConcepts(normalized.normalized_text);
  // the concept view (consumption vs spending) decides a utilities operation the lexical regexes could not tell apart
  const operationFinal0: SemanticOperation = operation.startsWith("utilities.") && concepts.facet === "usage" ? "utilities.usage" : operation;
  // Office: a question about a named development project belongs to the development records when no other domain was named (public conversations keep their own routing)
  const domain = reconcileDomain(domainCandidate, concepts, normalized.normalized_text) ?? (opts.surface === "office_internal" && concepts.head_domain === "office_development" && /\b(?:status|tell me about|how is|how's|update on|progress)\b/i.test(normalized.normalized_text) ? ("office_development" as const) : null);
  const primaryEntity = entityFor(normalized.normalized_text, domain);
  const constraints = constraintsFor(normalized.normalized_text, domain);
  // Safety: an utterance that carries a withdrawal or negation marker never keeps executable intent (ambiguity clarifies, it does not execute).
  const holdOrCallback = isHoldDirective(normalized.raw_text) || isCallbackRequest(normalized.raw_text);
  const withdrawalMarked = analyse(normalized.normalized_text).tokens.some(t => ["no", "nope", "nah", "not", "never", "forget", "scrap", "cancel", "abort", "undo", "nevermind"].includes(t));
  // IQ-8D3: the ONE answer target is derived here, before the frame is assembled, so the frame's own mutation intent can honour it: a past-tense
  // question about what was done ("did you switch it off?") asks for the truth of an action, it is never a command to perform it.
  const answerTarget = deriveAnswerTarget(normalized.raw_text, { objective: cognitiveObjective, activeAssessment: opts.activeAssessment, surface: opts.surface, ambiguity: { required: false, reason: null }, pronounRef: resolveReferences(normalized.normalized_text).some((r) => r.kind === "pronoun") });
  // a past-tense question about what was done ("did you switch it off?") never keeps a command operation: it must not select a control capability
  const operationFinal: SemanticOperation = answerTarget.response_intent === "ACTION_RESULT" && /^(?:device\.power|approve|reject|compose)/.test(operationFinal0) ? "inform" : operationFinal0;
  return {
    rawText: normalized.raw_text,
    concepts,
    normalizedText: normalized.normalized_text,
    operation: operationFinal,
    domain,
    primaryEntity,
    constraints,
    temporalScope: resolveTemporalScope(normalized.normalized_text),
    references: resolveReferences(normalized.normalized_text),
    confidence: primaryEntity ? Math.max(0.75, primaryEntity.confidence) : 0.72,
    ambiguity: { required: false, reason: null, candidates: [] },
    corrections: normalized.corrections,
    mutationIntent: answerTarget.response_intent !== "ACTION_RESULT" && !withdrawalMarked && !holdOrCallback && !absenceStatement && !meaningCorrection && !advisory && cognitiveObjective !== "summarize" && operation !== "cancel" && (normalized.mutation_intent || operation.startsWith("device.power.")),
    cognitiveObjective,
    capabilityInquiry: isCapabilityInquiry(normalized.normalized_text),
    // IQ-8D: derived ONCE, here, and carried on the frame; no downstream layer derives it again
    answerTarget,
  };
}
