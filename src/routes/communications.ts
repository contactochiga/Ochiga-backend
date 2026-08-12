import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { requireAuth, requirePermission } from "../middleware/auth";
import {
  officeCredentialTimingSafeEqual,
  resolveOfficeCredential,
  resolveOfficeSyncKey,
} from "../middleware/officeCredential";
import { CommunicationsLiveService } from "../services/communications/communicationsLiveService";
import { getCommunicationRtcConfig } from "../services/communications/communicationsRtcConfig";
import { communicationSurfacePolicySummary } from "../services/communications/communicationsPolicy";
import type { CommunicationMediaMode, CommunicationScopeType, CommunicationSurface } from "../services/communications/communicationContracts";
import type { CommunicationConsent } from "../services/communications/communicationContracts";
import {
  analyzeCommunicationFrame,
  assertMicrophoneConsent,
  assertVisualConsent,
  synthesizeOyiSpeech,
  transcribeCommunicationAudio,
} from "../services/communications/communicationsMediaAdapters";
import { CommunicationOyiTurnError, runOyiCommunicationTurn } from "../services/communications/communicationsOyiTurnService";
import { emitAuditEvent } from "../core/foundation";

const router = Router();

const MEDIA_MODES = new Set<CommunicationMediaMode>(["chat", "voice", "video", "audio_video"]);
const SCOPE_TYPES = new Set<CommunicationScopeType>(["office_public_session", "office_internal_session", "support_thread"]);

