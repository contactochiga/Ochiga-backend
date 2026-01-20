// src/routes/homeUsers.routes.ts
import express from "express";
import { requireAuth } from "../middleware/auth";

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
router.get("/:homeId/users", requireAuth, listHomeUsers);
router.post("/:homeId/invite", requireAuth, inviteHomeUser);

/**
 * Base mounted under: /facility
 *
 * PATCH  /facility/home-users/:membershipId
 * DELETE /facility/home-users/:membershipId
 *
 * These are mounted in facility.routes.ts (not here).
 */

export default router;
