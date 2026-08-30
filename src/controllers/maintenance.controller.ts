// src/controllers/maintenance.controller.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { publishSourceIntelligenceEvent } from "../intelligence-core";
import { NotificationService, type NotificationType } from "../services/NotificationService";
import { detectDuplicateMaintenanceRequest } from "../services/facilityAutomationService";

type AuthReq = Request & {
  user?: { id: string; estate_id?: string; home_id?: string; role?: string };
  oisContext?: { estate_id?: string | null; home_id?: string | null; membership_id?: string | null };
};

function extractMissingColumnName(msg: string): string | null {
  if (!msg) return null;
  let m = msg.match(/Could not find the ['"]([^'"]+)['"] column/i);
  if (m?.[1]) return m[1];
  m = msg.match(/column\s+"([^"]+)"\s+of\s+relation/i);
  if (m?.[1]) return m[1];
  m = msg.match(/(?:unknown|missing)\s+column[:\s]+([a-zA-Z0-9_]+)/i);
  if (m?.[1]) return m[1];
  return null;
}

function compact<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

async function insertWithSchemaFallback<T>(
  table: string,
  row: Record<string, any>,
  maxAttempts = 8
): Promise<T> {
  let payload: Record<string, any> = { ...(compact(row) as any) };
  let lastErrorMsg = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .insert(payload)
      .select()
      .single();

    if (!error) return data as T;

    const msg = String((error as any)?.message || "");
    lastErrorMsg = msg;

    const missingCol = extractMissingColumnName(msg);
    if (missingCol && Object.prototype.hasOwnProperty.call(payload, missingCol)) {
      delete payload[missingCol];
      continue;
    }

    if (/schema cache/i.test(msg)) {
      const col = extractMissingColumnName(msg);
      if (col && Object.prototype.hasOwnProperty.call(payload, col)) {
        delete payload[col];
        continue;
      }
    }

    throw new Error(msg || "Insert failed");
  }

  throw new Error(lastErrorMsg || "Insert failed after removing missing columns.");
}

