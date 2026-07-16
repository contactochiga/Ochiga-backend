import { createHash } from "crypto";
import { adapterRegistry } from "../device/adapters/registry";
import { initAdaptersOnce } from "../device/adapters/initAdapters";
import type { DiscoveredDevice } from "../device/adapters/types";
import {
  candidateTypeForDevice,
  type DiscoveryClassification,
  type InfrastructureProviderManifest,
  type NormalizedDiscoveryCandidate,
  type ProviderDiscoveryInput,
} from "./types";

const manifests: InfrastructureProviderManifest[] = [
  { key: "tuya", label: "Tuya / Smart Life", adapter_key: "tuya", implementation: "active", discovery_mode: "cloud", authentication_methods: ["linked_account"], object_types: ["device", "gateway", "sensor", "camera", "controller"], protocols: ["cloud", "wifi", "zigbee", "ble", "ir"], requires_edge: false, supports_discovery: true, supports_import: true, supports_verification: true },
  { key: "onvif", label: "ONVIF Cameras", adapter_key: "onvif", implementation: "active", discovery_mode: "local_network", authentication_methods: ["username_password", "local_credentials"], object_types: ["camera"], protocols: ["onvif", "rtsp", "http"], requires_edge: true, supports_discovery: true, supports_import: true, supports_verification: true },
  { key: "ssdp", label: "Local Network / UPnP", adapter_key: "ssdp", implementation: "active", discovery_mode: "local_network", authentication_methods: ["none"], object_types: ["device", "gateway", "controller", "system"], protocols: ["ssdp", "upnp", "http"], requires_edge: true, supports_discovery: true, supports_import: true, supports_verification: true },
  { key: "oyi_edge", label: "Oyi Edge", adapter_key: null, implementation: "active", discovery_mode: "edge", authentication_methods: ["api_token"], object_types: ["device", "camera", "gateway", "controller", "meter", "access_system", "sensor", "power_system", "infrastructure_asset"], protocols: ["mqtt", "http", "onvif", "rtsp", "modbus", "local"], requires_edge: false, supports_discovery: true, supports_import: true, supports_verification: true },
  { key: "rtsp", label: "RTSP / DVR / NVR", adapter_key: null, implementation: "manual_import", discovery_mode: "local_network", authentication_methods: ["username_password", "local_credentials"], object_types: ["camera", "dvr_nvr"], protocols: ["rtsp"], requires_edge: true, supports_discovery: false, supports_import: true, supports_verification: true, notes: "Use the existing DVR/NVR import path when discovery is unavailable." },
  { key: "mqtt", label: "MQTT", adapter_key: null, implementation: "adapter_required", discovery_mode: "edge", authentication_methods: ["username_password", "api_token"], object_types: ["device", "gateway", "sensor", "controller"], protocols: ["mqtt"], requires_edge: true, supports_discovery: false, supports_import: false, supports_verification: false },
  { key: "matter", label: "Matter", adapter_key: null, implementation: "adapter_required", discovery_mode: "edge", authentication_methods: ["qr_pairing", "device_pin"], object_types: ["device", "gateway", "sensor", "controller"], protocols: ["matter", "thread", "wifi"], requires_edge: true, supports_discovery: false, supports_import: false, supports_verification: false },
  { key: "homekit", label: "Apple HomeKit", adapter_key: null, implementation: "adapter_required", discovery_mode: "edge", authentication_methods: ["device_pin", "network_pairing"], object_types: ["device", "gateway", "sensor", "controller"], protocols: ["homekit", "thread", "wifi", "ble"], requires_edge: true, supports_discovery: false, supports_import: false, supports_verification: false },
  { key: "esphome", label: "ESPHome", adapter_key: null, implementation: "adapter_required", discovery_mode: "edge", authentication_methods: ["api_token", "local_credentials"], object_types: ["device", "sensor", "controller"], protocols: ["esphome", "wifi"], requires_edge: true, supports_discovery: false, supports_import: false, supports_verification: false },
  { key: "home_assistant", label: "Home Assistant", adapter_key: null, implementation: "adapter_required", discovery_mode: "local_network", authentication_methods: ["api_token", "oauth"], object_types: ["system", "device", "sensor", "camera"], protocols: ["http", "websocket", "mqtt"], requires_edge: true, supports_discovery: false, supports_import: false, supports_verification: false },
  { key: "shelly", label: "Shelly", adapter_key: null, implementation: "adapter_required", discovery_mode: "local_network", authentication_methods: ["local_credentials", "none"], object_types: ["device", "meter", "controller"], protocols: ["http", "mqtt", "wifi"], requires_edge: true, supports_discovery: false, supports_import: false, supports_verification: false },
  { key: "modbus", label: "Modbus", adapter_key: null, implementation: "adapter_required", discovery_mode: "edge", authentication_methods: ["local_credentials"], object_types: ["meter", "controller", "power_system", "infrastructure_asset"], protocols: ["modbus_tcp", "modbus_rtu"], requires_edge: true, supports_discovery: false, supports_import: false, supports_verification: false },
  { key: "bacnet", label: "BACnet", adapter_key: null, implementation: "future", discovery_mode: "edge", authentication_methods: ["local_credentials"], object_types: ["system", "controller", "infrastructure_asset"], protocols: ["bacnet_ip"], requires_edge: true, supports_discovery: false, supports_import: false, supports_verification: false },
  { key: "knx", label: "KNX", adapter_key: null, implementation: "future", discovery_mode: "edge", authentication_methods: ["local_credentials"], object_types: ["system", "controller", "device"], protocols: ["knx_ip"], requires_edge: true, supports_discovery: false, supports_import: false, supports_verification: false },
  { key: "access_control", label: "Gate and Access Control", adapter_key: null, implementation: "adapter_required", discovery_mode: "edge", authentication_methods: ["api_token", "username_password", "local_credentials"], object_types: ["access_system", "controller"], protocols: ["http", "mqtt", "local"], requires_edge: true, supports_discovery: false, supports_import: false, supports_verification: false },
  { key: "smart_meter", label: "Smart Meters", adapter_key: null, implementation: "adapter_required", discovery_mode: "edge", authentication_methods: ["api_token", "local_credentials"], object_types: ["meter", "power_system"], protocols: ["modbus", "mqtt", "http"], requires_edge: true, supports_discovery: false, supports_import: false, supports_verification: false },
];

