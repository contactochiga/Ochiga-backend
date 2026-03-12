import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { PushNotificationService } from "../services/PushNotificationService";

const router = Router();

router.post("/register", requireAuth, async (req, res) => {
  const user = req.user as any;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const token = String(req.body?.token || "").trim();
  const platform = req.body?.platform ? String(req.body.platform) : null;
  const deviceId = req.body?.device_id ? String(req.body.device_id) : null;
  const appVersion = req.body?.app_version ? String(req.body.app_version) : null;

  if (!token) return res.status(400).json({ error: "token is required" });

  const result: any = await PushNotificationService.registerToken({
    userId: user.id,
    token,
    platform,
    deviceId,
    appVersion,
  });

  if (result?.error) return res.status(500).json({ error: result.error.message || String(result.error) });
  return res.json({ ok: true, token: result?.data || null });
});

router.post("/unregister", requireAuth, async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token) return res.status(400).json({ error: "token is required" });

  const result: any = await PushNotificationService.removeToken(token);
  if (result?.error) return res.status(500).json({ error: result.error.message || String(result.error) });
  return res.json({ ok: true });
});

export default router;

