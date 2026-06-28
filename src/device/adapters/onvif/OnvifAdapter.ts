// src/device/adapters/onvif/OnvifAdapter.ts

import { DeviceAdapter } from "../DeviceAdapter";
import type { AdapterContext, DiscoveredDevice } from "../types";
import type { Signal } from "../../../core/control-plane/contracts/signal.types";
import { probeTcp, cidrToIps, mapLimit } from "../network/ipScan";
import { operationalMetrics } from "../../../observability/metrics";
import { providerHealthRegistry } from "../../../observability/providerHealth";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const onvif = require("onvif");

export class OnvifAdapter implements DeviceAdapter {
  readonly name = "onvif";
  readonly vendor = "ONVIF";
  readonly protocols = ["http", "other"];

  async discover(context: AdapterContext): Promise<DiscoveredDevice[]> {
    const startedAt = Date.now();
    providerHealthRegistry.markConfigured("onvif", { note: "discovery_started" });
    const cidr = (context.credentials?.cidr as string | undefined)?.trim();
    const username = (context.credentials?.username as string | undefined)?.trim();
    const password = (context.credentials?.password as string | undefined)?.trim();

    if (!cidr) {
      const discovered = await this.discoverViaProbe(username, password);
      operationalMetrics.increment("oyi_provider_discoveries_total", { provider: "onvif", mode: "probe" }, discovered.length);
      providerHealthRegistry.heartbeat("onvif", { latencyMs: Date.now() - startedAt, note: `discovered:${discovered.length}`, wired: true });
      return discovered;
    }

    const ips = cidrToIps(cidr, 512);
    const ports = [80, 8000, 8080, 8899, 554];

    const candidates = await mapLimit(ips, 80, async (ip) => {
      for (const p of ports) {
        const ok = await probeTcp(ip, p, 350);
        if (ok) return ip;
      }
      return null;
    });

    const live = candidates.filter(Boolean) as string[];
    if (!live.length) return [];

    const devices = await mapLimit(live, 20, async (ip) => {
      try {
        const cam = await this.connectOnvif(ip, username, password);
        const info = await this.getDeviceInfo(cam);
        const rtsp = await this.getRtspUri(cam).catch(() => null);

        const name = info?.model
          ? `${info.manufacturer || "Camera"} ${info.model}`
          : `ONVIF Camera ${ip}`;

        const d: DiscoveredDevice = {
          externalId: `${ip}`,
          adapter: this.name,
          name,
          category: "camera",
          online: true,
          capabilities: ["onvif", ...(rtsp ? ["stream.rtsp"] : [])],
          protocols: ["http", "other"],
          metadata: {
            manufacturer: info?.manufacturer,
            model: info?.model,
            firmwareVersion: info?.firmwareVersion,
            raw: { ip, rtsp, onvif: info },
          },
        };

        return d;
      } catch {
        return null;
      }
    });

    const discovered = devices.filter(Boolean) as DiscoveredDevice[];
    operationalMetrics.increment("oyi_provider_discoveries_total", { provider: "onvif", mode: "cidr" }, discovered.length);
    providerHealthRegistry.heartbeat("onvif", { latencyMs: Date.now() - startedAt, note: `discovered:${discovered.length}`, wired: true });
    return discovered;
  }

  private discoverViaProbe(username?: string, password?: string): Promise<DiscoveredDevice[]> {
    return new Promise((resolve) => {
      onvif.Discovery.probe(async (err: any, cams: any[]) => {
        if (err || !Array.isArray(cams)) return resolve([]);

        const out: DiscoveredDevice[] = [];

        for (const c of cams) {
          const ip = c?.address;
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
              capabilities: ["onvif", ...(rtsp ? ["stream.rtsp"] : [])],
              protocols: ["http", "other"],
              metadata: {
                manufacturer: info?.manufacturer,
                model: info?.model,
                firmwareVersion: info?.firmwareVersion,
                raw: { ip, rtsp, onvif: info, discovery: c },
              },
            });
          } catch {
            // ignore
          }
        }

        resolve(out);
      });
    });
  }

  private connectOnvif(ip: string, username?: string, password?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const Cam = onvif.Cam;

      // eslint-disable-next-line no-new
      new Cam(
        {
          hostname: ip,
          username: username || "",
          password: password || "",
          timeout: 5000,
        },
        function (this: any, err: any) {
          if (err) return reject(err);
          resolve(this);
        }
      );
    });
  }

  private getDeviceInfo(cam: any): Promise<{
    manufacturer?: string;
    model?: string;
    firmwareVersion?: string;
  }> {
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
    providerHealthRegistry.markConfigured("onvif", { status: "degraded", note: "command_not_supported" });
    throw new Error("ONVIF adapter currently supports discovery only (stream URI).");
  }

  async startEventStream(_context: AdapterContext, _emit: (signal: Signal) => Promise<void>) {
    providerHealthRegistry.markConfigured("onvif", { status: "degraded", note: "event_stream_not_supported" });
    return;
  }
}
