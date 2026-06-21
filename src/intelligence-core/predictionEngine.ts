import { supabaseAdmin } from "../supabase/supabaseClient";
import type { AuthUser } from "../middleware/auth";
import { filterEventsForActor, getIntelligencePermissionPolicy } from "./permissionEngine";
import { recordAgentObservation } from "./observability";
import { authenticatedActorScope } from "../security/actorScope";

export type IntelligencePredictionType =
  | "device_anomaly"
  | "camera_anomaly"
  | "maintenance_risk"
  | "security_risk"
  | "visitor_pattern"
  | "power_or_network_instability"
  | "edge_runtime_risk"
  | "operational_recommendation";

export type IntelligencePrediction = {
  id?: string;
  prediction_type: IntelligencePredictionType;
  title: string;
  summary: string;
  confidence: "confirmed" | "likely" | "possible" | "needs_monitoring";
  severity: "info" | "attention" | "warning" | "critical";
  agent_id: string;
  estate_id?: string | null;
  home_id?: string | null;
  camera_id?: string | null;
  source_event_ids: string[];
  evidence: Array<Record<string, unknown>>;
  recommended_action: string;
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  created_at?: string;
  metadata?: Record<string, unknown>;
};

export type PredictionRunOptions = {
  actor?: AuthUser | null;
  estate_id?: string | null;
  home_id?: string | null;
  persist?: boolean;
  limit?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function sinceIso(days: number) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function asArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? value : [];
}

function eventId(row: any) {
  return String(row?.id || row?.source_event_id || row?.provider_event_id || "").trim();
}

function evidence(row: any, source: string) {
  return {
    source,
    id: eventId(row) || null,
    event_type: row.event_type || row.action || row.type || null,
    occurred_at: row.occurred_at || row.created_at || row.updated_at || null,
    title: row.title || row.message || null,
  };
}

function makePrediction(input: Omit<IntelligencePrediction, "agent_id" | "status">): IntelligencePrediction {
  return { ...input, agent_id: "intelligence_core", status: "open" };
}

async function safeSelect(table: string, select: string, apply: (query: any) => any) {
  try {
    const { data, error } = await apply(supabaseAdmin.from(table).select(select));
    if (error) return { rows: [], warning: `${table}: ${error.message}` };
    return { rows: data || [] };
  } catch (err: any) {
    return { rows: [], warning: `${table}: ${err?.message || "query failed"}` };
  }
}

function scoped(query: any, estateId?: string | null, homeId?: string | null) {
  if (estateId) query = query.eq("estate_id", estateId);
  if (homeId) query = query.eq("home_id", homeId);
  return query;
}

function groupBy<T>(rows: T[], keyFn: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFn(row) || "unknown";
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return groups;
}

