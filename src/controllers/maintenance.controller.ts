// src/controllers/maintenance.controller.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

type AuthReq = Request & {
  user?: { id: string; estate_id?: string; role?: string };
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
  let estateId = req.user?.estate_id || undefined;

  // If home_id is supplied, it is the “plot/house” inside the estate.
  if (homeId) {
    const { data: home, error } = await supabaseAdmin
      .from("homes")
      .select("id, estate_id")
      .eq("id", homeId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (home?.estate_id) estateId = home.estate_id;
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

  return { estateId, homeId: homeId || null };
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
  const inserts = userIds.map((uid) =>
    insertWithSchemaFallback("notifications", {
      user_id: uid,
      ...payload,
      read: false,
      created_at: new Date().toISOString(),
    })
  );
  await Promise.allSettled(inserts);
}

async function notifyEstate(estateId: string, payload: Record<string, any>) {
  await insertWithSchemaFallback("notifications", {
    estate_id: estateId,
    ...payload,
    read: false,
    created_at: new Date().toISOString(),
  });
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
    const { estateId } = await resolveEstateAndHome(req, null);

    // ✅ FIX: your table uses resident_id (not requested_by)
    let q = supabaseAdmin
      .from("maintenance_requests")
      .select("*")
      .eq("resident_id", userId)
      .order("created_at", { ascending: false });

    if (estateId) q = q.eq("estate_id", estateId);

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
    const { estateId, homeId } = await resolveEstateAndHome(req, home_id);

    if (!estateId) return res.status(400).json({ error: "No estate linked" });

    const request = await insertWithSchemaFallback<any>("maintenance_requests", {
      estate_id: estateId,
      home_id: homeId,
      resident_id: userId, // ✅ FIX
      title: title || "Maintenance request",
      description: description || null,
      category: category || null, // optional
      priority: priority || "medium", // keep consistent with UI defaults
      status: "open",
      created_at: new Date().toISOString(),
    });

    const opsUserIds = await listEstateOpsUserIds(estateId);

    if (opsUserIds.length) {
      await notifyUsers(opsUserIds, {
        estate_id: estateId,
        type: "maintenance_request",
        title: "New maintenance request",
        message: `${request.title || "Maintenance request"} received`,
        entity_type: "maintenance",
        entity_id: request.id,
      });
    } else {
      await notifyEstate(estateId, {
        type: "maintenance_request",
        title: "New maintenance request",
        message: `${request.title || "Maintenance request"} received`,
        entity_type: "maintenance",
        entity_id: request.id,
      });
    }

    await notifyUsers([userId], {
      estate_id: estateId,
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
    const { status, assigned_to, note } = req.body || {};

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("maintenance_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (exErr) return res.status(500).json({ error: exErr.message });
    if (!existing) return res.status(404).json({ error: "Not found" });

    const { data: updated, error } = await supabaseAdmin
      .from("maintenance_requests")
      .update(
        compact({
          status,
          assigned_to,
          updated_at: new Date().toISOString(),
        })
      )
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

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
      });
    }

    return res.json({ message: "Updated", request: updated });
  } catch (e: any) {
    console.error("updateMaintenance error:", e?.message || e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
