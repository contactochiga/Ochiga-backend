// src/device/adapters/tuya/TuyaAdapter.ts

import { TuyaClient } from "./tuyaClient";
import { DeviceAdapter } from "../DeviceAdapter";
import { DiscoveredDevice } from "../types";

export class TuyaAdapter extends DeviceAdapter {
  private client = new TuyaClient();

  /* ------------------------------------------------
   * ADAPTER METADATA
   * ------------------------------------------------ */
  readonly adapterId = "tuya";
  readonly adapterName = "Tuya Cloud Adapter";

  /* ------------------------------------------------
   * DISCOVERY
   * ------------------------------------------------ */
  async discover(): Promise<DiscoveredDevice[]> {
    // Get all devices under this Tuya project
    const devices = await this.client.request<any[]>(
      "GET",
      "/v1.0/iot-03/devices"
    );

    return devices.map((d) => ({
      externalId: d.id,
      name: d.name || d.local_name,
      model: d.model,
      category: d.category,
      online: d.online,
      manufacturer: "tuya",
      adapter: this.adapterId,
      capabilities: d.functions?.map((f: any) => f.code) || [],
      raw: d,
    }));
  }

  /* ------------------------------------------------
   * STATE
   * ------------------------------------------------ */
  async getState(deviceId: string): Promise<Record<string, any>> {
    const status = await this.client.request<any[]>(
      "GET",
      `/v1.0/iot-03/devices/${deviceId}/status`
    );

    return status.reduce((acc, s) => {
      acc[s.code] = s.value;
      return acc;
    }, {} as Record<string, any>);
  }

  /* ------------------------------------------------
   * COMMAND
   * ------------------------------------------------ */
  async command(
    deviceId: string,
    command: Record<string, any>
  ): Promise<void> {
    const commands = Object.entries(command).map(
      ([code, value]) => ({
        code,
        value,
      })
    );

    await this.client.request(
      "POST",
      `/v1.0/iot-03/devices/${deviceId}/commands`,
      { commands }
    );
  }
}
