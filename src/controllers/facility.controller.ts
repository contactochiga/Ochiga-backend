// src/controllers/facility.controller.ts
import { Request, Response } from "express";
import crypto from "crypto";
import QRCode from "qrcode";
import { supabaseAdmin } from "../supabase/supabaseClient";

// ---------------------------
// Helpers
// ---------------------------

function cleanEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

// Helper: check estate access for a manager/admin (estate membership-based)
async function assertCanManageEstate(userId: string, estateId: string) {
  const { data, error } = await supabaseAdmin
    .from("estate_memberships")
    .select("id, role, status")
    .eq("estate_id", estateId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.status !== "active") return false;

  // ✅ Your DB enum roles that can manage
  const manageRoles = ["owner", "admin", "manager", "security"];
  return manageRoles.includes(String(data.role));
}

// Drop undefined keys so we don’t send junk to Supabase
function compact<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

function extractMissingColumnName(msg: string): string | null {
  if (!msg) return null;

  let m = msg.match(/Could not find the ['"]([^'"]+)['"] column/i);
  if (m?.[1]) return m[1];

  m = msg.match(/column\s+"([^"]+)"\s+of\s+relation/i);
  if (m?.[1]) return m[1];

  m = msg.match(/(?:unknown|missing)\s+column[:\s]+([a-zA-Z0-9_]+)/i);
  if (m?.[1]) return m[1];

  return null;
}

async function insertWithSchemaFallback<T>(
  table: string,
  row: Record<string, any>,
  maxAttempts = 8
): Promise<T> {
  let payload: Record<string, any> = { ...(compact(row) as any) };

  let lastErrorMsg = "";
  let lastErrorCode = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await supabaseAdmin.from(table).insert(payload).select().single();
    if (!error) return data as T;

    const msg = String((error as any)?.message || "");
    const code = String((error as any)?.code || "");
    lastErrorMsg = msg;
    lastErrorCode = code;

    const missingCol = extractMissingColumnName(msg);
    if (missingCol && Object.prototype.hasOwnProperty.call(payload, missingCol)) {
      delete payload[missingCol];
      continue;
    }

    if (/schema cache/i.test(msg)) {
      const col = extractMissingColumnName(msg);
      if (col && Object.prototype.hasOwnProperty.call(payload, col)) {
        delete payload[col];
        continue;
      }
    }

    throw new Error(msg || "Insert failed");
  }

  throw new Error(
    lastErrorMsg
      ? `Insert failed after removing missing columns. Last error: ${lastErrorMsg}${
          lastErrorCode ? ` (${lastErrorCode})` : ""
        }`
      : "Insert failed after removing missing columns."
  );
}

// ✅ MUST match your membership_role enum (screenshots show USER-DEFINED)
function normalizeMembershipRole(input?: string) {
  const r = String(input || "").trim().toLowerCase();
  const allowed = new Set([
    "owner",
    "admin",
    "manager",
    "security",
    "resident",
    "member",
    "guest",
    "staff",
    "viewer",
  ]);
  return allowed.has(r) ? r : undefined;
}

// ---------------------------
// Controllers
// ---------------------------

/**
 * POST /facility/estates
 * Create estate + automatically make creator owner in estate_memberships
 */
