// src/routes/visitors.ts

import { Router } from "express";
import * as VisitorCtrl from "../controllers/visitorController";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";

const router = Router();

// Create visitor
router.post("/", requireAuth, requirePermission("visitors.create"), auditOnSuccess("visitor.created", "visitor", "id"), VisitorCtrl.createVisitor);

// List my visitor requests
router.get("/mine", requireAuth, requirePermission("visitors.create"), VisitorCtrl.listMyVisitors);

// Verify visitor by access code
router.post("/verify", requireAuth, requirePermission("visitors.manage"), auditOnSuccess("visitor.updated", "visitor", "id"), VisitorCtrl.verifyVisitor);

// Approve visitor
router.put("/approve/:id", requireAuth, requirePermission("visitors.manage"), auditOnSuccess("visitor.approved", "visitor", "id"), VisitorCtrl.approveVisitor);

// Mark entry
router.post("/entry/:id", requireAuth, requirePermission("visitors.manage"), auditOnSuccess("visitor.entry.logged", "visitor", "id"), VisitorCtrl.markEntry);

// Mark exit
router.post("/exit/:id", requireAuth, requirePermission("visitors.manage"), auditOnSuccess("visitor.exit.logged", "visitor", "id"), VisitorCtrl.markExit);

// Get visitor info. The controller performs resource ownership and home-scope checks
// so residents can read their own visitor records without broad manage permission.
router.get("/info/:id", requireAuth, VisitorCtrl.getVisitorInfo);

// Estate analytics
router.get("/analytics/estate/:estateId", requireAuth, requirePermission("visitors.manage"), VisitorCtrl.getAnalyticsForEstate);

export default router;
