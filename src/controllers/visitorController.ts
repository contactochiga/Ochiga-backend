// src/controllers/visitorController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { generateAccessCode } from "../services/codeService";
import { createQrForLink } from "../services/qrService";
import { notifyUser, NotificationPayload } from "../services/NotificationService";

const DEFAULT_EXPIRES_HOURS = Number(process.env.VISITOR_DEFAULT_EXPIRES_HOURS || 12);
const VISITOR_LINK_BASE = process.env.VISITOR_LINK_BASE || "";

/**
 * Utility: pull auth context safely
 */
function getAuthContext(req: Request) {
  const authed = req as any;
  const user = authed.user;

  const userId = user?.id as string | undefined;
  const estateId = user?.estate_id as string | undefined;
  const homeId = user?.home_id as string | undefined;

  if (!userId) throw new Error("Not authenticated");
  if (!estateId) throw new Error("User has no estate context");
  if (!homeId) throw new Error("User has no home context");

  return { userId, estateId, homeId };
}

/* CREATE VISITOR */
export async function createVisitor(req: Request, res: Response) {
  try {
    const { userId, estateId, homeId } = getAuthContext(req);

    // ✅ Accept only the actual visitor fields from UI
    const {
      visitorName,
      visitorPhone,
      purpose,
      navigationMode,
      // optional legacy
      houseId,
    } = req.body || {};

    if (!visitorName || String(visitorName).trim().length === 0) {
      return res.status(400).json({ error: "visitorName is required" });
    }

    if (!visitorPhone || String(visitorPhone).trim().length === 0) {
      return res.status(400).json({ error: "visitorPhone is required" });
    }

    const accessCode = await generateAccessCode();

    const expiresAt = new Date(
      Date.now() + DEFAULT_EXPIRES_HOURS * 3600 * 1000
    ).toISOString();

    // ✅ Insert aligned with your table columns
    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .insert([
        {
          estate_id: estateId,
          home_id: homeId,

          created_by: userId,     // ✅ REQUIRED
          resident_id: userId,    // ✅ recommended (even though nullable)

          visitor_name: String(visitorName).trim(),
          visitor_phone: String(visitorPhone).trim(),
          purpose: purpose ? String(purpose).trim() : null,

          access_code: accessCode,
          status: "active",

          navigation_mode: navigationMode ? String(navigationMode) : "code",

          expires_at: expiresAt,

          // legacy/optional
          house_id: houseId || null,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("createVisitor insert error:", error);
      return res.status(500).json({ error: error.message });
    }

    const visitorId = data.id;

    // Optional: generate QR + link
    const link = VISITOR_LINK_BASE ? `${VISITOR_LINK_BASE}/${visitorId}` : null;

    let qrS3Url: string | null = null;
    if (link) {
      try {
        qrS3Url = await createQrForLink(link, visitorId);
        // Only update if you actually have this column in DB.
        // If you don't, remove this block.
        await supabaseAdmin
          .from("visitor_access")
          .update({ qr_s3_url: qrS3Url } as any)
          .eq("id", visitorId);
      } catch (e) {
        // safe fail — visitor creation should still succeed
        console.warn("QR generation failed (non-blocking):", e);
      }
    }

    // Notify resident (creator)
    const payload: NotificationPayload = {
      title: "New Visitor Created",
      type: "visitor",
      entityId: visitorId,
      message: `New visitor "${data.visitor_name}" created.`,
      payload: {
        visitorId,
        link,
        accessCode,
        visitorName: data.visitor_name,
      },
    };
    await notifyUser(userId, payload);

    return res.json({
      ok: true,
      id: visitorId,
      code: accessCode,
      link,
      qr: qrS3Url,
      status: data.status,
      expiresAt,
      visitor: data,
    });
  } catch (err: any) {
    console.error("createVisitor error", err);
    return res.status(500).json({ error: err.message || "createVisitor failed" });
  }
}

/* VERIFY VISITOR */
export async function verifyVisitor(req: Request, res: Response) {
  try {
    const { estateId } = getAuthContext(req);

    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "code is required" });

    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .select("*")
      .eq("access_code", String(code).trim())
      .eq("estate_id", estateId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Invalid access code" });
    }

    return res.json({ valid: true, visitor: data });
  } catch (err: any) {
    console.error("verifyVisitor error", err);
    return res.status(500).json({ error: err.message || "verifyVisitor failed" });
  }
}

