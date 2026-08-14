import { supabaseAdmin } from "../../../supabase/supabaseClient";
import { logger } from "../../../observability/logger";
import type { OisContext } from "../../../types/oisContext";
import type { CanonicalConversationRequest, IntelligenceFact, OperationalObject } from "../../contracts/canonicalConversation";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function listOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(recordOf).filter((item) => Object.keys(item).length) : [];
}

function privacyClassForCommunityRecord(record: Record<string, unknown>) {
  const visibility = text(record.visibility || record.privacy || record.thread_type || record.type).toLowerCase();
  if (/\b(private|direct|dm)\b/.test(visibility)) return "resident_message_private";
  if (/\b(group|channel)\b/.test(visibility)) return "community_group";
  if (/\bannouncement|public|notice\b/.test(visibility)) return "community_announcement";
  return "community_scoped";
}

export function isCommunityMessageThreadRecord(value: unknown) {
  const record = recordOf(value);
  const rawType = text(record.object_type || record.type || record.target_type || record.entity_type).toLowerCase();
  if (rawType && rawType !== "message_thread" && rawType !== "message" && rawType !== "dm_thread" && rawType !== "community_thread") return false;
  const source = text(record.source_module || record.module || record.domain || record.source).toLowerCase();
  if (source === "messages" || source === "community") return true;
  return Boolean(
    text(record.message_thread_id || record.messageThreadId || record.dm_thread_id || record.dmThreadId || record.community_thread_id || record.communityThreadId),
  );
}

export function communityRecordsFromContext(object: OperationalObject | null, input: CanonicalConversationRequest) {
  const relationships = recordOf(object?.relationships);
  const context = recordOf(input.context);
  const conversationContext = recordOf(input.conversation_context);
  const rows = [
    ...listOf(relationships.community_posts),
    ...listOf(relationships.posts),
    ...listOf(relationships.announcements),
    ...listOf(relationships.message_threads),
    ...listOf(relationships.messages),
    ...listOf(relationships.threads),
    ...listOf(context.community_posts),
    ...listOf(context.message_threads),
    ...listOf(context.messages),
    ...listOf(conversationContext.community_posts),
    ...listOf(conversationContext.message_threads),
  ];
  return rows.map((row) => ({
    id: text(row.id || row.thread_id || row.message_thread_id || row.post_id),
    title: text(row.title || row.subject || row.channel_name || row.group_name) || null,
    preview: text(row.preview || row.last_message || row.body || row.summary) || null,
    sender: text(row.sender_name || row.sender || row.author_name) || null,
    created_at: text(row.created_at || row.sent_at || row.posted_at) || null,
    updated_at: text(row.updated_at || row.last_message_at) || null,
    unread: Boolean(row.unread || row.has_unread || Number(row.unread_count || 0) > 0),
    message_count: Number(row.message_count || row.reply_count || 0) || null,
    privacy_class: privacyClassForCommunityRecord(row),
    metadata: row,
  }));
}

export function communityThreadBoundarySummary() {
  return {
    oyi_conversation_storage: ["oyi_conversation_threads", "oyi_conversation_messages"],
    community_message_storage: ["dm_threads", "dm_messages", "community_posts"],
    boundary: "community_message_threads_are_operational_targets_not_oyi_conversation_threads",
  };
}

// Reuses the exact official-vs-chatter test from
// src/controllers/communityController.ts's communitySourceFor — category,
// is_pinned and author role are the real discriminators (there is no
// is_official/type column). community_posts is estate-scoped only (no
// home_id column), so both surfaces read the same estate-wide rows.
const OFFICIAL_CATEGORIES = new Set(["announcement", "notice", "maintenance", "security", "service", "event"]);
function isOfficialCommunityPost(category: string, isPinned: boolean, authorRole: string) {
  return isPinned || OFFICIAL_CATEGORIES.has(category) || /admin|manager|operator|moderator|security|maintenance|staff|owner/.test(authorRole);
}

function currentScope(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  return { estate_id: input.estate_id || oisContext?.estate_id || null };
}

