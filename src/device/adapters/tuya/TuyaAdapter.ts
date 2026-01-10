// src/device/adapters/tuya/TuyaAdapter.ts

import { TuyaClient } from "./tuyaClient";
import { DeviceAdapter } from "../DeviceAdapter";
import { AdapterContext, DiscoveredDevice } from "../types";

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
    const devices = await this.client.request<any[]>(
      "GET",
      "/v1.0/iot-03/devices"
    );

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
    device: DiscoveredDevice,
    context: AdapterContext
  ): Promise<void> {
    // Tuya cloud devices are already bound at vendor level
    return;
  }

  /* ------------------------------------------------
   * COMMAND
   * ------------------------------------------------ */
  async executeCommand(
    deviceId: string,
    command: Record<string, any>,
    context: AdapterContext
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
   * EVENT STREAM (NEXT PHASE)
   * ------------------------------------------------ */
  async startEventStream(): Promise<void> {
    // Will hook Tuya Message Service / MQTT later
    return;
  }
}
