// Canonical source. Generated frontend copies must retain CAMERA_CORE_VERSION.
// DO NOT EDIT FRONTEND COPIES DIRECTLY — generated from canonical Oyi Camera Core.
export * from "./media";
export * from "./detection";
import { normalizeCameraMedia } from "./media";
import { normalizeCameraDetection } from "./detection";
export const CAMERA_CORE_VERSION = "6.0.0-canonical-current-state";

export type CameraScope = "facility" | "home" | "office" | "unknown";
export type CameraRuntimeState = "healthy" | "degraded" | "unavailable" | "unknown";
export type CapabilityAvailability = "available" | "configured" | "unavailable" | "unknown";
export type CameraCapability = { availability: CapabilityAvailability; source?: string | null };
export type CameraCapabilities = {
  liveView: CameraCapability; playback: CameraCapability; snapshots: CameraCapability;
  audio: CameraCapability; ptz: CameraCapability; motionDetection: CameraCapability;
  personDetection: CameraCapability; vehicleDetection: CameraCapability;
  animalDetection: CameraCapability; occupancy: CameraCapability; tamperDetection: CameraCapability;
  smokeDetection: CameraCapability; fireDetection: CameraCapability;
  lineCrossing: CameraCapability; zoneIntrusion: CameraCapability;
  faceDetection: CameraCapability; faceRecognition: CameraCapability;
  anpr: CameraCapability; recording: CameraCapability;
};
export type CameraHealth = {
  online: boolean | null; status: string; streamStatus?: string | null;
  lastSeenAt?: string | null; lastHealthAt?: string | null;
  lastSuccessAt?: string | null; lastFailureAt?: string | null;
  latencyMs?: number | null; reconnectCount?: number | null;
  providerError?: string | null; frameFreshnessAt?: string | null;
};
export type Camera = {
  id: string; scope: CameraScope; estateId?: string | null; buildingId?: string | null;
  homeId?: string | null; zoneId?: string | null; name: string;
  reference?: string | null; location?: string | null; status: string;
  streamStatus?: string | null; provider?: string | null; edgeNodeId?: string | null;
  capabilities: CameraCapabilities; health?: CameraHealth | null;
  runtimeState: CameraRuntimeState; currentState?: Record<string, any> | null; createdAt?: string | null; updatedAt?: string | null;
};
export type LegacyCameraMediaReference = { kind:"snapshot"|"clip"|"recording";url?:string;trust:"oyi_authorized"|"legacy_external";expiresAt?:string|null;capturedAt?:string|null };
export type LegacyCameraDetection = {
  id?: string; type: string; confidence?: number | null; label?: string | null;
  zone?: string | null; occurredAt?: string | null;
  boundingBox?: { x: number; y: number; width: number; height: number } | null;
  attributes?: Record<string, unknown>;
};
export type CameraEvent = {
  id: string; cameraId: string; type: string; severity: string;
  confidence?: number | null; createdAt: string; sourceTimestamp?: string | null;
  metadata: Record<string, unknown>; snapshot?: LegacyCameraMediaReference | null;
  clip?: LegacyCameraMediaReference | null; media?: import("./media").CameraMediaReference[]; detections: import("./detection").CameraDetection[];
};
export type CameraPlaybackSession = {
  cameraId: string; protocol: "hls"; url: string; expiresAt?: string | null;
  sessionId?: string | null;
};
export type CameraContext = { scope: "facility"; estateId: string } | { scope: "home"; homeId: string };
export type CameraOyiContext = {
  type: "camera"; id: string; name: string; scope: CameraScope;
  location?: string | null; estateId?: string | null; homeId?: string | null; status: CameraRuntimeState;
};

