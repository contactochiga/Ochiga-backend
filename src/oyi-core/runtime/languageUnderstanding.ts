export type OyiOperation =
  | "inform"
  | "summarize"
  | "list"
  | "inspect"
  | "navigate"
  | "compose"
  | "clarify"
  | "propose_mutation"
  | "approve"
  | "reject"
  | "cancel"
  | "execute";

export type OyiDomain =
  | "global"
  | "home"
  | "rooms"
  | "devices"
  | "visitors"
  | "access"
  | "security"
  | "maintenance"
  | "wallet"
  | "transactions"
  | "utilities"
  | "services"
  | "community"
  | "messages"
  | "scenes"
  | "automations"
  | "cameras"
  | "notifications"
  | "incidents";

export type ParsedEntity = {
  type: "room" | "device" | "visitor" | "wallet" | "service" | "message" | "scene" | "automation" | "camera" | "unknown";
  text: string;
  normalized_text: string;
  confidence: number;
};

export type TemporalScope = {
  mode: "current" | "recent" | "today" | "yesterday" | "current_month" | "range" | "history";
  from: string | null;
  to: string | null;
};

export type ReferenceExpression = {
  phrase: string;
  kind: "pronoun" | "same_target" | "other_candidate" | "current_object";
  confidence: number;
};

export type NormalizedUserTurn = {
  raw_text: string;
  normalized_text: string;
  corrections: Array<{ original: string; normalized: string; confidence: number }>;
  operation: OyiOperation;
  domain: OyiDomain | null;
  entities: ParsedEntity[];
  temporal_scope: TemporalScope | null;
  references: ReferenceExpression[];
  mutation_intent: boolean;
};

const LEXICAL_CORRECTIONS: Array<{ pattern: RegExp; original: string; normalized: string; confidence: number }> = [
  { pattern: /\bhistry\b/gi, original: "histry", normalized: "history", confidence: 0.98 },
  { pattern: /\btransation\b/gi, original: "transation", normalized: "transaction", confidence: 0.98 },
  { pattern: /\btransaction\s+s\b/gi, original: "transaction s", normalized: "transactions", confidence: 0.96 },
  { pattern: /\bcheek\s+first\b/gi, original: "cheek first", normalized: "check first", confidence: 0.92 },
  { pattern: /\bmaintainance\b/gi, original: "maintainance", normalized: "maintenance", confidence: 0.97 },
  { pattern: /\bvisiter\b/gi, original: "visiter", normalized: "visitor", confidence: 0.97 },
  { pattern: /\bwhat\s+can\s+u\s+do\b/gi, original: "what can u do", normalized: "what can you do", confidence: 0.95 },
  { pattern: /\bsitting\s+room\b/gi, original: "sitting room", normalized: "living room", confidence: 0.9 },
  { pattern: /\blounge\b/gi, original: "lounge", normalized: "living room", confidence: 0.9 },
  { pattern: /\broom\s+two\b/gi, original: "room two", normalized: "Bedroom 2", confidence: 0.82 },
  { pattern: /\bdues\b/gi, original: "dues", normalized: "building dues", confidence: 0.86 },
];

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function applyLexicalCorrections(raw: string) {
  let normalized = raw.replace(/\s+/g, " ").trim();
  const corrections: NormalizedUserTurn["corrections"] = [];
  for (const correction of LEXICAL_CORRECTIONS) {
    if (correction.pattern.test(normalized)) {
      normalized = normalized.replace(correction.pattern, correction.normalized);
      corrections.push({
        original: correction.original,
        normalized: correction.normalized,
        confidence: correction.confidence,
      });
    }
    correction.pattern.lastIndex = 0;
  }
  return { normalized, corrections };
}

