// Telephony (voice_call) channel adapter. Phase A audit found NO PSTN/
// programmable-voice/WebRTC-dialout/SIP provider configured anywhere in
// either repo -- the only existing "communications" voice code
// (src/services/communications/, plural) is a browser WebRTC session/
// hand-off system with Twilio used strictly for TURN network traversal,
// not programmable outbound calling, and is explicitly unrelated to this
// work. This adapter completes the CommunicationAdapter boundary
// honestly: isConfigured() is always false and send() always returns a
// genuine not_configured failure rather than a fabricated call.
import type { CommunicationAdapter, CommunicationAdapterValidation } from "./CommunicationAdapter";
import type { CommunicationDispatchResult, CommunicationEvent, CommunicationRecord } from "../../../contracts/communication";

function isLikelyPhone(value: string | null): boolean {
  return Boolean(value && /^\+?\d{8,15}$/.test(value.replace(/[\s-]/g, "")));
}

export class TelephonyAdapter implements CommunicationAdapter {
  readonly channel = "voice_call" as const;
  readonly provider = "none";

  isConfigured(): boolean {
    return Boolean(process.env.VOICE_PROVIDER_API_KEY);
  }

  validate(record: CommunicationRecord): CommunicationAdapterValidation {
    if (!isLikelyPhone(record.recipient.phone)) return { valid: false, reason: "invalid_recipient" };
    return { valid: true, reason: null };
  }

  async send(_record: CommunicationRecord): Promise<CommunicationDispatchResult> {
    return {
      status: "failed",
      provider: this.provider,
      provider_message_id: null,
      failure_reason: "not_configured",
      failure_detail: "No programmable voice/telephony provider is configured. This is the only remaining external dependency for the voice_call channel.",
      delivery_metadata: null,
    };
  }

  normalizeWebhook(_payload: unknown): CommunicationEvent[] {
    return [];
  }
}
