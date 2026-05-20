import { Request, Response, NextFunction } from "express";
import { emitAuditEvent } from "../core/foundation";

type ResourceIdResolver = string | ((req: Request, res: Response) => string | undefined | null);

export function auditOnSuccess(action: string, resourceType: string, resourceId?: ResourceIdResolver) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const resolvedId = typeof resourceId === "function"
        ? resourceId(req, res)
        : resourceId
          ? req.params[resourceId] || (req.body as any)?.[resourceId] || resourceId
          : req.params.id || req.params[`${resourceType}Id`] || (req.body as any)?.id || "";
      void emitAuditEvent({
        actorId: req.user?.id || null,
        actorEmail: req.user?.email || "",
        actorRole: req.user?.role || "guest",
        action,
        resourceType,
        resourceId: String(resolvedId || ""),
        estateId: req.user?.estate_id || (req.body as any)?.estate_id || null,
        homeId: req.user?.home_id || (req.body as any)?.home_id || null,
        status: "success",
        metadata: {
          method: req.method,
          path: req.path,
          params: req.params,
        },
        req,
      } as any);
    });
    next();
  };
}
