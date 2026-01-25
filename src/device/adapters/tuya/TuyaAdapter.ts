/// src/device/adapters/tuya/TuyaAdapter.ts

import { TuyaClient } from "./tuyaClient";
import { DeviceAdapter } from "../DeviceAdapter";
import { AdapterContext, DiscoveredDevice } from "../types";
import { Signal } from "../../../core/control-plane/contracts/signal.types";

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
    // Tuya commonly requires pagination params here
    // and returns { list: [...], total: n, page_no, page_size }
    const pageSize = 100;
    let pageNo = 1;

    const all: any[] = [];

    while (true) {
      const path = `/v1.0/iot-03/devices?page_no=${pageNo}&page_size=${pageSize}`;
      const result = await this.client.request<any>("GET", path);

      const list: any[] = Array.isArray(result?.list)
        ? result.list
        : Array.isArray(result)
          ? result
          : [];

      all.push(...list);

      // Stop if returned less than pageSize (no more pages)
      if (list.length < pageSize) break;

      pageNo += 1;

      // safety break (avoid infinite loop)
      if (pageNo > 50) break;
    }

    return all.map((d) => ({
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
    const commands = Object.entries(command).map(([code, value]) => ({ code, value }));

    await this.client.request(
      "POST",
      `/v1.0/iot-03/devices/${deviceId}/commands`,
      { commands }
    );
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