export function listInfrastructureProviderManifests() {
  initAdaptersOnce();
  return manifests.map((manifest) => ({
    ...manifest,
    adapter_registered: manifest.adapter_key ? adapterRegistry.has(manifest.adapter_key) : manifest.key === "oyi_edge",
  }));
}

export function getInfrastructureProviderManifest(key: string) {
  return manifests.find((manifest) => manifest.key === String(key || "").trim().toLowerCase()) || null;
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function stableIdentity(provider: string, device: DiscoveredDevice) {
  const externalId = clean(device.externalId);
  if (externalId) return `${provider}:${externalId}`;
  const fingerprint = JSON.stringify({ name: device.name, category: device.category, metadata: device.metadata || {} });
  return `${provider}:unknown:${createHash("sha256").update(fingerprint).digest("hex").slice(0, 24)}`;
}

function classify(input: ProviderDiscoveryInput, device: DiscoveredDevice): { classification: DiscoveryClassification; reason: string } {
  if (input.provider.implementation === "future") return { classification: "unsupported", reason: "This provider is not available in the current runtime." };
  if (input.provider.implementation === "adapter_required") return { classification: "needs_adapter", reason: "A provider adapter is required before this system can be imported." };
  if (input.provider.requires_edge && !input.hasOnlineEdge && !input.allowLocalScan) return { classification: "needs_edge", reason: "An online Oyi Edge node is required to reach this local system." };
  if (!clean(device.externalId)) return { classification: "unknown", reason: "The source did not provide a stable identity." };
  return { classification: "compatible", reason: "The provider is available and supplied a stable identity." };
}

export async function discoverWithInfrastructureProvider(input: ProviderDiscoveryInput): Promise<NormalizedDiscoveryCandidate[]> {
  initAdaptersOnce();
  if (!input.provider.adapter_key) return [];
  const adapter = adapterRegistry.get(input.provider.adapter_key);
  if (!adapter) return [];
  const devices = await adapter.discover(input.adapterContext);
  return devices.map((device) => {
    const result = classify(input, device);
    return {
      provider_key: input.provider.key,
      adapter_key: input.provider.adapter_key || input.provider.key,
      identity_key: stableIdentity(input.provider.key, device),
      external_id: clean(device.externalId) || null,
      candidate_type: candidateTypeForDevice(device),
      name: clean(device.name) || "Discovered infrastructure",
      category: clean(device.category) || null,
      classification: result.classification,
      classification_reason: result.reason,
      online: typeof device.online === "boolean" ? device.online : null,
      capabilities: Array.isArray(device.capabilities) ? device.capabilities : [],
      protocols: Array.isArray(device.protocols) ? device.protocols : [],
      provider_metadata: (device.metadata || {}) as Record<string, unknown>,
    };
  });
}
