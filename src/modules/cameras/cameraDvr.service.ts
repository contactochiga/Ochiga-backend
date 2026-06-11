import net from "net";

export type CameraBrand = "generic_rtsp" | "hikvision" | "dahua" | "hilook" | "uniview";

const BRANDS = new Set(["generic_rtsp", "hikvision", "dahua", "hilook", "uniview"]);

export function normalizeCameraBrand(value: any): CameraBrand {
  const brand = String(value || "generic_rtsp").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (brand === "generic" || brand === "rtsp") return "generic_rtsp";
  if (brand === "hi_look") return "hilook";
  return BRANDS.has(brand) ? (brand as CameraBrand) : "generic_rtsp";
}

export function displayCameraBrand(brand: any) {
  const normalized = normalizeCameraBrand(brand);
  if (normalized === "generic_rtsp") return "Generic RTSP";
  if (normalized === "hilook") return "HiLook";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function rtspPathTemplateForBrand(brand: any) {
  const normalized = normalizeCameraBrand(brand);
  if (normalized === "dahua") return "/cam/realmonitor?channel={channel}&subtype=0";
  if (normalized === "uniview") return "/media/video{channel}";
  if (normalized === "generic_rtsp") return "/Streaming/Channels/{channel}01";
  return "/Streaming/Channels/{channel}01";
}

export function providerForBrand(brand: any) {
  const normalized = normalizeCameraBrand(brand);
  if (normalized === "hilook") return "hikvision";
  return normalized;
}

export function slug(value: any, fallback = "camera") {
  const cleaned = String(value || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

export function buildCredentialRef(input: { estateId: string; name?: string; ipAddress?: string; prefix?: string }) {
  return `local:${slug(input.prefix || "dvr")}-${slug(input.estateId).slice(0, 8)}-${slug(input.name || input.ipAddress || "source")}`;
}

export function channelStreamKey(input: { dvrId?: string | null; ipAddress?: string | null; channelNumber: number }) {
  return `${slug(input.dvrId || input.ipAddress || "dvr")}-ch-${String(input.channelNumber).padStart(2, "0")}`;
}

export function buildChannelRows(count: number, existing?: Array<any>) {
  const channelCount = Math.max(0, Math.min(Number(count) || 0, 128));
  return Array.from({ length: channelCount }, (_, index) => {
    const channelNumber = index + 1;
    const match = existing?.find((item) => Number(item.channel_number || item.channel || item.number) === channelNumber) || {};
    return {
      channel_number: channelNumber,
      camera_name: String(match.camera_name || match.name || `Channel ${channelNumber}`),
      location: String(match.location || ""),
      privacy_scope: ["facility", "home", "office"].includes(String(match.privacy_scope)) ? String(match.privacy_scope) : "facility",
      enabled: match.enabled !== false,
    };
  });
}

export async function testTcpReachability(host: string, port: number, timeoutMs = 3500) {
  return new Promise<{ reachable: boolean; latency_ms: number | null; error?: string }>((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (result: { reachable: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ...result, latency_ms: result.reachable ? Date.now() - started : null });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ reachable: true }));
    socket.once("timeout", () => finish({ reachable: false, error: "Connection timed out" }));
    socket.once("error", (err) => finish({ reachable: false, error: err.message }));
    socket.connect(port, host);
  });
}

export function normalizeDvrStatus(reachable: boolean, channelCount: number) {
  if (!reachable) return "offline";
  return channelCount > 0 ? "online" : "reachable_manual_channel_count_required";
}
