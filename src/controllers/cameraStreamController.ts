// src/controllers/cameraStreamController.ts
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
import { supabaseAdmin } from "../supabase/supabaseClient";

const APP_JWT_SECRET = process.env.APP_JWT_SECRET;

/**
 * HLS security:
 * We DO NOT rely on Authorization headers.
 * Browser video tag will not send them.
 *
 * Instead we use a short-lived JWT token in query params.
 *
 * Example:
 *   /cameras/:cameraId/hls.m3u8?token=...
 *   /cameras/:cameraId/hls/:seg?token=...
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

function noStore(res: Response) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function allowCors(res: Response) {
  // Safe here because we still require signed token for access
  res.setHeader("Access-Control-Allow-Origin", "*");
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

  if (String(cam.estate_id) !== String(user.estate_id) && user.role !== "admin") {
    return res.status(403).json({ error: "Unauthorized" });
  }

  // ⏱ short-lived token (2 minutes)
  const token = jwt.sign(
    {
      id: user.id,
      role: user.role,
      estate_id: user.estate_id,
    },
    APP_JWT_SECRET,
    { expiresIn: "2m" }
  );

  return res.json({ ok: true, token, expires_in: 120 });
}

/**
 * GET /cameras/:cameraId/hls.m3u8
 *
 * ✅ PROXY MODE (WORKS FOR DASHBOARD)
 * Browser cannot access 192.168.x.x directly from cloud.
 * So backend fetches the edge playlist and rewrites segment paths
 * to go back through backend:
 *
 *  segment.ts  -> /cameras/:cameraId/hls/segment.ts?token=...
 */
export async function hlsPlaylist(req: Request, res: Response) {
  const user = verifyHlsToken(req);
  if (!user) return res.status(401).json({ error: "Missing or invalid token" });

  const { cameraId } = req.params;
  const token = (req.query.token as string) || "";

  const { data: cam, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("id, estate_id, edge_hls_url")
    .eq("id", cameraId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!cam) return res.status(404).json({ error: "Camera not found" });

  if (String(cam.estate_id) !== String(user.estate_id) && user.role !== "admin") {
    return res.status(403).json({ error: "Unauthorized" });
  }

  if (!cam.edge_hls_url) {
    return res.status(409).json({ error: "Camera has no edge stream configured" });
  }

  try {
    // Fetch playlist from edge
    const upstream = await axios.get<string>(cam.edge_hls_url, {
      timeout: 15000,
      responseType: "text",
      validateStatus: () => true,
    });

    if (upstream.status >= 400) {
      return res.status(502).json({
        error: "Edge playlist fetch failed",
        upstream_status: upstream.status,
      });
    }

    const raw = String(upstream.data || "");

    // Rewrite segments so browser requests segments from our backend
    // Only rewrite non-comment lines that look like segment/child playlist URIs.
    const rewritten = raw
      .split("\n")
      .map((line) => {
        const l = line.trim();
        if (!l) return line;

        // comments + tags
        if (l.startsWith("#")) return line;

        // absolute URLs: keep but still route through backend for consistency/security
        // If it's an absolute URL, encode it as a "seg" path by taking its pathname file.
        // But best is: treat as a segment name if it looks like a file.
        // We'll handle both cases:
        const isAbsolute = /^https?:\/\//i.test(l);

        // If line is something like index0.ts / chunk.m4s / sub.m3u8 etc
        // Route through backend:
        // /cameras/:cameraId/hls/<SEG>?token=...
        const segName = isAbsolute ? l : l;

        // IMPORTANT: preserve query strings from edge segments if present
        // We'll pass the whole segName as-is, but URL-encode it safely.
        // We send it as a path parameter, so we need to encode slashes.
        const encoded = encodeURIComponent(segName);

        return `/cameras/${cameraId}/hls/${encoded}?token=${encodeURIComponent(token)}`;
      })
      .join("\n");

    allowCors(res);
    noStore(res);
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");

    return res.status(200).send(rewritten);
  } catch (e: any) {
    return res.status(502).json({ error: "Edge playlist proxy failed", detail: e?.message || "error" });
  }
}

/**
 * GET /cameras/:cameraId/hls/:seg
 *
 * ✅ PROXY SEGMENTS (WORKS FOR DASHBOARD)
 * The playlist is rewritten to hit this route.
 *
 * NOTE:
 * seg is URL-encoded full segment path or URL from edge.
 * We decode it and fetch from the edge base URL.
 */
export async function hlsSegment(req: Request, res: Response) {
  const user = verifyHlsToken(req);
  if (!user) return res.status(401).end();

  const { cameraId } = req.params;
  const segEncoded = req.params.seg || "";
  const segRaw = decodeURIComponent(segEncoded);

  const { data: cam, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("id, estate_id, edge_hls_url")
    .eq("id", cameraId)
    .maybeSingle();

  if (error) return res.status(500).end();
  if (!cam) return res.status(404).end();

  if (String(cam.estate_id) !== String(user.estate_id) && user.role !== "admin") {
    return res.status(403).end();
  }

  if (!cam.edge_hls_url) return res.status(409).end();

  try {
    // Build segment URL:
    // - If segRaw is an absolute URL -> use it directly
    // - Else resolve relative to the edge_hls_url directory
    let segUrl: string;

    if (/^https?:\/\//i.test(segRaw)) {
      segUrl = segRaw;
    } else {
      const u = new URL(cam.edge_hls_url);
      // edge_hls_url might be .../stream/gate.m3u8
      // Resolve relative segments to same directory (/stream/)
      const basePath = u.pathname.replace(/\/[^/]*$/, "/");
      u.pathname = basePath + segRaw.replace(/^\//, "");
      // keep original base query? usually none. segments may have their own query in segRaw already.
      // If segRaw includes '?', URL() above won't include it. So handle query manually:
      if (segRaw.includes("?")) {
        const [p, q] = segRaw.split("?");
        u.pathname = basePath + p.replace(/^\//, "");
        u.search = "?" + q;
      } else {
        u.search = "";
      }
      segUrl = u.toString();
    }

    // Pass through Range header (helps players sometimes)
    const range = req.headers.range;

    const upstream = await axios.get(segUrl, {
      timeout: 20000,
      responseType: "stream",
      headers: {
        ...(range ? { Range: range } : {}),
      },
      validateStatus: () => true,
    });

    if (upstream.status >= 400) {
      return res.status(404).end();
    }

    allowCors(res);
    noStore(res);

    // forward content-type if present; else fallback
    const ct = upstream.headers["content-type"];
    if (ct) res.setHeader("Content-Type", ct);

    // forward status (206 for range, etc.)
    res.status(upstream.status);

    // forward important headers
    const cl = upstream.headers["content-length"];
    if (cl) res.setHeader("Content-Length", cl);

    const cr = upstream.headers["content-range"];
    if (cr) res.setHeader("Content-Range", cr);

    if (range) res.setHeader("Accept-Ranges", "bytes");

    upstream.data.pipe(res);
  } catch {
    return res.status(502).end();
  }
}
