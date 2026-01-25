/// src/device/adapters/tuya/TuyaAdapter.ts

import { TuyaClient } from "./tuyaClient";
import { DeviceAdapter } from "../DeviceAdapter";
import { AdapterContext, DiscoveredDevice } from "../types";
import { Signal } from "../../../core/control-plane/contracts/signal.types";

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

    // Optional: allow forcing a specific listing dimension if your project needs it
    // Docs: source_type defaults to "asset" if omitted.  [oai_citation:1‡Tuya Developer](https://developer.tuya.com/en/docs/cloud/dc413408fe?id=Kc09y2ons2i3b)
    const sourceType =
      (process.env.TUYA_SOURCE_TYPE || "").trim() || undefined; // asset | homeApp | tuyaUser | product
    const sourceId = (process.env.TUYA_SOURCE_ID || "").trim() || undefined;

    const pageSize = Math.min(
      200,
      Math.max(1, Number(process.env.TUYA_PAGE_SIZE || 200))
    );

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

      console.log("[TuyaAdapter.discover] requesting:", path);

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

    // Map Tuya -> your DiscoveredDevice canonical shape
    const discovered: DiscoveredDevice[] = all.map((d) => ({
      externalId: d.id,
      adapter: this.name,
      name: d.name || "Unknown device",
      category: d.category || "unknown",
      online: Boolean(d.online),
      capabilities: [], // v1.3 list does NOT return functions/spec; keep empty for now
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

    console.log("[TuyaAdapter.discover] done. devices=", discovered.length);

    // If you’re still seeing 0, it often means your project has no devices under the default dimension (asset).
    // In that case, set TUYA_SOURCE_TYPE + TUYA_SOURCE_ID (see note below).
    return discovered;
  }

  /* ------------------------------------------------
   * BIND
   * ------------------------------------------------ */
  async bindDevice(_device: DiscoveredDevice, _context: AdapterContext): Promise<void> {
    // Tuya devices are already vendor-bound
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
    const commands = Object.entries(command).map(([code, value]) => ({ code, value }));

    await this.client.request(
      "POST",
      `/v1.0/iot-03/devices/${deviceId}/commands`,
      { commands }
    );
  }

  /* ------------------------------------------------
   * EVENT STREAM (REQUIRED BY INTERFACE)
   * ------------------------------------------------ */
  async startEventStream(
    _context: AdapterContext,
    _emit: (signal: Signal) => Promise<void>
  ): Promise<void> {
    // Tuya Message Service / MQTT will be wired here later
    return;
  }

  async shutdown(): Promise<void> {
    return;
  }
}
