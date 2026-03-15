// src/routes/geo.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";

import {
  evaluateGeoAlerts,
  setEstateBoundary,
  getEstateBoundary,
  updateVisitorLocation,
  updateDeviceLocation,
} from "../controllers/geoController";

const router = Router();

/**
 * POST /geo/estate/:estateId
 * Estate admins / managers set or update estate boundary coordinates
 */
router.post(
  "/evaluate",
  requireAuth,
  async (req, res) => {
    try {
      return evaluateGeoAlerts(req, res);
    } catch (err: any) {
      console.error("Error in POST /geo/evaluate:", err);
      return res.status(500).json({ error: err.message });
    }
  }
);

router.post(
  "/estate/:estateId",
  requireAuth,
  requireRole("estate_admin", "manager", "operator"),
  async (req, res) => {
    try {
      return setEstateBoundary(req, res);
    } catch (err: any) {
      console.error("Error in POST /geo/estate:", err);
      return res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET /geo/estate/:estateId
 * Fetch estate boundary coordinates
 */
router.get(
  "/estate/:estateId",
  requireAuth,
  async (req, res) => {
    try {
      return getEstateBoundary(req, res);
    } catch (err: any) {
      console.error("Error in GET /geo/estate:", err);
      return res.status(500).json({ error: err.message });
    }
  }
);

/**
 * POST /geo/visitor/:visitorId
 * Update live visitor location
 * (used by QR check-in, gate scanners, etc.)
 */
router.post(
  "/visitor/:visitorId",
  async (req, res) => {
    try {
      return updateVisitorLocation(req, res);
    } catch (err: any) {
      console.error("Error in POST /geo/visitor:", err);
      return res.status(500).json({ error: err.message });
    }
  }
);

/**
 * POST /geo/device/:deviceId
 * Update live device location
 */
router.post(
  "/device/:deviceId",
  requireAuth,
  requireRole("estate_admin", "manager", "operator"),
  async (req, res) => {
    try {
      return updateDeviceLocation(req, res);
    } catch (err: any) {
      console.error("Error in POST /geo/device:", err);
      return res.status(500).json({ error: err.message });
    }
  }
);

export default router;
