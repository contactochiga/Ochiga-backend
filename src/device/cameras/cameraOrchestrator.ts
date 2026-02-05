// src/device/cameras/cameraOrchestrator.ts
import type { AdapterContext, DiscoveredDevice } from "../adapters/types";
import { getAdapter } from "../adapters/registry";

function uniqByIp(devices: DiscoveredDevice[]) {
  const seen = new Map<string, DiscoveredDevice>();
  for (const d of devices) {
    const ip =
      d?.metadata?.raw?.ip ||
      d?.metadata?.raw?.onvif?.ip ||
      d?.externalId ||
      "";
    if (!ip) continue;

    if (!seen.has(String(ip))) {
      seen.set(String(ip), d);
    }
  }
  return Array.from(seen.values());
}

export async function scanCameras(context: AdapterContext) {
  // For cameras, ONVIF is primary. SSDP is optional helper.
  const onvif = getAdapter("onvif");
  const ssdp = getAdapter("ssdp");

  const results: DiscoveredDevice[] = [];

  if (ssdp) {
    // SSDP can give hints, but doesn't guarantee camera
    const a = await ssdp.discover(context).catch(() => []);
    results.push(...a);
  }

  if (onvif) {
    const b = await onvif.discover(context).catch(() => []);
    results.push(...b);
  }

  // keep only camera-like
  const cameraLike = results.filter((d) => {
    if (d.category === "camera") return true;
    const caps = d.capabilities || [];
    if (caps.includes("onvif")) return true;
    return false;
  });

  return uniqByIp(cameraLike);
}
