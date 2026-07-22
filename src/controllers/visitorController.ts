// src/controllers/visitorController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { generateAccessCode } from "../services/codeService";
import { createQrForLink } from "../services/qrService";
import { notifyUser, NotificationPayload } from "../services/NotificationService";
import { publishSourceIntelligenceEvent } from "../intelligence-core";
import { createPublicApiError, sendPublicApiError } from "../services/publicApi";

// Office roles (facility operators / staff) may act on visitor rows across the
// estate they belong to, even when they have no home_id of their own.
const ESTATE_OPERATOR_ROLES = new Set([
  "facility_manager",
  "security_operator",
  "maintenance_operator",
  "finance_operator",
  "estate_admin",
  "ochiga_admin",
  "super_admin",
]);

const DEFAULT_EXPIRES_HOURS = Number(process.env.VISITOR_DEFAULT_EXPIRES_HOURS || 12);
const VISITOR_LINK_BASE = process.env.VISITOR_LINK_BASE || "";

function requireUserContext(req: Request) {
  const user = (req as any).user as any;

  const estateId = (req as any).oisContext?.estate_id || user?.estate_id || user?.estateId;
  const homeId = (req as any).oisContext?.home_id || user?.home_id || user?.homeId;
  const userId = user?.id;

  if (!userId) throw new Error("Not authenticated");
  if (!estateId) throw new Error("User has no estate context");
  if (!homeId) throw new Error("User has no home context");

  return { user, userId, estateId, homeId };
}

function readUserContext(req: Request) {
  const user = (req as any).user as any;
  return {
    user,
    userId: user?.id ? String(user.id) : "",
    estateId: (req as any).oisContext?.estate_id || user?.estate_id || user?.estateId || null,
    homeId: (req as any).oisContext?.home_id || user?.home_id || user?.homeId || null,
    role: String(user?.role || "guest").toLowerCase(),
  };
}

function isEstateOperator(role: string) {
  return ESTATE_OPERATOR_ROLES.has(String(role || "").toLowerCase());
}

/**
 * Security: assert the caller actually owns / is authorized to act on a
 * specific visitor_access row. Prevents IDOR (cross-estate / cross-home
 * access by forged :id). Residents may only act on rows in their own home;
 * estate operators may act on any row in their own estate.
 *
 * Returns the verified visitor row or throws a PublicApiError.
 */
async function authorizeVisitorForUser(
  visitorId: string,
  context: { userId: string; estateId: string | null; homeId: string | null; role: string },
  select: string = "*"
): Promise<any> {
  if (!context.userId) throw createPublicApiError(401, "unauthenticated", "Not authenticated");
  if (!context.estateId) throw createPublicApiError(403, "missing_estate_context", "User has no estate context");

  const { data: row, error } = await supabaseAdmin
    .from("visitor_access")
    .select(select)
    .eq("id", visitorId)
    .maybeSingle();

  if (error) throw createPublicApiError(500, "visitor_lookup_failed", "Visitor could not be verified.");
  if (!row) throw createPublicApiError(404, "visitor_not_found", "Visitor not found");

  const rowEstateId = String((row as any).estate_id || "");
  const rowHomeId = String((row as any).home_id || "");

  // Estate must always match.
  if (rowEstateId && rowEstateId !== String(context.estateId)) {
    throw createPublicApiError(403, "visitor_access_denied", "You are not authorized to access this visitor.");
  }

  // Residents are scoped to their home; operators are scoped to the estate.
  const operator = isEstateOperator(context.role);
  if (!operator) {
    if (!rowHomeId || rowHomeId !== String(context.homeId || "")) {
      throw createPublicApiError(403, "visitor_access_denied", "You are not authorized to access this visitor.");
    }
  }

  return row as any;
}

