// src/controllers/cameraStreamController.ts
import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { startHlsStream, getHlsDir, touchStream } from "../services/hlsStreamManager";

const APP_JWT_SECRET = process.env.APP_JWT_SECRET;

/**
 * We cannot rely on Authorization header for HLS requests.
 * HLS (video tag) will NOT send Bearer headers.
 *
 * So we secure HLS with a short-lived signed token in query string:
 *   /cameras/:cameraId/hls.m3u8?token=...
 *   /cameras/:cameraId/hls/:seg?token=...
 *
 * Token payload includes estate_id, role, user id.
 */
function verifyHlsToken(req: Request): any | null {
  try {
    if (!APP_JWT_SECRET) return null;

    const token = (req.query.token as string) || null;
    if (!token) return null;

    const decoded = jwt.verify(token, APP_JWT_SECRET) as any;
    if (!decoded?.id || !decoded?.estate_id || !decoded?.role) return null;

    return decoded;
  } catch {
    return null;
  }
}

/**
 * GET /cameras/:cameraId/hls-token
 * Returns a short-lived token that the UI can append to HLS URLs.
 *
 * This route CAN be protected with requireAuth + requireRole in routes.
 */
export async function issueHlsToken(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  if (!APP_JWT_SECRET) {
    return res.status(500).json({ error: "APP_JWT_SECRET missing" });
  }

  const { cameraId } = req.params;
  if (!cameraId) return res.status(400).json({ error: "cameraId is required" });

  // confirm camera exists and estate match
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

  // short-lived token (eg 2 minutes)
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

export async function hlsPlaylist(req: Request, res: Response) {
  // ✅ Use signed query token (NOT Authorization header)
  const user = verifyHlsToken(req);
  if (!user) return res.status(401).json({ error: "Missing token" });

  const { cameraId } = req.params;

  const { data: cam, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("*")
    .eq("id", cameraId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!cam) return res.status(404).json({ error: "Camera not found" });

  // estate authorization
  if (String(cam.estate_id) !== String(user.estate_id) && user.role !== "admin") {
    return res.status(403).json({ error: "Unauthorized" });
  }

  // start stream if not running
  startHlsStream(String(cameraId), String(cam.rtsp_url));
  touchStream(String(cameraId));

  const dir = getHlsDir(String(cameraId));
  if (!dir) return res.status(500).json({ error: "Stream failed to start" });

  const file = path.join(dir, "index.m3u8");
  if (!fs.existsSync(file)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(202).send("#EXTM3U\n# waiting for stream...\n");
  }

  res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  res.setHeader("Cache-Control", "no-store");
  return fs.createReadStream(file).pipe(res);
}

export async function hlsSegment(req: Request, res: Response) {
  // ✅ Use signed query token (NOT Authorization header)
  const user = verifyHlsToken(req);
  if (!user) return res.status(401).json({ error: "Missing token" });

  const { cameraId, seg } = req.params;

  const { data: cam } = await supabaseAdmin
    .from("facility_cameras")
    .select("id, estate_id")
    .eq("id", cameraId)
    .maybeSingle();

  if (!cam) return res.status(404).end();

  if (String(cam.estate_id) !== String(user.estate_id) && user.role !== "admin") {
    return res.status(403).end();
  }

  touchStream(String(cameraId));

  const dir = getHlsDir(String(cameraId));
  if (!dir) return res.status(404).end();

  const file = path.join(dir, seg);
  if (!fs.existsSync(file)) return res.status(404).end();

  res.setHeader("Content-Type", "video/MP2T");
  res.setHeader("Cache-Control", "no-store");
  return fs.createReadStream(file).pipe(res);
}
