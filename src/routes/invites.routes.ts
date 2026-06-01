// src/routes/invites.routes.ts
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import {
  createInviteHandler,
  listMyInvitesHandler,
  acceptInviteHandler,
  declineInviteHandler,
} from "../controllers/invites.controller";

const router = Router();

/**
 * Legacy compatibility routes.
 * New resident onboarding must create invitations through
 * POST /facility/homes/:homeId/invite and activate through
 * POST /auth/invites/activate.
 *
 * Facility/Admin creates an invite for a home.
 */
router.post(
  "/",
  requireAuth,
  requirePermission("staff.manage"),
  auditOnSuccess("user.invited", "invite", "inviteId"),
  createInviteHandler
);

/**
 * Consumer lists their invites (matched by token email)
 */
router.get("/mine", requireAuth, listMyInvitesHandler);

/**
 * Consumer accepts invite
 */
router.post("/:inviteId/accept", requireAuth, auditOnSuccess("user.invite.accepted", "invite", "inviteId"), acceptInviteHandler);

/**
 * Consumer declines invite
 */
router.post("/:inviteId/decline", requireAuth, auditOnSuccess("user.invite.declined", "invite", "inviteId"), declineInviteHandler);

export default router;
