// src/device/adapters/registry.ts
import type { DeviceAdapter } from "./DeviceAdapter";

const store = new Map<string, DeviceAdapter>();

export const adapterRegistry = {
  register(adapter: DeviceAdapter) {
    store.set(adapter.name, adapter);
  },

  get(name: string) {
    return store.get(name);
  },

  list() {
    return Array.from(store.values());
  },

  has(name: string) {
    return store.has(name);
  },
};

// ✅ Backward-compatible named exports
export function getAdapter(name: string) {
  return adapterRegistry.get(name);
}

export function listAdapters() {
  return adapterRegistry.list();
}
