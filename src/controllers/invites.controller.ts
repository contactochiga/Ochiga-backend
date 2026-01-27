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

/**
 * POST /invites
 * Facility/Admin creates an invite for a home
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

    // Optional: strict tenancy guard
    // if (user.estate_id && user.estate_id !== estate_id) {
    //   return res.status(403).json({ error: "Estate mismatch" });
    // }

    const result = await createInvite({
      estate_id: String(estate_id),
      home_id: String(home_id),
      invited_email: String(invited_email),
      role: role as any,
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
