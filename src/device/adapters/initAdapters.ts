// src/device/adapters/initAdapters.ts

import { adapterRegistry } from "./registry";

import { TuyaAdapter } from "./tuya/TuyaAdapter";
import { SSDPAdapter } from "./network/SSDPAdapter";
import { providerHealthRegistry } from "../../observability/providerHealth";
import { logger } from "../../observability/logger";

let initialized = false;

export function initAdaptersOnce() {
  if (initialized) return;
  initialized = true;

  providerHealthRegistry.markPlaceholder("matter", "placeholder_not_wired");
  providerHealthRegistry.markPlaceholder("ble", "placeholder_not_wired");
  providerHealthRegistry.markPlaceholder("thread", "placeholder_not_wired");
  providerHealthRegistry.markPlaceholder("zigbee", "placeholder_not_wired");
  providerHealthRegistry.markPlaceholder("modbus", "placeholder_not_wired");
  providerHealthRegistry.markPlaceholder("bacnet", "placeholder_not_wired");
  providerHealthRegistry.markPlaceholder("knx", "placeholder_not_wired");
  providerHealthRegistry.markPlaceholder("ir", "placeholder_not_wired");

  try {
    adapterRegistry.register(new TuyaAdapter());
    providerHealthRegistry.markConfigured("tuya", { note: "adapter_registered" });
  } catch (error) {
    providerHealthRegistry.markOffline("tuya", error instanceof Error ? error.message : "adapter_registration_failed");
    logger.warn("tuya_adapter_registration_failed", { error });
  }

  try {
    adapterRegistry.register(new SSDPAdapter());
  } catch (error) {
    logger.warn("ssdp_adapter_registration_failed", { error });
  }

  // Camera discovery is executed only by authenticated Oyi Edge nodes.
  // Keep provider observability truthful without registering a cloud LAN scanner.
  providerHealthRegistry.markPlaceholder("onvif", "edge_runtime_only");
}
