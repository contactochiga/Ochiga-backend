// Oyi Communications Convergence, Slice 2 -- Core's HANDOFF decision has
// no response channel back to Office on the material-event path (Office
// never reads officeExport.ts's response body -- see
// backend-events.js's publishBackendMaterialEvent, which only checks
// HTTP status). This is a small, dedicated outbound call mirroring the
// SAME Backend->Office bridge pattern WhatsAppAdapter.ts already
// established (same shared secret, same base-URL resolution) -- not a
// new architecture, just applying that proven pattern to a second
// existing Office route
// (POST /api/lead-agents/admin/communications/handoff-request, wired to
// Office's real, pre-existing createOrUpdateHandoff/chooseStaffForHandoff
// machinery). No handoff logic lives here -- Office remains the sole
// authority for creating/routing the handoff; this module only makes
// the outbound call and reports what happened.
import axios from "axios";
import { resolveOfficeSyncKey } from "../../middleware/officeCredential";

const DEFAULT_OFFICE_BASE_URL = "https://ochiga-lead-agents.onrender.com";

function resolveOfficeBaseUrl(): string {
  const configured = process.env.OFFICE_APP_URL || "";
  const first = configured.split(",")[0]?.trim();
  return (first || DEFAULT_OFFICE_BASE_URL).replace(/\/+$/, "");
}

export type OfficeHandoffRequestInput = {
  lead_id: string;
  business_unit: string;
  requested_capability: string;
  reason: string;
  priority?: string;
};

export type OfficeHandoffRequestResult =
  | { ok: true; handoff_id: string; status: string; created: boolean; routing_status: string }
  | { ok: false; reason: string };

export async function requestOfficeHandoff(input: OfficeHandoffRequestInput): Promise<OfficeHandoffRequestResult> {
  const key = resolveOfficeSyncKey();
  if (!key) {
    return { ok: false, reason: "not_configured" };
  }
  try {
    const response = await axios.post(
      `${resolveOfficeBaseUrl()}/api/lead-agents/admin/communications/handoff-request`,
      input,
      { headers: { "x-office-api-key": key, "content-type": "application/json" }, timeout: 15000, validateStatus: () => true }
    );
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, reason: `office_http_${response.status}` };
    }
    const data = response.data || {};
    if (!data.ok) {
      return { ok: false, reason: data.error || "office_rejected" };
    }
    return {
      ok: true,
      handoff_id: data.handoff?.handoff_id || "",
      status: data.handoff?.status || "",
      created: Boolean(data.created),
      routing_status: data.routing_status || "",
    };
  } catch (error: any) {
    return { ok: false, reason: String(error?.message || error) };
  }
}
