import type { CognitiveObjective, SemanticFrame, SemanticConstraint, SemanticEntity, SemanticOperation } from "../contracts/semanticFrame";
import { type OyiDomain, isBusinessDomain } from "../runtime/languageUnderstanding";
import { normalizeLanguage } from "./LanguageNormalizer";
import { resolveReferences } from "./ReferenceResolver";
import { resolveTemporalScope } from "./TemporalResolver";

const ROOM_PATTERN = /\b(Bedroom(?:\s*\d+)?|living room|master bedroom|kitchen|bathroom|study|room\s+\d+)\b/i;
const DEVICE_PATTERN = /\b([A-Za-z0-9' -]+?(?:light|switch|socket|plug|tv|air conditioner|ac|camera|channel\s*\d+))\b/i;

export function isCapabilityInquiry(text: string): boolean {
  return /\bwhat (?:can|could) (?:you|oyi|oma|osa) (?:do|help|access)\b|\bwhat (?:actions|capabilities|tools) (?:can|do)\b/i.test(text);
}

// This is part of the existing parser, not a second intent router. These
// question forms are independent of domain vocabulary and never grant action.
export function cognitiveObjectiveFor(text: string): CognitiveObjective | null {
  if (isCancellationUtterance(text) || isCapabilityInquiry(text)) return null;
  // Grammatical families precede incidental domain words. A question about
  // a recommendation is not an instruction to perform its referenced action.
  if (!/\b(?:do not|don't)\s+change\b/i.test(text) && /\b(?:still|change|changed|changes|alter|affect|given that)\b/i.test(text)
    && /\b(?:view|priority|prioritize|recommendation|assessment|reasoning|explanation|anything|decision|ranking|do that|what now|come first)\b/i.test(text)) return "reassess";
  if (/^\s*(?:why\b|how come\b)/i.test(text)) return "explain";
  if (/\b(?:compare|trade[- ]?offs?|more important|rather than|versus)\b|\bwhich\b.*\bbetter\b|\b(?:would|could|is|does)\b.*\b(?:different|differ)\b/i.test(text)) return "compare";
  if (/\b(?:which|what)\b.*\b(?:discussing|did i.*correct)\b/i.test(text)) return "explain";
  if (/\b(?:which|what)\b.*\b(?:choose|come first|worth pursuing|most useful|most important|order of work)\b|\b(?:give|offer)\b.*\border of work\b|\bmatters? most\b/i.test(text)) return "prioritize";
  if (/\b(?:summari[sz]e|summary|handover|decision brief|short version)\b/i.test(text)) return "summarize";
  if (/\b(?:draft|compose)\b|\b(?:turn|put)\b.*\binto\b.*\b(?:recommendation|brief|summary)\b/i.test(text)) return "advise";
  if (/\b(?:recommend|suggest|advise|delegate|delegated|next step|next move|next action)\b|\b(?:offer|give)\b.*\b(?:safe way|reason)\b/i.test(text)) return "advise";
  // Evidence audits, epistemic constraints and implicit routine assessment.
  if (/\b(?:do|does|can|could|have|has|is|are)\b.*\b(?:know|known|observe|verify|confirmed|baseline|scope|conclude|evidence|reading|arrived|physically changed)\b/i.test(text)
    || /\b(?:which|what)\b.*\b(?:information|missing|unknown|known|uncertainty|actually tell|say estate|deserves? attention|care about)\b/i.test(text)
    || /\b(?:do not|don't|separate)\b.*\b(?:invent|claim|report|promise|observed|uncertainty)\b/i.test(text)
    || /\bask me before\b|\b(?:too hot|too cold|feels? (?:hot|cold|unsafe))\b|\bwhich\b.*\bcausing\b/i.test(text)
    || /\b(?:i am|i'm)\s+(?:going to bed|leaving (?:the )?home)\b/i.test(text)
    || /\b(?:is|are|should)\b.*\b(?:worth|secure|safe|okay|ok|worry|important|still open)\b/i.test(text)
    || /\b(?:what matters|anything important|what do you think|what'?s your view|what is your view)\b/i.test(text)) return "assess";
  if (/\bwho\b.*\b(?:expected|coming|owns?|own the work)\b|\bwhich room\b.*\bdiscuss/i.test(text)) return "retrieve";
  if (/\b(?:can|could|would|should)\s+(?:we|i|you)\b.*\b(?:pursue|proceed|promise|commit|investigate)\b/i.test(text)) return "advise";
  if (/^\s*would you (?:please )?(?:turn|switch)\b.*\b(?:on|off)\b/i.test(text)) return null;
  if (/^(?:please\s+)?(?:show|list|find|get|open|inspect)\b/i.test(text)) return "retrieve";
  if (/\b(?:recommendation|priority|assessment|reasoning)\b.*\bchange[ds]?\b|\bwhat changed in\b/i.test(text)) return "reassess";
  if (/^\s*explain\b/i.test(text)) return "explain";
  if (/\bwhat (?:has )?changed\b/i.test(text)) return "compare";
  if (/\b(?:what|which)\b.*\bcan (?:safely )?wait\b|\bwhich\b.*\b(?:worth pursuing|blocks? progress|come first)\b/i.test(text)) return "prioritize";
  if (/^\s*(?:would|should)\s+(?:you|we|i|turning|changing)\b|\bwhat\b[^.!?]{0,40}\b(?:should|would)\b|\bjust advise\b/i.test(text)) return "advise";
  if (/\b(?:does|is|can|do)\b.*\b(?:prove|mean broken|actually verify|actually know|need to worry|enough to)\b|\bwhat (?:is|remains) (?:known|unknown|unresolved)\b|\b(?:what|which) evidence\b/i.test(text)) return "assess";
  if (/\b(?:does|would|will|should|has)\b.*\b(?:change|alter|affect)\b.*\b(?:priority|recommendation|assessment|anything|decision|ranking)\b|\bstill (?:your|the|a) (?:priority|recommendation)\b|\breassess\b/i.test(text)) return "reassess";
  if (/^\s*why\b|\bexplain (?:why|your|that|the reasoning)\b/i.test(text)) return "explain";
  if (/\bcompare\b|\btrade[- ]?offs?\b|\bwhich\b.*\b(?:better|versus|rather than)\b/i.test(text)) return "compare";
  if (/\b(?:matter|matters) most\b|\b(?:attention|deal with|focus on) first\b|\b(?:what|which)\b.*\b(?:priorit|priority|priorities|most important|biggest blocker|can wait|deserves? my time)\b|\bwhich\b.*\b(?:three|3|top)\b.*\b(?:things|priorities|matter|move|focus)\b/i.test(text)) return "prioritize";
  if (/\bwhat (?:would|should) (?:you|i|we|the facility manager) do\b|\bwhat should (?:i|we)\b|\bnext (?:move|step)\b|\bwhat can i delegate\b|\bwhat would you recommend\b/i.test(text)) return "advise";
  if (/\b(?:needs?|needing|deserves?) (?:my |our |immediate )?attention\b|\bwhat (?:actually )?matters\b|\bis (?:everything|this|that|it) (?:okay|ok|safe|a strong|a good)\b|\banything (?:wrong|dangerous|unusual|i should)\b|\bshould i (?:worry|be concerned)\b|\b(?:would|could) ochiga (?:pursue|consider)\b|\bdoes this sound\b|\bwhat (?:are we neglecting|can move)\b/i.test(text)) return "assess";
  if (/\b(?:summari[sz]e|summary|short version|overview)\b/i.test(text)) return "summarize";
  if (/^(?:please\s+)?(?:show|list|find|get|open)\b/i.test(text)) return "retrieve";
  return null;
}

// Shared by interpretation and device workflow continuation: a negated power
// instruction must never become a positive command while cancellation fails
// to recognize it. This is an intent veto, not an execution permission.
export function isCancellationUtterance(message: unknown): boolean {
  const text = String(message ?? "").trim().replace(/[’‘]/g, "'").replace(/^(?:(?:actually|please)[,\s]+)+/i, "");
  return /^(?:cancel(?:\s+(?:(?:any|the|this|that|my)\s+)?(?:pending\s+)?(?:proposal|action|command|request|draft))?|cancel\s+that|never\s?mind|no|(?:do\s+not|don'?t)(?:\s+(?:send|do)\s+(?:it|that))?|stop)\W*$/i.test(text)
    || /^(?:no[,\s]+)?(?:please\s+)?(?:do\s+not|don'?t|never)\s+(?:turn|switch)\b/i.test(text)
    || /^(?:do\s+not|don'?t)\s+(?:do|send)\s+(?:it|that)(?:[.;,!?]|$)/i.test(text);
}

function deviceOperation(text: string): SemanticOperation | null {
  if (/\bturn\s+on|switch\s+on\b/i.test(text)) return "device.power.on";
  if (/\bturn\s+off|switch\s+off\b/i.test(text)) return "device.power.off";
  // Natural target-first imperatives ("turn the second device off") are
  // still mutations, not device availability reads or ordinal drill-downs.
  if (/\b(?:turn|switch)\b[^.!?]{0,80}\b(?:device|light|switch|socket|plug|tv|ac|air conditioner|it|one)\b[^.!?]{0,80}\boff\b/i.test(text)) return "device.power.off";
  if (/\b(?:turn|switch)\b[^.!?]{0,80}\b(?:device|light|switch|socket|plug|tv|ac|air conditioner|it|one)\b[^.!?]{0,80}\bon\b/i.test(text)) return "device.power.on";
  if (/\bdevices?\b.*\b(offline|online|available|availability|unavailable|down)\b|\b(offline|online|available|availability|unavailable|down)\b.*\bdevices?\b/i.test(text)) return "device.availability";
  if (/\bshow\b.*\bactivity\b/i.test(text)) return "device.activity";
  if (/\bshow\b.*\b(failures|failed|faults)\b/i.test(text)) return "device.failures";
  if (/\bdiagnose|why\b/i.test(text)) return "device.diagnosis";
  if (/\brelationships|related\b/i.test(text)) return "device.relationships";
  if (/\bis\b.*\bon\b|\bstatus\b|\bworking\b/i.test(text)) return "device.status";
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
  if (operation.startsWith("device.")) return "devices";
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

export function parseSemanticFrame(rawText: unknown): SemanticFrame {
  const normalized = normalizeLanguage(rawText);
  // Explicit self-correction names the intended scope; rejected vocabulary
  // earlier in the same turn must not win lexical domain precedence.
  const correctedScope = normalized.normalized_text.match(/\b(?:i mean|i meant)\s+(.+)$/i)?.[1];
  const intended = correctedScope ? normalizeLanguage(correctedScope) : normalized;
  const cognitiveObjective = cognitiveObjectiveFor(normalized.normalized_text);
  // A generic "why" is not device diagnosis. Explicit device questions still
  // use the existing device worker; objective metadata does not choose it.
  const genericExplanation = cognitiveObjective === "explain" && !/\b(devices?|light|switch|socket|plug|tv|air conditioner|ac)\b/i.test(normalized.normalized_text);
  const parsedOperation = genericExplanation ? normalized.operation as SemanticOperation : operationFor(normalized.normalized_text, normalized.operation);
  // Hypothetical/advisory questions about an action are not commands. They
  // may discuss a device without creating a confirmable power proposal.
  const advisory = cognitiveObjective !== null && !["retrieve", "summarize"].includes(cognitiveObjective);
  const meaningCorrection = /\bnot what i (?:mean|meant)\b/i.test(normalized.normalized_text);
  const operation = meaningCorrection ? "clarify" : /\b(?:draft|compose)\b/i.test(normalized.normalized_text) && cognitiveObjective ? "compose" : advisory && parsedOperation.startsWith("device.power.") ? "inform"
    : /\b(?:show|list)\b.*\b(?:spent|spending)\b/i.test(normalized.normalized_text) && !/\b(?:utilities|electricity|water)\b/i.test(normalized.normalized_text) ? "wallet.history" : parsedOperation;
  const domain = /\bwho\b.*\b(?:expected|coming)\b/i.test(normalized.normalized_text) ? "visitors"
    : domainFor(intended.normalized_text, intended.domain, operation)
    || (correctedScope && /\bdevelopments?\b/i.test(correctedScope) ? "corporate_development" : null);
  const primaryEntity = entityFor(normalized.normalized_text, domain);
  const constraints = constraintsFor(normalized.normalized_text, domain);
  return {
    rawText: normalized.raw_text,
    normalizedText: normalized.normalized_text,
    operation,
    domain,
    primaryEntity,
    constraints,
    temporalScope: resolveTemporalScope(normalized.normalized_text),
    references: resolveReferences(normalized.normalized_text),
    confidence: primaryEntity ? Math.max(0.75, primaryEntity.confidence) : 0.72,
    ambiguity: { required: false, reason: null, candidates: [] },
    corrections: normalized.corrections,
    mutationIntent: !meaningCorrection && !advisory && cognitiveObjective !== "summarize" && operation !== "cancel" && (normalized.mutation_intent || operation.startsWith("device.power.")),
    cognitiveObjective,
    capabilityInquiry: isCapabilityInquiry(normalized.normalized_text),
  };
}
