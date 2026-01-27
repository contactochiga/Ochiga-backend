// src/controllers/invites.controller.ts
import {
  acceptInvite,
  createHomeInvite,
  declineInvite,
  listMyInvites,
  revokeInvite,
} from "../services/invitesService";
import { emitToUser } from "../realtime/realtime";

export async function createInviteHandler(req: any, res: any) {
  try {
    const homeId = String(req.params.homeId || "");
    const { email, role } = req.body;

    if (!homeId) return res.status(400).json({ error: "Missing homeId" });
    if (!email) return res.status(400).json({ error: "Missing email" });

    const estateId = req.user?.estate_id ?? null;

    const { invite, invitedUser } = await createHomeInvite({
      homeId,
      estateId,
      email,
      role: role || "resident",
      createdBy: req.user?.id ?? null,
    });

    // realtime push to user if they already exist
    if (invitedUser?.id) {
      emitToUser(invitedUser.id, "invite.created", {
        id: invite.id,
        home_id: invite.home_id,
        estate_id: invite.estate_id,
        role: invite.role,
        email: invite.email,
        status: invite.status,
        expires_at: invite.expires_at,
        created_at: invite.created_at,
      });
    }

    return res.json({ message: "Invite created", invite });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to create invite" });
  }
}

export async function myInvitesHandler(req: any, res: any) {
  try {
    const invites = await listMyInvites(req.user.id, req.user.email);
    return res.json({ invites });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to fetch invites" });
  }
}

export async function acceptInviteHandler(req: any, res: any) {
  try {
    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ error: "Missing invite id" });

    const updated = await acceptInvite(id, req.user.id, req.user.email);

    return res.json({ message: "Invite accepted", invite: updated });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to accept invite" });
  }
}

export async function declineInviteHandler(req: any, res: any) {
  try {
    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ error: "Missing invite id" });

    const updated = await declineInvite(id, req.user.id, req.user.email);

    return res.json({ message: "Invite declined", invite: updated });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to decline invite" });
  }
}

export async function revokeInviteHandler(req: any, res: any) {
  try {
    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ error: "Missing invite id" });

    const updated = await revokeInvite(id, req.user.id);

    return res.json({ message: "Invite revoked", invite: updated });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Failed to revoke invite" });
  }
}
