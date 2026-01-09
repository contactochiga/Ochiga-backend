// src/middleware/roles.ts

import { Response, NextFunction } from "express";
import { AuthRequest, UserRole } from "./auth";

/* ---------------------------------------------------------
 * Require ONE specific role
 * --------------------------------------------------------- */
export function requireRole(role: UserRole) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // estate_admin is always allowed
    if (user.role === "estate_admin") {
      return next();
    }

    if (user.role !== role) {
      return res.status(403).json({
        error: "Insufficient permissions",
        required: role,
        actual: user.role,
      });
    }

    next();
  };
}

/* ---------------------------------------------------------
 * Require ANY of multiple roles (recommended)
 * --------------------------------------------------------- */
export function requireAnyRole(roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // estate_admin bypass
    if (user.role === "estate_admin") {
      return next();
    }

    if (!roles.includes(user.role)) {
      return res.status(403).json({
        error: "Insufficient permissions",
        required: roles,
        actual: user.role,
      });
    }

    next();
  };
}

/* ---------------------------------------------------------
 * Convenience guards (clean + readable)
 * --------------------------------------------------------- */
export const requireResident = requireRole("resident");
export const requireManager = requireAnyRole(["manager"]);
export const requireOperator = requireAnyRole(["operator"]);
export const requireStaff = requireAnyRole(["manager", "operator"]);
