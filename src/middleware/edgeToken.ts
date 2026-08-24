import { Request, Response, NextFunction } from "express";
import { emitAuditEvent } from "../core/foundation";
import { resolveEdgeIdentity } from "../modules/cameras/edgeIdentityPolicy";

function extractEdgeToken(req: Request) {
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return String(req.headers["x-edge-token"] || req.headers["x-oyi-edge-token"] || "").trim();
}

export function requireEdgeToken(req: Request, res: Response, next: NextFunction) {
  const token = extractEdgeToken(req);
  const requestedAgentId = String(req.body?.agent_id || req.body?.edge_node_id || req.query?.agent_id || req.headers["x-edge-agent-id"] || "").trim();
  const requestedSiteId = String(req.body?.site_id || req.body?.estate_id || req.query?.site_id || req.query?.estate_id || req.headers["x-edge-site-id"] || "").trim();
  const identity = token ? resolveEdgeIdentity(token, requestedAgentId, requestedSiteId) : null;

  if (!identity) {
    void emitAuditEvent({
      actorId: null,
      actorEmail: "edge-agent@unknown",
      actorRole: "edge_agent",
      action: "auth.failed",
      resourceType: "edge_agent",
      resourceId: requestedAgentId || "edge_discovery",
      estateId: requestedSiteId || undefined,
      status: "denied",
      metadata: { method: req.method, path: req.path, reason: token ? "edge_identity_mismatch_or_unknown" : "missing_edge_token" },
      req,
    });
    console.warn("edge_identity_rejected", { agent_id: requestedAgentId || null, site_id: requestedSiteId || null, path: req.path });
    return res.status(401).json({ error: "Invalid or mismatched edge identity" });
  }

  if (identity.legacy) console.warn("edge_legacy_identity_accepted", { agent_id: identity.id, site_id: identity.siteId });
  (req as any).edgeAgent = identity;
  next();
}
