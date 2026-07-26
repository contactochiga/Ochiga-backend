// src/controllers/deviceCommandController.ts
import { Request, Response } from "express";
import crypto from "crypto";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { adapterRegistry } from "../device/adapters/registry";
import { initAdaptersOnce } from "../device/adapters/initAdapters";
import { NotificationService } from "../services/NotificationService";
import { emitAuditEvent } from "../core/foundation";
import type { AuthUser } from "../middleware/auth";
import { type DeviceRuntimeScope, logDeviceCommandDiagnostic, normalizeDeviceOnlineState, resolveVisibleDevice } from "../services/deviceRuntimeService";
import { recordDeviceEvent } from "../services/deviceAnalyticsService";
import { emitOperationalDeviceSignal } from "../services/deviceOperationalSignalService";
import { enrichDeviceProviderState, summarizeDeviceFrontendContract } from "../device/runtime/deviceStateEnrichment";
import { deviceRuntimeStateService } from "../services/deviceRuntimeStateService";
import { logger } from "../observability/logger";
import { assertSmartLockCommandAllowed, summarizeSmartLockCapabilities } from "../services/smartLockCapabilityService";

function textFromDevice(device: any) {
  return [
    device?.name,
    device?.type,
    device?.category,
    device?.device_type,
    device?.vendor,
    device?.provider,
    device?.adapter,
    device?.metadata?.category,
    device?.metadata?.type,
    device?.metadata?.product_name,
    device?.metadata?.productName,
    device?.metadata?.model,
    device?.metadata?.remote_type,
    device?.metadata?.remoteType,
    device?.metadata?.ir_profile,
    device?.metadata?.irProfile,
    device?.metadata?.raw?.category,
    device?.metadata?.raw?.product_name,
    device?.metadata?.raw?.model,
  ].map((item) => String(item || "").toLowerCase()).join(" ");
}

function deviceCommandFamily(device: any) {
  const summary = summarizeDeviceFrontendContract(device || {});
  const profile = String(summary.control_profile || "").toLowerCase();
  const deviceFamily = String(summary.device_family || "").toLowerCase();
  const capabilityCodes = Array.isArray(summary.capability_codes)
    ? summary.capability_codes.map((x: any) => String(x).toLowerCase())
    : [];
  const controls = Array.isArray(summary.supported_controls) ? summary.supported_controls.map((item) => String(item).toLowerCase()) : [];
  const identity = textFromDevice(device);
  if (deviceFamily === "camera" || profile === "camera") return "camera";
  if (deviceFamily === "climate" || deviceFamily === "air_conditioner" || profile === "air_conditioner" || profile === "climate") return "ac";
  if (deviceFamily === "television" || profile === "television" || profile === "tv" || /\b(tv|television|smart tv|android tv|google tv|samsung tv|lg tv|hisense tv|tcl|set top|set_top_box|decoder|stb)\b/.test(identity)) return "tv";
  if (deviceFamily === "ir_remote" || profile === "ir_remote" || controls.includes("remote")) return "ir";
  if (deviceFamily === "curtain" || profile === "curtain") return "curtain";
  const lockSummary = summarizeSmartLockCapabilities(device);
  if (lockSummary.is_lock || deviceFamily === "lock" || profile === "lock") return "lock";
  if (deviceFamily === "switch" || deviceFamily === "plug" || deviceFamily === "light" || profile === "switch" || profile === "plug") return "switch";
  if (capabilityCodes.some((code) => /^switch(_\d+)?$/.test(code)) && !controls.includes("remote")) return "switch";
  return "unknown";
}

function commandKeys(command: any) {
  if (Array.isArray(command?.commands)) return command.commands.map((item: any) => String(item?.code || "").toLowerCase()).filter(Boolean);
  return Object.keys(command || {}).map((key) => key.toLowerCase());
}

function isTypedRemotePayload(command: Record<string, any>) {
  const type = String((command as any)?.type || "").toLowerCase();
  return ["tv_remote", "ac_remote", "ir_remote", "climate"].includes(type);
}

function isSwitchPayload(command: Record<string, any>) {
  if (isTypedRemotePayload(command)) return false;
  const keys = commandKeys(command);
  return keys.some((key: string) => key === "switch" || key === "on" || key === "state" || key === "power" || /^switch_\d+$/i.test(key));
}

function isTvPayload(command: Record<string, any>) {
  const type = String((command as any)?.type || "").toLowerCase();
  const keys = commandKeys(command);
  return type === "tv_remote" || type === "ir_remote" || keys.some((key: string) => /^(ir_code|remote_key|key_code|control|command_key|key|remote|power)$/.test(key));
}

function isAcPayload(command: Record<string, any>) {
  const type = String((command as any)?.type || "").toLowerCase();
  const keys = commandKeys(command);
  return type === "ac_remote" || type === "climate" || keys.some((key: string) => /temp|temperature|mode|fan|swing|wind/.test(key)) || isTvPayload(command);
}

