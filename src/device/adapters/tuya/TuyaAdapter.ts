// src/device/adapters/tuya/TuyaAdapter.ts

import { TuyaClient } from "./tuyaClient";
import { DeviceAdapter } from "../DeviceAdapter";
import { AdapterContext, DiscoveredDevice } from "../types";
import { Signal } from "../../../core/control-plane/contracts/signal.types";

type TuyaDeviceListResult = {
  list: any[];
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
  async discover(_context: AdapterContext): Promise<DiscoveredDevice[]> {
    // ✅ Use the documented endpoint and DON'T send device_ids at all.
    // ✅ Ask for a big page_size to reduce paging headaches.
    const res = await this.client.request<TuyaDeviceListResult>(
      "GET",
      "/v1.2/iot-03/devices?page_size=200"
    );

    const devices = Array.isArray(res?.list) ? res.list : [];

    return devices.map((d) => ({
      externalId: d.id,
      adapter: this.name,
      name: d.name || d.local_name || "Unknown device",
      category: (d.category as any) || "unknown",
      online: Boolean(d.online),
      capabilities: Array.isArray(d.functions)
        ? d.functions.map((f: any) => f.code)
        : [],
      protocols: ["cloud", "wifi"],
      metadata: {
        manufacturer: "Tuya",
        model: d.model,
        firmwareVersion: d.firmware_version,
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

    await this.client.request(
      "POST",
      `/v1.0/iot-03/devices/${deviceId}/commands`,
      { commands }
    );
  }

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