function publishVisitorAccessEvent(visitor: any, eventType: string, actorId?: string | null) {
  void publishSourceIntelligenceEvent({
    source: "consumer",
    surface: "consumer",
    event_type: eventType,
    category: "visitor",
    estate_id: visitor?.estate_id || null,
    home_id: visitor?.home_id || null,
    actor_id: actorId || visitor?.created_by || visitor?.resident_id || null,
    entity_type: "visitor_access",
    entity_id: visitor?.id || null,
    entity_label: visitor?.visitor_name || "Visitor access",
    severity: /denied|expired/i.test(eventType) ? "attention" : "info",
    title: `${visitor?.visitor_name || "Visitor"} access ${eventType.split(".").pop() || "updated"}`,
    summary: `Visitor access is ${visitor?.status || "updated"}.`,
    payload: { status: visitor?.status || null, purpose: visitor?.purpose || null, expires_at: visitor?.expires_at || null },
    occurred_at: visitor?.updated_at || visitor?.created_at,
  }, { source_table: "visitor_access", source_event_id: `${visitor?.id || "unknown"}:${eventType}` });
}

/**
 * CREATE VISITOR
 * - estate/home context comes from req.user (Option A)
 * - body only carries visitor details
 */
export async function createVisitor(req: Request, res: Response) {
  const ctx = readUserContext(req);
  try {
    const { userId, estateId, homeId } = requireUserContext(req);

    const {
      name,
      phone,
      purpose,
      navigation_mode, // optional
      expires_hours,   // optional
    } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    // Your DB column is NOT NULL, so enforce it.
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ error: "phone is required" });
    }

    const accessCode = await generateAccessCode();

    const hours = Number(expires_hours || DEFAULT_EXPIRES_HOURS);
    const expiresAt =
      Number.isFinite(hours) && hours > 0
        ? new Date(Date.now() + hours * 3600 * 1000).toISOString()
        : null;

    const navMode = String(navigation_mode || "code");

    // Insert matching your actual visitor_access columns
    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .insert([
        {
          estate_id: estateId,
          home_id: homeId,
          created_by: userId,
          resident_id: userId, // optional in table, but we set it (helps)
          visitor_name: String(name).trim(),
          visitor_phone: String(phone).trim(),
          purpose: purpose ? String(purpose).trim() : null,
          access_code: String(accessCode),
          status: "active",
          expires_at: expiresAt,
          navigation_mode: navMode,
        },
      ])
      .select()
      .single();

    if (error) {
      throw createPublicApiError(500, "visitor_create_failed", "Visitor could not be created.");
    }

    const visitorId = data.id as string;
    publishVisitorAccessEvent(data, "visitor_access.created", userId);

    // Build link + QR (optional)
    const link = VISITOR_LINK_BASE ? `${VISITOR_LINK_BASE}/${visitorId}` : null;

    let qrS3Url: string | null = null;
    if (link) {
      try {
        qrS3Url = await createQrForLink(link, visitorId);
        // If you have qr_s3_url column later, you can update it safely.
        // For now: don’t hard-fail if column doesn't exist.
        await supabaseAdmin.from("visitor_access").update({ qr_s3_url: qrS3Url } as any).eq("id", visitorId);
      } catch {
        // ignore QR failures; creation still succeeds
      }
    }

    // Notify resident
    const payload: NotificationPayload = {
      title: "New Visitor Created",
      type: "visitor",
      entityId: visitorId,
      message: `New visitor "${data.visitor_name}" created.`,
      payload: { link, accessCode, visitorName: data.visitor_name, visitorId, visitor_id: visitorId, estate_id: estateId, home_id: homeId },
    };

    await notifyUser(userId, payload);

    return res.json({
      ok: true,
      visitor: data,
      link,
      code: accessCode,
      qr: qrS3Url,
    });
  } catch (err: any) {
    return sendPublicApiError(res, err, { statusCode: 500, code: "create_visitor_failed", message: "Create visitor failed." }, { operation: "visitor.create", actor_id: ctx.userId });
  }
}

