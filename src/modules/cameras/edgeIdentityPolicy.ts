import crypto from "crypto";

export type EdgeIdentity = { id: string; siteId: string; role: "edge_agent"; legacy: boolean };
type ConfiguredIdentity = { token: string; agent_id: string; site_id: string; enabled?: boolean };

function secureEqual(a: string, b: string) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function configuredIdentities(): ConfiguredIdentity[] {
  const raw = String(process.env.OYI_EDGE_AGENT_IDENTITIES || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const values = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    return values.filter((item: any) => item?.token && item?.agent_id && item?.site_id) as ConfiguredIdentity[];
  } catch {
    return [];
  }
}

function legacyTokens() {
  if (String(process.env.OYI_EDGE_ALLOW_LEGACY_TOKEN || "false").toLowerCase() !== "true") return [];
  return String(process.env.OYI_EDGE_AGENT_TOKENS || process.env.OYI_EDGE_AGENT_TOKEN || "")
    .split(",").map((item) => item.trim()).filter(Boolean);
}

export function resolveEdgeIdentity(token: string, requestedAgentId = "", requestedSiteId = ""): EdgeIdentity | null {
  const configured = configuredIdentities().find((item) => secureEqual(item.token, token));
  if (configured) {
    if (configured.enabled === false) return null;
    if (requestedAgentId && requestedAgentId !== configured.agent_id) return null;
    if (requestedSiteId && requestedSiteId !== configured.site_id) return null;
    return { id: configured.agent_id, siteId: configured.site_id, role: "edge_agent", legacy: false };
  }
  if (legacyTokens().some((candidate) => secureEqual(candidate, token))) {
    if (!requestedAgentId || !requestedSiteId) return null;
    return { id: requestedAgentId, siteId: requestedSiteId, role: "edge_agent", legacy: true };
  }
  return null;
}
