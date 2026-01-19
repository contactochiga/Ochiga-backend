// src/controllers/facility.controller.ts
import { Request, Response } from "express";
import crypto from "crypto";
import QRCode from "qrcode";
import { supabaseAdmin } from "../supabase/supabaseClient";

// ---------------------------
// Helpers
// ---------------------------

// Helper: check estate access for a manager/admin
async function assertCanManageEstate(userId: string, estateId: string) {
  const { data, error } = await supabaseAdmin
    .from("estate_memberships")
    .select("id, role, status")
    .eq("estate_id", estateId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.status !== "active") return false;

  // Only certain roles can manage
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

// Extract missing column name from Supabase schema-cache error
function extractMissingColumnName(msg: string): string | null {
  // e.g. "Could not find the 'type' column of 'homes' in the schema cache"
  const m = msg.match(/Could not find the '([^']+)' column/i);
  return m?.[1] || null;
}

/**
 * Insert with fallback:
 * If Supabase complains "Could not find the 'X' column ...",
 * drop that key and retry (up to 5 times).
 */
async function insertWithSchemaFallback<T>(
  table: string,
  row: Record<string, any>
): Promise<T> {
  let payload = { ...row };

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .insert(payload)
      .select()
      .single();

    if (!error) return data as T;

    const msg = String(error.message || "");
    const missingCol = extractMissingColumnName(msg);

    // If it's a missing column schema-cache error, drop and retry
    if (missingCol && Object.prototype.hasOwnProperty.call(payload, missingCol)) {
      delete payload[missingCol];
      continue;
    }

    // Otherwise, fail fast
    throw new Error(error.message);
  }

  throw new Error("Insert failed after removing missing columns.");
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

    // IMPORTANT:
    // Some deployments might not have estates.type yet.
    // We still accept it from frontend, but we insert with schema fallback.
    const estate = await insertWithSchemaFallback<any>(
      "estates",
      compact({
        name,
        address: address || null,
        lat: lat ?? null,
        lng: lng ?? null,
        type: type || "estate",
      })
    );

    // Add membership
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

    // Optional: keep legacy columns synced
    await supabaseAdmin.from("users").update({ estate_id: estate.id }).eq("id", req.user.id);

    return res.json({ message: "Estate created", estate });
  } catch (e: any) {
    console.error("createEstate error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}

/**
 * GET /facility/estates
 * List estates the user belongs to
 */
export async function listMyEstates(req: any, res: Response) {
  try {
    const { data, error } = await supabaseAdmin
      .from("estate_memberships")
      .select("estate_id, role, status, estates(*)")
      .eq("user_id", req.user.id);

    if (error) return res.status(500).json({ error: error.message });

    // normalize
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
 * Create a home under an estate
 */
export async function createHome(req: any, res: Response) {
  try {
    const {
      estate_id,
      name,
      unit,
      block,
      description,
      type, // may not exist in homes table
      resident_id,

      // optional fields (your UI collects them)
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

    // IMPORTANT:
    // Some deployments might not have homes.type yet.
    // Insert with schema fallback so it auto-drops missing columns (like "type").
    const home = await insertWithSchemaFallback<any>(
      "homes",
      compact({
        estate_id,
        name,
        unit: unit || null,
        block: block || null,
        description: description || null,

        // will be dropped automatically if column doesn't exist
        type: type || "home",

        resident_id: resident_id || null,

        // meters + ids (will be inserted if columns exist)
        electricity_meter: electricity_meter || null,
        water_meter: water_meter || null,
        internet_id: internet_id || null,
        gate_code: gate_code || null,

        lat: lat ?? null,
        lng: lng ?? null,
      })
    );

    // If resident_id provided, also ensure home membership
    if (resident_id) {
      await supabaseAdmin.from("home_memberships").upsert(
        {
          home_id: home.id,
          user_id: resident_id,
          role: "owner",
          status: "active",
        },
        { onConflict: "home_id,user_id" }
      );
    }

    return res.json({ message: "Home created", home });
  } catch (e: any) {
    console.error("createHome error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}

/**
 * GET /facility/estates/:estateId/homes
 */
export async function listEstateHomes(req: any, res: Response) {
  try {
    const { estateId } = req.params;

    // Must belong to estate (any role)
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

    // Use fallback as well, in case rooms.type isn't present in some schemas
    const room = await insertWithSchemaFallback<any>(
      "rooms",
      compact({
        estate_id,
        home_id,
        name,
        type: type || null,
        floor: floor ?? null,
        ai_profile: ai_profile || {},
      })
    );

    return res.json({ message: "Room created", room });
  } catch (e: any) {
    console.error("createRoom error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
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
 */
export async function inviteUser(req: any, res: Response) {
  try {
    const { email, estate_id, home_id, role } = req.body;

    if (!email) return res.status(400).json({ error: "email is required" });
    if (!estate_id && !home_id) {
      return res.status(400).json({ error: "estate_id or home_id is required" });
    }

    if (estate_id) {
      const canManage = await assertCanManageEstate(req.user.id, estate_id);
      if (!canManage && req.user.role !== "admin") {
        return res.status(403).json({ error: "Not allowed to invite to this estate" });
      }
    }

    const { data: existingUser, error: findErr } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (findErr) return res.status(500).json({ error: findErr.message });

    let user = existingUser;

    if (!user) {
      const { data: created, error: createErr } = await supabaseAdmin
        .from("users")
        .insert({
          email,
          password_hash: null,
          role: "resident",
        })
        .select()
        .single();

      if (createErr) return res.status(500).json({ error: createErr.message });
      user = created;
    }

    if (estate_id) {
      await supabaseAdmin.from("estate_memberships").upsert(
        {
          estate_id,
          user_id: user.id,
          role: role || "resident",
          status: "invited",
        },
        { onConflict: "estate_id,user_id" }
      );
    }

    if (home_id) {
      await supabaseAdmin.from("home_memberships").upsert(
        {
          home_id,
          user_id: user.id,
          role: role || "member",
          status: "invited",
        },
        { onConflict: "home_id,user_id" }
      );
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const { error: inviteErr } = await supabaseAdmin.from("invites").insert({
      created_by: req.user.id,
      estate_id: estate_id || null,
      home_id: home_id || null,
      role: role || (home_id ? "member" : "resident"),
      invite_type: "link",
      token_hash: tokenHash,
      invited_email: email,
      status: "pending",
    });

    if (inviteErr) return res.status(500).json({ error: inviteErr.message });

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

    if (invite.estate_id) {
      await supabaseAdmin
        .from("estate_memberships")
        .update({ status: "active" })
        .eq("estate_id", invite.estate_id)
        .eq("user_id", req.user.id);
    }

    if (invite.home_id) {
      await supabaseAdmin
        .from("home_memberships")
        .update({ status: "active" })
        .eq("home_id", invite.home_id)
        .eq("user_id", req.user.id);
    }

    await supabaseAdmin
      .from("invites")
      .update({
        status: "accepted",
        claimed_by: req.user.id,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", invite.id);

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
