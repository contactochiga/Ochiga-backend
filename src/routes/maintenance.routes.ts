// src/routes/maintenance.routes.ts
import { Router } from "express";
import { createMaintenance, listMyMaintenance } from "../controllers/maintenance.controller";

// IMPORTANT: Use your existing auth middleware here.
// Example (rename to your real file):
// import { requireAuth } from "../middleware/auth";
// If you already attach req.user earlier globally, then you can skip requireAuth.

const router = Router();

// GET /maintenance  -> list my tickets
router.get("/", listMyMaintenance);

// POST /maintenance -> create request
router.post("/", createMaintenance);

export default router;
