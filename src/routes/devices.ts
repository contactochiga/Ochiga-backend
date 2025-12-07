// src/routes/devices.ts
import express from "express";
import { requireAuth } from "../middleware/auth";
import { Client as SSDPClient } from "node-ssdp";
import mqtt from "mqtt";
import ping from "ping";
import { networkInterfaces } from "os";
import { supabaseAdmin } from "../supabase/client";
import { io } from "../server"; // <-- Import Socket.IO instance

const router = express.Router();

const DEFAULT_ICON =
  "https://ochiga-assets.s3.amazonaws.com/device/default-device.png";

// -------------------------------------------------
// TYPES
// -------------------------------------------------
export type Device = {
  id: string;
  name: string;
  supportedProtocols: string[];
  currentProtocol: string;
  ip?: string;
  port?: string;
  type?: string;
  status: "found" | "connected" | "offline";
  icon: string;
  signalStrength?: number;
  latency?: number;
  reliability?: number;
  estate_id?: string;
};

// -------------------------------------------------
// LOCAL NETWORK INFO
// -------------------------------------------------
function getLocalNetworkInfo() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return { address: net.address };
      }
    }
  }
  return {};
}

// -------------------------------------------------
// REAL-TIME EMIT
// -------------------------------------------------
function emitDeviceUpdate(device: Device) {
  if (!device.estate_id) return;
  io.to(`estate:${device.estate_id}`).emit("device:update", {
    deviceId: device.id,
    name: device.name,
    status: device.status,
    currentProtocol: device.currentProtocol,
    signalStrength: device.signalStrength,
    latency: device.latency,
    reliability: device.reliability,
    ip: device.ip,
  });
}

// -------------------------------------------------
// CONNECTIVITY SCORING
// -------------------------------------------------
export async function evaluateConnectivity(device: Device): Promise<Device> {
  const scores: {
    protocol: string;
    signalStrength: number;
    latency: number;
    reliability: number;
    overall: number;
  }[] = [];

  for (const proto of device.supportedProtocols) {
    let signal = 50,
      latencyMs: number = 50,
      reliability = 80;

    switch (proto) {
      case "wifi":
      case "mqtt":
        if (device.ip) {
          const res = await ping.promise.probe(device.ip, { timeout: 2 });

          signal = res.alive ? 80 : 20;

          // FIX: Convert "unknown" → -1
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

  scores.sort((a, b) => b.overall - a.overall);
  const best = scores[0];

  device.currentProtocol = best.protocol;
  device.signalStrength = best.signalStrength;
  device.latency = best.latency;
  device.reliability = best.reliability;

  emitDeviceUpdate(device);

  return device;
}

// -------------------------------------------------
// PING SWEEP
// -------------------------------------------------
export async function pingSweep(limit = 254): Promise<Device[]> {
  const found: Device[] = [];
  const info = getLocalNetworkInfo();
  if (!info.address) return found;
  const parts = info.address.split(".");
  const base = parts.slice(0, 3).join(".");

  const jobs = Array.from({ length: limit }).map(async (_, i) => {
    const ip = `${base}.${i + 1}`;
    const res = await ping.promise.probe(ip, { timeout: 2 });

    if (res.alive) {
      const device: Device = {
        id: ip,
        name: `Device ${ip}`,
        supportedProtocols: ["ping", "wifi", "mqtt"],
        currentProtocol: "ping",
        ip,
        status: "found",
        icon: DEFAULT_ICON,
      };

      found.push(await evaluateConnectivity(device));
    }
  });

  await Promise.all(jobs);
  return found;
}

// -------------------------------------------------
// ROUTES
// -------------------------------------------------
router.get("/discover", requireAuth, async (_req, res) => {
  try {
    const pingResults = await pingSweep(80);
    res.json({ devices: pingResults });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