export async function generateIntelligencePredictions(options: PredictionRunOptions = {}) {
  const started = Date.now();
  const actor = options.actor || null;
  const scope = actor ? authenticatedActorScope(actor) : options;
  const estateId = scope.estate_id || null;
  const homeId = scope.home_id || null;
  const limit = Math.max(10, Math.min(500, Number(options.limit || 250)));
  const warnings: string[] = [];

  const [deviceEvents, counters, timeline, cameraEvents, maintenance, visitors, notifications, audit, intelligenceEvents] = await Promise.all([
    safeSelect("device_events", "*", (q) => scoped(q.gte("occurred_at", sinceIso(7)).order("occurred_at", { ascending: false }).limit(limit), estateId, homeId)),
    safeSelect("device_usage_counters", "*", (q) => scoped(q.order("updated_at", { ascending: false }).limit(limit), estateId, homeId)),
    safeSelect("home_timeline", "*", (q) => scoped(q.gte("occurred_at", sinceIso(7)).order("occurred_at", { ascending: false }).limit(limit), estateId, homeId)),
    safeSelect("camera_events", "*", (q) => {
      let query = q.gte("created_at", sinceIso(7)).order("created_at", { ascending: false }).limit(limit);
      if (estateId) query = query.eq("estate_id", estateId);
      return query;
    }),
    safeSelect("maintenance_requests", "*", (q) => scoped(q.order("updated_at", { ascending: false }).limit(limit), estateId, homeId)),
    safeSelect("visitors", "*", (q) => scoped(q.gte("created_at", sinceIso(7)).order("created_at", { ascending: false }).limit(limit), estateId, homeId)),
    safeSelect("notifications", "id,user_id,estate_id,title,message,type,payload,status,created_at", (q) => {
      let query = q.gte("created_at", sinceIso(7)).order("created_at", { ascending: false }).limit(limit);
      if (estateId) query = query.eq("estate_id", estateId);
      if (actor?.id) query = query.eq("user_id", actor.id);
      return query;
    }),
    safeSelect("audit_events", "*", (q) => scoped(q.gte("created_at", sinceIso(7)).order("created_at", { ascending: false }).limit(limit), estateId, homeId)),
    safeSelect("ochiga_intelligence_events", "*", (q) => scoped(q.gte("occurred_at", sinceIso(7)).order("occurred_at", { ascending: false }).limit(limit), estateId, homeId)),
  ]);

  for (const result of [deviceEvents, counters, timeline, cameraEvents, maintenance, visitors, notifications, audit, intelligenceEvents]) {
    if (result.warning) warnings.push(result.warning);
  }

  const predictions: IntelligencePrediction[] = [];
  const deviceOfflineEvents = deviceEvents.rows.filter((row: any) => /offline|failure|failed|disconnect/i.test(`${row.event_type} ${JSON.stringify(row.new_state || {})}`));
  const offlineByDevice = groupBy(deviceOfflineEvents, (row: any) => String(row.device_id || "unknown"));
  for (const [deviceId, rows] of offlineByDevice) {
    if (deviceId !== "unknown" && rows.length >= 3) {
      predictions.push(makePrediction({
        prediction_type: "device_anomaly",
        title: "Possible device reliability issue",
        summary: `This device produced ${rows.length} offline or failure signals recently. It may need monitoring or inspection.`,
        confidence: rows.length >= 5 ? "likely" : "possible",
        severity: rows.length >= 5 ? "warning" : "attention",
        estate_id: rows[0]?.estate_id || estateId,
        home_id: rows[0]?.home_id || homeId,
        source_event_ids: rows.map(eventId).filter(Boolean).slice(0, 10),
        evidence: rows.slice(0, 5).map((row) => evidence(row, "device_events")),
        recommended_action: "Review the device health history and inspect power or network stability if the pattern continues.",
      }));
    }
  }

  const offlineClusters = deviceOfflineEvents.filter((row: any) => new Date(row.occurred_at || row.created_at).getTime() >= Date.now() - DAY_MS);
  if (offlineClusters.length >= 3) {
    const affectedDevices = new Set(offlineClusters.map((row: any) => row.device_id).filter(Boolean));
    predictions.push(makePrediction({
      prediction_type: "power_or_network_instability",
      title: "Possible power or network interruption",
      summary: `${affectedDevices.size || offlineClusters.length} devices reported offline or failure signals within the last 24 hours. This may indicate power or network instability.`,
      confidence: affectedDevices.size >= 4 ? "likely" : "possible",
      severity: affectedDevices.size >= 4 ? "warning" : "attention",
      estate_id: offlineClusters[0]?.estate_id || estateId,
      home_id: offlineClusters[0]?.home_id || homeId,
      source_event_ids: offlineClusters.map(eventId).filter(Boolean).slice(0, 12),
      evidence: offlineClusters.slice(0, 6).map((row: any) => evidence(row, "device_events")),
      recommended_action: "Check whether affected devices share the same room, circuit, router, or Edge connection before treating this as a confirmed outage.",
    }));
  }

  for (const row of counters.rows as any[]) {
    const failureCount = Number(row.failure_count || row.command_failure_count || 0);
    const offlineCount = Number(row.offline_count || 0);
    if (failureCount + offlineCount >= 5) {
      predictions.push(makePrediction({
        prediction_type: "device_anomaly",
        title: "Device reliability needs monitoring",
        summary: "A device has accumulated repeated failures or offline reports in usage counters.",
        confidence: "needs_monitoring",
        severity: "attention",
        estate_id: row.estate_id || estateId,
        home_id: row.home_id || homeId,
        source_event_ids: [String(row.device_id || "")].filter(Boolean),
        evidence: [{ source: "device_usage_counters", device_id: row.device_id, failure_count: failureCount, offline_count: offlineCount }],
        recommended_action: "Review device usage counters and recent event history before replacing or re-pairing the device.",
      }));
    }
  }

  const cameraProblemEvents = cameraEvents.rows.filter((row: any) => /offline|tamper|signal|intrusion|person|vehicle|motion/i.test(`${row.event_type} ${row.message || ""}`));
  const cameraById = groupBy(cameraProblemEvents, (row: any) => String(row.camera_id || "unknown"));
  for (const [cameraId, rows] of cameraById) {
    if (cameraId !== "unknown" && rows.length >= 2) {
      const offline = rows.filter((row: any) => /offline|signal|tamper/i.test(String(row.event_type || "")));
      predictions.push(makePrediction({
        prediction_type: offline.length ? "camera_anomaly" : "security_risk",
        title: offline.length ? "Possible camera or Edge instability" : "Camera activity needs review",
        summary: offline.length
          ? `This camera produced ${offline.length} stream or health signals recently. It may need Edge/runtime inspection.`
          : `This camera produced ${rows.length} security-related events recently. Review before escalating.`,
        confidence: rows.length >= 4 ? "likely" : "possible",
        severity: offline.length ? "attention" : "warning",
        estate_id: rows[0]?.estate_id || estateId,
        camera_id: cameraId,
        source_event_ids: rows.map(eventId).filter(Boolean).slice(0, 10),
        evidence: rows.slice(0, 5).map((row: any) => evidence(row, "camera_events")),
        recommended_action: offline.length ? "Check Edge health, DVR channel mapping, and stream availability." : "Review camera events in Facility before notifying residents.",
      }));
    }
  }

  const openMaintenance = maintenance.rows.filter((row: any) => !/completed|closed|resolved/i.test(String(row.status || "")));
  for (const row of openMaintenance as any[]) {
    const updated = new Date(row.updated_at || row.created_at || Date.now()).getTime();
    const ageDays = Math.floor((Date.now() - updated) / DAY_MS);
    if (ageDays >= 3) {
      predictions.push(makePrediction({
        prediction_type: "maintenance_risk",
        title: "Maintenance follow-up may be needed",
        summary: `A maintenance request has remained open for about ${ageDays} days. It may need follow-up.`,
        confidence: ageDays >= 7 ? "likely" : "possible",
        severity: ageDays >= 7 ? "warning" : "attention",
        estate_id: row.estate_id || estateId,
        home_id: row.home_id || homeId,
        source_event_ids: [eventId(row)].filter(Boolean),
        evidence: [evidence(row, "maintenance_requests")],
        recommended_action: "Review the request status and post a resident-visible update if needed.",
      }));
    }
  }

  if (visitors.rows.length >= 8) {
    predictions.push(makePrediction({
      prediction_type: "visitor_pattern",
      title: "Visitor activity spike needs monitoring",
      summary: `${visitors.rows.length} visitor records were created recently. This may be normal, but it is worth monitoring for access workload.`,
      confidence: visitors.rows.length >= 15 ? "likely" : "possible",
      severity: visitors.rows.length >= 15 ? "attention" : "info",
      estate_id: visitors.rows[0]?.estate_id || estateId,
      home_id: visitors.rows[0]?.home_id || homeId,
      source_event_ids: visitors.rows.map(eventId).filter(Boolean).slice(0, 12),
      evidence: visitors.rows.slice(0, 6).map((row: any) => evidence(row, "visitors")),
      recommended_action: "Review visitor queue load and gate/security handling if the spike continues.",
    }));
  }

  const securitySignals = [...notifications.rows, ...timeline.rows, ...audit.rows, ...intelligenceEvents.rows].filter((row: any) => /security|critical|incident|alert|emergency/i.test(`${row.type || ""} ${row.category || ""} ${row.title || ""} ${row.message || ""} ${row.action || ""}`));
  if (securitySignals.length >= 2) {
    predictions.push(makePrediction({
      prediction_type: "security_risk",
      title: "Security signals need review",
      summary: `${securitySignals.length} recent security-related signals were recorded. This needs review, not automatic escalation.`,
      confidence: securitySignals.length >= 4 ? "likely" : "possible",
      severity: securitySignals.length >= 4 ? "warning" : "attention",
      estate_id: securitySignals[0]?.estate_id || estateId,
      home_id: securitySignals[0]?.home_id || homeId,
      source_event_ids: securitySignals.map(eventId).filter(Boolean).slice(0, 12),
      evidence: securitySignals.slice(0, 6).map((row: any) => evidence(row, "security_sources")),
      recommended_action: "Review the security timeline and confirm whether these signals are related.",
    }));
  }

  if (warnings.length) {
    predictions.push(makePrediction({
      prediction_type: "operational_recommendation",
      title: "Prediction engine source coverage is incomplete",
      summary: "Some intelligence sources were unavailable during this run. Predictions may be incomplete until those tables or migrations are available.",
      confidence: "confirmed",
      severity: "info",
      estate_id: estateId,
      home_id: homeId,
      source_event_ids: [],
      evidence: warnings.map((warning) => ({ warning })),
      recommended_action: "Apply pending migrations and verify source tables before relying on full prediction coverage.",
    }));
  }

  const roleFiltered = actor ? filterPredictionsForActor(predictions, actor) : predictions;
  const finalPredictions = roleFiltered.slice(0, Math.max(1, Math.min(50, Number(options.limit || 50))));

  let persisted: any[] = [];
  if (options.persist !== false && finalPredictions.length) {
    const rows = finalPredictions.map((prediction) => ({
      prediction_type: prediction.prediction_type,
      title: prediction.title,
      summary: prediction.summary,
      confidence: prediction.confidence,
      severity: prediction.severity,
      agent_id: prediction.agent_id,
      estate_id: prediction.estate_id || null,
      home_id: prediction.home_id || null,
      camera_id: prediction.camera_id || null,
      source_event_ids: prediction.source_event_ids || [],
      evidence: prediction.evidence || [],
      recommended_action: prediction.recommended_action,
      status: prediction.status,
      metadata: prediction.metadata || {},
    }));
    const { data, error } = await supabaseAdmin.from("ochiga_intelligence_predictions").insert(rows as any).select("*");
    if (error) warnings.push(`ochiga_intelligence_predictions: ${error.message}`);
    else persisted = data || [];
  }

  await recordAgentObservation({
    agent_id: "intelligence_core",
    action: "prediction_run",
    tool: "intelligence:predictions.run",
    surface: "api",
    actor,
    success: true,
    latency_ms: Date.now() - started,
    metadata: { prediction_count: finalPredictions.length, persisted_count: persisted.length, warnings },
  });

  return { ok: true, predictions: persisted.length ? persisted : finalPredictions, generated_count: finalPredictions.length, persisted_count: persisted.length, warnings };
}

