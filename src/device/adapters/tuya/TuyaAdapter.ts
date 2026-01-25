/// src/device/adapters/tuya/TuyaAdapter.ts

import { TuyaClient } from "./tuyaClient";
import { DeviceAdapter } from "../DeviceAdapter";
import { AdapterContext, DiscoveredDevice } from "../types";
import { Signal } from "../../../core/control-plane/contracts/signal.types";

function normalizeList(result: any): any[] {
  if (!result) return [];
  if (Array.isArray(result)) return result;

  // common Tuya shapes
  if (Array.isArray(result.list)) return result.list;
  if (Array.isArray(result.devices)) return result.devices;

  // sometimes nested again
  if (result.result) return normalizeList(result.result);

  return [];
}

export class TuyaAdapter implements DeviceAdapter {
  readonly name = "tuya";
  readonly vendor = "Tuya";
  readonly protocols = ["cloud", "wifi"];

  private client: TuyaClient;

  constructor(client?: TuyaClient) {
    this.client = client ?? new TuyaClient();
  }

  async discover(_context: AdapterContext): Promise<DiscoveredDevice[]> {
    // add page_size to avoid default tiny pages on some Tuya configs
    const result = await this.client.request<any>(
      "GET",
      "/v1.0/iot-03/devices?page_size=100"
    );

    const list = normalizeList(result);

    // ✅ DEBUG: prove what Tuya is returning (so we stop guessing)
    console.log("[TuyaAdapter.discover] raw result keys:", result ? Object.keys(result) : null);
    console.log("[TuyaAdapter.discover] normalized list length:", list.length);

    return list.map((d: any) => ({
      externalId: d.id,
      adapter: this.name,
      name: d.name || d.local_name || "Unknown device",
      category: d.category || "unknown",
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
