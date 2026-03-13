import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../supabase/supabaseClient";

const APP_JWT_SECRET = process.env.APP_JWT_SECRET;

const MAX_REWIND_SECONDS = 24 * 60 * 60; // 24h
const DEFAULT_REWIND_SECONDS = 5 * 60;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseIntSafe(v: any, fallback: number) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function sameEstateOrAdmin(camEstateId: any, user: any) {
  return String(camEstateId) === String(user?.estate_id) || String(user?.role) === "admin";
}

function reqBaseUrl(req: Request) {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "";
  return `${proto}://${host}`;
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

function isMissingCameraEventsTable(err: any) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("camera_events") &&
    (msg.includes("does not exist") || msg.includes("could not find the table") || msg.includes("relation"))
  );
}

function isMissingCameraAiProfilesTable(err: any) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("camera_ai_profiles") &&
    (msg.includes("does not exist") || msg.includes("could not find the table") || msg.includes("relation"))
  );
}

async function resolveCamera(cameraId: string) {
  return supabaseAdmin
    .from("facility_cameras")
    .select("id, estate_id, name, edge_hls_url")
    .eq("id", cameraId)
    .maybeSingle();
}

function issuePlaybackToken(user: any) {
  if (!APP_JWT_SECRET) return null;
  return jwt.sign(
    { id: user.id, role: user.role, estate_id: user.estate_id },
    APP_JWT_SECRET,
    { expiresIn: "2m" }
  );
}

/**
 * GET /cameras/:cameraId/playback?rewind=300
 * Returns an HLS URL that can start from rewind offset if edge supports it.
 */
export async function getPlaybackUrl(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  if (!APP_JWT_SECRET) return res.status(500).json({ error: "APP_JWT_SECRET missing" });

  const { cameraId } = req.params;
  if (!cameraId) return res.status(400).json({ error: "cameraId is required" });

  const rewindInput = parseIntSafe(req.query.rewind, DEFAULT_REWIND_SECONDS);
  const rewind = clamp(rewindInput, 0, MAX_REWIND_SECONDS);

  const { data: cam, error } = await resolveCamera(cameraId);
  if (error) return res.status(500).json({ error: error.message });
  if (!cam) return res.status(404).json({ error: "Camera not found" });
  if (!sameEstateOrAdmin(cam.estate_id, user)) return res.status(403).json({ error: "Unauthorized" });

  const token = issuePlaybackToken(user);
  if (!token) return res.status(500).json({ error: "Token generation failed" });

  const baseUrl = reqBaseUrl(req);
  const url = `${baseUrl}/cameras/${encodeURIComponent(String(cameraId))}/hls.m3u8?token=${encodeURIComponent(
    token
  )}&rewind=${encodeURIComponent(String(rewind))}`;

  return res.json({
    ok: true,
    type: "hls",
    url,
    camera: { id: cam.id, name: cam.name || "Camera" },
    rewind,
  });
}

/**
 * GET /cameras/:cameraId/events?limit=50
 */
