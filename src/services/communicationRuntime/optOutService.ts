// Oyi Communication Runtime -- Live Reply Loop programme. The single
// governance gate for "don't contact this person again": a real STOP/
// unsubscribe reply must IMMEDIATELY affect every future send, not just
// be labeled. isOptedOut() is checked inside CommunicationRuntime.plan()
// itself -- the ONE chokepoint every send (conversational, automation,
// or goal-driven) already passes through -- so there is no path that
// bypasses it.
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";
import type { CommunicationChannel, CommunicationRecipient } from "../../contracts/communication";

function normalizeEmail(value: string | null): string | null {
  return value ? value.trim().toLowerCase() : null;
}

function normalizePhone(value: string | null): string | null {
  return value ? value.replace(/[\s-]/g, "") : null;
}

// The identity key a recipient was reached at, for the channel actually
// being used -- matches how computeThreadReference() picks a field per
// channel, so an opt-out recorded against a WhatsApp reply matches a
// later WhatsApp send attempt to the SAME number.
function identityKeyFor(channel: CommunicationChannel, recipient: CommunicationRecipient): string | null {
  if (channel === "whatsapp") return normalizePhone(recipient.whatsapp_phone);
  if (channel === "sms" || channel === "voice_call") return normalizePhone(recipient.phone);
  if (channel === "email") return normalizeEmail(recipient.email);
  return null;
}

export async function isOptedOut(channel: CommunicationChannel, recipient: CommunicationRecipient): Promise<boolean> {
  const identityKey = identityKeyFor(channel, recipient);
  if (!identityKey) return false;
  try {
    const { data, error } = await supabaseAdmin
      .from("oyi_communication_opt_outs")
      .select("id")
      .eq("identity_key", identityKey)
      .in("channel", [channel, "all"])
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  } catch (error) {
    // Fail OPEN on a lookup error would silently defeat governance --
    // fail CLOSED instead (treat as opted-out) is wrong too, since a
    // transient DB hiccup would then block a legitimate send forever.
    // The honest middle ground: log loudly and fail open, since the
    // authoritative record still exists and the NEXT plan() call will
    // see it once the transient issue clears.
    logger.error("communication_opt_out_lookup_failed", { error, channel });
    return false;
  }
}

export async function recordOptOut(input: {
  channel: CommunicationChannel | "all";
  identityKey: string;
  reason: string;
  sourceCommunicationId?: string | null;
  leadId?: string | null;
  contactId?: string | null;
}): Promise<void> {
  if (!input.identityKey) return;
  const { error } = await supabaseAdmin
    .from("oyi_communication_opt_outs")
    .upsert(
      {
        identity_key: input.identityKey,
        channel: input.channel,
        reason: input.reason,
        source_communication_id: input.sourceCommunicationId || null,
        lead_id: input.leadId || null,
        contact_id: input.contactId || null,
        opted_out_at: new Date().toISOString(),
      },
      { onConflict: "identity_key,channel" }
    );
  if (error) {
    logger.error("communication_opt_out_record_failed", { error, channel: input.channel });
    return;
  }
  logger.info("communication_opt_out_recorded", { channel: input.channel, reason: input.reason });
}

export function identityKeyForRecipient(channel: CommunicationChannel, recipient: CommunicationRecipient): string | null {
  return identityKeyFor(channel, recipient);
}
