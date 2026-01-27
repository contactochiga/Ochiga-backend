// src/routes/invites.routes.ts
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";

// If your controllers exist, keep these imports.
// If you don't have controllers yet, comment them and wire later.
import {
  createInviteHandler,
  listMyInvitesHandler,
  acceptInviteHandler,
  declineInviteHandler,
} from "../controllers/invites.controller";

const router = Router();

/**
 * Facility/admin creates invite
 */
router.post(
  "/",
  requireAuth,
  requireRole("estate_admin", "facility_admin", "manager", "admin"),
  createInviteHandler
);

/**
 * Consumer lists their invites
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