function assertDeviceCommandSupported(device: any, command: Record<string, any>) {
  const family = deviceCommandFamily(device);
  const switchPayload = isSwitchPayload(command);
  const summary = summarizeDeviceFrontendContract(device);

  logger.debug("device_command_classification", {
    real_category: device?.metadata?.raw?.category || device?.metadata?.category || device?.category,
    device_family: summary.device_family,
    control_profile: summary.control_profile,
    supported_controls: summary.supported_controls,
    capability_codes: summary.capability_codes,
    family,
    switchPayload,
    type: device?.type,
    category: device?.category,
    command,
  });

  if (family === "switch") {
    if (isTypedRemotePayload(command) || isTvPayload(command) || isAcPayload(command)) {
      const error: any = new Error("This switch does not support remote control.");
      error.statusCode = 400;
      throw error;
    }
    return;
  }
  if (family === "tv" || family === "ir") {
    if (!isTvPayload(command) || switchPayload) {
      const error: any = new Error("This device does not support switch control.");
      error.statusCode = 400;
      throw error;
    }
    return;
  }
  if (family === "ac") {
    if (!isAcPayload(command) || switchPayload) {
      const error: any = new Error("This device does not support switch control.");
      error.statusCode = 400;
      throw error;
    }
    return;
  }
  if (family === "curtain") return;
  if (family === "lock") {
    assertSmartLockCommandAllowed(device, command);
    const keys = commandKeys(command);
    if (!keys.some((key: string) => /lock|unlock|switch|state/.test(key))) {
      const error: any = new Error("This lock does not support that action.");
      error.statusCode = 400;
      throw error;
    }
    return;
  }
  if (family === "camera") {
    const error: any = new Error("This device does not support switch control.");
    error.statusCode = 400;
    throw error;
  }
  if (switchPayload) {
    const error: any = new Error("This device does not support switch control.");
    error.statusCode = 400;
    throw error;
  }
}

function normalizeCommand(input: any, device?: any): Record<string, any> {
  const c = input ?? {};

  if (Array.isArray(c.commands)) {
    const out: Record<string, any> = {};
    for (const item of c.commands) {
      if (item?.code) out[String(item.code)] = item.value;
    }
    return out;
  }

  const family = device ? deviceCommandFamily(device) : "unknown";
  if (family === "tv" || family === "ir") {
    const next: Record<string, any> = { ...c, type: c.type || "tv_remote" };
    if (typeof c.on === "boolean" && typeof next.power !== "boolean") next.power = c.on;
    if (typeof c.switch === "boolean" && typeof next.power !== "boolean") next.power = c.switch;
    if (!next.key && c.command) next.key = c.command;
    return next;
  }

  if (family === "ac") {
    const next: Record<string, any> = { ...c, type: c.type || "ac_remote" };
    if (typeof c.on === "boolean" && typeof next.power !== "boolean") next.power = c.on;
    if (typeof c.switch === "boolean" && typeof next.power !== "boolean") next.power = c.switch;
    if (next.fanSpeed != null && next.fan_speed == null) next.fan_speed = next.fanSpeed;
    if (next.fan != null && next.fan_speed == null) next.fan_speed = next.fan;
    if (next.wind != null && next.fan_speed == null) next.fan_speed = next.wind;
    if (next.temp != null && next.temperature == null) next.temperature = next.temp;
    return next;
  }

  if (family === "lock") {
    const next: Record<string, any> = { ...c, type: c.type || "lock" };
    const requested =
      c.locked ??
      c.lock ??
      c.unlock ??
      c.state ??
      c.switch ??
      c.power ??
      c.on;
    if (requested !== undefined) {
      if (typeof requested === "boolean") {
        next.lock = c.unlock === true ? false : requested;
      } else {
        const text = String(requested).toLowerCase();
        if (text === "unlocked" || text === "unlock" || text === "open") next.lock = false;
        if (text === "locked" || text === "lock" || text === "closed") next.lock = true;
      }
    }
    return next;
  }

  const summary = device ? summarizeDeviceFrontendContract(device) : null;
  const controls = Array.isArray(summary?.supported_controls)
    ? summary.supported_controls.map((x: any) => String(x))
    : [];

  const firstGang =
    controls.find((name: string) => /^switch_\d+$/.test(name)) || "switch_1";

  if (typeof c.on === "boolean") {
    return { [firstGang]: c.on };
  }

  if (typeof c.power === "boolean") {
    return { [firstGang]: c.power };
  }

  if (typeof c.switch === "boolean") {
    return { [firstGang]: c.switch };
  }

  return c;
}

type CommandSource = "app" | "watch" | "scene" | "automation" | "facility";