export function requireOfficeCommunicationKey(req: Request, res: Response, next: NextFunction) {
  const expected = resolveOfficeSyncKey();
  if (!expected) return res.status(503).json({ error: "OFFICE_SYNC_API_KEY is not configured" });
  const provided = resolveOfficeCredential(req);
  if (!provided || !officeCredentialTimingSafeEqual(provided, expected)) {
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

function responseFor(session: any, surface: CommunicationSurface, role = "participant", participantId?: string | null) {
  return {
    ok: true,
    contract: "oyi_communications.session.v1",
    surface,
    provider: "browser_webrtc_socketio_signaling",
    twilio_usage: "network_traversal_only",
    session,
    signaling_token: signCommunicationToken(session, role, participantId),
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

function signCommunicationToken(session: any, role = "participant", participantId?: string | null) {
  const secret = signingSecret();
  if (!secret || !session?.session_id || !session?.surface) return null;
  const payload = {
    session_id: String(session.session_id),
    surface: String(session.surface),
    scope_type: String(session.scope_type || ""),
    scope_id: String(session.scope_id || ""),
    participant_id: String(participantId || session.public_session_id || session.owner_id || "participant"),
    role,
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
    ownerType: surface === "office_public" ? "public_session" : "user",
    ownerId,
    publicSessionId: safeText(body.public_session_id || body.publicSessionId) || (surface === "office_public" ? scopeId : null),
    oyiThreadId: safeText(body.oyi_thread_id || body.oyiThreadId || body.conversation_thread_id || body.thread_id) || null,
    officeContextRef: safeText(body.office_context_ref || body.officeContextRef) || null,
    mediaMode: mediaMode(body.media_mode || body.mediaMode),
    consent: {
      microphone: Boolean(body.consent?.microphone || body.microphone_consent),
      camera: Boolean(body.consent?.camera || body.camera_consent),
      visual_analysis: Boolean(body.consent?.visual_analysis || body.visual_analysis_consent),
    },
    metadata: {
      customer_journey: {
        public_session_id: safeText(body.public_session_id || body.publicSessionId) || null,
        oyi_thread_id: safeText(body.oyi_thread_id || body.oyiThreadId || body.conversation_thread_id || body.thread_id) || null,
        office_context_ref: safeText(body.office_context_ref || body.officeContextRef) || null,
      },
    },
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
    participants: CommunicationsLiveService.listParticipants(session.session_id),
    handoffs: CommunicationsLiveService.listHandoffs(session.session_id),
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

async function requestHandoff(req: Request, res: Response, surface: CommunicationSurface) {
  const session = CommunicationsLiveService.get(String(req.params.sessionId || ""));
  if (!session || session.surface !== surface) return res.status(404).json({ error: "Communication session not found" });
  const body = req.body || {};
  const handoff = await CommunicationsLiveService.requestHandoff({
    sessionId: session.session_id,
    publicSessionId: safeText(body.public_session_id || body.publicSessionId) || session.public_session_id || null,
    oyiThreadId: safeText(body.oyi_thread_id || body.oyiThreadId || body.conversation_thread_id || body.thread_id) || session.oyi_thread_id || null,
    officeContextRef: safeText(body.office_context_ref || body.officeContextRef) || session.office_context_ref || null,
    businessUnit: safeText(body.business_unit || body.businessUnit, "corporate"),
    requestedCapability: safeText(body.requested_capability || body.requestedCapability, "corporate.office_desk"),
    reason: safeText(body.reason, "Visitor requested human assistance."),
    priority: safeText(body.priority, "normal") as any,
    fallbackAction: safeText(body.fallback_action || body.fallbackAction, "continue_with_oyi") as any,
    metadata: {
      source: safeText(body.source, "visitor_or_oyi"),
      media_mode: session.media_mode,
      safe_context_summary: safeText(body.safe_context_summary || body.context_summary).slice(0, 1000),
    },
  });
  return res.json({
    ok: true,
    contract: "oyi_communications.handoff.v1",
    surface,
    handoff,
    session,
  });
}

async function acceptHandoff(req: Request, res: Response, surface: CommunicationSurface) {
  const body = req.body || {};
  const staffId = safeText(body.staff_id || body.staffId || req.user?.id);
  const handoff = await CommunicationsLiveService.acceptHandoff(String(req.params.handoffId || ""), staffId);
  if (!handoff) return res.status(404).json({ error: "Handoff not found or not assigned to staff member" });
  const session = CommunicationsLiveService.get(handoff.communications_session_id);
  if (!session || session.surface !== surface) return res.status(404).json({ error: "Communication session not found" });
  return res.json({
    ok: true,
    contract: "oyi_communications.handoff.v1",
    surface,
    handoff,
    session,
    participants: CommunicationsLiveService.listParticipants(session.session_id),
    signaling_token: signCommunicationToken(session, "staff", staffId),
  });
}

async function declineHandoff(req: Request, res: Response, surface: CommunicationSurface) {
  const staffId = safeText(req.body?.staff_id || req.body?.staffId || req.user?.id);
  const handoff = await CommunicationsLiveService.declineHandoff(String(req.params.handoffId || ""), staffId);
  if (!handoff) return res.status(404).json({ error: "Handoff not found or not assigned to staff member" });
  const session = CommunicationsLiveService.get(handoff.communications_session_id);
  if (!session || session.surface !== surface) return res.status(404).json({ error: "Communication session not found" });
  return res.json({
    ok: true,
    contract: "oyi_communications.handoff.v1",
    surface,
    handoff,
    session,
  });
}

async function assignHandoff(req: Request, res: Response, surface: CommunicationSurface) {
  const staffId = safeText(req.body?.staff_id || req.body?.staffId) || null;
  const handoff = await CommunicationsLiveService.assignHandoff(String(req.params.handoffId || ""), staffId);
  if (!handoff) return res.status(404).json({ error: "Handoff not found" });
  const session = CommunicationsLiveService.get(handoff.communications_session_id);
  if (!session || session.surface !== surface) return res.status(404).json({ error: "Communication session not found" });
  return res.json({
    ok: true,
    contract: "oyi_communications.handoff.v1",
    surface,
    handoff,
    session,
  });
}

function handoffQueue(surface: CommunicationSurface) {
  return {
    ok: true,
    contract: "oyi_communications.handoff_queue.v1",
    surface,
    handoffs: CommunicationsLiveService.listHandoffs().filter((handoff) => {
      const session = CommunicationsLiveService.get(handoff.communications_session_id);
      return session?.surface === surface && ["requested", "routing", "offered"].includes(handoff.status);
    }),
  };
}

function sessionConsent(session: any): CommunicationConsent {
  const consent = session?.metadata?.consent && typeof session.metadata.consent === "object" ? session.metadata.consent : {};
  return {
    microphone: Boolean(consent.microphone),
    camera: Boolean(consent.camera),
    visual_analysis: Boolean(consent.visual_analysis),
  };
}

function safeCrmContext(body: any) {
  const crm = body && typeof body.crm_context === "object" && !Array.isArray(body.crm_context) ? body.crm_context : {};
  return {
    contact_ref: safeText(crm.contact_ref) || null,
    organization_ref: safeText(crm.organization_ref) || null,
    lead_ref: safeText(crm.lead_ref) || null,
    opportunity_ref: safeText(crm.opportunity_ref) || null,
    safe_summary: safeText(crm.safe_summary).slice(0, 800) || null,
  };
}

async function voiceTurn(req: Request, res: Response, surface: CommunicationSurface) {
  const session = CommunicationsLiveService.get(String(req.params.sessionId || ""));
  if (!session || session.surface !== surface) return res.status(404).json({ error: "Communication session not found" });
  const body = req.body || {};
  const requestId = safeText(req.headers["x-request-id"], crypto.randomUUID());
  try {
    assertMicrophoneConsent(sessionConsent(session), Boolean(body.consent?.microphone || body.microphone_consent));
  } catch (error: any) {
    return res.status(403).json({ ok: false, error: error.message, request_id: requestId });
  }

  let transcript;
  try {
    transcript = await transcribeCommunicationAudio({
      audio_data_url: safeText(body.audio_data_url || body.audioDataUrl),
      filename: safeText(body.filename) || null,
    });
  } catch (error: any) {
    return res.status(422).json({
      ok: false,
      contract: "oyi_communications.voice_turn.v1",
      error: "speech_transcription_failed",
      detail: safeText(error?.message, "speech_transcription_failed"),
      request_id: requestId,
      canonical_turn_created: false,
    });
  }

  await CommunicationsLiveService.recordOyiMediaTurn({
    sessionId: session.session_id,
    eventType: "voice.transcribed",
    actorId: safeText(body.participant_id || body.participantId || req.user?.id) || session.public_session_id || session.owner_id || null,
    actorRole: surface === "office_public" ? "visitor" : safeText(req.user?.role, "staff"),
    oyiThreadId: safeText(body.oyi_thread_id || body.oyiThreadId || body.conversation_thread_id || body.thread_id) || session.oyi_thread_id || null,
    metadata: {
      request_id: requestId,
      transcript_length: transcript.transcript.length,
      language: transcript.language,
      provider: transcript.provider,
      temporary_audio_deleted: true,
    },
  });

  let turn;
  try {
    turn = await runOyiCommunicationTurn({
      surface,
      message: transcript.transcript,
      communications_session_id: session.session_id,
      public_session_id: safeText(body.public_session_id || body.publicSessionId) || session.public_session_id || null,
      office_session_id: safeText(body.office_session_id || body.officeSessionId) || session.scope_id || null,
      oyi_thread_id: safeText(body.oyi_thread_id || body.oyiThreadId || body.conversation_thread_id || body.thread_id) || session.oyi_thread_id || null,
      business_unit: safeText(body.business_unit || body.businessUnit, "corporate"),
      inquiry_type: safeText(body.inquiry_type || body.inquiryType, "general_enquiry"),
      agent_role: safeText(body.agent_role || body.agentRole, "oma"),
      engagement_mode: safeText(body.engagement_mode || body.engagementMode, "voice_conversation"),
      source: body.source,
      crm_context: safeCrmContext(body),
      actor: req.user || null,
      staff: body.staff,
      request_id: requestId,
    });
  } catch (error: any) {
    const status = error instanceof CommunicationOyiTurnError ? error.status : 500;
    return res.status(status).json({
      ok: false,
      contract: "oyi_communications.voice_turn.v1",
      error: error instanceof CommunicationOyiTurnError ? error.code : "oyi_core_turn_failed",
      message: safeText(error?.message, "Oyi could not safely answer that voice turn."),
      request_id: requestId,
      canonical_turn_created: false,
    });
  }

  let audio: Awaited<ReturnType<typeof synthesizeOyiSpeech>> | null = null;
  let audioError: string | null = null;
  try {
    audio = await synthesizeOyiSpeech({ text: turn.response_text });
  } catch (error: any) {
    audioError = safeText(error?.message, "speech_synthesis_failed");
  }

  await CommunicationsLiveService.recordOyiMediaTurn({
    sessionId: session.session_id,
    eventType: "oyi.responded",
    actorId: "oyi",
    actorRole: "oyi",
    oyiThreadId: turn.oyi_thread_id,
    metadata: {
      request_id: requestId,
      oyi_thread_id: turn.oyi_thread_id,
      audio_available: Boolean(audio),
      tts_error: audioError,
    },
  });

  return res.json({
    ok: true,
    contract: "oyi_communications.voice_turn.v1",
    surface,
    communications_session_id: session.session_id,
    public_session_id: session.public_session_id,
    oyi_thread_id: turn.oyi_thread_id,
    transcript,
    response_text: turn.response_text,
    canonical_response: {
      id: turn.canonical.id,
      intent: turn.canonical.intent,
      thread_id: turn.canonical.thread_id,
      safe_mode: turn.canonical.safe_mode,
      approval_required: turn.canonical.approvalRequired,
      requires_confirmation: turn.canonical.requiresConfirmation,
    },
    audio,
    audio_unavailable: !audio,
    audio_error: audioError,
    turn_state: audio ? "oyi_speaking" : "text_fallback",
  });
}

async function visualObservationTurn(req: Request, res: Response, surface: CommunicationSurface) {
  const session = CommunicationsLiveService.get(String(req.params.sessionId || ""));
  if (!session || session.surface !== surface) return res.status(404).json({ error: "Communication session not found" });
  const body = req.body || {};
  const requestId = safeText(req.headers["x-request-id"], crypto.randomUUID());
  try {
    assertVisualConsent(
      sessionConsent(session),
      Boolean(body.consent?.camera || body.camera_consent),
      Boolean(body.consent?.visual_analysis || body.visual_analysis_consent)
    );
  } catch (error: any) {
    return res.status(403).json({ ok: false, error: error.message, request_id: requestId });
  }

  let observation;
  try {
    observation = await analyzeCommunicationFrame({
      image_data_url: safeText(body.image_data_url || body.frame_data_url || body.imageDataUrl || body.frameDataUrl),
      prompt: safeText(body.prompt || body.message) || null,
      surface,
      communications_session_id: session.session_id,
      source_participant_id: safeText(body.participant_id || body.participantId, session.public_session_id || session.owner_id || "participant"),
    });
  } catch (error: any) {
    return res.status(422).json({
      ok: false,
      contract: "oyi_communications.visual_observation.v1",
      error: "visual_analysis_failed",
      detail: safeText(error?.message, "visual_analysis_failed"),
      request_id: requestId,
      canonical_turn_created: false,
      frame_retention: "ephemeral",
    });
  }

  await CommunicationsLiveService.recordOyiMediaTurn({
    sessionId: session.session_id,
    eventType: "visual.observed",
    actorId: safeText(body.participant_id || body.participantId || req.user?.id) || session.public_session_id || session.owner_id || null,
    actorRole: surface === "office_public" ? "visitor" : safeText(req.user?.role, "staff"),
    oyiThreadId: safeText(body.oyi_thread_id || body.oyiThreadId || body.conversation_thread_id || body.thread_id) || session.oyi_thread_id || null,
    metadata: {
      request_id: requestId,
      observation_id: observation.observation_id,
      frame_retention: observation.frame_retention,
      provider: observation.provider,
    },
  });

  const prompt = safeText(body.prompt || body.message, "Please help me understand what I am showing you.");
  const visualMessage = [
    prompt,
    "",
    "Authorized visual observation from this communications session:",
    `Summary: ${observation.summary}`,
    observation.visible_objects.length ? `Visible objects: ${observation.visible_objects.join(", ")}` : "",
    observation.visible_text.length ? `Visible text: ${observation.visible_text.join("; ")}` : "",
    observation.uncertainty ? `Uncertainty: ${observation.uncertainty}` : "",
  ].filter(Boolean).join("\n");

  let turn;
  try {
    turn = await runOyiCommunicationTurn({
      surface,
      message: visualMessage,
      communications_session_id: session.session_id,
      public_session_id: safeText(body.public_session_id || body.publicSessionId) || session.public_session_id || null,
      office_session_id: safeText(body.office_session_id || body.officeSessionId) || session.scope_id || null,
      oyi_thread_id: safeText(body.oyi_thread_id || body.oyiThreadId || body.conversation_thread_id || body.thread_id) || session.oyi_thread_id || null,
      business_unit: safeText(body.business_unit || body.businessUnit, "corporate"),
      inquiry_type: safeText(body.inquiry_type || body.inquiryType, "general_enquiry"),
      agent_role: safeText(body.agent_role || body.agentRole, "oma"),
      engagement_mode: safeText(body.engagement_mode || body.engagementMode, "video_conversation"),
      source: body.source,
      crm_context: safeCrmContext(body),
      visual_observation: observation,
      actor: req.user || null,
      staff: body.staff,
      request_id: requestId,
    });
  } catch (error: any) {
    const status = error instanceof CommunicationOyiTurnError ? error.status : 500;
    return res.status(status).json({
      ok: false,
      contract: "oyi_communications.visual_observation.v1",
      error: error instanceof CommunicationOyiTurnError ? error.code : "oyi_core_turn_failed",
      message: safeText(error?.message, "Oyi could not safely answer that visual turn."),
      request_id: requestId,
      canonical_turn_created: false,
      frame_retention: "ephemeral",
    });
  }

  await CommunicationsLiveService.recordOyiMediaTurn({
    sessionId: session.session_id,
    eventType: "oyi.responded",
    actorId: "oyi",
    actorRole: "oyi",
    oyiThreadId: turn.oyi_thread_id,
    metadata: {
      request_id: requestId,
      oyi_thread_id: turn.oyi_thread_id,
      visual_observation_id: observation.observation_id,
    },
  });

  return res.json({
    ok: true,
    contract: "oyi_communications.visual_observation.v1",
    surface,
    communications_session_id: session.session_id,
    public_session_id: session.public_session_id,
    oyi_thread_id: turn.oyi_thread_id,
    observation,
    response_text: turn.response_text,
    canonical_response: {
      id: turn.canonical.id,
      intent: turn.canonical.intent,
      thread_id: turn.canonical.thread_id,
      safe_mode: turn.canonical.safe_mode,
      approval_required: turn.canonical.approvalRequired,
      requires_confirmation: turn.canonical.requiresConfirmation,
    },
    frame_retention: "ephemeral",
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

router.post("/office-public/session/:sessionId/handoff", requireOfficeCommunicationKey, async (req, res) => {
  return requestHandoff(req, res, "office_public");
});

router.get("/office-public/session/:sessionId/handoff", requireOfficeCommunicationKey, async (req, res) => {
  const session = CommunicationsLiveService.get(String(req.params.sessionId || ""));
  if (!session || session.surface !== "office_public") return res.status(404).json({ error: "Communication session not found" });
  return res.json({ ok: true, contract: "oyi_communications.handoff.v1", surface: "office_public", handoffs: CommunicationsLiveService.listHandoffs(session.session_id) });
});

router.post("/office-public/session/:sessionId/callback", requireOfficeCommunicationKey, async (req, res) => {
  req.body = { ...(req.body || {}), fallback_action: "request_callback", reason: safeText(req.body?.reason, "Visitor requested callback.") };
  return requestHandoff(req, res, "office_public");
});

router.post("/office-public/session/:sessionId/voice-turn", requireOfficeCommunicationKey, async (req, res) => {
  return voiceTurn(req, res, "office_public");
});

router.post("/office-public/session/:sessionId/visual-observation", requireOfficeCommunicationKey, async (req, res) => {
  return visualObservationTurn(req, res, "office_public");
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

router.post("/office-internal/session/:sessionId/handoff", requireAuth, requirePermission("office.manage"), async (req, res) => {
  return requestHandoff(req, res, "office_internal");
});

router.post("/office-internal/session/:sessionId/voice-turn", requireAuth, requirePermission("office.read"), async (req, res) => {
  return voiceTurn(req, res, "office_internal");
});

router.post("/office-internal/session/:sessionId/visual-observation", requireAuth, requirePermission("office.read"), async (req, res) => {
  return visualObservationTurn(req, res, "office_internal");
});

router.get("/office-internal/handoffs", requireAuth, requirePermission("office.read"), async (_req, res) => {
  return res.json(handoffQueue("office_internal"));
});

router.post("/office-internal/handoffs/:handoffId/assign", requireAuth, requirePermission("office.manage"), async (req, res) => {
  return assignHandoff(req, res, "office_internal");
});

router.post("/office-internal/handoffs/:handoffId/accept", requireAuth, requirePermission("office.manage"), async (req, res) => {
  return acceptHandoff(req, res, "office_internal");
});

router.post("/office-internal/handoffs/:handoffId/decline", requireAuth, requirePermission("office.manage"), async (req, res) => {
  return declineHandoff(req, res, "office_internal");
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

router.post("/support/session/:sessionId/handoff", requireAuth, requirePermission("support.assign"), async (req, res) => {
  return requestHandoff(req, res, "support");
});

router.post("/support/session/:sessionId/voice-turn", requireAuth, requirePermission("support.read"), async (req, res) => {
  return voiceTurn(req, res, "support");
});

router.post("/support/session/:sessionId/visual-observation", requireAuth, requirePermission("support.read"), async (req, res) => {
  return visualObservationTurn(req, res, "support");
});

router.get("/support/handoffs", requireAuth, requirePermission("support.read"), async (_req, res) => {
  return res.json(handoffQueue("support"));
});

router.post("/support/handoffs/:handoffId/assign", requireAuth, requirePermission("support.assign"), async (req, res) => {
  return assignHandoff(req, res, "support");
});

router.post("/support/handoffs/:handoffId/accept", requireAuth, requirePermission("support.assign"), async (req, res) => {
  return acceptHandoff(req, res, "support");
});

router.post("/support/handoffs/:handoffId/decline", requireAuth, requirePermission("support.assign"), async (req, res) => {
  return declineHandoff(req, res, "support");
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
