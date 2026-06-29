import { supabaseAdmin } from "../../supabase/supabaseClient";
import type { NormalizedSignal, SignalEvidence } from "../contracts/operationalSignal";
import type { SignalRuntimeReceipt } from "./universalSignalRuntime";

export type ExecutionStatus =
  | "pending_confirmation"
  | "confirmed"
  | "denied"
  | "expired"
  | "recorded"
  | "executed"
  | "failed";

export type ExecutionLedgerRecord = {
  executionId: string;
  runtimeId: string;
  signalId: string;
  estate: string | null;
  building: string | null;
  unit: string | null;
  device: string | null;
  provider: string | null;
  origin: string | null;
  initiator: {
    type: string | null;
    id: string | null;
    role: string | null;
    name: string | null;
  };
  action: string;
  requestedAt: string;
  startedAt: string;
  completedAt: string | null;
  duration: number | null;
  status: ExecutionStatus;
  result: Record<string, unknown>;
  approvalRequired: boolean;
  approvedBy: string | null;
  rollbackAvailable: boolean;
  rollbackExecuted: boolean;
  verification: {
    verified: boolean;
    method: string | null;
    trustScore: number;
  };
  evidence: SignalEvidence[];
  reasoningReference: string | null;
  recommendationReference: string | null;
  automationReference: string | null;
  conversationReference: string | null;
  executiveReference: string | null;
  triggerReason: string | null;
  providerEventId: string | null;
  sessionId: string | null;
  correlationId: string | null;
  executionSource: string | null;
};

export type ExecutionStatistics = {
  total: number;
  successRate: number;
  failedExecutions: number;
  approvalRequired: number;
  approvalsGranted: number;
  rollbackAvailable: number;
  rollbacksExecuted: number;
  physicalActions: number;
  manualActions: number;
  automationActions: number;
  providerActions: number;
};

export type NamedExecutionStat = {
  id: string;
  label: string;
  count: number;
  successRate: number;
};

type ExecutionUpdate = Partial<
  Pick<
    ExecutionLedgerRecord,
    | "completedAt"
    | "duration"
    | "status"
    | "result"
    | "approvalRequired"
    | "approvedBy"
    | "rollbackAvailable"
    | "rollbackExecuted"
    | "verification"
    | "evidence"
    | "reasoningReference"
    | "recommendationReference"
    | "automationReference"
    | "conversationReference"
    | "executiveReference"
  >
>;

