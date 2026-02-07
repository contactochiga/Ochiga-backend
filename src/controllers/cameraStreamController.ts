import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../supabase/supabaseClient";

const APP_JWT_SECRET = process.env.APP_JWT_SECRET;

/**
 * HLS security:
 * We DO NOT rely on Authorization headers.
 * The browser video tag will not send them.
 *
 * Instead we use a short-lived JWT token in query params.
 *
 * Example:
 *   /cameras/:cameraId/hls.m3u8?token=...
 */
function verifyHlsToken(req: Request): any | null {
  try {
    if (!APP_JWT_SECRET) return null;

    const token = req.query.token as string;
    if (!token) return null;

    const decoded = jwt.verify(token, APP_JWT_SECRET) as any;

    if (!decoded?.id || !decoded?.estate_id || !decoded?.role) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

/**
 * GET /cameras/:cameraId/hls-token
 * Issues a short-lived token for HLS playback.
 *
 * This route SHOULD be protected by requireAuth middleware.
 */
export async function issueHlsToken(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  if (!APP_JWT_SECRET) {
    return res.status(500).json({ error: "APP_JWT_SECRET missing" });
  }

  const { cameraId } = req.params;
  if (!cameraId) {
    return res.status(400).json({ error: "cameraId is required" });
  }

  const { data: cam, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("id, estate_id")
    .eq("id", cameraId)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!cam) {
    return res.status(404).json({ error: "Camera not found" });
  }

  if (
    String(cam.estate_id) !== String(user.estate_id) &&
    user.role !== "admin"
  ) {
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

  return res.json({
    ok: true,
    token,
    expires_in: 120,
  });
}

/**
 * GET /cameras/:cameraId/hls.m3u8
 *
 * 🔥 EDGE-FIRST STREAMING
 * Backend does NOT serve video.
 * Backend only AUTHENTICATES and REDIRECTS.
 */
export async function hlsPlaylist(req: Request, res: Response) {
  const user = verifyHlsToken(req);
  if (!user) {
    return res.status(401).json({ error: "Missing or invalid token" });
  }

  const { cameraId } = req.params;

  const { data: cam, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("id, estate_id, edge_hls_url")
    .eq("id", cameraId)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!cam) {
    return res.status(404).json({ error: "Camera not found" });
  }

  if (
    String(cam.estate_id) !== String(user.estate_id) &&
    user.role !== "admin"
  ) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  if (!cam.edge_hls_url) {
    return res.status(409).json({
      error: "Camera has no edge stream configured",
    });
  }

  /**
   * 🚀 Redirect browser to EDGE (go2rtc)
   * Example:
   * http://192.168.100.146:1984/stream/gate.m3u8
   */
  return res.redirect(302, cam.edge_hls_url);
}

/**
 * GET /cameras/:cameraId/hls/:segment
 *
 * ❌ NOT USED ANYMORE
 * Edge server serves segments directly.
 */
export async function hlsSegment(req: Request, res: Response) {
  return res.status(410).end();
}
