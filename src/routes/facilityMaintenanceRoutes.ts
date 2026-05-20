// src/routes/facilityMaintenanceRoutes.ts
import { Router } from "express";
import {
  listFacilityMaintenance,
  updateMaintenance,
} from "../controllers/maintenance.controller";

import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";

const router = Router();

// ✅ THIS is what you were missing
router.use(requireAuth);

// GET /facility/maintenance
router.get("/", requirePermission("support.read"), listFacilityMaintenance);

// PATCH /facility/maintenance/:id
router.patch("/:id", requirePermission("support.assign"), auditOnSuccess("support.ticket.assigned", "support_ticket", "id"), updateMaintenance);

export default router;
