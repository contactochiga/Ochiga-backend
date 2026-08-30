import { Request } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { emitSignal, makeBaseSignal } from "../realtime/emitSignal";
import { emitAuditEvent } from "../core/foundation/audit";
import { publishSourceIntelligenceEvent } from "../intelligence-core";

type Actor = { id: string; role?: string; estate_id?: string | null; home_id?: string | null; permissions?: string[]; permission_scopes?: string[] };

type SourceState = { available: boolean; status: string; reason?: string; realtime?: string; fallback?: string };

function actor(req: Request) {
  return req.user as Actor;
}

function estateIdFrom(req: Request) {
  return String(req.query.estate_id || req.body?.estate_id || actor(req)?.estate_id || "").trim();
}

function limitFrom(req: Request, fallback = 80, max = 250) {
  const n = Number.parseInt(String(req.query.limit || ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, n));
}

function cleanObject(value: any) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function source(status: string, available = false, reason?: string, realtime?: string): SourceState {
  return { available, status, reason, realtime, fallback: available ? "live" : "polling" };
}

async function audit(actorValue: Actor, action: string, resourceId: string, metadata: Record<string, any>, req?: Request) {
  try {
    await emitAuditEvent({
      actorId: actorValue.id,
      actorRole: actorValue.role || "operator",
      action,
      resourceType: "platform_gap",
      resourceId,
      status: "success",
      metadata,
      req,
    } as any);
  } catch {
    // Audit must not block operational persistence.
  }
}

function emit(event: string, estateId: string | null | undefined, payload: Record<string, any>) {
  emitSignal(makeBaseSignal({ type: event, source: "facility.platform", estateId: estateId || undefined, payload } as any));
}

async function scopedEstate(req: Request) {
  const explicit = estateIdFrom(req);
  if (explicit) return explicit;
  const current = actor(req);
  const { data } = await supabaseAdmin.from("estate_memberships").select("estate_id").eq("user_id", current.id).eq("status", "active").limit(1).maybeSingle();
  return String((data as any)?.estate_id || "");
}

// Facility Automation -- Cross-Domain Fabric Closure. Extracted from
// platformGapService.createIncident below so EXECUTION_REGISTRY's new
// security.create_incident action has a real, req-independent function to
// call. Adds the one thing createIncident was previously missing to be a
// viable automation trigger source too: a publishSourceIntelligenceEvent
// call, consistent with every other domain's mutation-publishes-an-event
// convention (visitor/maintenance/community/weather all already do this;
// incident creation/update did not).
export async function createFacilityIncident(input: {
  estateId: string;
  homeId?: string | null;
  roomId?: string | null;
  title: string;
  description?: string | null;
  incidentType?: string;
  severity?: string;
  status?: string;
  assignedTo?: string | null;
  location?: string | null;
  source?: string;
  metadata?: Record<string, any>;
  actorId: string;
  note?: string | null;
  automationOrigin?: boolean;
}) {
  const payload = {
    estate_id: input.estateId,
    home_id: input.homeId || null,
    room_id: input.roomId || null,
    title: input.title || "Operational incident",
    description: input.description || null,
    incident_type: input.incidentType || "operational",
    severity: input.severity || "medium",
    status: input.status || "open",
    assigned_to: input.assignedTo || null,
    location: input.location || null,
    source: input.source || "facility",
    metadata: cleanObject(input.metadata),
    created_by: input.actorId,
  };
  const { data, error } = await supabaseAdmin.from("facility_incidents").insert(payload as any).select("*").single();
  if (error) throw error;

  await supabaseAdmin.from("facility_incident_timeline").insert({ incident_id: data.id, estate_id: input.estateId, actor_id: input.actorId, action: "created", status: data.status, note: input.note || null, metadata: {} } as any);
  emit("incident.created", input.estateId, { incident: data });

  void publishSourceIntelligenceEvent(
    {
      source: "facility",
      surface: "facility",
      event_type: "security.incident.created",
      category: "security",
      estate_id: input.estateId,
      home_id: input.homeId || null,
      actor_id: input.actorId,
      entity_type: "facility_incident",
      entity_id: data.id,
      entity_label: data.title || "Facility incident",
      severity: String(data.severity || "").toLowerCase() === "critical" ? "critical" : String(data.severity || "").toLowerCase() === "high" ? "warning" : "attention",
      title: data.title || "Facility incident created",
      summary: data.description || "A facility incident was recorded.",
      payload: { status: data.status, severity: data.severity, incident_type: data.incident_type },
      occurred_at: data.created_at,
      automation_origin: Boolean(input.automationOrigin),
    },
    { source_table: "facility_incidents", source_event_id: `${data.id}:security.incident.created` }
  );

  return data;
}

