// src/controllers/cameraStreamController.ts
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../supabase/supabaseClient";

const APP_JWT_SECRET = process.env.APP_JWT_SECRET;

/**
 * HLS security:
 * We DO NOT rely on Authorization headers.
 * The browser video tag will not send them.
 *
 * Instead we use a short-lived JWT token in query params:
 *   /cameras/:cameraId/hls.m3u8?token=...
 *   /cameras/:cameraId/hls/<segment>?token=...
 */
function verifyHlsToken(req: Request): any | null {
  try {
    if (!APP_JWT_SECRET) return null;

    const token = (req.query.token as string) || "";
    if (!token) return null;

    const decoded = jwt.verify(token, APP_JWT_SECRET) as any;
    if (!decoded?.id || !decoded?.estate_id || !decoded?.role) return null;

    return decoded;
  } catch {
    return null;
  }
}

function sameEstateOrAdmin(camEstateId: any, user: any) {
  return String(camEstateId) === String(user.estate_id) || user.role === "admin";
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

async function fetchText(url: string) {
  const r = await fetch(url, { redirect: "follow" });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text, headers: r.headers };
}

async function fetchStream(url: string) {
  const r = await fetch(url, { redirect: "follow" });
  return r;
}

function resolveUrl(base: string, maybeRelative: string) {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

/**
 * Rewrites an HLS playlist so segment URIs point back to OUR backend (same-origin),
 * which avoids mixed-content + CORS issues.
 *
 * - Keeps all #EXT lines untouched
 * - For non-# lines (segment URIs), rewrite to:
 *   /cameras/:cameraId/hls/<encoded>?token=...
 */
function rewritePlaylistToBackend(opts: {
  playlistText: string;
  cameraId: string;
  token: string;
  baseUrl: string;
}) {
  const { playlistText, cameraId, token, baseUrl } = opts;

  // IMPORTANT: We will pass the original segment uri as a single encoded string
  // and our segment route must allow a wildcard (see route note below).
  const lines = playlistText.split("\n").map((line) => line.trimEnd());

  const out = lines.map((line) => {
    if (!line || line.startsWith("#")) return line;

    const encoded = encodeURIComponent(line);
    return `${baseUrl}/cameras/${cameraId}/hls/${encoded}?token=${encodeURIComponent(
      token
    )}`;
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
  if (!cameraId) return res.status(400).json({ error: "cameraId is required" });

  const { data: cam, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("id, estate_id")
    .eq("id", cameraId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!cam) return res.status(404).json({ error: "Camera not found" });

  if (!sameEstateOrAdmin(cam.estate_id, user)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  // short-lived token (2 minutes)
  const token = jwt.sign(
    { id: user.id, role: user.role, estate_id: user.estate_id },
    APP_JWT_SECRET,
    { expiresIn: "2m" }
  );

  return res.json({ ok: true, token, expires_in: 120 });
}

/**
 * GET /cameras/:cameraId/hls.m3u8
 *
 * ✅ Backend proxies the playlist from edge (go2rtc) and rewrites segment URLs
 * to our backend to avoid mixed-content + CORS + redirect blocking.
 */
export async function hlsPlaylist(req: Request, res: Response) {
  const user = verifyHlsToken(req);
  if (!user) return res.status(401).json({ error: "Missing or invalid token" });

  const { cameraId } = req.params;

  const { data: cam, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("id, estate_id, edge_hls_url")
    .eq("id", cameraId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!cam) return res.status(404).json({ error: "Camera not found" });

  if (!sameEstateOrAdmin(cam.estate_id, user)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  if (!cam.edge_hls_url) {
    return res.status(409).json({ error: "Camera has no edge_hls_url set" });
  }

  // Fetch playlist from edge
  const edgeUrl = String(cam.edge_hls_url);
  const { ok, status, text } = await fetchText(edgeUrl);

  if (!ok) {
    return res.status(502).json({
      error: `Edge playlist fetch failed`,
      edge_status: status,
    });
  }

  const baseUrl = reqBaseUrl(req);
  const token = (req.query.token as string) || "";

  // Rewrite playlist to use our backend for segments (same-origin)
  const rewritten = rewritePlaylistToBackend({
    playlistText: text,
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
 *
 * ✅ Backend proxies segments from edge.
 * NOTE: `:seg` is URL-encoded original segment path from playlist.
 */
export async function hlsSegment(req: Request, res: Response) {
  const user = verifyHlsToken(req);
  if (!user) return res.status(401).end();

  const { cameraId } = req.params;

  // `seg` may include encoded characters; decode it back to original line
  const rawSeg = (req.params as any).seg as string;
  if (!rawSeg) return res.status(400).end();

  let segLine = rawSeg;
  try {
    segLine = decodeURIComponent(rawSeg);
  } catch {
    // keep as-is
  }

  const { data: cam, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("id, estate_id, edge_hls_url")
    .eq("id", cameraId)
    .maybeSingle();

  if (error) return res.status(500).end();
  if (!cam) return res.status(404).end();

  if (!sameEstateOrAdmin(cam.estate_id, user)) return res.status(403).end();
  if (!cam.edge_hls_url) return res.status(409).end();

  const edgePlaylistUrl = String(cam.edge_hls_url);

  // Segment URLs in HLS playlist can be relative; resolve against the playlist URL.
  const segUrl = resolveUrl(edgePlaylistUrl, segLine);

  const r = await fetchStream(segUrl);

  if (!r.ok) {
    return res.status(502).end();
  }

  // pass content-type if available
  const ct = r.headers.get("content-type") || "video/MP2T";
  res.setHeader("Content-Type", ct);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");

  // Pipe the segment bytes
  const body = r.body;
  if (!body) return res.status(502).end();

  // Node fetch body is a ReadableStream; convert to node stream via `Readable.fromWeb`
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Readable } = require("stream");
  return Readable.fromWeb(body).pipe(res);
}
