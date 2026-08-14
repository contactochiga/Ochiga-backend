import { resolveRoomForRead } from "../../runtime/conversationTargetResolver";
import type { CanonicalConversationRequest } from "../../contracts/canonicalConversation";
import type { AuthUser } from "../../../middleware/auth";
import type { OisContext } from "../../../types/oisContext";

// roomPhraseFromMessage (conversationTargetResolver.ts) requires a leading
// preposition ("in the living room", "for the kitchen") — built for device-
// action commands, not broad status questions like "How is the living
// room?" or "Anything wrong in the kitchen?". This is a separate, additive
// extractor scoped to Room Intelligence routing only, so it can never
// change existing device-command room matching behavior.
const ROOM_NOUNS = "bedroom|living room|sitting room|kitchen|bathroom|parlor|lounge|office|study|garage|balcony|dining room|room";

export function roomPhraseForIntelligence(message: string): string {
  const match = String(message || "").match(new RegExp(`\\b(?:my\\s+|the\\s+)?((?:(?:second|first|third)\\s+)?(?:${ROOM_NOUNS}))\\b`, "i"));
  return match?.[1] ? match[1].trim() : "";
}

export type RoomTargetResolution =
  | { status: "resolved"; room_id: string; label: string; confidence: number }
  | { status: "ambiguous"; phrase: string; candidates: Array<{ room_id: string; label: string }> }
  | { status: "not_found"; phrase: string }
  | { status: "no_phrase" };

export async function resolveRoomTargetFromMessage(actor: AuthUser | null, oisContext: OisContext | null | undefined, input: CanonicalConversationRequest): Promise<RoomTargetResolution> {
  const phrase = roomPhraseForIntelligence(input.message);
  if (!phrase) return { status: "no_phrase" };
  const resolution = await resolveRoomForRead(actor, oisContext, input, phrase);
  if (resolution.status === "resolved") return { status: "resolved", room_id: resolution.room_id, label: resolution.label, confidence: resolution.confidence };
  if (resolution.status === "ambiguous") return { status: "ambiguous", phrase, candidates: resolution.candidates };
  return { status: "not_found", phrase };
}
