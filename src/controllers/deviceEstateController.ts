// src/controllers/deviceEstateController.ts
import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { summarizeDeviceFrontendContract } from "../device/runtime/deviceStateEnrichment";
import { logger } from "../observability/logger";
import { sendPublicApiError } from "../services/publicApi";
import { deviceReadScopeCache } from "../services/deviceReadScopeCache";
import { isTechnicalDeviceHiddenFromResidents } from "../services/deviceInventoryVisibility";

function cleanText(value: any, fallback: string | null = null) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safeArray(value: any) {
  return Array.isArray(value) ? value : [];
}

function flattenCapabilityCodes(value: any): string[] {
  const out: string[] = [];
  const visit = (entry: any) => {
    if (entry == null) return;
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      out.push(String(entry).toLowerCase());
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (typeof entry === "object") {
      ["code", "id", "name", "label", "type", "function", "dp_code"].forEach((key) => {
        if ((entry as any)[key] != null) out.push(String((entry as any)[key]).toLowerCase());
      });
      Object.entries(entry).forEach(([key, nested]) => {
        out.push(String(key).toLowerCase());
        if (typeof nested === "object") visit(nested);
        else if (typeof nested === "string" || typeof nested === "number" || typeof nested === "boolean") out.push(String(nested).toLowerCase());
      });
    }
  };
  visit(value);
  return Array.from(new Set(out.map((item) => item.replace(/\s+/g, "_")).filter(Boolean)));
}

function includesAny(values: string[], patterns: RegExp[]) {
  return values.some((value) => patterns.some((pattern) => pattern.test(value)));
}

function buildUiCapabilities(device: any, metadata: any) {
  const summary = summarizeDeviceFrontendContract({ ...device, metadata });
  const values = flattenCapabilityCodes([
    device?.capabilities,
    metadata?.capabilities,
    metadata?.functions,
    metadata?.status,
    metadata?.raw?.functions,
    metadata?.raw?.status,
    metadata?.raw?.dps,
    metadata?.tuya?.functions,
    metadata?.tuya?.status,
    device?.category,
    device?.type,
    device?.name,
  ]);
  const text = values.join(" ");
  const category = String(device?.category || device?.type || "").toLowerCase();
  const identityText = [
    device?.category,
    device?.type,
    device?.name,
    metadata?.category,
    metadata?.type,
    metadata?.product_name,
    metadata?.productName,
    metadata?.model,
    metadata?.remote_type,
    metadata?.remoteType,
    metadata?.ir_profile,
    metadata?.irProfile,
    metadata?.raw?.category,
    metadata?.raw?.product_name,
    metadata?.raw?.model,
  ].map((item) => String(item || "").toLowerCase()).join(" ");
  const isCamera = /(^| )(camera|cctv|ipc|ipcamera|nvr|dvr|onvif|rtsp)( |$)/.test(`${category} ${identityText}`);
  const isCapabilitySwitch = Array.isArray(summary.supported_controls) && summary.supported_controls.includes("power");
  const isExplicitSwitch = summary.control_profile === "switch" || summary.device_family === "switch" || summary.device_family === "plug";
  const isSimplePower = /(^| )(light|switch|plug|socket|outlet|relay)( |$)/.test(`${category} ${identityText}`);
  const hasSwitchIdentity = isCapabilitySwitch || isExplicitSwitch || isSimplePower;
  const isAc = !hasSwitchIdentity && (summary.control_profile === "climate" || summary.device_family === "climate" || /(^| )(ac|a\/c|air_conditioner|aircon|hvac|climate|thermostat|kt)( |$)/.test(`${category} ${identityText}`));
  const isTv = summary.control_profile === "tv" || (!hasSwitchIdentity && /(^| )(tv|television|smart_tv|android_tv|google_tv|samsung_tv|lg_tv|hisense_tv|tcl|set_top|set_top_box|decoder|stb)( |$)/.test(`${category} ${identityText}`));
  const isIrRemote = summary.control_profile === "ir_remote" || (!hasSwitchIdentity && /(^| )(ir|infrared|remote|remote_control|universal_remote|wnykq)( |$)/.test(`${category} ${identityText}`));

  const switchable =
    !isCamera &&
    !isTv &&
    !isIrRemote &&
    (includesAny(values, [/^switch(_\d+)?$/, /^switch_led$/, /^power$/, /^on$/, /^on_off$/, /^relay/]) ||
      isCapabilitySwitch ||
      isSimplePower);
  const timer = includesAny(values, [/timer/, /countdown/, /count_down/]);
  const schedule = includesAny(values, [/schedule/, /timer_schedule/]);
  const cycle = includesAny(values, [/cycle/, /loop/]);
  const inching = includesAny(values, [/inching/, /jog/]);
  const temperature = includesAny(values, [/temp/, /temperature/, /temp_set/, /temp_current/]) || isAc;
  const fan = includesAny(values, [/fan/, /windspeed/, /wind_speed/]) || /fan/.test(`${category} ${text}`);
  const swing = includesAny(values, [/swing/, /shake/, /oscillat/]);
  const tvRemote = isTv;
  const acRemote = isAc;

  const tvControls = [
    includesAny(values, [/power/]) && "power",
    includesAny(values, [/mute/]) && "mute",
    includesAny(values, [/volume/, /vol_up/, /vol_down/]) && "volume",
    includesAny(values, [/channel/, /ch_up/, /ch_down/]) && "channel",
    includesAny(values, [/input/, /source/]) && "input",
    includesAny(values, [/menu/]) && "menu",
    includesAny(values, [/back/, /return/]) && "back",
    includesAny(values, [/ok/, /enter/]) && "ok",
    includesAny(values, [/up|down|left|right|dpad/]) && "dpad",
    includesAny(values, [/number|digit|num_/]) && "number_pad",
  ].filter(Boolean) as string[];

  const acControls = [
    includesAny(values, [/power/]) && "power",
    includesAny(values, [/mode/]) && "mode",
    temperature && "temperature",
    fan && "fan",
    swing && "swing",
    timer && "timer",
  ].filter(Boolean) as string[];

  const supportedCommands = [
    switchable && "switch",
    timer && "timer",
    schedule && "schedule",
    cycle && "cycle",
    inching && "inching",
    temperature && "temperature",
    fan && "fan",
    swing && "swing",
    tvRemote && tvControls.length && "tv_remote",
    acRemote && acControls.length && "ac_remote",
  ].filter(Boolean) as string[];

  return {
    kind: isCamera ? "camera" : switchable ? "switch" : tvRemote ? "tv_remote" : acRemote ? "ac_remote" : isIrRemote ? "ir_remote" : category || "device",
    can_switch: switchable,
    timer,
    schedule,
    cycle,
    inching,
    remote: {
      tv: tvControls,
      ac: acControls,
    },
    supported_commands: Array.from(new Set(supportedCommands)),
    source: values.length ? "registry_capabilities" : "category_only",
  };
}

