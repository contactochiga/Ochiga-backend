import type { IntelligenceContextEnvelope } from "../contracts/intelligenceContextEnvelope";

export type ResolvedConversationTarget = {
  objectType: string | null;
  objectId: string | null;
  objectName: string | null;
  source:
    | "explicit_named_object"
    | "explicit_request_target"
    | "selected_object"
    | "page_object"
    | "thread_target"
    | "scope"
    | "ambiguous";
  confidence: number;
  ambiguous: boolean;
  clarificationQuestion: string | null;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function targetFrom(value: any, source: ResolvedConversationTarget["source"], confidence: number): ResolvedConversationTarget | null {
  if (!value || typeof value !== "object") return null;
  const objectType = text(value.object_type || value.type || value.target_type);
  const objectId = text(value.object_id || value.id || value.target_id || value.canonical_id);
  if (!objectType && !objectId) return null;
  return {
    objectType: objectType || null,
    objectId: objectId || null,
    objectName: text(value.object_name || value.name || value.label) || null,
    source,
    confidence,
    ambiguous: false,
    clarificationQuestion: null,
  };
}

export function resolveConversationTarget(input: {
  query?: string | null;
  explicitTarget?: Record<string, unknown> | null;
  selectedObject?: Record<string, unknown> | null;
  pageObject?: Record<string, unknown> | null;
  threadTarget?: Record<string, unknown> | null;
  context?: Partial<IntelligenceContextEnvelope> | null;
}): ResolvedConversationTarget {
  const query = text(input.query).toLowerCase();
  const named = /(?:device|room|scene|automation|wallet|transaction|visitor|maintenance|camera|meter)\s+["']?([a-z0-9 _-]{3,})["']?/i.exec(text(input.query));
  if (named?.[1]) {
    return { objectType: null, objectId: null, objectName: named[1].trim(), source: "explicit_named_object", confidence: 0.78, ambiguous: false, clarificationQuestion: null };
  }
  const explicit = targetFrom(input.explicitTarget, "explicit_request_target", 0.95);
  if (explicit) return explicit;
  const selected = targetFrom(input.selectedObject, "selected_object", 0.92);
  if (selected) return selected;
  const page = targetFrom(input.pageObject || {
    object_type: input.context?.object_type,
    object_id: input.context?.object_id,
    object_name: input.context?.object_name,
  }, "page_object", 0.88);
  if (page) return page;
  const thread = targetFrom(input.threadTarget, "thread_target", 0.62);
  if (thread && !/(this|here|current|selected|open|page)/.test(query)) return thread;
  const scopeTarget = targetFrom({
    object_type: input.context?.room_id ? "room" : input.context?.home_id ? "home" : input.context?.building_id ? "building" : null,
    object_id: input.context?.room_id || input.context?.home_id || input.context?.building_id,
  }, "scope", 0.5);
  if (scopeTarget) return scopeTarget;
  return {
    objectType: null,
    objectId: null,
    objectName: null,
    source: "ambiguous",
    confidence: 0.2,
    ambiguous: true,
    clarificationQuestion: "Which item should I inspect?",
  };
}
