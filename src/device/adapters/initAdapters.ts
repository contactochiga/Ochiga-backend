// src/device/adapters/initAdapters.ts

import { adapterRegistry } from "./registry";

import { TuyaAdapter } from "./tuya/TuyaAdapter";
import { SSDPAdapter } from "./network/SSDPAdapter";
import { OnvifAdapter } from "./onvif/OnvifAdapter";

// optional: if your ipScan is implemented as an Adapter class, import it here
// import { IpScanAdapter } from "./network/IpScanAdapter";

let initialized = false;

export function initAdaptersOnce() {
  if (initialized) return;
  initialized = true;

  // Register Tuya
  try {
    adapterRegistry.register(new TuyaAdapter());
  } catch {}

  // Register SSDP
  try {
    adapterRegistry.register(new SSDPAdapter());
  } catch {}

  // Register ONVIF
  try {
    adapterRegistry.register(new OnvifAdapter());
  } catch {}

  // If you have a dedicated IP Scan adapter class, register it too
  // try { adapterRegistry.register(new IpScanAdapter()); } catch {}
}
