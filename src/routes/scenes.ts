import { Router } from "express";
import { emitAuditEvent } from "../core/foundation";
import { executeDeviceCommandForActor } from "../controllers/deviceCommandController";
import { requireAuth, requirePermission, type AuthUser } from "../middleware/auth";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { resolveVisibleDevice } from "../services/deviceRuntimeService";
import { hasWatchScope } from "../services/watchPolicy";

const router = Router();
router.use(requireAuth);

function actorScope(actor: AuthUser) {
  return { estate_id: actor.estate_id || null, home_id: actor.home_id || null };
}

function scoped(query: any, actor: AuthUser) {
  let next = query;
  if (actor.estate_id) next = next.eq("estate_id", actor.estate_id);
  if (actor.home_id) next = next.eq("home_id", actor.home_id);
  return next;
}

function cleanActions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).map((item: any) => ({
    device_id: String(item?.device_id || item?.deviceId || "").trim(),
    command: item?.command && typeof item.command === "object" ? item.command : {},
  })).filter((item) => item.device_id && Object.keys(item.command).length);
}

function safeSceneCommand(command: Record<string, any>) {
  const keys = Object.keys(command);
  return keys.length > 0 && keys.every((key) => ["switch", "power", "on", "temperature", "temp_set"].includes(key));
}

async function audit(actor: AuthUser, action: string, resourceId: string, metadata: Record<string, any> = {}) {
  await emitAuditEvent({
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action,
    resourceType: "scene",
    resourceId,
    estateId: actor.estate_id,
    homeId: actor.home_id,
    status: "success",
    metadata,
  } as any);
}

router.get("/", requirePermission("devices.read"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const { data, error } = await scoped(supabaseAdmin.from("consumer_scenes").select("*"), req.user!)
    .order("created_at", { ascending: false });
  if (error) return res.json({ available: false, scenes: [], error: error.message });
  res.json({ available: true, scenes: data || [] });
});

router.post("/", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const name = String(req.body?.name || "").trim().slice(0, 80);
  const actions = cleanActions(req.body?.actions);
  if (!name || !actions.length) return res.status(400).json({ error: "A scene name and at least one device action are required" });
  for (const action of actions) {
    if (!safeSceneCommand(action.command) || !(await resolveVisibleDevice(req.user!, action.device_id))) {
      return res.status(403).json({ error: "Scene contains an unavailable or unsafe device action" });
    }
  }
  const row = {
    ...actorScope(req.user!),
    created_by: req.user!.id,
    name,
    description: String(req.body?.description || "").trim().slice(0, 240) || null,
    icon: String(req.body?.icon || "sparkles").slice(0, 32),
    mood: String(req.body?.mood || "").slice(0, 48),
    actions,
    enabled: true,
  };
  const { data, error } = await supabaseAdmin.from("consumer_scenes").insert(row as any).select("*").single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user!, "scene.created", data.id, { action_count: actions.length });
  res.status(201).json(data);
});


router.patch("/:id", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const name = req.body?.name == null ? undefined : String(req.body.name || "").trim().slice(0, 80);
  const actions = req.body?.actions == null ? undefined : cleanActions(req.body.actions);
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (name !== undefined) {
    if (!name) return res.status(400).json({ error: "Scene name is required" });
    updates.name = name;
  }
  if (req.body?.icon != null) updates.icon = String(req.body.icon || "sparkles").slice(0, 32);
  if (req.body?.description != null) updates.description = String(req.body.description || "").trim().slice(0, 240) || null;
  if (req.body?.mood != null) updates.mood = String(req.body.mood || "").slice(0, 48);
  if (actions !== undefined) {
    if (!actions.length) return res.status(400).json({ error: "At least one device action is required" });
    for (const action of actions) {
      if (!safeSceneCommand(action.command) || !(await resolveVisibleDevice(req.user!, action.device_id))) {
        return res.status(403).json({ error: "Scene contains an unavailable or unsafe device action" });
      }
    }
    updates.actions = actions;
  }
  const { data, error } = await scoped(supabaseAdmin.from("consumer_scenes").update(updates).eq("id", req.params.id).select("*") as any, req.user!).single();
  if (error) return res.status(404).json({ error: error.message || "Scene not found" });
  await audit(req.user!, "scene.updated", data.id, { action_count: cleanActions(data.actions).length });
  res.json(data);
});

