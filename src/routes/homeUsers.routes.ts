// src/routes/homeUsers.routes.ts
import express from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";

import {
  listHomeUsers,
  inviteHomeUser,
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
router.get("/:homeId/users", requireAuth, requirePermission("staff.manage"), listHomeUsers);
router.post("/:homeId/invite", requireAuth, requirePermission("staff.manage"), auditOnSuccess("user.invited", "home", "homeId"), inviteHomeUser);

/**
 * Base mounted under: /facility
 *
 * PATCH  /facility/home-users/:membershipId
 * DELETE /facility/home-users/:membershipId
 *
 * These are mounted in facility.routes.ts (not here).
 */

export default router;
