// src/routes/facilityMaintenanceRoutes.ts
import { Router } from "express";
import {
  listFacilityMaintenance,
  updateMaintenance,
} from "../controllers/maintenance.controller";

// If you have an auth middleware, use it:
// import { requireAuth } from "../middleware/auth";
// router.use(requireAuth);

const router = Router();

// GET /facility/maintenance
router.get("/", listFacilityMaintenance);

// PATCH /facility/maintenance/:id
router.patch("/:id", updateMaintenance);

export default router;
