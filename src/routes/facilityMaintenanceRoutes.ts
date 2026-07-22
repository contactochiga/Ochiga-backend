// src/routes/facilityMaintenanceRoutes.ts
import { Router } from "express";
import {
  listFacilityMaintenance,
  updateMaintenance,
  getMaintenanceTimeline,
} from "../controllers/maintenance.controller";

import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import { resolveRequestContext } from "../middleware/contextResolver";

const router = Router();

// ✅ THIS is what you were missing
router.use(requireAuth);
router.use(resolveRequestContext);

// GET /facility/maintenance
router.get("/", requirePermission("support.read"), listFacilityMaintenance);
router.get("/:id/timeline", requirePermission("support.read"), getMaintenanceTimeline);

// PATCH /facility/maintenance/:id
router.patch("/:id", requirePermission("support.assign"), auditOnSuccess("support.ticket.assigned", "support_ticket", "id"), updateMaintenance);

export default router;