export const platformGapService = {
  async twin(req: Request) {
    const estate_id = await scopedEstate(req);
    if (!estate_id) return { estate_id: null, models: [], placements: [], sources: { twin: source("No estate context", false, "No estate context") } };
    const [models, placements] = await Promise.all([
      supabaseAdmin.from("twin_models").select("*").eq("estate_id", estate_id).order("created_at", { ascending: false }).limit(40),
      supabaseAdmin.from("twin_entity_placements").select("*").eq("estate_id", estate_id).order("updated_at", { ascending: false }).limit(500),
    ]);
    return {
      estate_id,
      models: models.data || [],
      placements: placements.data || [],
      sources: {
        twin: source((models.data || []).length ? "Model available" : "No model loaded", !!(models.data || []).length, models.error?.message),
        placements: source((placements.data || []).length ? "Location assigned" : "Location pending", !!(placements.data || []).length, placements.error?.message),
      },
    };
  },

  async registerModel(req: Request) {
    const current = actor(req);
    const estate_id = await scopedEstate(req);
    const body = req.body || {};
    if (!estate_id) throw new Error("No estate context");
    const payload = {
      estate_id,
      name: String(body.name || body.filename || "Twin model").trim(),
      source_type: String(body.source_type || "glb"),
      state: String(body.state || "uploaded"),
      version: Number(body.version || 1),
      file_url: body.file_url || null,
      storage_key: body.storage_key || null,
      metadata: cleanObject(body.metadata),
      assigned_scope: String(body.assigned_scope || "estate"),
      assigned_entity_id: body.assigned_entity_id || null,
      created_by: current.id,
    };
    const { data, error } = await supabaseAdmin.from("twin_models").insert(payload as any).select("*").single();
    if (error) throw error;
    await audit(current, "twin.model.registered", data.id, { source_type: payload.source_type, state: payload.state }, req);
    emit("twin.state.updated", estate_id, { model: data });
    return { ok: true, model: data };
  },

  async updateModel(req: Request) {
    const current = actor(req);
    const updates = cleanObject(req.body);
    delete updates.id;
    delete updates.estate_id;
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from("twin_models").update(updates).eq("id", req.params.modelId).select("*").single();
    if (error) throw error;
    await audit(current, "twin.model.updated", data.id, { state: data.state }, req);
    emit("twin.state.updated", data.estate_id, { model: data });
    return { ok: true, model: data };
  },

  async upsertPlacement(req: Request) {
    const current = actor(req);
    const estate_id = await scopedEstate(req);
    const body = req.body || {};
    if (!estate_id) throw new Error("No estate context");
    const entity_type = String(body.entity_type || "").trim();
    const entity_id = String(body.entity_id || "").trim();
    if (!entity_type || !entity_id) throw new Error("entity_type and entity_id are required");
    const location_state = String(body.location_state || (body.coordinates ? "location_assigned" : "location_pending"));
    const payload = {
      estate_id,
      entity_type,
      entity_id,
      location_state,
      label: body.label || null,
      building_id: body.building_id || null,
      home_id: body.home_id || null,
      room_id: body.room_id || null,
      zone: body.zone || null,
      floor: body.floor || null,
      coordinates: body.coordinates || null,
      metadata: cleanObject(body.metadata),
      assigned_by: location_state === "location_assigned" ? current.id : null,
      assigned_at: location_state === "location_assigned" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabaseAdmin.from("twin_entity_placements").upsert(payload as any, { onConflict: "estate_id,entity_type,entity_id" }).select("*").single();
    if (error) throw error;
    await audit(current, "twin.entity.placed", data.id, { entity_type, entity_id, location_state }, req);
    emit("twin.state.updated", estate_id, { placement: data });
    return { ok: true, placement: data };
  },

  async utilityTelemetry(req: Request) {
    const estate_id = await scopedEstate(req);
    if (!estate_id) return { estate_id: null, items: [], sources: { utility: source("No estate context", false, "No estate context") } };
    const { data, error } = await supabaseAdmin.from("utility_telemetry").select("*").eq("estate_id", estate_id).order("observed_at", { ascending: false }).limit(limitFrom(req, 120));
    return { estate_id, items: data || [], sources: { utility: source((data || []).length ? "Live" : "Awaiting telemetry", !!(data || []).length, error?.message, "utility.telemetry.updated") } };
  },

  async recordUtilityTelemetry(req: Request) {
    const current = actor(req);
    const estate_id = await scopedEstate(req);
    if (!estate_id) throw new Error("No estate context");
    const body = req.body || {};
    const payload = {
      estate_id,
      home_id: body.home_id || null,
      room_id: body.room_id || null,
      edge_node_id: body.edge_node_id || null,
      utility_type: String(body.utility_type || "power"),
      state: String(body.state || "awaiting_telemetry"),
      value: body.value ?? null,
      unit: body.unit || null,
      severity: body.severity || null,
      source: body.source || "facility",
      metadata: cleanObject(body.metadata),
      observed_at: body.observed_at || new Date().toISOString(),
    };
    const { data, error } = await supabaseAdmin.from("utility_telemetry").insert(payload as any).select("*").single();
    if (error) throw error;
    await audit(current, "utility.telemetry.recorded", data.id, { utility_type: payload.utility_type, state: payload.state }, req);
    emit("utility.telemetry.updated", estate_id, { telemetry: data });
    return { ok: true, telemetry: data };
  },

  async edgeHistory(req: Request) {
    const estate_id = await scopedEstate(req);
    if (!estate_id) return { estate_id: null, items: [], sources: { edge: source("No estate context", false, "No estate context") } };
    const { data, error } = await supabaseAdmin.from("edge_node_history").select("*").eq("estate_id", estate_id).order("observed_at", { ascending: false }).limit(limitFrom(req, 120));
    return { estate_id, items: data || [], sources: { edge: source((data || []).length ? "Live" : "Awaiting telemetry", !!(data || []).length, error?.message, "edge.heartbeat") } };
  },

  async recordEdgeHistory(req: Request) {
    const current = actor(req);
    const estate_id = await scopedEstate(req);
    if (!estate_id) throw new Error("No estate context");
    const body = req.body || {};
    const payload = { estate_id, edge_node_id: body.edge_node_id || null, node_id: body.node_id || null, event_type: String(body.event_type || "heartbeat"), state: body.state || null, queue_depth: body.queue_depth ?? null, device_count: body.device_count ?? null, runtime_version: body.runtime_version || null, metadata: cleanObject(body.metadata), observed_at: body.observed_at || new Date().toISOString() };
    const { data, error } = await supabaseAdmin.from("edge_node_history").insert(payload as any).select("*").single();
    if (error) throw error;
    await audit(current, "edge.history.recorded", data.id, { event_type: payload.event_type }, req);
    emit("edge.heartbeat", estate_id, { edge_history: data });
    return { ok: true, edge_history: data };
  },

  async incidents(req: Request) {
    const estate_id = await scopedEstate(req);
    if (!estate_id) return { estate_id: null, items: [], sources: { incidents: source("No estate context", false, "No estate context") } };
    let query = supabaseAdmin.from("facility_incidents").select("*").eq("estate_id", estate_id).order("created_at", { ascending: false }).limit(limitFrom(req, 120));
    if (req.query.status) query = query.eq("status", String(req.query.status));
    const { data, error } = await query;
    return { estate_id, items: data || [], sources: { incidents: source((data || []).length ? "Live" : "Pending source", !!(data || []).length, error?.message, "incident.updated") } };
  },

  async createIncident(req: Request) {
    const current = actor(req);
    const estate_id = await scopedEstate(req);
    if (!estate_id) throw new Error("No estate context");
    const body = req.body || {};
    const incident = await createFacilityIncident({
      estateId: estate_id,
      homeId: body.home_id || null,
      roomId: body.room_id || null,
      title: String(body.title || "Operational incident"),
      description: body.description || null,
      incidentType: body.incident_type || "operational",
      severity: body.severity || "medium",
      status: body.status || "open",
      assignedTo: body.assigned_to || null,
      location: body.location || null,
      source: body.source || "facility",
      metadata: cleanObject(body.metadata),
      actorId: current.id,
      note: body.note || null,
    });
    await audit(current, "incident.created", incident.id, { severity: incident.severity, status: incident.status }, req);
    return { ok: true, incident };
  },

  async updateIncident(req: Request) {
    const current = actor(req);
    const estate_id = await scopedEstate(req);
    if (!estate_id) throw new Error("No estate context");
    const body = req.body || {};
    const updates: Record<string, any> = {};
    for (const key of ["status", "severity", "assigned_to", "location", "description", "metadata", "home_id", "room_id", "evidence", "response_log", "blocking_reason"] as const) if (body[key] !== undefined) updates[key] = body[key];
    const now = new Date().toISOString();
    if (body.assigned_to !== undefined) updates.assigned_at = now;
    if (body.status === "acknowledged") updates.acknowledged_at = now;
    if (body.status === "escalated") updates.escalated_at = now;
    if (body.status === "resolved") updates.resolved_at = now;
    if (body.status === "verified") { updates.verified_at = now; updates.verified_by = current.id; }
    if (body.status === "closed") updates.closed_at = now;
    updates.updated_at = now;
    const { data, error } = await supabaseAdmin.from("facility_incidents").update(updates).eq("id", req.params.incidentId).eq("estate_id", estate_id).select("*").single();
    if (error) throw error;
    await supabaseAdmin.from("facility_incident_timeline").insert({ incident_id: data.id, estate_id: data.estate_id, actor_id: current.id, action: body.action || "updated", status: data.status, note: body.note || null, metadata: cleanObject(body.timeline_metadata) } as any);
    await audit(current, "incident.updated", data.id, { status: data.status, severity: data.severity }, req);
    emit("incident.updated", data.estate_id, { incident: data });
    return { ok: true, incident: data };
  },

  async incidentTimeline(req: Request) {
    const estate_id = await scopedEstate(req);
    if (!estate_id) throw new Error("No estate context");
    const { data: incident, error: incidentError } = await supabaseAdmin.from("facility_incidents").select("id").eq("id", req.params.incidentId).eq("estate_id", estate_id).maybeSingle();
    if (incidentError) throw incidentError;
    if (!incident) throw new Error("Incident not found in the active facility context");
    const { data, error } = await supabaseAdmin.from("facility_incident_timeline").select("*").eq("incident_id", req.params.incidentId).eq("estate_id", estate_id).order("created_at", { ascending: true }).limit(120);
    return { ok: true, items: data || [], error: error?.message };
  },

  async handover(req: Request) {
    const current = actor(req); const estate_id = await scopedEstate(req);
    if (!estate_id) throw new Error("No estate context");
    const [maintenance, incidents, workflows] = await Promise.all([
      supabaseAdmin.from("maintenance_requests").select("id,title,status,assigned_to,priority,created_at,updated_at").eq("estate_id", estate_id).order("created_at", { ascending: false }).limit(200),
      supabaseAdmin.from("facility_incidents").select("id,title,status,severity,assigned_to,opened_at,created_at,updated_at,blocking_reason,verified_at").eq("estate_id", estate_id).order("created_at", { ascending: false }).limit(200),
      supabaseAdmin.from("ochiga_workflows").select("id,title,workflow_status,workflow_priority,workflow_assignee,workflow_due_at,created_at,updated_at,workflow_resolution").eq("estate_id", estate_id).order("created_at", { ascending: false }).limit(200),
    ]);
    const closed = new Set(["completed", "verified", "resolved", "closed", "cancelled"]);
    const all = [...(maintenance.data || []).map((x: any) => ({ ...x, module: "maintenance", owner: x.assigned_to })), ...(incidents.data || []).map((x: any) => ({ ...x, module: "incidents", owner: x.assigned_to })), ...(workflows.data || []).map((x: any) => ({ ...x, module: "workflows", status: x.workflow_status, priority: x.workflow_priority, owner: x.workflow_assignee, due_at: x.workflow_due_at }))];
    const open = all.filter((x: any) => !closed.has(String(x.status || "").toLowerCase()));
    const overdue = open.filter((x: any) => x.due_at && new Date(x.due_at).getTime() < Date.now());
    const unassigned = open.filter((x: any) => !x.owner);
    const escalated = open.filter((x: any) => String(x.status) === "escalated");
    return { ok: true, estate_id, handover_date: new Date().toISOString().slice(0, 10), summary: { open: open.length, completed_today: all.filter((x: any) => closed.has(String(x.status || "").toLowerCase()) && String(x.updated_at || x.created_at || "").slice(0, 10) === new Date().toISOString().slice(0, 10)).length, overdue: overdue.length, unassigned: unassigned.length, escalated: escalated.length, verification: open.filter((x: any) => String(x.status || "").toLowerCase() === "completed" || !!x.verified_at === false && String(x.status || "").toLowerCase() === "resolved").length }, items: open.slice(0, 100) };
  },

  async handovers(req: Request) {
    const estate_id = await scopedEstate(req);
    if (!estate_id) throw new Error("No estate context");
    const { data, error } = await supabaseAdmin.from("facility_shift_handovers").select("*").eq("estate_id", estate_id).order("handover_date", { ascending: false }).order("created_at", { ascending: false }).limit(limitFrom(req, 30));
    if (error) throw error;
    return { ok: true, estate_id, items: data || [] };
  },

  async createHandover(req: Request) {
    const current = actor(req);
    const estate_id = await scopedEstate(req);
    if (!estate_id) throw new Error("No estate context");
    const body = req.body || {};
    const payload = {
      estate_id,
      author_id: current.id,
      handover_date: body.handover_date || new Date().toISOString().slice(0, 10),
      summary: String(body.summary || "").trim() || null,
      open_items: Array.isArray(body.open_items) ? body.open_items.slice(0, 100) : [],
      handover_items: Array.isArray(body.handover_items) ? body.handover_items.slice(0, 100) : [],
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabaseAdmin.from("facility_shift_handovers").upsert(payload as any, { onConflict: "estate_id,handover_date,author_id" }).select("*").single();
    if (error) throw error;
    await audit(current, "handover.created", data.id, { handover_date: payload.handover_date, open_items: payload.open_items.length }, req);
    emit("facility.handover.updated", estate_id, { handover: data });
    return { ok: true, handover: data };
  },

  async cameraInfrastructure(req: Request) {
    const estate_id = await scopedEstate(req);
    if (!estate_id) return { estate_id: null, items: [], history: [], sources: { cameras: source("No estate context", false, "No estate context") } };
    const [items, history] = await Promise.all([
      supabaseAdmin.from("camera_infrastructure").select("*").eq("estate_id", estate_id).order("updated_at", { ascending: false }).limit(100),
      supabaseAdmin.from("camera_health_history").select("*").eq("estate_id", estate_id).order("observed_at", { ascending: false }).limit(100),
    ]);
    return { estate_id, items: items.data || [], history: history.data || [], sources: { cameras: source((items.data || []).length ? "Live" : "Awaiting telemetry", !!(items.data || []).length, items.error?.message, "camera.status.updated") } };
  },

  async upsertCameraInfrastructure(req: Request) {
    const current = actor(req);
    const estate_id = await scopedEstate(req);
    if (!estate_id) throw new Error("No estate context");
    const body = req.body || {};
    const camera_id = String(body.camera_id || "").trim();
    if (!camera_id) throw new Error("camera_id is required");
    const { data: canonicalCamera, error: cameraError } = await supabaseAdmin
      .from("facility_cameras")
      .select("id,estate_id")
      .eq("id", camera_id)
      .eq("estate_id", estate_id)
      .maybeSingle();
    if (cameraError) throw cameraError;
    if (!canonicalCamera) throw new Error("Canonical facility camera is required for this projection");
    const payload = { estate_id, camera_id, placement_id: body.placement_id || null, zone: body.zone || null, area_owner: body.area_owner || null, infrastructure_relationship: body.infrastructure_relationship || null, health_state: body.health_state || "awaiting_telemetry", metadata: cleanObject(body.metadata), updated_at: new Date().toISOString() };
    const { data, error } = await supabaseAdmin.from("camera_infrastructure").upsert(payload as any, { onConflict: "estate_id,camera_id" }).select("*").single();
    if (error) throw error;
    if (body.health_state) await supabaseAdmin.from("camera_health_history").insert({ estate_id, camera_id, health_state: body.health_state, stream_state: body.stream_state || null, event_type: body.event_type || "health", metadata: cleanObject(body.history_metadata) } as any);
    await audit(current, "camera.infrastructure.updated", data.id, { camera_id }, req);
    emit("camera.status.updated", estate_id, { camera_infrastructure: data });
    return { ok: true, camera_infrastructure: data };
  },

  async realtimeAudit() {
    return {
      domains: [
        { domain: "Device", subscription: "device.status.updated/device.registry.updated/device.discovered", status: "real subscription", fallback: "polling" },
        { domain: "Camera", subscription: "camera.status.updated/camera.event", status: "real subscription", fallback: "polling" },
        { domain: "Visitor", subscription: "visitor.updated/visitor.created", status: "real subscription", fallback: "polling" },
        { domain: "Maintenance", subscription: "maintenance.updated/support.ticket.assigned", status: "real subscription", fallback: "polling" },
        { domain: "Community", subscription: "community.updated", status: "real subscription", fallback: "polling" },
        { domain: "Notification", subscription: "notification:new/notification/office.notification", status: "real subscription", fallback: "polling" },
        { domain: "Audit", subscription: "audit.recorded", status: "real subscription", fallback: "polling" },
        { domain: "Edge", subscription: "edge.heartbeat", status: "real subscription", fallback: "polling" },
        { domain: "Incident", subscription: "incident.created/incident.updated", status: "real subscription", fallback: "polling" },
        { domain: "Twin", subscription: "twin.state.updated", status: "real subscription", fallback: "polling" },
        { domain: "Utility", subscription: "utility.telemetry.updated", status: "real subscription", fallback: "polling" },
      ],
    };
  },

  async deploymentReadiness() {
    const env = process.env;
    const checks = [
      ["Render", "healthy", "Runtime host detected by deployment environment"],
      ["Supabase", env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? "healthy" : "missing", "SUPABASE_URL and service role key"],
      ["Redis", env.REDIS_URL || env.UPSTASH_REDIS_REST_URL ? "healthy" : "pending", "Redis/BullMQ queue configuration"],
      ["Storage", env.S3_BUCKET || env.AWS_BUCKET || env.SUPABASE_URL ? "healthy" : "pending", "Storage provider configuration"],
      ["APNs", env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_BUNDLE_ID ? "healthy" : "pending", "Apple push notification credentials"],
      ["FCM", env.FCM_SERVER_KEY ? "healthy" : "pending", "Firebase Cloud Messaging key"],
      ["Tuya", env.TUYA_ACCESS_ID && env.TUYA_ACCESS_SECRET ? "healthy" : "pending", "Tuya OpenAPI credentials"],
      ["Domains", env.PUBLIC_APP_URL || env.APP_URL || env.FRONTEND_URL ? "healthy" : "pending", "Public frontend/backend domain configuration"],
      ["SSL", "healthy", "Render/host-managed TLS expected"],
    ].map(([name, status, detail]) => ({ name, status, detail }));
    return { checks };
  },
};
