type DeviceScopeEntry = {
  device: Record<string, any>;
  expires_at: number;
};

const DEVICE_SCOPE_TTL_MS = 30_000;
const MAX_DEVICE_SCOPE_ENTRIES = 50_000;

class DeviceReadScopeCache {
  private readonly entries = new Map<string, DeviceScopeEntry>();

  get(deviceId: string, estateId: string) {
    const key = String(deviceId || "").trim();
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expires_at <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    if (String(entry.device?.estate_id || "") !== String(estateId || "")) return null;
    return entry.device;
  }

  set(device: Record<string, any>) {
    const key = String(device?.id || "").trim();
    if (!key || !device?.estate_id) return;
    this.entries.set(key, { device, expires_at: Date.now() + DEVICE_SCOPE_TTL_MS });
    while (this.entries.size > MAX_DEVICE_SCOPE_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }

  setMany(devices: Array<Record<string, any>>) {
    devices.forEach((device) => this.set(device));
  }

  invalidate(deviceId: string) {
    this.entries.delete(String(deviceId || "").trim());
  }
}

export const deviceReadScopeCache = new DeviceReadScopeCache();
