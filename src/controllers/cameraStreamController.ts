// src/controllers/cameraStreamController.ts
import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { startHlsStream, getHlsDir, touchStream } from "../services/hlsStreamManager";

export async function hlsPlaylist(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

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
    // give ffmpeg a tiny moment on first start
    res.setHeader("Cache-Control", "no-store");
    return res.status(202).send("#EXTM3U\n# waiting for stream...\n");
  }

  res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  res.setHeader("Cache-Control", "no-store");
  return fs.createReadStream(file).pipe(res);
}

export async function hlsSegment(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { cameraId, seg } = req.params;

  // We assume playlist already checked auth; but still enforce minimal
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
