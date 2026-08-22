// Twilio Programmable Voice adapter (Live Reply Loop / Telephony
// programme). Built as a first-class, provider-neutral CommunicationAdapter
// implementation -- CommunicationRuntime.ts and Oyi's reasoning layer
// never see "Twilio" anywhere, only the voice_call channel.
//
// HONEST STATUS AS OF THIS BUILD: audited both production Render
// services (Backend "Oyi-os" and Office "ochiga-lead-agents") and found
// ZERO Twilio environment variables configured anywhere -- no
// TWILIO_ACCOUNT_SID, no TWILIO_AUTH_TOKEN, no caller number. This
// adapter is therefore BUILT and NOT LIVE-PROVEN: isConfigured() is
// honestly false, send() honestly fails with not_configured, and no
// real call has been placed through it. It is written against Twilio's
// documented, stable REST API (no SDK dependency added -- this codebase
// already talks to every other provider via plain axios, e.g.
// WhatsAppCloudAdapter) so that the moment real credentials are added to
// the environment, this adapter is genuinely ready to place calls --
// but that readiness has not been exercised against a live account.
import axios from "axios";
import crypto from "crypto";
import type { CommunicationAdapter, CommunicationAdapterValidation } from "./CommunicationAdapter";
import type { CommunicationDispatchResult, CommunicationEvent, CommunicationRecord } from "../../../contracts/communication";

function isE164(value: string | null): boolean {
  return Boolean(value && /^\+[1-9]\d{7,14}$/.test(value.trim()));
}

function backendPublicUrl(): string {
  return (process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_PUBLIC_URL || "https://oyi-os.onrender.com").replace(/\/$/, "");
}

// Twilio's own request-signing scheme (X-Twilio-Signature): base64(
// HMAC-SHA1(authToken, url + sorted "key"+"value" pairs concatenated)).
// Used to verify a status callback genuinely came from Twilio before
// trusting it -- the SAME discipline as the WhatsApp webhook's
// X-Hub-Signature-256 check (whatsapp.js's verifySignature, added in
// this same programme).
export function verifyTwilioSignature(authToken: string, fullUrl: string, params: Record<string, string>, signatureHeader: string | undefined): boolean {
  if (!authToken || !signatureHeader) return false;
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], fullUrl);
  const expected = crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  const provided = Buffer.from(signatureHeader);
  const expectedBuf = Buffer.from(expected);
  return provided.length === expectedBuf.length && crypto.timingSafeEqual(provided, expectedBuf);
}

const TWILIO_STATUS_TO_OUTCOME: Record<string, string> = {
  queued: "unknown",
  initiated: "unknown",
  ringing: "ringing",
  "in-progress": "answered",
  answered: "answered",
  completed: "completed",
  busy: "busy",
  failed: "failed",
  "no-answer": "no_answer",
  canceled: "unknown",
};

export class TwilioVoiceAdapter implements CommunicationAdapter {
  readonly channel = "voice_call" as const;
  readonly provider = "twilio";

  private accountSid(): string {
    return String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  }
  private authToken(): string {
    return String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  }
  private callerNumber(): string {
    return String(process.env.TWILIO_CALLER_NUMBER || "").trim();
  }

  isConfigured(): boolean {
    return Boolean(this.accountSid() && this.authToken() && isE164(this.callerNumber()));
  }

  validate(record: CommunicationRecord): CommunicationAdapterValidation {
    if (!isE164(record.recipient.phone)) return { valid: false, reason: "invalid_recipient" };
    return { valid: true, reason: null };
  }

  async send(record: CommunicationRecord): Promise<CommunicationDispatchResult> {
    if (!this.isConfigured()) {
      return {
        status: "failed",
        provider: this.provider,
        provider_message_id: null,
        failure_reason: "not_configured",
        failure_detail: "No Twilio account is configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_CALLER_NUMBER are not all set).",
        delivery_metadata: null,
      };
    }
    const sid = this.accountSid();
    const twimlUrl = `${backendPublicUrl()}/webhooks/twilio/voice-twiml?message=${encodeURIComponent(record.body || "This is a call from the Ochiga Oyi system.")}`;
    const statusCallbackUrl = `${backendPublicUrl()}/webhooks/twilio/status-callback?communication_id=${encodeURIComponent(record.communication_id)}`;
    try {
      const params = new URLSearchParams({
        To: record.recipient.phone as string,
        From: this.callerNumber(),
        Url: twimlUrl,
        StatusCallback: statusCallbackUrl,
        StatusCallbackMethod: "POST",
      });
      // StatusCallbackEvent is a repeated form field, not a single value --
      // URLSearchParams.append handles the repetition correctly.
      for (const event of ["initiated", "ringing", "answered", "completed"]) params.append("StatusCallbackEvent", event);

      const response = await axios.post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, params, {
        auth: { username: sid, password: this.authToken() },
        headers: { "content-type": "application/x-www-form-urlencoded" },
        timeout: 15000,
        validateStatus: () => true,
      });
      if (response.status < 200 || response.status >= 300) {
        return {
          status: "failed",
          provider: this.provider,
          provider_message_id: null,
          failure_reason: "provider_unavailable",
          failure_detail: `Twilio rejected the call request: ${response.status} ${response.data?.message || JSON.stringify(response.data)}`,
          delivery_metadata: { twilio_error_code: response.data?.code ?? null, twilio_status: response.status },
        };
      }
      return {
        status: "sent",
        provider: this.provider,
        provider_message_id: response.data?.sid || null,
        failure_reason: null,
        failure_detail: null,
        delivery_metadata: { dial_attempt_count: 1, duration_seconds: null, ring_duration_seconds: null, recording_url: null, recording_consent_disclosed: false, voicemail_left: false, twilio_status: response.data?.status || "queued" },
      };
    } catch (error: any) {
      return {
        status: "failed",
        provider: this.provider,
        provider_message_id: null,
        failure_reason: "provider_unavailable",
        failure_detail: `Twilio request failed: ${error?.message || String(error)}`,
        delivery_metadata: null,
      };
    }
  }

  // Translates a Twilio status-callback POST body into the canonical
  // CommunicationEventType vocabulary. Called by the route handler AFTER
  // it has already verified the request's X-Twilio-Signature -- this
  // function itself does not re-verify (kept pure/testable).
  normalizeWebhook(payload: unknown): CommunicationEvent[] {
    const body = (payload || {}) as Record<string, any>;
    const callSid = String(body.CallSid || "");
    const callStatus = String(body.CallStatus || "").toLowerCase();
    if (!callSid || !callStatus) return [];
    const outcome = TWILIO_STATUS_TO_OUTCOME[callStatus] || "unknown";
    const type =
      callStatus === "ringing" ? "call.ringing" :
      callStatus === "in-progress" || callStatus === "answered" ? "call.answered" :
      callStatus === "completed" ? "call.completed" :
      callStatus === "failed" || callStatus === "busy" || callStatus === "no-answer" ? "call.failed" :
      "call.started";
    return [
      {
        event_id: `twilio-${callSid}-${callStatus}`,
        communication_id: null,
        type: type as CommunicationEvent["type"],
        occurred_at: new Date().toISOString(),
        channel: "voice_call",
        provider: this.provider,
        provider_event_id: callSid,
        from_address: body.From || null,
        text: null,
        metadata: {
          call_status: callStatus,
          outcome,
          duration_seconds: body.CallDuration ? Number(body.CallDuration) : null,
          twilio_error_code: body.ErrorCode || null,
        },
      },
    ];
  }
}
