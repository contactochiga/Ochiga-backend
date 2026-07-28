import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";
import type { NormalizedSignal } from "../contracts/operationalSignal";
import type { SignalRuntimeReceipt } from "../runtime/universalSignalRuntime";
import type { RuntimeBundle } from "../service";
import { homeIdFromSignal, resolveIntelligencePolicy } from "../policy/intelligencePolicyResolver";
import { correlateIncident, type IncidentCorrelation } from "../runtime/incidentCorrelation";
import type { OperationalInsight } from "../runtime/operationalReasoning";
import type { AutomationPlan } from "../runtime/safeAutomation";

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

export type DurableLifecycleResult = {
  incidentId: string | null;
  deliveryRows: number;
  persisted: boolean;
  issues: string[];
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

  private async upsertIncident(correlation: IncidentCorrelation, receipt: SignalRuntimeReceipt) {
    const signal = receipt.signal;
    const policy = resolveIntelligencePolicy(signal);
    const homeId = homeIdFromSignal(signal);
    const base = {
      incident_key: correlation.incidentKey,
      incident_type: correlation.incidentType,
      domain: correlation.domain,
      title: correlation.title,
      scope: correlation.scope,
      privacy_class: policy.privacyClass,
      status: correlation.status,
      severity: correlation.severity,
      confidence: correlation.confidence,
      owner_type: signal.actor.type || signal.initiatorType || "system",
      owner_id: signal.actor.id || signal.initiatorId || null,
      first_seen_at: signal.timestamp,
      last_seen_at: signal.timestamp,
      resolved_at: correlation.status === "resolved" ? signal.timestamp : null,
      current_summary: correlation.summary,
      affected_entities: correlation.affectedEntities,
      evidence: correlation.evidence,
      estate_id: signal.estateId,
      home_id: homeId,
      updated_at: new Date().toISOString(),
    };
    const { data: existing } = await supabaseAdmin
      .from("operational_incidents")
      .select("id,status,evidence,affected_entities,first_seen_at")
      .eq("incident_key", correlation.incidentKey)
      .maybeSingle();
    const merged = existing
      ? {
          ...base,
          first_seen_at: existing.first_seen_at || base.first_seen_at,
          evidence: [...(Array.isArray(existing.evidence) ? existing.evidence : []), ...correlation.evidence].slice(-24),
          affected_entities: [...(Array.isArray(existing.affected_entities) ? existing.affected_entities : []), ...correlation.affectedEntities].slice(-24),
        }
      : base;
    const { data, error } = await supabaseAdmin
      .from("operational_incidents")
      .upsert(merged as any, { onConflict: "incident_key" })
      .select("id")
      .single();
    if (error) throw error;

    if (correlation.recoveryOf) {
      await supabaseAdmin
        .from("operational_recommendations")
        .update({ status: "resolved", resolved_by: signal.actor.id || "oyi_core", updated_at: new Date().toISOString(), outcome: { resolved_by_signal: signal.id } } as any)
        .eq("incident_id", data?.id);
    }
    return data?.id || existing?.id || null;
  }

  private async persistInsights(insights: OperationalInsight[], incidentId: string | null) {
    await Promise.all(insights.map((item) =>
      supabaseAdmin.from("operational_insights").upsert({
        incident_id: incidentId,
        domain: item.domain,
        insight_type: item.source,
        reasoning_version: "v3",
        title: item.title,
        summary: item.summary,
        reason: item.reason,
        impact: item.impact,
        confidence: item.confidence,
        evidence: item.evidence,
        owner: item.owner,
        verification: item.verification,
        next_step: item.nextStep,
        status: "open",
        generated_at: item.generatedAt,
      } as any)
    ));
  }

  private async persistPlans(plans: AutomationPlan[]) {
    await Promise.all(plans.map((item) =>
      supabaseAdmin.from("operational_plans").upsert({
        plan_type: item.executionMode,
        canonical_operation_id: item.actionIntent,
        target: { entity: item.targetEntity, context: item.targetContext },
        preconditions: item.preconditions,
        safety_checks: item.safetyChecks,
        required_permissions: item.requiredPermissions,
        approval_state: item.approvalRequired ? "required" : "not_required",
        rollback_plan: item.rollbackPlan,
        status: item.status,
        generated_at: item.generatedAt,
        expires_at: item.expiresAt,
      } as any)
    ));
  }

  async recordBundle(bundle: RuntimeBundle, receipt: SignalRuntimeReceipt): Promise<DurableLifecycleResult> {
    const signal = receipt.signal;
    const policy = resolveIntelligencePolicy(signal);
    const homeId = homeIdFromSignal(signal);
    const issues: string[] = [];
    let incidentId: string | null = null;
    const correlation = correlateIncident(signal, bundle.awareness[0] || null);
    try {
      if (correlation) incidentId = await this.upsertIncident(correlation, receipt);
    } catch (error: any) {
      issues.push(`incident:${error?.message || "persist_failed"}`);
    }
    const results = await Promise.allSettled([
      ...bundle.awareness.map((item) =>
        supabaseAdmin.from("operational_awareness").upsert({
          incident_id: correlation?.suppressChildAwareness ? null : incidentId,
          awareness_key: item.id,
          audience: policy.privacyClass,
          status: correlation?.suppressChildAwareness ? "suppressed" : correlation?.status === "resolved" ? "resolved" : "open",
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
          incident_id: incidentId,
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
    for (const result of results) {
      if (result.status === "rejected") issues.push(result.reason?.message || "bundle_persist_failed");
    }
    try {
      await this.persistInsights(bundle.insights, incidentId);
      await this.persistPlans(bundle.automationPlans);
    } catch (error: any) {
      issues.push(`artifact:${error?.message || "persist_failed"}`);
    }
    let deliveryRows = 0;
    try {
      deliveryRows = await this.createDeliveryOutbox(receipt, bundle, incidentId);
    } catch (error: any) {
      issues.push(`outbox:${error?.message || "persist_failed"}`);
    }
    return { incidentId, deliveryRows, persisted: issues.length === 0, issues };
  }

  async createDeliveryOutbox(receipt: SignalRuntimeReceipt, bundle: RuntimeBundle, incidentId: string | null) {
    const signal = receipt.signal;
    const policy = resolveIntelligencePolicy(signal);
    const channels = receipt.outputs.flatMap((output) => {
      if (output === "activity") return ["activity:event"];
      if (output === "notifications") return ["notification:event"];
      if (output === "conversation") return ["conversation:response"];
      if (output === "executive_intelligence") return ["executive:briefing"];
      if (output === "digital_twin") return ["future:digital-twin"];
      if (output === "infrastructure_registry" || output === "operational_intelligence") return ["facility:awareness"];
      return [];
    });
    const unique = [...new Set(channels)];
    if (!unique.length) return 0;
    const rows = unique.map((channel) => ({
      delivery_key: `${signal.id}:${channel}`,
      channel,
      audience: { privacy_class: policy.privacyClass, estate_id: signal.estateId, home_id: homeIdFromSignal(signal), actor_id: signal.actor.id },
      payload: {
        signal_id: signal.id,
        incident_id: incidentId,
        awareness: bundle.awareness.map((item) => item.id),
        insights: bundle.insights.map((item) => item.id),
        recommendations: bundle.recommendations.map((item) => item.id),
        plans: bundle.automationPlans.map((item) => item.id),
        receipt: { outputs: receipt.outputs, accepted: receipt.accepted, duplicate: receipt.duplicate },
      },
      redaction_version: "v1",
      status: "pending",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabaseAdmin.from("operational_delivery_outbox").upsert(rows as any, { onConflict: "delivery_key" });
    if (error) throw error;
    return rows.length;
  }

  async processDeliveryOutbox(limit = 25) {
    const { data, error } = await supabaseAdmin
      .from("operational_delivery_outbox")
      .select("id,delivery_key,attempt_count")
      .in("status", ["pending", "retry"])
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw error;
    const rows = data || [];
    for (const row of rows as any[]) {
      const attempts = Number(row.attempt_count || 0) + 1;
      const status = attempts >= 5 ? "dead_letter" : "acknowledged";
      await supabaseAdmin
        .from("operational_delivery_outbox")
        .update({
          status,
          attempt_count: attempts,
          acknowledged_at: status === "acknowledged" ? new Date().toISOString() : null,
          dead_letter_at: status === "dead_letter" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", row.id);
    }
    return { processed: rows.length };
  }

  async recordFeedback(input: { objectType: string; objectId: string; feedbackType: string; actorId?: string | null; reason?: string | null; outcome?: Record<string, unknown> }) {
    const { error } = await supabaseAdmin.from("intelligence_feedback").insert({
      object_type: input.objectType,
      object_id: input.objectId,
      feedback_type: input.feedbackType,
      actor_id: input.actorId || null,
      reason: input.reason || null,
      outcome_metadata: input.outcome || {},
    } as any);
    if (error) throw error;
    if (input.objectType === "recommendation" && ["dismissed", "not_useful", "false_positive"].includes(input.feedbackType)) {
      await supabaseAdmin
        .from("operational_recommendations")
        .update({ status: "dismissed", dismissed_by: input.actorId || "unknown", updated_at: new Date().toISOString(), outcome: input.outcome || {} } as any)
        .eq("recommendation_key", input.objectId);
    }
  }
}

export const canonicalIntelligenceStore = new CanonicalIntelligenceStore();
