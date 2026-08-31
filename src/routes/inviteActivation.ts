import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { emitAuditEvent } from "../core/foundation";
import {
  acceptResidentInviteAsExistingUser,
  activateResidentInvite,
  validateResidentInvite,
} from "../services/residentInviteActivationService";

const router = Router();

function errorStatus(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("not found")) return 404;
  if (lower.includes("expired") || lower.includes("revoked") || lower.includes("accepted") || lower.includes("pending")) return 410;
  if (lower.includes("not sent to your account email")) return 403;
  if (lower.includes("username") || lower.includes("password") || lower.includes("token") || lower.includes("please sign in instead")) return 400;
  return 500;
}

router.post("/validate", async (req, res) => {
  try {
    const preview = await validateResidentInvite(req.body?.token);
    void emitAuditEvent({
      actorId: null,
      actorRole: "guest",
      action: "auth.invite.validated",
      resourceType: "invite",
      resourceId: preview.invite_id,
      estateId: preview.estate.id,
      homeId: preview.home.id,
      status: "success",
      req,
    } as any);
    return res.json({ ok: true, preview });
  } catch (error: any) {
    const message = error?.message || "Invite validation failed";
    void emitAuditEvent({
      actorId: null,
      actorRole: "guest",
      action: "auth.invite.validation_failed",
      resourceType: "invite",
      resourceId: "",
      status: "denied",
      metadata: { reason: message },
      req,
    });
    return res.status(errorStatus(message)).json({ error: message });
  }
});

router.post("/activate", async (req, res) => {
  try {
    const result = await activateResidentInvite({
      token: req.body?.token,
      username: req.body?.username,
      password: req.body?.password,
      confirmPassword: req.body?.confirmPassword,
    });
    void emitAuditEvent({
      actorId: result.user.id,
      actorEmail: result.user.email,
      actorRole: result.user.role,
      action: "auth.invite.activated",
      resourceType: "user",
      resourceId: result.user.id,
      estateId: result.estate_id,
      homeId: result.home_id,
      status: "success",
      req,
    } as any);
    return res.json(result);
  } catch (error: any) {
    const message = error?.message || "Invite activation failed";
    void emitAuditEvent({
      actorId: null,
      actorRole: "guest",
      action: "auth.invite.activation_failed",
      resourceType: "invite",
      resourceId: "",
      status: "denied",
      metadata: { reason: message },
      req,
    });
    return res.status(errorStatus(message)).json({ error: message });
  }
});

// EXISTING OYI IDENTITY: already authenticated, accepts an additional Home
// invitation. requireAuth means p_existing_user_id is always the caller's
// own id -- an invite can never be claimed while authenticated as someone
// else -- and this path never touches username/password_hash.
router.post("/accept", requireAuth, async (req, res) => {
  try {
    const result = await acceptResidentInviteAsExistingUser({
      token: req.body?.token,
      userId: (req as any).user?.id,
    });
    void emitAuditEvent({
      actorId: result.user.id,
      actorEmail: result.user.email,
      actorRole: result.user.role,
      action: "auth.invite.activated",
      resourceType: "user",
      resourceId: result.user.id,
      estateId: result.estate_id,
      homeId: result.home_id,
      status: "success",
      metadata: { path: "existing_user" },
      req,
    } as any);
    return res.json(result);
  } catch (error: any) {
    const message = error?.message || "Invite activation failed";
    void emitAuditEvent({
      actorId: (req as any).user?.id || null,
      actorRole: (req as any).user?.role || "guest",
      action: "auth.invite.activation_failed",
      resourceType: "invite",
      resourceId: "",
      status: "denied",
      metadata: { reason: message, path: "existing_user" },
      req,
    });
    return res.status(errorStatus(message)).json({ error: message });
  }
});

export default router;
