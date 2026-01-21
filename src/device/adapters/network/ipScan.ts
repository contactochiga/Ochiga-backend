import net from "net";
import IPCIDR from "ip-cidr";

/**
 * Enumerate IPs from CIDR (e.g. 192.168.1.0/24)
 * Hard-limits to avoid scanning the whole world by mistake.
 */
export function cidrToIps(cidr: string, maxHosts = 512): string[] {
  const c = new IPCIDR(cidr);

  // ✅ correct validation
  if (!c.isValidCIDR()) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }

  const ips = c.toArray(); // returns string[]

  // remove network & broadcast safely
  const trimmed = ips.length > 2 ? ips.slice(1, ips.length - 1) : ips;

  return trimmed.length > maxHosts
    ? trimmed.slice(0, maxHosts)
    : trimmed;
}

/**
 * TCP port probe
 */
export function probeTcp(
  ipAddr: string,
  port: number,
  timeoutMs = 450
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
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
