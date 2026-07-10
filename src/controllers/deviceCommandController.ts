// src/controllers/deviceCommandController.ts
import { Request, Response } from "express";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { adapterRegistry } from "../device/adapters/registry";
import { initAdaptersOnce } from "../device/adapters/initAdapters";
import { NotificationService } from "../services/NotificationService";
import { emitAuditEvent } from "../core/foundation";
import { getIO } from "../realtime/io";
import type { AuthUser } from "../middleware/auth";
import { type DeviceRuntimeScope, logDeviceCommandDiagnostic, normalizeDeviceOnlineState, resolveVisibleDevice } from "../services/deviceRuntimeService";
import { recordDeviceEvent } from "../services/deviceAnalyticsService";
import { publishSourceIntelligenceEvent } from "../intelligence-core";
import { emitOperationalDeviceSignal } from "../services/deviceOperationalSignalService";
import { enrichDeviceProviderState, summarizeDeviceFrontendContract } from "../device/runtime/deviceStateEnrichment";

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
  const text = textFromDevice(device);
  const summary = summarizeDeviceFrontendContract(device || {});
  const profile = String(summary.control_profile || "").toLowerCase();
  const controls = Array.isArray(summary.supported_controls) ? summary.supported_controls.map((item) => String(item).toLowerCase()) : [];
  if (profile === "camera" || /\b(camera|cctv|ipc|ipcamera|nvr|dvr|onvif|rtsp)\b/.test(text)) return "camera";
  if (profile === "switch" || profile === "plug" || controls.includes("power")) return "switch";
  if (profile === "climate" || controls.includes("temperature") || /\b(ac|a\/c|air conditioner|air_conditioner|aircon|hvac|climate|thermostat|kt)\b/.test(text)) return "ac";
  if (profile === "tv" || /\b(tv|television|smart tv|android tv|google tv|samsung tv|lg tv|hisense tv|tcl|set top|set_top_box|decoder|stb)\b/.test(text)) return "tv";
  if (profile === "ir_remote" || controls.includes("remote") || /\b(ir|infrared|remote|remote control|remote_control|universal remote|universal_remote|wnykq)\b/.test(text)) return "ir";
  return "unknown";
}

function commandKeys(command: any) {
  if (Array.isArray(command?.commands)) return command.commands.map((item: any) => String(item?.code || "").toLowerCase()).filter(Boolean);
  return Object.keys(command || {}).map((key) => key.toLowerCase());
}

function isSwitchPayload(command: Record<string, any>) {
  const keys = commandKeys(command);
  return keys.some((key: string) => key === "switch" || key === "on" || key === "state" || key === "power" || /^switch_\d+$/i.test(key));
}

function isTvPayload(command: Record<string, any>) {
  const type = String((command as any)?.type || "").toLowerCase();
  const keys = commandKeys(command);
  return type === "tv_remote" || keys.some((key: string) => /^(ir_code|remote_key|key_code|control|command_key|key)$/.test(key));
}

function isAcPayload(command: Record<string, any>) {
  const type = String((command as any)?.type || "").toLowerCase();
  const keys = commandKeys(command);
  return type === "ac_remote" || keys.some((key: string) => /temp|temperature|mode|fan|swing|wind|power/.test(key));
}

function assertDeviceCommandSupported(device: any, command: Record<string, any>) {
  const family = deviceCommandFamily(device);
  const switchPayload = isSwitchPayload(command);

  if (family === "switch") return;
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
  // ✅ allow command to be:
  // { switch: true } OR { commands: [{code,value}] } OR { on: true }
  const c = input ?? {};

  // If they mistakenly send { commands: [...] } from frontend
  if (Array.isArray(c.commands)) {
    const out: Record<string, any> = {};
    for (const item of c.commands) {
      if (item?.code) out[String(item.code)] = item.value;
    }
    return out;
  }

  // Common aliases → Tuya DP codes (best-effort)
  const family = device ? deviceCommandFamily(device) : "switch";
  if (family === "switch" && typeof c.on === "boolean" && c.switch === undefined) return { switch: c.on };
  if (family === "switch" && typeof c.power === "boolean" && c.switch === undefined) return { switch: c.power };

  return c;
}