// --- helpers: resolve estate + home ---
async function resolveEstateAndHome(req: AuthReq, homeId?: string | null) {
  const requestedHomeId = String(homeId || req.query.home_id || req.query.homeId || req.oisContext?.home_id || req.user?.home_id || "").trim() || null;
  let estateId = String(req.oisContext?.estate_id || req.user?.estate_id || "").trim() || undefined;
  let membershipId = req.oisContext?.membership_id || null;

  // If home_id is supplied, it is the “plot/house” inside the estate.
  if (requestedHomeId) {
    const { data: home, error } = await supabaseAdmin
      .from("homes")
      .select("id, estate_id")
      .eq("id", requestedHomeId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!home?.id) {
      const err = Object.assign(new Error("Home is not available"), { statusCode: 404 });
      throw err;
    }
    if (home?.estate_id) estateId = home.estate_id;
    if (req.user?.id) {
      const { data: membership, error: membershipError } = await supabaseAdmin
        .from("home_memberships")
        .select("id, status")
        .eq("home_id", requestedHomeId)
        .eq("user_id", req.user.id)
        .eq("status", "active")
        .maybeSingle();
      if (membershipError) throw new Error(membershipError.message);
      if (!membership?.id && !["admin", "super_admin", "estate_admin", "manager", "operator"].includes(String(req.user?.role || ""))) {
        const err = Object.assign(new Error("You do not have access to this home"), { statusCode: 403 });
        throw err;
      }
      membershipId = membership?.id || membershipId || null;
    }
  }

  // fallback: membership estate
  if (!estateId && req.user?.id) {
    const { data: mem, error: memErr } = await supabaseAdmin
      .from("estate_memberships")
      .select("estate_id, status")
      .eq("user_id", req.user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (memErr) throw new Error(memErr.message);
    estateId = mem?.estate_id || undefined;
  }

  return { estateId, homeId: requestedHomeId, membershipId };
}

async function listEstateOpsUserIds(estateId: string) {
  const { data, error } = await supabaseAdmin
    .from("estate_memberships")
    .select("user_id, role, status")
    .eq("estate_id", estateId)
    .eq("status", "active");

  if (error) throw new Error(error.message);

  const opsRoles = new Set(["owner", "admin", "manager", "security"]);
  return (data || [])
    .filter((m: any) => opsRoles.has(String(m.role || "").toLowerCase()))
    .map((m: any) => m.user_id)
    .filter(Boolean);
}

async function notifyUsers(userIds: string[], payload: Record<string, any>) {
  const sends = userIds.map((uid) =>
    NotificationService.sendToUser(uid, {
      title: String(payload.title || "Maintenance update"),
      message: String(payload.message || "Maintenance request updated"),
      type: "maintenance" as NotificationType,
      payload: {
        ...payload,
        request_id: payload.entity_id || payload.request_id || null,
        source_type: "maintenance",
      },
      entityId: payload.entity_id ? String(payload.entity_id) : undefined,
      routing: {
        source_type: "maintenance",
        source_id: payload.entity_id ? String(payload.entity_id) : null,
        destination: "page",
        target: payload.entity_id ? { target_type: "maintenance", target_id: String(payload.entity_id), open_as: "page", action: "inspect" } : null,
        actionability: "review",
        attention_eligible: true,
        queue_eligible: false,
        acknowledgement_required: false,
      },
    })
  );
  await Promise.allSettled(sends);
}

async function notifyEstate(estateId: string, payload: Record<string, any>) {
  for (const role of ["owner", "admin", "manager", "security"]) {
    await NotificationService.sendToRole(estateId, role, {
      title: String(payload.title || "Maintenance update"),
      message: String(payload.message || "Maintenance request updated"),
      type: "maintenance",
      payload: {
        ...payload,
        estate_id: estateId,
        request_id: payload.entity_id || payload.request_id || null,
        source_type: "maintenance",
      },
      entityId: payload.entity_id ? String(payload.entity_id) : undefined,
      routing: {
        source_type: "maintenance",
        source_id: payload.entity_id ? String(payload.entity_id) : null,
        destination: "page",
        target: payload.entity_id ? { target_type: "maintenance", target_id: String(payload.entity_id), open_as: "page", action: "inspect" } : null,
        actionability: "review",
        attention_eligible: true,
        queue_eligible: true,
        acknowledgement_required: false,
      },
    });
  }
}

/**
 * CONSUMER: GET /maintenance
 * List my maintenance tickets (optionally filter by status)
 */
export async function listMyMaintenance(req: AuthReq, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const status = String(req.query.status || "").trim();
    const { estateId, homeId } = await resolveEstateAndHome(req, null);

    // ✅ FIX: your table uses resident_id (not requested_by)
    let q = supabaseAdmin
      .from("maintenance_requests")
      .select("*")
      .eq("resident_id", userId)
      .order("created_at", { ascending: false });

    if (estateId) q = q.eq("estate_id", estateId);
    if (homeId) q = q.eq("home_id", homeId);

    if (status) {
      q = q.eq("status", status);
    }

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ requests: data || [] });
  } catch (e: any) {
    console.error("listMyMaintenance error:", e?.message || e);
    return res.status(500).json({ error: e.message || "Failed to load maintenance" });
  }
}

