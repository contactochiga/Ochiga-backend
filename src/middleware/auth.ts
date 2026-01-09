// src/middleware/auth.ts

import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

/* ---------------------------------------------------------
 * ENV
 * --------------------------------------------------------- */
const APP_JWT_SECRET = process.env.APP_JWT_SECRET!;
if (!APP_JWT_SECRET) {
  console.warn("⚠️ APP_JWT_SECRET is missing in .env");
}

/* ---------------------------------------------------------
 * TYPES
 * --------------------------------------------------------- */

/**
 * Canonical user type used across backend
 * IMPORTANT: role is now a UNION, not string
 */
export type UserRole = "resident" | "manager" | "operator" | "estate_admin";

export interface AuthUser {
  id: string;
  email?: string;
  username?: string;
  role: UserRole;
  estate_id?: string;
  home_id?: string;
}

/**
 * Express request augmented with auth context
 */
export interface AuthRequest extends Request {
  user?: AuthUser;
}

/* ---------------------------------------------------------
 * INTERNAL: Token extraction + verification
 * --------------------------------------------------------- */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  return token;
}

function decodeToken(token: string): AuthUser {
  return jwt.verify(token, APP_JWT_SECRET) as AuthUser;
}

/* ---------------------------------------------------------
 * CORE: Attach user or fail
 * --------------------------------------------------------- */
function authenticate(req: AuthRequest, res: Response): AuthUser | null {
  try {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return null;
    }

    const user = decodeToken(token);
    req.user = user;
    return user;
  } catch (err) {
    console.error("JWT verification failed:", err);
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }
}

/* ---------------------------------------------------------
 * 1️⃣ requireAuth — must be logged in
 * --------------------------------------------------------- */
export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const user = authenticate(req, res);
  if (!user) return;
  next();
}

/* ---------------------------------------------------------
 * 2️⃣ Role Guards
 * --------------------------------------------------------- */
export function requireResident(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const user = authenticate(req, res);
  if (!user) return;

  if (user.role !== "resident") {
    return res.status(403).json({ error: "Residents only" });
  }

  next();
}

export function requireManager(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const user = authenticate(req, res);
  if (!user) return;

  if (user.role !== "manager" && user.role !== "estate_admin") {
    return res.status(403).json({ error: "Managers only" });
  }

  next();
}

export function requireOperator(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const user = authenticate(req, res);
  if (!user) return;

  if (user.role !== "operator") {
    return res.status(403).json({ error: "Operators only" });
  }

  next();
}

/* ---------------------------------------------------------
 * 3️⃣ attachUser — optional auth (non-blocking)
 * --------------------------------------------------------- */
export function attachUser(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) {
  try {
    const token = extractToken(req);
    if (!token) return next();

    const user = decodeToken(token);
    req.user = user;
  } catch {
    // silently ignore invalid tokens
  }

  next();
}
