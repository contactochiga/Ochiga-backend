// Generic recipient/person resolution service. Calls Office's
// recipients/resolve bridge (ochiga-office/src/lead-agents/recipient-
// resolution.js) via the SAME shared secret (OFFICE_SYNC_API_KEY/
// OFFICE_EXPORT_API_KEY) already used for the WhatsApp bridge -- no new
// credential. Backend never queries admin_users/leads/crm_contacts
// directly; it has no DB access to Office's Supabase project at all.
import axios from "axios";
import { resolveOfficeSyncKey } from "../middleware/officeCredential";
import type { RecipientResolutionResult, ResolvedRecipient } from "../contracts/recipientResolution";

const DEFAULT_OFFICE_BASE_URL = "https://ochiga-lead-agents.onrender.com";

function resolveOfficeBaseUrl(): string {
  const configured = process.env.OFFICE_APP_URL || "";
  const first = configured.split(",")[0]?.trim();
  return (first || DEFAULT_OFFICE_BASE_URL).replace(/\/$/, "");
}

function normalizeCandidate(raw: any): ResolvedRecipient {
  return {
    recipient_id: String(raw?.recipient_id || ""),
    entity_type: raw?.entity_type || "explicit",
    entity_id: raw?.entity_id ?? null,
    display_name: raw?.display_name ?? null,
    email: raw?.email ?? null,
    phone: raw?.phone ?? null,
    whatsapp: raw?.whatsapp ?? null,
    organisation_id: raw?.organisation_id ?? null,
    organisation_name: raw?.organisation_name ?? null,
    source: raw?.source || "crm_contact",
    confidence: raw?.confidence || "medium",
    confirmed: false,
    available_channels: Array.isArray(raw?.available_channels) ? raw.available_channels : [],
    active: typeof raw?.active === "boolean" ? raw.active : undefined,
  };
}

async function callBridge(body: Record<string, unknown>): Promise<RecipientResolutionResult> {
  const key = resolveOfficeSyncKey();
  if (!key) return { status: "unavailable", reason: "OFFICE_SYNC_API_KEY is not set." };
  try {
    const response = await axios.post(`${resolveOfficeBaseUrl()}/api/lead-agents/admin/recipients/resolve`, body, {
      headers: { "x-office-api-key": key, "content-type": "application/json" },
      timeout: 10000,
      validateStatus: () => true,
    });
    if (response.status !== 200) {
      return { status: "unavailable", reason: `Office bridge responded ${response.status}.` };
    }
    const data = response.data || {};
    const candidates: ResolvedRecipient[] = Array.isArray(data.candidates) ? data.candidates.map(normalizeCandidate) : [];
    if (data.status === "resolved" && candidates[0]) return { status: "resolved", recipient: candidates[0] };
    if (data.status === "ambiguous" && candidates.length) return { status: "ambiguous", candidates };
    return { status: "not_found" };
  } catch (error: any) {
    return { status: "unavailable", reason: String(error?.message || error) };
  }
}

// Resolves a name or role phrase ("Daniel", "the Head of Sales") against
// Office's authoritative staff/CRM directory. Never invents a candidate.
export async function resolveRecipientByQuery(query: string, queryType: "auto" | "name" | "role" = "auto"): Promise<RecipientResolutionResult> {
  if (!query || !query.trim()) return { status: "not_found" };
  return callBridge({ query, query_type: queryType });
}

// Refreshes a SPECIFIC already-known entity's contact details (used when
// a conversation already has an active lead/contact/staff id in context
// and just needs current channel info, e.g. after "open the Daniel lead").
export async function resolveRecipientByEntity(entityType: "lead" | "contact" | "staff", entityId: string): Promise<ResolvedRecipient | null> {
  if (!entityType || !entityId) return null;
  const result = await callBridge({ entity_type: entityType, entity_id: entityId });
  return result.status === "resolved" ? result.recipient : null;
}
