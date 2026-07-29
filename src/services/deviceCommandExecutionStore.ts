import { classifyProviderError } from "../device/runtime/providerErrors";
import { logger } from "../observability/logger";
import { getIO } from "../realtime/io";
import { supabaseAdmin } from "../supabase/supabaseClient";

export type CommandLifecycleStatus =
  | "requested"
  | "validated"
  | "accepted_for_processing"
  | "dispatching"
  | "provider_accepted"
  | "provider_rejected"
  | "awaiting_state_confirmation"
  | "state_confirmed"
  | "state_mismatch"
  | "confirmation_timed_out"
  | "failed"
  | "cancelled";

export type CommandPhysicalEffectStatus = "confirmed" | "inferred" | "unknown" | "not_observable" | "contradicted";

export type DeviceCommandExecutionPatch = {
  command_execution_id: string;
  idempotency_key?: string | null;
  correlation_id?: string | null;
  request_id?: string | null;
  actor_id?: string | null;
  actor_email?: string | null;
  actor_role?: string | null;
  estate_id?: string | null;
  home_id?: string | null;
  room_id?: string | null;
  canonical_device_id?: string | null;
  parent_device_id?: string | null;
  target_type?: "device" | "device_channel" | "virtual_remote" | string | null;
  channel_code?: string | null;
  provider?: string | null;
  provider_device_id?: string | null;
  command_type?: string | null;
  normalized_command?: Record<string, any> | null;
  command_key?: string | null;
  source?: string | null;
  requested_at?: string | null;
  accepted_at?: string | null;
  dispatched_at?: string | null;
  provider_completed_at?: string | null;
  confirmation_started_at?: string | null;
  confirmation_completed_at?: string | null;
  finalised_at?: string | null;
  request_status?: string | null;
  dispatch_status?: string | null;
  provider_status?: string | null;
  confirmation_status?: string | null;
  physical_effect_status?: CommandPhysicalEffectStatus | string | null;
  provider_error_classification?: string | null;
  provider_error_code?: string | null;
  safe_error_message?: string | null;
  retryable?: boolean | null;
  expected_state?: Record<string, any> | null;
  observed_state?: Record<string, any> | null;
  previous_state?: Record<string, any> | null;
  final_status?: CommandLifecycleStatus | string | null;
  truth_state?: string | null;
  lifecycle?: Array<Record<string, any>>;
  metadata?: Record<string, any> | null;
};

function nowIso() {
  return new Date().toISOString();
}

function compact(value: unknown) {
  return String(value ?? "").trim() || null;
}

function dbStatus(status: string | null | undefined) {
  if (status === "state_confirmed") return "executed";
  if (["failed", "provider_rejected", "state_mismatch", "confirmation_timed_out", "cancelled"].includes(String(status))) return "failed";
  return "pending_confirmation";
}

const LIFECYCLE_RANK: Record<string, number> = {
  requested: 10,
  validated: 20,
  accepted_for_processing: 30,
  dispatching: 40,
  provider_accepted: 50,
  awaiting_state_confirmation: 60,
  state_confirmed: 100,
  provider_rejected: 100,
  state_mismatch: 100,
  confirmation_timed_out: 100,
  failed: 100,
  cancelled: 100,
};

function lifecycleRank(status: unknown) {
  return LIFECYCLE_RANK[String(status || "")] || 0;
}

function safeLifecycle(status: string, details?: Record<string, any>) {
  return {
    status,
    occurred_at: nowIso(),
    ...(details || {}),
  };
}

