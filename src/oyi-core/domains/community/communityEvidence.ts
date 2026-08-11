import type { CanonicalConversationRequest, OperationalObject } from "../../runtime/canonicalConversationRuntime";

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
