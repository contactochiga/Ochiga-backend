import crypto from "crypto";

export const CAMERA_GATEWAY_ERRORS = ["camera_not_found","camera_auth_failed","onvif_unreachable","rtsp_unavailable","stream_unavailable","edge_unreachable","discovery_timeout","unsupported_device","duplicate_camera","scope_conflict","invalid_discovery_scope","expired_command"] as const;
export type CameraGatewayError = typeof CAMERA_GATEWAY_ERRORS[number];

const text = (value: unknown) => String(value ?? "").trim();
const PRIVATE_IP = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function safeGatewayError(value: unknown): CameraGatewayError {
  const code = text(value) as CameraGatewayError;
  return CAMERA_GATEWAY_ERRORS.includes(code) ? code : "unsupported_device";
}

export function deriveDiscoveryFingerprint(candidate: any) {
  const strong = [candidate?.endpointUuid, candidate?.serialNumber, candidate?.hardwareId, candidate?.macAddress].map(text).find(Boolean);
  const fallback = [candidate?.manufacturer, candidate?.model, candidate?.hostname, text(candidate?.xaddrIdentity).replace(/https?:\/\/[^/]+/i, "onvif-host")].map((item) => item.toLowerCase()).filter(Boolean).join("|");
  const stable = strong || fallback;
  if (!stable) return null;
  return { fingerprint:`camfp_${crypto.createHash("sha256").update(stable).digest("hex")}`, strength:strong ? "strong" : "fallback" } as const;
}

export function validateDiscoveryRequest(input: any) {
  const mode = ["onvif","subnet","all"].includes(text(input?.mode)) ? text(input.mode) : "onvif";
  const cidr = text(input?.cidr);
  if ((mode === "subnet" || mode === "all") && cidr) {
    const [address,prefixRaw] = cidr.split("/"); const prefix = Number(prefixRaw);
    if (!PRIVATE_IP.test(address) || !Number.isInteger(prefix) || prefix < 24 || prefix > 30) return { ok:false as const, error:"invalid_discovery_scope" as const };
  }
  const timeoutMs = Math.min(30_000, Math.max(1_000, Number(input?.timeoutMs || 8_000)));
  return { ok:true as const, mode, cidr:cidr || null, timeoutMs };
}

export function sanitizeDiscoveryCandidate(input: any) {
  const derived = deriveDiscoveryFingerprint(input);
  if (!derived || text(input?.fingerprint) !== derived.fingerprint) return { ok:false as const, error:"invalid_discovery_fingerprint" };
  const ipAddress = text(input?.ipAddress);
  if (ipAddress && !PRIVATE_IP.test(ipAddress)) return { ok:false as const, error:"malicious_discovered_url" };
  const capabilities = input?.capabilities && typeof input.capabilities === "object" && !Array.isArray(input.capabilities) ? input.capabilities : {};
  return { ok:true as const, privateCandidate:{ fingerprint:derived.fingerprint, fingerprintStrength:derived.strength, provider:text(input.provider || "onvif"), manufacturer:text(input.manufacturer) || null, model:text(input.model) || null, serialNumber:text(input.serialNumber) || null, firmwareVersion:text(input.firmwareVersion) || null, hostname:text(input.hostname) || null, ipAddress:ipAddress || null, onvifPort:Number.isFinite(Number(input.onvifPort)) ? Number(input.onvifPort) : null, onvifAvailable:input.onvifAvailable === true, rtspAvailable:input.rtspAvailable === true, requiresAuthentication:input.requiresAuthentication === true, profiles:Array.isArray(input.profiles) ? input.profiles.slice(0,16).map((profile:any)=>({token:text(profile?.token).slice(0,128),name:text(profile?.name).slice(0,120)})) : [], capabilities, endpointUuid:text(input.endpointUuid) || null, discoveredAt:text(input.discoveredAt) || new Date().toISOString() } };
}

export function publicDiscoveryCandidate(row: any) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return { id:row.id, discoveryId:row.id, fingerprint:row.discovery_fingerprint, fingerprintStrength:metadata.fingerprint_strength || "unknown", provider:row.provider || "onvif", manufacturer:metadata.manufacturer || null, model:metadata.model || null, name:row.name || "Camera", onvifAvailable:Boolean(metadata.onvif_available), rtspAvailable:Boolean(metadata.rtsp_available), requiresAuthentication:Boolean(metadata.requires_authentication), capabilities:row.capabilities || {}, state:row.discovery_state || row.status || "discovered", canonicalCameraId:row.canonical_camera_id || null, discoveredAt:row.discovered_at || row.last_seen_at || row.created_at };
}
