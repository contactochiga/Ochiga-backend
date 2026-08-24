import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { NotificationService } from "../services/NotificationService";
import { buildCameraPlaybackContract } from "../modules/cameras/cameraPlayback.service";
import { canAccessCamera, requireCameraAccess } from "../modules/cameras/cameraAccess.policy";
import { normalizeIntelligenceEvent, publishIntelligenceEvent } from "../intelligence-core";
import { mediaReference } from "../modules/cameras/cameraMedia.service";

const DEFAULT_REPORT_LIMIT = 2000;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseIntSafe(v: any, fallback: number) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
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

type CameraAiProfileRow = {
  armed?: boolean | null;
  mode?: string | null;
  min_confidence?: number | null;
  notify_in_app?: boolean | null;
  notify_push?: boolean | null;
  notify_sms?: boolean | null;
  auto_record_on_detect?: boolean | null;
};

function inferSeverity(eventType: string, confidence: number | null) {
  const e = String(eventType || "").toLowerCase();
  if (e.includes("intrusion") || e.includes("forced") || e.includes("fire") || e.includes("smoke")) return "critical";
  if (e.includes("face") || e.includes("loiter") || e.includes("human") || e.includes("person")) return "high";
  if (e.includes("vehicle") || e.includes("animal")) return "medium";
  if ((confidence || 0) >= 0.85) return "high";
  if ((confidence || 0) >= 0.6) return "medium";
  return "low";
}

function shouldRouteToMaintenance(eventType: string) {
  const e = String(eventType || "").toLowerCase();
  return (
    e.includes("camera_offline") ||
    e.includes("camera_tamper") ||
    e.includes("lens_obstructed") ||
    e.includes("signal_loss")
  );
}

function shouldEscalateSecurity(eventType: string) {
  const e = String(eventType || "").toLowerCase();
  return (
    e.includes("intrusion") ||
    e.includes("person") ||
    e.includes("human") ||
    e.includes("vehicle") ||
    e.includes("face") ||
    e.includes("loiter") ||
    e.includes("smoke") ||
    e.includes("fire")
  );
}

function reportWindow(periodRaw: string | undefined) {
  const period = String(periodRaw || "daily").toLowerCase();
  const now = new Date();
  if (period === "monthly") return { period, from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now };
  if (period === "weekly") return { period, from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now };
  return { period: "daily", from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now };
}

async function resolveCamera(cameraId: string) {
  return supabaseAdmin
    .from("facility_cameras")
    .select("id, estate_id, name, edge_hls_url, hls_url, stream_status, health_status, status, edge_node_id, metadata")
    .eq("id", cameraId)
    .maybeSingle();
}

/**
 * GET /cameras/:cameraId/playback
 * Returns an authorized live HLS session. Historical playback uses Camera Media.
 */
