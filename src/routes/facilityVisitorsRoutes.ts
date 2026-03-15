// src/routes/facilityVisitorsRoutes.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
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
router.get("/", listFacilityVisitors);

// POST /facility/visitors/verify { code }
router.post("/verify", verifyVisitorCodeFacility);

// GET /facility/visitors/:id/timeline
router.get("/:id/timeline", getVisitorTimelineFacility);

// PATCH /facility/visitors/:id { status }
router.patch("/:id", updateVisitorStatusFacility);

// POST /facility/visitors/actions/lockdown { mode }
router.post("/actions/lockdown", triggerLockdownFacility);

// GET /facility/visitors/reports/export?today=true&format=json|csv
router.get("/reports/export", exportVisitorReportFacility);

export default router;