export async function listEvents(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { cameraId } = req.params;
  if (!cameraId) return res.status(400).json({ error: "cameraId is required" });

  const { data: cam, error } = await resolveCamera(cameraId);
  if (error) return res.status(500).json({ error: error.message });
  if (!cam) return res.status(404).json({ error: "Camera not found" });
  if (!sameEstateOrAdmin(cam.estate_id, user)) return res.status(403).json({ error: "Unauthorized" });

  const limit = clamp(parseIntSafe(req.query.limit, 50), 1, 200);
  const sinceMinutes = clamp(parseIntSafe(req.query.sinceMinutes, 24 * 60), 1, 24 * 60 * 7);
  const sinceIso = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();

  const { data, error: qErr } = await supabaseAdmin
    .from("camera_events")
    .select("*")
    .eq("camera_id", cameraId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (qErr) {
    if (isMissingCameraEventsTable(qErr)) {
      return res.json({ ok: true, events: [], warning: "camera_events table is not ready yet" });
    }
    return res.status(500).json({ error: qErr.message });
  }

  return res.json({ ok: true, events: data || [] });
}

/**
 * POST /cameras/:cameraId/events
 * body: { event_type, confidence?, snapshot_url?, message?, metadata? }
 */
export async function createEvent(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { cameraId } = req.params;
  if (!cameraId) return res.status(400).json({ error: "cameraId is required" });

  const { data: cam, error } = await resolveCamera(cameraId);
  if (error) return res.status(500).json({ error: error.message });
  if (!cam) return res.status(404).json({ error: "Camera not found" });
  if (!sameEstateOrAdmin(cam.estate_id, user)) return res.status(403).json({ error: "Unauthorized" });

  const eventType = String(req.body?.event_type || req.body?.type || "").trim().toLowerCase();
  if (!eventType) return res.status(400).json({ error: "event_type is required" });

  const confidenceRaw = Number(req.body?.confidence);
  const confidence =
    Number.isFinite(confidenceRaw) && confidenceRaw >= 0 ? Math.min(confidenceRaw, 1) : null;

  const payload = {
    camera_id: cameraId,
    estate_id: cam.estate_id,
    event_type: eventType,
    confidence,
    snapshot_url: req.body?.snapshot_url ? String(req.body.snapshot_url) : null,
    message: req.body?.message ? String(req.body.message) : null,
    metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {},
    created_by: user.id,
  };

  const { data, error: iErr } = await supabaseAdmin
    .from("camera_events")
    .insert(payload as any)
    .select("*")
    .single();

  if (iErr) {
    if (isMissingCameraEventsTable(iErr)) {
      return res.status(503).json({
        error: "camera_events table is missing. Run latest DB migration.",
        code: "CAMERA_EVENTS_TABLE_MISSING",
      });
    }
    return res.status(500).json({ error: iErr.message });
  }

  return res.json({ ok: true, event: data });
}

export async function getAnalyticsCapabilities(_req: Request, res: Response) {
  return res.json({
    ok: true,
    capabilities: [
      "face_recognition",
      "animal_detection",
      "person_detection",
      "vehicle_detection",
      "suspicious_motion",
      "line_crossing",
      "zone_intrusion",
      "smoke_alert",
    ],
    note: "Use /cameras/:cameraId/events to ingest edge detections into timeline.",
  });
}

/**
 * GET /cameras/:cameraId/ai/profile
 */
export async function getAiProfile(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { cameraId } = req.params;
  if (!cameraId) return res.status(400).json({ error: "cameraId is required" });

  const { data: cam, error } = await resolveCamera(cameraId);
  if (error) return res.status(500).json({ error: error.message });
  if (!cam) return res.status(404).json({ error: "Camera not found" });
  if (!sameEstateOrAdmin(cam.estate_id, user)) return res.status(403).json({ error: "Unauthorized" });

  const { data, error: qErr } = await supabaseAdmin
    .from("camera_ai_profiles")
    .select("*")
    .eq("camera_id", cameraId)
    .maybeSingle();

  if (qErr) {
    if (isMissingCameraAiProfilesTable(qErr)) {
      return res.status(404).json({
        error: "camera_ai_profiles table is missing. Run latest DB migration.",
        code: "CAMERA_AI_PROFILES_TABLE_MISSING",
      });
    }
    return res.status(500).json({ error: qErr.message });
  }

  return res.json({ ok: true, profile: data || null });
}

/**
 * PUT /cameras/:cameraId/ai/profile
 */
export async function upsertAiProfile(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { cameraId } = req.params;
  if (!cameraId) return res.status(400).json({ error: "cameraId is required" });

  const { data: cam, error } = await resolveCamera(cameraId);
  if (error) return res.status(500).json({ error: error.message });
  if (!cam) return res.status(404).json({ error: "Camera not found" });
  if (!sameEstateOrAdmin(cam.estate_id, user)) return res.status(403).json({ error: "Unauthorized" });

  const b = req.body || {};
  const n = (v: any, fallback: number, min: number, max: number) =>
    clamp(Number.isFinite(Number(v)) ? Number(v) : fallback, min, max);
  const bool = (v: any, fallback = false) => (typeof v === "boolean" ? v : fallback);

  const payload = {
    camera_id: cameraId,
    estate_id: cam.estate_id,
    armed: bool(b.armed, true),
    mode: ["home", "away", "night", "vacation"].includes(String(b.mode || "").toLowerCase())
      ? String(b.mode).toLowerCase()
      : "home",
    sensitivity: n(b.sensitivity, 70, 0, 100),
    min_confidence: n(b.minConfidence, 70, 0, 100),
    detect_human: bool(b.detectHuman, true),
    detect_vehicle: bool(b.detectVehicle, true),
    detect_animal: bool(b.detectAnimal, false),
    detect_face: bool(b.detectFace, false),
    detect_loitering: bool(b.detectLoitering, false),
    detect_intrusion: bool(b.detectIntrusion, true),
    notify_in_app: bool(b.notifyInApp, true),
    notify_push: bool(b.notifyPush, true),
    notify_sms: bool(b.notifySms, false),
    auto_record_on_detect: bool(b.autoRecordOnDetect, true),
    metadata: b && typeof b.metadata === "object" ? b.metadata : {},
    updated_by: user.id,
  };

  const { data, error: upErr } = await supabaseAdmin
    .from("camera_ai_profiles")
    .upsert(payload as any, { onConflict: "camera_id" })
    .select("*")
    .single();

  if (upErr) {
    if (isMissingCameraAiProfilesTable(upErr)) {
      return res.status(404).json({
        error: "camera_ai_profiles table is missing. Run latest DB migration.",
        code: "CAMERA_AI_PROFILES_TABLE_MISSING",
      });
    }
    return res.status(500).json({ error: upErr.message });
  }

  return res.json({ ok: true, profile: data });
}
