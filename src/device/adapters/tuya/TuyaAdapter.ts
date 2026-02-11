/// src/device/adapters/tuya/TuyaAdapter.ts

import { TuyaClient } from "./tuyaClient";
import { DeviceAdapter } from "../DeviceAdapter";
import { AdapterContext, DiscoveredDevice } from "../types";
import { Signal } from "../../../core/control-plane/contracts/signal.types";
import type { DeviceCategory } from "../types";

// v1.0 users/{uid}/devices response item shape (common fields)
type TuyaUserDevice = {
  id: string;
  name?: string;
  category?: string;
  product_id?: string;
  product_name?: string;
  model?: string;
  online?: boolean;
  ip?: string;
  icon?: string;
  uuid?: string;
  owner_id?: string;
  [k: string]: any;
};

type TuyaDeviceListPage = {
  has_more: boolean;
  list: Array<{
    id: string;
    name?: string;
    category?: string;
    product_id?: string;
    product_name?: string;
    model?: string;
    online?: boolean;
    ip?: string;
    icon?: string;
    owner_id?: string;
    asset_id?: string;
    uuid?: string;
    sub?: boolean;
    gateway_id?: string;
    node_id?: string;
    time_zone?: string;
    lon?: string;
    lat?: string;
    create_time?: number;
    update_time?: number;
    active_time?: number;
    [k: string]: any;
  }>;
  last_row_key?: string;
  total?: number;
};

// ✅ Map Tuya categories into your strict DeviceCategory union
function toDeviceCategory(raw?: string): DeviceCategory {
  const c = String(raw || "").toLowerCase().trim();

  if (["light", "lighting", "ceiling_light", "lamp"].includes(c)) return "light" as DeviceCategory;
  if (["switch", "switch_1", "switch_2", "switch_3", "switch_4"].includes(c))
    return "switch" as DeviceCategory;
  if (["socket", "plug", "smart_plug", "outlet"].includes(c)) return "plug" as DeviceCategory;
  if (["camera", "ipc", "ipcamera"].includes(c)) return "camera" as DeviceCategory;
  if (["doorlock", "lock"].includes(c)) return "lock" as DeviceCategory;
  if (["sensor", "pir", "motion", "smoke_sensor", "gas_sensor"].includes(c))
    return "sensor" as DeviceCategory;
  if (["curtain", "blind", "shade"].includes(c)) return "curtain" as DeviceCategory;
  if (["thermostat", "temp_humidity_sensor"].includes(c)) return "thermostat" as DeviceCategory;

  return "unknown" as DeviceCategory;
}

function cleanStr(v: any) {
  return String(v || "").trim();
}

/**
 * ✅ Minimal DP mapping for common power toggles.
 * Your Tuya console shows many devices expose switch_1 (NOT switch).
 * So we normalize "power"/"switch" -> "switch_1".
 *
 * This keeps your UI + chat simple while Tuya gets the exact DP it needs.
 */
function normalizeTuyaCommand(command: Record<string, any>): Record<string, any> {
  if (!command || typeof command !== "object") return {};

  const out: Record<string, any> = {};

  for (const [keyRaw, valueRaw] of Object.entries(command)) {
    const key = String(keyRaw).trim();

    // Normalize boolean-ish values
    const v =
      valueRaw === "on"
        ? true
        : valueRaw === "off"
          ? false
          : valueRaw === "true"
            ? true
            : valueRaw === "false"
              ? false
              : valueRaw;

    // ✅ Generic toggles -> Tuya DP
    if (key === "power" || key === "switch") {
      // default to switch_1 if caller used generic names
      out["switch_1"] = v === true || v === 1 || v === "1" || v === "on";
      continue;
    }

    // ✅ Also accept user sending { switch_1: true } already
    if (key === "switch_1") {
      out["switch_1"] = v === true || v === 1 || v === "1" || v === "on";
      continue;
    }

    // pass-through for advanced commands (countdown_1, relay_status, etc.)
    out[key] = v;
  }

  return out;
}

export class TuyaAdapter implements DeviceAdapter {
  readonly name = "tuya";
  readonly vendor = "Tuya";
  readonly protocols = ["cloud", "wifi"];

  private client: TuyaClient;

  constructor(client?: TuyaClient) {
    this.client = client ?? new TuyaClient();
  }

