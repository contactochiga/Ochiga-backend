/// src/device/adapters/tuya/TuyaAdapter.ts

import { TuyaClient } from "./tuyaClient";
import { DeviceAdapter } from "../DeviceAdapter";
import { AdapterContext, DiscoveredDevice } from "../types";
import { Signal } from "../../../core/control-plane/contracts/signal.types";
import type { DeviceCategory } from "../types";
import { operationalMetrics } from "../../../observability/metrics";
import { providerHealthRegistry } from "../../../observability/providerHealth";
import { enrichDeviceProviderState } from "../../runtime/deviceStateEnrichment";

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

// Tuya functions response
type TuyaFunction = {
  code: string;
  type: "bool" | "value" | "enum" | "string" | string;
  values?: string; // JSON string sometimes
  desc?: string;
  name?: string;
};

type TuyaFunctionsResp = {
  functions?: TuyaFunction[];
};

// Tuya status response
type TuyaStatusItem = {
  code: string;
  value: any;
  t?: number;
};
type TuyaStatusResp = {
  // Tuya returns an array called "result" => [{code,value}, ...]
  // Our TuyaClient.request returns result already, so we treat it as TuyaStatusItem[]
  [k: string]: any;
};

// ✅ Map Tuya categories into your strict DeviceCategory union
function toDeviceCategory(raw?: string): DeviceCategory {
  const c = String(raw || "").toLowerCase().trim();

  if (["dj", "light", "lighting", "ceiling_light", "lamp"].includes(c)) return "light" as DeviceCategory;
  if (["kg", "switch", "switch_1", "switch_2", "switch_3", "switch_4"].includes(c)) return "switch" as DeviceCategory;
  if (["cz", "socket", "plug", "smart_plug", "outlet"].includes(c)) return "socket" as DeviceCategory;
  if (["wk", "camera", "ipc", "ipcamera"].includes(c)) return "camera" as DeviceCategory;
  if (["wnykq", "infrared_remote", "ir_remote", "remote_control", "universal_remote", "tv_remote", "set_top_box", "stb"].includes(c)) return "unknown" as DeviceCategory;
  if (["kt", "air_conditioner", "ac", "climate"].includes(c)) return "thermostat" as DeviceCategory;
  if (["ms", "doorlock", "lock"].includes(c)) return "lock" as DeviceCategory;
  if (["sensor", "pir", "motion", "smoke_sensor", "gas_sensor"].includes(c)) return "sensor" as DeviceCategory;
  if (["cl", "curtain", "blind", "shade"].includes(c)) return "unknown" as DeviceCategory;
  if (["thermostat", "temp_humidity_sensor"].includes(c)) return "thermostat" as DeviceCategory;

  return "unknown" as DeviceCategory;
}

function tuyaCategoryFamily(raw?: string) {
  const c = String(raw || "").toLowerCase().trim();
  const map: Record<string, string> = {
    kg: "switch",
    cz: "plug",
    wk: "camera",
    kt: "climate",
    wnykq: "ir_remote",
    cl: "curtain",
    ms: "lock",
    dj: "light",
    switch: "switch",
    socket: "plug",
    plug: "plug",
    smart_plug: "plug",
    camera: "camera",
    ipc: "camera",
    ipcamera: "camera",
    air_conditioner: "climate",
    ac: "climate",
    climate: "climate",
    infrared_remote: "ir_remote",
    ir_remote: "ir_remote",
    remote_control: "ir_remote",
    universal_remote: "ir_remote",
    tv_remote: "ir_remote",
    curtain: "curtain",
    blind: "curtain",
    shade: "curtain",
    doorlock: "lock",
    lock: "lock",
    light: "light",
    lighting: "light",
    ceiling_light: "light",
    lamp: "light",
  };
  return map[c] || c || "generic";
}

function tuyaCategoryProfile(raw?: string) {
  const family = tuyaCategoryFamily(raw);
  if (family === "switch") return "switch";
  if (family === "plug") return "plug";
  if (family === "camera") return "camera";
  if (family === "climate") return "climate";
  if (family === "ir_remote") return "ir_remote";
  if (family === "curtain") return "curtain";
  if (family === "lock") return "lock";
  if (family === "light") return "light";
  return "generic";
}

