// src/routes/maintenance.routes.ts
import { Router } from "express";
import { createMaintenance, listMyMaintenance } from "../controllers/maintenance.controller";

// ⚠️ IMPORTANT:
// If your project already has an auth middleware, add it here.
// Example:
// import { requireAuth } from "../middleware/auth";
// router.use(requireAuth);

const router = Router();

// GET /maintenance?status=open
router.get("/", listMyMaintenance);

// POST /maintenance
router.post("/", createMaintenance);

export default router;