function unavailableCommunityFact(input: { scope: ReturnType<typeof currentScope>; reason: string; contract: IntelligenceRequestContract }): IntelligenceFact {
  const now = new Date().toISOString();
  return {
    fact_id: `community-post-unavailable:${input.contract.conversation_request_id}`,
    domain: "community",
    fact_type: "community_post",
    scope: { estate_id: input.scope.estate_id, home_id: null, room_id: null },
    object: { object_type: "community_post", canonical_id: input.scope.estate_id || "unknown-estate", label: "Community updates" },
    statement: "Community post evidence is unavailable right now.",
    value: { reason: input.reason },
    previous_value: null,
    occurred_at: null,
    observed_at: now,
    source_type: "database",
    source_id: null,
    truth_state: "unavailable",
    confidence: 0,
    freshness: "unavailable",
    privacy_class: "building_operational",
    permissions: ["community.read"],
    evidence: [{ type: "community_posts", status: "unavailable", reason: input.reason }],
  };
}

// Direct evidence: community_posts, estate-scoped, ranked official-first.
// Never reads resident-private DM threads (dm_threads/dm_messages) — those
// remain out of scope for this capability, matching messages.unread.read's
// existing separate declared-module boundary.
export async function loadCommunityPostFacts(
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  contract: IntelligenceRequestContract,
): Promise<IntelligenceFact[]> {
  const scope = currentScope(input, oisContext);
  if (!scope.estate_id) return [];
  const diagnosticBase = { capability_key: "community.latest.read", surface: input.surface, estate_id: scope.estate_id };
  try {
    const { data, error } = await supabaseAdmin
      .from("community_posts")
      .select("id,estate_id,author_id,title,body,status,category,is_pinned,priority,audience_type,created_at,updated_at")
      .eq("estate_id", scope.estate_id)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const authorIds = Array.from(new Set(rows.map((row: any) => text(row.author_id)).filter(Boolean)));
    const roleByAuthor = new Map<string, string>();
    if (authorIds.length) {
      const { data: authorRows, error: authorError } = await supabaseAdmin.from("users").select("id,role").in("id", authorIds);
      if (!authorError && Array.isArray(authorRows)) {
        for (const row of authorRows as any[]) roleByAuthor.set(String(row.id), text(row.role).toLowerCase());
      }
    }
    const facts = rows.map((row: any): IntelligenceFact => {
      const category = text(row.category) || "resident";
      const isPinned = Boolean(row.is_pinned);
      const authorRole = roleByAuthor.get(text(row.author_id)) || "";
      const official = isOfficialCommunityPost(category, isPinned, authorRole);
      const title = text(row.title) || "Community update";
      return {
        fact_id: `community-post:${row.id}`,
        domain: "community",
        fact_type: "community_post",
        scope: { estate_id: scope.estate_id, home_id: null, room_id: null },
        object: { object_type: "community_post", canonical_id: String(row.id), label: title },
        statement: `${title} (${official ? "official" : "resident"}, ${category}).`,
        value: {
          title,
          body: text(row.body) || null,
          category,
          is_pinned: isPinned,
          is_official: official,
          priority: text(row.priority) || null,
          audience_type: text(row.audience_type) || null,
        },
        previous_value: null,
        occurred_at: text(row.created_at) || null,
        observed_at: new Date().toISOString(),
        source_type: "database",
        source_id: String(row.id),
        truth_state: "confirmed",
        confidence: 0.9,
        freshness: text(row.updated_at || row.created_at) || "historical",
        privacy_class: "building_operational",
        permissions: ["community.read"],
        evidence: [{ type: "community_posts", id: row.id, category }],
      };
    });
    // Official-first, then most recent — matches the "prioritize
    // operationally relevant updates over chatter" requirement.
    facts.sort((a, b) => {
      const officialDelta = Number(recordOf(b.value).is_official) - Number(recordOf(a.value).is_official);
      if (officialDelta) return officialDelta;
      return String(b.occurred_at || "").localeCompare(String(a.occurred_at || ""));
    });
    logger.info("oyi_community_post_evidence_loaded", { ...diagnosticBase, query_row_count: rows.length, fact_count: facts.length, result_type: facts.length ? "answered" : "empty" });
    return facts;
  } catch (error) {
    logger.warn("conversation_community_post_load_failed", { ...diagnosticBase, error, result_type: "unavailable" });
    return [unavailableCommunityFact({ scope, reason: "community_post_query_failed", contract })];
  }
}