function classifyOperation(text: string): OyiOperation {
  if (/\b(cancel|never mind|stop|start over)\b/i.test(text)) return "cancel";
  if (/\b(yes|confirm|approve|go ahead|submit|send it|create it|do it)\b/i.test(text)) return "approve";
  if (/\b(no|reject|don't|do not)\b/i.test(text)) return "reject";
  if (/\b(open|go to|take me to|view workspace)\b/i.test(text)) return "navigate";
  if (/\b(create|draft|prepare|compose|add|generate|make)\b/i.test(text)) return "compose";
  if (/\b(turn|switch|set|run|unlock|lock|fund|pay|buy|send|post|revoke|extend|pause|resume)\b/i.test(text)) return "propose_mutation";
  if (/\b(show|list|which|what are|history|transactions|visitors|requests|scenes|automations)\b/i.test(text)) return "list";
  if (/\b(what(?:'s| is) happening|summary|needs attention|check first|spent|spend|how much|changed today)\b/i.test(text)) return "summarize";
  if (/\b(is|are|status|working|healthy|diagnose|why|explain|detail|details)\b/i.test(text)) return "inspect";
  return "inform";
}

function classifyDomain(text: string): OyiDomain | null {
  if (/\bwhat can you do\b|\bhelp\b|\bcapabilit/i.test(text)) return "global";
  if (/\bhome|house|everything|what should i check|needs attention|changed today\b/i.test(text)) return "home";
  if (/\b(room|bedroom|living room|kitchen|bathroom|space)\b/i.test(text)) return "rooms";
  if (/\b(device|switch|light|socket|plug|tv|ac|air conditioner|camera status|offline devices|hardware|channel)\b/i.test(text)) return "devices";
  if (/\b(visitor|guest|pass)\b/i.test(text)) return "visitors";
  if (/\b(security|alarm|alert|gate|access denied|unusual access|incident|front door)\b/i.test(text)) return "security";
  if (/\b(access|unlock|lock|door|pin|card|fingerprint)\b/i.test(text)) return "access";
  if (/\bmaintenance|repair|technician|request|issue|overdue\b/i.test(text)) return "maintenance";
  if (/\butility|utilities|electricity|water|internet|gas|meter|token|tariff|dues|waste|solar|battery\b/i.test(text)) return "utilities";
  if (/\bwallet|balance|fund\b/i.test(text)) return "wallet";
  if (/\btransaction|receipt|ledger|spending|spent|paid\b/i.test(text)) return "transactions";
  if (/\bservice|services\b/i.test(text)) return "services";
  if (/\bcommunity|notice|management update|post|comment\b/i.test(text)) return "community";
  if (/\bmessage|messages|reply|thread|inbox|security message\b/i.test(text)) return "messages";
  if (/\bscene|scenes\b/i.test(text)) return "scenes";
  if (/\bautomation|automations|schedule|trigger\b/i.test(text)) return "automations";
  if (/\bcamera|cameras|motion|clip|live view|front-door\b/i.test(text)) return "cameras";
  if (/\bnotification|notifications|alert|alerts\b/i.test(text)) return "notifications";
  if (/\bincident|outage|fault|emergency\b/i.test(text)) return "incidents";
  return null;
}

function extractTemporalScope(text: string): TemporalScope | null {
  const now = new Date();
  if (/\bthis month|current month\b/i.test(text)) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    return { mode: "current_month", from, to: now.toISOString() };
  }
  if (/\btoday\b/i.test(text)) return { mode: "today", from: null, to: null };
  if (/\byesterday\b/i.test(text)) return { mode: "yesterday", from: null, to: null };
  if (/\brecent|recently|latest|last 30 days\b/i.test(text)) return { mode: "recent", from: null, to: null };
  if (/\bhistory|transactions|activity\b/i.test(text)) return { mode: "history", from: null, to: null };
  return null;
}

function extractReferences(text: string): ReferenceExpression[] {
  const refs: ReferenceExpression[] = [];
  if (/\b(it|its|this|that|same one|same device|same channel)\b/i.test(text)) {
    refs.push({ phrase: RegExp.lastMatch || "it", kind: "pronoun", confidence: 0.8 });
  }
  if (/\bother\b/i.test(text)) refs.push({ phrase: "other", kind: "other_candidate", confidence: 0.72 });
  return refs;
}

function extractEntities(text: string): ParsedEntity[] {
  const entities: ParsedEntity[] = [];
  const room = text.match(/\b(Bedroom\s*\d+|living room|master bedroom|kitchen|bathroom|room\s+\d+)\b/i)?.[0];
  if (room) entities.push({ type: "room", text: room, normalized_text: room.replace(/\s+/g, " ").trim(), confidence: 0.88 });
  const device = text.match(/\b([A-Za-z0-9' -]+?(?:light|switch|socket|plug|tv|air conditioner|ac|camera|channel\s*\d+))\b/i)?.[0];
  if (device) entities.push({ type: "device", text: device, normalized_text: device.replace(/\s+/g, " ").trim(), confidence: 0.76 });
  return entities;
}

export function normalizeUserTurn(rawText: unknown): NormalizedUserTurn {
  const raw = clean(rawText);
  const { normalized, corrections } = applyLexicalCorrections(raw);
  const operation = classifyOperation(normalized);
  const domain = classifyDomain(normalized);
  const mutation_intent = ["compose", "propose_mutation", "approve", "reject", "cancel", "execute"].includes(operation);
  return {
    raw_text: raw,
    normalized_text: normalized,
    corrections,
    operation,
    domain,
    entities: extractEntities(normalized),
    temporal_scope: extractTemporalScope(normalized),
    references: extractReferences(normalized),
    mutation_intent,
  };
}
