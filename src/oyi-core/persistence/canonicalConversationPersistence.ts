import { randomUUID } from "crypto";
import type { AuthUser } from "../../middleware/auth";
import { logger } from "../../observability/logger";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import type { OisContext } from "../../types/oisContext";
import type {
  CanonicalConversationRequest,
  CanonicalTruth,
  ConversationBuilderKey,
  IntelligenceFact,
  OperationalObject,
} from "../contracts/canonicalConversation";
import type { IntelligenceRequestContract } from "../interpretation/conversationIntentRouting";
import {
  turnInterpretationFromContract,
  type ConversationContextLayers,
} from "../context/conversationContextLayers";
import { buildResultSetContext, loadThreadResultSetsContext, type ResultSetContext } from "../context/resultSetContext";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanLabel(value: unknown, fallback: string) {
  const next = text(value);
  return next || fallback;
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

function safePersistenceError(error: unknown) {
  const err = recordOf(error);
  return {
    error_code: text(err.code || err.status || err.name) || null,
    error_message: text(err.message) || "Conversation persistence failed",
    error_details: text(err.details) || null,
    error_hint: text(err.hint) || null,
  };
}

function responseIdentifier(response: Record<string, unknown>, conversationRequestId: string) {
  return text(response.id) || `oyi-runtime:${conversationRequestId}`;
}

function genericThreadTitle(title: unknown) {
  return /^(oyi conversation|new conversation|chat|conversation)$/i.test(text(title).trim());
}

function titleFromTurn(message: string, contract: IntelligenceRequestContract, object: OperationalObject | null) {
  const label = cleanLabel(object?.label || contract.target.label, "");
  if (contract.intent === "capability") return label ? `${label} capabilities` : "Oyi capabilities";
  if (contract.intent === "home_operational_summary") return "Home status";
  if (contract.intent === "device_availability_inventory") return "Device availability";
  if (contract.intent === "activity_history") return label ? `${label} activity` : "Activity history";
  if (contract.intent === "failure_history") return label ? `${label} failures` : "Failure history";
  if (contract.intent === "diagnosis" || contract.intent === "investigation") return label ? `${label} investigation` : "Investigation";
  if (contract.intent === "relationships") return label ? `${label} relationships` : "Relationships";
  if (contract.intent === "current_state" || contract.intent === "health_check") return label ? `${label} status` : "Status check";
  const cleaned = cleanLabel(message, "");
  return cleaned ? cleaned.slice(0, 64) : "Oyi conversation";
}

async function currentThreadTitle(threadId: string) {
  if (!isUuid(threadId)) return null;
  const { data, error } = await supabaseAdmin
    .from("oyi_conversation_threads")
    .select("title")
    .eq("id", threadId)
    .maybeSingle();
  if (error) {
    logger.warn("conversation_thread_title_load_failed", { thread_id: threadId, error });
    return null;
  }
  return text(data?.title) || null;
}

async function verifyCanonicalCurrentTurnPersistence(threadId: string, userMessageId: string, assistantMessageId: string, conversationRequestId: string) {
  const result = await supabaseAdmin
    .from("oyi_conversation_messages")
    .select("id,thread_id,role,metadata")
    .in("id", [userMessageId, assistantMessageId]);
  if (result.error) return { ok: false, count: 0, error: result.error.message };
  const rows = Array.isArray(result.data) ? result.data : [];
  const byId = new Map(rows.map((row: any) => [String(row.id), row]));
  const user = byId.get(userMessageId) as any;
  const assistant = byId.get(assistantMessageId) as any;
  const matchesRequest = (row: any) => text(recordOf(row?.metadata).conversation_request_id) === conversationRequestId;
  const ok = Boolean(
    user
    && assistant
    && user.thread_id === threadId
    && assistant.thread_id === threadId
    && user.role === "user"
    && assistant.role === "assistant"
    && matchesRequest(user)
    && matchesRequest(assistant)
  );
  return { ok, count: rows.length, error: ok ? null : "Current conversation turn messages were not persisted with matching request ids" };
}

async function verifyCanonicalThreadPersistence(threadId: string, minimumMessages = 2) {
  const countResult = await supabaseAdmin
    .from("oyi_conversation_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId);
  if (countResult.error) return { ok: false, count: 0, error: countResult.error.message };
  const count = Number(countResult.count || 0);
  return { ok: count >= minimumMessages, count, error: count >= minimumMessages ? null : "Conversation messages were not persisted" };
}

async function cleanupCanonicalOrphanThread(threadId: string) {
  if (!isUuid(threadId)) return;
  const summary = await verifyCanonicalThreadPersistence(threadId, 1);
  if (summary.count > 0) return;
  const { error } = await supabaseAdmin.from("oyi_conversation_threads").delete().eq("id", threadId);
  if (error) logger.warn("conversation_orphan_thread_cleanup_failed", { thread_id: threadId, error });
}

async function cleanupCanonicalTurnRows(input: { threadId: string; userMessageId: string; assistantMessageId: string; deleteThread: boolean }) {
  if (!isUuid(input.threadId)) return;
  try {
    await supabaseAdmin
      .from("oyi_conversation_messages")
      .delete()
      .eq("thread_id", input.threadId)
      .in("id", [input.userMessageId, input.assistantMessageId]);
    if (input.deleteThread) await cleanupCanonicalOrphanThread(input.threadId);
  } catch (error) {
    logger.warn("conversation_turn_compensation_failed", {
      thread_id: input.threadId,
      user_message_id: input.userMessageId,
      assistant_message_id: input.assistantMessageId,
      ...safePersistenceError(error),
    });
  }
}

export async function persistCanonicalConversationTurn(input: {
  actor: AuthUser | null;
  oisContext: OisContext | null | undefined;
  request: CanonicalConversationRequest;
  response: Record<string, unknown>;
  truth: CanonicalTruth;
  object: OperationalObject | null;
  contract: IntelligenceRequestContract;
  builderKey: ConversationBuilderKey | null;
}) {
  const { actor, contract, object, request, response, truth } = input;
  const threadId = text(response.thread_id) || text(request.thread_id) || randomUUID();
  const newlyCreatedThread = !isUuid(text(request.thread_id));
  const now = new Date().toISOString();
  const assistantId = randomUUID();
  const userMessageId = randomUUID();
  const canonicalResponseId = responseIdentifier(response, contract.conversation_request_id);
  const existingTitle = await currentThreadTitle(threadId);
  const title = existingTitle && !genericThreadTitle(existingTitle) ? existingTitle : titleFromTurn(request.message, contract, object);
  const turnInterpretation = turnInterpretationFromContract(request, contract, {
    objectType: contract.target.object_type,
    objectId: contract.target.canonical_id,
    objectName: contract.target.label,
    confidence: contract.confidence,
  }, object ? "page_launch" : "thread_state");
  const contextLayers: ConversationContextLayers = {
    pageLaunchContext: recordOf(request.operational_object).canonical_id || request.target?.target_id ? {
      operational_object: request.operational_object || null,
      target: request.target || null,
    } : null,
    threadMemoryContext: object ? {
      object_type: object.object_type,
      canonical_id: object.canonical_id,
      label: object.label,
      parent_id: object.parent_id,
      channel_code: text(recordOf(object.metadata).channel_code) || contract.target.channel_code || null,
    } : null,
    currentTurnInterpretation: turnInterpretation,
    liveEvidenceContext: {
      required: turnInterpretation.requiresLiveEvidence,
      truth_state: truth.truth_state,
      freshness: truth.freshness,
      evidence_count: Array.isArray(response.facts) ? response.facts.length : 0,
    },
  };
  const executionRecord = recordOf(response.execution);
  const normalizedTurnMetadata = recordOf(executionRecord.normalized_turn);
  const resolvedOyiTurnMetadata = recordOf(executionRecord.resolved_oyi_turn);
  const workflowMetadata = recordOf(executionRecord.workflow);
  const actionMetadata = recordOf(executionRecord.action);
  // Generic result-set persistence for next-turn follow-up resolution
  // (ordinal/pronoun/"tell me more"). response.result_set is used verbatim
  // when a follow-up resolver already narrowed/selected it; otherwise it's
  // derived here from response.facts, which both conversation pipelines
  // populate (canonicalConversationRuntime.ts directly, the capability/
  // DomainResult pipeline via CapabilityResponseAdapter.ts) — no per-domain
  // code needed for this to work for any capability. Result sets are kept
  // PER DOMAIN (not a single overwritten slot) so switching domains mid
  // thread doesn't erase the ability to later say "go back to that
  // maintenance issue" (see resultSetContext.ts / §10 cross-domain switch).
  // response.result_set may be a single ResultSetContext (normal single-
  // domain capability, or a follow-up resolver's narrowed selection) OR an
  // ARRAY of them (Room/Home Intelligence — one broad answer can surface
  // several domains at once: maintenance, an automation failure, an
  // expected visitor, all in the same turn). An array turn deliberately
  // does not change active_domain — "tell me about that" right after a
  // multi-domain summary is genuinely ambiguous without a named domain
  // (see followUpResolver.ts's broadened parseDomainSwitchIntent, which
  // handles "tell me about the automation" by domain name instead).
  const explicitResultSetRaw = response.result_set as ResultSetContext | ResultSetContext[] | null | undefined;
  const priorResultSets = await loadThreadResultSetsContext(threadId).catch(() => ({ resultSets: {}, activeDomain: null }));
  let mergedResultSets = priorResultSets.resultSets;
  let activeDomain = priorResultSets.activeDomain;
  if (Array.isArray(explicitResultSetRaw)) {
    for (const resultSet of explicitResultSetRaw) {
      mergedResultSets = { ...mergedResultSets, [resultSet.domain]: resultSet };
    }
  } else {
    const derivedResultSet = explicitResultSetRaw !== undefined
      ? explicitResultSetRaw
      : buildResultSetContext({
        domain: (Array.isArray(response.facts) && response.facts[0] ? (response.facts[0] as IntelligenceFact).domain : null) || null,
        capabilityKey: text(response.capability_key) || null,
        operation: contract.intent,
        facts: Array.isArray(response.facts) ? response.facts as IntelligenceFact[] : [],
        contract,
        message: request.message,
      });
    if (derivedResultSet) {
      mergedResultSets = { ...mergedResultSets, [derivedResultSet.domain]: derivedResultSet };
      activeDomain = derivedResultSet.domain;
    }
  }
  const threadMetadata = {
    thread_state_version: 2,
    active_target: object ? { object_type: object.object_type, object_id: object.canonical_id, object_name: object.label } : null,
    result_sets: mergedResultSets,
    active_domain: activeDomain,
    conversation_state: {
      version: 1,
      entities: [],
      active_list: [],
      last_displayed_records: [],
      active_workflow: Object.keys(workflowMetadata).length
        ? workflowMetadata
        : executionRecord.pending_clarification
          ? { pending_clarification: recordOf(executionRecord.pending_clarification) }
          : null,
      conversation_state: Object.keys(workflowMetadata).length
        ? text(workflowMetadata.status) || "active"
        : executionRecord.pending_clarification ? "confirming" : "idle",
    },
    thread_memory_context: contextLayers.threadMemoryContext,
    conversation_context_layers: contextLayers,
    preview: cleanLabel(response.message || response.reply || request.message, "").slice(0, 180),
    last_intent: contract.intent,
    last_scope: contract.scope_mode,
    last_operational_object: object ? { type: object.object_type, id: object.canonical_id, label: object.label } : null,
    current_turn_execution: null,
    referenced_historical_execution: recordOf(response.execution).referenced_execution || null,
    canonical_request_contract: contract,
    resolved_turn: recordOf(response.resolved_turn),
    resolved_oyi_turn: resolvedOyiTurnMetadata,
    normalized_turn: normalizedTurnMetadata,
    workflow: workflowMetadata,
    action: actionMetadata,
    presentation_policy: recordOf(response.presentation_policy),
    turn_interpretation: turnInterpretation,
  };
  let failedStage = "unknown";
  try {
    logger.info("conversation_turn_persist_started", {
      conversation_request_id: contract.conversation_request_id,
      thread_id: threadId,
      user_message_id: userMessageId,
      assistant_message_id: assistantId,
      response_id: canonicalResponseId,
      surface: request.surface,
      intent: contract.intent,
      builder_key: input.builderKey,
    });
    failedStage = "thread_upsert";
    const threadWrite = await supabaseAdmin.from("oyi_conversation_threads").upsert({
      id: threadId,
      user_id: actor?.id || null,
      surface: request.surface,
      estate_id: request.estate_id || actor?.estate_id || null,
      home_id: request.home_id || actor?.home_id || null,
      module: request.module || null,
      title,
      updated_at: now,
      metadata: threadMetadata,
    } as any);
    if (threadWrite.error) throw threadWrite.error;
    logger.info("conversation_persistence_stage_completed", { stage: "thread_upsert", table: "oyi_conversation_threads", thread_id: threadId, conversation_request_id: contract.conversation_request_id });

    failedStage = "user_message_insert";
    const userWrite = await supabaseAdmin.from("oyi_conversation_messages").insert({
      id: userMessageId,
      thread_id: threadId,
      user_id: actor?.id || null,
      role: "user",
      content: request.message,
      metadata: {
        surface: request.surface,
        module: request.module || null,
        conversation_request_id: contract.conversation_request_id,
        canonical_request_contract: contract,
        normalized_turn: normalizedTurnMetadata,
        resolved_oyi_turn: resolvedOyiTurnMetadata,
        workflow: workflowMetadata,
        action: actionMetadata,
        turn_interpretation: turnInterpretation,
        conversation_context_layers: contextLayers,
      },
      created_at: now,
    } as any);
    if (userWrite.error) throw userWrite.error;
    logger.info("conversation_turn_user_persisted", {
      conversation_request_id: contract.conversation_request_id,
      thread_id: threadId,
      user_message_id: userMessageId,
    });

    failedStage = "assistant_message_insert";
    const assistantWrite = await supabaseAdmin.from("oyi_conversation_messages").insert({
      id: assistantId,
      thread_id: threadId,
      user_id: actor?.id || null,
      role: "assistant",
      content: cleanLabel(response.message || response.reply, "Oyi reviewed the current operational context."),
      cards: Array.isArray(response.cards) ? response.cards : [],
      sources: Array.isArray(response.sources) ? response.sources : [],
      suggested_actions: Array.isArray(response.suggested_actions) ? response.suggested_actions : [],
      metadata: {
        truth,
        operational_object: object,
        canonical_response_authoritative: true,
        single_authoritative_response: true,
        response_id: canonicalResponseId,
        assistant_message_id: assistantId,
        conversation_request_id: contract.conversation_request_id,
        canonical_request_contract: contract,
        resolved_turn: recordOf(response.resolved_turn),
        resolved_oyi_turn: resolvedOyiTurnMetadata,
        normalized_turn: normalizedTurnMetadata,
        workflow: workflowMetadata,
        action: actionMetadata,
        presentation_policy: recordOf(response.presentation_policy),
        warnings: Array.isArray(response.warnings) ? response.warnings : [],
        persistence_saved: true,
        turn_interpretation: turnInterpretation,
        conversation_context_layers: contextLayers,
        facts: Array.isArray(response.facts) ? response.facts : [],
      },
      created_at: new Date(Date.now() + 1).toISOString(),
    } as any);
    if (assistantWrite.error) throw assistantWrite.error;
    logger.info("conversation_turn_assistant_persisted", {
      conversation_request_id: contract.conversation_request_id,
      thread_id: threadId,
      assistant_message_id: assistantId,
    });

    failedStage = "current_turn_verification";
    const verified = await verifyCanonicalCurrentTurnPersistence(threadId, userMessageId, assistantId, contract.conversation_request_id);
    if (!verified.ok) throw new Error(verified.error || "Conversation turn persistence could not be verified");
    logger.info("conversation_turn_persist_verified", {
      conversation_request_id: contract.conversation_request_id,
      thread_id: threadId,
      user_message_id: userMessageId,
      assistant_message_id: assistantId,
    });

    failedStage = "thread_summary_update";
    const messageSummary = await verifyCanonicalThreadPersistence(threadId, 2);
    const summaryWrite = await supabaseAdmin
      .from("oyi_conversation_threads")
      .update({
        title,
        updated_at: new Date().toISOString(),
        metadata: {
          ...threadMetadata,
          message_count: messageSummary.count,
          last_user_message_id: userMessageId,
          last_assistant_message_id: assistantId,
          last_conversation_request_id: contract.conversation_request_id,
        },
      } as any)
      .eq("id", threadId);
    if (summaryWrite.error) throw summaryWrite.error;
    logger.info("conversation_persistence_stage_completed", { stage: "thread_summary_update", table: "oyi_conversation_threads", thread_id: threadId, conversation_request_id: contract.conversation_request_id });

    logger.info("conversation_final_answer_selected", {
      response_id: assistantId,
      builder: contract.answer_builder,
      truth_state: truth.truth_state,
      persistence_message_id: assistantId,
    });
    logger.info("conversation_authoritative_response_persisted", {
      conversation_request_id: contract.conversation_request_id,
      thread_id: threadId,
      persisted_message_id: assistantId,
      response_state: contract.operation_class === "report" ? "report_ready" : contract.operation_class === "recommend" ? "recommendation" : "informational",
      final_answer_authority: "canonical",
    });
    logger.info(request.thread_id ? "conversation_thread_continued" : "conversation_thread_created", {
      conversation_request_id: contract.conversation_request_id,
      thread_id: threadId,
      actor_id: actor?.id || null,
      surface: request.surface,
      intent: contract.intent,
      requested_scope: contract.scope_mode,
      target_type: contract.target.object_type,
      target_id: contract.target.canonical_id,
      confidence: contract.confidence,
    });
    return threadId;
  } catch (error) {
    await cleanupCanonicalTurnRows({ threadId, userMessageId, assistantMessageId: assistantId, deleteThread: newlyCreatedThread });
    (response as any).persistence_warning = "This answer was not saved to conversation history.";
    logger.warn("conversation_turn_persist_failed", {
      failed_stage: failedStage,
      table: failedStage === "thread_upsert" || failedStage === "thread_summary_update" ? "oyi_conversation_threads" : "oyi_conversation_messages",
      thread_id: threadId,
      user_message_id: userMessageId,
      assistant_message_id: assistantId,
      conversation_request_id: contract.conversation_request_id,
      actor_id: actor?.id || null,
      surface: request.surface,
      intent: contract.intent,
      builder_key: input.builderKey,
      ...safePersistenceError(error),
    });
    logger.warn("conversation_authoritative_persist_failed", { failed_stage: failedStage, thread_id: threadId, conversation_request_id: contract.conversation_request_id, ...safePersistenceError(error) });
    return null;
  }
}
