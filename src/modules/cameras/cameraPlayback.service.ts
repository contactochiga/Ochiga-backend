import jwt from "jsonwebtoken";
import type { Request } from "express";
import { canAccessCamera, cameraPrivacyScope } from "./cameraAccess.policy";

const PLAYBACK_TOKEN_SECONDS = 120;

export function requestBaseUrl(req: Request) {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "";
  return `${proto}://${host}`;
}

export function issueCameraPlaybackToken(user: any, camera: any, secret = process.env.APP_JWT_SECRET) {
  if (!secret) return null;
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      estate_id: user.estate_id,
      home_id: user.home_id || null,
      camera_id: camera.id,
      privacy_scope: cameraPrivacyScope(camera),
    },
    secret,
    { expiresIn: `${PLAYBACK_TOKEN_SECONDS}s` }
  );
}

export function verifyCameraPlaybackToken(token: string, secret = process.env.APP_JWT_SECRET) {
  if (!secret || !token) return null;
  try {
    const decoded = jwt.verify(token, secret) as any;
    if (!decoded?.id || !decoded?.estate_id || !decoded?.role || !decoded?.camera_id) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function playbackExpiry() {
  return new Date(Date.now() + PLAYBACK_TOKEN_SECONDS * 1000).toISOString();
}

export function buildCameraPlaybackContract(req: Request, camera: any, user: any) {
  const access = canAccessCamera(camera, user);
  const edgeUrl = String(camera?.edge_hls_url || camera?.hls_url || "").trim();
  const streamStatus = String(camera?.stream_status || camera?.health_status || camera?.status || (edgeUrl ? "ready" : "pending_stream_details"));
  const edgeStatus = edgeUrl ? "available" : "missing_hls";
  const token = issueCameraPlaybackToken(user, camera);
  const baseUrl = requestBaseUrl(req);
  const hlsUrl = token
    ? `${baseUrl}/cameras/${encodeURIComponent(String(camera.id))}/hls.m3u8?token=${encodeURIComponent(token)}`
    : "";

  return {
    ok: access.ok && Boolean(token) && Boolean(edgeUrl),
    camera_id: String(camera.id),
    playback_type: "hls",
    type: "hls",
    hls_url: hlsUrl || null,
    url: hlsUrl || null,
    webrtc_url: null,
    expires_at: token ? playbackExpiry() : null,
    edge_status: edgeStatus,
    stream_status: streamStatus,
    message: !access.ok
      ? "Permission denied"
      : !token
        ? "Playback token unavailable"
        : !edgeUrl
          ? "Stream runtime unavailable"
          : "Playback ready",
    camera: {
      id: camera.id,
      name: camera.name || "Camera",
      privacy_scope: cameraPrivacyScope(camera),
      edge_node_id: camera.edge_node_id || null,
    },
  };
}
