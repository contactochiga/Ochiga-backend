// src/routes/facilityMaintenanceRoutes.ts
import { Router } from "express";
import {
  listFacilityMaintenance,
  updateMaintenance,
} from "../controllers/maintenance.controller";

const router = Router();

router.get("/maintenance", listFacilityMaintenance);
router.patch("/maintenance/:id", updateMaintenance);

export default router;