export function filterPredictionsForActor(predictions: any[], actor?: AuthUser | null) {
  const policy = getIntelligencePermissionPolicy(actor);
  const actorEstate = actor?.estate_id || null;
  const actorHome = actor?.home_id || null;
  return predictions.filter((prediction) => {
    if (policy.scope === "system") return true;
    if (policy.scope === "office") return ["operational_recommendation"].includes(String(prediction.prediction_type));
    if (policy.scope === "estate") return !prediction.estate_id || !actorEstate || String(prediction.estate_id) === String(actorEstate);
    if (prediction.home_id && actorHome) return String(prediction.home_id) === String(actorHome);
    return false;
  });
}

export function canAcknowledgePredictionForActor(prediction: any, actor?: AuthUser | null) {
  return filterPredictionsForActor([prediction], actor).length === 1;
}

export async function listIntelligencePredictions(options: PredictionRunOptions & { status?: string | null; prediction_type?: string | null } = {}) {
  const actor = options.actor || null;
  const scope = actor ? authenticatedActorScope(actor) : options;
  const estateId = scope.estate_id || null;
  const homeId = scope.home_id || null;
  const limit = Math.max(1, Math.min(200, Number(options.limit || 50)));
  let query = supabaseAdmin.from("ochiga_intelligence_predictions").select("*").order("created_at", { ascending: false }).limit(limit);
  if (estateId) query = query.eq("estate_id", estateId);
  if (homeId) query = query.eq("home_id", homeId);
  if (options.status) query = query.eq("status", options.status);
  if (options.prediction_type) query = query.eq("prediction_type", options.prediction_type);
  const { data, error } = await query;
  if (error) return { predictions: [], warning: error.message };
  return { predictions: filterPredictionsForActor(data || [], actor) };
}

