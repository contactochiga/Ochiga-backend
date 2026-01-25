// src/device/adapters/tuya/TuyaAdapter.ts

import { TuyaClient } from "./tuyaClient";
import { DeviceAdapter } from "../DeviceAdapter";
import { AdapterContext, DiscoveredDevice } from "../types";
import { Signal } from "../../../core/control-plane/contracts/signal.types";

type TuyaDevice = {
  id: string;
  name?: string;
  category?: string;
  online?: boolean;
  model?: string;
  firmware_version?: string;
  local_name?: string;
};

type CursorPage<T> = {
  list?: T[];
  has_more?: boolean;
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
    // Optional: let you filter devices by dimension (recommended for real Tuya Smart app devices)
    // Tuya docs: source_type + source_id control which “dimension” you list devices from.  [oai_citation:1‡Tuya Developer](https://developer.tuya.com/en/docs/cloud/0f866b1299?id=Kb3d6972ym5np)
    const sourceType =
      (context as any)?.credentials?.tuya_source_type ||
      process.env.TUYA_SOURCE_TYPE ||
      undefined;

    const sourceId =
      (context as any)?.credentials?.tuya_source_id ||
      process.env.TUYA_SOURCE_ID ||
      undefined;

    const pageSize = 200;

    const all: TuyaDevice[] = [];
    let lastRowKey: string | undefined;

    while (true) {
      const qs = new URLSearchParams();
      qs.set("page_size", String(pageSize));
      if (sourceType) qs.set("source_type", String(sourceType));
      if (sourceId) qs.set("source_id", String(sourceId));
      if (lastRowKey) qs.set("last_row_key", lastRowKey);

      // ✅ Correct version for iot-03 device list
      const path = `/v1.2/iot-03/devices?${qs.toString()}`;

      const page = await this.client.request<CursorPage<TuyaDevice>>("GET", path);

      const list = Array.isArray(page?.list) ? page.list : [];
      all.push(...list);

      const hasMore = Boolean(page?.has_more);
      lastRowKey = page?.last_row_key;

      if (!hasMore || !lastRowKey) break;
    }

    return all.map((d) => ({
      externalId: d.id,
      adapter: this.name,
      name: d.name || d.local_name || "Unknown device",
      category: (d.category as any) || "unknown",
      online: Boolean(d.online),
      // device list endpoint doesn’t always include "functions" — keep safe
      capabilities: [],
      protocols: ["cloud", "wifi"],
      metadata: {
        manufacturer: "Tuya",
        model: d.model,
        firmwareVersion: (d as any).firmware_version,
        raw: d,
      },
    }));
  }

  async bindDevice(_device: DiscoveredDevice, _context: AdapterContext): Promise<void> {
    return;
  }

  async executeCommand(
    deviceId: string,
    command: Record<string, any>,
    _context: AdapterContext
  ): Promise<void> {
    const commands = Object.entries(command).map(([code, value]) => ({ code, value }));

    await this.client.request("POST", `/v1.0/iot-03/devices/${deviceId}/commands`, {
      commands,
    });
  }

  async startEventStream(_context: AdapterContext, _emit: (signal: Signal) => Promise<void>) {
    return;
  }

  async shutdown(): Promise<void> {
    return;
  }
}
