// Email channel adapter -- reuses the EXISTING, working Resend
// integration (src/services/emailService.ts -> resendMailer.ts, the
// official `resend` SDK) rather than a second implementation. This is
// deliberately the SDK-based one (not Office's raw-fetch equivalent in
// ochiga-office/src/lead-agents/email.js) since Backend already owns
// live RESEND_API_KEY credentials and is where Oyi Core / the
// Automation Runtime both already run -- no cross-repo call needed for
// this one channel (contrast WhatsAppAdapter, which does need one).
import { sendEmail } from "../../emailService";
import type { CommunicationAdapter, CommunicationAdapterValidation } from "./CommunicationAdapter";
import type { CommunicationDispatchResult, CommunicationEvent, CommunicationRecord } from "../../../contracts/communication";

function isLikelyEmail(value: string | null): boolean {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

export class EmailAdapter implements CommunicationAdapter {
  readonly channel = "email" as const;
  readonly provider = "resend";

  isConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY);
  }

  validate(record: CommunicationRecord): CommunicationAdapterValidation {
    if (!isLikelyEmail(record.recipient.email)) {
      return { valid: false, reason: "invalid_recipient" };
    }
    if (!record.body && !record.html) {
      return { valid: false, reason: "missing_body" };
    }
    return { valid: true, reason: null };
  }

  async send(record: CommunicationRecord): Promise<CommunicationDispatchResult> {
    if (!this.isConfigured()) {
      return { status: "failed", provider: this.provider, provider_message_id: null, failure_reason: "not_configured", failure_detail: "RESEND_API_KEY is not set.", delivery_metadata: null };
    }
    try {
      const result: any = await sendEmail({
        to: record.recipient.email as string,
        subject: record.subject || "(no subject)",
        html: record.html || `<p>${escapeHtml(record.body || "")}</p>`,
        text: record.plain_text || record.body || undefined,
      });
      // The `resend` SDK returns { data: { id }, error } rather than
      // throwing on a provider-level rejection (invalid recipient,
      // domain not verified, etc.) -- both shapes are handled here so
      // neither silently reports success.
      if (result?.error) {
        return {
          status: "failed",
          provider: this.provider,
          provider_message_id: null,
          failure_reason: classifyResendError(result.error),
          failure_detail: String(result.error?.message || result.error),
          delivery_metadata: null,
        };
      }
      const messageId = result?.data?.id || result?.id || null;
      return { status: "sent", provider: this.provider, provider_message_id: messageId, failure_reason: null, failure_detail: null, delivery_metadata: null };
    } catch (error: any) {
      return {
        status: "failed",
        provider: this.provider,
        provider_message_id: null,
        failure_reason: classifyResendError(error),
        failure_detail: String(error?.message || error),
        delivery_metadata: null,
      };
    }
  }

  // Resend delivers status via webhook (email.sent/delivered/bounced/
  // complained), not a pull API on the free/standard integration this
  // codebase already uses -- no getStatus() implemented, same "report
  // what's real, not what's aspirational" discipline as everywhere else
  // in this program.

  normalizeWebhook(payload: unknown): CommunicationEvent[] {
    const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
    const type = String(body.type || "");
    const data = (body.data && typeof body.data === "object" ? body.data : {}) as Record<string, unknown>;
    const map: Record<string, CommunicationEvent["type"]> = {
      "email.sent": "communication.sent",
      "email.delivered": "communication.delivered",
      "email.opened": "communication.read",
      "email.bounced": "communication.failed",
      "email.complained": "communication.failed",
      "email.delivery_delayed": "communication.queued",
    };
    const eventType = map[type];
    if (!eventType) return [];
    return [
      {
        event_id: String(body.id || `resend-${Date.now()}`),
        communication_id: null,
        type: eventType,
        occurred_at: String(body.created_at || new Date().toISOString()),
        channel: "email",
        provider: this.provider,
        provider_event_id: String((data as any).email_id || body.id || ""),
        from_address: null,
        text: null,
        metadata: { resend_type: type },
      },
    ];
  }
}

function classifyResendError(error: any): CommunicationDispatchResult["failure_reason"] {
  const message = String(error?.message || error || "").toLowerCase();
  if (message.includes("api key") || message.includes("unauthorized")) return "authentication_failed";
  if (message.includes("rate limit")) return "rate_limited";
  if (message.includes("invalid") && message.includes("recipient")) return "invalid_recipient";
  if (message.includes("invalid") && (message.includes("to") || message.includes("email"))) return "invalid_recipient";
  return "unknown";
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