export async function getPlaybackUrl(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  const { cameraId } = req.params;
  if (!cameraId) return res.status(400).json({ error: "cameraId is required" });

  const { data: cam, error } = await resolveCamera(cameraId);
  if (error) return res.status(500).json({ error: error.message });
  if (!cam) return res.status(404).json({ error: "Camera not found" });
  const access = canAccessCamera(cam, user);
  if (!access.ok) return res.status(403).json({ error: "Permission denied", code: access.reason });

  const playback = buildCameraPlaybackContract(req, cam, user);
  if (!playback.hls_url) return res.status(409).json(playback);
  return res.json(playback);
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
  try {
    requireCameraAccess(cam, user);
  } catch (accessErr: any) {
    return res.status(accessErr?.statusCode || 403).json({ error: "Permission denied", code: accessErr?.reason || "camera_permission_denied" });
  }

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

  const eventIds=(data||[]).map((event:any)=>event.id);const [{data:links},{data:detections}]=eventIds.length?await Promise.all([supabaseAdmin.from("camera_event_media").select("event_id,relationship,camera_media(*)").in("event_id",eventIds),supabaseAdmin.from("camera_detections").select("id,camera_id,event_id,media_id,detection_type,observed_at,confidence,bounding_box,visual_zone_id,tracking_id,attributes,provider,model,model_version,created_at").in("event_id",eventIds).order("observed_at",{ascending:true})]):[{data:[] as any[]},{data:[] as any[]}];const byEvent=new Map<string,any[]>();for(const link of links||[]){const list=byEvent.get((link as any).event_id)||[];list.push({...mediaReference((link as any).camera_media),relationship:(link as any).relationship});byEvent.set((link as any).event_id,list);}const detectionByEvent=new Map<string,any[]>();for(const detection of detections||[]){const list=detectionByEvent.get((detection as any).event_id)||[];list.push(detection);detectionByEvent.set((detection as any).event_id,list)}const events=(data||[]).map((event:any)=>({...event,media:byEvent.get(event.id)||[],detections:detectionByEvent.get(event.id)||[]}));
  return res.json({ ok: true, events });
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
  try {
    requireCameraAccess(cam, user);
  } catch (accessErr: any) {
    return res.status(accessErr?.statusCode || 403).json({ error: "Permission denied", code: accessErr?.reason || "camera_permission_denied" });
  }

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
    source_timestamp: req.body?.source_timestamp || req.body?.occurred_at || null,
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

  // Route camera detections into operations alerts + notifications
  try {
    const { data: profileRow } = await supabaseAdmin
      .from("camera_ai_profiles")
      .select("armed,mode,min_confidence,notify_in_app,notify_push,notify_sms,auto_record_on_detect")
      .eq("camera_id", cameraId)
      .maybeSingle();

    const profile = (profileRow || {}) as CameraAiProfileRow;
    const source = String(req.body?.metadata?.source || "").toLowerCase();
    const isManual = source.includes("manual");
    const minConf = clamp(Number(profile.min_confidence ?? 70), 0, 100) / 100;
    const armed = profile.armed !== false;
    const canNotify = profile.notify_in_app !== false;
    const confidenceScore = Number.isFinite(Number(confidence)) ? Number(confidence) : 0;
    const severity = inferSeverity(eventType, confidenceScore);
    const securityEvent = shouldEscalateSecurity(eventType);
    const maintenanceEvent = shouldRouteToMaintenance(eventType);

    const shouldEscalate =
      canNotify &&
      (isManual || (armed && confidenceScore >= minConf)) &&
      (securityEvent || maintenanceEvent);

    if (shouldEscalate) {
      const commonPayload = {
        estate_id: cam.estate_id,
        kind: maintenanceEvent ? "camera.maintenance.signal" : "camera.security.alert",
        cameraId: cameraId,
        eventId: String(data?.id || ""),
        eventType: eventType,
        confidence: confidenceScore,
        severity,
        mode: String(profile.mode || "home"),
        autoRecord: profile.auto_record_on_detect !== false,
        source: source || "camera_intel",
      };

      if (securityEvent) {
        for (const role of ["security", "manager", "estate_admin", "owner"]) {
          await NotificationService.sendToRole(String(cam.estate_id), role, {
            title: `Camera security alert (${severity.toUpperCase()})`,
            message:
              payload.message ||
              `${eventType.replace(/_/g, " ")} detected on ${cam.name || "camera"} at confidence ${Math.round(
                confidenceScore * 100
              )}%`,
            type: "system",
            payload: commonPayload,
            entityId: String(data?.id || ""),
          });
        }
      } else if (maintenanceEvent) {
        for (const role of ["manager", "estate_admin", "owner"]) {
          await NotificationService.sendToRole(String(cam.estate_id), role, {
            title: "Camera maintenance signal",
            message:
              payload.message ||
              `${eventType.replace(/_/g, " ")} detected on ${cam.name || "camera"}. Maintenance follow-up required.`,
            type: "maintenance",
            payload: commonPayload,
            entityId: String(data?.id || ""),
          });
        }
      }
    }
  } catch {
    // fail-soft: event ingestion remains successful even if alert fanout fails
  }

  const confidenceScore = Number.isFinite(Number(confidence)) ? Number(confidence) : 0;
  const coreEvent = normalizeIntelligenceEvent({
    agent_id: "camera",
    surface: "camera",
    actor_id: user.id,
    estate_id: String(cam.estate_id || ""),
    camera_id: cameraId,
    event_type: eventType,
    category: "camera",
    title: `${eventType.replace(/_/g, " ")} detected`,
    summary: payload.message || `${eventType.replace(/_/g, " ")} detected on ${cam.name || "camera"}.`,
    confidence: confidenceScore >= 0.8 ? "confirmed" : confidenceScore >= 0.5 ? "probable" : "possible",
    source: "camera_events",
    metadata: {
      source_table: "camera_events",
      source_event_id: String(data?.id || ""),
      snapshot_url: payload.snapshot_url,
      camera_name: cam.name || null,
      ...(payload.metadata || {}),
    },
    occurred_at: String(data?.source_timestamp || data?.created_at || new Date().toISOString()),
  });
  const intelligenceBus = await publishIntelligenceEvent(coreEvent, {
    source_table: "camera_events",
    source_event_id: String(data?.id || ""),
  });

  return res.json({ ok: true, event: data, intelligence_event: coreEvent, intelligence_bus: intelligenceBus });
}

