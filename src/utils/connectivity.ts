// src/utils/connectivity.ts

import ping from "ping";
import { DiscoveredDevice, DeviceProtocol } from "../device/adapters/types";

export interface ConnectivityScore {
  protocol: DeviceProtocol;
  signalStrength: number;
  latency: number;
  reliability: number;
  overall: number;
}

/**
 * Evaluate all supported protocols for a given device
 */
export async function evaluateDeviceConnectivity(
  device: DiscoveredDevice & { ip?: string }
): Promise<ConnectivityScore[]> {
  const scores: ConnectivityScore[] = [];

  for (const proto of device.protocols || []) {
    let signal = 50;
    let latencyMs = 50;
    let reliability = 80;

    switch (proto) {
      case "wifi":
      case "mqtt":
        if (device.ip) {
          const res = await ping.promise.probe(device.ip, { timeout: 2 });

          signal = res.alive ? 80 : 20;

          latencyMs =
            res.time === "unknown"
              ? -1
              : typeof res.time === "number"
              ? res.time
              : 100;

          reliability = res.alive ? 90 : 20;
        }
        break;

      case "ble":
        signal = Math.floor(Math.random() * 50 + 50);
        latencyMs = Math.floor(Math.random() * 20 + 10);
        reliability = Math.floor(Math.random() * 40 + 60);
        break;

      case "zigbee":
        signal = Math.floor(Math.random() * 60 + 40);
        latencyMs = Math.floor(Math.random() * 30 + 20);
        reliability = Math.floor(Math.random() * 50 + 50);
        break;

      default:
        signal = 40;
        latencyMs = 80;
        reliability = 60;
    }

    scores.push({
      protocol: proto,
      signalStrength: signal,
      latency: latencyMs,
      reliability,
      overall: signal * 0.5 + reliability * 0.3 + (100 - latencyMs) * 0.2,
    });
  }

  return scores.sort((a, b) => b.overall - a.overall);
}

/**
 * Choose best protocol
 */
export function chooseBestProtocol(
  scores: ConnectivityScore[]
): ConnectivityScore {
  if (!scores.length) {
    throw new Error("No protocol scores available");
  }
  return scores[0];
}
