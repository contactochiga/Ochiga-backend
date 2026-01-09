import { Response, NextFunction } from "express";
import { UserRole } from "../types/user";
import { Request } from "express";

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!roles.includes(user.role) && user.role !== "admin") {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };
}
