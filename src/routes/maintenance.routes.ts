// src/routes/maintenance.routes.ts
import { Router } from "express";
import {
  createMaintenance,
  listMyMaintenance,
} from "../controllers/maintenance.controller";

import { requireAuth } from "../middleware/auth";

const router = Router();

// ✅ THIS is what you were missing
router.use(requireAuth);

// GET /maintenance?status=open
router.get("/", listMyMaintenance);

// POST /maintenance
router.post("/", createMaintenance);

export default router;
