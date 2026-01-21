// src/device/adapters/initAdapters.ts

import { adapterRegistry } from "./registry";

import { TuyaAdapter } from "./tuya/TuyaAdapter";
import { SSDPAdapter } from "./network/SSDPAdapter";
import { OnvifAdapter } from "./onvif/OnvifAdapter";
import { IPScanAdapter } from "./network/IPScanAdapter";

let initialized = false;

export function initAdaptersOnce() {
  if (initialized) return;
  initialized = true;

  try { adapterRegistry.register(new TuyaAdapter()); } catch {}
  try { adapterRegistry.register(new SSDPAdapter()); } catch {}
  try { adapterRegistry.register(new OnvifAdapter()); } catch {}
  try { adapterRegistry.register(new IPScanAdapter()); } catch {}
}