/* APPROVE VISITOR */
export async function approveVisitor(req: Request, res: Response) {
  try {
    const { userId, estateId } = getAuthContext(req);
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "id required" });

    // Ensure visitor belongs to same estate
    const { data: existing, error: findErr } = await supabaseAdmin
      .from("visitor_access")
      .select("*")
      .eq("id", id)
      .eq("estate_id", estateId)
      .single();

    if (findErr || !existing) {
      return res.status(404).json({ error: "Visitor not found" });
    }

    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .update({
        status: "approved",
      })
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    const payload: NotificationPayload = {
      title: "Visitor Approved",
      type: "visitor",
      entityId: id,
      message: `Visitor "${data.visitor_name}" approved.`,
      payload: { visitorId: id },
    };

    // notify resident/creator
    await notifyUser(data.resident_id || userId, payload);

    return res.json({ ok: true, visitor: data });
  } catch (err: any) {
    console.error("approveVisitor error", err);
    return res.status(500).json({ error: err.message || "approveVisitor failed" });
  }
}

/* MARK ENTRY */
export async function markEntry(req: Request, res: Response) {
  try {
    const { estateId } = getAuthContext(req);
    const id = req.params.id;

    const { data: va, error } = await supabaseAdmin
      .from("visitor_access")
      .select("*")
      .eq("id", id)
      .eq("estate_id", estateId)
      .single();

    if (error || !va) return res.status(404).json({ error: "not found" });

    const arrivedAt = new Date().toISOString();

    const { data: analytics, error: aErr } = await supabaseAdmin
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

    if (aErr) return res.status(500).json({ error: aErr.message });

    await supabaseAdmin.from("visitor_access").update({ status: "entered" }).eq("id", id);

    const payload: NotificationPayload = {
      title: "Visitor Entered",
      type: "visitor",
      entityId: id,
      message: `Visitor "${va.visitor_name}" entered estate.`,
      payload: { visitorId: id, arrivedAt },
    };
    await notifyUser(va.resident_id || va.created_by, payload);

    return res.json({ ok: true, analytics });
  } catch (err: any) {
    console.error("markEntry error", err);
    return res.status(500).json({ error: err.message || "markEntry failed" });
  }
}

/* MARK EXIT */
export async function markExit(req: Request, res: Response) {
  try {
    const { estateId } = getAuthContext(req);
    const id = req.params.id;

    const { data: analytics, error: aErr } = await supabaseAdmin
      .from("visitor_analytics")
      .select("*")
      .eq("visitor_access_id", id)
      .eq("estate_id", estateId)
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

    await supabaseAdmin.from("visitor_access").update({ status: "exited" }).eq("id", id);

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
      message: `Visitor "${va?.visitor_name}" exited estate.`,
      payload: { visitorId: id, exitedAt, durationMinutes },
    };
    await notifyUser(va?.resident_id || va?.created_by, payload);

    return res.json({ ok: true, durationMinutes });
  } catch (err: any) {
    console.error("markExit error", err);
    return res.status(500).json({ error: err.message || "markExit failed" });
  }
}

/* GET ANALYTICS FOR ESTATE */
export async function getAnalyticsForEstate(req: Request, res: Response) {
  try {
    const { estateId } = getAuthContext(req);

    const { data: analytics, error } = await supabaseAdmin
      .from("visitor_analytics")
      .select("*")
      .eq("estate_id", estateId);

    if (error) return res.status(500).json({ error: error.message });

    const totalVisitors = analytics.length;
    const todayStr = new Date().toISOString().slice(0, 10);

    const todayVisitors = analytics.filter((a) => a.arrived_at?.slice(0, 10) === todayStr).length;
    const exitedVisitors = analytics.filter((a) => a.exited_at != null).length;

    return res.json({
      estateId,
      totalVisitors,
      todayVisitors,
      exitedVisitors,
      records: analytics,
    });
  } catch (err: any) {
    console.error("getAnalyticsForEstate error", err);
    return res.status(500).json({ error: err.message || "getAnalyticsForEstate failed" });
  }
}

/* GET VISITOR INFO */
export async function getVisitorInfo(req: Request, res: Response) {
  try {
    const { estateId } = getAuthContext(req);

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
    console.error("getVisitorInfo error", err);
    return res.status(500).json({ error: err.message || "getVisitorInfo failed" });
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
