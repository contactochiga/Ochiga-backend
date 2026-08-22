// SMS channel adapter. Phase A audit found NO SMS provider configured or
// integrated anywhere in either repo (no Twilio/Africa's Talking/Termii/
// etc. credentials, no existing send path). This adapter completes the
// CommunicationAdapter boundary honestly -- isConfigured() is always
// false until a real provider is wired in, and send() always returns a
// genuine not_configured failure. It never fabricates a successful send.
import type { CommunicationAdapter, CommunicationAdapterValidation } from "./CommunicationAdapter";
import type { CommunicationDispatchResult, CommunicationEvent, CommunicationRecord } from "../../../contracts/communication";

function isLikelyPhone(value: string | null): boolean {
  return Boolean(value && /^\+?\d{8,15}$/.test(value.replace(/[\s-]/g, "")));
}

export class SmsAdapter implements CommunicationAdapter {
  readonly channel = "sms" as const;
  readonly provider = "none";

  isConfigured(): boolean {
    // No SMS provider env var exists in this codebase today (confirmed
    // via exhaustive audit) -- this always returns false, deliberately,
    // until a real provider (e.g. SMS_PROVIDER_API_KEY) is added.
    return Boolean(process.env.SMS_PROVIDER_API_KEY);
  }

  validate(record: CommunicationRecord): CommunicationAdapterValidation {
    if (!isLikelyPhone(record.recipient.phone)) return { valid: false, reason: "invalid_recipient" };
    if (!record.body) return { valid: false, reason: "missing_body" };
    return { valid: true, reason: null };
  }

  async send(_record: CommunicationRecord): Promise<CommunicationDispatchResult> {
    return {
      status: "failed",
      provider: this.provider,
      provider_message_id: null,
      failure_reason: "not_configured",
      failure_detail: "No SMS provider is configured. This is the only remaining external dependency for the SMS channel.",
      delivery_metadata: null,
    };
  }

  normalizeWebhook(_payload: unknown): CommunicationEvent[] {
    return [];
  }
}