function publicRecord(row: any) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const result = metadata.result && typeof metadata.result === "object" ? metadata.result : {};
  return {
    ok: true,
    command_execution_id: String(row?.id || ""),
    execution_status: row?.execution_status || null,
    requested_at: row?.requested_at || null,
    completed_at: row?.completed_at || row?.executed_at || null,
    actor_id: row?.actor_user_id || row?.initiator_id || null,
    estate_id: row?.estate_id || null,
    home_id: row?.home_id || row?.unit_id || null,
    room_id: result.room_id || metadata.room_id || null,
    canonical_device_id: row?.device_id || result.canonical_device_id || null,
    channel_code: result.channel_code || null,
    command_key: result.command_key || null,
    request_status: result.request_status || null,
    dispatch_status: result.dispatch_status || null,
    provider_status: result.provider_status || null,
    confirmation_status: result.confirmation_status || null,
    physical_effect_status: result.physical_effect_status || null,
    final_status: result.final_status || row?.execution_status || null,
    truth_state: result.truth_state || null,
    safe_error_message: result.safe_error_message || row?.error_message || null,
    retryable: result.retryable ?? null,
    expected_state: result.expected_state || null,
    observed_state: result.observed_state || null,
    previous_state: result.previous_state || null,
    lifecycle: Array.isArray(result.lifecycle) ? result.lifecycle : [],
    metadata: {
      source: result.source || row?.execution_source || null,
      provider: row?.provider || result.provider || null,
      provider_error_classification: result.provider_error_classification || null,
      provider_error_code: result.provider_error_code || null,
    },
  };
}

function emitExecutionUpdate(record: Record<string, any>) {
  const io = getIO();
  if (!io) return;
  let target: any = io;
  if (record.estate_id) target = target.to(`estate:${record.estate_id}`);
  if (record.home_id) target = target.to(`home:${record.home_id}`);
  if (record.canonical_device_id) target = target.to(`device:${record.canonical_device_id}`);
  target.emit("command.execution.updated", record);
}

export function classifyCommandProviderError(error: any, operation = "device_command") {
  const classified = classifyProviderError(error, { provider: "tuya", operation });
  const explicitCode = compact(error?.code);
  const irClassification = explicitCode === "IR_REMOTE_BINDING_MISSING"
    ? "ir_remote_binding_missing"
    : explicitCode === "IR_KEY_NOT_SUPPORTED"
      ? "ir_key_not_supported"
      : explicitCode === "IR_REMOTE_RECONCILIATION_REQUIRED"
        ? "ir_remote_reconciliation_required"
        : explicitCode === "IR_KEY_RECONCILIATION_REQUIRED"
          ? "ir_key_reconciliation_required"
          : explicitCode === "IR_RAW_KEY_METADATA_INCOMPLETE"
            ? "ir_raw_key_metadata_incomplete"
            : explicitCode === "IR_ENDPOINT_INCOMPATIBLE"
              ? "ir_endpoint_incompatible"
              : explicitCode === "IR_PROVIDER_REJECTED" || explicitCode === "IR_PROVIDER_DISPATCH_UNCONFIRMED"
                ? "ir_provider_rejected"
                : null;
  return {
    classification: irClassification || classified.classification,
    provider_code: classified.provider_code || error?.code || null,
    safe_message: compact(error?.safe_error_message) || classified.safe_message || error?.message || "The provider did not complete the command.",
    retryable: Boolean(classified.retryable),
  };
}

