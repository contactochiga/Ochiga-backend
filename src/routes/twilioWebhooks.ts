// Twilio Programmable Voice webhooks (Live Reply Loop / Telephony
// programme). Public, provider-facing endpoints -- no session/API-key
// auth (Twilio itself calls these); authenticity is verified via
// X-Twilio-Signature instead, the exact same discipline as the WhatsApp
// webhook's X-Hub-Signature-256 check added in this same programme.
// BUILT-NOT-LIVE-PROVEN: no Twilio account is configured in production
// as of this build (see TwilioVoiceAdapter.ts's header note), so these
// routes have not been exercised against real Twilio traffic.
import { Router, Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { logger } from "../observability/logger";
import { verifyTwilioSignature } from "../services/communicationRuntime/adapters/TwilioVoiceAdapter";

const router = Router();

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fullRequestUrl(req: Request): string {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  return `${proto}://${host}${req.originalUrl}`;
}

// Twilio requests this the moment a call connects. Deliberately minimal
// and safe (Programme F's explicit instruction): a brief spoken
// identification message and hang up -- never claims or attempts a live
// conversation. This route itself carries no sensitive action, so it is
// intentionally NOT signature-gated (Twilio also allows an unauthenticated
// TwiML fetch by design); the status-callback route below, which DOES
// drive real state changes, IS signature-verified.
router.all("/voice-twiml", (req: Request, res: Response) => {
  const message = String(req.query.message || req.body?.message || "This is a verification call from the Ochiga Oyi system. Goodbye.");
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">${xmlEscape(message.slice(0, 500))}</Say><Hangup/></Response>`;
  res.set("content-type", "text/xml");
  res.status(200).send(twiml);
});

router.post("/status-callback", async (req: Request, res: Response) => {
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const signature = req.headers["x-twilio-signature"] as string | undefined;
  const url = fullRequestUrl(req);
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.body || {})) params[key] = String(value);

  if (!authToken || !verifyTwilioSignature(authToken, url, params, signature)) {
    logger.warn("twilio_status_callback_signature_rejected", { has_signature: Boolean(signature), has_auth_token: Boolean(authToken) });
    return res.status(401).json({ error: "invalid_signature" });
  }

  const communicationId = String(req.query.communication_id || "").trim();
  const callSid = String(req.body?.CallSid || "");
  const callStatus = String(req.body?.CallStatus || "").toLowerCase();
  const duration = req.body?.CallDuration ? Number(req.body.CallDuration) : null;
  const errorCode = req.body?.ErrorCode || null;

  logger.info("twilio_status_callback_received", { communication_id: communicationId, call_sid: callSid, call_status: callStatus, duration, error_code: errorCode });

  // Idempotency -- the SAME status-callback event delivered twice (Twilio
  // retries on a non-2xx or slow response) must not be logged/processed
  // twice. oyi_communication_events already has a unique
  // (provider, provider_event_id) index; keying on callSid+status makes
  // each distinct STATUS TRANSITION its own idempotent event.
  const providerEventId = `${callSid}:${callStatus}`;
  const { error: eventInsertError } = await supabaseAdmin.from("oyi_communication_events").insert({
    communication_id: communicationId || null,
    event_type: `call.${callStatus}`,
    channel: "voice_call",
    provider: "twilio",
    provider_event_id: providerEventId,
    from_address: req.body?.From || null,
    event_text: null,
    metadata: { call_sid: callSid, call_status: callStatus, duration_seconds: duration, twilio_error_code: errorCode },
  });
  if (eventInsertError) {
    if (String(eventInsertError.message || "").includes("duplicate key")) {
      logger.info("twilio_status_callback_duplicate", { call_sid: callSid, call_status: callStatus });
      return res.status(200).json({ ok: true, duplicate: true });
    }
    logger.error("twilio_status_callback_event_log_failed", { error: eventInsertError, call_sid: callSid });
  }

  if (communicationId) {
    const outcomeMap: Record<string, string> = { completed: "completed", busy: "busy", failed: "failed", "no-answer": "no_answer", "in-progress": "answered", answered: "answered", ringing: "ringing" };
    const outcome = outcomeMap[callStatus];
    const patch: Record<string, unknown> = {};
    if (outcome) patch.outcome = outcome;
    if (callStatus === "completed" || callStatus === "busy" || callStatus === "failed" || callStatus === "no-answer") {
      patch.status = callStatus === "completed" ? "delivered" : "failed";
      patch.completed_at = new Date().toISOString();
    }
    if (duration !== null) {
      const { data: existing } = await supabaseAdmin.from("oyi_communications").select("delivery_metadata").eq("id", communicationId).maybeSingle();
      patch.delivery_metadata = { ...(existing?.delivery_metadata || {}), duration_seconds: duration, twilio_status: callStatus, twilio_error_code: errorCode };
    }
    if (Object.keys(patch).length) {
      const { error: updateError } = await supabaseAdmin.from("oyi_communications").update(patch).eq("id", communicationId);
      if (updateError) logger.error("twilio_status_callback_update_failed", { error: updateError, communication_id: communicationId });
    }
  }

  return res.status(200).json({ ok: true });
});

export default router;
