// src/controllers/invites.controller.ts
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../supabase/supabaseClient";
import {
  acceptInvite,
  createInvite,
  declineInvite,
  listInvitesForEmail,
} from "../services/invitesService";

const APP_JWT_SECRET = process.env.APP_JWT_SECRET!;
if (!APP_JWT_SECRET) {
  console.warn("⚠️ APP_JWT_SECRET is missing in env");
}

function signToken(payload: any) {
  if (!APP_JWT_SECRET) throw new Error("APP_JWT_SECRET missing");
  return jwt.sign(payload, APP_JWT_SECRET, { expiresIn: "30d" });
}

// Home-level roles this legacy compatibility route may still grant. Estate/
// tenant-staff-level roles (owner, admin, manager, security, staff) must only
// ever be granted through an authorized, tenant-scoped path -- this route
// previously accepted ANY membership_role value with no ownership check at
// all (see the tenancy guard below), letting any staff.manage holder grant
// themselves or anyone else "owner" on a home/estate they had no authority
// over.
const LEGACY_INVITE_ALLOWED_ROLES = new Set(["resident", "member", "guest"]);

/**
 * POST /invites
 * Legacy compatibility route -- creates an invite for a home. New resident
 * onboarding should use POST /facility/homes/:homeId/invite instead (it has
 * stronger replay protection and the same tenancy guard enforced below).
 * Body: { estate_id, home_id, invited_email, role?, expires_at? }
 */
export async function createInviteHandler(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    const { estate_id, home_id, invited_email, role, expires_at } = req.body || {};

    if (!estate_id || !home_id || !invited_email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Commercial production-hardening: this tenancy guard was previously
    // written but commented out, and the role parameter was passed straight
    // through to the DB with no restriction -- together, any authenticated
    // user holding "staff.manage" (any estate_admin/facility_manager
    // anywhere) could invite an arbitrary email into a DIFFERENT tenant's
    // estate/home with role "owner"/"admin", a real cross-tenant privilege
    // escalation. Both checks are now enforced.
    const requestedRole = role ? String(role) : "resident";
    if (!LEGACY_INVITE_ALLOWED_ROLES.has(requestedRole)) {
      return res.status(403).json({ error: "This route may only invite resident-tier members. Use the estate/staff invitation flow for elevated roles." });
    }

    const { data: membership, error: memErr } = await supabaseAdmin
      .from("estate_memberships")
      .select("role, status")
      .eq("estate_id", String(estate_id))
      .eq("user_id", user.id)
      .maybeSingle();
    if (memErr) return res.status(500).json({ error: memErr.message });
    const membershipRole = String(membership?.role || "");
    const canManageEstate =
      membership?.status === "active" &&
      ["owner", "admin", "manager", "security", "estate_admin", "operator"].includes(membershipRole);
    if (!canManageEstate) {
      return res.status(403).json({ error: "You are not authorized to invite members into this estate." });
    }

    const { data: home, error: homeErr } = await supabaseAdmin
      .from("homes")
      .select("id, estate_id")
      .eq("id", String(home_id))
      .maybeSingle();
    if (homeErr) return res.status(500).json({ error: homeErr.message });
    if (!home || home.estate_id !== String(estate_id)) {
      return res.status(400).json({ error: "That home does not belong to the specified estate." });
    }

    const result = await createInvite({
      estate_id: String(estate_id),
      home_id: String(home_id),
      invited_email: String(invited_email),
      role: requestedRole as any,
      created_by: user.id,
      expires_at: expires_at ? String(expires_at) : undefined,
    });

    if ("error" in result) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ ok: true, invite: result.invite });
  } catch (e: any) {
    console.error("createInviteHandler error:", e);
    return res.status(500).json({ error: "Unexpected server error" });
  }
}

/**
 * GET /invites/mine
 * Consumer lists invites for their email (from JWT payload)
 */
export async function listMyInvitesHandler(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    const email = (user.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "No email on session token" });

    const result = await listInvitesForEmail(email);
    if ("error" in result) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ ok: true, invites: result.invites });
  } catch (e: any) {
    console.error("listMyInvitesHandler error:", e);
    return res.status(500).json({ error: "Unexpected server error" });
  }
}

/**
 * POST /invites/:inviteId/accept
 * Consumer accepts invite
 *
 * ✅ Returns fresh token so consumer session updates instantly:
 * { ok: true, token, user, membership? }
 */
export async function acceptInviteHandler(req: Request, res: Response) {
  try {
    const authed = req.user;
    if (!authed?.id) return res.status(401).json({ error: "Not authenticated" });

    const email = (authed.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "No email on session token" });

    const inviteId = String(req.params.inviteId || "");
    if (!inviteId) return res.status(400).json({ error: "Missing inviteId" });

    const result = await acceptInvite({
      inviteId,
      userId: authed.id,
      userEmail: email,
    });

    if ("error" in result) {
      return res.status(400).json({ error: result.error });
    }

    // ✅ pull fresh user record (so estate_id/home_id are current)
    const { data: user, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id,email,role,estate_id,home_id")
      .eq("id", authed.id)
      .single();

    if (userErr || !user) {
      return res.status(500).json({ error: userErr?.message || "Failed to load user" });
    }

    // ✅ sign refreshed app token
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      estate_id: user.estate_id,
      home_id: user.home_id,
    });

    // Optional: also return membership row (best effort)
    const { data: membership } = await supabaseAdmin
      .from("home_memberships")
      .select("*")
      .eq("home_id", user.home_id ?? "")
      .eq("user_id", user.id)
      .maybeSingle();

    return res.json({ ok: true, token, user, membership: membership || null });
  } catch (e: any) {
    console.error("acceptInviteHandler error:", e);
    return res.status(500).json({ error: "Unexpected server error" });
  }
}

/**
 * POST /invites/:inviteId/decline
 * Consumer declines invite
 */
export async function declineInviteHandler(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    const email = (user.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "No email on session token" });

    const inviteId = String(req.params.inviteId || "");
    if (!inviteId) return res.status(400).json({ error: "Missing inviteId" });

    const result = await declineInvite({
      inviteId,
      userId: user.id,
      userEmail: email,
    });

    if ("error" in result) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ ok: true });
  } catch (e: any) {
    console.error("declineInviteHandler error:", e);
    return res.status(500).json({ error: "Unexpected server error" });
  }
}
