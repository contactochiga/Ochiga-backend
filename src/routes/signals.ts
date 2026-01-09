import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { ingestSignal } from "../controllers/signal.controller";

const router = Router();

// POST /signals
router.post("/", requireAuth, ingestSignal);

export default router;
