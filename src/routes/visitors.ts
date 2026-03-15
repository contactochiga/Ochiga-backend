// src/routes/visitors.ts

import { Router } from "express";
import * as VisitorCtrl from "../controllers/visitorController";
import { requireAuth } from "../middleware/auth";

const router = Router();

// Create visitor
router.post("/", requireAuth, VisitorCtrl.createVisitor);

// List my visitor requests
router.get("/mine", requireAuth, VisitorCtrl.listMyVisitors);

// Verify visitor by access code
router.post("/verify", requireAuth, VisitorCtrl.verifyVisitor);

// Approve visitor
router.put("/approve/:id", requireAuth, VisitorCtrl.approveVisitor);

// Mark entry
router.post("/entry/:id", requireAuth, VisitorCtrl.markEntry);

// Mark exit
router.post("/exit/:id", requireAuth, VisitorCtrl.markExit);

// Get visitor info
router.get("/info/:id", requireAuth, VisitorCtrl.getVisitorInfo);

// Estate analytics
router.get("/analytics/estate/:estateId", requireAuth, VisitorCtrl.getAnalyticsForEstate);

export default router;