export function summarizePredictions(predictions: any[]) {
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const prediction of predictions) {
    const type = String(prediction.prediction_type || "unknown");
    const severity = String(prediction.severity || "info");
    byType[type] = (byType[type] || 0) + 1;
    bySeverity[severity] = (bySeverity[severity] || 0) + 1;
  }
  const critical = predictions.filter((prediction) => prediction.severity === "critical" || prediction.severity === "warning").length;
  return {
    prediction_count: predictions.length,
    critical_prediction_count: critical,
    by_type: byType,
    by_severity: bySeverity,
    top_predictions: predictions.slice(0, 5).map((prediction) => ({
      id: prediction.id,
      prediction_type: prediction.prediction_type,
      title: prediction.title,
      summary: prediction.summary,
      confidence: prediction.confidence,
      severity: prediction.severity,
      recommended_action: prediction.recommended_action,
    })),
    recommended_actions: predictions.map((prediction) => prediction.recommended_action).filter(Boolean).slice(0, 5),
  };
}

export async function acknowledgePrediction(id: string, actor: AuthUser) {
  const { data: existing, error: readError } = await supabaseAdmin
    .from("ochiga_intelligence_predictions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { ok: false, error: "Prediction lookup failed" };
  if (!existing || !canAcknowledgePredictionForActor(existing, actor)) {
    return { ok: false, error: "Prediction not available for this actor" };
  }

  const { data, error } = await supabaseAdmin
    .from("ochiga_intelligence_predictions")
    .update({ status: "acknowledged", acknowledged_at: new Date().toISOString(), acknowledged_by: actor.id, updated_at: new Date().toISOString() } as any)
    .eq("id", id)
    .eq("status", existing.status)
    .select("*")
    .single();
  if (error) return { ok: false, error: "Prediction acknowledgement failed" };
  return { ok: true, prediction: data };
}
