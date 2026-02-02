// src/routes/facilityMaintenanceRoutes.ts
import { Router } from "express";
import { listFacilityMaintenance, updateMaintenance } from "../controllers/maintenance.controller";

// ✅ use your existing auth middleware (same one used in /facility routes)
import { requireAuth } from "../middleware/auth"; // change if your project uses a different name/path

const router = Router();

router.use(requireAuth);

// GET /facility/maintenance
router.get("/", listFacilityMaintenance);

// PATCH /facility/maintenance/:id
router.patch("/:id", updateMaintenance);

export default router;
