// src/routes/devices.ts
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { discoverDevices } from "../controllers/deviceDiscoveryController";
import { getDeviceState } from "../controllers/deviceStateController";
import { assignDevices } from "../controllers/deviceAssignController";
import { requestDeviceCommand } from "../controllers/deviceCommandController";
import { getEstateDevices } from "../controllers/deviceEstateController"; // ✅ add
import { createIrAppliance, listIrProfiles } from "../controllers/deviceIrController";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { auditOnSuccess } from "../middleware/audit";
import { summarizeDeviceRuntime } from "../services/deviceRuntimeSessionsService";

const router = Router();

router.get("/discover", requireAuth, requirePermission("devices.read"), discoverDevices);
router.post("/assign", requireAuth, requirePermission("devices.control"), assignDevices);

// ✅ THIS WAS MISSING (your frontend calls it)
router.get("/estate/:estateId", requireAuth, requirePermission("devices.read"), getEstateDevices);

router.patch("/:deviceId/preferences", requireAuth, requirePermission("devices.control"), auditOnSuccess("device.preferences.updated", "device", "deviceId"), async (req, res) => {
  const user = req.user;
  if (!user?.estate_id || !user?.home_id) return res.status(400).json({ error: "Active home context required" });
  const deviceId = String(req.params.deviceId || "").trim();
  const favorite = req.body?.favorite;
  if (!deviceId) return res.status(400).json({ error: "deviceId is required" });
  if (typeof favorite !== "boolean") return res.status(400).json({ error: "favorite must be boolean" });

  const { data: device, error: findError } = await supabaseAdmin
    .from("devices")
    .select("id,estate_id,home_id,metadata")
    .eq("id", deviceId)
    .eq("estate_id", user.estate_id)
    .eq("home_id", user.home_id)
    .maybeSingle();
  if (findError) return res.status(500).json({ error: findError.message });
  if (!device?.id) return res.status(404).json({ error: "Assigned device not found in this home" });

  const metadata = { ...((device as any).metadata || {}), favorite };
  const { data, error } = await supabaseAdmin
    .from("devices")
    .update({ metadata, updated_at: new Date().toISOString() } as any)
    .eq("id", device.id)
    .select("*")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, device: data });
});

router.get("/:deviceId/runtime", requireAuth, requirePermission("devices.read"), async (req, res) => {
  try {
    const user = req.user;
    const deviceId = String(req.params.deviceId || "").trim();
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
    const { data: device, error } = await supabaseAdmin
      .from("devices")
      .select("id,estate_id,home_id")
      .eq("id", deviceId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!device?.id) return res.status(404).json({ error: "Device not found" });
    if (user.home_id && String((device as any).home_id || "") !== String(user.home_id)) return res.status(403).json({ error: "Device is outside active home" });
    if (user.estate_id && String((device as any).estate_id || "") !== String(user.estate_id)) return res.status(403).json({ error: "Device is outside active estate" });
    const runtime = await summarizeDeviceRuntime({ deviceId, range: String(req.query.range || "today") });
    return res.json(runtime);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Failed to load device runtime" });
  }
});

router.get("/home/:homeId/runtime", requireAuth, requirePermission("devices.read"), async (req, res) => {
  try {
    const user = req.user;
    const homeId = String(req.params.homeId || "").trim();
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
    if (user.home_id && String(user.home_id) !== homeId) return res.status(403).json({ error: "Home is outside active context" });
    const runtime = await summarizeDeviceRuntime({ homeId, range: String(req.query.range || "today") });
    return res.json(runtime);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Failed to load home runtime" });
  }
});

router.get("/:deviceId/ir/profiles", requireAuth, requirePermission("devices.read"), listIrProfiles);
router.post("/:deviceId/ir/appliances", requireAuth, requirePermission("devices.control"), createIrAppliance);
router.post("/:deviceId/command", requireAuth, requirePermission("devices.control"), requestDeviceCommand);
router.get("/:deviceId/state", requireAuth, requirePermission("devices.read"), getDeviceState);

export default router;
