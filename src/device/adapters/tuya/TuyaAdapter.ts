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

  // some Tuya SDKs / wrappers nest again
  if (result.result) return normalizeList(result.result);

  return [];
}

function safeKeys(o: any) {
  if (!o || typeof o !== "object") return [];
  return Object.keys(o);
}

function pickFirstDeviceId(d: any) {
  return d?.id || d?.device_id || d?.devId || d?.externalId || "-";
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
    // NOTE:
    // - "/v1.0/iot-03/devices" is valid for many Tuya IoT projects (cloud devices under project).
    // - If your project isn’t linked to any devices, it will return 200 with empty list.
    // - If your devices live only in Smart Life/Tuya App, you may need TUYA_UID fallback.

    const projectPath = "/v1.0/iot-03/devices?page_size=100";

    console.log("[TuyaAdapter.discover] starting…");
    console.log("[TuyaAdapter.discover] using project path:", projectPath);

    const result = await this.client.request<any>("GET", projectPath);

    const list = normalizeList(result);

    // ✅ DEBUG LOGS (paste these back to me)
    console.log("[TuyaAdapter.discover] raw result keys:", safeKeys(result));
    console.log("[TuyaAdapter.discover] normalized list length:", list.length);
    console.log("[TuyaAdapter.discover] sample device id:", list[0] ? pickFirstDeviceId(list[0]) : "none");
    console.log(
      "[TuyaAdapter.discover] sample device keys:",
      list[0] ? safeKeys(list[0]) : "none"
    );

    // ✅ Optional fallback to App-user devices (ONLY if you set TUYA_UID)
    // This is useful when project device list is empty but you actually have devices in Smart Life.
    let finalList = list;

    if (!finalList.length && process.env.TUYA_UID) {
      const uid = String(process.env.TUYA_UID).trim();
      const userPath = `/v1.0/users/${uid}/devices`;

      console.log("[TuyaAdapter.discover] project list empty → trying TUYA_UID fallback");
      console.log("[TuyaAdapter.discover] using user path:", userPath);

      try {
        const byUser = await this.client.request<any>("GET", userPath);
        const userList = normalizeList(byUser);

        console.log("[TuyaAdapter.discover] user result keys:", safeKeys(byUser));
        console.log("[TuyaAdapter.discover] user normalized length:", userList.length);
        console.log("[TuyaAdapter.discover] user sample device id:", userList[0] ? pickFirstDeviceId(userList[0]) : "none");

        finalList = userList;
      } catch (e: any) {
        console.log("[TuyaAdapter.discover] TUYA_UID fallback failed:", e?.message || e);
        // keep empty finalList
      }
    }

    return finalList.map((d: any) => ({
      externalId: d.id || d.device_id || d.devId || d.externalId,
      adapter: this.name,
      name: d.name || d.local_name || "Unknown device",
      category: d.category || d.product_id || "unknown",
      online: Boolean(d.online ?? d.isOnline ?? d.status === "online"),
      capabilities: Array.isArray(d.functions)
        ? d.functions.map((f: any) => f.code)
        : Array.isArray(d.capabilities)
        ? d.capabilities
        : [],
      protocols: ["cloud", "wifi"],
      metadata: {
        manufacturer: "Tuya",
        model: d.model || d.product_name || d?.metadata?.model,
        firmwareVersion: d.firmware_version || d?.metadata?.firmwareVersion,
        raw: d,
      },
    }));
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
