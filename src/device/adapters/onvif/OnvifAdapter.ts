// src/device/adapters/onvif/OnvifAdapter.ts

import { DeviceAdapter } from "../DeviceAdapter";
import { AdapterContext, DiscoveredDevice } from "../types";
import { Signal } from "../../../core/control-plane/contracts/signal.types";
import { probeTcp, cidrToIps, mapLimit } from "../network/ipScan";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const onvif = require("onvif");

/**
 * ONVIF discovery in Node:
 * - If CIDR is provided, we do a fast IP scan (port probe) then attempt ONVIF connect.
 * - If CIDR is NOT provided, fallback to WS-Discovery probe (multicast).
 *
 * Credentials:
 * - Accepts BOTH styles to avoid mismatch:
 *   - context.credentials.username / password
 *   - context.credentials.onvifUser / onvifPass
 */
export class OnvifAdapter implements DeviceAdapter {
  readonly name = "onvif";
  readonly vendor = "ONVIF";
  readonly protocols = ["http", "other"];

  async discover(context: AdapterContext): Promise<DiscoveredDevice[]> {
    const cidr = (context.credentials?.cidr as string | undefined) || undefined;

    // ✅ accept both keys
    const username =
      (context.credentials?.username as string | undefined) ||
      (context.credentials?.onvifUser as string | undefined);

    const password =
      (context.credentials?.password as string | undefined) ||
      (context.credentials?.onvifPass as string | undefined);

    // Optional tuning
    const maxHosts = Number(context.credentials?.maxHosts ?? 512);
    const probeTimeoutMs = Number(context.credentials?.probeTimeoutMs ?? 350);
    const ipConcurrency = Number(context.credentials?.ipConcurrency ?? 64);
    const onvifConcurrency = Number(context.credentials?.onvifConcurrency ?? 20);

    if (!cidr) {
      // fallback: use onvif.Discovery.probe() which uses WS-Discovery multicast
      // Works only on LAN and when multicast is allowed.
      return await this.discoverViaProbe(username, password);
    }

    const ips = cidrToIps(cidr, maxHosts);

    // common camera ports (RTSP is 554). Many ONVIF cams still answer HTTP/ONVIF on 80/8080/8000.
    const ports = [80, 8000, 8080, 8899, 554];

    // quick filter: if none of these ports respond, skip
    const candidates = await mapLimit(ips, ipConcurrency, async (ip) => {
      for (const p of ports) {
        const ok = await probeTcp(ip, p, probeTimeoutMs);
        if (ok) return ip;
      }
      return null;
    });

    const live = candidates.filter(Boolean) as string[];

    // Try ONVIF connect per IP
    const devices = await mapLimit(live, onvifConcurrency, async (ip) => {
      try {
        const cam = await this.connectOnvif(ip, username, password);
        const info = await this.getDeviceInfo(cam);
        const rtsp = await this.getRtspUri(cam).catch(() => null);

        const name = info?.model
          ? `${info.manufacturer || "Camera"} ${info.model}`
          : `ONVIF Camera ${ip}`;

        return {
          externalId: `${ip}`,
          adapter: this.name,
          name,
          category: "camera",
          online: true,
          capabilities: ["stream.rtsp", "onvif"],
          protocols: ["http", "other"],
          metadata: {
            manufacturer: info?.manufacturer,
            model: info?.model,
            firmwareVersion: info?.firmwareVersion,
            raw: {
              ip,
              rtsp,
              onvif: info,
              cidr,
            },
          },
        } satisfies DiscoveredDevice;
      } catch {
        return null;
      }
    });

    return devices.filter(Boolean) as DiscoveredDevice[];
  }

  private discoverViaProbe(
    username?: string,
    password?: string
  ): Promise<DiscoveredDevice[]> {
    return new Promise((resolve) => {
      onvif.Discovery.probe(async (err: any, cams: any[]) => {
        if (err || !Array.isArray(cams)) return resolve([]);

        const out: DiscoveredDevice[] = [];

        for (const c of cams) {
          // onvif module returns { address, port, ... } commonly
          const ip = c?.address || c?.ip;
          if (!ip) continue;

          try {
            const cam = await this.connectOnvif(ip, username, password);
            const info = await this.getDeviceInfo(cam);
            const rtsp = await this.getRtspUri(cam).catch(() => null);

            out.push({
              externalId: `${ip}`,
              adapter: this.name,
              name: info?.model
                ? `${info.manufacturer || "Camera"} ${info.model}`
                : `ONVIF Camera ${ip}`,
              category: "camera",
              online: true,
              capabilities: ["stream.rtsp", "onvif"],
              protocols: ["http", "other"],
              metadata: {
                manufacturer: info?.manufacturer,
                model: info?.model,
                firmwareVersion: info?.firmwareVersion,
                raw: { ip, rtsp, onvif: info, discovery: c },
              },
            });
          } catch {
            // ignore single camera failures
          }
        }

        resolve(out);
      });
    });
  }

  private connectOnvif(
    ip: string,
    username?: string,
    password?: string
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const Cam = onvif.Cam;

      new Cam(
        {
          hostname: ip,
          username: username || "",
          password: password || "",
          timeout: 5000,
        },
        function (err: any) {
          if (err) return reject(err);
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          const self = this;
          resolve(self);
        }
      );
    });
  }

  private getDeviceInfo(
    cam: any
  ): Promise<{ manufacturer?: string; model?: string; firmwareVersion?: string }> {
    return new Promise((resolve) => {
      cam.getDeviceInformation((err: any, info: any) => {
        if (err) return resolve({});
        resolve({
          manufacturer: info?.manufacturer,
          model: info?.model,
          firmwareVersion: info?.firmwareVersion,
        });
      });
    });
  }

  private getRtspUri(cam: any): Promise<string> {
    return new Promise((resolve, reject) => {
      cam.getStreamUri({ protocol: "RTSP" }, (err: any, stream: any) => {
        if (err) return reject(err);
        const uri = stream?.uri;
        if (!uri) return reject(new Error("No RTSP URI"));
        resolve(uri);
      });
    });
  }

  async bindDevice(): Promise<void> {
    return;
  }

  async executeCommand(): Promise<void> {
    throw new Error(
      "ONVIF adapter currently supports discovery only (stream URI)."
    );
  }

  async startEventStream(
    _context: AdapterContext,
    _emit: (signal: Signal) => Promise<void>
  ): Promise<void> {
    return;
  }
}
