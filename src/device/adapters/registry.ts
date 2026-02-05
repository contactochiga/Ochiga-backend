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
