// src/device/adapters/network/ipScan.ts
import net from "net";
import IPCIDR from "ip-cidr";

/**
 * Enumerate IPs from CIDR (e.g. 192.168.1.0/24)
 */
export function cidrToIps(cidr: string, maxHosts = 512): string[] {
  const c = new IPCIDR(cidr);
  if (!c.isValid()) throw new Error(`Invalid CIDR: ${cidr}`);

  const ips = c.toArray({ type: "addressObject" }).map((x: any) => x.address);

  // remove network & broadcast
  const trimmed = ips.slice(1, ips.length - 1);

  return trimmed.length > maxHosts ? trimmed.slice(0, maxHosts) : trimmed;
}

/**
 * TCP port probe
 */
export function probeTcp(
  ip: string,
  port: number,
  timeoutMs = 450
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
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
 * Concurrency limiter
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;

  const workers = Array.from({ length: Math.max(1, limit) }).map(async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });

  await Promise.all(workers);
  return results;
}