const text = (value: unknown, fallback = "") => String(value ?? fallback).trim();
const nullableText = (value: unknown) => text(value) || null;
const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
const date = (value: unknown) => { const raw = nullableText(value); return raw && Number.isFinite(Date.parse(raw)) ? raw : null; };
const SECRET_FIELDS = new Set(["password","pass","secret","token","username","rtsp_url","edge_hls_url","hls_url","credential_ref"]);
const safeValue = (value: unknown): any => Array.isArray(value) ? value.map(safeValue) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !SECRET_FIELDS.has(key.toLowerCase())).map(([key, nested]) => [key, safeValue(nested)])) : value;
const safeMediaUrl = (value: unknown) => {
  const raw = nullableText(value); if (!raw) return null;
  try { const url = new URL(raw); const host = url.hostname.toLowerCase(); if (!["http:","https:"].includes(url.protocol) || host === "localhost" || host === "::1" || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.endsWith(".local")) return null; return raw; } catch { return null; }
};
const capability = (value: unknown): CameraCapability => {
  if (typeof value === "object" && value) {
    const raw = text((value as any).availability).toLowerCase();
    if (["available", "configured", "unavailable", "unknown"].includes(raw)) return { availability: raw as CapabilityAvailability, source: nullableText((value as any).source) };
  }
  if (value === true) return { availability: "available", source: "backend" };
  if (value === false) return { availability: "unavailable", source: "backend" };
  return { availability: "unknown" };
};

const CAPABILITY_KEYS: (keyof CameraCapabilities)[] = ["liveView","playback","snapshots","audio","ptz","motionDetection","personDetection","vehicleDetection","animalDetection","occupancy","tamperDetection","smokeDetection","fireDetection","lineCrossing","zoneIntrusion","faceDetection","faceRecognition","anpr","recording"];
export function normalizeCameraCapabilities(raw: unknown): CameraCapabilities {
  const source = record(raw); const out: any = {};
  for (const key of CAPABILITY_KEYS) out[key] = capability(source[key] ?? source[key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)]);
  for (const key of ["faceDetection","faceRecognition","anpr"]) out[key]={availability:"unavailable",source:"phase5_scope"};
  return out as CameraCapabilities;
}
export function normalizeCameraHealth(raw: unknown): CameraHealth | null {
  const value = record(raw); if (!Object.keys(value).length) return null;
  const state = record(value.current_state ?? value.currentState ?? (value.overall ? value : null));
  const overall = cameraRuntimeState({currentState:state});
  return {online: overall === "unknown" ? null : state.videoEvidence === "recent_acquisition", status: overall,
    streamStatus: nullableText(state.stream?.state), lastSeenAt: date(state.observedAt)};
}
export function cameraRuntimeState(camera: Pick<Camera, "currentState">): CameraRuntimeState {
  const state = camera.currentState?.overall;
  return ["healthy", "degraded", "unavailable", "unknown"].includes(state) ? state : "unknown";
}
export function normalizeCamera(raw: unknown): Camera {
  const value = record(raw); const metadata = record(value.metadata);
  const scopeRaw = text(value.scope ?? value.privacy_scope ?? metadata.privacy_scope).toLowerCase();
  const scope: CameraScope = ["facility","home","office"].includes(scopeRaw) ? scopeRaw as CameraScope : "unknown";
  const base = { id: text(value.id), scope, estateId: nullableText(value.estateId ?? value.estate_id), buildingId: nullableText(value.buildingId ?? value.building_id ?? metadata.building_id), homeId: nullableText(value.homeId ?? value.home_id ?? metadata.home_id), zoneId: nullableText(value.zoneId ?? value.zone_id), name: text(value.name, "Camera"), reference: nullableText(value.reference ?? value.camera_id), location: nullableText(value.location), provider: nullableText(value.provider), edgeNodeId: nullableText(value.edgeNodeId ?? value.edge_node_id), capabilities: normalizeCameraCapabilities(value.capabilities), createdAt: date(value.createdAt ?? value.created_at), updatedAt: date(value.updatedAt ?? value.updated_at) };
  const currentState = record(value.current_state ?? value.currentState);
  const runtimeState = cameraRuntimeState({currentState});
  return { ...base, currentState, status: runtimeState, runtimeState,
    streamStatus: nullableText(currentState.stream?.state),
    health: { status: runtimeState, online: runtimeState === "unknown" ? null : currentState.videoEvidence === "recent_acquisition",
      streamStatus: nullableText(currentState.stream?.state), lastSeenAt: date(currentState.observedAt) } };
}
/** Compatibility helpers describe observed acquisition, not electrical connectivity. */
export const hasRecentCameraAcquisition = (camera: Camera): boolean | null => camera.currentState?.videoEvidence === "recent_acquisition"
  ? true : camera.currentState?.videoEvidence === "acquisition_failed" ? false : null;
