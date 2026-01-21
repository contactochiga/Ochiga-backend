// src/device/adapters/network/ipScan.ts

import net from "net";
import IPCIDR from "ip-cidr";

/**
 * Convert CIDR (e.g. 192.168.1.0/24) to IP list
 */
export function cidrToIps(cidr: string, maxHosts = 512): string[] {
  const c = new IPCIDR(cidr);
  if (!c.isValid()) throw new Error(`Invalid CIDR: ${cidr}`);

  const ips = c.toArray({ type: "addressObject" }).map((x: any) => x.address);

  // remove network + broadcast
  const usable = ips.slice(1, ips.length - 1);
  return usable.slice(0, maxHosts);
}

/**
 * Probe TCP port
 */
export function probeTcp(
  ip: string,
  port: number,
  timeoutMs = 400
): Promise<boolean> {
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

    socket.connect(port, ip);
  });
}

/**
 * Simple async concurrency limiter
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  const workers = Array.from({ length: limit }).map(async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });

  await Promise.all(workers);
  return results;
}
