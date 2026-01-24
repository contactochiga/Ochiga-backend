/// src/device/adapters/tuya/TuyaAdapter.ts

import { TuyaClient } from "./tuyaClient";
import { DeviceAdapter } from "../DeviceAdapter";
import { AdapterContext, DiscoveredDevice } from "../types";
import { Signal } from "../../../core/control-plane/contracts/signal.types";

type TuyaDevice = {
  id: string;
  name?: string;
  local_name?: string;
  category?: string;
  online?: boolean;
  model?: string;
  firmware_version?: string;
  functions?: Array<{ code: string }>;
};

function unwrapTuyaResult<T>(res: any): T {
  // Tuya responses commonly look like:
  // { success: true, result: ... }
  // { result: { list: [...] } }
  if (!res) return res;

  if (typeof res === "object" && "result" in res) return res.result as T;
  return res as T;
}

function normalizeDeviceList(res: any): TuyaDevice[] {
  const result = unwrapTuyaResult<any>(res);

  // possibilities:
  // 1) result is an array
  if (Array.isArray(result)) return result as TuyaDevice[];

  // 2) result.list
  if (result?.list && Array.isArray(result.list)) return result.list as TuyaDevice[];

  // 3) result.devices
  if (result?.devices && Array.isArray(result.devices)) return result.devices as TuyaDevice[];

  // 4) fallback
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

  /* ------------------------------------------------
   * DISCOVERY
   * ------------------------------------------------ */
  async discover(_context: AdapterContext): Promise<DiscoveredDevice[]> {
    // IMPORTANT:
    // - Use paging params (no device_ids) to avoid Tuya 1109 issues.
    // - Your TuyaClient should put these in querystring for GET.
    const res = await this.client.request<any>(
      "GET",
      "/v1.0/iot-03/devices",
      {
        page_no: 1,
        page_size: 100,
      }
    );

    const devices = normalizeDeviceList(res);

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

  /* ------------------------------------------------
   * BIND
   * ------------------------------------------------ */
  async bindDevice(
    _device: DiscoveredDevice,
    _context: AdapterContext
  ): Promise<void> {
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
    const commands = Object.entries(command).map(([code, value]) => ({
      code,
      value,
    }));

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
