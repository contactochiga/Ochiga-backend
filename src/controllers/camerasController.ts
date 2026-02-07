// src/controllers/camerasController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { scanCameras } from "../device/cameras/cameraOrchestrator";

function pickError(err: any, fallback: string) {
  return (
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    fallback
  );
}

/**
 * POST /cameras/scan
 * body: { cidr?: "192.168.100.0/24", username?: "admin", password?: "admin" }
 * Scans LAN for ONVIF cameras + returns RTSP URIs where possible.
 */
export async function scan(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { cidr, username, password } = req.body || {};

  try {
    const devices = await scanCameras({
      estateId: user.estate_id,
      homeId: user.home_id,
      userId: user.id,
      credentials: {
        cidr,
        username,
        password,
      },
    });

    return res.json({ ok: true, items: devices });
  } catch (err: any) {
    return res.status(500).json({ error: pickError(err, "Scan failed") });
  }
}

/**
 * GET /cameras/estate/:estateId
 * Lists bound cameras for estate (facility UI)
 */
export async function listByEstate(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { estateId } = req.params;
  if (!estateId) return res.status(400).json({ error: "estateId is required" });

  // ✅ Admin can read all
  if (user.role !== "admin") {
    // ✅ Check membership table (source of truth)
    const { data: membership, error: mErr } = await supabaseAdmin
      .from("estate_memberships")
      .select("id, role, status")
      .eq("estate_id", estateId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (mErr) return res.status(500).json({ error: mErr.message });

    if (!membership) {
      return res
        .status(403)
        .json({ error: "Unauthorized (not a member of this estate)" });
    }

    // optional: enforce status
    if (membership.status && membership.status !== "active") {
      return res.status(403).json({ error: "Unauthorized (membership not active)" });
    }
  }

  const { data, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("*")
    .eq("estate_id", estateId)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, items: data || [] });
}

/**
 * POST /cameras/bind
 * body: { estateId, name, ip, onvif_port?, rtsp_url, username?, password? }
 */
export async function bind(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { estateId, name, ip, onvif_port, rtsp_url, username, password } =
    req.body || {};

  const resolvedEstateId = estateId || user.estate_id;
  if (!resolvedEstateId) return res.status(400).json({ error: "estateId is required" });
  if (!ip) return res.status(400).json({ error: "ip is required" });
  if (!rtsp_url) return res.status(400).json({ error: "rtsp_url is required" });

  // prevent duplicates per estate+ip
  const { data: existing } = await supabaseAdmin
    .from("facility_cameras")
    .select("*")
    .eq("estate_id", resolvedEstateId)
    .eq("ip", ip)
    .maybeSingle();

  if (existing) {
    // update instead
    const { data, error } = await supabaseAdmin
      .from("facility_cameras")
      .update({
        name: name ?? existing.name,
        onvif_port: onvif_port ?? existing.onvif_port,
        rtsp_url,
        username: username ?? existing.username,
        password: password ?? existing.password,
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, camera: data });
  }

  const { data, error } = await supabaseAdmin
    .from("facility_cameras")
    .insert({
      estate_id: resolvedEstateId,
      name: name ?? `Camera ${ip}`,
      ip,
      onvif_port: onvif_port ?? null,
      rtsp_url,
      username: username ?? null,
      password: password ?? null,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, camera: data });
}

/**
 * POST /cameras/bind-from-discovery
 * body: {
 *   estateId?, name?, ip, onvif_port?, xaddr?, username?, password?,
 *   rtsp_url?, rtsp_port?
 * }
 *
 * Edge discovery gives ONVIF details; bind() requires rtsp_url.
 * This generates a best-guess RTSP URL (or uses provided rtsp_url),
 * then reuses bind() so DB logic stays consistent.
 */
export async function bindFromDiscovery(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const {
    estateId,
    name,
    ip,
    onvif_port,
    xaddr, // optional (kept for future use)
    username,
    password,
    rtsp_url,
    rtsp_port,
  } = req.body || {};

  const resolvedEstateId = estateId || user.estate_id;
  if (!resolvedEstateId) return res.status(400).json({ error: "estateId is required" });
  if (!ip) return res.status(400).json({ error: "ip is required" });

  // If RTSP is already known, just bind directly using existing bind()
  if (rtsp_url) {
    req.body = {
      estateId: resolvedEstateId,
      name,
      ip,
      onvif_port,
      rtsp_url,
      username,
      password,
    };
    return bind(req, res);
  }

  // Generate RTSP candidates (common patterns)
  const port = Number(rtsp_port || 554);
  const userPart =
    username && password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : "";

  const candidates = [
    `rtsp://${userPart}${ip}:${port}/live`,
    `rtsp://${userPart}${ip}:${port}/h264`,
    `rtsp://${userPart}${ip}:${port}/h264/ch1/main/av_stream`,
    `rtsp://${userPart}${ip}:${port}/h264/ch1/sub/av_stream`,
    `rtsp://${userPart}${ip}:${port}/cam/realmonitor?channel=1&subtype=0`,
    `rtsp://${userPart}${ip}:${port}/cam/realmonitor?channel=1&subtype=1`,
    `rtsp://${userPart}${ip}:${port}/Streaming/Channels/101`,
    `rtsp://${userPart}${ip}:${port}/Streaming/Channels/102`,
    `rtsp://${userPart}${ip}:${port}/stream1`,
    `rtsp://${userPart}${ip}:${port}/stream2`,
  ];

  // Pick the first candidate (for now). You can override later by sending rtsp_url explicitly.
  const chosen = candidates[0];

  // Reuse bind() to write/update facility_cameras
  req.body = {
    estateId: resolvedEstateId,
    name: name ?? `Camera ${ip}`,
    ip,
    onvif_port: onvif_port ?? null,
    rtsp_url: chosen,
    username: username ?? null,
    password: password ?? null,
    // keep for debugging (bind ignores unknown fields)
    xaddr: xaddr ?? null,
    rtsp_candidates: candidates,
  };

  return bind(req, res);
}
