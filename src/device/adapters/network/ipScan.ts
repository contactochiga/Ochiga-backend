// src/device/adapters/network/ipScan.ts

import net from "net";
import ip from "ip";

/**
 * Convert CIDR to IP list (e.g. "192.168.1.0/24")
 * Hard limits to avoid scanning the whole world by mistake.
 *
 * NOTE:
 * - We exclude network + broadcast where applicable.
 * - We cap total hosts with maxHosts.
 */
export function cidrToIps(cidr: string, maxHosts = 512): string[] {
  const subnet = ip.cidrSubnet(cidr);
  if (!subnet || !subnet.networkAddress) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }

  const networkLong = ip.toLong(subnet.networkAddress);
  const broadcastLong = ip.toLong(subnet.broadcastAddress);

  // If something is weird, fail safely
  if (!Number.isFinite(networkLong) || !Number.isFinite(broadcastLong)) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }

  // Typical usable range: network+1 ... broadcast-1
  let start = networkLong + 1;
  let end = broadcastLong - 1;

  // /32 or tiny ranges: just return what we can
  if (end < start) {
    start = networkLong;
    end = broadcastLong;
  }

  const total = end - start + 1;
  const capped = Math.min(total, Math.max(1, maxHosts));

  const out: string[] = [];
  for (let i = 0; i < capped; i++) {
    out.push(ip.fromLong(start + i));
  }
  return out;
}

/**
 * TCP port probe
 */
export function probeTcp(ipAddr: string, port: number, timeoutMs = 450): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {}
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));

    socket.connect(port, ipAddr);
  });
}

/**
 * Concurrency limiter (simple)
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;

  const workers = Array.from({ length: Math.max(1, limit) }).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx]);
    }
  });

  await Promise.all(workers);
  return results;
}
