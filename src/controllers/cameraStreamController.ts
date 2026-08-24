// src/controllers/cameraStreamController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { canAccessCamera } from "../modules/cameras/cameraAccess.policy";
import { issueCameraPlaybackToken, playbackExpiry, verifyCameraPlaybackToken } from "../modules/cameras/cameraPlayback.service";
import { assertAuthorizedMediaUrl } from "../modules/cameras/cameraMediaPolicy";

const APP_JWT_SECRET = process.env.APP_JWT_SECRET;

/**
 * HLS security:
 * We DO NOT rely on Authorization headers.
 * The browser video tag will not send them.
 *
 * Instead we use a short-lived JWT token in query params:
 *   /cameras/:cameraId/hls.m3u8?token=...
 *   /cameras/:cameraId/hls/<encoded-absolute-url>?token=...
 */
function verifyHlsToken(req: Request): any | null {
  try {
    if (!APP_JWT_SECRET) return null;

    const token = (req.query.token as string) || "";
    if (!token) return null;

    return verifyCameraPlaybackToken(token, APP_JWT_SECRET);
  } catch {
    return null;
  }
}

function reqBaseUrl(req: Request) {
  // Respect proxies (Render/Cloudflare) so generated URLs are https
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (req.protocol as string) ||
    "http";
  const host =
    (req.headers["x-forwarded-host"] as string) || req.get("host") || "";
  return `${proto}://${host}`;
}

function resolveUrl(base: string, maybeRelative: string) {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

function parseRewindSeconds(v: any) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 24 * 60 * 60);
}

function withQuery(url: string, key: string, value: string | number) {
  try {
    const u = new URL(url);
    u.searchParams.set(key, String(value));
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
  }
}

async function fetchBound(url: string, configuredPlaylistUrl: string, redirects = 0): Promise<globalThis.Response> {
  const authorized = assertAuthorizedMediaUrl(url, configuredPlaylistUrl);
  const response = await fetch(authorized, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    if (redirects >= 3) throw new Error("media_redirect_limit");
    const location = response.headers.get("location");
    if (!location) throw new Error("media_redirect_without_location");
    const redirected = new URL(location, authorized).toString();
    assertAuthorizedMediaUrl(redirected, configuredPlaylistUrl);
    return fetchBound(redirected, configuredPlaylistUrl, redirects + 1);
  }
  return response;
}

async function fetchText(url: string, configuredPlaylistUrl: string) {
  const r = await fetchBound(url, configuredPlaylistUrl);
  const text = await r.text();
  return { ok: r.ok, status: r.status, text, headers: r.headers };
}

async function fetchStream(url: string, configuredPlaylistUrl: string) {
  return fetchBound(url, configuredPlaylistUrl);
}

/**
 * Rewrites ANY HLS playlist (master or media) so ALL URIs point back to OUR backend
 * and ALWAYS include the token.
 *
 * Key idea:
 * - Convert every non-# line to an ABSOLUTE URL (resolved against the playlist URL)
 * - Then encode that absolute URL into our /hls/:seg route
 */
function rewritePlaylistToBackend(opts: {
  playlistText: string;
  playlistUrl: string; // <--- important (what this playlist was fetched from)
  cameraId: string;
  token: string;
  baseUrl: string;
}) {
  const { playlistText, playlistUrl, cameraId, token, baseUrl } = opts;

  const lines = playlistText.split("\n").map((line) => line.trimEnd());

  const proxyUrl = (uri: string) => {
    const absolute = assertAuthorizedMediaUrl(resolveUrl(playlistUrl, uri), playlistUrl);
    return `${baseUrl}/cameras/${cameraId}/hls/${encodeURIComponent(absolute)}?token=${encodeURIComponent(token)}`;
  };

  const out = lines.map((line) => {
    if (!line) return line;
    if (line.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${proxyUrl(uri)}"`);
    }
    return proxyUrl(line);
  });

  return out.join("\n");
}

/**
 * GET /cameras/:cameraId/hls-token
 * Issues a short-lived token for HLS playback.
 *
 * This route SHOULD be protected by requireAuth middleware.
 */