function commandSourceFor(inputSource: unknown, user: AuthUser): CommandSource {
  const text = String(inputSource || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (text === "watch" || /watch/.test(text)) return "watch";
  if (text === "scene" || /scene/.test(text)) return "scene";
  if (text === "automation" || /automation/.test(text)) return "automation";
  if (text === "facility" || /facility|operator|admin/.test(text)) return "facility";
  const role = String(user?.role || "").toLowerCase();
  if (/facility|operator|admin|security|maintenance/.test(role)) return "facility";
  return "app";
}

function describeDeviceCommand(deviceName: any, command: Record<string, any>) {
  const name = String(deviceName || "Device").trim() || "Device";
  const value =
    typeof command?.switch === "boolean" ? command.switch :
    typeof command?.power === "boolean" ? command.power :
    typeof command?.on === "boolean" ? command.on :
    undefined;

  if (typeof value === "boolean") {
    return {
      title: `${name} ${value ? "turned on" : "turned off"}`,
      message: value ? `${name} is now on.` : `${name} is now off.`,
    };
  }

  return {
    title: `${name} updated`,
    message: `${name} command executed successfully.`,
  };
}

function lifecycleStep(status: string, label: string, details?: string | null) {
  return {
    status,
    label,
    details: details || null,
    occurred_at: new Date().toISOString(),
  };
}

function pendingConfirmationCopy(name: string) {
  return {
    title: `${name} confirmation pending`,
    message: "The provider accepted the command, but Oyi is still waiting for the device to confirm its new state.",
  };
}

function commandSentCopy(name: string) {
  return {
    title: `${name} command sent`,
    message: "The provider accepted this remote command.",
  };
}

const commandAcceptances = new Map<string, { expiresAt: number; response: Record<string, any> }>();
const COMMAND_ACCEPTANCE_TTL_MS = 2 * 60_000;
const irCommandLanes = new Map<string, Promise<void>>();
const IR_QUEUE_MAX_WAIT_MS = 4_000;
const IR_QUEUE_LANE_TTL_MS = 30_000;
const IR_DISPATCH_SPACING_MS = Number(process.env.OYI_IR_DISPATCH_SPACING_MS || 80);

function pruneCommandAcceptances() {
  const now = Date.now();
  for (const [key, value] of commandAcceptances.entries()) {
    if (value.expiresAt <= now) commandAcceptances.delete(key);
  }
}

function commandFingerprint(command: Record<string, any>) {
  return crypto.createHash("sha256").update(JSON.stringify(command || {})).digest("hex").slice(0, 16);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function irCommandLaneKey(device: any) {
  const appliance = device?.metadata?.ir_appliance || {};
  return [
    device?.provider_connection_id || "connection",
    appliance.infrared_id || device?.parent_external_id || device?.external_id || device?.id,
    appliance.remote_id || appliance.profile_id || device?.metadata?.remote_id || "remote",
  ].map((part) => String(part || "")).join(":");
}

async function runInIrCommandLane<T>(key: string, task: () => Promise<T>): Promise<T> {
  const queuedAt = Date.now();
  const previous = irCommandLanes.get(key) || Promise.resolve();
  let releaseLane!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseLane = resolve;
  });
  const lanePromise = previous.then(() => current).catch(() => current);
  irCommandLanes.set(key, lanePromise);

  try {
    logger.info("ir_dispatch_queued", {
      lane: key,
      queue_wait_budget_ms: IR_QUEUE_MAX_WAIT_MS,
      dispatch_spacing_ms: IR_DISPATCH_SPACING_MS,
    });
    await Promise.race([
      previous.catch(() => undefined),
      sleep(IR_QUEUE_MAX_WAIT_MS).then(() => {
        const error: any = new Error("This remote command waited too long and was not sent.");
        error.statusCode = 429;
        error.code = "ir_queue_expired";
        throw error;
      }),
    ]);
    const queueWaitMs = Date.now() - queuedAt;
    if (IR_DISPATCH_SPACING_MS > 0) await sleep(IR_DISPATCH_SPACING_MS);
    logger.info("ir_dispatch_queue_released", {
      lane: key,
      queue_wait_ms: queueWaitMs,
    });
    return await task();
  } finally {
    releaseLane();
    setTimeout(() => {
      if (irCommandLanes.get(key) === lanePromise) irCommandLanes.delete(key);
    }, IR_QUEUE_LANE_TTL_MS).unref?.();
  }
}

function commandIdempotencyKey(req: Request, user: AuthUser, rawId: string, command: Record<string, any>, source: CommandSource, replayWindowMs = 5_000) {
  const explicit =
    String(req.headers["idempotency-key"] || req.headers["x-idempotency-key"] || req.body?.idempotency_key || req.body?.command_id || "").trim();
  if (explicit) return `explicit:${user.id}:${rawId}:${source}:${explicit}`;
  const shortReplayWindow = Math.floor(Date.now() / Math.max(250, replayWindowMs));
  return `request:${user.id}:${rawId}:${source}:${commandFingerprint(command)}:${shortReplayWindow}`;
}

function commandClientSequence(req: Request) {
  return String(
    req.headers["x-ir-tap-sequence"] ||
    req.body?.tap_sequence ||
    req.body?.ir_tap_sequence ||
    req.body?.client_sequence ||
    "",
  ).trim();
}

function isIrProviderAckOnlyDevice(device: any, command: Record<string, any>) {
  const remoteId = String(device?.metadata?.ir_appliance?.remote_id || device?.metadata?.ir_appliance?.profile_id || device?.metadata?.remote_id || "").trim();
  if (!remoteId) return false;
  const family = deviceCommandFamily(device);
  if (family === "ac") return false;
  const type = String((command as any)?.type || "").toLowerCase();
  return family === "tv" || family === "ir" || type === "tv_remote" || type === "ir_remote";
}

