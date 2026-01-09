import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { UserRole } from "../types/user";

const APP_JWT_SECRET = process.env.APP_JWT_SECRET!;
if (!APP_JWT_SECRET) {
  console.warn("⚠️ APP_JWT_SECRET is missing in .env");
}

/* ---------------------------------------------------------
 * TYPES
 * --------------------------------------------------------- */
export interface AuthUser {
  id: string;
  email?: string;
  username?: string;
  role: UserRole;
  estate_id?: string;
  home_id?: string;
}

/* ---------------------------------------------------------
 * 🔥 EXPRESS DECLARATION MERGING (CRITICAL)
 * This makes req.user visible everywhere
 * --------------------------------------------------------- */
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/* ---------------------------------------------------------
 * TOKEN EXTRACTION
 * --------------------------------------------------------- */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const [, token] = authHeader.split(" ");
  return token || null;
}

/* ---------------------------------------------------------
 * VERIFY TOKEN
 * --------------------------------------------------------- */
function verifyToken(req: Request, res: Response): AuthUser | null {
  try {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: "Missing token" });
      return null;
    }

    const decoded = jwt.verify(token, APP_JWT_SECRET) as AuthUser;
    req.user = decoded;
    return decoded;
  } catch (err) {
    console.error("JWT Error:", err);
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }
}

/* ---------------------------------------------------------
 * REQUIRE AUTH
 * --------------------------------------------------------- */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = verifyToken(req, res);
  if (!user) return;
  next();
}

/* ---------------------------------------------------------
 * ROLE GUARD (LOW-LEVEL)
 * Prefer using middleware/roles.ts in routes
 * --------------------------------------------------------- */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!roles.includes(user.role) && user.role !== "system_admin") {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };
}

/* ---------------------------------------------------------
 * OPTIONAL USER ATTACH (NON-BLOCKING)
 * --------------------------------------------------------- */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = extractToken(req);
    if (!token) return next();

    const decoded = jwt.verify(token, APP_JWT_SECRET) as AuthUser;
    req.user = decoded;
  } catch {
    // ignore invalid token
  }

  next();
}