/** @deprecated Prefer hasRecentCameraAcquisition; this is not a physical-online claim. */
export const isCameraOnline = hasRecentCameraAcquisition;
/** @deprecated Prefer hasRecentCameraAcquisition; continuous streaming is not proven. */
export const isCameraStreamHealthy = hasRecentCameraAcquisition;
export const getCameraHealthLabel = (camera: Camera) => camera.runtimeState;
export const getCameraLastActivity = (camera: Camera) => camera.health?.frameFreshnessAt || camera.health?.lastSuccessAt || camera.health?.lastSeenAt || null;

export function extractCameraDetections(rawEvent: unknown): import("./detection").CameraDetection[] {
  const event = record(rawEvent); const metadata = record(event.metadata); const values = Array.isArray(event.detections) ? event.detections : Array.isArray(metadata.detections) ? metadata.detections : [];
  return values.slice(0,100).map((item:any)=>normalizeCameraDetection(item));
}
export function getCameraEventOccurrenceTime(event: Pick<CameraEvent,"sourceTimestamp"|"createdAt">) { return date(event.sourceTimestamp) || event.createdAt; }
export function normalizeCameraEvent(raw: unknown): CameraEvent {
  const value = record(raw); const metadataBase = safeValue(record(value.metadata)); const metadata = nullableText(value.message) ? { ...metadataBase, message: nullableText(value.message) } : metadataBase; const createdAt = date(value.createdAt ?? value.created_at) || new Date(0).toISOString(); const sourceTimestamp = date(value.sourceTimestamp ?? value.source_timestamp);
  const snapshotUrl = safeMediaUrl(value.snapshot?.url ?? value.snapshot_url); const snapshot = snapshotUrl ? { kind:"snapshot" as const, url:snapshotUrl, trust:"legacy_external" as const, capturedAt:sourceTimestamp || createdAt } : null;
  return { id:text(value.id), cameraId:text(value.cameraId ?? value.camera_id), type:text(value.type ?? value.event_type, "unknown"), severity:text(value.severity ?? metadata.severity, "unknown"), confidence:finite(value.confidence), createdAt, sourceTimestamp, metadata, snapshot, clip:null, media:Array.isArray(value.media)?value.media.map(normalizeCameraMedia):[], detections:extractCameraDetections(value) };
}
export function normalizePlaybackSession(raw: unknown, fallbackCameraId = ""): CameraPlaybackSession {
  const value = record(raw); const protocol = text(value.protocol ?? value.playback_type ?? value.type, "hls").toLowerCase(); const url = text(value.url ?? value.hls_url); if (protocol !== "hls" || !url) throw new Error("Camera playback is unavailable");
  return { cameraId:text(value.cameraId ?? value.camera_id, fallbackCameraId), protocol:"hls", url, expiresAt:date(value.expiresAt ?? value.expires_at), sessionId:nullableText(value.sessionId ?? value.session_id) };
}
export function serializeCameraOyiContext(camera: Camera): CameraOyiContext { return { type:"camera", id:camera.id, name:camera.name, scope:camera.scope, location:camera.location, estateId:camera.estateId, homeId:camera.homeId, status:camera.runtimeState }; }

export type CameraTransport = { get(path: string, options?: { params?: Record<string, unknown> }): Promise<{ data: any }> };
export function createCameraReadClient(transport: CameraTransport) {
  return {
    async listCameras(context: CameraContext) { const path = context.scope === "home" ? `/cameras/home/${encodeURIComponent(context.homeId)}` : `/cameras/estate/${encodeURIComponent(context.estateId)}`; const response = await transport.get(path); return (response.data?.items || []).map(normalizeCamera); },
    async getCameraEvents(cameraId: string, options?: { limit?: number; sinceMinutes?: number }) { const response = await transport.get(`/cameras/${encodeURIComponent(cameraId)}/events`, { params:{ limit:options?.limit ?? 50, sinceMinutes:options?.sinceMinutes ?? 1440 } }); return (response.data?.events || []).map(normalizeCameraEvent); },
    async createPlaybackSession(cameraId: string) { const response = await transport.get(`/cameras/${encodeURIComponent(cameraId)}/playback`); return normalizePlaybackSession(response.data, cameraId); },
  };
}
export type CameraReadClient = ReturnType<typeof createCameraReadClient>;

export type CameraSubscription = () => void;
export type CameraRealtimeAdapter = {
  subscribeToCameraEvents(cameraId: string, onEvent: (event: CameraEvent) => void): CameraSubscription;
  subscribeToCameraHealth(cameraId: string, onHealth: (health: CameraHealth) => void): CameraSubscription;
};
