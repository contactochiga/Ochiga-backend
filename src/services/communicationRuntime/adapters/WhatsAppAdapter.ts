// WhatsApp channel adapter -- does NOT hold WhatsApp Cloud API credentials
// itself. Those (WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID/etc.) and
// the existing WhatsAppCloudAdapter implementation live only in
// ochiga-office (src/lead-agents/whatsapp.js), the same "Backend has no
// DB/credential access into Office's side" constraint that shapes the
// governed-action-proposal pattern elsewhere in this system. Rather than
// duplicating a second WhatsApp Cloud API integration here, this adapter
// calls a small bridge route on Office
// (POST /api/lead-agents/admin/communications/whatsapp/send) that wraps
// the existing WhatsAppCloudAdapter.sendTextMessage(). Authenticated with
// the SAME shared secret (OFFICE_SYNC_API_KEY/OFFICE_EXPORT_API_KEY)
// Office already sends to Backend today (see src/middleware/officeCredential.ts)
// -- reused symmetrically, no new credential introduced.
import axios from "axios";
import type { CommunicationAdapter, CommunicationAdapterValidation } from "./CommunicationAdapter";
import type { CommunicationDispatchResult, CommunicationEvent, CommunicationRecord } from "../../../contracts/communication";
import { resolveOfficeSyncKey } from "../../../middleware/officeCredential";

const DEFAULT_OFFICE_BASE_URL = "https://ochiga-lead-agents.onrender.com";

function resolveOfficeBaseUrl(): string {
  const configured = process.env.OFFICE_APP_URL || "";
  const first = configured.split(",")[0]?.trim();
  return (first || DEFAULT_OFFICE_BASE_URL).replace(/\/$/, "");
}

// Normalizes to E.164 with a Nigeria-first assumption (the only market
// this system currently serves) -- mirrors the exact normalization the
// user's own examples rely on ("+2348100373353" / "08100373353" being
// the same number). Never invents a country code beyond that fallback.
export function normalizeToE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return /^\+\d{8,15}$/.test(digits) ? digits : null;
  }
  if (digits.startsWith("00")) {
    const rest = digits.slice(2);
    return /^\d{8,15}$/.test(rest) ? `+${rest}` : null;
  }
  if (digits.startsWith("0") && digits.length === 11) {
    return `+234${digits.slice(1)}`;
  }
  if (digits.startsWith("234") && digits.length === 13) {
    return `+${digits}`;
  }
  if (/^\d{10}$/.test(digits)) {
    return `+234${digits}`;
  }
  return null;
}

export class WhatsAppAdapter implements CommunicationAdapter {
  readonly channel = "whatsapp" as const;
  readonly provider = "whatsapp_cloud_api";

  isConfigured(): boolean {
    return Boolean(resolveOfficeSyncKey());
  }

  validate(record: CommunicationRecord): CommunicationAdapterValidation {
    const normalized = normalizeToE164(record.recipient.whatsapp_phone || record.recipient.phone);
    if (!normalized) return { valid: false, reason: "invalid_recipient" };
    if (!record.body) return { valid: false, reason: "missing_body" };
    return { valid: true, reason: null };
  }

  async send(record: CommunicationRecord): Promise<CommunicationDispatchResult> {
    const key = resolveOfficeSyncKey();
    if (!key) {
      return { status: "failed", provider: this.provider, provider_message_id: null, failure_reason: "not_configured", failure_detail: "OFFICE_SYNC_API_KEY is not set.", delivery_metadata: null };
    }
    const to = normalizeToE164(record.recipient.whatsapp_phone || record.recipient.phone);
    if (!to) {
      return { status: "failed", provider: this.provider, provider_message_id: null, failure_reason: "invalid_recipient", failure_detail: "No valid WhatsApp-reachable phone number.", delivery_metadata: null };
    }
    try {
      const response = await axios.post(
        `${resolveOfficeBaseUrl()}/api/lead-agents/admin/communications/whatsapp/send`,
        {
          to,
          body: record.body,
          context_message_id: record.reply_to_message_id ? record.provider_conversation_id : undefined,
          communication_id: record.communication_id,
        },
        { headers: { "x-office-api-key": key, "content-type": "application/json" }, timeout: 15000, validateStatus: () => true }
      );
      if (response.status === 401 || response.status === 503) {
        return { status: "failed", provider: this.provider, provider_message_id: null, failure_reason: response.status === 401 ? "authentication_failed" : "not_configured", failure_detail: `Office bridge responded ${response.status}.`, delivery_metadata: null };
      }
      const data = response.data || {};
      if (!data.delivered) {
        return {
          status: "failed",
          provider: this.provider,
          provider_message_id: null,
          failure_reason: (data.failure_reason as CommunicationDispatchResult["failure_reason"]) || "provider_unavailable",
          failure_detail: data.failure_detail || "WhatsApp provider did not accept the message.",
          delivery_metadata: null,
        };
      }
      return {
        status: "sent",
        provider: this.provider,
        provider_message_id: data.external_message_id || null,
        failure_reason: null,
        failure_detail: null,
        delivery_metadata: { response_code: data.response_code ?? null },
      };
    } catch (error: any) {
      return {
        status: "failed",
        provider: this.provider,
        provider_message_id: null,
        failure_reason: "provider_unavailable",
        failure_detail: String(error?.message || error),
        delivery_metadata: null,
      };
    }
  }

  // Status/delivery updates arrive via Office's existing
  // /webhooks/whatsapp handler, not a pull API -- see Phase J (inbound
  // webhook normalization), not implemented as part of this file.
  normalizeWebhook(_payload: unknown): CommunicationEvent[] {
    return [];
  }
}
