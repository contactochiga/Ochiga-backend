// src/routes/invites.routes.ts
import { Router } from "express";
import { requireAuth, requireAnyRole } from "../middleware/requireAuth";
import {
  acceptInviteHandler,
  createInviteHandler,
  declineInviteHandler,
  myInvitesHandler,
  revokeInviteHandler,
} from "../controllers/invites.controller";

const router = Router();

/**
 * Consumer:
 * GET /invites/my
 * POST /invites/:id/accept
 * POST /invites/:id/decline
 */
router.get("/my", requireAuth, myInvitesHandler);
router.post("/:id/accept", requireAuth, acceptInviteHandler);
router.post("/:id/decline", requireAuth, declineInviteHandler);

/**
 * Facility/Estate admin:
 * POST /invites/home/:homeId   (invite someone to a home)
 * POST /invites/:id/revoke
 */
router.post(
  "/home/:homeId",
  requireAuth,
  requireAnyRole(["estate_admin", "facility_admin", "manager"]),
  createInviteHandler
);

router.post(
  "/:id/revoke",
  requireAuth,
  requireAnyRole(["estate_admin", "facility_admin", "manager"]),
  revokeInviteHandler
);

export default router;