function pickExpectedState(command: Record<string, any>) {
  if (typeof command?.switch === "boolean") return { key: "switch", value: command.switch };
  if (typeof command?.power === "boolean") return { key: "power", value: command.power };
  if (typeof command?.on === "boolean") return { key: "on", value: command.on };
  return null;
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

function emitDeviceStateUpdate(args: {
  device: any;
  state: Record<string, any>;
  source: CommandSource;
}) {
  const io = getIO();
  if (!io || !args.device?.id) return;
  const payload = {
    deviceId: String(args.device.id),
    device_id: String(args.device.id),
    external_device_id: args.device.external_id || null,
    estate_id: args.device.estate_id || null,
    estateId: args.device.estate_id || null,
    home_id: args.device.home_id || null,
    homeId: args.device.home_id || null,
    room_id: args.device.room_id || null,
    roomId: args.device.room_id || null,
    state: args.state,
    source: args.source,
    occurred_at: new Date().toISOString(),
  };
  let target = io.to(`device:${args.device.id}`);
  if (args.device.estate_id) target = target.to(`estate:${args.device.estate_id}`);
  if (args.device.home_id) target = target.to(`home:${args.device.home_id}`);
  target.emit("device:update", payload);
  target.emit("device.status.updated", payload);
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

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

  const deviceRow: any = await resolveVisibleDevice(user, rawId, input.scope);

  const deviceRef = deviceRow?.id || rawId;
  logDeviceCommandDiagnostic("device.command.requested", {
    device_id: rawId,
    matched_device_id: deviceRow?.id,
    home_id: user.home_id,
    estate_id: user.estate_id,
    normalized_online_state: deviceRow ? normalizeDeviceOnlineState(deviceRow).state : "not_found",
    command,
  });

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

  await handleSignal({
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    source: "user",
    type: "device.command.requested",
    timestamp: new Date().toISOString(),
    deviceId: deviceRef,
    command,
    requestedBy: {
      userId: user.id,
      role: user.role,
    },
    metadata: {
      raw_device_ref: rawId,
      resolved_device_uuid: deviceRow?.id || null,
      source: commandSource,
      command_source: commandSource,
      estate_id: deviceRow?.estate_id || user.estate_id || null,
      home_id: deviceRow?.home_id || user.home_id || null,
      room_id: deviceRow?.room_id || null,
      external_id: deviceRow?.external_id || null,
      device_name: deviceRow?.name || null,
      device_type: deviceRow?.type || null,
      device_category: deviceRow?.category || null,
      adapter: deviceRow?.adapter || deviceRow?.vendor || "device_adapter",
      provider: deviceRow?.provider || deviceRow?.vendor || null,
    },
  });
  void publishSourceIntelligenceEvent({
    source: commandSource === "facility" ? "facility" : "consumer",
    surface: commandSource === "facility" ? "facility" : "consumer",
    event_type: "device.command.requested",
    category: "device",
    estate_id: deviceRow?.estate_id || user.estate_id || null,
    home_id: deviceRow?.home_id || user.home_id || null,
    actor_id: user.id,
    entity_type: "device",
    entity_id: String(deviceRef),
    entity_label: String(deviceRow?.name || "Device"),
    severity: "info",
    title: `${String(deviceRow?.name || "Device")} command requested`,
    summary: "A confirmed device command is ready for execution.",
    payload: { command, source: commandSource },
  }, { source_table: "device_command_requests", source_event_id: `${deviceRef}:${Date.now()}` });
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
    metadata: { command, raw_device_ref: rawId, resolved_device_uuid: deviceRow?.id || null, source: commandSource },
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

    assertDeviceCommandSupported(commandDevice, command);
    const normalized = normalizeCommand(command, commandDevice);
    await adapter.executeCommand(commandDevice.external_id, normalized, {
      estateId: commandDevice.estate_id,
      homeId: commandDevice.home_id,
      userId: user.id,
      credentials: {},
    } as any);
    logDeviceCommandDiagnostic("device.command.provider", {
      device_id: rawId,
      matched_device_id: deviceRow.id,
      home_id: deviceRow.home_id,
      estate_id: deviceRow.estate_id,
      normalized_online_state: normalizeDeviceOnlineState(deviceRow).state,
      command: normalized,
      provider_result: "accepted",
    });

    let verifiedState: Record<string, any> | null = null;
    const expected = pickExpectedState(normalized);
    if (typeof (adapter as any).getLiveState === "function") {
      await delay(900);
      try {
        verifiedState = await (adapter as any).getLiveState(commandDevice.external_id);
      } catch {}
      if (expected && verifiedState && expected.key in verifiedState) {
        const actual = Boolean((verifiedState as any)[expected.key]);
        if (actual !== Boolean(expected.value)) {
          const error = new Error("Device did not confirm the requested state change");
          (error as any).status = "command_unverified";
          throw error;
        }
      }
    }

    const previousStateRow = await supabaseAdmin
      .from("device_states")
      .select("status")
      .eq("device_id", deviceRow.id)
      .maybeSingle();
    const previousState = (previousStateRow.data as any)?.status || null;
    const commandOccurredAt = new Date().toISOString();
    const persistedState = enrichDeviceProviderState({
      state: {
        ...(verifiedState || normalized || {}),
        last_command: normalized,
        _oyi_timeline: {
          received_at: commandOccurredAt,
          provider_reported_at: null,
          source: commandSource,
        },
      },
      metadata: commandDevice?.metadata || {},
      device: {
        category: commandDevice?.category,
        type: commandDevice?.type,
        name: commandDevice?.name,
        provider: commandDevice?.provider || commandDevice?.vendor || "tuya",
        adapter: commandDevice?.adapter || commandDevice?.vendor || "tuya",
      },
      provider: String(commandDevice?.provider || commandDevice?.vendor || "tuya"),
      adapter: String(commandDevice?.adapter || commandDevice?.vendor || "tuya"),
    });
    const runtimeSummary = summarizeDeviceFrontendContract(deviceRow || {}, {
      status: persistedState,
      last_seen: commandOccurredAt,
      updated_at: commandOccurredAt,
    });
    await supabaseAdmin
      .from("device_states")
      .upsert(
        {
          device_id: deviceRow.id,
          status: persistedState,
          last_seen: commandOccurredAt,
        } as any,
        { onConflict: "device_id" } as any
      );
    emitDeviceStateUpdate({ device: deviceRow, state: persistedState, source: commandSource });

    const activityCopy = describeDeviceCommand(deviceRow.name, normalized);
    await NotificationService.sendToUser(String(user.id), {
      title: activityCopy.title,
      message: activityCopy.message,
        type: "device",
        payload: {
          device_id: String(deviceRow.id),
          external_id: String(deviceRow.external_id || ""),
          estate_id: String(deviceRow.estate_id || ""),
          home_id: String(deviceRow.home_id || ""),
          command: normalized,
          kind: "device.command.executed",
          source: commandSource,
          state: persistedState,
          health_status: runtimeSummary.health_status,
          primary_state: runtimeSummary.primary_state,
        },
        entityId: String(deviceRow.id),
      });
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
      metadata: { command: normalized, vendor: deviceRow.vendor, external_id: deviceRow.external_id, source: commandSource },
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
      },
      title: activityCopy.title,
      summary: activityCopy.message,
    });

    await emitOperationalDeviceSignal({
      eventType: "device.command.executed",
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
      },
    });

    return {
      ok: true,
      status: "command_executed",
      device: { id: deviceRow.id, name: deviceRow.name, external_id: commandDevice.external_id, vendor: commandDevice.vendor },
      command: normalized,
      state: persistedState,
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

export async function requestDeviceCommand(req: Request, res: Response) {
  try {
    const rawId = String(req.params.deviceId || "").trim();
    const command = req.body?.command;

    if (!rawId) return res.status(400).json({ error: "deviceId is required" });
    if (!command) return res.status(400).json({ error: "command is required" });

    const user = (req as any).user as AuthUser | undefined;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    const result = await executeDeviceCommandForActor({
      actor: user,
      deviceId: rawId,
      command,
      source: commandSourceFor(req.body?.source || req.body?.command_source, user),
      scope: {
        estateId: (req as any).oisContext?.estate_id || user.estate_id || null,
        homeId: (req as any).oisContext?.home_id || user.home_id || null,
      },
      req,
    });

    return res.status(result.status === "command_queued" ? 202 : 200).json(result);
  } catch (e: any) {
    console.error("requestDeviceCommand error:", e?.message || e);
    const user = (req as any).user;
    const rawId = String(req.params.deviceId || "").trim();
    const device = user?.id
      ? await resolveVisibleDevice(user, rawId, {
          estateId: (req as any).oisContext?.estate_id || user.estate_id || null,
          homeId: (req as any).oisContext?.home_id || user.home_id || null,
        }).catch(() => null)
      : null;
    if (user?.id) {
      try {
        await NotificationService.sendToUser(String(user.id), {
          title: "Device command failed",
          message: "We could not execute your device command.",
          type: "device",
          payload: {
            device_ref: rawId || null,
            command: req.body?.command || null,
            error: e?.message || String(e),
            kind: "device.command.failed",
          },
          entityId: rawId || undefined,
        });
      } catch {}
      if (device?.id) {
        await emitOperationalDeviceSignal({
          eventType: "device.command.failed",
          source: commandSourceFor(req.body?.source || req.body?.command_source, user),
          provider: String(device?.provider || device?.vendor || "device_adapter"),
          adapter: String(device?.adapter || device?.vendor || "device_adapter"),
          estateId: device?.estate_id || user.estate_id || null,
          homeId: device?.home_id || user.home_id || null,
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
          command: req.body?.command || null,
          actor: {
            id: user.id,
            role: user.role,
            name: user.username || user.email || null,
            type: /facility|operator|admin|security|maintenance/.test(String(user.role || "").toLowerCase()) ? "operator" : "resident",
          },
          occurredAt: new Date().toISOString(),
          extraMetadata: {
            error: e?.message || String(e),
            request_path: req.path,
          },
        });
      }
    }
    const message = String(e?.message || e || "");
    const statusCode = Number(e?.statusCode || 500);
    let error = "Command failed";
    let details = message || "The device command could not complete.";
    if (/not assigned to your current home/i.test(message)) {
      error = "This device is not assigned to your current home.";
      details = error;
    } else if (/does not support switch control|does not expose/i.test(message)) {
      error = "This device does not expose that control.";
      details = error;
    } else if (/appliance profile/i.test(message)) {
      error = "Add or sync an appliance profile before using this remote.";
      details = error;
    } else if (/adapter not registered|temporarily unavailable/i.test(message)) {
      error = "The connected device provider is temporarily unavailable.";
      details = error;
    }
    return res.status(statusCode).json({ error, details });
  }
}
