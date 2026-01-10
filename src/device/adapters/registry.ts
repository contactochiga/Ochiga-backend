// src/device/adapters/registry.ts

import { DeviceAdapter } from "./DeviceAdapter";

class AdapterRegistry {
  private adapters = new Map<string, DeviceAdapter>();

  register(adapter: DeviceAdapter) {
    if (this.adapters.has(adapter.name)) {
      throw new Error(`Adapter already registered: ${adapter.name}`);
    }
    this.adapters.set(adapter.name, adapter);
  }

  get(name: string): DeviceAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      throw new Error(`Adapter not found: ${name}`);
    }
    return adapter;
  }

  list(): DeviceAdapter[] {
    return Array.from(this.adapters.values());
  }
}

export const adapterRegistry = new AdapterRegistry();
