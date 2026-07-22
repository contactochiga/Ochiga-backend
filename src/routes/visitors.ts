// src/routes/visitors.ts

import { Router } from "express";
import * as VisitorCtrl from "../controllers/visitorController";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import { resolveRequestContext } from "../middleware/contextResolver";

const router = Router();

router.use(requireAuth);
router.use(resolveRequestContext);

// Create visitor
router.post("/", requirePermission("visitors.create"), auditOnSuccess("visitor.created", "visitor", "id"), VisitorCtrl.createVisitor);

// List my visitor requests
router.get("/mine", requirePermission("visitors.create"), VisitorCtrl.listMyVisitors);

// Verify visitor by access code
router.post("/verify", requirePermission("visitors.manage"), auditOnSuccess("visitor.updated", "visitor", "id"), VisitorCtrl.verifyVisitor);

// Approve visitor
router.put("/approve/:id", requirePermission("visitors.manage"), auditOnSuccess("visitor.approved", "visitor", "id"), VisitorCtrl.approveVisitor);

// Mark entry
router.post("/entry/:id", requirePermission("visitors.manage"), auditOnSuccess("visitor.entry.logged", "visitor", "id"), VisitorCtrl.markEntry);

// Mark exit
router.post("/exit/:id", requirePermission("visitors.manage"), auditOnSuccess("visitor.exit.logged", "visitor", "id"), VisitorCtrl.markExit);

// Get visitor info. The controller performs resource ownership and home-scope checks
// so residents can read their own visitor records without broad manage permission.
router.get("/info/:id", VisitorCtrl.getVisitorInfo);

// Estate analytics
router.get("/analytics/estate/:estateId", requirePermission("visitors.manage"), VisitorCtrl.getAnalyticsForEstate);

export default router;
