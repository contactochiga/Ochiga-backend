// Commercial production-hardening: activation routes for estate-level
// facility-owner invitations, mounted publicly (like inviteActivation.ts)
// since the caller has no session yet for the new-user path -- validate and
// activate need to be reachable before authentication exists. The
// existing-user accept path requires a real session (requireAuth) so a
// wrong-authenticated-user can never steal someone else's invite (the RPC
// itself also re-checks the email match server-side, defense in depth).
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { emitAuditEvent } from "../core/foundation";
import {
  acceptEstateOwnerInviteAsExistingUser,
  activateEstateOwnerInviteAsNewUser,
  validateEstateOwnerInvite,
} from "../services/estateOwnerInviteActivationService";

const router = Router();

function errorStatus(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("not found")) return 404;
  if (lower.includes("expired") || lower.includes("revoked") || lower.includes("accepted") || lower.includes("pending")) return 410;
  if (lower.includes("not sent to your account email")) return 403;
  if (lower.includes("username") || lower.includes("password") || lower.includes("token") || lower.includes("already exists")) return 400;
  return 500;
}

router.post("/validate", async (req, res) => {
  try {
    const preview = await validateEstateOwnerInvite(req.body?.token);
    void emitAuditEvent({
      actorId: null,
      actorRole: "guest",
      action: "facility.invitation.validated",
      resourceType: "invite",
      resourceId: preview.invite_id,
      estateId: preview.estate.id,
      status: "success",
      req,
    } as any);
    return res.json({ ok: true, preview: { ...preview, invited_email_raw: undefined } });
  } catch (error: any) {
    const message = error?.message || "Invite validation failed";
    void emitAuditEvent({
      actorId: null,
      actorRole: "guest",
      action: "facility.invitation.validation_failed",
      resourceType: "invite",
      resourceId: "",
      status: "denied",
      metadata: { reason: message },
      req,
    });
    return res.status(errorStatus(message)).json({ error: message });
  }
});

// NEW USER: sets their own username/password on this screen.
router.post("/activate", async (req, res) => {
  try {
    const result = await activateEstateOwnerInviteAsNewUser({
      token: req.body?.token,
      username: req.body?.username,
      password: req.body?.password,
      confirmPassword: req.body?.confirmPassword,
    });
    void emitAuditEvent({
      actorId: result.user.id,
      actorEmail: result.user.email,
      actorRole: result.user.role,
      action: "facility.invitation.accepted",
      resourceType: "user",
      resourceId: result.user.id,
      estateId: result.estate.id,
      status: "success",
      metadata: { path: "new_user" },
      req,
    } as any);
    return res.json(result);
  } catch (error: any) {
    const message = error?.message || "Invite activation failed";
    void emitAuditEvent({
      actorId: null,
      actorRole: "guest",
      action: "facility.invitation.activation_failed",
      resourceType: "invite",
      resourceId: "",
      status: "denied",
      metadata: { reason: message, path: "new_user" },
      req,
    });
    return res.status(errorStatus(message)).json({ error: message });
  }
});

// EXISTING OYI USER: already authenticated, just accepts estate ownership.
router.post("/accept", requireAuth, async (req, res) => {
  try {
    const result = await acceptEstateOwnerInviteAsExistingUser({
      token: req.body?.token,
      userId: (req as any).user?.id,
    });
    void emitAuditEvent({
      actorId: result.user.id,
      actorEmail: result.user.email,
      actorRole: result.user.role,
      action: "facility.invitation.accepted",
      resourceType: "user",
      resourceId: result.user.id,
      estateId: result.estate.id,
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
      action: "facility.invitation.activation_failed",
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