/**
 * LIST MY VISITORS
 * - persistent consumer list for resident-created access requests
 */
export async function listMyVisitors(req: Request, res: Response) {
  const ctx = readUserContext(req);
  try {
    const { userId, estateId, homeId } = ctx;
    if (!userId) throw createPublicApiError(401, "unauthenticated", "Not authenticated");
    if (!estateId || !homeId) {
      return res.json({ items: [] });
    }

    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .select("*")
      .eq("estate_id", estateId)
      .eq("home_id", homeId)
      .or(`created_by.eq.${userId},resident_id.eq.${userId}`)
      .order("created_at", { ascending: false });

    if (error) throw createPublicApiError(500, "visitor_list_failed", "Visitor list could not be loaded.");

    return res.json({ items: data || [] });
  } catch (err: any) {
    return sendPublicApiError(res, err, { statusCode: 500, code: "list_my_visitors_failed", message: "List my visitors failed." }, { operation: "visitor.listMine", actor_id: ctx.userId });
  }
}

/**
 * VERIFY VISITOR BY CODE (estate-scoped)
 * - estateId comes from req.user
 */
export async function verifyVisitor(req: Request, res: Response) {
  try {
    const { estateId } = requireUserContext(req);
    const { code } = req.body || {};

    if (!code) throw createPublicApiError(400, "code_required", "code is required");

    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .select("*")
      .eq("access_code", String(code))
      .eq("estate_id", estateId)
      .single();

    if (error || !data) {
      throw createPublicApiError(404, "invalid_access_code", "Invalid access code");
    }

    return res.json({ valid: true, visitor: data });
  } catch (err: any) {
    return sendPublicApiError(res, err, { statusCode: 500, code: "verify_visitor_failed", message: "Verify visitor failed." }, { operation: "visitor.verify", actor_id: readUserContext(req).userId });
  }
}

/**
 * APPROVE VISITOR
 * - keep simple: update status only (your table doesn't show verified_at)
 */
export async function approveVisitor(req: Request, res: Response) {
  const ctx = readUserContext(req);
  try {
    requireUserContext(req);
    const id = String(req.params.id || "");
    if (!id) throw createPublicApiError(400, "id_required", "id is required");

    // Security: verify the caller owns this visitor row before mutating.
    await authorizeVisitorForUser(id, ctx, "id");

    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .update({ status: "approved" })
      .eq("id", id)
      .select()
      .single();

    if (error) throw createPublicApiError(500, "visitor_update_failed", "Visitor could not be updated.");

    // Notify resident_id if present
    const residentId = data.resident_id || data.created_by;
    if (residentId) {
      const payload: NotificationPayload = {
        title: "Visitor Approved",
        type: "visitor",
        entityId: id,
        message: `Visitor "${data.visitor_name}" approved.`,
        payload: { visitorId: id, visitor_id: id, estate_id: data.estate_id || null, home_id: data.home_id || null },
      };
      await notifyUser(residentId, payload);
    }
    publishVisitorAccessEvent(data, "visitor_access.approved");

    return res.json({ ok: true, visitor: data });
  } catch (err: any) {
    return sendPublicApiError(res, err, { statusCode: 500, code: "approve_visitor_failed", message: "Approve visitor failed." }, { operation: "visitor.approve", actor_id: ctx.userId, visitor_id: String(req.params.id || "") });
  }
}

/**
 * DENY VISITOR (so your "Deny" button works)
 */
