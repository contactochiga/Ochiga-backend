// src/controllers/invites.controller.ts
import { Request, Response } from "express";
import {
  acceptInvite,
  createInvite,
  declineInvite,
  listInvitesForEmail,
} from "../services/invitesService";

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

    // Optional: basic tenancy guard (only if you want strict)
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
 */
export async function acceptInviteHandler(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    const email = (user.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "No email on session token" });

    const inviteId = String(req.params.inviteId || "");
    if (!inviteId) return res.status(400).json({ error: "Missing inviteId" });

    const result = await acceptInvite({
      inviteId,
      userId: user.id,
      userEmail: email,
    });

    if ("error" in result) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ ok: true });
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
