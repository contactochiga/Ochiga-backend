// src/routes/facilityVisitorsRoutes.ts
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import {
  exportVisitorReportFacility,
  getVisitorTimelineFacility,
  listFacilityVisitors,
  triggerLockdownFacility,
  verifyVisitorCodeFacility,
  updateVisitorStatusFacility,
} from "../controllers/facilityVisitors.controller";

const router = Router();

// All facility visitor ops require auth
router.use(requireAuth);

// GET /facility/visitors?today=true&status=active
router.get("/", requirePermission("visitors.manage"), listFacilityVisitors);

// POST /facility/visitors/verify { code }
router.post("/verify", requirePermission("visitors.manage"), auditOnSuccess("visitor.updated", "visitor", "id"), verifyVisitorCodeFacility);

// GET /facility/visitors/:id/timeline
router.get("/:id/timeline", requirePermission("visitors.manage"), getVisitorTimelineFacility);

// PATCH /facility/visitors/:id { status }
router.patch("/:id", requirePermission("visitors.manage"), auditOnSuccess("visitor.updated", "visitor", "id"), updateVisitorStatusFacility);

// POST /facility/visitors/actions/lockdown { mode }
router.post("/actions/lockdown", requirePermission("visitors.manage"), auditOnSuccess("visitor.updated", "visitor_operation", "lockdown"), triggerLockdownFacility);

// GET /facility/visitors/reports/export?today=true&format=json|csv
router.get("/reports/export", requirePermission("visitors.manage"), exportVisitorReportFacility);

export default router;
