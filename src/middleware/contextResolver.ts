import type { NextFunction, Request, Response } from "express";
import { ContextResolutionError, resolveOisContext } from "../services/context/contextResolutionService";
import type { OisContext, OisSurface } from "../types/oisContext";
import { timeRequestStage } from "../observability/requestStageTiming";
import { patchRuntimeContext } from "../observability/runtimeContext";

export function requestInput(req: Request) {
  const source = req.method === "GET" ? req.query : req.body || {};
  const context = (source as any)?.context || {};
  return {
    surface: context.surface || (source as any)?.surface || req.headers["x-ochiga-surface"],
    estate_id: context.estate_id || (source as any)?.estate_id || null,
    home_id: context.home_id || (source as any)?.home_id || null,
    module: context.module || (source as any)?.module || null,
    target: context.target || null,
  };
}

export async function resolveRequestContext(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  try {
    req.oisContext = await timeRequestStage(req, "context", () => resolveOisContext(req.user!, requestInput(req)));
    const targetType = String(req.oisContext.target?.target_type || "");
    const targetId = String(req.oisContext.target?.target_id || "").trim();
    patchRuntimeContext({
      actorId: req.oisContext.actor_id || req.user.id,
      estateId: req.oisContext.estate_id || null,
      homeId: req.oisContext.home_id || null,
      deviceId: targetType === "device" ? targetId || null : undefined,
      roomId: targetType === "room" ? targetId || null : undefined,
    });
    return next();
  } catch (error: any) {
    const status = error instanceof ContextResolutionError ? error.statusCode : 500;
    return res.status(status).json({ error: status === 500 ? "Unable to resolve operating context" : error.message });
  }
}

const ESTATE_WIDE_ROLES = new Set(["admin", "manager", "estate_admin", "facility_admin", "facility_manager", "operator"]);

function surfaceFor(value: unknown): OisSurface {
  const candidate = String(value || "consumer").trim().toLowerCase();
  return ["consumer", "facility", "office", "command_center", "watch", "edge"].includes(candidate)
    ? candidate as OisSurface
    : "consumer";
}

function fastRuntimeContext(req: Request): OisContext | null {
  const actor = req.user;
  if (!actor?.id) return null;
  const input = requestInput(req);
  const requestedEstateId = String(input.estate_id || "").trim();
  const requestedHomeId = String(input.home_id || "").trim();
  const actorEstateId = String(actor.estate_id || "").trim();
  const actorHomeId = String(actor.home_id || "").trim();
  const estateWide = ESTATE_WIDE_ROLES.has(String(actor.role || "").toLowerCase());

  if (requestedEstateId && requestedEstateId !== actorEstateId) return null;
  if (requestedHomeId && requestedHomeId !== actorHomeId) return null;
  if (!actorEstateId || (!estateWide && !actorHomeId)) return null;

  return {
    actor_id: actor.id,
    surface: surfaceFor(input.surface),
    role: actor.role,
    permissions: Array.isArray(actor.permissions) ? actor.permissions : [],
    organization_id: null,
    portfolio_id: null,
    account_id: null,
    deployment_id: null,
    estate_id: requestedEstateId || actorEstateId,
    home_id: requestedHomeId || actorHomeId || null,
    module: String(input.module || "").trim() || null,
    target: input.target || null,
    estate: null,
    home: null,
    available_estates: [],
    available_homes: [],
    resolved_at: new Date().toISOString(),
  };
}

// Device runtime reads only require the actor's authoritative active scope. Requests
// that widen or switch scope still fall back to the full membership resolver.
export async function resolveDeviceRuntimeContext(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  try {
    req.oisContext = await timeRequestStage(req, "context", async () => {
      const fast = fastRuntimeContext(req);
      return fast || resolveOisContext(req.user!, requestInput(req));
    });
    const targetType = String(req.oisContext.target?.target_type || "");
    const targetId = String(req.oisContext.target?.target_id || "").trim();
    patchRuntimeContext({
      actorId: req.oisContext.actor_id || req.user.id,
      estateId: req.oisContext.estate_id || null,
      homeId: req.oisContext.home_id || null,
      deviceId: targetType === "device" ? targetId || null : undefined,
      roomId: targetType === "room" ? targetId || null : undefined,
    });
    return next();
  } catch (error: any) {
    const status = error instanceof ContextResolutionError ? error.statusCode : 500;
    return res.status(status).json({ error: status === 500 ? "Unable to resolve operating context" : error.message });
  }
}