// Facility Automation -- Cross-Domain Fabric Closure. The facility-staff/
// automation-scoped counterpart to createMaintenance below -- that
// function derives "the complainant" from req.user, which has no meaning
// for a system/staff-initiated work order (e.g. a security-signal- or
// weather-triggered automation opening a proactive WO with no resident
// complaint behind it). Deliberately does NOT set resident_id -- the
// initiating actor is recorded on the maintenance_request_timeline row
// instead, so a facility-initiated order is never misrepresented as a
// resident complaint.
export async function createFacilityMaintenanceOrder(input: {
  estateId: string;
  homeId?: string | null;
  title: string;
  description?: string | null;
  priority?: string;
  category?: string | null;
  actorId: string;
  automationOrigin?: boolean;
}) {
  const request = await insertWithSchemaFallback<any>("maintenance_requests", {
    estate_id: input.estateId,
    home_id: input.homeId || null,
    title: input.title || "Maintenance request",
    description: input.description || null,
    category: input.category || null,
    priority: input.priority || "medium",
    status: "open",
    created_at: new Date().toISOString(),
  });

  await supabaseAdmin.from("maintenance_request_timeline").insert({
    maintenance_request_id: request.id,
    estate_id: input.estateId,
    actor_id: input.actorId,
    action: "maintenance_created_by_facility",
    from_status: null,
    to_status: "open",
    note: "Created by Facility automation, not a resident complaint.",
    metadata: {},
  } as any);

  void publishSourceIntelligenceEvent(
    {
      source: "facility",
      surface: "facility",
      event_type: "maintenance.created",
      category: "maintenance",
      estate_id: input.estateId,
      home_id: input.homeId || null,
      actor_id: input.actorId,
      entity_type: "maintenance_request",
      entity_id: request.id,
      entity_label: request.title || "Maintenance request",
      severity: String(request.priority || input.priority || "").toLowerCase() === "critical" ? "critical" : "attention",
      title: request.title || "Maintenance request created",
      summary: request.description || "A facility-initiated maintenance request was created.",
      payload: { status: request.status || "open", priority: request.priority || input.priority || "medium", category: request.category || input.category || null },
      occurred_at: request.created_at,
      automation_origin: Boolean(input.automationOrigin),
    },
    { source_table: "maintenance_requests", source_event_id: `${request.id}:maintenance.created` }
  );

  void detectDuplicateMaintenanceRequest({ id: request.id, estate_id: input.estateId, home_id: input.homeId || null, category: request.category || input.category || null, title: request.title || input.title || null, created_at: request.created_at });

  const opsUserIds = await listEstateOpsUserIds(input.estateId);
  if (opsUserIds.length) {
    await notifyUsers(opsUserIds, {
      estate_id: input.estateId,
      home_id: input.homeId || null,
      type: "maintenance_request",
      title: "New maintenance request",
      message: `${request.title || "Maintenance request"} raised by Facility automation`,
      entity_type: "maintenance",
      entity_id: request.id,
    });
  } else {
    await notifyEstate(input.estateId, {
      home_id: input.homeId || null,
      type: "maintenance_request",
      title: "New maintenance request",
      message: `${request.title || "Maintenance request"} raised by Facility automation`,
      entity_type: "maintenance",
      entity_id: request.id,
    });
  }

  return request;
}

/**
 * CONSUMER: POST /maintenance
 * Creates maintenance request and notifies facility ops + requester
 */
