// src/routes/consumerMaintenanceRoutes.ts
import { Router } from "express";
import { createMaintenance } from "../controllers/maintenance.controller";

const router = Router();

// assumes your auth middleware sets req.user
router.post("/maintenance", createMaintenance);

export default router;
