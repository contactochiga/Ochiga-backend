import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { PushNotificationService } from "../services/PushNotificationService";

const router = Router();

router.post("/register", requireAuth, requirePermission("notifications.read"), async (req, res) => {
  const user = req.user as any;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const token = String(req.body?.token || "").trim();
  const platform = req.body?.platform ? String(req.body.platform) : null;
  const deviceId = req.body?.device_id ? String(req.body.device_id) : null;
  const appVersion = req.body?.app_version ? String(req.body.app_version) : null;
  const provider = req.body?.provider ? String(req.body.provider) : null;
  const environment = req.body?.environment ? String(req.body.environment) : null;
  const appBundle = req.body?.app_bundle ? String(req.body.app_bundle) : null;

  if (!token) return res.status(400).json({ error: "token is required" });

  const result: any = await PushNotificationService.registerToken({
    userId: user.id,
    token,
    platform,
    deviceId,
    appVersion,
    provider,
    environment,
    appBundle,
  });

  if (result?.error) {
    console.warn("[push] backend token registration failed", { platform, provider, environment, appBundle, error: result.error.message || String(result.error) });
    return res.status(500).json({ error: result.error.message || String(result.error) });
  }
  console.log("[push] backend token registration success", { platform, provider, environment, appBundle });
  return res.json({ ok: true, token: result?.data || null });
});

router.post("/unregister", requireAuth, requirePermission("notifications.read"), async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token) return res.status(400).json({ error: "token is required" });

  const result: any = await PushNotificationService.removeToken(token);
  if (result?.error) return res.status(500).json({ error: result.error.message || String(result.error) });
  return res.json({ ok: true });
});

export default router;
