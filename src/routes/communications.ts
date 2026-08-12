import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { requireAuth, requirePermission } from "../middleware/auth";
import { CommunicationsLiveService } from "../services/communications/communicationsLiveService";
import { getCommunicationRtcConfig } from "../services/communications/communicationsRtcConfig";
import { communicationSurfacePolicySummary } from "../services/communications/communicationsPolicy";
import type { CommunicationMediaMode, CommunicationScopeType, CommunicationSurface } from "../services/communications/communicationContracts";
import { emitAuditEvent } from "../core/foundation";

const router = Router();

const MEDIA_MODES = new Set<CommunicationMediaMode>(["voice", "video", "audio_video"]);
const SCOPE_TYPES = new Set<CommunicationScopeType>(["office_public_session", "office_internal_session", "support_thread"]);

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function extractBearer(req: Request) {
  const auth = req.headers.authorization || "";
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function requireOfficeCommunicationKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.OFFICE_SYNC_API_KEY || process.env.OFFICE_EXPORT_API_KEY || "";
  if (!expected) return res.status(503).json({ error: "OFFICE_SYNC_API_KEY is not configured" });
  const provided = String(req.headers["x-api-key"] || extractBearer(req) || "").trim();
  if (!provided || !timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: "Invalid office communications key" });
  }
  return next();
}

