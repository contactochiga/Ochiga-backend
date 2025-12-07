// src/utils/connectivity.ts
import ping from "ping";
import { Device } from "../routes/devices";

export interface ConnectivityScore {
  protocol: string;
  signalStrength: number;
  latency: number;
  reliability: number;
  overall: number;
}

/**
 * Evaluate all supported protocols for a given device
 */
export async function evaluateDeviceConnectivity(
  device: Device
): Promise<ConnectivityScore[]> {
  const scores: ConnectivityScore[] = [];

  for (const proto of device.supportedProtocols || []) {
    let signal = 50,
      latencyMs: number = 50,
      reliability = 80;

    switch (proto) {
      case "wifi":
      case "mqtt":
        if (device.ip) {
          const res = await ping.promise.probe(device.ip, { timeout: 2 });

          signal = res.alive ? 80 : 20;

          // FIX: handle "unknown"
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
      case "zwave":
        signal = Math.floor(Math.random() * 60 + 40);
        latencyMs = Math.floor(Math.random() * 30 + 20);
        reliability = Math.floor(Math.random() * 50 + 50);
        break;
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
  if (!scores || scores.length === 0)
    throw new Error("No protocol scores available");
  return scores[0];
}