export async function createMaintenance(req: AuthReq, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // ✅ include category since UI sends it (schema fallback will drop if missing)
    const { home_id, title, description, priority, category } = req.body || {};
    const { estateId, homeId, membershipId } = await resolveEstateAndHome(req, home_id);

    if (!estateId) return res.status(400).json({ error: "No estate linked" });

    const request = await insertWithSchemaFallback<any>("maintenance_requests", {
      estate_id: estateId,
      home_id: homeId,
      membership_id: membershipId || undefined,
      resident_id: userId, // ✅ FIX
      title: title || "Maintenance request",
      description: description || null,
      category: category || null, // optional
      priority: priority || "medium", // keep consistent with UI defaults
      status: "open",
      created_at: new Date().toISOString(),
    });

    void publishSourceIntelligenceEvent({
      source: "consumer",
      surface: "consumer",
      event_type: "maintenance.created",
      category: "maintenance",
      estate_id: estateId,
      home_id: homeId || null,
      actor_id: userId,
      entity_type: "maintenance_request",
      entity_id: request.id,
      entity_label: request.title || "Maintenance request",
      severity: String(request.priority || priority || "").toLowerCase() === "critical" ? "critical" : "attention",
      title: request.title || "Maintenance request created",
      summary: request.description || "A maintenance request was submitted.",
      payload: { status: request.status || "open", priority: request.priority || priority || "medium", category: request.category || category || null, membership_id: membershipId || null },
      occurred_at: request.created_at,
    }, { source_table: "maintenance_requests", source_event_id: `${request.id}:maintenance.created` });

    // PHASE 3 (Milestone 1) -- event-driven duplicate-work-order detector,
    // fired right after creation rather than on a schedule (spec Section
    // 19 prefers event triggers over polling where a canonical event
    // exists, and one already does: this insert). Best-effort, never
    // blocks the response.
    void detectDuplicateMaintenanceRequest({ id: request.id, estate_id: estateId, home_id: homeId || null, category: request.category || category || null, title: request.title || title || null, created_at: request.created_at });

    const opsUserIds = await listEstateOpsUserIds(estateId);

    if (opsUserIds.length) {
      await notifyUsers(opsUserIds, {
        estate_id: estateId,
        home_id: homeId || null,
        membership_id: membershipId || null,
        type: "maintenance_request",
        title: "New maintenance request",
        message: `${request.title || "Maintenance request"} received`,
        entity_type: "maintenance",
        entity_id: request.id,
      });
    } else {
      await notifyEstate(estateId, {
        home_id: homeId || null,
        membership_id: membershipId || null,
        type: "maintenance_request",
        title: "New maintenance request",
        message: `${request.title || "Maintenance request"} received`,
        entity_type: "maintenance",
        entity_id: request.id,
      });
    }

    await notifyUsers([userId], {
      estate_id: estateId,
      home_id: homeId || null,
      membership_id: membershipId || null,
      type: "maintenance_submitted",
      title: "Maintenance submitted",
      message: "Your request has been logged and sent to facility.",
      entity_type: "maintenance",
      entity_id: request.id,
    });

    return res.json({ message: "Maintenance request created", request });
  } catch (e: any) {
    console.error("createMaintenance error:", e?.message || e);
    return res.status(400).json({ error: e.message || "Failed to create maintenance" });
  }
}

/**
 * FACILITY: GET /facility/maintenance
 * Lists requests for estate
 */
