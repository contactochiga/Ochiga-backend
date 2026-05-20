import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { emitAuditEvent } from "../core/foundation";

function tokenList() {
  return String(process.env.OYI_EDGE_AGENT_TOKENS || process.env.OYI_EDGE_AGENT_TOKEN || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function secureEqual(a: string, b: string) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function extractEdgeToken(req: Request) {
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return String(req.headers["x-edge-token"] || req.headers["x-oyi-edge-token"] || "").trim();
}

export function requireEdgeToken(req: Request, res: Response, next: NextFunction) {
  const token = extractEdgeToken(req);
  const allowed = tokenList();
  const ok = Boolean(token && allowed.length && allowed.some((candidate) => secureEqual(candidate, token)));

  if (!ok) {
    void emitAuditEvent({
      actorId: null,
      actorEmail: "edge-agent@unknown",
      actorRole: "edge_agent",
      action: "auth.failed",
      resourceType: "edge_agent",
      resourceId: String(req.body?.agent_id || req.params?.agentId || "edge_discovery"),
      status: "denied",
      metadata: { method: req.method, path: req.path, reason: token ? "invalid_edge_token" : "missing_edge_token" },
      req,
    });
    return res.status(401).json({ error: "Invalid or missing edge token" });
  }

  (req as any).edgeAgent = {
    id: String(req.body?.agent_id || req.headers["x-edge-agent-id"] || "edge_agent"),
    role: "edge_agent",
  };
  next();
}