function assertContextPayloadMatches(req: Request, scope: DeviceRuntimeScope) {
  const bodyEstate = String(req.body?.estateId || req.body?.estate_id || "").trim();
  const bodyHome = String(req.body?.homeId || req.body?.home_id || "").trim();
  if (bodyEstate && scope.estateId && bodyEstate !== String(scope.estateId)) {
    const error: any = new Error("Command estate context does not match the active session.");
    error.statusCode = 409;
    error.code = "COMMAND_ESTATE_CONTEXT_MISMATCH";
    throw error;
  }
  if (bodyHome && scope.homeId && bodyHome !== String(scope.homeId)) {
    const error: any = new Error("Command home context does not match the active session.");
    error.statusCode = 409;
    error.code = "COMMAND_HOME_CONTEXT_MISMATCH";
    throw error;
  }
  if (!scope.estateId || !scope.homeId) {
    const error: any = new Error("Active home context is required for device control.");
    error.statusCode = 409;
    error.code = "COMMAND_SCOPE_REQUIRED";
    throw error;
  }
}

function assertUnlockConfirmed(req: Request, device: any, command: Record<string, any>) {
  const family = deviceCommandFamily(device);
  if (family !== "lock") return;
  const wantsUnlock =
    command?.lock === false ||
    command?.locked === false ||
    command?.unlock === true ||
    String(command?.state || "").toLowerCase() === "unlocked";
  if (!wantsUnlock) return;
  const confirmed =
    req.body?.confirmed === true ||
    req.body?.confirmation === true ||
    req.body?.meta?.unlock_confirmed === true ||
    req.body?.metadata?.unlock_confirmed === true ||
    req.body?.command?.unlock_confirmed === true;
  if (!confirmed) {
    const error: any = new Error("Unlocking this lock needs confirmation.");
    error.statusCode = 409;
    error.code = "LOCK_UNLOCK_CONFIRMATION_REQUIRED";
    throw error;
  }
}

async function resolveCommandTarget(input: {
  user: AuthUser;
  rawId: string;
  command: Record<string, any>;
  scope?: DeviceRuntimeScope;
}) {
  const deviceRow: any = await resolveVisibleDevice(input.user, input.rawId, input.scope);
  if (!deviceRow) {
    const error: any = new Error("This device is not assigned to your current home.");
    error.statusCode = 403;
    throw error;
  }

  let commandDevice = deviceRow;
  if (deviceRow?.is_virtual && deviceRow?.parent_device_id) {
    const { data: parentDevice, error: parentError } = await supabaseAdmin
      .from("devices")
      .select("*")
      .eq("id", String(deviceRow.parent_device_id))
      .maybeSingle();
    if (parentError) throw new Error(parentError.message);
    if (!parentDevice?.id) {
      const error: any = new Error("Add or sync an appliance profile before using this remote.");
      error.statusCode = 400;
      throw error;
    }
    commandDevice = {
      ...parentDevice,
      name: deviceRow.name,
      type: deviceRow.type,
      category: deviceRow.category,
      room_id: deviceRow.room_id || parentDevice.room_id,
      home_id: deviceRow.home_id || parentDevice.home_id,
      metadata: {
        ...(parentDevice.metadata || {}),
        ...(deviceRow.metadata || {}),
      },
    };
  }

  if (commandDevice?.vendor === "tuya" || commandDevice?.provider === "tuya" || commandDevice?.adapter === "tuya") {
    initAdaptersOnce();
    const adapter = adapterRegistry.get("tuya");
    if (!adapter) {
      const error: any = new Error("The connected device provider is temporarily unavailable.");
      error.statusCode = 503;
      throw error;
    }
  }

  const normalizedCommand = normalizeCommand(input.command, commandDevice);
  assertDeviceCommandSupported(commandDevice, normalizedCommand);
  return {
    deviceRow,
    commandDevice,
    normalizedCommand,
  };
}

