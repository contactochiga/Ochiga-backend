import { Router } from "express";
import { emitAuditEvent } from "../core/foundation";
import {
  activateResidentInvite,
  validateResidentInvite,
} from "../services/residentInviteActivationService";

const router = Router();

function errorStatus(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("not found")) return 404;
  if (lower.includes("expired") || lower.includes("revoked") || lower.includes("accepted") || lower.includes("pending")) return 410;
  if (lower.includes("username") || lower.includes("password") || lower.includes("token")) return 400;
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

export default router;