function safeText(value: any, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function mediaMode(value: any): CommunicationMediaMode {
  const raw = safeText(value, "audio_video").toLowerCase() as CommunicationMediaMode;
  return MEDIA_MODES.has(raw) ? raw : "audio_video";
}

function scopeType(value: any, fallback: CommunicationScopeType): CommunicationScopeType {
  const raw = safeText(value, fallback).toLowerCase() as CommunicationScopeType;
  return SCOPE_TYPES.has(raw) ? raw : fallback;
}

function responseFor(session: any, surface: CommunicationSurface) {
  return {
    ok: true,
    contract: "oyi_communications.session.v1",
    surface,
    provider: "browser_webrtc_socketio_signaling",
    twilio_usage: "network_traversal_only",
    session,
    signaling_token: signCommunicationToken(session),
    rtc_config: null as any,
    policy: communicationSurfacePolicySummary(surface),
  };
}

function signingSecret() {
  return process.env.APP_JWT_SECRET || process.env.OFFICE_SYNC_API_KEY || process.env.OFFICE_EXPORT_API_KEY || "";
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function signCommunicationToken(session: any) {
  const secret = signingSecret();
  if (!secret || !session?.session_id || !session?.surface) return null;
  const payload = {
    session_id: String(session.session_id),
    surface: String(session.surface),
    scope_type: String(session.scope_type || ""),
    scope_id: String(session.scope_id || ""),
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

async function createSession(req: Request, res: Response, surface: CommunicationSurface, defaultScope: CommunicationScopeType, ownerId: string) {
  const requestId = crypto.randomUUID();
  const body = req.body || {};
  const nextScopeType = scopeType(body.scope_type || body.scopeType, defaultScope);
  const scopeId = safeText(
    body.scope_id || body.scopeId || body.public_session_id || body.office_session_id || body.support_thread_id,
    `${nextScopeType}_${requestId}`
  );
  const sessionId = safeText(body.session_id || body.sessionId, `${surface}_${scopeId}`);
  const session = await CommunicationsLiveService.start({
    sessionId,
    surface,
    purpose: safeText(body.purpose, `${surface}_communication`),
    scopeType: nextScopeType,
    scopeId,
    estateId: safeText(body.estate_id || body.estateId) || null,
    homeId: safeText(body.home_id || body.homeId) || null,
    ownerId,
    mediaMode: mediaMode(body.media_mode || body.mediaMode),
  });
  const payload = responseFor(session, surface);
  payload.rtc_config = await getCommunicationRtcConfig();
  void emitAuditEvent({
    actorId: ownerId,
    actorRole: (req as any).user?.role || (surface === "office_public" ? "office_public_gateway" : "system"),
    action: "communication.session.created",
    resourceType: "communication_session",
    resourceId: sessionId,
    status: "success",
    metadata: { surface, scope_type: nextScopeType, media_mode: body.media_mode || body.mediaMode || "audio_video" },
    req,
  } as any);
  return res.json(payload);
}

async function readSession(req: Request, res: Response, surface: CommunicationSurface) {
  const session = CommunicationsLiveService.get(String(req.params.sessionId || ""));
  if (!session || session.surface !== surface) return res.status(404).json({ error: "Communication session not found" });
  return res.json({
    ...responseFor(session, surface),
    rtc_config: await getCommunicationRtcConfig(),
    events: CommunicationsLiveService.listEvents(session.session_id),
  });
}

async function stopSession(req: Request, res: Response, surface: CommunicationSurface, actorId: string) {
  const existing = CommunicationsLiveService.get(String(req.params.sessionId || ""));
  if (!existing || existing.surface !== surface) return res.status(404).json({ error: "Communication session not found" });
  const session = await CommunicationsLiveService.stop(existing.session_id, actorId);
  return res.json({
    ...responseFor(session, surface),
    rtc_config: await getCommunicationRtcConfig(),
  });
}

router.post("/office-public/session", requireOfficeCommunicationKey, async (req, res) => {
  const ownerId = safeText(req.body?.public_session_id || req.body?.session_id, `office-public-${crypto.randomUUID()}`);
  return createSession(req, res, "office_public", "office_public_session", ownerId);
});

router.get("/office-public/session/:sessionId", requireOfficeCommunicationKey, async (req, res) => {
  return readSession(req, res, "office_public");
});

router.post("/office-public/session/:sessionId/end", requireOfficeCommunicationKey, async (req, res) => {
  return stopSession(req, res, "office_public", safeText(req.body?.public_session_id, "office-public"));
});

router.get("/office-public/rtc-config", requireOfficeCommunicationKey, async (_req, res) => {
  return res.json({
    ok: true,
    contract: "oyi_communications.rtc_config.v1",
    surface: "office_public",
    provider: "browser_webrtc_socketio_signaling",
    twilio_usage: "network_traversal_only",
    rtc_config: await getCommunicationRtcConfig(),
    policy: communicationSurfacePolicySummary("office_public"),
  });
});

router.post("/office-internal/session", requireAuth, requirePermission("office.manage"), async (req, res) => {
  return createSession(req, res, "office_internal", "office_internal_session", String(req.user?.id || "office-internal"));
});

router.get("/office-internal/session/:sessionId", requireAuth, requirePermission("office.read"), async (req, res) => {
  return readSession(req, res, "office_internal");
});

router.post("/office-internal/session/:sessionId/end", requireAuth, requirePermission("office.manage"), async (req, res) => {
  return stopSession(req, res, "office_internal", String(req.user?.id || "office-internal"));
});

router.get("/office-internal/rtc-config", requireAuth, requirePermission("office.read"), async (_req, res) => {
  return res.json({
    ok: true,
    contract: "oyi_communications.rtc_config.v1",
    surface: "office_internal",
    provider: "browser_webrtc_socketio_signaling",
    twilio_usage: "network_traversal_only",
    rtc_config: await getCommunicationRtcConfig(),
    policy: communicationSurfacePolicySummary("office_internal"),
  });
});

router.post("/support/session", requireAuth, requirePermission("support.assign"), async (req, res) => {
  return createSession(req, res, "support", "support_thread", String(req.user?.id || "support"));
});

router.get("/support/session/:sessionId", requireAuth, requirePermission("support.read"), async (req, res) => {
  return readSession(req, res, "support");
});

router.post("/support/session/:sessionId/end", requireAuth, requirePermission("support.assign"), async (req, res) => {
  return stopSession(req, res, "support", String(req.user?.id || "support"));
});

router.get("/support/rtc-config", requireAuth, requirePermission("support.read"), async (_req, res) => {
  return res.json({
    ok: true,
    contract: "oyi_communications.rtc_config.v1",
    surface: "support",
    provider: "browser_webrtc_socketio_signaling",
    twilio_usage: "network_traversal_only",
    rtc_config: await getCommunicationRtcConfig(),
    policy: communicationSurfacePolicySummary("support"),
  });
});

export default router;
