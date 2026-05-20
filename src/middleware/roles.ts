import { Response, NextFunction, Request } from "express";
import { UserRole } from "../types/user";
import { hasPermission, type PermissionKey } from "../core/foundation";

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // 👑 Admin bypass
    if (user.role === "admin") return next();

    if (!roles.includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };
}


export function requirePermission(permission: PermissionKey | string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!hasPermission(user as any, permission)) {
      return res.status(403).json({ error: "Insufficient permissions", permission });
    }

    next();
  };
}