export async function issueHlsToken(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  if (!APP_JWT_SECRET) {
    return res.status(500).json({ error: "APP_JWT_SECRET missing" });
  }

  const { cameraId } = req.params;
  if (user.camera_id && String(user.camera_id) !== String(cameraId)) {
    return res.status(403).json({ error: "Playback token is not valid for this camera" });
  }
  if (!cameraId) return res.status(400).json({ error: "cameraId is required" });

  const { data: cam, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("id, estate_id, metadata")
    .eq("id", cameraId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!cam) return res.status(404).json({ error: "Camera not found" });

  const access = canAccessCamera(cam, user);
  if (!access.ok) {
    return res.status(403).json({ error: "Permission denied", code: access.reason });
  }

  const token = issueCameraPlaybackToken(user, cam, APP_JWT_SECRET);
  if (!token) return res.status(500).json({ error: "Token generation failed" });

  return res.json({ ok: true, token, expires_in: 120, expires_at: playbackExpiry() });
}

/**
 * GET /cameras/:cameraId/hls.m3u8
 * Proxies the EDGE playlist and rewrites it to same-origin backend URLs.
 */
export async function hlsPlaylist(req: Request, res: Response) {
  const user = verifyHlsToken(req);
  if (!user) return res.status(401).json({ error: "Missing or invalid token" });

  const { cameraId } = req.params;
  if (user.camera_id && String(user.camera_id) !== String(cameraId)) return res.status(403).end();

  const { data: cam, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("id, estate_id, edge_hls_url, metadata")
    .eq("id", cameraId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!cam) return res.status(404).json({ error: "Camera not found" });

  const access = canAccessCamera(cam, user);
  if (!access.ok) {
    return res.status(403).json({ error: "Permission denied", code: access.reason });
  }

  if (!cam.edge_hls_url) {
    return res.status(409).json({ error: "Camera has no edge_hls_url set" });
  }

  let edgeUrl = String(cam.edge_hls_url);
  const rewind = parseRewindSeconds(req.query.rewind);
  if (rewind > 0) {
    // Edge can choose which query params to honor.
    edgeUrl = withQuery(edgeUrl, "rewind", rewind);
    edgeUrl = withQuery(edgeUrl, "start_offset", rewind);
  }
  let edgePlaylistUrl: string;
  try {
    edgePlaylistUrl = assertAuthorizedMediaUrl(edgeUrl, String(cam.edge_hls_url));
  } catch {
    return res.status(409).json({ error: "Camera media source is invalid" });
  }
  const { ok, status, text } = await fetchText(edgePlaylistUrl, String(cam.edge_hls_url));

  if (!ok) {
    return res.status(502).json({
      error: `Edge playlist fetch failed`,
      edge_status: status,
    });
  }

  const baseUrl = reqBaseUrl(req);
  const token = (req.query.token as string) || "";

  // Rewrite master playlist -> backend routes
  const rewritten = rewritePlaylistToBackend({
    playlistText: text,
    playlistUrl: edgePlaylistUrl,
    cameraId: String(cameraId),
    token,
    baseUrl,
  });

  res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  return res.status(200).send(rewritten);
}

/**
 * GET /cameras/:cameraId/hls/:seg
 * Proxies either:
 * - a .ts segment
 * - OR another .m3u8 playlist (nested) -> in which case we rewrite again
 *
 * NOTE: `:seg` is an encoded ABSOLUTE url (after our rewrite).
 */
export async function hlsSegment(req: Request, res: Response) {
  const user = verifyHlsToken(req);
  if (!user) return res.status(401).end();

  const { cameraId } = req.params;

  const rawSeg = (req.params as any).seg as string;
  if (!rawSeg) return res.status(400).end();

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(rawSeg);
  } catch {
    return res.status(400).json({ error: "Malformed media resource" });
  }

  const { data: cam, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("id, estate_id, edge_hls_url, metadata")
    .eq("id", cameraId)
    .maybeSingle();

  if (error) return res.status(500).end();
  if (!cam) return res.status(404).end();
  if (!canAccessCamera(cam, user).ok) return res.status(403).end();
  if (!cam.edge_hls_url) return res.status(409).end();

  const token = (req.query.token as string) || "";
  const baseUrl = reqBaseUrl(req);

  // If somehow we received a relative url, resolve against the camera's edge playlist url
  try {
    targetUrl = assertAuthorizedMediaUrl(targetUrl, String(cam.edge_hls_url));
  } catch (error: any) {
    console.warn("camera_media_resource_rejected", {
      camera_id: cameraId,
      reason: String(error?.message || "invalid_media_resource"),
    });
    return res.status(403).json({ error: "Media resource is not authorized for this camera" });
  }

  let r: globalThis.Response;
  try {
    r = await fetchStream(targetUrl, String(cam.edge_hls_url));
  } catch (error: any) {
    console.warn("camera_media_redirect_rejected", {
      camera_id: cameraId,
      reason: String(error?.message || "invalid_media_redirect"),
    });
    return res.status(403).json({ error: "Media redirect is not authorized for this camera" });
  }
  if (!r.ok) return res.status(502).end();

  const ct = r.headers.get("content-type") || "";

  // If this "segment" is actually another playlist, rewrite it too
  const looksLikePlaylist =
    ct.includes("application/vnd.apple.mpegurl") ||
    ct.includes("application/x-mpegURL") ||
    targetUrl.toLowerCase().includes(".m3u8");

  if (looksLikePlaylist) {
    const text = await r.text();

    const rewritten = rewritePlaylistToBackend({
      playlistText: text,
      playlistUrl: targetUrl, // IMPORTANT: resolve relatives from THIS nested playlist
      cameraId: String(cameraId),
      token,
      baseUrl,
    });

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    return res.status(200).send(rewritten);
  }

  // Otherwise, it’s a media segment (ts/fmp4)
  res.setHeader("Content-Type", ct || "video/MP2T");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");

  const body = r.body;
  if (!body) return res.status(502).end();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Readable } = require("stream");
  return Readable.fromWeb(body).pipe(res);
}
