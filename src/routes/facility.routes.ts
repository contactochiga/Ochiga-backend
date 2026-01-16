// src/routes/facility.routes.ts
import express from "express";
import { getFacilityOverview } from "../controllers/facilityOverview.controller";
import { requireAuth } from "../middleware/requireAuth";

const router = express.Router();

router.get("/overview", requireAuth, getFacilityOverview);

export default router;
