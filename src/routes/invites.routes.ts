// src/routes/invites.routes.ts
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
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
  requireRole("estate_admin", "manager", "operator", "admin"),
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