export async function createEstate(req: any, res: Response) {
  try {
    const { name, address, lat, lng, type } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const estate = await insertWithSchemaFallback<any>("estates", {
      name,
      address: address || null,
      lat: lat ?? null,
      lng: lng ?? null,
      type: type || "estate",
    });

    const { error: memErr } = await supabaseAdmin.from("estate_memberships").upsert(
      {
        estate_id: estate.id,
        user_id: req.user.id,
        role: "owner",
        status: "active",
      },
      { onConflict: "estate_id,user_id" }
    );

    if (memErr) return res.status(500).json({ error: memErr.message });

    await supabaseAdmin.from("users").update({ estate_id: estate.id }).eq("id", req.user.id);

    return res.json({ message: "Estate created", estate });
  } catch (e: any) {
    console.error("createEstate error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}

/**
 * GET /facility/estates
 */
export async function listMyEstates(req: any, res: Response) {
  try {
    const { data, error } = await supabaseAdmin
      .from("estate_memberships")
      .select("estate_id, role, status, estates(*)")
      .eq("user_id", req.user.id);

    if (error) return res.status(500).json({ error: error.message });

    const estates = (data || [])
      .filter((m: any) => m.estates)
      .map((m: any) => ({
        ...m.estates,
        membership_role: m.role,
        membership_status: m.status,
      }));

    return res.json({ estates });
  } catch (e: any) {
    console.error("listMyEstates error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}

/**
 * POST /facility/homes
 */
export async function createHome(req: any, res: Response) {
  try {
    const {
      estate_id,
      name,
      unit,
      block,
      description,
      type,
      resident_id,
      electricity_meter,
      water_meter,
      internet_id,
      gate_code,
      lat,
      lng,
    } = req.body;

    if (!estate_id || !name) {
      return res.status(400).json({ error: "estate_id and name are required" });
    }

    const canManage = await assertCanManageEstate(req.user.id, estate_id);
    if (!canManage && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not allowed to manage this estate" });
    }

    const home = await insertWithSchemaFallback<any>("homes", {
      estate_id,
      name,
      unit: unit || null,
      block: block || null,
      description: description || null,
      type: type || "home",
      resident_id: resident_id || null,
      electricity_meter: electricity_meter || null,
      water_meter: water_meter || null,
      internet_id: internet_id || null,
      gate_code: gate_code || null,
      lat: lat ?? null,
      lng: lng ?? null,
    });

    // ✅ IMPORTANT: do NOT write estate_id into home_memberships (it doesn't exist)
    if (resident_id) {
      const { error: hmErr } = await supabaseAdmin.from("home_memberships").upsert(
        {
          home_id: home.id,
          user_id: resident_id,
          role: "owner",
          status: "active",
        },
        { onConflict: "home_id,user_id" }
      );
      if (hmErr) return res.status(500).json({ error: hmErr.message });
    }

    return res.json({ message: "Home created", home });
  } catch (e: any) {
    console.error("createHome error:", e);
    return res.status(400).json({ error: e.message || "Failed to create home" });
  }
}

/**
 * GET /facility/estates/:estateId/homes
 */
export async function listEstateHomes(req: any, res: Response) {
  try {
    const { estateId } = req.params;

    const { data: member, error: memErr } = await supabaseAdmin
      .from("estate_memberships")
      .select("id, status")
      .eq("estate_id", estateId)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (memErr) return res.status(500).json({ error: memErr.message });
    if (!member || member.status !== "active") {
      return res.status(403).json({ error: "No access to this estate" });
    }

    const { data, error } = await supabaseAdmin
      .from("homes")
      .select("*")
      .eq("estate_id", estateId)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ homes: data || [] });
  } catch (e: any) {
    console.error("listEstateHomes error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}

/**
 * POST /facility/rooms
 */
export async function createRoom(req: any, res: Response) {
  try {
    const { estate_id, home_id, name, type, floor, ai_profile } = req.body;

    if (!estate_id || !home_id || !name) {
      return res.status(400).json({ error: "estate_id, home_id and name are required" });
    }

    const canManage = await assertCanManageEstate(req.user.id, estate_id);
    if (!canManage && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not allowed to manage this estate" });
    }

    const room = await insertWithSchemaFallback<any>("rooms", {
      estate_id,
      home_id,
      name,
      type: type || null,
      floor: floor ?? null,
      ai_profile: ai_profile || {},
    });

    return res.json({ message: "Room created", room });
  } catch (e: any) {
    console.error("createRoom error:", e);
    return res.status(400).json({ error: e.message || "Failed to create room" });
  }
}

/**
 * GET /facility/homes/:homeId/rooms
 */
export async function listHomeRooms(req: any, res: Response) {
  try {
    const { homeId } = req.params;

    const { data: home, error: homeErr } = await supabaseAdmin
      .from("homes")
      .select("id, estate_id")
      .eq("id", homeId)
      .single();

    if (homeErr || !home) return res.status(404).json({ error: "Home not found" });

    const { data: member, error: memErr } = await supabaseAdmin
      .from("estate_memberships")
      .select("role, status")
      .eq("estate_id", home.estate_id)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (memErr) return res.status(500).json({ error: memErr.message });
    if (!member || member.status !== "active") return res.status(403).json({ error: "No access" });

    const { data, error } = await supabaseAdmin
      .from("rooms")
      .select("*")
      .eq("home_id", homeId)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ rooms: data || [] });
  } catch (e: any) {
    console.error("listHomeRooms error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}

/**
 * POST /facility/invites
 * Creates a link/QR invite into `invites`
 */
export async function inviteUser(req: any, res: Response) {
  try {
    const { email, estate_id, home_id, role } = req.body;

    const invitedEmail = cleanEmail(email);
    if (!invitedEmail) return res.status(400).json({ error: "email is required" });
    if (!invitedEmail.includes("@")) return res.status(400).json({ error: "Invalid email" });

    if (!estate_id && !home_id) {
      return res.status(400).json({ error: "estate_id or home_id is required" });
    }

    if (estate_id) {
      const canManage = await assertCanManageEstate(req.user.id, estate_id);
      if (!canManage && req.user.role !== "admin") {
        return res.status(403).json({ error: "Not allowed to invite to this estate" });
      }
    }

    // Find or create user row
    const { data: existingUser, error: findErr } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("email", invitedEmail)
      .maybeSingle();

    if (findErr) return res.status(500).json({ error: findErr.message });

    let user = existingUser;

    if (!user) {
      const created = await insertWithSchemaFallback<any>("users", {
        email: invitedEmail,
        role: "resident",
        password_hash: null,
      });
      user = created;
    }

    const safeRole = normalizeMembershipRole(role);

    // Estate membership invited
    if (estate_id) {
      const { error: emErr } = await supabaseAdmin.from("estate_memberships").upsert(
        {
          estate_id,
          user_id: user.id,
          role: safeRole || "resident",
          status: "invited",
          permissions: {},
        },
        { onConflict: "estate_id,user_id" }
      );
      if (emErr) return res.status(500).json({ error: emErr.message });
    }

    // Home membership invited (✅ NO estate_id column here)
    if (home_id) {
      const { error: hmErr } = await supabaseAdmin.from("home_memberships").upsert(
        {
          home_id,
          user_id: user.id,
          role: safeRole || "member",
          status: "invited",
          permissions: {},
        },
        { onConflict: "home_id,user_id" }
      );
      if (hmErr) return res.status(500).json({ error: hmErr.message });
    }

    // Create invite token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const inviteInsert = await supabaseAdmin.from("invites").insert({
      created_by: req.user.id,
      estate_id: estate_id || null,
      home_id: home_id || null,
      role: safeRole || (home_id ? "member" : "resident"),
      invite_type: "link",
      token_hash: tokenHash,
      invited_email: invitedEmail,
      status: "pending",
    });

    if (inviteInsert.error) return res.status(500).json({ error: inviteInsert.error.message });

    const base = process.env.VISITOR_LINK_BASE || "https://oyi.com";
    const inviteUrl = `${base}/auth/invite?token=${rawToken}`;
    const qrDataUrl = await QRCode.toDataURL(inviteUrl);

    return res.json({
      message: "Invite created",
      inviteUrl,
      qrDataUrl,
      invited_user_id: user.id,
    });
  } catch (e: any) {
    console.error("inviteUser error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}

/**
 * POST /facility/invites/accept
 * Accepts token and activates memberships
 */
export async function acceptInvite(req: any, res: Response) {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "token is required" });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const { data: invite, error: invErr } = await supabaseAdmin
      .from("invites")
      .select("*")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (invErr) return res.status(500).json({ error: invErr.message });
    if (!invite) return res.status(404).json({ error: "Invite not found" });
    if (invite.status !== "pending") return res.status(400).json({ error: "Invite not active" });

    // invite.role is enum already, but we still coerce safely
    const invitedRole = normalizeMembershipRole(String(invite.role || "")) || "resident";

    // ✅ UPSERT memberships as ACTIVE (update-only can silently do nothing)
    if (invite.estate_id) {
      const { error: emErr } = await supabaseAdmin.from("estate_memberships").upsert(
        {
          estate_id: invite.estate_id,
          user_id: req.user.id,
          role: invitedRole,
          status: "active",
          permissions: {},
        },
        { onConflict: "estate_id,user_id" }
      );
      if (emErr) return res.status(500).json({ error: emErr.message });
    }

    if (invite.home_id) {
      // ✅ for home-level, default "member" if role came as "resident"
      const homeRole = invitedRole === "resident" ? "member" : invitedRole;

      const { error: hmErr } = await supabaseAdmin.from("home_memberships").upsert(
        {
          home_id: invite.home_id,
          user_id: req.user.id,
          role: homeRole,
          status: "active",
          permissions: {},
        },
        { onConflict: "home_id,user_id" }
      );
      if (hmErr) return res.status(500).json({ error: hmErr.message });
    }

    const { error: updErr } = await supabaseAdmin
      .from("invites")
      .update({
        status: "accepted",
        claimed_by: req.user.id,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", invite.id);

    if (updErr) return res.status(500).json({ error: updErr.message });

    return res.json({ message: "Invite accepted", invite });
  } catch (e: any) {
    console.error("acceptInvite error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}

/**
 * POST /facility/rooms/assign
 */
export async function assignUserToRoom(req: any, res: Response) {
  try {
    const { room_id, user_id, role, permissions } = req.body;
    if (!room_id || !user_id) {
      return res.status(400).json({ error: "room_id and user_id are required" });
    }

    const { data: room, error: roomErr } = await supabaseAdmin
      .from("rooms")
      .select("id, estate_id")
      .eq("id", room_id)
      .single();

    if (roomErr || !room) return res.status(404).json({ error: "Room not found" });

    const canManage = await assertCanManageEstate(req.user.id, room.estate_id);
    if (!canManage && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not allowed to manage this estate" });
    }

    const { data, error } = await supabaseAdmin
      .from("room_assignments")
      .insert({
        room_id,
        user_id,
        role: role || "member",
        permissions: permissions || {},
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    return res.json({ message: "User assigned to room", assignment: data });
  } catch (e: any) {
    console.error("assignUserToRoom error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
