// src/controllers/visitorController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { generateAccessCode } from "../services/codeService";
import { createQrForLink } from "../services/qrService";
import { notifyUser, NotificationPayload } from "../services/NotificationService";

const DEFAULT_EXPIRES_HOURS = Number(process.env.VISITOR_DEFAULT_EXPIRES_HOURS || 12);
const VISITOR_LINK_BASE = process.env.VISITOR_LINK_BASE || "";

// -----------------------------
// Helpers
// -----------------------------
function cleanStr(v: any): string {
  return String(v ?? "").trim();
}

function pickFirstString(...values: any[]): string {
  for (const v of values) {
    const s = cleanStr(v);
    if (s) return s;
  }
  return "";
}

function pickOptionalString(...values: any[]): string | null {
  const s = pickFirstString(...values);
  return s ? s : null;
}

/* CREATE VISITOR */
export async function createVisitor(req: Request, res: Response) {
  try {
    const authed = req as any;
    const user = authed.user as any;

    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    // ✅ Option A: context MUST come from auth user
    const residentId = String(user.id);
    const estateIdFromUser = cleanStr(user.estate_id || user.estateId);
    const homeIdFromUser = cleanStr(user.home_id || user.homeId);

    if (!estateIdFromUser) {
      return res.status(400).json({ error: "User has no estate context" });
    }
    if (!homeIdFromUser) {
      return res.status(400).json({ error: "User has no home context" });
    }

    // ✅ Backward compatible request parsing:
    // Supports both:
    // - old frontend keys: visitorName, visitorPhone, navigationMode
    // - new clean keys: name, phone, navigation_mode
    const body = req.body || {};

    const name = pickFirstString(body.name, body.visitorName, body.visitor_name);
    const phone = pickOptionalString(body.phone, body.visitorPhone, body.visitor_phone);
    const purpose = pickOptionalString(body.purpose);
    const navigation_mode =
      pickFirstString(body.navigation_mode, body.navigationMode, body.navigationMode) || "mapbox";

    if (!name) return res.status(400).json({ error: "name is required" });

    const accessCode = await generateAccessCode();
    const expiresAt = new Date(
      Date.now() + DEFAULT_EXPIRES_HOURS * 3600 * 1000
    ).toISOString();

    // ✅ Insert with your NEW schema (Option A)
    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .insert([
        {
          estate_id: estateIdFromUser,
          home_id: homeIdFromUser,
          resident_id: residentId,

          name,
          phone,
          purpose,

          access_code: accessCode,
          navigation_mode,
          status: "pending",
          expires_at: expiresAt,
        },
      ])
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    const visitorId = data.id;

    // Build link + QR
    const link = VISITOR_LINK_BASE ? `${VISITOR_LINK_BASE}/${visitorId}` : `${visitorId}`;
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
      visitor: {
        id: visitorId,
        estate_id: estateIdFromUser,
        home_id: homeIdFromUser,
        resident_id: residentId,
        name,
        phone,
        purpose,
        navigation_mode,
      },
    });
  } catch (err: any) {
    console.error("createVisitor error", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

/* VERIFY VISITOR */
export async function verifyVisitor(req: Request, res: Response) {
  try {
    const authed = req as any;
    const user = authed.user as any;

    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    // ✅ Option A: estate context from user
    const estateId = cleanStr(user.estate_id || user.estateId);
    if (!estateId) return res.status(400).json({ error: "User has no estate context" });

    const { code } = req.body || {};
    const accessCode = cleanStr(code);

    if (!accessCode) return res.status(400).json({ error: "code is required" });

    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .select("*")
      .eq("access_code", accessCode)
      .eq("estate_id", estateId)
      .single();

    if (error || !data) return res.status(404).json({ error: "Invalid access code" });

    return res.json({ valid: true, visitor: data });
  } catch (err: any) {
    console.error("verifyVisitor", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

/* APPROVE VISITOR */
export async function approveVisitor(req: Request, res: Response) {
  try {
    const id = cleanStr(req.params.id);
    if (!id) return res.status(400).json({ error: "id required" });

    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .update({ status: "approved", verified_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    const payload: NotificationPayload = {
      title: "Visitor Approved",
      type: "visitor",
      entityId: id,
      message: `Visitor "${data?.name || "Visitor"}" approved.`,
      payload: { visitorId: id },
    };
    if (data?.resident_id) await notifyUser(data.resident_id, payload);

    return res.json({ ok: true, visitor: data });
  } catch (err: any) {
    console.error("approveVisitor", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

/* MARK ENTRY */
export async function markEntry(req: Request, res: Response) {
  try {
    const id = cleanStr(req.params.id);
    if (!id) return res.status(400).json({ error: "id required" });

    const { data: va } = await supabaseAdmin
      .from("visitor_access")
      .select("*")
      .eq("id", id)
      .single();

    if (!va) return res.status(404).json({ error: "not found" });

    const arrivedAt = new Date().toISOString();

    const { data, error } = await supabaseAdmin
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

    if (error) return res.status(500).json({ error: error.message });

    await supabaseAdmin.from("visitor_access").update({ status: "entered" }).eq("id", id);

    const payload: NotificationPayload = {
      title: "Visitor Entered",
      type: "visitor",
      entityId: id,
      message: `Visitor "${va?.name || "Visitor"}" entered estate.`,
      payload: { visitorId: id, arrivedAt },
    };
    if (va?.resident_id) await notifyUser(va.resident_id, payload);

    return res.json({ ok: true, analytics: data });
  } catch (err: any) {
    console.error("markEntry", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

/* MARK EXIT */
export async function markExit(req: Request, res: Response) {
  try {
    const id = cleanStr(req.params.id);
    if (!id) return res.status(400).json({ error: "id required" });

    const { data: analytics } = await supabaseAdmin
      .from("visitor_analytics")
      .select("*")
      .eq("visitor_access_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!analytics) return res.status(404).json({ error: "analytics not found" });

    const exitedAt = new Date().toISOString();
    const durationMinutes = Math.round(
      (new Date(exitedAt).getTime() - new Date(analytics.arrived_at).getTime()) / 60000
    );

    await supabaseAdmin
      .from("visitor_analytics")
      .update({ exited_at: exitedAt, duration_minutes: durationMinutes })
      .eq("id", analytics.id);

    await supabaseAdmin.from("visitor_access").update({ status: "exited" }).eq("id", id);

    const { data: va } = await supabaseAdmin
      .from("visitor_access")
      .select("*")
      .eq("id", id)
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
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

/* GET ANALYTICS FOR ESTATE */
export async function getAnalyticsForEstate(req: Request, res: Response) {
  try {
    // ✅ Optional hardening later:
    // Ensure req.user.estate_id matches req.params.estateId
    const estateId = cleanStr(req.params.estateId);
    if (!estateId) return res.status(400).json({ error: "estateId required" });

    const { data: analytics, error } = await supabaseAdmin
      .from("visitor_analytics")
      .select("*")
      .eq("estate_id", estateId);

    if (error) return res.status(500).json({ error: error.message });

    const totalVisitors = analytics.length;
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayVisitors = analytics.filter((a: any) => a.arrived_at?.slice(0, 10) === todayStr).length;
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
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

/* GET VISITOR INFO */
export async function getVisitorInfo(req: Request, res: Response) {
  try {
    const id = cleanStr(req.params.id);
    if (!id) return res.status(400).json({ error: "id required" });

    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .select("*, visitor_analytics(*)")
      .eq("id", id)
      .single();

    if (error || !data) return res.status(404).json({ error: "Visitor not found" });

    return res.json({ visitor: data });
  } catch (err: any) {
    console.error("getVisitorInfo", err);
    return res.status(500).json({ error: err?.message || String(err) });
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
