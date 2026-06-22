// src/controllers/facilityVisitors.controller.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { normalizeNotificationRouting, routingColumns } from "../services/notifications/notificationRoutingService";
import { publishSourceIntelligenceEvent } from "../intelligence-core";

type AuthReq = Request & { user?: { id: string; estate_id?: string; role?: string } };

async function resolveEstateId(req: AuthReq): Promise<string> {
  const estateId = req.user?.estate_id;
  if (estateId) return estateId;

  const userId = req.user?.id;
  if (!userId) throw new Error("Unauthorized");

  const { data, error } = await supabaseAdmin
    .from("estate_memberships")
    .select("estate_id, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.estate_id) throw new Error("No estate linked");

  return data.estate_id;
}

function parseBool(v: any) {
  if (v === true) return true;
  const s = String(v || "").toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function utcDayRange(d = new Date()) {
  const start = new Date(d);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

function missingUpdatedAtColumn(error: any) {
  const message = String(error?.message || error?.details || error?.hint || "").toLowerCase();
  return /updated_at/.test(message) && /column|schema cache|could not find/.test(message);
}

async function updateVisitorAccessStatus(id: string, status: string) {
  const first = await supabaseAdmin
    .from("visitor_access")
    .update({ status, updated_at: new Date().toISOString() } as any)
    .eq("id", id)
    .select()
    .single();
  if (!first.error || !missingUpdatedAtColumn(first.error)) return first;
  return supabaseAdmin
    .from("visitor_access")
    .update({ status } as any)
    .eq("id", id)
    .select()
    .single();
}

/**
 * FACILITY: GET /facility/visitors?today=true&status=active
 * Reads from visitor_access (your real table with data).
 */
export async function listFacilityVisitors(req: AuthReq, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });

    const estateId = await resolveEstateId(req);

    const today = parseBool(req.query.today);
    const status = String(req.query.status || "").trim();

    let q = supabaseAdmin
      .from("visitor_access")
      .select("*")
      .eq("estate_id", estateId)
      .order("created_at", { ascending: false });

    if (status) q = q.eq("status", status);

    if (today) {
      const { startISO, endISO } = utcDayRange();
      q = q.gte("created_at", startISO).lt("created_at", endISO);
    }

    const { data, error } = await q;

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ visitors: data || [] });
  } catch (e: any) {
    console.error("listFacilityVisitors error:", e?.message || e);
    return res.status(400).json({ error: e?.message || "Failed to load visitors" });
  }
}

/**
 * FACILITY: POST /facility/visitors/verify  { code }
 * Estate-scoped code verification.
 */
export async function verifyVisitorCodeFacility(req: AuthReq, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const estateId = await resolveEstateId(req);

    const code = String(req.body?.code || "").trim();
    if (!code) return res.status(400).json({ error: "code is required" });

    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .select("*")
      .eq("estate_id", estateId)
      .eq("access_code", code)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Invalid access code" });

    return res.json({ valid: true, visitor: data });
  } catch (e: any) {
    console.error("verifyVisitorCodeFacility error:", e?.message || e);
    return res.status(400).json({ error: e?.message || "Verify failed" });
  }
}

/**
 * FACILITY: PATCH /facility/visitors/:id  { status }
 */
export async function updateVisitorStatusFacility(req: AuthReq, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const estateId = await resolveEstateId(req);

    const id = String(req.params.id || "");
    const status = String(req.body?.status || "").trim();
    if (!id) return res.status(400).json({ error: "id is required" });
    if (!status) return res.status(400).json({ error: "status is required" });

    // Ensure the visitor belongs to this estate
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("visitor_access")
      .select("id, estate_id")
      .eq("id", id)
      .maybeSingle();

    if (exErr) return res.status(500).json({ error: exErr.message });
    if (!existing) return res.status(404).json({ error: "Visitor not found" });
    if (existing.estate_id !== estateId) return res.status(403).json({ error: "Forbidden" });

    const { data, error } = await updateVisitorAccessStatus(id, status);

    if (error) return res.status(500).json({ error: "Visitor status could not be updated." });

    void publishSourceIntelligenceEvent({
      source: "facility",
      surface: "facility",
      event_type: `visitor_access.${status}`,
      category: "visitor",
      estate_id: data?.estate_id || estateId,
      home_id: data?.home_id || null,
      actor_id: req.user.id,
      entity_type: "visitor_access",
      entity_id: data?.id || id,
      entity_label: data?.visitor_name || "Visitor access",
      severity: /denied|expired/i.test(status) ? "attention" : "info",
      title: `${data?.visitor_name || "Visitor"} access ${status}`,
      summary: `Visitor access was updated to ${status}.`,
      payload: { status, purpose: data?.purpose || null },
      occurred_at: data?.updated_at,
    }, { source_table: "visitor_access", source_event_id: `${data?.id || id}:visitor_access.${status}` });

    return res.json({ ok: true, visitor: data });
  } catch (e: any) {
    console.error("updateVisitorStatusFacility error:", e?.message || e);
    return res.status(400).json({ error: e?.message || "Update failed" });
  }
}

