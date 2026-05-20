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
 * Facility/Admin creates an invite for a home
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
router.post("/:inviteId/accept", requireAuth, acceptInviteHandler);

/**
 * Consumer declines invite
 */
router.post("/:inviteId/decline", requireAuth, declineInviteHandler);

export default router;
