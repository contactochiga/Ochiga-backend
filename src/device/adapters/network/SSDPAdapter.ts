import { Client } from "node-ssdp";
import { DeviceAdapter } from "../DeviceAdapter";
import { AdapterContext, DiscoveredDevice } from "../types";
import { Signal } from "../../../core/control-plane/contracts/signal.types";

export class SSDPAdapter implements DeviceAdapter {
  readonly name = "ssdp";
  readonly vendor = "UPnP/SSDP";
  readonly protocols = ["http", "other"];

  async discover(_context: AdapterContext): Promise<DiscoveredDevice[]> {
    const client = new Client({ explicitSocketBind: true });

    const timeoutMs = 2500;
    const seen = new Map<string, any>();

    return new Promise((resolve) => {
      client.on("response", (headers, _statusCode, rinfo) => {
        const usn = String(headers?.USN || headers?.usn || "");
        const st = String(headers?.ST || headers?.st || "");
        const location = String(headers?.LOCATION || headers?.location || "");
        const server = String(headers?.SERVER || headers?.server || "");

        const key = `${rinfo.address}|${usn}|${st}|${location}`;
        if (!seen.has(key)) {
          seen.set(key, { headers, rinfo, usn, st, location, server });
        }
      });

      // search root device + media renderers (cameras vary)
      client.search("ssdp:all");

      setTimeout(() => {
        try { client.stop(); } catch {}
        const devices: DiscoveredDevice[] = Array.from(seen.values()).map((x) => ({
          externalId: x.usn || `${x.rinfo.address}:${x.st}`,
          adapter: this.name,
          name: x.server ? `${x.server}` : `SSDP Device ${x.rinfo.address}`,
          category: "unknown",
          online: true,
          capabilities: [],
          protocols: ["http", "other"],
          metadata: {
            manufacturer: undefined,
            model: undefined,
            raw: {
              ip: x.rinfo.address,
              st: x.st,
              usn: x.usn,
              location: x.location,
              server: x.server,
              headers: x.headers,
            },
          },
        }));

        resolve(devices);
      }, timeoutMs);
    });
  }

  async bindDevice(): Promise<void> {
    return;
  }

  async executeCommand(): Promise<void> {
    throw new Error("SSDP adapter is discovery-only");
  }

  async startEventStream(_context: AdapterContext, _emit: (signal: Signal) => Promise<void>) {
    return;
  }
}
