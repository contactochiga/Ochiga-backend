import type { IntelligenceContextEnvelope } from "../contracts/intelligenceContextEnvelope";
import type { AuthUser } from "../../middleware/auth";
import type { OisContext } from "../../types/oisContext";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";
import type { CanonicalConversationRequest } from "../contracts/canonicalConversation";

export type ResolvedConversationTarget = {
  objectType: string | null;
  objectId: string | null;
  objectName: string | null;
  source:
    | "explicit_canonical_target"
    | "selected_subobject"
    | "active_page_object"
    | "resolved_named_reference"
    | "thread_target"
    | "module_scope"
    | "room_scope"
    | "home_scope"
    | "building_scope"
    | "ambiguous";
  confidence: number;
  ambiguous: boolean;
  clarificationQuestion: string | null;
  contextId?: string | null;
  contextVersion?: number | null;
  hydrationStatus?: "pending" | "hydrated" | "not_found" | "restricted" | "unavailable";
  scopeWidened?: boolean;
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

export type DeviceResolutionResult =
  | { status: "resolved"; device_id: string; channel_code: string | null; label: string; room_id: string | null; confidence: number; channel_definitions?: Array<{ code: string; label: string }> }
  | { status: "ambiguous"; phrase: string; candidates: Array<{ device_id: string; label: string; room_label: string | null; device_family: string; channel_code: string | null; channel_definitions?: Array<{ code: string; label: string }> }> }
  | { status: "not_found"; phrase: string };

export type RoomResolutionResult =
  | { status: "resolved"; room_id: string; label: string; confidence: number }
  | { status: "ambiguous"; phrase: string; candidates: Array<{ room_id: string; label: string }> }
  | { status: "not_found"; phrase: string };

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function cleanLabel(value: unknown, fallback = "Item") {
  const raw = text(value);
  if (!raw) return fallback;
  return raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeLookupText(value: unknown) {
  return text(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/(\d+)\s*(gang|g)/g, "$1 gang")
    .replace(/\b(one|first)\b/g, "1")
    .replace(/\b(two|second)\b/g, "2")
    .replace(/\b(three|third)\b/g, "3")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function currentScope(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  return {
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
    room_id: input.room_id || text(recordOf(input.context).room_id || recordOf(input.context).roomId) || null,
  };
}

export function requestedChannelCode(message: string) {
  const match = message.match(/\b(?:channel|gang|switch)\s*(1|2|3|one|two|three|first|second|third)\b/i)
    || message.match(/\b(first|second|third)\s+(?:channel|gang|switch)\b/i);
  if (!match) return null;
  const raw = String(match[1]).toLowerCase();
  const number = raw === "one" || raw === "first" ? "1" : raw === "two" || raw === "second" ? "2" : raw === "three" || raw === "third" ? "3" : raw;
  return `switch_${number}`;
}

export function namedDevicePhraseFromControlMessage(message: string, options: { isControlRequest: (message: string) => boolean }) {
  if (!options.isControlRequest(message)) return null;
  if (/\b(it|this|that|this channel|that device|same device|same channel)\b/i.test(message)) return null;
  const withoutChannel = text(message)
    .replace(/\b(?:channel|gang|switch)\s*(?:1|2|3|one|two|three|first|second|third)\b/ig, " ")
    .replace(/\b(?:first|second|third)\s+(?:channel|gang|switch)\b/ig, " ");
  if (requestedChannelCode(message) && !normalizeLookupText(withoutChannel).replace(/\b(turn|switch|power|set|on|off|the|my|a|an|to|please)\b/g, " ").trim()) return null;
  const phrase = text(message)
    .replace(/^\s*(please\s+)?(?:turn|switch|power|set)\s+/i, "")
    .replace(/\b(on|off|up|down)\b/ig, " ")
    .replace(/\b(?:channel|gang|switch)\s*(?:1|2|3|one|two|three|first|second|third)\b/ig, " ")
    .replace(/\b(?:first|second|third)\s+(?:channel|gang|switch)\b/ig, " ")
    .replace(/\b(the|my|a|an|to)\b/ig, " ")
    .replace(/[.?!]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!phrase || /^channel\s*[123]$/i.test(phrase)) return null;
  return phrase.length >= 3 ? phrase : null;
}

export function roomPhraseFromMessage(message: string) {
  const match = text(message).match(/\b(?:in|inside|for|open|view|show|to)\s+(?:the\s+)?((?:ochiga(?:'s)?\s+)?(?:(?:second|first|third)\s+)?(?:bedroom|room|living room|sitting room|kitchen|bathroom|parlor|lounge|office|study|garage|balcony|dining room)\s*[a-z0-9-]*)\b/i);
  return match?.[1] ? cleanLabel(match[1], "") : "";
}

function deviceFamilyFromRow(row: Record<string, unknown>) {
  return text(row.category || row.type || recordOf(row.metadata).device_family || recordOf(row.metadata).family || "device");
}

function channelDefinitionsFromRow(row: Record<string, unknown>) {
  const metadata = recordOf(row.metadata);
  const direct = Array.isArray(metadata.channel_definitions) ? metadata.channel_definitions : [];
  const codes = new Map<string, { code: string; label: string }>();
  for (const item of direct.map(recordOf)) {
    const code = text(item.code || item.channel_code || item.key);
    if (/^switch_\d+$/i.test(code)) codes.set(code, { code, label: cleanLabel(item.label || item.name || code.replace(/^switch_/i, "Channel "), code) });
  }
  for (const capability of arrayOfStrings(row.capabilities).filter((item) => /^switch_\d+$/i.test(item))) {
    if (!codes.has(capability)) codes.set(capability, { code: capability, label: capability.replace(/^switch_/i, "Channel ") });
  }
  return Array.from(codes.values()).sort((a, b) => a.code.localeCompare(b.code));
}

function scoreDeviceCandidate(phrase: string, row: Record<string, unknown>, roomLabel: string | null, channelCode: string | null) {
  const normalizedPhrase = normalizeLookupText(phrase);
  const name = normalizeLookupText(row.name || recordOf(row.metadata).display_name || recordOf(row.metadata).label);
  const aliases = arrayOfStrings(recordOf(row.metadata).aliases).map(normalizeLookupText);
  const family = normalizeLookupText(deviceFamilyFromRow(row));
  const room = normalizeLookupText(roomLabel || recordOf(row.metadata).room_name || recordOf(row.metadata).roomName);
  const channel = normalizeLookupText(channelCode);
  let score = 0;
  if (name && normalizedPhrase === name) score += 1;
  if (aliases.includes(normalizedPhrase)) score += 0.95;
  if (name && (name.includes(normalizedPhrase) || normalizedPhrase.includes(name))) score += 0.65;
  if (room && normalizedPhrase.includes(room)) score += 0.35;
  if (family && normalizedPhrase.includes(family)) score += 0.25;
  if (/\blight|lamp\b/i.test(normalizedPhrase) && /\blight|switch|socket|plug\b/i.test(family)) score += 0.25;
  if (/\btv|television\b/i.test(normalizedPhrase) && /\btv|ir|remote\b/i.test(`${family} ${name}`)) score += 0.35;
  if (channel && normalizedPhrase.includes(channel)) score += 0.2;
  const tokens = normalizedPhrase.split(" ").filter(Boolean);
  const haystack = `${name} ${room} ${family} ${aliases.join(" ")}`;
  const matchedTokens = tokens.filter((token) => haystack.includes(token)).length;
  if (tokens.length) score += Math.min(0.35, matchedTokens / tokens.length * 0.35);
  return Math.min(1, score);
}

export async function resolveNamedDeviceForRead(
  actor: AuthUser | null,
  oisContext: OisContext | null | undefined,
  input: CanonicalConversationRequest,
  phrase: string,
): Promise<DeviceResolutionResult> {
  const scope = currentScope(input, oisContext);
  if (!scope.home_id) return { status: "not_found", phrase };
  try {
    const { data, error } = await supabaseAdmin
      .from("devices")
      .select("id,name,home_id,room_id,category,type,capabilities,metadata")
      .eq("home_id", scope.home_id)
      .limit(100);
    if (error) throw error;
    const roomIds = Array.from(new Set((data || []).map((device: any) => text(device.room_id)).filter(Boolean)));
    const rooms = roomIds.length ? await supabaseAdmin.from("rooms").select("id,name").in("id", roomIds) : { data: [], error: null };
    const roomById = new Map((rooms.data || []).map((row: any) => [String(row.id), cleanLabel(row.name, "")]));
    const requestedChannel = requestedChannelCode(input.message);
    const candidates = (data || [])
      .map((row: any) => {
        const roomLabel = roomById.get(String(row.room_id)) || text(recordOf(row.metadata).room_name || recordOf(row.metadata).roomName) || null;
        const channelCode = requestedChannel || null;
        return {
          row,
          roomLabel,
          channelCode,
          score: scoreDeviceCandidate(phrase, row, roomLabel, channelCode),
        };
      })
      .filter((candidate) => candidate.score >= 0.58)
      .sort((a, b) => b.score - a.score);
    if (!candidates.length) return { status: "not_found", phrase };
    const top = candidates[0];
    const tied = candidates.filter((candidate) => Math.abs(candidate.score - top.score) < 0.08);
    if (tied.length > 1) {
      return {
        status: "ambiguous",
        phrase,
        candidates: tied.slice(0, 5).map((candidate) => ({
          device_id: String(candidate.row.id),
          label: cleanLabel(candidate.row.name, "Device"),
          room_label: candidate.roomLabel,
          device_family: deviceFamilyFromRow(candidate.row),
          channel_code: candidate.channelCode,
          channel_definitions: channelDefinitionsFromRow(candidate.row),
        })),
      };
    }
    return {
      status: "resolved",
      device_id: String(top.row.id),
      channel_code: top.channelCode,
      label: cleanLabel(top.row.name, "Device"),
      room_id: text(top.row.room_id) || null,
      confidence: top.score,
      channel_definitions: channelDefinitionsFromRow(top.row),
    };
  } catch (error) {
    logger.warn("conversation_named_device_resolution_failed", { error, phrase, home_id: scope.home_id, actor_id: actor?.id || null });
    return { status: "not_found", phrase };
  }
}

function scoreRoomCandidate(phrase: string, row: Record<string, unknown>) {
  const normalizedPhrase = normalizeLookupText(phrase).replace(/\bsecond\b/g, "2").replace(/\bfirst\b/g, "1");
  const name = normalizeLookupText(row.name || recordOf(row.metadata).label).replace(/\bsecond\b/g, "2").replace(/\bfirst\b/g, "1");
  const aliases = arrayOfStrings(recordOf(row.metadata).aliases).map((item) => normalizeLookupText(item).replace(/\bsecond\b/g, "2").replace(/\bfirst\b/g, "1"));
  if (!normalizedPhrase || !name) return 0;
  let score = 0;
  if (normalizedPhrase === name) score += 1;
  if (aliases.includes(normalizedPhrase)) score += 0.95;
  if (name.includes(normalizedPhrase) || normalizedPhrase.includes(name)) score += 0.68;
  const tokens = normalizedPhrase.split(" ").filter(Boolean);
  const matchedTokens = tokens.filter((token) => `${name} ${aliases.join(" ")}`.includes(token)).length;
  if (tokens.length) score += Math.min(0.25, matchedTokens / tokens.length * 0.25);
  return Math.min(1, score);
}

export async function resolveRoomForRead(
  actor: AuthUser | null,
  oisContext: OisContext | null | undefined,
  input: CanonicalConversationRequest,
  phrase: string,
): Promise<RoomResolutionResult> {
  const scope = currentScope(input, oisContext);
  if (!scope.home_id) return { status: "not_found", phrase };
  try {
    const { data, error } = await supabaseAdmin
      .from("rooms")
      .select("id,name,home_id,metadata")
      .eq("home_id", scope.home_id)
      .limit(80);
    if (error) throw error;
    const candidates = (data || [])
      .map((row: any) => ({ row, score: scoreRoomCandidate(phrase, row) }))
      .filter((candidate) => candidate.score >= 0.58)
      .sort((a, b) => b.score - a.score);
    if (!candidates.length) return { status: "not_found", phrase };
    const top = candidates[0];
    const tied = candidates.filter((candidate) => Math.abs(candidate.score - top.score) < 0.08);
    if (tied.length > 1) {
      return { status: "ambiguous", phrase, candidates: tied.slice(0, 5).map((candidate) => ({ room_id: String(candidate.row.id), label: cleanLabel(candidate.row.name, "Room") })) };
    }
    return { status: "resolved", room_id: String(top.row.id), label: cleanLabel(top.row.name, "Room"), confidence: top.score };
  } catch (error) {
    logger.warn("conversation_room_resolution_failed", { error, phrase, home_id: scope.home_id, actor_id: actor?.id || null });
    return { status: "not_found", phrase };
  }
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
  const rawContext = input.context as any;
  const activeContext = rawContext?.active_intelligence_context && typeof rawContext.active_intelligence_context === "object"
    ? rawContext.active_intelligence_context
    : rawContext?.runtime_context?.active_context && typeof rawContext.runtime_context.active_context === "object"
      ? rawContext.runtime_context.active_context
      : null;
  const selectedSubobject = activeContext?.selected_subobject && typeof activeContext.selected_subobject === "object" ? activeContext.selected_subobject : null;
  const primaryObject = activeContext?.primary_object && typeof activeContext.primary_object === "object" ? activeContext.primary_object : null;
  const explicit = targetFrom(input.explicitTarget, "explicit_canonical_target", 0.98);
  if (explicit) return explicit;
  const selected = targetFrom(input.selectedObject || selectedSubobject, selectedSubobject ? "selected_subobject" : "active_page_object", selectedSubobject ? 0.96 : 0.92);
  if (selected) return selected;
  const contextPrimary = targetFrom(primaryObject, "active_page_object", 0.94);
  if (contextPrimary) {
    contextPrimary.contextId = text(activeContext?.context_id) || null;
    contextPrimary.contextVersion = Number(activeContext?.context_version) || null;
    contextPrimary.hydrationStatus = "pending";
    return contextPrimary;
  }
  const page = targetFrom(input.pageObject || {
    object_type: input.context?.object_type,
    object_id: input.context?.object_id,
    object_name: input.context?.object_name,
  }, "active_page_object", 0.88);
  if (page) return page;
  const named = /(?:device|room|scene|automation|wallet|transaction|visitor|maintenance|camera|meter)\s+["']?([a-z0-9 _-]{3,})["']?/i.exec(text(input.query));
  if (named?.[1]) {
    return { objectType: null, objectId: null, objectName: named[1].trim(), source: "resolved_named_reference", confidence: 0.78, ambiguous: false, clarificationQuestion: null, hydrationStatus: "pending", scopeWidened: false };
  }
  const thread = targetFrom(input.threadTarget, "thread_target", 0.62);
  if (thread && !/(this|here|current|selected|open|page)/.test(query)) return thread;
  const scopeSource = input.context?.room_id ? "room_scope" : input.context?.home_id ? "home_scope" : input.context?.building_id ? "building_scope" : "module_scope";
  const scopeTarget = targetFrom({
    object_type: input.context?.room_id ? "room" : input.context?.home_id ? "home" : input.context?.building_id ? "building" : null,
    object_id: input.context?.room_id || input.context?.home_id || input.context?.building_id,
  }, scopeSource, 0.5);
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
