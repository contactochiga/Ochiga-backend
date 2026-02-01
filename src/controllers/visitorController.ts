// src/controllers/visitorController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { generateAccessCode } from "../services/codeService";
import { createQrForLink } from "../services/qrService";
import { notifyUser, NotificationPayload } from "../services/NotificationService";

const DEFAULT_EXPIRES_HOURS = Number(
  process.env.VISITOR_DEFAULT_EXPIRES_HOURS || 12
);
const VISITOR_LINK_BASE = process.env.VISITOR_LINK_BASE || "";

/**
 * Helper: pull estate/home/user context from auth
 * (Option A: everything tied to the logged-in user context)
 */
function getUserContext(req: Request) {
  const authed = req as any;
  const user = authed.user as any;

  const residentId = user?.id || null;
  const estateId = user?.estate_id || user?.estateId || null;
  const homeId = user?.home_id || user?.homeId || null;

  return { user, residentId, estateId, homeId };
}

/* CREATE VISITOR */
export async function createVisitor(req: Request, res: Response) {
  try {
    const { residentId, estateId, homeId } = getUserContext(req);

    if (!residentId) return res.status(401).json({ error: "Not authenticated" });
    if (!estateId) return res.status(400).json({ error: "User has no estate context" });
    if (!homeId) return res.status(400).json({ error: "User has no home context" });

    // ✅ New request shape (frontend)
    // name, phone, purpose, navigation_mode
    const { name, phone, purpose, navigation_mode } = req.body || {};

    if (!name) return res.status(400).json({ error: "name is required" });

    const accessCode = await generateAccessCode();
    const expiresAt = new Date(
      Date.now() + DEFAULT_EXPIRES_HOURS * 3600 * 1000
    ).toISOString();

    // ✅ New DB columns (Option A)
    // visitor_access: estate_id, home_id, resident_id, name, phone, purpose, navigation_mode, access_code, status, expires_at
    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .insert([
        {
          estate_id: estateId,
          home_id: homeId,
          resident_id: residentId,

          name,
          phone: phone || null,
          purpose: purpose || null,
          navigation_mode: navigation_mode || "mapbox",

          access_code: accessCode,
          status: "pending",
          expires_at: expiresAt,
        },
      ])
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    const visitorId = data.id;

    const link = VISITOR_LINK_BASE
      ? `${VISITOR_LINK_BASE}/${visitorId}`
      : `${visitorId}`;

    const qrS3Url = await createQrForLink(link, visitorId);

    await supabaseAdmin
      .from("visitor_access")
      .update({ qr_s3_url: qrS3Url })
      .eq("id", visitorId);

    // Notify resident
    const payload: NotificationPayload = {
      title: "New Visitor Created",
      type: "visitor",
      entityId: visitorId,
      message: `New visitor "${name}" created.`,
      payload: { link, accessCode, name },
    };
    await notifyUser(residentId, payload);

    return res.json({
      id: visitorId,
      link,
      code: accessCode,
      qr: qrS3Url,
      status: "pending",
      expiresAt,
    });
  } catch (err: any) {
    console.error("createVisitor error", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}

/* VERIFY VISITOR */
export async function verifyVisitor(req: Request, res: Response) {
  try {
    const { residentId, estateId } = getUserContext(req);
    if (!residentId) return res.status(401).json({ error: "Not authenticated" });
    if (!estateId) return res.status(400).json({ error: "User has no estate context" });

    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "code is required" });

    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .select("*")
      .eq("access_code", code)
      .eq("estate_id", estateId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Invalid access code for this estate" });
    }

    return res.json({ valid: true, visitor: data });
  } catch (err: any) {
    console.error("verifyVisitor", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}

/* APPROVE VISITOR */
export async function approveVisitor(req: Request, res: Response) {
  try {
    const { residentId, estateId } = getUserContext(req);
    if (!residentId) return res.status(401).json({ error: "Not authenticated" });
    if (!estateId) return res.status(400).json({ error: "User has no estate context" });

    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "id required" });

    // ✅ Scope approval to same estate
    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .update({ status: "approved", verified_at: new Date().toISOString() })
      .eq("id", id)
      .eq("estate_id", estateId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    const payload: NotificationPayload = {
      title: "Visitor Approved",
      type: "visitor",
      entityId: id,
      message: `Visitor "${data.name}" approved.`,
      payload: { visitorId: id },
    };
    await notifyUser(data.resident_id, payload);

    return res.json({ ok: true, visitor: data });
  } catch (err: any) {
    console.error("approveVisitor", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}

/* MARK ENTRY */
export async function markEntry(req: Request, res: Response) {
  try {
    const { residentId, estateId } = getUserContext(req);
    if (!residentId) return res.status(401).json({ error: "Not authenticated" });
    if (!estateId) return res.status(400).json({ error: "User has no estate context" });

    const id = req.params.id;

    const { data: va, error: vaErr } = await supabaseAdmin
      .from("visitor_access")
      .select("*")
      .eq("id", id)
      .eq("estate_id", estateId)
      .single();

    if (vaErr || !va) return res.status(404).json({ error: "not found" });

    const arrivedAt = new Date().toISOString();

    const { data: analytics, error: anErr } = await supabaseAdmin
      .from("visitor_analytics")
      .insert([
        {
          visitor_access_id: id,
          estate_id: va.estate_id,
          arrived_at: arrivedAt,
          created_at: arrivedAt,
        },
      ])
      .select()
      .single();

    if (anErr) return res.status(500).json({ error: anErr.message });

    await supabaseAdmin
      .from("visitor_access")
      .update({ status: "entered" })
      .eq("id", id)
      .eq("estate_id", estateId);

    const payload: NotificationPayload = {
      title: "Visitor Entered",
      type: "visitor",
      entityId: id,
      message: `Visitor "${va.name}" entered estate.`,
      payload: { visitorId: id, arrivedAt },
    };
    await notifyUser(va.resident_id, payload);

    return res.json({ ok: true, analytics });
  } catch (err: any) {
    console.error("markEntry", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}

/* MARK EXIT */
export async function markExit(req: Request, res: Response) {
  try {
    const { residentId, estateId } = getUserContext(req);
    if (!residentId) return res.status(401).json({ error: "Not authenticated" });
    if (!estateId) return res.status(400).json({ error: "User has no estate context" });

    const id = req.params.id;

    const { data: analytics, error: aErr } = await supabaseAdmin
      .from("visitor_analytics")
      .select("*")
      .eq("visitor_access_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (aErr || !analytics) return res.status(404).json({ error: "analytics not found" });

    const exitedAt = new Date().toISOString();
    const durationMinutes = Math.round(
      (new Date(exitedAt).getTime() - new Date(analytics.arrived_at).getTime()) / 60000
    );

    await supabaseAdmin
      .from("visitor_analytics")
      .update({ exited_at: exitedAt, duration_minutes: durationMinutes })
      .eq("id", analytics.id);

    await supabaseAdmin
      .from("visitor_access")
      .update({ status: "exited" })
      .eq("id", id)
      .eq("estate_id", estateId);

    const { data: va } = await supabaseAdmin
      .from("visitor_access")
      .select("*")
      .eq("id", id)
      .eq("estate_id", estateId)
      .single();

    const payload: NotificationPayload = {
      title: "Visitor Exited",
      type: "visitor",
      entityId: id,
      message: `Visitor "${va?.name || "Visitor"}" exited estate.`,
      payload: { visitorId: id, exitedAt, durationMinutes },
    };
    if (va?.resident_id) await notifyUser(va.resident_id, payload);

    return res.json({ ok: true, durationMinutes });
  } catch (err: any) {
    console.error("markExit", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}

/* GET ANALYTICS FOR CURRENT USER ESTATE */
export async function getAnalyticsForEstate(req: Request, res: Response) {
  try {
    const { residentId, estateId } = getUserContext(req);
    if (!residentId) return res.status(401).json({ error: "Not authenticated" });
    if (!estateId) return res.status(400).json({ error: "User has no estate context" });

    // ✅ ignore params, always scope to logged-in user's estate
    const { data: analytics, error } = await supabaseAdmin
      .from("visitor_analytics")
      .select("*")
      .eq("estate_id", estateId);

    if (error) return res.status(500).json({ error: error.message });

    const totalVisitors = analytics.length;
    const todayStr = new Date().toISOString().slice(0, 10);

    const todayVisitors = analytics.filter(
      (a: any) => a.arrived_at?.slice(0, 10) === todayStr
    ).length;

    const exitedVisitors = analytics.filter((a: any) => a.exited_at != null).length;

    return res.json({
      estateId,
      totalVisitors,
      todayVisitors,
      exitedVisitors,
      records: analytics,
    });
  } catch (err: any) {
    console.error("getAnalyticsForEstate", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}

/* GET VISITOR INFO */
export async function getVisitorInfo(req: Request, res: Response) {
  try {
    const { residentId, estateId } = getUserContext(req);
    if (!residentId) return res.status(401).json({ error: "Not authenticated" });
    if (!estateId) return res.status(400).json({ error: "User has no estate context" });

    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "id required" });

    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .select("*, visitor_analytics(*)")
      .eq("id", id)
      .eq("estate_id", estateId)
      .single();

    if (error || !data) return res.status(404).json({ error: "Visitor not found" });

    return res.json({ visitor: data });
  } catch (err: any) {
    console.error("getVisitorInfo", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}

export default {
  createVisitor,
  verifyVisitor,
  approveVisitor,
  markEntry,
  markExit,
  getAnalyticsForEstate,
  getVisitorInfo,
};
