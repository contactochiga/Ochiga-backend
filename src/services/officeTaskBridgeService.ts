// Live Reply Loop programme -- creates a REAL Office crm_tasks row
// through the existing Task system's own bridge endpoint (mirrors
// recipientResolutionService.ts's exact pattern: SAME shared secret,
// SAME Office base URL resolution, SAME "unavailable, never invented"
// failure shape). Backend has no DB access to Office's Supabase project,
// so this is the only honest way for a goal's reply_branches to create a
// task a human will actually see in Office.
import axios from "axios";
import { resolveOfficeSyncKey } from "../middleware/officeCredential";

const DEFAULT_OFFICE_BASE_URL = "https://ochiga-lead-agents.onrender.com";

function resolveOfficeBaseUrl(): string {
  const configured = process.env.OFFICE_APP_URL || "";
  const first = configured.split(",")[0]?.trim();
  return (first || DEFAULT_OFFICE_BASE_URL).replace(/\/$/, "");
}

export type CreateFollowUpTaskInput = {
  title: string;
  description?: string | null;
  leadId?: string | null;
  opportunityId?: string | null;
  assigneeEmail?: string | null;
  actorEmail?: string | null;
};

export async function createFollowUpTask(input: CreateFollowUpTaskInput): Promise<{ ok: boolean; taskId: string | null; reason: string | null }> {
  const key = resolveOfficeSyncKey();
  if (!key) return { ok: false, taskId: null, reason: "OFFICE_SYNC_API_KEY is not set." };
  try {
    const response = await axios.post(
      `${resolveOfficeBaseUrl()}/api/lead-agents/admin/communications/create-task`,
      {
        title: input.title,
        description: input.description || "",
        lead_id: input.leadId || null,
        opportunity_id: input.opportunityId || null,
        assignee: input.assigneeEmail || null,
        actor: input.actorEmail || "oyi",
      },
      { headers: { "x-office-api-key": key, "content-type": "application/json" }, timeout: 10000, validateStatus: () => true }
    );
    if (response.status !== 200 || !response.data?.ok) {
      return { ok: false, taskId: null, reason: response.data?.error || `Office bridge responded ${response.status}.` };
    }
    return { ok: true, taskId: response.data.task_id || null, reason: null };
  } catch (error: any) {
    return { ok: false, taskId: null, reason: String(error?.message || error) };
  }
}