export type ExecutionLedgerScope = {
  estateId?: string | null;
  homeId?: string | null;
  deviceId?: string | null;
  provider?: string | null;
  origin?: string | null;
  action?: string | null;
  initiatorId?: string | null;
  status?: string | null;
  limit?: number;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function percent(ok: number, total: number) {
  if (!total) return 0;
  return Math.round((ok / total) * 1000) / 10;
}

function bool(value: unknown) {
  return value === true;
}

function recordId(signal: NormalizedSignal) {
  return text(signal.metadata.execution_id || signal.metadata.executionId || signal.runtimeId || signal.id) || `execution:${signal.id}`;
}

function fromMemory(record: ExecutionLedgerRecord) {
  return {
    id: record.executionId,
    runtime_id: record.runtimeId,
    signal_id: record.signalId,
    estate_id: record.estate,
    building_id: record.building,
    unit_id: record.unit,
    device_id: record.device,
    provider: record.provider,
    origin: record.origin,
    initiator_type: record.initiator.type,
    initiator_id: record.initiator.id,
    initiator_role: record.initiator.role,
    initiator_name: record.initiator.name,
    tool_id: record.action,
    action: record.action,
    execution_status: record.status,
    requested_at: record.requestedAt,
    confirmed_at: record.approvedBy ? record.completedAt : null,
    executed_at: record.status === "executed" ? record.completedAt : null,
    denied_at: record.status === "denied" ? record.completedAt : null,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    duration_ms: record.duration,
    result_summary: text(record.result.summary || record.result.status || record.status),
    error_message: text(record.result.error),
    approval_required: record.approvalRequired,
    approved_by: record.approvedBy,
    rollback_available: record.rollbackAvailable,
    rollback_executed: record.rollbackExecuted,
    verification: record.verification,
    evidence: record.evidence,
    reasoning_reference: record.reasoningReference,
    recommendation_reference: record.recommendationReference,
    automation_reference: record.automationReference,
    conversation_reference: record.conversationReference,
    executive_reference: record.executiveReference,
    provider_event_id: record.providerEventId,
    session_id: record.sessionId,
    correlation_id: record.correlationId,
    trigger_reason: record.triggerReason,
    verified: record.verification.verified,
    verification_method: record.verification.method,
    trust_score: record.verification.trustScore,
    execution_source: record.executionSource,
    metadata: {
      result: record.result,
      action: record.action,
    },
  };
}

function toExecutionRecord(row: any): ExecutionLedgerRecord {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const verification = row?.verification && typeof row.verification === "object" ? row.verification : {};
  const result = metadata?.result && typeof metadata.result === "object" ? metadata.result : {};
  const evidence = Array.isArray(row?.evidence)
    ? row.evidence
    : Array.isArray(metadata?.evidence)
    ? metadata.evidence
    : [];
  return {
    executionId: text(row?.id || metadata.executionId),
    runtimeId: text(row?.runtime_id || metadata.runtimeId || row?.signal_id) || `runtime:${text(row?.signal_id || row?.id)}`,
    signalId: text(row?.signal_id || metadata.signalId),
    estate: text(row?.estate_id || metadata.estateId) || null,
    building: text(row?.building_id || metadata.buildingId) || null,
    unit: text(row?.unit_id || metadata.unitId) || null,
    device: text(row?.device_id || metadata.deviceId) || null,
    provider: text(row?.provider || metadata.provider) || null,
    origin: text(row?.origin || metadata.origin) || null,
    initiator: {
      type: text(row?.initiator_type || metadata.initiatorType) || null,
      id: text(row?.initiator_id || row?.actor_user_id || metadata.initiatorId) || null,
      role: text(row?.initiator_role || row?.actor_role || metadata.initiatorRole) || null,
      name: text(row?.initiator_name || metadata.initiatorName) || null,
    },
    action: text(row?.action || row?.tool_id || metadata.action),
    requestedAt: text(row?.requested_at || row?.created_at) || new Date().toISOString(),
    startedAt: text(row?.started_at || row?.requested_at || row?.created_at) || new Date().toISOString(),
    completedAt: text(row?.completed_at || row?.executed_at || row?.denied_at) || null,
    duration: typeof row?.duration_ms === "number" ? row.duration_ms : null,
    status: (text(row?.execution_status || row?.status) || "recorded") as ExecutionStatus,
    result,
    approvalRequired: bool(row?.approval_required ?? metadata.approvalRequired),
    approvedBy: text(row?.approved_by || metadata.approvedBy) || null,
    rollbackAvailable: bool(row?.rollback_available ?? metadata.rollbackAvailable),
    rollbackExecuted: bool(row?.rollback_executed ?? metadata.rollbackExecuted),
    verification: {
      verified: bool(row?.verified ?? verification?.verified),
      method: text(row?.verification_method || verification?.method) || null,
      trustScore: typeof row?.trust_score === "number" ? row.trust_score : typeof verification?.trustScore === "number" ? verification.trustScore : 0.65,
    },
    evidence,
    reasoningReference: text(row?.reasoning_reference || metadata.reasoningReference) || null,
    recommendationReference: text(row?.recommendation_reference || metadata.recommendationReference) || null,
    automationReference: text(row?.automation_reference || metadata.automationReference) || null,
    conversationReference: text(row?.conversation_reference || metadata.conversationReference) || null,
    executiveReference: text(row?.executive_reference || metadata.executiveReference) || null,
    triggerReason: text(row?.trigger_reason || metadata.triggerReason) || null,
    providerEventId: text(row?.provider_event_id || metadata.providerEventId) || null,
    sessionId: text(row?.session_id || metadata.sessionId) || null,
    correlationId: text(row?.correlation_id || metadata.correlationId) || null,
    executionSource: text(row?.execution_source || metadata.executionSource) || null,
  };
}

class ExecutionLedgerService {
  private records = new Map<string, ExecutionLedgerRecord>();
  private bySignal = new Map<string, string>();

  startForSignal(signal: NormalizedSignal, receipt: SignalRuntimeReceipt, startedAt = new Date().toISOString()) {
    const executionId = recordId(signal);
    const record: ExecutionLedgerRecord = {
      executionId,
      runtimeId: signal.runtimeId || `runtime:${signal.id}`,
      signalId: signal.id,
      estate: signal.estateId || signal.estate.id || null,
      building: signal.buildingId || signal.building.id || null,
      unit: signal.unitId || null,
      device: signal.entity.id || null,
      provider: signal.provider || signal.source || null,
      origin: signal.origin || null,
      initiator: {
        type: signal.initiatorType || signal.actor.type || null,
        id: signal.initiatorId || signal.actor.id || null,
        role: signal.actor.role || null,
        name: signal.actor.name || null,
      },
      action: text(signal.type || signal.domain || signal.source) || "signal.processed",
      requestedAt: signal.timestamp,
      startedAt,
      completedAt: null,
      duration: null,
      status: receipt.accepted ? "recorded" : "failed",
      result: {
        accepted: receipt.accepted,
        duplicate: receipt.duplicate,
        outputs: receipt.outputs,
        issues: receipt.issues,
        priority: receipt.priority,
        summary: receipt.accepted ? "Signal accepted into Oyi Core." : "Signal failed validation or was deduplicated.",
      },
      approvalRequired: false,
      approvedBy: null,
      rollbackAvailable: false,
      rollbackExecuted: false,
      verification: {
        verified: signal.verified,
        method: signal.verificationMethod || null,
        trustScore: signal.trustScore,
      },
      evidence: signal.evidence,
      reasoningReference: null,
      recommendationReference: null,
      automationReference: null,
      conversationReference: null,
      executiveReference: null,
      triggerReason: signal.triggerReason || null,
      providerEventId: signal.providerEventId || null,
      sessionId: signal.sessionId || null,
      correlationId: signal.correlationId || null,
      executionSource: signal.executionSource || null,
    };
    this.records.set(record.executionId, record);
    this.bySignal.set(signal.id, record.executionId);
    void this.persist(record);
    return record;
  }

  complete(executionId: string, update: ExecutionUpdate = {}) {
    const current = this.records.get(executionId);
    if (!current) return null;
    const next: ExecutionLedgerRecord = {
      ...current,
      ...update,
      result: update.result ? { ...current.result, ...update.result } : current.result,
      verification: update.verification ? { ...current.verification, ...update.verification } : current.verification,
      evidence: update.evidence || current.evidence,
    };
    this.records.set(executionId, next);
    void this.persist(next);
    return next;
  }

  get(executionId: string) {
    return this.records.get(executionId) || null;
  }

  findBySignalId(signalId: string) {
    const executionId = this.bySignal.get(signalId);
    return executionId ? this.records.get(executionId) || null : null;
  }

  findRelated(signals: NormalizedSignal[], limit = 50) {
    const signalIds = new Set(signals.map((signal) => signal.id));
    return [...this.records.values()]
      .filter((record) => signalIds.has(record.signalId))
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
      .slice(0, limit);
  }

  private matchesScope(record: ExecutionLedgerRecord, scope: ExecutionLedgerScope) {
    const estateId = text(scope.estateId);
    const homeId = text(scope.homeId);
    const deviceId = text(scope.deviceId);
    const provider = lower(scope.provider);
    const origin = lower(scope.origin);
    const action = lower(scope.action);
    const initiatorId = text(scope.initiatorId);
    const status = lower(scope.status);

    if (estateId && text(record.estate) !== estateId) return false;
    if (homeId && text(record.unit) !== homeId) return false;
    if (deviceId && text(record.device) !== deviceId) return false;
    if (provider && lower(record.provider) !== provider) return false;
    if (origin && lower(record.origin) !== origin) return false;
    if (action && !lower(record.action).includes(action)) return false;
    if (initiatorId && text(record.initiator.id) !== initiatorId) return false;
    if (status && lower(record.status) !== status) return false;
    return true;
  }

  list(scope: ExecutionLedgerScope = {}) {
    const records = [...this.records.values()]
      .filter((record) => this.matchesScope(record, scope))
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
    return records.slice(0, Math.max(1, Math.min(scope.limit || 100, 200)));
  }

  async listPersisted(scope: ExecutionLedgerScope = {}) {
    try {
      let query = supabaseAdmin
        .from("ai_execution_ledger")
        .select("*")
        .order("requested_at", { ascending: false })
        .limit(Math.max(1, Math.min(scope.limit || 100, 200)));
      if (scope.estateId) query = query.eq("estate_id", scope.estateId);
      if (scope.homeId) query = query.or(`unit_id.eq.${scope.homeId},home_id.eq.${scope.homeId}`);
      if (scope.deviceId) query = query.eq("device_id", scope.deviceId);
      if (scope.provider) query = query.eq("provider", scope.provider);
      if (scope.origin) query = query.eq("origin", scope.origin);
      if (scope.initiatorId) query = query.eq("initiator_id", scope.initiatorId);
      if (scope.status) query = query.eq("execution_status", scope.status);
      const { data, error } = await query;
      if (error) throw error;
      return (data || [])
        .map(toExecutionRecord)
        .filter((record) => this.matchesScope(record, scope));
    } catch {
      return this.list(scope);
    }
  }

  summarize(records: ExecutionLedgerRecord[]) {
    const totals = records.reduce(
      (acc, record) => {
        acc.total += 1;
        if (record.status === "executed") acc.ok += 1;
        if (record.status === "failed") acc.failed += 1;
        if (record.approvalRequired) acc.approvalRequired += 1;
        if (record.approvedBy) acc.approved += 1;
        if (record.rollbackAvailable) acc.rollbackAvailable += 1;
        if (record.rollbackExecuted) acc.rollbackExecuted += 1;
        if (record.origin === "physical") acc.physical += 1;
        if (["consumer_app", "facility_app", "office_app", "voice_assistant", "api"].includes(lower(record.origin))) acc.manual += 1;
        if (record.origin === "automation") acc.automation += 1;
        if (record.origin === "provider") acc.provider += 1;
        return acc;
      },
      { total: 0, ok: 0, failed: 0, approvalRequired: 0, approved: 0, rollbackAvailable: 0, rollbackExecuted: 0, physical: 0, manual: 0, automation: 0, provider: 0 }
    );

    return {
      total: totals.total,
      successRate: percent(totals.ok, totals.total),
      failedExecutions: totals.failed,
      approvalRequired: totals.approvalRequired,
      approvalsGranted: totals.approved,
      rollbackAvailable: totals.rollbackAvailable,
      rollbacksExecuted: totals.rollbackExecuted,
      physicalActions: totals.physical,
      manualActions: totals.manual,
      automationActions: totals.automation,
      providerActions: totals.provider,
    } satisfies ExecutionStatistics;
  }

  groupBy(records: ExecutionLedgerRecord[], key: "operator" | "provider" | "estate") {
    const counts = new Map<string, { label: string; total: number; ok: number }>();
    for (const record of records) {
      const id =
        key === "operator"
          ? text(record.initiator.id || record.initiator.name || "system")
          : key === "provider"
          ? text(record.provider || "unknown")
          : text(record.estate || "unknown");
      const label =
        key === "operator"
          ? text(record.initiator.name || record.initiator.role || record.initiator.id || "System")
          : id;
      const current = counts.get(id) || { label, total: 0, ok: 0 };
      current.total += 1;
      if (record.status === "executed") current.ok += 1;
      counts.set(id, current);
    }
    return [...counts.entries()]
      .map(([id, value]) => ({ id, label: value.label, count: value.total, successRate: percent(value.ok, value.total) }))
      .sort((a, b) => b.count - a.count || b.successRate - a.successRate)
      .slice(0, 10) satisfies NamedExecutionStat[];
  }

  timeline(records: ExecutionLedgerRecord[]) {
    return records
      .slice()
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
      .map((record) => ({
        executionId: record.executionId,
        requestedAt: record.requestedAt,
        completedAt: record.completedAt,
        status: record.status,
        action: record.action,
        origin: record.origin,
        provider: record.provider,
        initiatorId: record.initiator.id,
        estate: record.estate,
      }));
  }

  private async persist(record: ExecutionLedgerRecord) {
    try {
      const payload = fromMemory(record);
      const { error } = await supabaseAdmin.from("ai_execution_ledger").upsert(payload as any, { onConflict: "id" });
      if (error) throw error;
    } catch {
      // Keep the in-memory ledger available even when the database is not reachable.
    }
  }
}

export const executionLedger = new ExecutionLedgerService();