export async function executeDeviceCommandForActor(input: {
  actor: AuthUser;
  deviceId: string;
  command: Record<string, any>;
  source?: CommandSource;
  scope?: DeviceRuntimeScope;
  req?: Request;
}) {
  const startedAt = Date.now();
  const rawId = String(input.deviceId || "").trim();
  const command = input.command;
  const user = input.actor;
  const commandSource = commandSourceFor(input.source, user);

  if (!rawId) throw new Error("deviceId is required");
  if (!command) throw new Error("command is required");
  if (!user?.id) throw new Error("Not authenticated");

  const { deviceRow, commandDevice, normalizedCommand } = await resolveCommandTarget({
    user,
    rawId,
    command,
    scope: input.scope,
  });

  const deviceRef = deviceRow?.id || rawId;
  logDeviceCommandDiagnostic("device.command.requested", {
    device_id: rawId,
    matched_device_id: deviceRow?.id,
    home_id: user.home_id,
    estate_id: user.estate_id,
    normalized_online_state: deviceRow ? normalizeDeviceOnlineState(deviceRow).state : "not_found",
    command,
  });
  void emitAuditEvent({
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: "device.command.requested",
    resourceType: "device",
    resourceId: deviceRef,
    estateId: deviceRow?.estate_id || user.estate_id,
    homeId: deviceRow?.home_id || user.home_id,
    status: "success",
    metadata: { command: normalizedCommand, raw_device_ref: rawId, resolved_device_uuid: deviceRow?.id || null, source: commandSource },
    req: input.req,
  } as any);

  if (commandDevice?.vendor === "tuya" && commandDevice?.external_id) {
    initAdaptersOnce();
    const adapter = adapterRegistry.get("tuya");
    if (!adapter) {
      const error: any = new Error("The connected device provider is temporarily unavailable.");
      error.statusCode = 503;
      throw error;
    }

    const normalized = normalizedCommand;
    const providerAckOnly = isIrProviderAckOnlyDevice(commandDevice, normalized);
    const irLane = providerAckOnly ? irCommandLaneKey(commandDevice) : null;
    const irTapSequence = commandClientSequence(input.req as Request);
    const lifecycle = [
      lifecycleStep("pending", "Command received"),
      lifecycleStep("dispatched", "Dispatching to provider"),
    ];
    const dispatchContext = {
      estateId: commandDevice.estate_id,
      homeId: commandDevice.home_id,
      userId: user.id,
      credentials: {},
      device: commandDevice,
      canonicalDevice: deviceRow,
      irTapSequence,
    } as any;
    if (providerAckOnly) {
      logger.info("ir_backend_received", {
        canonical_device_id: deviceRow.id,
        command_device_id: commandDevice.id || null,
        infrared_id: commandDevice.external_id,
        remote_id: commandDevice?.metadata?.ir_appliance?.remote_id || commandDevice?.metadata?.remote_id || null,
        command_key: normalized?.key || normalized?.command_key || normalized?.raw_key || normalized?.type || null,
        tap_sequence: irTapSequence || null,
        client_tap_timestamp: input.req?.body?.client_tap_timestamp || null,
        lane: irLane,
      });
    }
    const providerDispatch = providerAckOnly && irLane
      ? await runInIrCommandLane(irLane, async () => {
        logger.info("ir_provider_dispatch_started", {
          canonical_device_id: deviceRow.id,
          infrared_id: commandDevice.external_id,
          remote_id: commandDevice?.metadata?.ir_appliance?.remote_id || commandDevice?.metadata?.remote_id || null,
          command_key: normalized?.key || normalized?.command_key || normalized?.raw_key || normalized?.type || null,
          tap_sequence: irTapSequence || null,
        });
        return adapter.executeCommand(commandDevice.external_id, normalized, dispatchContext);
      })
      : await adapter.executeCommand(commandDevice.external_id, normalized, dispatchContext);
    lifecycle.push(lifecycleStep("provider_accepted", "Provider accepted"));
    logDeviceCommandDiagnostic("device.command.provider", {
      device_id: rawId,
      matched_device_id: deviceRow.id,
      home_id: deviceRow.home_id,
      estate_id: deviceRow.estate_id,
      normalized_online_state: normalizeDeviceOnlineState(deviceRow).state,
      command: normalized,
      provider_result: "accepted",
    });

    if ((providerDispatch as any)?.confirmation_strategy === "provider_ack_only" || providerAckOnly) {
      const commandOccurredAt = new Date().toISOString();
      const commandSummary = commandSentCopy(String(deviceRow.name || "Device"));
      lifecycle.push(lifecycleStep("provider_ack_only", "Provider acknowledgement only", "This IR command has no reliable observable device-state confirmation."));
      void emitAuditEvent({
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: "device.command.executed",
        resourceType: "device",
        resourceId: deviceRow.id,
        estateId: deviceRow.estate_id,
        homeId: deviceRow.home_id,
        status: "success",
        metadata: {
          command: normalized,
          vendor: deviceRow.vendor,
          external_id: deviceRow.external_id,
          source: commandSource,
          execution_status: "provider_ack_only",
          confirmation_strategy: "provider_ack_only",
          command_lifecycle: lifecycle,
          provider_dispatch: providerDispatch || null,
        },
        req: input.req,
      } as any);
      void recordDeviceEvent({
        deviceId: String(deviceRow.id),
        estateId: deviceRow.estate_id || user.estate_id || null,
        homeId: deviceRow.home_id || user.home_id || null,
        roomId: deviceRow.room_id || null,
        userId: user.id,
        actorId: user.id,
        eventType: "device.command.executed",
        previousState: null,
        newState: { last_command: normalized, confirmation_strategy: "provider_ack_only" },
        source: commandSource,
        confidence: "confirmed",
        latencyMs: Date.now() - startedAt,
        metadata: {
          command: normalized,
          vendor: deviceRow.vendor,
          external_id: deviceRow.external_id,
          control_profile: summarizeDeviceFrontendContract(deviceRow).control_profile,
          device_family: summarizeDeviceFrontendContract(deviceRow).device_family,
          execution_status: "provider_ack_only",
          confirmation_strategy: "provider_ack_only",
          command_lifecycle: lifecycle,
          private_projection: true,
        },
        title: commandSummary.title,
        summary: commandSummary.message,
      });
      return {
        ok: true,
        accepted: true,
        dispatched: true,
        status: "command_dispatched",
        execution_status: "provider_ack_only",
        confirmation_strategy: "provider_ack_only",
        device: { id: deviceRow.id, name: deviceRow.name, external_id: commandDevice.external_id, vendor: commandDevice.vendor },
        command: normalized,
        command_lifecycle: lifecycle,
        provider: (providerDispatch as any)?.provider || "tuya",
        provider_latency_ms: (providerDispatch as any)?.latency_ms ?? null,
        message: commandSummary.message,
      };
    }

    const previousRuntime = await deviceRuntimeStateService.getOrHydrate(deviceRow);
    const previousState = previousRuntime?.state || null;
    const commandOccurredAt = new Date().toISOString();
    const pendingState: Record<string, any> = {
      ...(previousState || enrichDeviceProviderState({
        state: {},
        metadata: deviceRow?.metadata || {},
        device: deviceRow,
        provider: String(commandDevice?.provider || commandDevice?.vendor || "tuya"),
        adapter: String(commandDevice?.adapter || commandDevice?.vendor || "tuya"),
      })),
      last_command: normalized,
      _oyi_pending_command: {
        command: normalized,
        source: commandSource,
        provider_accepted_at: commandOccurredAt,
        confirmation: "pending",
      },
      _oyi_timeline: {
        ...((previousState as any)?._oyi_timeline || {}),
        received_at: commandOccurredAt,
        provider_reported_at: previousRuntime?.provider_timestamp || null,
        source: commandSource,
      },
    };
    const persistedState = pendingState;
    const pendingRuntime = deviceRuntimeStateService.set(deviceRow, persistedState, {
      providerTimestamp: previousRuntime?.provider_timestamp || null,
      runtimeTimestamp: commandOccurredAt,
      lastRefresh: previousRuntime?.last_refresh || commandOccurredAt,
      providerLatencyMs: previousRuntime?.provider_latency_ms || null,
      dirty: true,
    });
    const runtimeSummary = pendingRuntime.summary;
    const commandStatus = "partial_confirmation" as const;
    const commandSummary = pendingConfirmationCopy(String(deviceRow.name || "Device"));
    lifecycle.push(lifecycleStep("partial_confirmation", "State confirmation pending", "The provider accepted the command. Oyi will confirm the device state in the background."));
    deviceRuntimeStateService.scheduleRefresh({
      ...commandDevice,
      id: deviceRow.id,
      parent_device_id: deviceRow.parent_device_id || null,
      is_virtual: Boolean(deviceRow.is_virtual),
    }, {
      priority: "high",
      reason: `command_${commandSource}`,
      delayMs: 900,
    });

    await NotificationService.sendToUser(String(user.id), {
      title: commandSummary.title,
      message: commandSummary.message,
        type: "device",
        payload: {
          device_id: String(deviceRow.id),
          external_id: String(deviceRow.external_id || ""),
          estate_id: String(deviceRow.estate_id || ""),
          home_id: String(deviceRow.home_id || ""),
          command: normalized,
          kind: "device.command.requested",
          source: commandSource,
          state: persistedState,
          health_status: runtimeSummary.health_status,
          primary_state: runtimeSummary.primary_state,
          execution_status: commandStatus,
          command_lifecycle: lifecycle,
        },
        entityId: String(deviceRow.id),
      });
    void emitAuditEvent({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: "device.command.provider_accepted",
      resourceType: "device",
      resourceId: deviceRow.id,
      estateId: deviceRow.estate_id,
      homeId: deviceRow.home_id,
      status: "success",
      metadata: { command: normalized, vendor: deviceRow.vendor, external_id: deviceRow.external_id, source: commandSource, execution_status: commandStatus, command_lifecycle: lifecycle },
      req: input.req,
    } as any);
    void recordDeviceEvent({
      deviceId: String(deviceRow.id),
      estateId: deviceRow.estate_id || user.estate_id || null,
      homeId: deviceRow.home_id || user.home_id || null,
      roomId: deviceRow.room_id || null,
      userId: user.id,
      actorId: user.id,
      eventType: "device.command.requested",
      previousState,
      newState: persistedState,
      source: commandSource,
      confidence: "confirmed",
      latencyMs: Date.now() - startedAt,
      metadata: {
        command: normalized,
        vendor: deviceRow.vendor,
        external_id: deviceRow.external_id,
        control_profile: runtimeSummary.control_profile,
        device_family: runtimeSummary.device_family,
        primary_state: runtimeSummary.primary_state,
        health_status: runtimeSummary.health_status,
        execution_status: commandStatus,
        command_lifecycle: lifecycle,
      },
      title: commandSummary.title,
      summary: commandSummary.message,
    });

    await emitOperationalDeviceSignal({
      eventType: "device.command.requested",
      source: commandSource,
      provider: String(deviceRow?.provider || deviceRow?.vendor || "tuya"),
      adapter: String(deviceRow?.adapter || deviceRow?.vendor || "tuya"),
      estateId: deviceRow?.estate_id || user.estate_id || null,
      homeId: deviceRow?.home_id || user.home_id || null,
      roomId: deviceRow?.room_id || null,
      device: {
        id: String(deviceRow.id),
        name: String(deviceRow.name || "Device"),
        type: String(deviceRow.type || ""),
        category: String(deviceRow.category || ""),
        external_id: String(deviceRow.external_id || ""),
        vendor: String(deviceRow.vendor || ""),
        adapter: String(deviceRow.adapter || deviceRow.vendor || "tuya"),
        provider: String(deviceRow.provider || deviceRow.vendor || "tuya"),
        metadata: commandDevice.metadata || {},
      },
      previousState,
      newState: persistedState,
      command: normalized,
      actor: {
        id: user.id,
        role: user.role,
        name: user.username || user.email || null,
        type: commandSource === "facility" ? "operator" : "resident",
      },
      occurredAt: commandOccurredAt,
      telemetrySummary: {
        ...(persistedState.telemetry_summary || {}),
        changed_keys: Object.keys(normalized || {}),
        changed_count: Object.keys(normalized || {}).length,
      },
      extraMetadata: {
        request_path: input.req?.path || null,
        latency_ms: Date.now() - startedAt,
        primary_state: runtimeSummary.primary_state,
        health_status: runtimeSummary.health_status,
        supported_controls: runtimeSummary.supported_controls,
        capability_codes: runtimeSummary.capability_codes,
        execution_status: commandStatus,
        command_lifecycle: lifecycle,
      },
    });

    return {
      ok: true,
      status: "command_partial_confirmation",
      execution_status: commandStatus,
      device: { id: deviceRow.id, name: deviceRow.name, external_id: commandDevice.external_id, vendor: commandDevice.vendor },
      command: normalized,
      state: persistedState,
      command_lifecycle: lifecycle,
      message: commandSummary.message,
    };
  }

  void recordDeviceEvent({
    deviceId: String(deviceRow.id),
    estateId: deviceRow.estate_id || user.estate_id || null,
    homeId: deviceRow.home_id || user.home_id || null,
    roomId: deviceRow.room_id || null,
    userId: user.id,
    actorId: user.id,
    eventType: "device.command.queued",
    previousState: null,
    newState: { last_command: command },
    source: commandSource,
    confidence: "confirmed",
    latencyMs: Date.now() - startedAt,
    metadata: { command, vendor: deviceRow.vendor, external_id: deviceRow.external_id },
    title: `${String(deviceRow.name || "Device")} command queued`,
    summary: `${String(deviceRow.name || "Device")} command was queued.`,
  });

  return {
    ok: true,
    status: "command_queued",
    device: { id: deviceRow.id, name: deviceRow.name, external_id: deviceRow.external_id, vendor: deviceRow.vendor },
  };
}