/**
 * FACILITY: GET /facility/visitors/:id/timeline
 */
export async function getVisitorTimelineFacility(req: AuthReq, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const estateId = await resolveEstateId(req);
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "id is required" });

    const { data: row, error } = await supabaseAdmin
      .from("visitor_access")
      .select("*")
      .eq("id", id)
      .eq("estate_id", estateId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!row?.id) return res.status(404).json({ error: "Visitor not found" });

    const timeline: Array<{ at: string; type: string; note: string }> = [];
    if (row.created_at) timeline.push({ at: row.created_at, type: "created", note: "Access request created" });
    if (String(row.status || "").toLowerCase() === "approved")
      timeline.push({ at: row.updated_at || row.created_at, type: "approved", note: "Access approved" });
    if (String(row.status || "").toLowerCase() === "entered")
      timeline.push({ at: row.updated_at || row.created_at, type: "entered", note: "Visitor entry logged" });
    if (String(row.status || "").toLowerCase() === "exited")
      timeline.push({ at: row.updated_at || row.created_at, type: "exited", note: "Visitor exit logged" });
    if (String(row.status || "").toLowerCase() === "denied")
      timeline.push({ at: row.updated_at || row.created_at, type: "denied", note: "Access denied" });
    if (row.expires_at) timeline.push({ at: row.expires_at, type: "expires", note: "Access code expiry" });

    timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return res.json({ ok: true, visitor: row, timeline });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to load timeline" });
  }
}

/**
 * FACILITY: POST /facility/visitors/actions/lockdown
 * body: { mode?: "partial" | "emergency" }
 */
export async function triggerLockdownFacility(req: AuthReq, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const estateId = await resolveEstateId(req);
    const mode = String(req.body?.mode || "partial").toLowerCase() === "emergency" ? "emergency" : "partial";
    const now = new Date().toISOString();

    const { data: users } = await supabaseAdmin
      .from("estate_memberships")
      .select("user_id,role,status")
      .eq("estate_id", estateId)
      .eq("status", "active");

    const targetRoles = new Set(["owner", "admin", "manager", "security", "estate_admin", "operator"]);
    const recipients = Array.from(
      new Set((users || []).filter((u: any) => targetRoles.has(String(u.role || ""))).map((u: any) => String(u.user_id)))
    );

    if (recipients.length) {
      await supabaseAdmin.from("notifications").insert(
        recipients.map((uid) => {
          const notification = {
          user_id: uid,
          estate_id: estateId,
          type: "security",
          title: mode === "emergency" ? "Emergency Lockdown Activated" : "Lockdown Activated",
          message: "Visitor access controls have been switched to lockdown mode.",
          payload: { mode, source: "facility_visitors", at: now },
          status: "unread",
          created_at: now,
          };
          return { ...notification, ...routingColumns(normalizeNotificationRouting({ ...notification, routing: { source_type: "incident", destination: "attention", actionability: "acknowledge", attention_eligible: true, queue_eligible: false, acknowledgement_required: true } })) };
        }) as any
      );
    }

    return res.json({
      ok: true,
      mode,
      activated_at: now,
      recipients: recipients.length,
    });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to activate lockdown" });
  }
}

/**
 * FACILITY: GET /facility/visitors/reports/export?today=true&format=json|csv
 */
export async function exportVisitorReportFacility(req: AuthReq, res: Response) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const estateId = await resolveEstateId(req);
    const today = parseBool(req.query.today);
    const format = String(req.query.format || "json").toLowerCase();

    let q = supabaseAdmin
      .from("visitor_access")
      .select("*")
      .eq("estate_id", estateId)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (today) {
      const { startISO, endISO } = utcDayRange();
      q = q.gte("created_at", startISO).lt("created_at", endISO);
    }

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    const rows = data || [];

    const summary = rows.reduce(
      (acc: Record<string, number>, r: any) => {
        const s = String(r?.status || "active").toLowerCase();
        acc[s] = (acc[s] || 0) + 1;
        acc.total = (acc.total || 0) + 1;
        return acc;
      },
      { total: 0 }
    );

    if (format === "csv") {
      const header = ["id", "visitor_name", "visitor_phone", "purpose", "status", "access_code", "created_at", "expires_at"];
      const lines = [header.join(",")];
      for (const r of rows as any[]) {
        const line = [
          r.id,
          `"${String(r.visitor_name || "").replace(/"/g, '""')}"`,
          `"${String(r.visitor_phone || "").replace(/"/g, '""')}"`,
          `"${String(r.purpose || "").replace(/"/g, '""')}"`,
          r.status || "",
          r.access_code || "",
          r.created_at || "",
          r.expires_at || "",
        ];
        lines.push(line.join(","));
      }
      const csv = lines.join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"visitor-report-${today ? "today" : "all"}.csv\"`);
      return res.status(200).send(csv);
    }

    return res.json({
      ok: true,
      scope: today ? "today" : "all",
      summary,
      visitors: rows,
      generated_at: new Date().toISOString(),
    });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to export report" });
  }
}