  /* ------------------------------------------------
   * DISCOVERY
   * ------------------------------------------------ */
  async discover(context: AdapterContext): Promise<DiscoveredDevice[]> {
    console.log("[TuyaAdapter.discover] starting…");

    // ✅ UID-based discovery (Smart Life / App Account)
    const tuyaUid = cleanStr((context as any)?.credentials?.tuyaUid);

    if (tuyaUid) {
      const path = `/v1.0/users/${encodeURIComponent(tuyaUid)}/devices`;
      console.log("[TuyaAdapter.discover] requesting (uid devices):", path);

      // TuyaClient returns res.data.result already
      const result = await this.client.request<any>("GET", path);

      // Some responses are array, some are { list: [] }
      const list: TuyaUserDevice[] = Array.isArray(result)
        ? result
        : Array.isArray(result?.list)
          ? result.list
          : [];

      const discovered: DiscoveredDevice[] = list.map((d) => ({
        externalId: d.id,
        adapter: this.name,
        name: d.name || "Unknown device",
        category: toDeviceCategory(d.category),
        online: Boolean(d.online),
        capabilities: [],
        protocols: ["cloud", "wifi"],
        metadata: {
          manufacturer: "Tuya",
          model: d.model,
          product_id: d.product_id,
          product_name: d.product_name,
          ip: d.ip,
          icon: d.icon,
          owner_id: d.owner_id,
          raw: d,
          context: {
            estateId: context?.estateId,
            homeId: context?.homeId,
            userId: context?.userId,
            tuyaUid,
          },
        },
      }));

      console.log("[TuyaAdapter.discover] done (uid). devices=", discovered.length);
      return discovered;
    }

    // ------------------------------------------------
    // Fallback: old project-level listing (may be 0 for Smart Life devices)
    // ------------------------------------------------
    console.log("[TuyaAdapter.discover] tuyaUid missing — falling back to project device list");

    const sourceType = (process.env.TUYA_SOURCE_TYPE || "").trim() || undefined;
    const sourceId = (process.env.TUYA_SOURCE_ID || "").trim() || undefined;

    const pageSize = Math.min(200, Math.max(1, Number(process.env.TUYA_PAGE_SIZE || 200)));

    const all: TuyaDeviceListPage["list"] = [];
    let lastRowKey: string | undefined = undefined;
    let safety = 0;

    while (safety++ < 50) {
      const qs = new URLSearchParams();
      qs.set("page_size", String(pageSize));
      if (lastRowKey) qs.set("last_row_key", lastRowKey);
      if (sourceType) qs.set("source_type", sourceType);
      if (sourceType && sourceId) qs.set("source_id", sourceId);

      const path = `/v1.3/iot-03/devices?${qs.toString()}`;
      console.log("[TuyaAdapter.discover] requesting (project devices):", path);

      const page = await this.client.request<TuyaDeviceListPage>("GET", path);

      const list = Array.isArray(page?.list) ? page.list : [];
      all.push(...list);

      console.log(
        "[TuyaAdapter.discover] page:",
        "got=",
        list.length,
        "totalSoFar=",
        all.length,
        "has_more=",
        Boolean(page?.has_more),
        "last_row_key=",
        page?.last_row_key || "-"
      );

      if (!page?.has_more) break;
      if (!page?.last_row_key) break;

      lastRowKey = page.last_row_key;
    }

    const discovered: DiscoveredDevice[] = all.map((d) => ({
      externalId: d.id,
      adapter: this.name,
      name: d.name || "Unknown device",
      category: toDeviceCategory(d.category),
      online: Boolean(d.online),
      capabilities: [],
      protocols: ["cloud", "wifi"],
      metadata: {
        manufacturer: "Tuya",
        model: d.model,
        product_id: d.product_id,
        product_name: d.product_name,
        ip: d.ip,
        icon: d.icon,
        owner_id: d.owner_id,
        asset_id: d.asset_id,
        raw: d,
        context: {
          estateId: context?.estateId,
          homeId: context?.homeId,
          userId: context?.userId,
        },
      },
    }));

    console.log("[TuyaAdapter.discover] done (fallback). devices=", discovered.length);
    return discovered;
  }

  /* ------------------------------------------------
   * BIND
   * ------------------------------------------------ */
  async bindDevice(_device: DiscoveredDevice, _context: AdapterContext): Promise<void> {
    return;
  }

  /* ------------------------------------------------
   * COMMAND
   * ------------------------------------------------ */
  async executeCommand(
    deviceId: string,
    command: Record<string, any>,
    _context: AdapterContext
  ): Promise<void> {
    // ✅ Normalize generic commands to Tuya DP codes (fixes Tuya error 2008)
    const normalized = normalizeTuyaCommand(command);

    const commands = Object.entries(normalized).map(([code, value]) => ({ code, value }));

    if (!commands.length) {
      throw new Error("No valid Tuya commands to execute");
    }

    await this.client.request("POST", `/v1.0/iot-03/devices/${deviceId}/commands`, { commands });
  }

  /* ------------------------------------------------
   * EVENT STREAM
   * ------------------------------------------------ */
  async startEventStream(
    _context: AdapterContext,
    _emit: (signal: Signal) => Promise<void>
  ): Promise<void> {
    return;
  }

  async shutdown(): Promise<void> {
    return;
  }
}
