// src/routes/consumerMaintenanceRoutes.ts
import { Router } from "express";
import { createMaintenance } from "../controllers/maintenance.controller";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";

const router = Router();

router.post("/maintenance", requireAuth, requirePermission("support.read"), auditOnSuccess("support.ticket.created", "support_ticket", "id"), createMaintenance);

export default router;