export async function denyVisitor(req: Request, res: Response) {
  const ctx = readUserContext(req);
  try {
    requireUserContext(req);
    const id = String(req.params.id || "");
    if (!id) throw createPublicApiError(400, "id_required", "id is required");

    // Security: verify the caller owns this visitor row before mutating.
    await authorizeVisitorForUser(id, ctx, "id");

    const { data, error } = await supabaseAdmin
      .from("visitor_access")
      .update({ status: "denied" })
      .eq("id", id)
      .select()
      .single();

    if (error) throw createPublicApiError(500, "visitor_update_failed", "Visitor could not be updated.");

    const residentId = data.resident_id || data.created_by;
    if (residentId) {
      const payload: NotificationPayload = {
        title: "Visitor Denied",
        type: "visitor",
        entityId: id,
        message: `Visitor "${data.visitor_name}" denied.`,
        payload: { visitorId: id, visitor_id: id, estate_id: data.estate_id || null, home_id: data.home_id || null },
      };
      await notifyUser(residentId, payload);
    }
    publishVisitorAccessEvent(data, "visitor_access.denied");

    return res.json({ ok: true, visitor: data });
  } catch (err: any) {
    return sendPublicApiError(res, err, { statusCode: 500, code: "deny_visitor_failed", message: "Deny visitor failed." }, { operation: "visitor.deny", actor_id: ctx.userId, visitor_id: String(req.params.id || "") });
  }
}

/**
 * MARK ENTRY
 * - FIX: ensure analytics row exists (upsert)
 */
export async function markEntry(req: Request, res: Response) {
  const ctx = readUserContext(req);
  try {
    const { estateId, homeId, userId } = requireUserContext(req);
    const id = String(req.params.id || "");
    if (!id) throw createPublicApiError(400, "id_required", "id is required");

    // Security: verify the caller owns this visitor row.
    const va = await authorizeVisitorForUser(id, ctx);

    const arrivedAt = new Date().toISOString();

    // Upsert analytics by visitor_access_id
    const { data: analytics, error: aErr } = await supabaseAdmin
      .from("visitor_analytics")
      .upsert(
        {
          visitor_access_id: id,
          estate_id: estateId,
          home_id: homeId,
          created_by: userId,
          arrived_at: arrivedAt,
        } as any,
        { onConflict: "visitor_access_id" }
      )
      .select()
      .single();

    if (aErr) throw createPublicApiError(500, "visitor_analytics_failed", "Visitor analytics could not be updated.");

    const { data: enteredVisitor } = await supabaseAdmin.from("visitor_access").update({ status: "entered" }).eq("id", id).select().maybeSingle();
    publishVisitorAccessEvent(enteredVisitor || { ...va, status: "entered", updated_at: arrivedAt }, "visitor_access.used", userId);

    const residentId = va.resident_id || va.created_by;
    if (residentId) {
      const payload: NotificationPayload = {
        title: "Visitor Entered",
        type: "visitor",
        entityId: id,
        message: `Visitor "${va.visitor_name}" entered.`,
        payload: { visitorId: id, visitor_id: id, arrivedAt, estate_id: va.estate_id || null, home_id: va.home_id || null },
      };
      await notifyUser(residentId, payload);
    }

    return res.json({ ok: true, analytics });
  } catch (err: any) {
    return sendPublicApiError(res, err, { statusCode: 500, code: "mark_entry_failed", message: "Mark entry failed." }, { operation: "visitor.markEntry", actor_id: ctx.userId, visitor_id: String(req.params.id || "") });
  }
}

/**
 * MARK EXIT
 * - FIX: if analytics missing, create a 0-min record instead of 404
 */
