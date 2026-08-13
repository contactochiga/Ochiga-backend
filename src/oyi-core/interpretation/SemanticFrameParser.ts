import type { SemanticFrame, SemanticConstraint, SemanticEntity, SemanticOperation } from "../contracts/semanticFrame";
import type { OyiDomain } from "../runtime/languageUnderstanding";
import { normalizeLanguage } from "./LanguageNormalizer";
import { resolveReferences } from "./ReferenceResolver";
import { resolveTemporalScope } from "./TemporalResolver";

const ROOM_PATTERN = /\b(Bedroom\s*\d+|living room|master bedroom|kitchen|bathroom|room\s+\d+)\b/i;
const DEVICE_PATTERN = /\b([A-Za-z0-9' -]+?(?:light|switch|socket|plug|tv|air conditioner|ac|camera|channel\s*\d+))\b/i;

function deviceOperation(text: string): SemanticOperation | null {
  if (/\bturn\s+on|switch\s+on\b/i.test(text)) return "device.power.on";
  if (/\bturn\s+off|switch\s+off\b/i.test(text)) return "device.power.off";
  if (/\bshow\b.*\bactivity\b/i.test(text)) return "device.activity";
  if (/\bshow\b.*\b(failures|failed|faults)\b/i.test(text)) return "device.failures";
  if (/\bdiagnose|why\b/i.test(text)) return "device.diagnosis";
  if (/\brelationships|related\b/i.test(text)) return "device.relationships";
  if (/\bis\b.*\bon\b|\bstatus\b|\bworking\b/i.test(text)) return "device.status";
  return null;
}

function operationFor(text: string, fallback: string): SemanticOperation {
  const device = deviceOperation(text);
  if (device) return device;
  if (/\b(wallet|transactions?)\b.*\b(history|transactions?|recent)\b|\bshow wallet history\b|\brecent transactions?\b/i.test(text)) return "wallet.history";
  if (/\butilities?\b.*\b(active|enabled|connected|available|on)\b|\bwhich utilities?\b.*\b(active|enabled|connected|available|on)\b/i.test(text)) return "utilities.active";
  if (/\butilities?\b.*\b(usage|use|consumption|used)\b|\b(electricity|power|water|internet|gas)\b.*\b(usage|use|consumption|used)\b/i.test(text)) return "utilities.usage";
  if (/\b(meter|utility)\b.*\b(balance|credit)\b|\b(balance|credit)\b.*\b(meter|utility)\b/i.test(text)) return "utilities.balance";
  if (/\bmeter\b/i.test(text)) return "utilities.meter";
  if (/\butilities?\b.*\b(spent|spend|spending|cost|costs?|paid|payment)\b|\b(how much|spend|spent|spending|cost|costs?|paid)\b.*\b(utilities?|electricity|power|water|internet|gas)\b/i.test(text)) return "utilities.spending";
  return fallback as SemanticOperation;
}

function domainFor(text: string, normalizedDomain: OyiDomain | null, operation: SemanticOperation): OyiDomain | null {
  if (operation.startsWith("device.")) return "devices";
  if (operation.startsWith("wallet.")) return "wallet";
  if (operation.startsWith("utilities.")) return "utilities";
  if (/\b(light|switch|socket|plug|tv|air conditioner|ac|channel\s*\d+)\b/i.test(text)) return "devices";
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
  const operation = operationFor(normalized.normalized_text, normalized.operation);
  const domain = domainFor(normalized.normalized_text, normalized.domain, operation);
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
    mutationIntent: normalized.mutation_intent || operation.startsWith("device.power."),
  };
}
