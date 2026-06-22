import type { NextFunction, Request, Response } from "express";
import { ContextResolutionError, resolveOisContext } from "../services/context/contextResolutionService";

function requestInput(req: Request) {
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
    req.oisContext = await resolveOisContext(req.user, requestInput(req));
    return next();
  } catch (error: any) {
    const status = error instanceof ContextResolutionError ? error.statusCode : 500;
    return res.status(status).json({ error: status === 500 ? "Unable to resolve operating context" : error.message });
  }
}
