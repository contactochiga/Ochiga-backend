// src/routes/maintenance.routes.ts
import { Router } from "express";
import {
  createMaintenance,
  listMyMaintenance,
} from "../controllers/maintenance.controller";

import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import { resolveRequestContext } from "../middleware/contextResolver";

const router = Router();

// ✅ THIS is what you were missing
router.use(requireAuth);
router.use(resolveRequestContext);

// GET /maintenance?status=open
router.get("/", requirePermission("support.read"), listMyMaintenance);

// POST /maintenance
router.post("/", requirePermission("support.read"), auditOnSuccess("support.ticket.created", "support_ticket", "id"), createMaintenance);

export default router;
