// src/device/adapters/network/IPScanAdapter.ts

import { DeviceAdapter } from "../DeviceAdapter";
import { AdapterContext, DiscoveredDevice } from "../types";
import { Signal } from "../../../core/control-plane/contracts/signal.types";
import { cidrToIps, probeTcp, mapLimit } from "./ipScan";

function guessCategory(openPorts: number[]): DiscoveredDevice["category"] {
  // very simple heuristics (good enough for v1)
  if (openPorts.includes(554) || openPorts.includes(8554)) return "camera"; // RTSP
  if (openPorts.includes(80) || openPorts.includes(8080) || openPorts.includes(8000)) return "unknown";
  return "unknown";
}

export class IPScanAdapter implements DeviceAdapter {
  readonly name = "ipscan";
  readonly vendor = "Network Scanner";
  readonly protocols = ["http", "other"];

  async discover(context: AdapterContext): Promise<DiscoveredDevice[]> {
    const cidr = (context.credentials?.cidr as string | undefined) || "";
    const timeoutMs = Number(context.credentials?.timeoutMs || 450);

    if (!cidr) {
      // we need a boundary, to avoid “scan the world”
      // You pass ?cidr=192.168.1.0/24 from the controller
      return [];
    }

    const ips = cidrToIps(cidr, 512);

    // common ports we care about in estates (expand later)
    const portsToProbe = [80, 443, 554, 8000, 8080, 8899, 8554];

    // Step 1: for each IP, probe ports
    const results = await mapLimit(ips, 80, async (ip) => {
      const open: number[] = [];
      for (const p of portsToProbe) {
        const ok = await probeTcp(ip, p, timeoutMs);
        if (ok) open.push(p);
      }
      if (!open.length) return null;

      const category = guessCategory(open);

      const device: DiscoveredDevice = {
        externalId: ip, // for network scan, we use ip as unique external id
        adapter: this.name,
        name: category === "camera" ? `IP Camera ${ip}` : `IP Device ${ip}`,
        category,
        online: true,
        capabilities: category === "camera" ? ["stream.rtsp"] : [],
        protocols: ["http", "other"],
        metadata: {
          raw: {
            ip,
            openPorts: open,
            cidr,
          },
        },
      };

      return device;
    });

    return results.filter(Boolean) as DiscoveredDevice[];
  }

  async bindDevice(): Promise<void> {
    return;
  }

  async executeCommand(): Promise<void> {
    throw new Error("IPScan adapter is discovery-only");
  }

  async startEventStream(_context: AdapterContext, _emit: (signal: Signal) => Promise<void>) {
    return;
  }
}