export async function upsertDeviceCommandExecution(patch: DeviceCommandExecutionPatch) {
  const id = compact(patch.command_execution_id);
  if (!id) return null;
  const existing = await getDeviceCommandExecution(id).catch(() => null);
  const previous = (existing as any)?.metadata?.result || existing || {};
  const previousStatus = previous.final_status || previous.confirmation_status || previous.provider_status || null;
  const attemptedStatus = patch.final_status || patch.confirmation_status || patch.provider_status || previousStatus;
  if (previousStatus && attemptedStatus && lifecycleRank(attemptedStatus) < lifecycleRank(previousStatus)) {
    const expectedReplay = String(attemptedStatus) === "requested" && lifecycleRank(previousStatus) >= lifecycleRank("accepted_for_processing");
    if (expectedReplay) {
      logger.info("device_command_lifecycle_duplicate_replay_ignored", {
        command_execution_id: id,
        current_state: previousStatus,
        attempted_transition: attemptedStatus,
        producer: patch.source || previous.source || "device_command",
      });
      return existing;
    }
    logger.warn("device_command_invalid_transition_blocked", {
      command_execution_id: id,
      current_state: previousStatus,
      attempted_transition: attemptedStatus,
      producer: patch.source || previous.source || "device_command",
    });
    return existing;
  }
  const lifecycle = [
    ...(Array.isArray(previous.lifecycle) ? previous.lifecycle : []),
    ...(Array.isArray(patch.lifecycle) ? patch.lifecycle : patch.final_status ? [safeLifecycle(String(patch.final_status))] : []),
  ];
  const result = {
    ...previous,
    ...patch,
    command_execution_id: id,
    lifecycle,
  };
  const status = dbStatus(patch.final_status || patch.confirmation_status || patch.provider_status || previous.final_status);
  const completedAt = patch.finalised_at || patch.confirmation_completed_at || patch.provider_completed_at || (status === "failed" || status === "executed" ? nowIso() : null);
  const payload: Record<string, any> = {
    id,
    actor_user_id: patch.actor_id || previous.actor_id || null,
    actor_email: patch.actor_email || previous.actor_email || null,
    actor_role: patch.actor_role || previous.actor_role || null,
    estate_id: patch.estate_id || previous.estate_id || null,
    home_id: patch.home_id || previous.home_id || null,
    unit_id: patch.home_id || previous.home_id || null,
    device_id: patch.canonical_device_id || previous.canonical_device_id || null,
    provider: patch.provider || previous.provider || null,
    origin: patch.source || previous.source || "device_command",
    initiator_type: patch.source === "facility" ? "operator" : "resident",
    initiator_id: patch.actor_id || previous.actor_id || null,
    initiator_role: patch.actor_role || previous.actor_role || null,
    tool_id: "device_command",
    action: patch.command_type || previous.command_type || "device.command",
    execution_status: status,
    requested_at: patch.requested_at || previous.requested_at || nowIso(),
    started_at: patch.accepted_at || previous.accepted_at || patch.requested_at || previous.requested_at || nowIso(),
    completed_at: completedAt,
    executed_at: status === "executed" ? completedAt : null,
    error_message: patch.safe_error_message || previous.safe_error_message || null,
    result_summary: patch.safe_error_message || patch.final_status || previous.final_status || "Device command status updated.",
    provider_event_id: patch.metadata?.provider_event_id || previous.provider_event_id || null,
    correlation_id: patch.correlation_id || previous.correlation_id || null,
    execution_source: patch.source || previous.source || "device_command",
    verified: patch.confirmation_status === "state_confirmed",
    verification_method: patch.confirmation_status === "state_confirmed" ? "runtime_v2_state_confirmation" : null,
    metadata: {
      ...(existing as any)?.metadata,
      result,
    },
  };
  try {
    const { data, error } = await supabaseAdmin.from("ai_execution_ledger").upsert(payload as any, { onConflict: "id" }).select("*").maybeSingle();
    if (error) throw error;
    const publicUpdate = publicRecord(data || payload);
    logger.info("device_command_lifecycle_updated", {
      command_execution_id: id,
      target_type: result.target_type || null,
      device_id: result.canonical_device_id || null,
      channel_code: result.channel_code || null,
      previous_status: previous.final_status || null,
      new_status: result.final_status || null,
      provider_status: result.provider_status || null,
      confirmation_status: result.confirmation_status || null,
    });
    emitExecutionUpdate(publicUpdate);
    return publicUpdate;
  } catch (error) {
    logger.warn("device_command_execution_persist_failed", {
      command_execution_id: id,
      error_code: (error as any)?.code || null,
      message: (error as any)?.message || String(error),
    });
    return null;
  }
}

export async function getDeviceCommandExecution(commandExecutionId: string) {
  const id = compact(commandExecutionId);
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from("ai_execution_ledger")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? publicRecord(data) : null;
}