export async function getAnalyticsCapabilities(_req: Request, res: Response) {
  return res.json({
    ok: true,
    capabilities: ["motion_detection", "person_detection", "vehicle_detection"],
    availability: {
      motion_detection: "unknown",
      person_detection: "unknown",
      vehicle_detection: "unknown",
      animal_detection: "unknown",
      line_crossing: "unknown",
      zone_intrusion: "unknown",
      occupancy: "unknown",
      tamper_detection: "unknown",
      smoke_detection: "unknown",
      fire_detection: "unknown",
      face_detection: "unavailable",
      face_recognition: "unavailable",
      plate_recognition: "unavailable",
    },
    note: "Availability is camera/provider-specific. Detection ingestion is performed by authenticated Oyi Edge providers.",
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
  try {
    requireCameraAccess(cam, user);
  } catch (accessErr: any) {
    return res.status(accessErr?.statusCode || 403).json({ error: "Permission denied", code: accessErr?.reason || "camera_permission_denied" });
  }

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
  try {
    requireCameraAccess(cam, user);
  } catch (accessErr: any) {
    return res.status(accessErr?.statusCode || 403).json({ error: "Permission denied", code: accessErr?.reason || "camera_permission_denied" });
  }

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

/**
 * GET /cameras/reports/security?period=daily|weekly|monthly&cameraId=<uuid>
 * Returns operational summary for security workflow.
 */
export async function getSecurityReport(req: Request, res: Response) {
  const user = req.user as any;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { period, from, to } = reportWindow(String(req.query.period || "daily"));
  const cameraId = String(req.query.cameraId || "").trim();

  let q = supabaseAdmin
    .from("camera_events")
    .select("id,camera_id,event_type,confidence,created_at,estate_id,message")
    .eq("estate_id", user.estate_id)
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .order("created_at", { ascending: false })
    .limit(DEFAULT_REPORT_LIMIT);

  if (cameraId) q = q.eq("camera_id", cameraId);

  const { data: rows, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const events = rows || [];
  const byType = new Map<string, number>();
  const byCamera = new Map<string, number>();
  const bySeverity = new Map<string, number>();
  const timelineBuckets = new Map<string, number>();
  let escalated = 0;
  let maintenanceSignals = 0;

  for (const e of events as any[]) {
    const type = String(e?.event_type || "unknown").toLowerCase();
    const cameraKey = String(e?.camera_id || "unknown");
    const severity = inferSeverity(type, Number(e?.confidence || 0));
    const stamp = new Date(e?.created_at || Date.now());
    const bucket =
      period === "daily"
        ? stamp.toISOString().slice(11, 13) + ":00"
        : stamp.toISOString().slice(0, 10);

    byType.set(type, (byType.get(type) || 0) + 1);
    byCamera.set(cameraKey, (byCamera.get(cameraKey) || 0) + 1);
    bySeverity.set(severity, (bySeverity.get(severity) || 0) + 1);
    timelineBuckets.set(bucket, (timelineBuckets.get(bucket) || 0) + 1);

    if (shouldEscalateSecurity(type)) escalated += 1;
    if (shouldRouteToMaintenance(type)) maintenanceSignals += 1;
  }

  const topEventTypes = Array.from(byType.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([eventType, count]) => ({ eventType, count }));

  const topCameras = Array.from(byCamera.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([cameraId, count]) => ({ cameraId, count }));

  const timeline = Array.from(timelineBuckets.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([bucket, count]) => ({ bucket, count }));

  return res.json({
    ok: true,
    report: {
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      totalEvents: events.length,
      escalatedSecurityEvents: escalated,
      maintenanceSignals,
      bySeverity: {
        critical: bySeverity.get("critical") || 0,
        high: bySeverity.get("high") || 0,
        medium: bySeverity.get("medium") || 0,
        low: bySeverity.get("low") || 0,
      },
      topEventTypes,
      topCameras,
      timeline,
    },
  });
}
