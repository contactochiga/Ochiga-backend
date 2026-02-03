// src/routes/facilityMaintenanceRoutes.ts
import { Router } from "express";
import {
  listFacilityMaintenance,
  updateMaintenance,
} from "../controllers/maintenance.controller";

import { requireAuth } from "../middleware/auth";

const router = Router();

// ✅ THIS is what you were missing
router.use(requireAuth);

// GET /facility/maintenance
router.get("/", listFacilityMaintenance);

// PATCH /facility/maintenance/:id
router.patch("/:id", updateMaintenance);

export default router;