export async function markExit(req: Request, res: Response) {
  const ctx = readUserContext(req);
  try {
    const { estateId, homeId, userId } = requireUserContext(req);
    const id = String(req.params.id || "");
    if (!id) throw createPublicApiError(400, "id_required", "id is required");

    const exitedAt = new Date().toISOString();

    // Security: verify the caller owns this visitor row.
    const va = await authorizeVisitorForUser(id, ctx);

    // Try get analytics
    const { data: analytics } = await supabaseAdmin
      .from("visitor_analytics")
      .select("*")
      .eq("visitor_access_id", id)
      .single();

    let durationMinutes = 0;

    if (analytics?.arrived_at) {
      durationMinutes = Math.round(
        (new Date(exitedAt).getTime() - new Date(analytics.arrived_at).getTime()) / 60000
      );
      await supabaseAdmin
        .from("visitor_analytics")
        .update({
          exited_at: exitedAt,
          duration_minutes: durationMinutes,
        } as any)
        .eq("visitor_access_id", id);
    } else {
      // Create fallback analytics
      await supabaseAdmin.from("visitor_analytics").insert({
        visitor_access_id: id,
        estate_id: estateId,
        home_id: homeId,
        created_by: userId,
        arrived_at: exitedAt,
        exited_at: exitedAt,
        duration_minutes: 0,
      } as any);
    }

    const { data: exitedVisitor } = await supabaseAdmin.from("visitor_access").update({ status: "exited" }).eq("id", id).select().maybeSingle();
    publishVisitorAccessEvent(exitedVisitor || { ...va, status: "exited", updated_at: exitedAt }, "visitor_access.exited", userId);

    const residentId = va.resident_id || va.created_by;
    if (residentId) {
      const payload: NotificationPayload = {
        title: "Visitor Exited",
        type: "visitor",
        entityId: id,
        message: `Visitor "${va.visitor_name}" exited.`,
        payload: { visitorId: id, visitor_id: id, exitedAt, durationMinutes, estate_id: va.estate_id || null, home_id: va.home_id || null },
      };
      await notifyUser(residentId, payload);
    }

    return res.json({ ok: true, durationMinutes });
  } catch (err: any) {
    return sendPublicApiError(res, err, { statusCode: 500, code: "mark_exit_failed", message: "Mark exit failed." }, { operation: "visitor.markExit", actor_id: ctx.userId, visitor_id: String(req.params.id || "") });
  }
}

/**
 * GET VISITOR INFO (with analytics)
 */
export async function getVisitorInfo(req: Request, res: Response) {
  const ctx = readUserContext(req);
  try {
    requireUserContext(req);
    const id = String(req.params.id || "");
    if (!id) throw createPublicApiError(400, "id_required", "id is required");

    // Security: verify the caller owns this visitor row, returning the
    // analytics-joined projection.
    const data = await authorizeVisitorForUser(id, ctx, "*, visitor_analytics(*)");

    return res.json({ visitor: data });
  } catch (err: any) {
    return sendPublicApiError(res, err, { statusCode: 500, code: "get_visitor_info_failed", message: "Get visitor info failed." }, { operation: "visitor.getInfo", actor_id: ctx.userId, visitor_id: String(req.params.id || "") });
  }
}

/**
 * ESTATE ANALYTICS (simple)
 */
export async function getAnalyticsForEstate(req: Request, res: Response) {
  const ctx = readUserContext(req);
  try {
    const { estateId } = requireUserContext(req);

    // only allow current estate
    const requestedEstateId = String(req.params.estateId || "");
    if (requestedEstateId && requestedEstateId !== estateId) {
      throw createPublicApiError(403, "forbidden", "Forbidden");
    }

    const { data: analytics, error } = await supabaseAdmin
      .from("visitor_analytics")
      .select("*")
      .eq("estate_id", estateId);

    if (error) throw createPublicApiError(500, "analytics_unavailable", "Visitor analytics could not be loaded.");

    return res.json({
      estateId,
      totalVisitors: analytics?.length || 0,
      records: analytics || [],
    });
  } catch (err: any) {
    return sendPublicApiError(res, err, { statusCode: 500, code: "get_analytics_failed", message: "Get analytics failed." }, { operation: "visitor.analytics", actor_id: ctx.userId, estate_id: String(req.params.estateId || "") });
  }
}

export default {
  createVisitor,
  verifyVisitor,
  approveVisitor,
  denyVisitor,
  markEntry,
  markExit,
  getVisitorInfo,
  getAnalyticsForEstate,
};
