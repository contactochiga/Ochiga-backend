// src/device/adapters/registry.ts
import type { DeviceAdapter } from "./DeviceAdapter";

/**
 * Central adapter registry used by:
 * - discovery controller
 * - initAdapters bootstrap
 * - intent worker execution
 */
export const adapterRegistry: Map<string, DeviceAdapter> = new Map();

export function registerAdapter(adapter: DeviceAdapter) {
  adapterRegistry.set(adapter.name, adapter);
}

export function getAdapter(name: string): DeviceAdapter | undefined {
  return adapterRegistry.get(name);
}

export function listAdapters(): DeviceAdapter[] {
  return Array.from(adapterRegistry.values());
}
