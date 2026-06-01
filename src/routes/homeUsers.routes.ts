// src/routes/homeUsers.routes.ts
import express from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";

import {
  listHomeUsers,
  inviteHomeUser,
  resendHomeInvite,
  revokeHomeInvite,
  updateHomeUser,
  removeHomeUser,
} from "../controllers/homeUsers.controller";

const router = express.Router();

/**
 * Base mounted under: /facility/homes
 *
 * GET    /facility/homes/:homeId/users
 * POST   /facility/homes/:homeId/invite
 */
router.get("/:homeId/users", requireAuth, listHomeUsers);
router.post("/:homeId/invite", requireAuth, requirePermission("staff.manage"), auditOnSuccess("user.invited", "home", "homeId"), inviteHomeUser);
router.post("/:homeId/invites/:inviteId/revoke", requireAuth, requirePermission("staff.manage"), auditOnSuccess("resident.invite.revoked", "invite", "inviteId"), revokeHomeInvite);
router.post("/:homeId/invites/:inviteId/resend", requireAuth, requirePermission("staff.manage"), auditOnSuccess("resident.invite.resent", "invite", "inviteId"), resendHomeInvite);

/**
 * Base mounted under: /facility
 *
 * PATCH  /facility/home-users/:membershipId
 * DELETE /facility/home-users/:membershipId
 *
 * These are mounted in facility.routes.ts (not here).
 */

export default router;