router.delete("/:id", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const { data, error } = await scoped(supabaseAdmin.from("consumer_scenes").delete().eq("id", req.params.id).select("id") as any, req.user!).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Scene not found" });
  await audit(req.user!, "scene.deleted", req.params.id, {});
  res.json({ ok: true, id: req.params.id });
});

router.post("/:id/run", requirePermission("devices.control"), async (req, res) => {
  const { data: scene, error } = await scoped(supabaseAdmin.from("consumer_scenes").select("*").eq("id", req.params.id), req.user!).maybeSingle();
  if (error || !scene) return res.status(404).json({ error: "Scene not found" });
  const actions = cleanActions(scene.actions);
  const results = [];
  for (const action of actions) {
    if (!safeSceneCommand(action.command) || !(await resolveVisibleDevice(req.user!, action.device_id))) {
      results.push({ device_id: action.device_id, status: "denied" });
      continue;
    }
    try {
      const result = await executeDeviceCommandForActor({ actor: req.user!, deviceId: action.device_id, command: action.command, req });
      results.push({ device_id: action.device_id, status: result.status });
    } catch (runError: any) {
      results.push({ device_id: action.device_id, status: "failed", error: runError?.message || "command_failed" });
    }
  }
  await audit(req.user!, "scene.executed", scene.id, { results });
  res.json({ ok: results.every((item) => item.status !== "failed" && item.status !== "denied"), scene_id: scene.id, results });
});

router.get("/automations", requirePermission("devices.read"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const { data, error } = await scoped(supabaseAdmin.from("consumer_automations").select("*"), req.user!)
    .order("created_at", { ascending: false });
  if (error) return res.json({ available: false, automations: [], error: error.message });
  res.json({ available: true, automations: data || [] });
});

router.post("/automations", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const name = String(req.body?.name || "").trim().slice(0, 80);
  const trigger = req.body?.trigger && typeof req.body.trigger === "object" ? req.body.trigger : null;
  const condition = req.body?.condition && typeof req.body.condition === "object" ? req.body.condition : {};
  const actions = cleanActions(req.body?.actions);
  if (!name || !trigger || !actions.length) return res.status(400).json({ error: "A name, trigger, and at least one device action are required" });
  for (const action of actions) {
    if (!safeSceneCommand(action.command) || !(await resolveVisibleDevice(req.user!, action.device_id))) {
      return res.status(403).json({ error: "Automation contains an unavailable or unsafe device action" });
    }
  }
  const row = { ...actorScope(req.user!), created_by: req.user!.id, name, trigger, condition, actions, enabled: req.body?.enabled !== false };
  const { data, error } = await supabaseAdmin.from("consumer_automations").insert(row as any).select("*").single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user!, "automation.created", data.id, { action_count: actions.length });
  res.status(201).json(data);
});

router.patch("/automations/:id", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (req.body?.name != null) {
    const name = String(req.body.name || "").trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: "Automation name is required" });
    updates.name = name;
  }
  if (req.body?.enabled != null) updates.enabled = req.body.enabled === true;
  if (req.body?.trigger != null) updates.trigger = req.body.trigger && typeof req.body.trigger === "object" ? req.body.trigger : {};
  if (req.body?.condition != null) updates.condition = req.body.condition && typeof req.body.condition === "object" ? req.body.condition : {};
  if (req.body?.actions != null) {
    const actions = cleanActions(req.body.actions);
    if (!actions.length) return res.status(400).json({ error: "At least one device action is required" });
    for (const action of actions) {
      if (!safeSceneCommand(action.command) || !(await resolveVisibleDevice(req.user!, action.device_id))) {
        return res.status(403).json({ error: "Automation contains an unavailable or unsafe device action" });
      }
    }
    updates.actions = actions;
  }
  const { data, error } = await scoped(supabaseAdmin.from("consumer_automations").update(updates).eq("id", req.params.id).select("*") as any, req.user!).single();
  if (error) return res.status(404).json({ error: error.message || "Automation not found" });
  await audit(req.user!, updates.enabled === false ? "automation.paused" : "automation.updated", data.id, { enabled: data.enabled });
  res.json(data);
});

router.delete("/automations/:id", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const { data, error } = await scoped(supabaseAdmin.from("consumer_automations").delete().eq("id", req.params.id).select("id") as any, req.user!).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Automation not found" });
  await audit(req.user!, "automation.deleted", req.params.id, {});
  res.json({ ok: true, id: req.params.id });
});

export default router;
