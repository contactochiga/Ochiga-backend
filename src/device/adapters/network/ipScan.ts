// src/device/adapters/network/ipScan.ts
import net from "net";

/**
 * IPv4 helpers (no external deps)
 */
function isValidIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

function ipv4ToInt(ip: string): number {
  const [a, b, c, d] = ip.split(".").map((x) => Number(x));
  // >>> 0 forces unsigned
  return (((a << 24) | (b << 16) | (c << 8) | d) >>> 0);
}

function intToIpv4(n: number): string {
  const a = (n >>> 24) & 255;
  const b = (n >>> 16) & 255;
  const c = (n >>> 8) & 255;
  const d = n & 255;
  return `${a}.${b}.${c}.${d}`;
}

function maskFromPrefix(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff >>> 0;
  // e.g. prefix=24 => 0xffffff00
  return ((0xffffffff << (32 - prefix)) >>> 0);
}

/**
 * Enumerate IPv4 hosts from CIDR (e.g. 192.168.1.0/24)
 * - Skips network + broadcast where applicable
 * - Hard-limits host count to avoid scanning the whole world by mistake
 */
export function cidrToIps(cidr: string, maxHosts = 512): string[] {
  const [baseIp, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);

  if (!baseIp || !prefixStr || Number.isNaN(prefix)) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }
  if (!isValidIpv4(baseIp)) {
    throw new Error(`Invalid IPv4 in CIDR: ${cidr}`);
  }
  if (prefix < 0 || prefix > 32) {
    throw new Error(`Invalid CIDR prefix: ${cidr}`);
  }

  const base = ipv4ToInt(baseIp);
  const mask = maskFromPrefix(prefix);
  const network = (base & mask) >>> 0;
  const broadcast = (network | (~mask)) >>> 0;

  // For /32: only one host
  if (prefix === 32) return [baseIp];

  // For /31: 2 addresses, typically point-to-point; we return both
  if (prefix === 31) {
    return [intToIpv4(network), intToIpv4(broadcast)].slice(0, maxHosts);
  }

  // Normal: skip network + broadcast
  const start = network + 1;
  const end = broadcast - 1;

  const out: string[] = [];
  for (let n = start; n <= end && out.length < maxHosts; n++) {
    out.push(intToIpv4(n >>> 0));
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
      try { socket.destroy(); } catch {}
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
