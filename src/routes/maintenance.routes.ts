// src/routes/maintenance.routes.ts
import { Router } from "express";
import { createMaintenance } from "../controllers/maintenance.controller";

const router = Router();

// POST /maintenance
router.post("/", createMaintenance);

export default router;
