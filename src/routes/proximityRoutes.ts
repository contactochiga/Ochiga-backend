import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getProximitySettings, recordProximityEvent, updateProximitySettings } from "../services/proximityService";

const router = Router();

router.use(requireAuth);

router.get("/settings", async (req, res) => {
  try {
    const settings = await getProximitySettings(req.user as any);
    return res.json({ settings });
  } catch (err: any) {
    console.error("GET /proximity/settings failed", err?.message || err);
    return res.status(503).json({ error: "Proximity settings are unavailable" });
  }
});

router.patch("/settings", async (req, res) => {
  try {
    const settings = await updateProximitySettings(req.user as any, req.body || {}, req);
    return res.json({ settings });
  } catch (err: any) {
    console.error("PATCH /proximity/settings failed", err?.message || err);
    return res.status(err?.statusCode || 400).json({ error: err?.message || "Proximity settings could not be updated" });
  }
});

router.post("/event", async (req, res) => {
  try {
    const result = await recordProximityEvent(req.user as any, req.body || {}, req);
    return res.json(result);
  } catch (err: any) {
    console.error("POST /proximity/event failed", err?.message || err);
    return res.status(err?.statusCode || 400).json({ error: err?.message || "Proximity event could not be recorded" });
  }
});

export default router;
