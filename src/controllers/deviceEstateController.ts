// src/controllers/deviceEstateController.ts
import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

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
  const isAc = /(^| )(ac|a\/c|air_conditioner|aircon|hvac|climate|thermostat|kt)( |$)/.test(`${category} ${identityText}`);
  const isTv = /(^| )(tv|television|smart_tv|android_tv|google_tv|samsung_tv|lg_tv|hisense_tv|tcl|set_top|set_top_box|decoder|stb)( |$)/.test(`${category} ${identityText}`);
  const isIrRemote = /(^| )(ir|infrared|remote|remote_control|universal_remote|wnykq)( |$)/.test(`${category} ${identityText}`);
  const isSimplePower = /(^| )(light|switch|plug|socket|outlet|relay)( |$)/.test(`${category} ${identityText}`);

  const switchable =
    !isCamera &&
    !isTv &&
    !isIrRemote &&
    !isAc &&
    (includesAny(values, [/^switch(_\d+)?$/, /^switch_led$/, /^power$/, /^on$/, /^on_off$/, /^relay/]) ||
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
    kind: isCamera ? "camera" : tvRemote ? "tv_remote" : acRemote ? "ac_remote" : isIrRemote ? "ir_remote" : category || "device",
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

export async function getEstateDevices(req: Request, res: Response) {
  try {
    const user: any = (req as any).user;
    const estateIdParam = String(req.params.estateId || "").trim();

    if (!user?.estate_id) return res.status(400).json({ error: "User has no estate" });

    // ✅ enforce: only your estate
    if (user.estate_id !== estateIdParam) {
      return res.status(403).json({ error: "Forbidden" });
    }

    let query = supabaseAdmin
      .from("devices")
      .select(
        `
        id,
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
      .eq("estate_id", user.estate_id);

    // Residents/members should only see devices assigned to their active home.
    // Registry enrollment may additionally expose eligible, estate-scoped unassigned devices.
    const role = String(user.role || "").toLowerCase();
    const isEstateWide = role === "admin" || role === "manager" || role === "estate_admin";
    const includeUnassigned = String(req.query.include_unassigned || "").toLowerCase() === "true";
    if (!isEstateWide && !user.home_id) return res.json({ devices: [] });

    const { data, error } = await query.order("updated_at", { ascending: false });

    if (error) {
      console.error("[devices.estate.list] query_failed", {
        estate_id: user.estate_id,
        home_id: user.home_id || null,
        include_unassigned: includeUnassigned,
        role,
        error: error.message,
      });
      return res.status(500).json({ error: "Failed to load device registry" });
    }

    const devices = (data || [])
      .filter((device: any) => {
        if (isEstateWide) return includeUnassigned || Boolean(device?.home_id);
        const assignedToActiveHome = String(device?.home_id || "") === String(user.home_id || "");
        if (assignedToActiveHome) return true;
        if (!includeUnassigned || device?.home_id) return false;
        const syncState = String(device?.sync_state || "").toLowerCase();
        const status = String(device?.status || "").toLowerCase();
        return syncState !== "unavailable" && status !== "unavailable" && device?.is_managed_disabled !== true;
      })
      .map((device: any) => {
        const room = Array.isArray(device?.rooms) ? device.rooms[0] || null : device?.rooms || null;
        const metadata = sanitizeMetadata(device?.metadata);
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
          room: room?.id ? { id: room.id, name: cleanText(room.name, "Room") } : null,
          room_name: cleanText(room?.name),
          rooms: undefined,
        };
      });

    return res.json({ devices });
  } catch (e: any) {
    console.error("[devices.estate.list] normalization_failed", {
      estate_id: (req as any)?.user?.estate_id || null,
      home_id: (req as any)?.user?.home_id || null,
      include_unassigned: String(req.query.include_unassigned || "").toLowerCase() === "true",
      error: e?.message || "Unknown registry normalization error",
    });
    return res.status(500).json({ error: e?.message || "Failed to fetch estate devices" });
  }
}
