import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";
import type { NormalizedSignal } from "../contracts/operationalSignal";
import type { SignalRuntimeReceipt } from "../runtime/universalSignalRuntime";
import type { RuntimeBundle } from "../service";
import { homeIdFromSignal, resolveIntelligencePolicy } from "../policy/intelligencePolicyResolver";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function signalKey(signal: NormalizedSignal) {
  return [
    signal.provider || signal.source,
    signal.providerEventId || signal.id,
    signal.domain,
    signal.entity.id || signal.entity.name || "unknown",
    signal.estateId || "global",
    homeIdFromSignal(signal) || "no-home",
  ].join(":");
}

export type DurableSignalResult = {
  persisted: boolean;
  duplicate: boolean;
  signalId: string | null;
  reason: string | null;
};

class CanonicalIntelligenceStore {
  private unavailable = false;

  async recordSignal(signal: NormalizedSignal, receipt: SignalRuntimeReceipt): Promise<DurableSignalResult> {
    if (this.unavailable) return { persisted: false, duplicate: false, signalId: null, reason: "store_unavailable" };
    const policy = resolveIntelligencePolicy(signal);
    const row = {
      canonical_signal_key: signalKey(signal),
      producer: text(signal.metadata.producer || signal.source || "unknown"),
      provider: signal.provider,
      provider_event_id: signal.providerEventId,
      signal_type: signal.type,
      domain: signal.domain,
      severity: signal.severity,
      confidence: signal.confidence,
      trust_score: signal.trustScore,
      verified: signal.verified,
      verification_method: signal.verificationMethod,
      estate_id: signal.estateId,
      building_id: signal.buildingId,
      home_id: homeIdFromSignal(signal),
      room_id: signal.room.id || text(signal.metadata.room_id) || null,
      entity_type: signal.entity.type,
      entity_id: signal.entity.id,
      actor_id: signal.actor.id,
      privacy_class: policy.privacyClass,
      occurred_at: signal.timestamp,
      payload: {
        signal,
        receipt: { accepted: receipt.accepted, duplicate: receipt.duplicate, outputs: receipt.outputs, issues: receipt.issues },
        output_policy: policy,
      },
      runtime_id: signal.runtimeId,
      correlation_id: signal.correlationId,
      execution_id: text(signal.metadata.execution_id || signal.metadata.executionId) || null,
    };
    try {
      const { data: existing, error: readError } = await supabaseAdmin
        .from("operational_signals")
        .select("id")
        .eq("canonical_signal_key", row.canonical_signal_key)
        .maybeSingle();
      if (readError && readError.code !== "PGRST116") throw readError;
      if (existing?.id) return { persisted: true, duplicate: true, signalId: existing.id, reason: "durable_duplicate" };
      const { data, error } = await supabaseAdmin
        .from("operational_signals")
        .insert(row as any)
        .select("id")
        .single();
      if (error) throw error;
      return { persisted: true, duplicate: false, signalId: data?.id || null, reason: null };
    } catch (error: any) {
      if (/relation .*operational_signals|does not exist/i.test(String(error?.message || ""))) this.unavailable = true;
      logger.warn("oyi_core_durable_signal_persist_failed", {
        signal_id: signal.id,
        reason: error?.message || "unknown",
      });
      return { persisted: false, duplicate: false, signalId: null, reason: error?.message || "persist_failed" };
    }
  }

  async recordBundle(bundle: RuntimeBundle, receipt: SignalRuntimeReceipt) {
    const signal = receipt.signal;
    const policy = resolveIntelligencePolicy(signal);
    const homeId = homeIdFromSignal(signal);
    await Promise.allSettled([
      ...bundle.awareness.map((item) =>
        supabaseAdmin.from("operational_awareness").upsert({
          awareness_key: item.id,
          audience: policy.privacyClass,
          status: "open",
          title: item.title,
          summary: item.summary,
          reason: item.reason,
          impact: item.impact,
          urgency: item.urgency,
          owner: item.owner,
          recommended_action: item.recommended_action,
          verification: item.verification,
          confidence: item.confidence,
          related_signals: item.related_signals,
          related_executions: item.related_executions,
          generated_at: item.generated_at,
          payload: item,
        } as any, { onConflict: "awareness_key" })
      ),
      ...bundle.recommendations.map((item) =>
        supabaseAdmin.from("operational_recommendations").upsert({
          recommendation_key: item.id,
          action_type: item.actionType,
          target: { domain: item.domain, owner: item.owner },
          title: item.title,
          summary: item.summary,
          reason: item.reason,
          expected_impact: item.expectedImpact,
          confidence: item.confidence,
          urgency: item.urgency,
          risk_class: item.approvalRequired ? "approval_required" : "review",
          verification_required: item.verificationRequired,
          approval_required: item.approvalRequired,
          safe_to_automate: false,
          status: item.status === "open" ? "pending" : item.status,
          generated_at: item.generatedAt,
          expires_at: item.expiresAt,
          payload: item,
          estate_id: signal.estateId,
          home_id: homeId,
          privacy_class: policy.privacyClass,
        } as any, { onConflict: "recommendation_key" })
      ),
    ]);
  }
}

export const canonicalIntelligenceStore = new CanonicalIntelligenceStore();
