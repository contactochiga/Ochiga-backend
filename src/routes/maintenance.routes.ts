// src/routes/maintenance.routes.ts
import { Router } from "express";
import { createMaintenance, listMyMaintenance } from "../controllers/maintenance.controller";

// ✅ Use the same auth middleware used by /notifications or /me
import { requireAuth } from "../middleware/auth"; // <-- change path/name to match your project

const router = Router();

// ✅ protect everything here
router.use(requireAuth);

// GET /maintenance?status=open
router.get("/", listMyMaintenance);

// POST /maintenance
router.post("/", createMaintenance);

export default router;
