/// src/device/adapters/tuya/TuyaAdapter.ts

import { TuyaClient } from "./tuyaClient";
import { DeviceAdapter } from "../DeviceAdapter";
import { AdapterContext, DiscoveredDevice } from "../types";
import { Signal } from "../../../core/control-plane/contracts/signal.types";
import type { DeviceCategory } from "../types";
import { operationalMetrics } from "../../../observability/metrics";
import { providerHealthRegistry } from "../../../observability/providerHealth";
import { enrichDeviceProviderState } from "../../runtime/deviceStateEnrichment";
import { classifyProviderError, isProviderAuthorizationError } from "../../runtime/providerErrors";
import { logger } from "../../../observability/logger";
import { supabaseAdmin } from "../../../supabase/supabaseClient";

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

type TuyaIrRemote = {
  remote_id?: string;
  id?: string;
  remote_index?: string | number;
  category_id?: string | number;
  category_name?: string;
  remote_name?: string;
  name?: string;
  brand_id?: string | number;
  brand_name?: string;
  brand?: string;
  [k: string]: any;
};

type TuyaIrKey = {
  key?: string;
  key_code?: string;
  code?: string;
  value?: string;
  name?: string;
  key_name?: string;
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
  if (["ms", "jtmspro", "jtmsbh", "jtms", "doorlock", "lock", "smart_lock", "door_lock"].includes(c)) return "lock" as DeviceCategory;
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
    jtmspro: "lock",
    jtmsbh: "lock",
    jtms: "lock",
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
    infrared_ac: "climate",
    infrared_tv: "television",
    infrared_fan: "fan",
    infrared_stb: "set_top_box",
    infrared_projector: "projector",
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
    smart_lock: "lock",
    door_lock: "lock",
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
  if (family === "television") return "television";
  if (family === "ir_remote") return "ir_remote";
  if (family === "curtain") return "curtain";
  if (family === "lock") return "lock";
  if (family === "light") return "light";
  if (["fan", "projector", "set_top_box", "speaker"].includes(family)) return family;
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

function arrayPayload(input: any, candidates: string[] = ["list", "keys", "remotes", "result"]) {
  if (Array.isArray(input)) return input;
  for (const key of candidates) {
    if (Array.isArray(input?.[key])) return input[key];
  }
  return [];
}

function tuyaResultAccepted(result: any) {
  return result === true || result?.result === true || result?.success === true || result?.accepted === true;
}

function compactStringArray(values: any[]) {
  return Array.from(new Set(values.map((value) => cleanStr(value)).filter(Boolean)));
}

type DeviceSchema = {
  fetchedAt: number;
  functionsByCode: Record<string, TuyaFunction>;
  functions: TuyaFunction[];
  switchCodes: string[]; // e.g. ["switch_1","switch_2"] OR ["switch"] OR []
  primaryPowerCode: string | null; // "switch" or "power" or null
};

type TuyaIrPreferredVersion = "v1.0" | "v2.0";

type TuyaIrEndpointCompatibility = {
  preferred_version?: TuyaIrPreferredVersion;
  v2_compatible?: boolean | "unknown";
  reason?: string | null;
  provider_code?: string | null;
  last_verified_at?: string | null;
  expires_at?: string | null;
};

type TuyaIrRequestOptions = {
  context?: AdapterContext;
  infraredId?: string;
  endpointKind?: string;
};

const irEndpointCompatibilityMemory = new Map<string, TuyaIrEndpointCompatibility>();
const IR_ENDPOINT_COMPATIBILITY_TTL_MS = 14 * 24 * 60 * 60 * 1000;

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

  private irApiVersions() {
    const configured = cleanStr(process.env.TUYA_IR_API_VERSIONS || process.env.TUYA_IR_API_VERSION);
    const versions = configured
      ? configured.split(",").map((version) => version.trim().replace(/^\/+/, "")).filter(Boolean)
      : ["v2.0", "v1.0"];
    return Array.from(new Set(versions));
  }

  private irCompatibilityScope(context?: AdapterContext, infraredId?: string) {
    const device = (context as any)?.canonicalDevice || (context as any)?.device || {};
    const providerConnectionId = cleanStr(device?.provider_connection_id || (context as any)?.providerConnectionId);
    const homeId = cleanStr((context as any)?.homeId || device?.home_id);
    const ownerId = cleanStr((context as any)?.userId || device?.owner_user_id || device?.metadata?.oyi?.integration_owner_user_id);
    const region = cleanStr(process.env.TUYA_BASE_URL).replace(/^https?:\/\//, "").split("/")[0] || "tuya";
    const hub = cleanStr(infraredId || device?.parent_external_id || device?.metadata?.ir_appliance?.infrared_id || device?.external_id);
    const scope = providerConnectionId || `${ownerId || "unknown-owner"}:${homeId || "unknown-home"}`;
    return {
      key: `${region}:${scope}:${hub || "unknown-hub"}`,
      providerConnectionId,
      hub,
    };
  }

  private isFreshIrCompatibility(entry?: TuyaIrEndpointCompatibility | null) {
    if (!entry?.preferred_version) return false;
    const expiresAt = entry.expires_at ? Date.parse(entry.expires_at) : 0;
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  }

  private async loadIrCompatibility(context?: AdapterContext, infraredId?: string): Promise<TuyaIrEndpointCompatibility | null> {
    const scope = this.irCompatibilityScope(context, infraredId);
    const cached = irEndpointCompatibilityMemory.get(scope.key);
    if (this.isFreshIrCompatibility(cached)) return cached || null;
    if (!scope.providerConnectionId || !scope.hub) return cached || null;
    try {
      const { data, error } = await supabaseAdmin
        .from("provider_connections")
        .select("metadata")
        .eq("id", scope.providerConnectionId)
        .maybeSingle();
      if (error) throw error;
      const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata as Record<string, any> : {};
      const next = metadata?.tuya_ir_endpoint_compatibility?.[scope.hub] || null;
      if (next) {
        irEndpointCompatibilityMemory.set(scope.key, next);
        return next;
      }
    } catch (error) {
      logger.debug("tuya_ir_endpoint_compatibility_load_failed", {
        provider_connection_id: scope.providerConnectionId,
        infrared_id: scope.hub,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return cached || null;
  }

  private async rememberIrCompatibility(
    context: AdapterContext | undefined,
    infraredId: string | undefined,
    patch: Omit<TuyaIrEndpointCompatibility, "last_verified_at" | "expires_at">,
  ) {
    const scope = this.irCompatibilityScope(context, infraredId);
    const entry: TuyaIrEndpointCompatibility = {
      ...patch,
      last_verified_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + IR_ENDPOINT_COMPATIBILITY_TTL_MS).toISOString(),
    };
    irEndpointCompatibilityMemory.set(scope.key, entry);
    if (!scope.providerConnectionId || !scope.hub) return;
    try {
      const { data, error } = await supabaseAdmin
        .from("provider_connections")
        .select("metadata")
        .eq("id", scope.providerConnectionId)
        .maybeSingle();
      if (error) throw error;
      const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata as Record<string, any> : {};
      const nextMetadata = {
        ...metadata,
        tuya_ir_endpoint_compatibility: {
          ...(metadata.tuya_ir_endpoint_compatibility || {}),
          [scope.hub]: entry,
        },
      };
      await supabaseAdmin
        .from("provider_connections")
        .update({ metadata: nextMetadata, updated_at: new Date().toISOString() } as any)
        .eq("id", scope.providerConnectionId);
    } catch (error) {
      logger.debug("tuya_ir_endpoint_compatibility_persist_failed", {
        provider_connection_id: scope.providerConnectionId,
        infrared_id: scope.hub,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async orderedIrApiVersions(options?: TuyaIrRequestOptions) {
    const configured = this.irApiVersions();
    const compatibility = await this.loadIrCompatibility(options?.context, options?.infraredId);
    if (this.isFreshIrCompatibility(compatibility) && compatibility?.preferred_version) {
      return Array.from(new Set([compatibility.preferred_version, ...configured]));
    }
    return configured;
  }

  private async requestIr<T>(
    method: "GET" | "POST",
    pathFactory: (version: string) => string,
    body?: any | ((version: string) => any),
    options?: TuyaIrRequestOptions,
  ): Promise<T> {
    let lastError: unknown = null;
    let v2Incompatibility: { provider_code: string | null; reason: string | null } | null = null;
    const compatibility = await this.loadIrCompatibility(options?.context, options?.infraredId);
    const preferenceCacheHit = this.isFreshIrCompatibility(compatibility) && Boolean(compatibility?.preferred_version);
    const versions = preferenceCacheHit && compatibility?.preferred_version
      ? Array.from(new Set([compatibility.preferred_version, ...this.irApiVersions()]))
      : this.irApiVersions();
    for (const version of versions) {
      const path = pathFactory(version);
      const resolvedBody = typeof body === "function" ? body(version) : body;
      try {
        logger.info("ir_provider_endpoint_selected", {
          method,
          version,
          endpoint: path,
          endpoint_kind: options?.endpointKind || null,
          infrared_id: options?.infraredId || null,
          preference_cache_hit: preferenceCacheHit,
          payload: resolvedBody || null,
        });
        const providerStartedAt = Date.now();
        const response = await this.client.request<T>(method, path, resolvedBody);
        logger.info("ir_provider_response_received", {
          method,
          version,
          endpoint: path,
          endpoint_kind: options?.endpointKind || null,
          infrared_id: options?.infraredId || null,
          provider_latency_ms: Date.now() - providerStartedAt,
          response,
        });
        if (method === "POST" && !tuyaResultAccepted(response)) {
          logger.warn("ir_provider_rejected", {
            method,
            version,
            endpoint: path,
            endpoint_kind: options?.endpointKind || null,
            infrared_id: options?.infraredId || null,
            accepted: false,
            provider_response: response,
          });
          const error: any = new Error("The IR controller rejected this key.");
          error.statusCode = 424;
          error.code = "IR_PROVIDER_REJECTED";
          error.provider_status = "rejected";
          error.safe_error_message = "The IR controller rejected this key. Re-sync the TV remote configuration.";
          throw error;
        }
        logger.info("ir_provider_accepted", {
          method,
          version,
          endpoint: path,
          endpoint_kind: options?.endpointKind || null,
          infrared_id: options?.infraredId || null,
          provider_latency_ms: Date.now() - providerStartedAt,
        });
        if (method === "POST" && options?.infraredId) {
          if (version === "v1.0" && v2Incompatibility) {
            void this.rememberIrCompatibility(options.context, options.infraredId, {
              preferred_version: "v1.0",
              v2_compatible: false,
              provider_code: v2Incompatibility.provider_code,
              reason: v2Incompatibility.reason || "v2_incompatible_v1_succeeded",
            });
          } else if (version === "v2.0") {
            void this.rememberIrCompatibility(options.context, options.infraredId, {
              preferred_version: "v2.0",
              v2_compatible: true,
              provider_code: null,
              reason: "v2_succeeded",
            });
          }
        }
        return response;
      } catch (error) {
        lastError = error;
        const classified = classifyProviderError(error, { provider: "tuya", operation: path });
        if (version === "v2.0" && classified.provider_code === "20001") {
          v2Incompatibility = {
            provider_code: classified.provider_code,
            reason: classified.safe_message || "Tuya IR v2 endpoint incompatible for this command",
          };
          logger.warn("ir_provider_rejected", {
            method,
            version,
            endpoint: path,
            endpoint_kind: options?.endpointKind || null,
            infrared_id: options?.infraredId || null,
            provider_code: classified.provider_code,
            safe_message: classified.safe_message,
            fallback: "v1.0",
          });
          continue;
        }
        if (["permission_denied", "device_not_linked", "integration_expired", "authentication_failed", "rate_limited"].includes(classified.classification)) {
          throw error;
        }
        logger.warn("ir_provider_rejected", {
          method,
          version,
          endpoint: path,
          endpoint_kind: options?.endpointKind || null,
          infrared_id: options?.infraredId || null,
          classification: classified.classification,
          provider_code: classified.provider_code,
          safe_message: classified.safe_message,
        });
      }
    }
    throw lastError instanceof Error ? lastError : new Error("The connected provider could not complete this IR request.");
  }

  /* ------------------------------------------------
   * DISCOVERY
   * ------------------------------------------------ */
  async discover(context: AdapterContext): Promise<DiscoveredDevice[]> {
    const startedAt = Date.now();
    providerHealthRegistry.markConfigured("tuya", { note: "discovery_started" });
    logger.debug("tuya_discovery_started", {
      estate_id: context?.estateId,
      home_id: context?.homeId,
      actor_id: context?.userId,
    });

    // ✅ UID-based discovery (Smart Life / App Account)
    const tuyaUid = cleanStr((context as any)?.credentials?.tuyaUid);

    if (tuyaUid) {
      const path = `/v1.0/users/${encodeURIComponent(tuyaUid)}/devices`;
      logger.debug("tuya_discovery_uid_device_list_requested", {
        estate_id: context?.estateId,
        home_id: context?.homeId,
        actor_id: context?.userId,
        tuya_uid: tuyaUid,
      });

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
        logger.debug("tuya_discovery_device_classification", {
          device_id: d.id,
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
      logger.debug("tuya_discovery_completed", {
        mode: "uid",
        count: discovered.length,
        latency_ms: Date.now() - startedAt,
      });
      return discovered;
    }

    // Fallback: old project-level listing
    logger.debug("tuya_discovery_project_fallback_started", {
      estate_id: context?.estateId,
      home_id: context?.homeId,
      actor_id: context?.userId,
    });

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
      logger.debug("tuya_discovery_project_page_requested", { path });

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
      logger.debug("tuya_discovery_device_classification", {
        device_id: d.id,
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
    logger.debug("tuya_discovery_completed", {
      mode: "project",
      count: discovered.length,
      latency_ms: Date.now() - startedAt,
    });
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
    } catch (error) {
      if (isProviderAuthorizationError(error, { provider: "tuya", operation: "device_schema" })) throw error;
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
    logger.debug("tuya_live_state_classification", {
      device_id: deviceId,
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
      logger.debug("tuya_cached_metadata_classification", {
        device_id: deviceId,
        real_category: d.category,
        device_family: metadata.device_family,
        control_profile: metadata.control_profile,
        product_name: d.product_name,
        model: d.model,
      });
      return metadata;
    } catch (error) {
      logger.warn("tuya_cached_metadata_unavailable", {
        device_id: deviceId,
        message: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  async listIrRemotes(infraredId: string): Promise<any[]> {
    const result = await this.requestIr<any>("GET", (version) => `/${version}/infrareds/${encodeURIComponent(infraredId)}/remotes`);
    const remotes = arrayPayload(result, ["list", "remotes", "result"]);
    logger.debug("tuya_ir_remotes_discovered", {
      infrared_id: infraredId,
      count: remotes.length,
    });
    return remotes;
  }

  async listIrRemoteKeys(infraredId: string, remoteId: string, context?: AdapterContext): Promise<any[]> {
    const result = await this.requestIr<any>(
      "GET",
      (version) => `/${version}/infrareds/${encodeURIComponent(infraredId)}/remotes/${encodeURIComponent(remoteId)}/keys`,
      undefined,
      { context, infraredId, endpointKind: "remote_keys" },
    );
    const payload = result && typeof result === "object" && !Array.isArray(result) ? result : {};
    const keys = arrayPayload(result, ["key_list", "keys", "list", "result"]).map((item) => ({
      ...(item || {}),
      category_id: item?.category_id ?? payload?.category_id ?? null,
      brand_id: item?.brand_id ?? payload?.brand_id ?? null,
      remote_index: item?.remote_index ?? payload?.remote_index ?? null,
      key_range: item?.key_range ?? payload?.key_range ?? null,
    }));
    logger.debug("tuya_ir_remote_keys_discovered", {
      infrared_id: infraredId,
      remote_id: remoteId,
      count: keys.length,
      key_range_count: Array.isArray(payload?.key_range) ? payload.key_range.length : 0,
    });
    return keys;
  }

  async auditIrHubCapabilities(infraredId: string, context?: AdapterContext): Promise<Record<string, any>> {
    const checkedAt = new Date().toISOString();
    const evidence: Array<Record<string, any>> = [];
    const probe = async (operation: string, method: "GET" | "POST", path: string, safeToExpose = false) => {
      const row: Record<string, any> = {
        operation,
        endpoint: path,
        sdk: "tuya_cloud_ir",
        entitlement: "unknown",
        live_result: "not_checked",
        safe_to_expose: false,
        implementation_status: safeToExpose ? "read_only_probe" : "documented_not_enabled",
      };
      if (method !== "GET") {
        row.live_result = "not_mutated";
        row.entitlement = "mutation_requires_explicit_operator_flow";
        evidence.push(row);
        return row;
      }
      try {
        const result = await this.requestIr<any>(method, () => path, undefined, { context, infraredId, endpointKind: `audit:${operation}` });
        const count = Array.isArray(result) ? result.length : Array.isArray(result?.list) ? result.list.length : Array.isArray(result?.result) ? result.result.length : null;
        row.entitlement = "available";
        row.live_result = count == null ? "success" : `success:${count}`;
        row.safe_to_expose = safeToExpose;
        row.implementation_status = safeToExpose ? "implemented_read_only" : "available_but_not_exposed";
      } catch (error) {
        const classified = classifyProviderError(error, { provider: "tuya", operation: path });
        row.entitlement = classified.classification;
        row.live_result = classified.provider_code ? `provider_error:${classified.provider_code}` : classified.classification;
        row.safe_to_expose = false;
        row.implementation_status = "blocked_by_provider_or_permission";
      }
      evidence.push(row);
      return row;
    };

    await probe("categories", "GET", `/v1.0/infrareds/${encodeURIComponent(infraredId)}/categories`, true);
    await probe("bound_remotes", "GET", `/v1.0/infrareds/${encodeURIComponent(infraredId)}/remotes`, true);
    await probe("add_remote", "POST", `/v1.0/infrareds/${encodeURIComponent(infraredId)}/add-remote`, false);
    await probe("delete_remote", "POST", `/v1.0/infrareds/${encodeURIComponent(infraredId)}/remotes/{remote_id}`, false);
    await probe("standard_command", "POST", `/v1.0/infrareds/${encodeURIComponent(infraredId)}/remotes/{remote_id}/command`, false);
    await probe("raw_command", "POST", `/v2.0/infrareds/${encodeURIComponent(infraredId)}/remotes/{remote_id}/raw/command`, false);
    await probe("learning_status", "POST", `/v1.0/infrareds/${encodeURIComponent(infraredId)}/learning-state`, false);
    await probe("smart_matching_token", "GET", `/v1.0/infrareds/${encodeURIComponent(infraredId)}/matching-remotes/token`, false);
    return {
      provider: "tuya",
      infrared_id: infraredId,
      checked_at: checkedAt,
      deprecated_api_family: true,
      production_path: "bound_remote_control_with_exact_provider_keys",
      add_remote_safe_to_expose: false,
      evidence,
    };
  }

  private commandValue(command: Record<string, any>, ...keys: string[]) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(command || {}, key)) return (command as any)[key];
    }
    return undefined;
  }

  private normalizeRemoteKey(value: unknown) {
    return cleanStr(value).toLowerCase().replace(/[\s.-]+/g, "_");
  }

  private supportedIrKeys(context: AdapterContext) {
    const keys = (context as any)?.device?.metadata?.ir_appliance?.supported_keys;
    return Array.isArray(keys) ? keys : [];
  }

  private supportedKeyCode(definition: any) {
    return cleanStr(definition?.canonical_action || definition?.canonical_key || definition?.action || definition?.key || definition?.key_code || definition?.code || definition?.value || definition?.name || definition?.key_name);
  }

  private findSupportedIrKey(context: AdapterContext, candidates: string[]) {
    const normalized = candidates.map((candidate) => this.normalizeRemoteKey(candidate)).filter(Boolean);
    for (const definition of this.supportedIrKeys(context)) {
      const values = [
        this.supportedKeyCode(definition),
        definition?.key,
        definition?.key_code,
        definition?.code,
        definition?.value,
        definition?.name,
        definition?.key_name,
        definition?.raw_key,
      ].map((value) => this.normalizeRemoteKey(value)).filter(Boolean);
      if (values.some((value) => normalized.includes(value))) return definition;
    }
    return null;
  }

  private keyCandidates(command: Record<string, any>) {
    const direct = cleanStr(
      (command as any).key ||
      (command as any).key_code ||
      (command as any).remote_key ||
      (command as any).command_key ||
      (command as any).code ||
      (command as any).button ||
      (command as any).control ||
      (command as any).remote,
    );
    const normalized = this.normalizeRemoteKey(direct);
    if (normalized === "power_toggle") return ["power", "power_toggle", "poweron", "poweroff", "on", "off"];
    if (normalized === "nav_up") return ["up", "nav_up", "direction_up"];
    if (normalized === "nav_down") return ["down", "nav_down", "direction_down"];
    if (normalized === "nav_left") return ["left", "nav_left", "direction_left"];
    if (normalized === "nav_right") return ["right", "nav_right", "direction_right"];
    if (normalized === "volume_up") return ["volume_up", "vol_up", "vol+", "volume+"];
    if (normalized === "volume_down") return ["volume_down", "vol_down", "vol-", "volume-"];
    if (normalized === "channel_up") return ["channel_up", "ch_up", "ch+", "channel+"];
    if (normalized === "channel_down") return ["channel_down", "ch_down", "ch-", "channel-"];
    if (normalized === "input") return ["input", "source"];
    if (normalized === "return") return ["back", "return"];
    if (normalized === "back") return ["back", "return"];
    if (normalized === "home") return ["home", "homepage"];
    if (normalized) return [normalized, direct];

    if (typeof (command as any).power === "boolean" || typeof (command as any).on === "boolean") {
      const desired = typeof (command as any).power === "boolean" ? (command as any).power : (command as any).on;
      return desired
        ? ["poweron", "power_on", "on", "power"]
        : ["poweroff", "power_off", "off", "power"];
    }
    return [];
  }

  private remoteCommandKey(command: Record<string, any>) {
    const direct = this.keyCandidates(command)[0];
    if (direct) return direct;
    if (typeof (command as any).power === "boolean" || typeof (command as any).on === "boolean") return "power";
    if ((command as any).temperature != null || (command as any).temp != null) return "temperature";
    if ((command as any).mode != null) return "mode";
    if ((command as any).fan_speed != null || (command as any).fan != null || (command as any).wind != null) return "fan_speed";
    if ((command as any).swing != null) return "swing";
    return "";
  }

  private unsupportedIrCommandError(message = "This remote does not expose that control.") {
    const error: any = new Error(message);
    error.statusCode = 422;
    error.code = "IR_KEY_NOT_SUPPORTED";
    error.safe_error_message = "This TV remote key is not configured for the connected IR controller.";
    return error;
  }

  private missingIrRemoteBindingError() {
    const error: any = new Error("Add or sync an appliance profile before using this remote.");
    error.statusCode = 422;
    error.code = "IR_REMOTE_BINDING_MISSING";
    error.safe_error_message = "This TV remote is not configured for the connected IR controller.";
    return error;
  }

  private acEnum(value: any, map: Record<string, number>) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const key = cleanStr(value).toLowerCase().replace(/[\s-]+/g, "_");
    return map[key] ?? value;
  }

  private acCommandFields(command: Record<string, any>) {
    const fields: Array<{ code: string; value: any }> = [];
    const power = this.commandValue(command, "power", "on");
    if (typeof power === "boolean" || ["0", "1", "true", "false", "on", "off"].includes(cleanStr(power).toLowerCase())) {
      fields.push({ code: "power", value: toBool(power) ? 1 : 0 });
    }
    const temp = this.commandValue(command, "temperature", "temp", "temp_set");
    if (temp != null && cleanStr(temp)) fields.push({ code: "temp", value: Number(temp) });
    const mode = this.commandValue(command, "mode");
    if (mode != null && cleanStr(mode)) fields.push({ code: "mode", value: this.acEnum(mode, { auto: 0, cool: 1, heat: 2, dry: 3, fan: 4 }) });
    const wind = this.commandValue(command, "fan_speed", "fanSpeed", "fan", "wind", "wind_speed");
    if (wind != null && cleanStr(wind)) fields.push({ code: "wind", value: this.acEnum(wind, { auto: 0, low: 1, medium: 2, med: 2, high: 3 }) });
    return fields;
  }

  private acScenesPayload(command: Record<string, any>) {
    const payload: Record<string, any> = {};
    for (const field of this.acCommandFields(command)) {
      if (field.code === "power") payload.power = field.value;
      if (field.code === "mode") payload.mode = field.value;
      if (field.code === "temp") payload.temp = field.value;
      if (field.code === "wind") payload.wind = field.value;
    }
    return payload;
  }

  private rawCommandPayload(version: string, rawKey: string, appliance: Record<string, any>, context: AdapterContext) {
    const def = this.findSupportedIrKey(context, [rawKey]) || {};
    if (version.startsWith("v2")) {
      return {
        category_id: cleanStr(def.category_id || appliance.category_id),
        key_id: cleanStr(def.key_id || def.id || def.key || def.code || rawKey),
        key: cleanStr(def.key || def.raw_key || def.code || rawKey),
      };
    }
    return {
      raw_key: cleanStr(def.raw_key || def.key_id || def.key || def.code || rawKey),
    };
  }

  async executeIrRemoteCommand(
    infraredId: string,
    remoteId: string,
    command: Record<string, any>,
    context: AdapterContext,
  ): Promise<Record<string, any>> {
    if (!remoteId) throw this.missingIrRemoteBindingError();
    const startedAt = Date.now();
    const appliance = ((context as any)?.device?.metadata?.ir_appliance || {}) as Record<string, any>;
    const family = cleanStr(appliance.appliance_type || (context as any)?.device?.metadata?.device_family || (context as any)?.device?.type).toLowerCase();
    const rawKey = cleanStr((command as any).raw_key || (command as any).rawKey);
    const supportedKeys = this.supportedIrKeys(context);
    const supportedDefinition = this.findSupportedIrKey(context, this.keyCandidates(command));
    const key = cleanStr(this.supportedKeyCode(supportedDefinition) || this.remoteCommandKey(command));
    const shouldUseAcEndpoint = /^(ac|air_conditioner|climate)$/.test(family) && (
      typeof (command as any).power === "boolean" ||
      typeof (command as any).on === "boolean" ||
      (command as any).temperature != null ||
      (command as any).temp != null ||
      (command as any).mode != null ||
      (command as any).fan_speed != null ||
      (command as any).fan != null ||
      (command as any).wind != null
    );

    let result: any;
    if (shouldUseAcEndpoint) {
      const fields = this.acCommandFields(command);
      if (!fields.length) throw new Error("This AC remote does not expose that control.");
      const payload = fields.length > 1 ? this.acScenesPayload(command) : fields[0];
      const endpointKind = fields.length > 1 ? "ac_scenes_command" : "ac_command";
      result = await this.requestIr<any>(
        "POST",
        (version) => fields.length > 1
          ? `/${version}/infrareds/${encodeURIComponent(infraredId)}/air-conditioners/${encodeURIComponent(remoteId)}/scenes/command`
          : `/${version}/infrareds/${encodeURIComponent(infraredId)}/air-conditioners/${encodeURIComponent(remoteId)}/command`,
        payload,
        { context, infraredId, endpointKind },
      );
      logger.info("tuya_ir_command_dispatched", {
        canonical_device_id: (context as any)?.canonicalDevice?.id || null,
        infrared_id: infraredId,
        remote_id: remoteId,
        endpoint_kind: endpointKind,
        payload,
        response: result,
        latency_ms: Date.now() - startedAt,
      });
    } else if (rawKey) {
      result = await this.requestIr<any>(
        "POST",
        (version) => `/${version}/infrareds/${encodeURIComponent(infraredId)}/remotes/${encodeURIComponent(remoteId)}/raw/command`,
        (version: string) => this.rawCommandPayload(version, rawKey, appliance, context),
        { context, infraredId, endpointKind: "raw_remote_command" },
      );
      logger.info("tuya_ir_command_dispatched", {
        canonical_device_id: (context as any)?.canonicalDevice?.id || null,
        infrared_id: infraredId,
        remote_id: remoteId,
        endpoint_kind: "raw_remote_command",
        payload: { raw_key: rawKey },
        response: result,
        latency_ms: Date.now() - startedAt,
      });
    } else {
      if (!key) throw this.unsupportedIrCommandError();
      if (supportedKeys.length && !supportedDefinition) throw this.unsupportedIrCommandError();
      const standardPayload = {
        key: cleanStr(supportedDefinition?.key || supportedDefinition?.key_code || supportedDefinition?.code || key),
      };
      let dispatchedEndpointKind = "remote_command";
      logger.info("tuya_ir_key_definition_selected", {
        canonical_device_id: (context as any)?.canonicalDevice?.id || null,
        infrared_id: infraredId,
        remote_id: remoteId,
        canonical_key: key,
        provider_key: standardPayload.key,
        provider_key_id: cleanStr(supportedDefinition?.key_id || supportedDefinition?.id) || null,
        endpoint_strategy: "remote_command",
      });
      try {
        result = await this.requestIr<any>(
          "POST",
          (version) => `/${version}/infrareds/${encodeURIComponent(infraredId)}/remotes/${encodeURIComponent(remoteId)}/command`,
          standardPayload,
          { context, infraredId, endpointKind: "remote_command" },
        );
      } catch (error) {
        const classified = classifyProviderError(error, { provider: "tuya", operation: "ir_remote_command" });
        const canTryRawKey = Boolean(supportedDefinition?.key_id || supportedDefinition?.id || supportedDefinition?.key);
        if (!canTryRawKey || ["permission_denied", "device_not_linked", "integration_expired", "authentication_failed", "rate_limited"].includes(classified.classification)) {
          throw error;
        }
        logger.warn("tuya_ir_standard_command_fallback_to_raw", {
          canonical_device_id: (context as any)?.canonicalDevice?.id || null,
          infrared_id: infraredId,
          remote_id: remoteId,
          key,
          provider_code: classified.provider_code,
          safe_message: classified.safe_message,
          fallback: "raw_remote_command",
        });
        result = await this.requestIr<any>(
          "POST",
          (version) => `/${version}/infrareds/${encodeURIComponent(infraredId)}/remotes/${encodeURIComponent(remoteId)}/raw/command`,
          (version: string) => this.rawCommandPayload(version, key, appliance, context),
          { context, infraredId, endpointKind: "raw_remote_command" },
        );
        dispatchedEndpointKind = "raw_remote_command";
      }
      logger.info("tuya_ir_command_dispatched", {
        canonical_device_id: (context as any)?.canonicalDevice?.id || null,
        infrared_id: infraredId,
        remote_id: remoteId,
        endpoint_kind: dispatchedEndpointKind,
        payload: standardPayload,
        response: result,
        latency_ms: Date.now() - startedAt,
      });
    }

    if (!tuyaResultAccepted(result)) {
      logger.warn("ir_dispatch_unconfirmed", {
        canonical_device_id: (context as any)?.canonicalDevice?.id || null,
        infrared_id: infraredId,
        remote_id: remoteId,
        response: result,
      });
      const error: any = new Error("The connected provider did not confirm this remote command.");
      error.statusCode = 424;
      error.code = "IR_PROVIDER_DISPATCH_UNCONFIRMED";
      throw error;
    }

    operationalMetrics.increment("oyi_provider_ir_commands_total", { provider: "tuya" });
    providerHealthRegistry.heartbeat("tuya", { latencyMs: Date.now() - startedAt, note: "ir_command_executed", wired: true });
    return {
      provider: "tuya",
      accepted: true,
      dispatched: true,
      confirmation_strategy: "provider_ack_only",
      provider_response: result,
      latency_ms: Date.now() - startedAt,
    };
  }

  private buildTuyaCommands(schema: DeviceSchema, command: Record<string, any>) {
    const entries = Object.entries(command || {});
    const out: Array<{ code: string; value: any }> = [];

    const wantsPower =
      "power" in (command || {}) ||
      "on" in (command || {}) ||
      "state" in (command || {}) ||
      "switch" in (command || {});
    const wantsLock =
      "lock" in (command || {}) ||
      "locked" in (command || {}) ||
      "unlock" in (command || {});

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

    // 2) Lock mapping. Tuya lock models vary widely, so use the provider
    // schema first and only target functions the device actually exposes.
    if (wantsLock && out.length === 0) {
      const raw =
        (command as any)?.lock ??
        (command as any)?.locked ??
        ((command as any)?.unlock === true ? false : undefined);
      const desiredLocked = toBool(raw);
      const candidates = desiredLocked
        ? ["lock", "remote_lock"]
        : ["unlock", "remote_unlock"];
      for (const code of candidates) {
        const fn = schema.functionsByCode[code];
        if (!fn) continue;
        const value = code === "switch" ? desiredLocked : this.coerceValueByFunction(fn, desiredLocked);
        out.push({ code, value });
        break;
      }
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

  async discoverCapabilities(deviceId: string, _context?: AdapterContext): Promise<Record<string, any>> {
    const startedAt = Date.now();
    const schema = await this.getDeviceSchema(deviceId);
    const metadata: Record<string, any> = await this.getCachedDeviceMetadata(deviceId).catch(() => ({}));
    logger.info("tuya_smart_access_capability_evidence", {
      device_id: deviceId,
      real_category: metadata?.raw?.category || metadata?.category || null,
      product_name: metadata?.raw?.product_name || metadata?.product_name || null,
      model: metadata?.raw?.model || metadata?.model || null,
      function_codes: Object.keys(schema.functionsByCode),
      latency_ms: Date.now() - startedAt,
    });
    return {
      provider: "tuya",
      category: metadata?.raw?.category || metadata?.category || null,
      product_id: metadata?.raw?.product_id || metadata?.product_id || null,
      product_name: metadata?.raw?.product_name || metadata?.product_name || null,
      model: metadata?.raw?.model || metadata?.model || null,
      functions: schema.functions,
      function_codes: Object.keys(schema.functionsByCode),
      source: "tuya_functions_schema",
    };
  }

  async readSmartAccessState(deviceId: string, _context?: AdapterContext): Promise<Record<string, any>> {
    return this.getLiveState(deviceId);
  }

  async listAccessRecords(_deviceId: string, _context?: AdapterContext): Promise<any[]> {
    throw new Error("Tuya access-record lookup is not enabled for this project.");
  }

  async listMembers(_deviceId: string, _context?: AdapterContext): Promise<any[]> {
    throw new Error("Tuya member lookup is not enabled for this project.");
  }

  async createCredential(_deviceId: string, _credential: Record<string, any>, _context?: AdapterContext): Promise<Record<string, any>> {
    throw new Error("Tuya credential creation is not enabled for this project.");
  }

  async revokeCredential(_deviceId: string, _credentialId: string, _context?: AdapterContext): Promise<Record<string, any>> {
    throw new Error("Tuya credential revocation is not enabled for this project.");
  }

  async requestMediaSession(_deviceId: string, _context?: AdapterContext): Promise<Record<string, any>> {
    throw new Error("This Tuya access device does not expose an Oyi media session.");
  }

  /* ------------------------------------------------
   * COMMAND
   * ------------------------------------------------ */
  async executeCommand(
    deviceId: string,
    command: Record<string, any>,
    _context: AdapterContext
  ): Promise<Record<string, any> | void> {
    const startedAt = Date.now();
    const remoteId = cleanStr(
      (_context as any)?.device?.metadata?.ir_appliance?.remote_id ||
      (_context as any)?.device?.metadata?.ir_appliance?.profile_id ||
      (_context as any)?.device?.metadata?.remote_id,
    );
    if (remoteId) {
      return this.executeIrRemoteCommand(deviceId, remoteId, command, _context);
    }
    if (/^(tv_remote|ac_remote|ir_remote|climate)$/i.test(String((command as any)?.type || ""))) throw this.missingIrRemoteBindingError();
    const schema = await this.getDeviceSchema(deviceId);

    const commands = this.buildTuyaCommands(schema, command);
    logger.debug("tuya_command_classification", {
      device_id: deviceId,
      capability_codes: Object.keys(schema.functionsByCode),
      switch_codes: schema.switchCodes,
      primary_power_code: schema.primaryPowerCode,
      command,
    });

    if (!commands.length) {
      logger.warn("tuya_command_no_supported_mapping", {
        device_id: deviceId,
        incoming: command,
        supported: Object.keys(schema.functionsByCode).slice(0, 30),
      });
      throw new Error("No supported command mapping for this device");
    }

    await this.client.request("POST", `/v1.0/iot-03/devices/${deviceId}/commands`, { commands });

    operationalMetrics.increment("oyi_provider_commands_total", { provider: "tuya" });
    providerHealthRegistry.heartbeat("tuya", { latencyMs: Date.now() - startedAt, note: "command_executed", wired: true });
    return {
      provider: "tuya",
      accepted: true,
      dispatched: true,
      confirmation_strategy: "observable_state",
      latency_ms: Date.now() - startedAt,
    };
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
