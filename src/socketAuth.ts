import jwt from "jsonwebtoken";
import type { Socket } from "socket.io";
import { supabaseAdmin } from "./supabase/supabaseClient";
import { APP_JWT_SECRET } from "./config/env";
import { emitAuditEvent, hasPermission, permissionsForRole, type PermissionKey } from "./core/foundation";

export type SocketUser = {
  id: string;
  email?: string;
  username?: string;
  role: string;
  estate_id?: string | null;
  home_id?: string | null;
  permissions?: string[];
  permission_scopes?: string[];
};

function tokenFromSocket(socket: Socket) {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) return authToken.trim();
  const header = String(socket.handshake.headers.authorization || "");
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return "";
}

function socketRequestMeta(socket: Socket) {
  return {
    headers: socket.handshake.headers,
    socket: { remoteAddress: socket.handshake.address },
  } as any;
}

export async function authenticateSocket(socket: Socket, next: (err?: Error) => void) {
  try {
    const token = tokenFromSocket(socket);
    if (!APP_JWT_SECRET || !token) {
      void emitAuditEvent({
        actorId: null,
        actorEmail: "",
        actorRole: "guest",
        action: "auth.failed",
        resourceType: "socket",
        resourceId: socket.id,
        status: "denied",
        metadata: { reason: !token ? "missing_token" : "missing_jwt_secret" },
        req: socketRequestMeta(socket),
      } as any);
      return next(new Error("unauthorized"));
    }

    const decoded = jwt.verify(token, APP_JWT_SECRET) as SocketUser;
    if (!decoded?.id || !decoded?.role) throw new Error("invalid_token_payload");

    const { data } = await supabaseAdmin
      .from("users")
      .select("id,email,username,role,estate_id,home_id,permission_scopes")
      .eq("id", decoded.id)
      .maybeSingle();

    const role = String((data as any)?.role || decoded.role);
    const permissionScopes = Array.isArray((data as any)?.permission_scopes)
      ? (data as any).permission_scopes
      : decoded.permission_scopes || [];

    const user: SocketUser = {
      id: decoded.id,
      email: (data as any)?.email ?? decoded.email,
      username: (data as any)?.username ?? decoded.username,
      role,
      estate_id: (data as any)?.estate_id ?? decoded.estate_id ?? null,
      home_id: (data as any)?.home_id ?? decoded.home_id ?? null,
      permission_scopes: permissionScopes,
      permissions: permissionsForRole(role, permissionScopes),
    };

    socket.data.user = user;
    return next();
  } catch (error: any) {
    void emitAuditEvent({
      actorId: null,
      actorEmail: "",
      actorRole: "guest",
      action: "auth.failed",
      resourceType: "socket",
      resourceId: socket.id,
      status: "denied",
      metadata: { reason: error?.message || "socket_auth_failed" },
      req: socketRequestMeta(socket),
    } as any);
    return next(new Error("unauthorized"));
  }
}

export function canUseSocket(socket: Socket, permission: PermissionKey | string) {
  return hasPermission(socket.data.user, permission);
}

export function denySocket(socket: Socket, permission: PermissionKey | string, resourceType: string, resourceId: string) {
  const user = socket.data.user as SocketUser | undefined;
  void emitAuditEvent({
    actorId: user?.id || null,
    actorEmail: user?.email || "",
    actorRole: user?.role || "guest",
    action: "permission.denied",
    resourceType,
    resourceId,
    estateId: user?.estate_id || null,
    homeId: user?.home_id || null,
    status: "denied",
    metadata: { permission, socketId: socket.id },
    req: socketRequestMeta(socket),
  } as any);
  socket.emit("error:permission", { error: "permission_denied", permission, resourceType, resourceId });
}
