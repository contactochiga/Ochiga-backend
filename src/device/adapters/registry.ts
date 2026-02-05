// src/device/adapters/registry.ts
import { DeviceAdapter } from "./DeviceAdapter";
import { SSDPAdapter } from "./network/SSDPAdapter";
import { OnvifAdapter } from "./onvif/OnvifAdapter";

const adapters: Record<string, DeviceAdapter> = {
  ssdp: new SSDPAdapter(),
  onvif: new OnvifAdapter(),
};

export function getAdapter(name: string): DeviceAdapter | null {
  return adapters[name] ?? null;
}

export function listAdapters(): string[] {
  return Object.keys(adapters);
}