async function emitDeviceCommandFailure(input: {
  req: Request;
  user: AuthUser;
  rawId: string;
  command: Record<string, any> | null;
  source: CommandSource;
  error: any;
}) {
  try {
    await NotificationService.sendToUser(String(input.user.id), {
      title: "Device command failed",
      message: "We could not complete your device command.",
      type: "device",
      payload: {
        device_ref: input.rawId || null,
        command: input.command || null,
        error: input.error?.message || String(input.error),
        kind: "device.command.failed",
      },
      entityId: input.rawId || undefined,
    });
  } catch {}

  const device = await resolveVisibleDevice(input.user, input.rawId, {
    estateId: (input.req as any).oisContext?.estate_id || input.user.estate_id || null,
    homeId: (input.req as any).oisContext?.home_id || input.user.home_id || null,
  }).catch(() => null);

  if (!device?.id) return;

  await emitOperationalDeviceSignal({
    eventType: "device.command.failed",
    source: input.source,
    provider: String(device?.provider || device?.vendor || "device_adapter"),
    adapter: String(device?.adapter || device?.vendor || "device_adapter"),
    estateId: device?.estate_id || input.user.estate_id || null,
    homeId: device?.home_id || input.user.home_id || null,
    roomId: device?.room_id || null,
    device: {
      id: String(device.id),
      name: String(device.name || "Device"),
      type: String(device.type || ""),
      category: String(device.category || ""),
      external_id: String(device.external_id || ""),
      vendor: String(device.vendor || ""),
      adapter: String(device.adapter || device.vendor || "device_adapter"),
      provider: String(device.provider || device.vendor || "device_adapter"),
      metadata: device.metadata || {},
    },
    previousState: null,
    newState: null,
    command: input.command || null,
    actor: {
      id: input.user.id,
      role: input.user.role,
      name: input.user.username || input.user.email || null,
      type: /facility|operator|admin|security|maintenance/.test(String(input.user.role || "").toLowerCase()) ? "operator" : "resident",
    },
    occurredAt: new Date().toISOString(),
    extraMetadata: {
      error: input.error?.message || String(input.error),
      request_path: input.req.path,
    },
  });
}

