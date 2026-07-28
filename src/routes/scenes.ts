import { Router } from "express";
import crypto from "crypto";
import { emitAuditEvent } from "../core/foundation";
import { executeDeviceCommandForActor } from "../controllers/deviceCommandController";
import { requireAuth, requirePermission, type AuthUser } from "../middleware/auth";
import { resolveRequestContext } from "../middleware/contextResolver";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { resolveVisibleDevice } from "../services/deviceRuntimeService";
import { hasWatchScope } from "../services/watchPolicy";
import { summarizeDeviceFrontendContract } from "../device/runtime/deviceStateEnrichment";
import { deviceRuntimeStateService } from "../services/deviceRuntimeStateService";
import { logger } from "../observability/logger";

const router = Router();
router.use(requireAuth);
router.use(resolveRequestContext);

const SCENE_ACTION_LIMIT = 24;
const SCENE_ACTION_CONCURRENCY = 3;
const SCENE_ACTION_TIMEOUT_MS = 15_000;

type CleanSceneAction = {
  device_id: string;
  command: Record<string, any>;
  label?: string | null;
  action_label?: string | null;
};

type CanonicalSceneAction = CleanSceneAction & {
  device_name: string;
  command_code: string;
  action_label: string;
};

function activeScope(req: any) {
  return {
    estate_id: req.oisContext?.estate_id || req.user?.estate_id || null,
    home_id: req.oisContext?.home_id || req.user?.home_id || null,
  };
}

function scoped(query: any, req: any) {
  const scope = activeScope(req);
  let next = query;
  if (scope.estate_id) next = next.eq("estate_id", scope.estate_id);
  if (scope.home_id) next = next.eq("home_id", scope.home_id);
  return next;
}

function cleanActions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, SCENE_ACTION_LIMIT).map((item: any) => ({
    device_id: String(item?.device_id || item?.deviceId || "").trim(),
    command: item?.command && typeof item.command === "object" ? item.command : {},
    label: String(item?.label || item?.action_label || "").trim() || null,
    action_label: String(item?.action_label || item?.label || "").trim() || null,
  })).filter((item) => item.device_id && Object.keys(item.command).length);
}

function publicActionError(message: string, statusCode = 422, code = "unsupported_scene_action") {
  const error: any = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function sceneActionError(
  message: string,
  statusCode: number,
  code: string,
  context: {
    actionIndex?: number;
    canonicalDeviceId?: string | null;
    commandKey?: string | null;
    legacyCode?: string;
    exposedChannelKeys?: string[];
    runtimeFreshness?: string | null;
  } = {},
) {
  const error: any = publicActionError(message, statusCode, code);
  error.action_index = context.actionIndex;
  error.canonical_device_id = context.canonicalDeviceId || null;
  error.command_key = context.commandKey || null;
  if (context.legacyCode) error.legacy_code = context.legacyCode;
  error.exposed_channel_keys = Array.isArray(context.exposedChannelKeys) ? context.exposedChannelKeys : [];
  error.runtime_freshness = context.runtimeFreshness || null;
  return error;
}

function sceneActionErrorPayload(err: any) {
  return {
    error: err?.message || "Scene contains an unavailable or unsafe device action",
    message: err?.message || "Scene contains an unavailable or unsafe device action",
    code: err?.code || "scene_action_invalid",
    legacy_code: err?.legacy_code || null,
    action_index: Number.isInteger(err?.action_index) ? err.action_index : null,
    canonical_device_id: err?.canonical_device_id || null,
    command_key: err?.command_key || null,
    exposed_channel_keys: Array.isArray(err?.exposed_channel_keys) ? err.exposed_channel_keys : [],
    runtime_freshness: err?.runtime_freshness || null,
  };
}

function boolValue(value: any): boolean | null {
  if (value === true || value === false) return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "on", "yes"].includes(raw)) return true;
  if (["false", "0", "off", "no"].includes(raw)) return false;
  return null;
}

