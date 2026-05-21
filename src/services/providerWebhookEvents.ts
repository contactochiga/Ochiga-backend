import { Request } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { emitAuditEvent } from "../core/foundation";

type ProviderWebhookEventInput = {
  provider: string;
  eventType: string;
  verified: boolean;
  signatureStatus: string;
  deliveryStatus: string;
  errorMessage?: string;
  payloadSummary?: Record<string, any>;
  relatedEstateId?: string | null;
  relatedUserId?: string | null;
  req?: Request;
};

function requestIp(req?: Request) {
  return String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim() || req?.socket?.remoteAddress || "";
}

export async function recordProviderWebhookEvent(input: ProviderWebhookEventInput) {
  const row = {
    provider: input.provider,
    event_type: input.eventType,
    received_at: new Date().toISOString(),
    verified: Boolean(input.verified),
    signature_status: input.signatureStatus,
    delivery_status: input.deliveryStatus,
    error_message: input.errorMessage || "",
    payload_summary: input.payloadSummary || {},
    related_estate_id: input.relatedEstateId || null,
    related_user_id: input.relatedUserId || null,
    ip: requestIp(input.req),
    user_agent: String(input.req?.headers?.["user-agent"] || ""),
  };

  const { error } = await supabaseAdmin.from("provider_webhook_events").insert(row as any);
  if (error) {
    console.warn("[provider-webhook-events] write failed:", error.message);
  }

  void emitAuditEvent({
    actorId: "provider_webhook",
    actorEmail: "provider-webhook@ochiga.local",
    actorRole: "system",
    action: "provider.webhook.received",
    resourceType: "provider_webhook",
    resourceId: `${input.provider}:${input.eventType}`,
    estateId: input.relatedEstateId || null,
    status: input.deliveryStatus === "failed" ? "failed" : "success",
    metadata: {
      provider: input.provider,
      event_type: input.eventType,
      verified: input.verified,
      signature_status: input.signatureStatus,
      delivery_status: input.deliveryStatus,
      error_message: input.errorMessage || "",
    },
    req: input.req,
  } as any);
}