export async function requestDeviceCommand(req: Request, res: Response) {
  try {
    const rawId = String(req.params.deviceId || "").trim();
    const command = req.body?.command;

    if (!rawId) return res.status(400).json({ error: "deviceId is required" });
    if (!command) return res.status(400).json({ error: "command is required" });

    const user = (req as any).user as AuthUser | undefined;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    const source = commandSourceFor(req.body?.source || req.body?.command_source, user);
    const scope = {
      estateId: (req as any).oisContext?.estate_id || user.estate_id || null,
      homeId: (req as any).oisContext?.home_id || user.home_id || null,
    };
    assertContextPayloadMatches(req, scope);
    logger.info("ir_request_created", {
      canonical_device_id: rawId,
      command_key: command?.key || command?.command_key || command?.raw_key || command?.type || null,
      tap_sequence: commandClientSequence(req) || null,
      client_tap_timestamp: req.body?.client_tap_timestamp || null,
      estate_id: scope.estateId,
      home_id: scope.homeId,
    });
    const target = await resolveCommandTarget({
      user,
      rawId,
      command,
      scope,
    });
    assertUnlockConfirmed(req, target.commandDevice, target.normalizedCommand);
    const providerAckOnly = isIrProviderAckOnlyDevice(target.commandDevice, target.normalizedCommand);
    const key = commandIdempotencyKey(req, user, rawId, target.normalizedCommand, source, providerAckOnly ? 350 : 5_000);
    pruneCommandAcceptances();
    const existing = commandAcceptances.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      return res.status(providerAckOnly ? 200 : 202).json({ ...existing.response, duplicate: true });
    }

    if (providerAckOnly) {
      const result = await executeDeviceCommandForActor({
        actor: user,
        deviceId: rawId,
        command: target.normalizedCommand,
        source,
        scope,
        req,
      });
      const response = {
        ...result,
        idempotency_key: key,
      };
      commandAcceptances.set(key, { expiresAt: Date.now() + COMMAND_ACCEPTANCE_TTL_MS, response });
      logger.info("ir_response_sent", {
        canonical_device_id: target.deviceRow.id,
        infrared_id: target.commandDevice.external_id || null,
        remote_id: target.commandDevice?.metadata?.ir_appliance?.remote_id || target.commandDevice?.metadata?.remote_id || null,
        command_key: target.normalizedCommand?.key || target.normalizedCommand?.command_key || target.normalizedCommand?.raw_key || target.normalizedCommand?.type || null,
        tap_sequence: commandClientSequence(req) || null,
        accepted: response.accepted,
        dispatched: response.dispatched,
        confirmation_strategy: response.confirmation_strategy,
        provider_latency_ms: response.provider_latency_ms ?? null,
      });
      return res.status(200).json(response);
    }

    const response = {
      ok: true,
      accepted: true,
      status: "command_accepted",
      execution_status: "pending",
      idempotency_key: key,
      device: {
        id: target.deviceRow.id,
        name: target.deviceRow.name,
        external_id: target.commandDevice.external_id,
        vendor: target.commandDevice.vendor,
      },
      command: target.normalizedCommand,
      message: `${String(target.deviceRow.name || "Device")} command accepted. Oyi will confirm the device state in the background.`,
    };
    commandAcceptances.set(key, { expiresAt: Date.now() + COMMAND_ACCEPTANCE_TTL_MS, response });

    void executeDeviceCommandForActor({
      actor: user,
      deviceId: rawId,
      command: target.normalizedCommand,
      source,
      scope,
      req,
    }).catch((error) => {
      logger.error("device_command_background_execution_failed", {
        error,
        device_id: rawId,
        actor_id: user.id,
        estate_id: scope.estateId,
        home_id: scope.homeId,
        idempotency_key: key,
      });
      void emitDeviceCommandFailure({ req, user, rawId, command: target.normalizedCommand, source, error }).catch((signalError) => {
        logger.error("device_command_background_failure_signal_failed", { error: signalError, device_id: rawId, actor_id: user.id });
      });
    });

    return res.status(202).json(response);
  } catch (e: any) {
    logger.warn("request_device_command_rejected", { error: e, device_id: req.params.deviceId || null, actor_id: (req as any).user?.id || null });
    const user = (req as any).user;
    const rawId = String(req.params.deviceId || "").trim();
    if (user?.id) {
      try {
        await emitDeviceCommandFailure({
          req,
          user,
          rawId,
          command: req.body?.command || null,
          source: commandSourceFor(req.body?.source || req.body?.command_source, user),
          error: e,
        });
      } catch {}
    }
    const message = String(e?.message || e || "");
    const statusCode = Number(e?.statusCode || 500);
    let error = "Command failed";
    let details = message || "The device command could not complete.";
    if (/not assigned to your current home/i.test(message)) {
      error = "This device is not assigned to your current home.";
      details = error;
    } else if (/does not support switch control|does not expose|does not support remote|mapping/i.test(message)) {
      error = "This device does not expose that control.";
      details = error;
    } else if (/appliance profile/i.test(message)) {
      error = "Add or sync an appliance profile before using this remote.";
      details = error;
    } else if (/adapter not registered|temporarily unavailable/i.test(message)) {
      error = "The connected device provider is temporarily unavailable.";
      details = error;
    }
    return res.status(statusCode).json({
      ok: false,
      accepted: false,
      status: "rejected",
      reason: e?.code || (statusCode === 403 ? "permission_denied" : statusCode === 409 ? "context_conflict" : statusCode === 422 ? "capability_mapping_missing" : "command_rejected"),
      execution_id: null,
      error,
      details,
    });
  }
}