function numberValue(value: any): number | null {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function titleCase(value: string, fallback = "Device") {
  const text = value.replace(/[_-]+/g, " ").trim();
  if (!text) return fallback;
  return text.split(/\s+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function commandEntries(command: Record<string, any>) {
  return Object.entries(command || {}).filter(([key]) => !["source", "metadata", "meta", "idempotency_key", "command_key"].includes(String(key).toLowerCase()));
}

function sceneDeviceFamily(device: any, summary: any) {
  const family = String(summary?.device_family || device?.device_family || device?.category || device?.type || "").toLowerCase();
  const profile = String(summary?.control_profile || device?.control_profile || "").toLowerCase();
  const haystack = [
    family,
    profile,
    device?.name,
    device?.type,
    device?.category,
    device?.metadata?.raw?.category,
    device?.metadata?.category,
    device?.metadata?.product_name,
    device?.metadata?.model,
  ].map((item) => String(item || "").toLowerCase()).join(" ");
  if (family === "lock" || profile === "lock" || /\b(jtmspro|lock|doorlock|smart_access)\b/.test(haystack)) return "lock";
  if (family === "television" || profile === "television" || family === "ir_remote" || profile === "ir_remote" || /\b(tv|television|infrared|ir remote)\b/.test(haystack)) return "ir";
  if (family === "curtain" || profile === "curtain") return "curtain";
  if (family === "climate" || family === "air_conditioner" || profile === "air_conditioner" || profile === "climate") return "climate";
  if (family === "switch" || family === "plug" || family === "light" || profile === "switch" || profile === "plug") return "switch";
  const codes = new Set([...(summary?.capability_codes || []), ...(summary?.supported_controls || [])].map((item: any) => String(item).toLowerCase()));
  if (Array.from(codes).some((code) => /^switch(_\d+)?$/.test(code) || ["power", "on"].includes(code))) return "switch";
  return "unknown";
}

function controllableChannels(summary: any) {
  return (Array.isArray(summary?.channel_definitions) ? summary.channel_definitions : [])
    .filter((channel: any) => channel?.controllable !== false && channel?.code)
    .map((channel: any, index: number) => ({
      index: Number(channel.index || index + 1),
      code: String(channel.code),
      name: String(channel.name || channel.label || `Channel ${Number(channel.index || index + 1)}`),
    }));
}

function validationLogBase(req: any) {
  const scope = activeScope(req);
  return {
    actor_id: req.user?.id || null,
    estate_id: scope.estate_id,
    home_id: scope.home_id,
  };
}

function sanitizedActionsForLog(actions: CleanSceneAction[]) {
  return actions.map((action, index) => {
    const [commandKey, value] = commandEntries(action.command)[0] || [];
    return {
      action_index: index,
      canonical_device_id: action.device_id,
      command_key: commandKey ? String(commandKey) : null,
      value_type: typeof value,
      value: typeof value === "boolean" || typeof value === "number" || typeof value === "string" ? value : null,
    };
  });
}

async function frontendContractForSceneValidation(device: any) {
  const snapshot = await deviceRuntimeStateService.getOrHydrate(device).catch((error) => {
    logger.warn("scene_action_runtime_snapshot_unavailable", {
      device_id: String(device?.id || ""),
      error,
    });
    return null;
  });
  const stateRow = snapshot
    ? {
      status: snapshot.state,
      last_seen: snapshot.last_refresh,
      updated_at: snapshot.runtime_timestamp,
    }
    : null;
  return {
    summary: snapshot?.summary || summarizeDeviceFrontendContract(device, stateRow),
    runtimeFreshness: snapshot?.freshness || "unavailable",
    runtimeSource: snapshot?.source || "none",
  };
}

async function canonicalizeSceneAction(req: any, action: CleanSceneAction, index: number): Promise<CanonicalSceneAction> {
  const scope = activeScope(req);
  const [submittedKey, submittedValue] = commandEntries(action.command)[0] || [];
  logger.info("scene_action_validation_started", {
    ...validationLogBase(req),
    action_index: index,
    canonical_device_id: action.device_id,
    command_key: submittedKey ? String(submittedKey) : null,
    value_type: typeof submittedValue,
  });

  const device = await resolveVisibleDevice(req.user!, action.device_id, { estateId: scope.estate_id, homeId: scope.home_id });
  if (!device?.id) {
    logger.warn("scene_action_validation_failed", {
      ...validationLogBase(req),
      action_index: index,
      canonical_device_id: action.device_id,
      command_key: submittedKey ? String(submittedKey) : null,
      exposed_channel_keys: [],
      runtime_freshness: "unavailable",
      validation_code: "device_out_of_scope",
    });
    throw sceneActionError("Scene contains a device outside this home.", 403, "device_out_of_scope", {
      actionIndex: index,
      canonicalDeviceId: action.device_id,
      commandKey: submittedKey ? String(submittedKey) : null,
      runtimeFreshness: "unavailable",
    });
  }

  const { summary, runtimeFreshness, runtimeSource } = await frontendContractForSceneValidation(device);
  const family = sceneDeviceFamily(device, summary);
  const entries = commandEntries(action.command);
  const [rawKey, rawValue] = entries[0] || [];
  const key = String(rawKey || "").trim();
  const keyLower = key.toLowerCase();
  const channels = controllableChannels(summary);
  const exposedChannelKeys = channels.map((channel: { code: string }) => channel.code);
  const capabilityCodes = new Set([...(summary.capability_codes || []), ...(summary.supported_controls || [])].map((item: any) => String(item).toLowerCase()));
  const errorContext = { actionIndex: index, canonicalDeviceId: String(device.id), commandKey: key || null, exposedChannelKeys, runtimeFreshness };

  logger.info("scene_action_capability_contract", {
    ...validationLogBase(req),
    action_index: index,
    canonical_device_id: String(device.id),
    command_key: key || null,
    device_family: family,
    exposed_channel_keys: exposedChannelKeys,
    capability_keys: Array.from(capabilityCodes).filter((code) => /^switch(_\d+)?$/.test(code) || ["switch", "power", "on"].includes(code)),
    runtime_freshness: runtimeFreshness,
    runtime_source: runtimeSource,
  });

  const fail = (error: any) => {
    logger.warn("scene_action_validation_failed", {
      ...validationLogBase(req),
      action_index: Number.isInteger(error?.action_index) ? error.action_index : index,
      canonical_device_id: error?.canonical_device_id || String(device.id),
      command_key: error?.command_key || key || null,
      exposed_channel_keys: Array.isArray(error?.exposed_channel_keys) ? error.exposed_channel_keys : exposedChannelKeys,
      runtime_freshness: error?.runtime_freshness || runtimeFreshness,
      validation_code: error?.code || "scene_action_invalid",
    });
    return error;
  };

  if (family === "lock") throw fail(sceneActionError("Lock actions are unavailable in scenes for safety.", 422, "lock_scene_action_blocked", errorContext));
  if (family === "ir") throw fail(sceneActionError("TV and IR remote actions are not enabled for scenes in this phase.", 422, "ir_scene_action_blocked", errorContext));

  if (entries.length !== 1) throw fail(sceneActionError("Each scene action must control exactly one device action.", 422, "scene_action_not_atomic", errorContext));
  const deviceName = String(device.name || "Device");

  if (family === "switch") {
    const desired = boolValue(rawValue);
    if (desired === null) throw fail(sceneActionError("Switch scene actions must be On or Off.", 422, "invalid_switch_value", errorContext));
    let commandCode = key;
    if (["switch", "power", "on"].includes(keyLower)) {
      if (channels.length > 1) {
        throw fail(sceneActionError("Choose a specific switch channel for this multi-gang device.", 422, "ambiguous_multi_gang_scene_action", errorContext));
      }
      commandCode = channels[0]?.code || (capabilityCodes.has("switch_1") ? "switch_1" : keyLower);
    } else if (/^switch_\d+$/i.test(key)) {
      const hasChannel = channels.some((channel: { code: string }) => channel.code.toLowerCase() === keyLower);
      if (!hasChannel && !capabilityCodes.has(keyLower)) {
        throw fail(sceneActionError("This switch channel is not exposed by the device.", 422, "SCENE_CHANNEL_NOT_EXPOSED", {
          ...errorContext,
          legacyCode: "unsupported_switch_channel",
        }));
      }
    } else if (!capabilityCodes.has(keyLower)) {
      throw fail(sceneActionError("This device does not expose that scene action.", 422, "unsupported_scene_command", errorContext));
    }
    const channel = channels.find((item: { code: string; name: string }) => item.code.toLowerCase() === String(commandCode).toLowerCase());
    const actionLabel = action.action_label || action.label || `${channel?.name || titleCase(commandCode, "Power")} → ${desired ? "On" : "Off"}`;
    return {
      device_id: String(device.id),
      command: { [commandCode]: desired },
      label: action.label || actionLabel,
      action_label: actionLabel,
      device_name: deviceName,
      command_code: commandCode,
    };
  }

  if (family === "curtain") {
    if (!["open", "close", "position"].includes(keyLower) || !capabilityCodes.has(keyLower)) {
      throw fail(sceneActionError("This curtain does not expose that safe scene action.", 422, "unsupported_curtain_action", errorContext));
    }
    const value = keyLower === "position" ? numberValue(rawValue) : boolValue(rawValue);
    if (value === null || (typeof value === "number" && (value < 0 || value > 100))) {
      throw fail(sceneActionError("Curtain scene action value is invalid.", 422, "invalid_curtain_value", errorContext));
    }
    const actionLabel = action.action_label || action.label || `${titleCase(keyLower)} → ${String(value)}`;
    return { device_id: String(device.id), command: { [keyLower]: value }, label: action.label || actionLabel, action_label: actionLabel, device_name: deviceName, command_code: keyLower };
  }

  if (family === "climate") {
    if (!["temperature", "temp_set", "mode"].includes(keyLower) || !capabilityCodes.has(keyLower)) {
      throw fail(sceneActionError("This climate device does not expose that scene action.", 422, "unsupported_climate_action", errorContext));
    }
    const value = keyLower === "mode" ? String(rawValue || "").trim() : numberValue(rawValue);
    if (value === "" || value === null) throw fail(sceneActionError("Climate scene action value is invalid.", 422, "invalid_climate_value", errorContext));
    const actionLabel = action.action_label || action.label || `${titleCase(keyLower)} → ${String(value)}`;
    return { device_id: String(device.id), command: { [keyLower]: value }, label: action.label || actionLabel, action_label: actionLabel, device_name: deviceName, command_code: keyLower };
  }

  throw fail(sceneActionError("This device is not supported by scenes yet.", 422, "unsupported_scene_device", errorContext));
}

async function canonicalizeSceneActions(req: any, actions: CleanSceneAction[]) {
  const canonical: CanonicalSceneAction[] = [];
  for (let index = 0; index < actions.length; index += 1) {
    canonical.push(await canonicalizeSceneAction(req, actions[index], index));
  }
  return canonical;
}

function sceneRunId(req: any, sceneId: string) {
  const explicit = String(req.headers?.["idempotency-key"] || req.body?.scene_run_id || req.body?.run_id || "").trim();
  if (explicit && /^[a-zA-Z0-9:_-]{8,128}$/.test(explicit)) return explicit;
  return crypto.randomUUID();
}

function stableActionExecutionId(sceneRunId: string, index: number, action: CanonicalSceneAction) {
  const hash = crypto.createHash("sha256").update(`${sceneRunId}:${index}:${action.device_id}:${action.command_code}`).digest("hex").slice(0, 24);
  return `scene_action:${hash}`;
}

function sceneActionIdempotencyKey(sceneRunId: string, index: number, action: CanonicalSceneAction) {
  return `scene:${sceneRunId}:action:${index}:${action.device_id}:${action.command_code}`;
}

function sceneActionReq(req: any, commandKey: string, executionId: string, actionIndex: number, requestedAt: string) {
  return {
    ...req,
    headers: {
      ...(req.headers || {}),
      "idempotency-key": commandKey,
    },
    body: {
      ...(req.body || {}),
      source: "scene",
      command_source: "scene",
      idempotency_key: commandKey,
      command_key: commandKey,
      command_execution_id: executionId,
      tap_sequence: actionIndex + 1,
      client_tap_timestamp: Date.parse(requestedAt),
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          const error: any = new Error("Scene action timed out.");
          error.statusCode = 504;
          error.code = "scene_action_timed_out";
          reject(error);
        }, ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function overallSceneStatus(results: Array<{ status: string }>) {
  const failed = results.filter((item) => ["failed", "denied", "skipped", "timed_out"].includes(item.status)).length;
  if (!results.length || failed === results.length) return "failed";
  if (failed > 0) return "partially_completed";
  return "completed";
}

function sceneRunCounts(results: Array<{ status: string }>) {
  return {
    total: results.length,
    completed: results.filter((item) => ["completed", "accepted", "pending_confirmation"].includes(item.status)).length,
    failed: results.filter((item) => ["failed", "denied", "skipped", "timed_out"].includes(item.status)).length,
  };
}

async function audit(actor: AuthUser, action: string, resourceId: string, metadata: Record<string, any> = {}, req?: any) {
  const scope = req ? activeScope(req) : { estate_id: actor.estate_id || null, home_id: actor.home_id || null };
  await emitAuditEvent({
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action,
    resourceType: "scene",
    resourceId,
    estateId: scope.estate_id || undefined,
    homeId: scope.home_id || undefined,
    status: "success",
    metadata,
  } as any);
}

router.get("/", requirePermission("devices.read"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const { data, error } = await scoped(supabaseAdmin.from("consumer_scenes").select("*"), req)
    .order("created_at", { ascending: false });
  if (error) return res.json({ available: false, scenes: [], error: error.message });
  res.json({ available: true, scenes: data || [] });
});

router.post("/", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const name = String(req.body?.name || "").trim().slice(0, 80);
  const actions = cleanActions(req.body?.actions);
  logger.info("scene_create_request_received", {
    ...validationLogBase(req),
    action_count: actions.length,
    actions: sanitizedActionsForLog(actions),
  });
  if (!name || !actions.length) return res.status(400).json({ error: "A scene name and at least one device action are required" });
  let canonicalActions: CanonicalSceneAction[];
  try {
    canonicalActions = await canonicalizeSceneActions(req, actions);
  } catch (err: any) {
    const payload = sceneActionErrorPayload(err);
    logger.warn("scene_create_rejected", {
      ...validationLogBase(req),
      ...payload,
    });
    return res.status(Number(err?.statusCode || 422)).json(payload);
  }
  const row = {
    ...activeScope(req),
    created_by: req.user!.id,
    name,
    description: String(req.body?.description || "").trim().slice(0, 240) || null,
    icon: String(req.body?.icon || "sparkles").slice(0, 32),
    mood: String(req.body?.mood || "").slice(0, 48),
    actions: canonicalActions,
    enabled: true,
  };
  const { data, error } = await supabaseAdmin.from("consumer_scenes").insert(row as any).select("*").single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user!, "scene.created", data.id, { action_count: actions.length }, req);
  logger.info("scene_create_completed", {
    ...validationLogBase(req),
    scene_id: data.id,
    action_count: canonicalActions.length,
  });
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
    try {
      updates.actions = await canonicalizeSceneActions(req, actions);
    } catch (err: any) {
      return res.status(Number(err?.statusCode || 422)).json(sceneActionErrorPayload(err));
    }
  }
  const { data, error } = await scoped(supabaseAdmin.from("consumer_scenes").update(updates).eq("id", req.params.id).select("*") as any, req).single();
  if (error) return res.status(404).json({ error: error.message || "Scene not found" });
  await audit(req.user!, "scene.updated", data.id, { action_count: cleanActions(data.actions).length }, req);
  res.json(data);
});

router.delete("/:id", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const { data, error } = await scoped(supabaseAdmin.from("consumer_scenes").delete().eq("id", req.params.id).select("id") as any, req).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Scene not found" });
  await audit(req.user!, "scene.deleted", req.params.id, {}, req);
  res.json({ ok: true, id: req.params.id });
});

router.post("/:id/run", requirePermission("devices.control"), async (req, res) => {
  const { data: scene, error } = await scoped(supabaseAdmin.from("consumer_scenes").select("*").eq("id", req.params.id), req).maybeSingle();
  if (error || !scene) return res.status(404).json({ error: "Scene not found" });
  const actions = cleanActions(scene.actions);
  const requestedAt = new Date().toISOString();
  const runId = sceneRunId(req, String(scene.id));
  let canonicalActions: CanonicalSceneAction[] = [];
  try {
    canonicalActions = await canonicalizeSceneActions(req, actions);
  } catch (err: any) {
    const failed = {
      scene_run_id: runId,
      scene_id: scene.id,
      scene_name: scene.name,
      status: "failed",
      requested_at: requestedAt,
      completed_at: new Date().toISOString(),
      counts: { total: actions.length, completed: 0, failed: actions.length || 1 },
      actions: actions.map((action, index) => ({
        action_index: index,
        device_id: action.device_id,
        status: "denied",
        error: err?.message || "Scene action is not allowed.",
      })),
    };
    await audit(req.user!, "scene.run.failed", scene.id, { ...failed, domain: "resident_device_private" }, req);
    return res.status(Number(err?.statusCode || 422)).json({ ok: false, ...failed, ...sceneActionErrorPayload(err) });
  }

  await audit(req.user!, "scene.run.requested", scene.id, {
    scene_run_id: runId,
    scene_id: scene.id,
    action_count: canonicalActions.length,
    source: "manual",
    domain: "resident_device_private",
  }, req);

  const results = await mapWithConcurrency(canonicalActions, SCENE_ACTION_CONCURRENCY, async (action, index) => {
    const commandKey = sceneActionIdempotencyKey(runId, index, action);
    const actionExecutionId = stableActionExecutionId(runId, index, action);
    const actionReq = sceneActionReq(req, commandKey, actionExecutionId, index, requestedAt);
    try {
      const result: any = await withTimeout(executeDeviceCommandForActor({
        actor: req.user!,
        deviceId: action.device_id,
        command: action.command,
        source: "scene",
        scope: { estateId: activeScope(req).estate_id, homeId: activeScope(req).home_id },
        req: actionReq as any,
        commandExecutionId: actionExecutionId,
      }), SCENE_ACTION_TIMEOUT_MS);
      const status = result?.confirmation_strategy === "provider_ack_only"
        ? "accepted"
        : result?.execution_status === "partial_confirmation" || result?.status === "command_partial_confirmation"
          ? "pending_confirmation"
          : result?.ok === true
            ? "completed"
            : "failed";
      return {
        action_index: index,
        scene_action_execution_id: actionExecutionId,
        idempotency_key: commandKey,
        command_execution_id: result?.command_execution_id || actionExecutionId,
        device_id: action.device_id,
        device_name: action.device_name,
        command: action.command,
        action_label: action.action_label,
        status,
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
        error: null,
      };
    } catch (runError: any) {
      const status = Number(runError?.statusCode) === 403 ? "denied" : Number(runError?.statusCode) === 504 ? "timed_out" : "failed";
      return {
        action_index: index,
        scene_action_execution_id: actionExecutionId,
        idempotency_key: commandKey,
        command_execution_id: actionExecutionId,
        device_id: action.device_id,
        device_name: action.device_name,
        command: action.command,
        action_label: action.action_label,
        status,
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
        error: runError?.message || "command_failed",
      };
    }
  });
  const completedAt = new Date().toISOString();
  const status = overallSceneStatus(results);
  const counts = sceneRunCounts(results);
  const response = {
    ok: status === "completed",
    scene_run_id: runId,
    scene_id: scene.id,
    scene_name: scene.name,
    status,
    requested_at: requestedAt,
    completed_at: completedAt,
    counts,
    actions: results,
  };
  await audit(req.user!, `scene.run.${status}`, scene.id, { ...response, domain: "resident_device_private" }, req);
  res.json(response);
});

router.get("/:id/runs", requirePermission("devices.read"), async (req, res) => {
  const { data: scene, error: sceneError } = await scoped(supabaseAdmin.from("consumer_scenes").select("id,name").eq("id", req.params.id), req).maybeSingle();
  if (sceneError || !scene) return res.status(404).json({ error: "Scene not found" });
  const { data, error } = await scoped(
    supabaseAdmin
      .from("audit_events")
      .select("action,resource_id,metadata,created_at")
      .eq("resource_type", "scene")
      .eq("resource_id", req.params.id)
      .in("action", ["scene.run.completed", "scene.run.partially_completed", "scene.run.failed"])
      .order("created_at", { ascending: false })
      .limit(20),
    req,
  );
  if (error) return res.status(500).json({ error: error.message });
  const runs = (data || []).map((row: any) => {
    const metadata = row?.metadata || {};
    return {
      scene_run_id: metadata.scene_run_id || null,
      scene_id: metadata.scene_id || row.resource_id,
      scene_name: metadata.scene_name || scene.name,
      status: metadata.status || String(row.action || "").replace("scene.run.", ""),
      requested_at: metadata.requested_at || row.created_at,
      completed_at: metadata.completed_at || row.created_at,
      counts: metadata.counts || { total: 0, completed: 0, failed: 0 },
      actions: Array.isArray(metadata.actions) ? metadata.actions.map((action: any) => ({
        device_id: action.device_id || null,
        device_name: action.device_name || "Device",
        action_label: action.action_label || "Scene action",
        status: action.status || "unknown",
        command_execution_id: action.command_execution_id || null,
      })) : [],
    };
  });
  res.json({ available: true, runs });
});

router.get("/automations", requirePermission("devices.read"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const { data, error } = await scoped(supabaseAdmin.from("consumer_automations").select("*"), req)
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
  let canonicalActions: CanonicalSceneAction[];
  try {
    canonicalActions = await canonicalizeSceneActions(req, actions);
  } catch (err: any) {
    return res.status(Number(err?.statusCode || 422)).json({ error: err?.message || "Automation contains an unavailable or unsafe device action", code: err?.code || "automation_action_invalid" });
  }
  const row = { ...activeScope(req), created_by: req.user!.id, name, trigger, condition, actions: canonicalActions, enabled: req.body?.enabled !== false };
  const { data, error } = await supabaseAdmin.from("consumer_automations").insert(row as any).select("*").single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user!, "automation.created", data.id, { action_count: actions.length }, req);
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
    try {
      updates.actions = await canonicalizeSceneActions(req, actions);
    } catch (err: any) {
      return res.status(Number(err?.statusCode || 422)).json({ error: err?.message || "Automation contains an unavailable or unsafe device action", code: err?.code || "automation_action_invalid" });
    }
  }
  const { data, error } = await scoped(supabaseAdmin.from("consumer_automations").update(updates).eq("id", req.params.id).select("*") as any, req).single();
  if (error) return res.status(404).json({ error: error.message || "Automation not found" });
  await audit(req.user!, updates.enabled === false ? "automation.paused" : "automation.updated", data.id, { enabled: data.enabled }, req);
  res.json(data);
});

router.delete("/automations/:id", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const { data, error } = await scoped(supabaseAdmin.from("consumer_automations").delete().eq("id", req.params.id).select("id") as any, req).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Automation not found" });
  await audit(req.user!, "automation.deleted", req.params.id, {}, req);
  res.json({ ok: true, id: req.params.id });
});

export default router;