function sanitizeMetadata(value: any, depth = 0): any {
  if (value == null || depth > 4) return {};
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeMetadata(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(pass(word)?|secret|token|credential|access[_-]?id|access[_-]?secret|api[_-]?key|private[_-]?key)/i.test(key))
      .map(([key, nested]) => [key, nested && typeof nested === "object" ? sanitizeMetadata(nested, depth + 1) : nested])
  );
}

function isDeviceSchemaMismatch(error: any) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("column devices.parent_device_id does not exist") ||
    message.includes("column devices.is_virtual does not exist")
  );
}

export async function getEstateDevices(req: Request, res: Response) {
  const user: any = (req as any).user;
  const context: any = (req as any).oisContext || null;
  const activeHomeId = String(context?.home_id || user?.home_id || "").trim();
  try {
    const estateIdParam = String(req.params.estateId || "").trim();
    const activeEstateId = String(context?.estate_id || user?.estate_id || "").trim();

    if (!activeEstateId) return res.status(400).json({ error: "Active estate context is required" });

    // ✅ enforce: only your estate
    if (activeEstateId !== estateIdParam) {
      return res.status(403).json({ error: "Forbidden" });
    }

    let query = supabaseAdmin
      .from("devices")
      .select(
        `
        id,
        parent_device_id,
        is_virtual,
        estate_id,
        home_id,
        room_id,
        name,
        type,
        category,
        external_id,
        status,
        online,
        vendor,
        provider,
        adapter,
        sync_state,
        bind_state,
        is_managed_disabled,
        last_seen_at,
        icon,
        capabilities,
        protocols,
        metadata,
        rooms:rooms ( id, name )
      `
      )
      .eq("estate_id", activeEstateId);

    // Residents/members should only see devices assigned to their active home.
    // Registry enrollment may additionally expose eligible, estate-scoped unassigned devices.
    const role = String(user.role || "").toLowerCase();
    const isEstateWide = role === "admin" || role === "manager" || role === "estate_admin";
    const includeUnassigned = String(req.query.include_unassigned || "").toLowerCase() === "true";
    if (!isEstateWide && !activeHomeId) {
      return res.status(400).json({ error: "Active home context is required" });
    }

    const { data, error } = await query.order("updated_at", { ascending: false });

    if (error) {
      if (isDeviceSchemaMismatch(error)) {
        logger.error("devices_estate_list_schema_mismatch", {
          severity: "high",
          estate_id: activeEstateId,
          home_id: activeHomeId || null,
          include_unassigned: includeUnassigned,
          role,
          error: error.message,
          required_columns: ["devices.parent_device_id", "devices.is_virtual"],
        });
        return res.status(503).json({
          error: "Device registry schema is temporarily unavailable.",
          code: "device_registry_schema_mismatch",
          required_columns: ["devices.parent_device_id", "devices.is_virtual"],
        });
      }
      logger.error("devices_estate_list_query_failed", {
        estate_id: user.estate_id,
        home_id: activeHomeId || null,
        include_unassigned: includeUnassigned,
        role,
        error: error.message,
      });
      return res.status(500).json({ error: "Failed to load device registry" });
    }

    let rows = data || [];
    const irParentIds = new Set(
      rows
        .filter((device: any) => device?.is_virtual && device?.metadata?.ir_appliance?.remote_id)
        .map((device: any) => String(device?.parent_device_id || "").trim())
        .filter(Boolean),
    );
    deviceReadScopeCache.setMany(rows);
    const deviceIds = rows.map((device: any) => String(device?.id || "")).filter(Boolean);
    const stateMap = new Map<string, any>();
    if (deviceIds.length) {
      const { data: stateRows } = await supabaseAdmin
        .from("device_states")
        .select("device_id,status,last_seen,updated_at")
        .in("device_id", deviceIds);
      for (const row of stateRows || []) {
        const key = String((row as any)?.device_id || "");
        if (key) stateMap.set(key, row);
      }
    }

    const devices = rows
      .filter((device: any) => {
        if (isEstateWide) return includeUnassigned || Boolean(device?.home_id);
        if (isTechnicalDeviceHiddenFromResidents(device, { parentHasIrChildren: irParentIds.has(String(device?.id || "")) })) return false;
        const assignedToActiveHome = String(device?.home_id || "") === activeHomeId;
        if (assignedToActiveHome) return true;
        if (!includeUnassigned || device?.home_id) return false;
        const syncState = String(device?.sync_state || "").toLowerCase();
        const status = String(device?.status || "").toLowerCase();
        return syncState !== "unavailable" && status !== "unavailable" && device?.is_managed_disabled !== true;
      })
      .map((device: any) => {
        const room = Array.isArray(device?.rooms) ? device.rooms[0] || null : device?.rooms || null;
        const metadata = sanitizeMetadata(device?.metadata);
        const stateRow = stateMap.get(String(device?.id || ""));
        const summary = summarizeDeviceFrontendContract({ ...device, metadata }, stateRow);
        return {
          ...device,
          name: cleanText(device?.name, "Unnamed device"),
          type: cleanText(device?.type, cleanText(device?.category, "device")),
          category: cleanText(device?.category, cleanText(device?.type, "device")),
          status: cleanText(device?.status, device?.online === false ? "offline" : "unknown"),
          capabilities: safeArray(device?.capabilities),
          protocols: safeArray(device?.protocols),
          metadata,
          ui_capabilities: buildUiCapabilities(device, metadata),
          state: stateRow?.status || null,
          normalized_state: summary.normalized_state,
          supported_controls: summary.supported_controls,
          control_profile: summary.control_profile,
          health_status: summary.health_status,
          provider_health: summary.provider_health,
          primary_state: summary.primary_state,
          telemetry_summary: summary.telemetry_summary,
          device_family: summary.device_family,
          device_type: summary.device_type,
          last_signal: summary.last_signal,
          activity_summary: summary.activity_summary,
          capability_codes: summary.capability_codes,
          last_seen: stateRow?.last_seen || device?.last_seen_at || null,
          room: room?.id ? { id: room.id, name: cleanText(room.name, "Room") } : null,
          room_name: cleanText(room?.name),
          rooms: undefined,
        };
      });

    return res.json({ devices });
  } catch (e: any) {
    return sendPublicApiError(
      res,
      e,
      { statusCode: 500, code: "device_registry_unavailable", message: "Connected devices are temporarily unavailable." },
      {
        operation: "devices.estate.list",
        estate_id: (req as any)?.user?.estate_id || null,
        home_id: activeHomeId || null,
        include_unassigned: String(req.query.include_unassigned || "").toLowerCase() === "true",
      },
    );
  }
}
