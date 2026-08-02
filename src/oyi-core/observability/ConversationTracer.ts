import { randomUUID } from "crypto";
import { logger } from "../../observability/logger";
import { observeConversationStage } from "./ConversationMetrics";

export type ConversationTraceStage =
  | "request_received"
  | "context_loaded"
  | "turn_normalized"
  | "workflow_restored"
  | "turn_resolved"
  | "capability_selected"
  | "authority_decided"
  | "evidence_planned"
  | "evidence_loaded"
  | "response_composed"
  | "action_created"
  | "execution_started"
  | "verification_completed"
  | "persistence_completed"
  | "response_sent"
  | "legacy_fallback_used";

export class ConversationTracer {
  readonly requestId: string;
  readonly correlationId: string;
  readonly runtimeId: string;
  private readonly startedAt = Date.now();
  private readonly stageStarts = new Map<string, number>();

  constructor(input: { requestId?: string | null; correlationId?: string | null; runtimeId?: string | null }) {
    this.requestId = input.requestId || randomUUID();
    this.correlationId = input.correlationId || this.requestId;
    this.runtimeId = input.runtimeId || randomUUID();
  }

  stage(stage: ConversationTraceStage, metadata: Record<string, unknown> = {}) {
    const now = Date.now();
    const previous = this.stageStarts.get(stage) || this.startedAt;
    const duration = Math.max(0, now - previous);
    observeConversationStage(stage, duration, {
      domain: String(metadata.domain || "unknown"),
      operation: String(metadata.operation || "unknown"),
      capability: String(metadata.capability_key || metadata.capability || "unknown"),
    });
    logger.info(`oyi_conversation_${stage}`, {
      request_id: this.requestId,
      correlation_id: this.correlationId,
      runtime_id: this.runtimeId,
      ...metadata,
      duration_ms: duration,
    });
    this.stageStarts.set(stage, now);
  }

  finish(metadata: Record<string, unknown> = {}) {
    this.stage("response_sent", { ...metadata, total_duration_ms: Math.max(0, Date.now() - this.startedAt) });
  }
}
