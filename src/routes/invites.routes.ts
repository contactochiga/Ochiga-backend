// src/routes/invites.routes.ts
import { Router } from "express";
import {
  createInviteHandler,
  listMyInvitesHandler,
  acceptInviteHandler,
  declineInviteHandler,
} from "../controllers/invites.controller";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

/**
 * Facility/Admin creates invite for a user (by email)
 * - Protected
 */
router.post(
  "/",
  requireAuth,
  requireRole("estate_admin", "facility_admin", "manager", "admin"),
  createInviteHandler
);

/**
 * Consumer: list invites for the logged-in user
 * - Protected
 */
router.get("/mine", requireAuth, listMyInvitesHandler);

/**
 * Consumer: accept an invite
 * - Protected
 */
router.post("/:inviteId/accept", requireAuth, acceptInviteHandler);

/**
 * Consumer: decline an invite
 * - Protected
 */
router.post("/:inviteId/decline", requireAuth, declineInviteHandler);

export default router;