function cleanStr(v: any) {
  return String(v || "").trim();
}

function toBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase().trim();
  if (["1", "true", "on", "yes"].includes(s)) return true;
  if (["0", "false", "off", "no"].includes(s)) return false;
  return Boolean(v);
}

function parseJsonMaybe(v?: string) {
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

type DeviceSchema = {
  fetchedAt: number;
  functionsByCode: Record<string, TuyaFunction>;
  functions: TuyaFunction[];
  switchCodes: string[]; // e.g. ["switch_1","switch_2"] OR ["switch"] OR []
  primaryPowerCode: string | null; // "switch" or "power" or null
};

export class TuyaAdapter implements DeviceAdapter {
  readonly name = "tuya";
  readonly vendor = "Tuya";
  readonly protocols = ["cloud", "wifi"];

  private client: TuyaClient;

  // Cache device schema so we don't call Tuya every command
  private schemaCache = new Map<string, DeviceSchema>();
  private deviceMetadataCache = new Map<string, Record<string, any>>();

  // refresh schema every 30 minutes (safe)
  private readonly SCHEMA_TTL_MS = 30 * 60 * 1000;

  constructor(client?: TuyaClient) {
    this.client = client ?? new TuyaClient();
  }

  /* ------------------------------------------------
   * DISCOVERY
   * ------------------------------------------------ */
  async discover(context: AdapterContext): Promise<DiscoveredDevice[]> {
    const startedAt = Date.now();
    providerHealthRegistry.markConfigured("tuya", { note: "discovery_started" });
    console.log("[TuyaAdapter.discover] starting…");

    // ✅ UID-based discovery (Smart Life / App Account)
    const tuyaUid = cleanStr((context as any)?.credentials?.tuyaUid);

    if (tuyaUid) {
      const path = `/v1.0/users/${encodeURIComponent(tuyaUid)}/devices`;
      console.log("[TuyaAdapter.discover] requesting linked Smart Life device list");

      const result = await this.client.request<any>("GET", path);

      const list: TuyaUserDevice[] = Array.isArray(result)
        ? result
        : Array.isArray(result?.list)
          ? result.list
          : [];

      const discovered: DiscoveredDevice[] = list.map((d) => {
        const metadata = {
          manufacturer: "Tuya",
          model: d.model,
          product_id: d.product_id,
          product_name: d.product_name,
          device_family: tuyaCategoryFamily(d.category),
          control_profile: tuyaCategoryProfile(d.category),
          ip: d.ip,
          icon: d.icon,
          owner_id: d.owner_id,
          category: d.category,
          raw: d,
          context: {
            estateId: context?.estateId,
            homeId: context?.homeId,
            userId: context?.userId,
            tuyaUid,
          },
        };
        this.deviceMetadataCache.set(d.id, metadata);
        console.log("[TuyaAdapter.discover] device classification", {
          deviceId: d.id,
          real_category: d.category,
          device_family: metadata.device_family,
          control_profile: metadata.control_profile,
          product_name: d.product_name,
          model: d.model,
        });
        return {
          externalId: d.id,
          adapter: this.name,
          name: d.name || "Unknown device",
          category: toDeviceCategory(d.category),
          online: Boolean(d.online),
          capabilities: [],
          protocols: ["cloud", "wifi"],
          metadata,
        };
      });

      operationalMetrics.increment("oyi_provider_discoveries_total", { provider: "tuya", mode: "uid" }, discovered.length);
      providerHealthRegistry.heartbeat("tuya", { latencyMs: Date.now() - startedAt, note: `discovered:${discovered.length}`, wired: true });
      console.log("[TuyaAdapter.discover] done (uid). devices=", discovered.length);
      return discovered;
    }

    // Fallback: old project-level listing
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

      if (!page?.has_more) break;
      if (!page?.last_row_key) break;

      lastRowKey = page.last_row_key;
    }

    const discovered: DiscoveredDevice[] = all.map((d) => {
      const metadata = {
        manufacturer: "Tuya",
        model: d.model,
        product_id: d.product_id,
        product_name: d.product_name,
        device_family: tuyaCategoryFamily(d.category),
        control_profile: tuyaCategoryProfile(d.category),
        ip: d.ip,
        icon: d.icon,
        owner_id: d.owner_id,
        asset_id: d.asset_id,
        category: d.category,
        raw: d,
        context: {
          estateId: context?.estateId,
          homeId: context?.homeId,
          userId: context?.userId,
        },
      };
      this.deviceMetadataCache.set(d.id, metadata);
      console.log("[TuyaAdapter.discover] device classification", {
        deviceId: d.id,
        real_category: d.category,
        device_family: metadata.device_family,
        control_profile: metadata.control_profile,
        product_name: d.product_name,
        model: d.model,
      });
      return {
        externalId: d.id,
        adapter: this.name,
        name: d.name || "Unknown device",
        category: toDeviceCategory(d.category),
        online: Boolean(d.online),
        capabilities: [],
        protocols: ["cloud", "wifi"],
        metadata,
      };
    });

    operationalMetrics.increment("oyi_provider_discoveries_total", { provider: "tuya", mode: "project" }, discovered.length);
    providerHealthRegistry.heartbeat("tuya", { latencyMs: Date.now() - startedAt, note: `discovered:${discovered.length}`, wired: true });
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
   * DEVICE STATE (LIVE)
   * ------------------------------------------------
   * This is what your deviceStateController can call.
   * It won’t break anything else even if unused.
   */
  async getLiveState(deviceId: string): Promise<Record<string, any>> {
    const startedAt = Date.now();

    // Optional: schema helps us coerce booleans nicely for switch codes
    let schema: DeviceSchema | null = null;
    try {
      schema = await this.getDeviceSchema(deviceId);
    } catch {
      schema = null; // don’t fail state if schema fails
    }

    const path = `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/status`;

    // TuyaClient.request returns result already => should be TuyaStatusItem[]
    const result = await this.client.request<any>("GET", path);

    const list: TuyaStatusItem[] = Array.isArray(result)
      ? result
      : Array.isArray(result?.result)
        ? result.result
        : Array.isArray(result?.status)
          ? result.status
          : [];

    // Build a clean map: { code: value }
    const state: Record<string, any> = {};
    for (const s of list) {
      if (!s?.code) continue;

      const fn = schema?.functionsByCode?.[s.code];
      if (fn?.type === "bool") state[s.code] = toBool(s.value);
      else state[s.code] = s.value;
    }

    if (!("online" in state)) state.online = true;
    state.__raw = list;
    const existingMetadata = await this.getCachedDeviceMetadata(deviceId);
    const existingRawMetadata = existingMetadata.raw || {};
    const originalCategory = cleanStr(existingRawMetadata.category || existingMetadata.category);
    const liveMetadata = {
      ...existingMetadata,
      raw: existingRawMetadata,
      functions: schema?.functions || [],
      manufacturer: "Tuya",
    };
    const enriched = enrichDeviceProviderState({
      state,
      functions: schema?.functions || [],
      metadata: liveMetadata,
      device: {
        category: originalCategory || existingMetadata.device_family || null,
        type: originalCategory || existingMetadata.device_family || null,
        metadata: liveMetadata,
      },
      provider: "tuya",
      adapter: "tuya",
    });
    console.log("[TuyaAdapter.getLiveState] classification", {
      deviceId,
      real_category: originalCategory || null,
      device_family: enriched.device_family,
      control_profile: enriched.control_profile,
      supported_controls: enriched.supported_controls,
      capability_codes: enriched.capability_codes,
    });

    operationalMetrics.increment("oyi_provider_state_reads_total", { provider: "tuya" });
    providerHealthRegistry.heartbeat("tuya", { latencyMs: Date.now() - startedAt, note: "state_read", wired: true });
    return enriched;
  }

  /* ------------------------------------------------
   * INTERNAL: DEVICE SCHEMA
   * ------------------------------------------------ */
  private async getDeviceSchema(deviceId: string): Promise<DeviceSchema> {
    const cached = this.schemaCache.get(deviceId);
    if (cached && Date.now() - cached.fetchedAt < this.SCHEMA_TTL_MS) return cached;

    // Tuya functions define what codes/values are allowed.
    const fnPath = `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/functions`;
    const fnResp = await this.client.request<TuyaFunctionsResp>("GET", fnPath);

    const functions = Array.isArray(fnResp?.functions) ? fnResp.functions : [];

    const functionsByCode: Record<string, TuyaFunction> = {};
    for (const f of functions) {
      if (!f?.code) continue;
      functionsByCode[f.code] = f;
    }

    // detect multi-gang switches: switch_1..switch_n
    const switchCodes = Object.keys(functionsByCode)
      .filter((c) => c === "switch" || c === "power" || /^switch_\d+$/i.test(c))
      .sort((a, b) => {
        const na = a.match(/^switch_(\d+)$/i)?.[1];
        const nb = b.match(/^switch_(\d+)$/i)?.[1];
        if (na && nb) return Number(na) - Number(nb);
        if (a === "switch") return -1;
        if (b === "switch") return 1;
        return a.localeCompare(b);
      });

    let primaryPowerCode: string | null = null;
    if (functionsByCode["switch"]) primaryPowerCode = "switch";
    else if (functionsByCode["power"]) primaryPowerCode = "power";
    else {
      const firstGang = switchCodes.find((c) => /^switch_\d+$/i.test(c));
      primaryPowerCode = firstGang ?? null;
    }

    const schema: DeviceSchema = {
      fetchedAt: Date.now(),
      functionsByCode,
      functions,
      switchCodes,
      primaryPowerCode,
    };

    this.schemaCache.set(deviceId, schema);
    return schema;
  }

  private coerceValueByFunction(fn: TuyaFunction | undefined, value: any): any {
    if (!fn) return value;

    if (fn.type === "bool") return toBool(value);

    if (fn.type === "value") {
      const parsed = parseJsonMaybe(fn.values);
      const min = parsed?.min;
      const max = parsed?.max;
      const step = parsed?.step;
      let num = Number(value);
      if (Number.isNaN(num)) num = 0;

      if (typeof min === "number") num = Math.max(min, num);
      if (typeof max === "number") num = Math.min(max, num);
      if (typeof step === "number" && step > 0) num = Math.round(num / step) * step;

      return num;
    }

    if (fn.type === "enum") {
      const parsed = parseJsonMaybe(fn.values);
      const range: string[] = Array.isArray(parsed?.range) ? parsed.range : [];
      const v = String(value);
      if (!range.length) return v;
      return range.includes(v) ? v : range[0];
    }

    return value;
  }

  private async getCachedDeviceMetadata(deviceId: string): Promise<Record<string, any>> {
    const cached = this.deviceMetadataCache.get(deviceId);
    if (cached) return cached;
    try {
      const details = await this.client.request<any>("GET", `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}`);
      const d = details?.result || details || {};
      const metadata = {
        manufacturer: "Tuya",
        model: d.model,
        product_id: d.product_id,
        product_name: d.product_name,
        device_family: tuyaCategoryFamily(d.category),
        control_profile: tuyaCategoryProfile(d.category),
        ip: d.ip,
        icon: d.icon,
        owner_id: d.owner_id,
        asset_id: d.asset_id,
        category: d.category,
        raw: d,
      };
      this.deviceMetadataCache.set(deviceId, metadata);
      console.log("[TuyaAdapter.getCachedDeviceMetadata] device classification", {
        deviceId,
        real_category: d.category,
        device_family: metadata.device_family,
        control_profile: metadata.control_profile,
        product_name: d.product_name,
        model: d.model,
      });
      return metadata;
    } catch (error) {
      console.warn("[TuyaAdapter.getCachedDeviceMetadata] device metadata unavailable", {
        deviceId,
        message: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  private buildTuyaCommands(schema: DeviceSchema, command: Record<string, any>) {
    const entries = Object.entries(command || {});
    const out: Array<{ code: string; value: any }> = [];

    const wantsPower =
      "power" in (command || {}) ||
      "on" in (command || {}) ||
      "state" in (command || {}) ||
      "switch" in (command || {});

    const channelRaw = (command as any)?.channel ?? (command as any)?.gang ?? null;
    const channel = channelRaw == null ? null : Number(channelRaw);
    const wantsAll = Boolean((command as any)?.all);

    // 1) Direct dp code commands
    for (const [code, value] of entries) {
      if (code === "channel" || code === "gang" || code === "all") continue;
      if (code === "on") continue;
      if (code === "state") continue;

      if (!schema.functionsByCode[code]) continue;

      const fn = schema.functionsByCode[code];
      out.push({ code, value: this.coerceValueByFunction(fn, value) });
    }

    // 2) Power mapping
    if (wantsPower && out.length === 0) {
      const raw =
        (command as any)?.power ??
        (command as any)?.on ??
        (command as any)?.state ??
        (command as any)?.switch;

      const desired = toBool(raw);

      const gangCodes = schema.switchCodes.filter((c) => /^switch_\d+$/i.test(c));
      const hasMulti = gangCodes.length > 0;

      if (hasMulti) {
        if (channel && Number.isFinite(channel)) {
          const target = `switch_${channel}`;
          if (schema.functionsByCode[target]) {
            out.push({
              code: target,
              value: this.coerceValueByFunction(schema.functionsByCode[target], desired),
            });
          }
        } else {
          // all gangs by default
          for (const c of gangCodes) {
            out.push({
              code: c,
              value: this.coerceValueByFunction(schema.functionsByCode[c], desired),
            });
          }
        }
      } else {
        const primary = schema.primaryPowerCode;
        if (primary && schema.functionsByCode[primary]) {
          out.push({
            code: primary,
            value: this.coerceValueByFunction(schema.functionsByCode[primary], desired),
          });
        }
      }

      if (wantsAll && out.length === 0 && schema.functionsByCode["switch"]) {
        out.push({
          code: "switch",
          value: this.coerceValueByFunction(schema.functionsByCode["switch"], desired),
        });
      }
    }

    return out;
  }

  /* ------------------------------------------------
   * COMMAND
   * ------------------------------------------------ */
  async executeCommand(
    deviceId: string,
    command: Record<string, any>,
    _context: AdapterContext
  ): Promise<void> {
    const startedAt = Date.now();
    const schema = await this.getDeviceSchema(deviceId);

    const commands = this.buildTuyaCommands(schema, command);
    console.log("[TuyaAdapter.executeCommand] classification", {
      deviceId,
      capability_codes: Object.keys(schema.functionsByCode),
      switch_codes: schema.switchCodes,
      primary_power_code: schema.primaryPowerCode,
      command,
    });

    if (!commands.length) {
      console.warn("[TuyaAdapter.executeCommand] No supported commands for device:", deviceId, {
        incoming: command,
        supported: Object.keys(schema.functionsByCode).slice(0, 30),
      });
      throw new Error("No supported command mapping for this device");
    }

    await this.client.request("POST", `/v1.0/iot-03/devices/${deviceId}/commands`, { commands });

    operationalMetrics.increment("oyi_provider_commands_total", { provider: "tuya" });
    providerHealthRegistry.heartbeat("tuya", { latencyMs: Date.now() - startedAt, note: "command_executed", wired: true });
  }

  /* ------------------------------------------------
   * EVENT STREAM
   * ------------------------------------------------ */
  async startEventStream(
    _context: AdapterContext,
    _emit: (signal: Signal) => Promise<void>
  ): Promise<void> {
    providerHealthRegistry.markConfigured("tuya", { note: "event_stream_placeholder_cloud_polling", status: "degraded" });
    return;
  }

  async shutdown(): Promise<void> {
    return;
  }
}