export async function listFacilityMaintenance(req: AuthReq, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { estateId } = await resolveEstateAndHome(req, null);
    if (!estateId) return res.status(400).json({ error: "No estate linked" });

    const { data, error } = await supabaseAdmin
      .from("maintenance_requests")
      .select("*")
      .eq("estate_id", estateId)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ requests: data || [] });
  } catch (e: any) {
    console.error("listFacilityMaintenance error:", e?.message || e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}

/**
 * FACILITY: PATCH /facility/maintenance/:id
 * Updates status/assignment and notifies requester + ops
 */
export async function updateMaintenance(req: AuthReq, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const id = req.params.id;
    const { status, assigned_to, note, completion_summary, completion_proof, blocking_reason, resident_rating, resident_feedback, verified_by_resident } = req.body || {};

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("maintenance_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (exErr) return res.status(500).json({ error: exErr.message });
    if (!existing) return res.status(404).json({ error: "Not found" });
    const { estateId } = await resolveEstateAndHome(req, null);
    if (!estateId || String(existing.estate_id) !== String(estateId)) return res.status(404).json({ error: "Not found" });

    const now = new Date().toISOString();
    const lifecycle: Record<string, unknown> = {};
    if (status === "accepted") lifecycle.accepted_at = now;
    if (status === "completed") lifecycle.completed_at = now;
    if (status === "verified") lifecycle.verified_at = now;
    if (status === "closed") lifecycle.closed_at = now;
    if (status === "cancelled") lifecycle.cancelled_at = now;

    const { data: updated, error } = await supabaseAdmin
      .from("maintenance_requests")
      .update(
        compact({
          status,
          assigned_to,
          completion_summary,
          completion_proof: Array.isArray(completion_proof) ? completion_proof : undefined,
          blocking_reason,
          resident_rating,
          resident_feedback,
          verified_by_resident,
          updated_at: now,
          ...lifecycle,
        })
      )
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    await supabaseAdmin.from("maintenance_request_timeline").insert({
      maintenance_request_id: id,
      estate_id: existing.estate_id,
      actor_id: userId,
      action: status ? `maintenance_${String(status)}` : assigned_to ? "maintenance_assigned" : "maintenance_updated",
      from_status: existing.status || null,
      to_status: updated.status || status || existing.status || null,
      note: note || completion_summary || blocking_reason || null,
      metadata: { assigned_to: updated.assigned_to || assigned_to || null, completion_proof: Array.isArray(completion_proof) ? completion_proof : [] },
    } as any);

    const eventType = status
      ? `maintenance.${String(status).toLowerCase().replace(/\s+/g, "_")}`
      : assigned_to ? "maintenance.assigned" : "maintenance.updated";
    void publishSourceIntelligenceEvent({
      source: "facility",
      surface: "facility",
      event_type: eventType,
      category: "maintenance",
      estate_id: updated?.estate_id || existing.estate_id || null,
      home_id: updated?.home_id || existing.home_id || null,
      actor_id: userId,
      entity_type: "maintenance_request",
      entity_id: updated?.id || id,
      entity_label: updated?.title || existing.title || "Maintenance request",
      severity: /overdue|blocked|cancelled/i.test(String(status || "")) ? "warning" : "info",
      title: updated?.title || existing.title || "Maintenance request updated",
      summary: note || `Maintenance request is now ${updated?.status || status || "updated"}.`,
      payload: { status: updated?.status || status || null, assigned_to: updated?.assigned_to || assigned_to || null },
      occurred_at: updated?.updated_at,
    }, { source_table: "maintenance_requests", source_event_id: `${updated?.id || id}:${eventType}` });

    // ✅ FIX: requester column is resident_id
    const requesterId = existing.resident_id || null;
    if (requesterId) {
      await notifyUsers([requesterId], {
        estate_id: existing.estate_id,
        type: "maintenance_update",
        title: "Maintenance updated",
        message: status
          ? `Your request is now: ${String(status).replaceAll("_", " ")}${note ? ` — ${note}` : ""}`
          : `Your request was updated${note ? ` — ${note}` : ""}`,
        entity_type: "maintenance",
        entity_id: id,
        home_id: existing.home_id || null,
        membership_id: existing.membership_id || null,
      });
    }

    const opsUserIds = await listEstateOpsUserIds(existing.estate_id);
    if (opsUserIds.length) {
      await notifyUsers(opsUserIds, {
        estate_id: existing.estate_id,
        type: "maintenance_ops_update",
        title: "Maintenance status changed",
        message: `${existing.title || "Request"} → ${String(updated.status || status || "updated")}`,
        entity_type: "maintenance",
        entity_id: id,
        home_id: existing.home_id || null,
        membership_id: existing.membership_id || null,
      });
    }

    return res.json({ message: "Updated", request: updated });
  } catch (e: any) {
    console.error("updateMaintenance error:", e?.message || e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}

export async function getMaintenanceTimeline(req: AuthReq, res: Response) {
  try {
    const { estateId } = await resolveEstateAndHome(req, null);
    if (!estateId) return res.status(400).json({ error: "No estate linked" });
    const { data: request } = await supabaseAdmin.from("maintenance_requests").select("id").eq("id", req.params.id).eq("estate_id", estateId).maybeSingle();
    if (!request) return res.status(404).json({ error: "Not found" });
    const { data, error } = await supabaseAdmin.from("maintenance_request_timeline").select("*").eq("maintenance_request_id", request.id).order("created_at", { ascending: true }).limit(200);
    if (error) return res.status(500).json({ error: "Unable to load maintenance history" });
    return res.json({ ok: true, items: data || [] });
  } catch {
    return res.status(500).json({ error: "Unable to load maintenance history" });
  }
}
