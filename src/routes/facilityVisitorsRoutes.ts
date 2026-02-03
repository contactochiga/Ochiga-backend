// src/routes/facilityVisitorsRoutes.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  listFacilityVisitors,
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

// PATCH /facility/visitors/:id { status }
router.patch("/:id", updateVisitorStatusFacility);

export default router;
