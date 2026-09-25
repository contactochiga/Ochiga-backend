// Wave 9 Slice 1 -- Core's only READ path into Office's real 27-file
// knowledge pack. Mirrors the SAME outbound Backend->Office bridge pattern
// officeOpportunityBridge.ts/officeHandoffBridge.ts already established
// (same shared secret, same base-URL resolution, same discriminated-union
// result shape) -- not a new architecture, applying the one proven pattern
// to a new read-only Office admin route. Office remains the sole physical
// owner of the knowledge/ directory (Section 4/42's own instruction: do not
// couple Backend to Office's filesystem, do not make Office the permanent
// universal knowledge brain -- Office only ever serves its own files raw;
// all classification/governance happens on Backend's side, see
// officeKnowledgeManifest.ts).
import axios from "axios";
import { resolveOfficeSyncKey } from "../../../middleware/officeCredential";

const DEFAULT_OFFICE_BASE_URL = "https://ochiga-lead-agents.onrender.com";

function resolveOfficeBaseUrl(): string {
  const configured = process.env.OFFICE_APP_URL || "";
  const first = configured.split(",")[0]?.trim();
  return (first || DEFAULT_OFFICE_BASE_URL).replace(/\/+$/, "");
}

export type OfficeKnowledgeFile = {
  filename: string;
  content: string;
  updatedAt: string | null;
};

export type OfficeKnowledgeFetchResult = { ok: true; files: OfficeKnowledgeFile[] } | { ok: false; reason: string };

function normalizeFile(row: Record<string, unknown>): OfficeKnowledgeFile | null {
  const filename = String(row.filename || "").trim();
  const content = String(row.content ?? "");
  if (!filename || !content) return null;
  const updatedAt = row.updated_at ? String(row.updated_at) : null;
  return { filename, content, updatedAt };
}

// Section 40 -- exactly ONE Office HTTP call per cache refresh (see
// knowledgeRetrieval.ts's TTL cache around buildKnowledgeIndex), never one
// call per query -- matching officeOpportunityBridge.ts's own "no N+1"
// discipline.
export async function fetchOfficeKnowledgeFiles(): Promise<OfficeKnowledgeFetchResult> {
  const key = resolveOfficeSyncKey();
  if (!key) return { ok: false, reason: "not_configured" };

  const headers = { "x-office-api-key": key, "content-type": "application/json" };
  const baseUrl = resolveOfficeBaseUrl();

  let rows: Array<Record<string, unknown>>;
  try {
    const response = await axios.get(`${baseUrl}/api/lead-agents/admin/knowledge-pack`, { headers, timeout: 15000, validateStatus: () => true });
    if (response.status === 401 || response.status === 403) return { ok: false, reason: "unauthorized" };
    if (response.status >= 500) return { ok: false, reason: "office_unavailable" };
    if (response.status !== 200) return { ok: false, reason: `unexpected_status_${response.status}` };
    const body = response.data;
    rows = Array.isArray(body?.files) ? body.files : [];
  } catch (error) {
    return { ok: false, reason: "request_failed" };
  }

  const files: OfficeKnowledgeFile[] = [];
  for (const row of rows) {
    const file = normalizeFile(row || {});
    if (file) files.push(file);
  }
  return { ok: true, files };
}
