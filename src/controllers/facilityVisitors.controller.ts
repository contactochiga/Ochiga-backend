// src/controllers/facilityVisitors.controller.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

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

    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .update({ status, updated_at: new Date().toISOString() } as any)
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true, visitor: data });
  } catch (e: any) {
    console.error("updateVisitorStatusFacility error:", e?.message || e);
    return res.status(400).json({ error: e?.message || "Update failed" });
  }
}
