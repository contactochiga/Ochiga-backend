// src/controllers/facilityOverview.controller.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

// ---------------------------
// TYPES
// ---------------------------
type AuthenticatedRequest = Request & {
  user?: {
    id: string;
    estate_id?: string;
    role?: string;
  };
};

type AmountRow = {
  amount: number;
};

// ---------------------------
// CONTROLLER
// ---------------------------
export const getFacilityOverview = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const estateId = req.user?.estate_id;

    if (!estateId) {
      return res.status(400).json({ error: "Estate not linked to user" });
    }

    // 1. Total Homes
    const { count: totalHomes } = await supabaseAdmin
      .from("homes")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId);

    // 2. Active Devices
    const { count: activeDevices } = await supabaseAdmin
      .from("devices")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .eq("status", "active");

    // 3. Open Maintenance
    const { count: openMaintenance } = await supabaseAdmin
      .from("maintenance_requests")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .in("status", ["open", "in_progress"]);

    // 4. Visitors Today
    const today = new Date().toISOString().split("T")[0];

    const { count: visitorsToday } = await supabaseAdmin
      .from("visitors")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .gte("created_at", `${today}T00:00:00`)
      .lte("created_at", `${today}T23:59:59`);

    // 5. Alerts (Unread)
    const { count: alerts } = await supabaseAdmin
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("estate_id", estateId)
      .eq("read", false);

    // 6. Wallet Summary
    const { data: wallet } = await supabaseAdmin
      .from("estate_wallets")
      .select("balance")
      .eq("estate_id", estateId)
      .single();

    const { data: dues } = await supabaseAdmin
      .from("dues")
      .select("amount")
      .eq("estate_id", estateId)
      .eq("status", "unpaid");

    const { data: payments } = await supabaseAdmin
      .from("payments")
      .select("amount")
      .eq("estate_id", estateId)
      .gte("created_at", `${today.slice(0, 7)}-01`);

    const totalOutstanding =
      (dues as AmountRow[] | null)?.reduce(
        (sum: number, d: AmountRow) => sum + d.amount,
        0
      ) || 0;

    const collectedThisMonth =
      (payments as AmountRow[] | null)?.reduce(
        (sum: number, p: AmountRow) => sum + p.amount,
        0
      ) || 0;

    return res.json({
      estate_id: estateId,
      homes: totalHomes || 0,
      active_devices: activeDevices || 0,
      open_maintenance: openMaintenance || 0,
      visitors_today: visitorsToday || 0,
      alerts: alerts || 0,
      wallet: {
        balance: wallet?.balance || 0,
        outstanding_dues: totalOutstanding,
        collected_this_month: collectedThisMonth,
      },
    });
  } catch (error) {
    console.error("Facility overview error:", error);
    return res
      .status(500)
      .json({ error: "Failed to load facility overview" });
  }
};

I already had this so I just pasted the one u created without changing controller name is that fine?? I mean this one

// src/controllers/facility.controller.ts
import { Request, Response } from "express";
import crypto from "crypto";
import QRCode from "qrcode";
import { supabaseAdmin } from "../supabase/supabaseClient";

// Helper: check estate access for a manager/admin
async function assertCanManageEstate(userId: string, estateId: string) {
  // Platform admin bypass is handled in middleware, but we still allow here too.
  // If your role system uses "admin" for platform_admin.
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

/**
 * POST /facility/estates
 * Create estate + automatically make creator owner/admin in estate_memberships
 */
export async function createEstate(req: any, res: Response) {
  try {
    const { name, address, lat, lng, type } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const { data: estate, error: estateErr } = await supabaseAdmin
      .from("estates")
      .insert({
        name,
        address: address || null,
        lat: lat || null,
        lng: lng || null,
        type: type || "estate",
      })
      .select()
      .single();

    if (estateErr) return res.status(400).json({ error: estateErr.message });

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
    await supabaseAdmin
      .from("users")
      .update({ estate_id: estate.id })
      .eq("id", req.user.id);

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
 * Also optionally set resident_id if provided (legacy convenience)
 */
export async function createHome(req: any, res: Response) {
  try {
    const { estate_id, name, unit, block, description, type, resident_id } = req.body;
    if (!estate_id || !name)
      return res.status(400).json({ error: "estate_id and name are required" });

    const canManage = await assertCanManageEstate(req.user.id, estate_id);
    if (!canManage && req.user.role !== "admin")
      return res.status(403).json({ error: "Not allowed to manage this estate" });

    const { data, error } = await supabaseAdmin
      .from("homes")
      .insert({
        estate_id,
        name,
        unit: unit || null,
        block: block || null,
        description: description || null,
        type: type || "home",
        resident_id: resident_id || null,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // If resident_id provided, also ensure home membership
    if (resident_id) {
      await supabaseAdmin.from("home_memberships").upsert(
        {
          home_id: data.id,
          user_id: resident_id,
          role: "owner",
          status: "active",
        },
        { onConflict: "home_id,user_id" }
      );
    }

    return res.json({ message: "Home created", home: data });
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
    if (!member || member.status !== "active")
      return res.status(403).json({ error: "No access to this estate" });

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
    if (!estate_id || !home_id || !name)
      return res.status(400).json({ error: "estate_id, home_id and name are required" });

    const canManage = await assertCanManageEstate(req.user.id, estate_id);
    if (!canManage && req.user.role !== "admin")
      return res.status(403).json({ error: "Not allowed to manage this estate" });

    const { data, error } = await supabaseAdmin
      .from("rooms")
      .insert({
        estate_id,
        home_id,
        name,
        type: type || null,
        floor: floor || null,
        ai_profile: ai_profile || {},
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    return res.json({ message: "Room created", room: data });
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

    // Must be in home OR be estate manager/admin
    // We'll allow if user has membership in estate of this home
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
    if (!member || member.status !== "active")
      return res.status(403).json({ error: "No access" });

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
 * Creates invite for estate or home membership (QR/link)
 */
export async function inviteUser(req: any, res: Response) {
  try {
    const { email, estate_id, home_id, role } = req.body;

    if (!email) return res.status(400).json({ error: "email is required" });
    if (!estate_id && !home_id)
      return res.status(400).json({ error: "estate_id or home_id is required" });

    // If invite is estate-scoped, ensure manager rights
    if (estate_id) {
      const canManage = await assertCanManageEstate(req.user.id, estate_id);
      if (!canManage && req.user.role !== "admin")
        return res.status(403).json({ error: "Not allowed to invite to this estate" });
    }

    // Find or create user
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

    // Pre-grant membership as "invited" (so backend can check status)
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

    // Create invite record
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
 * Accepts invite using raw token. Requires logged-in user (resident already authenticated).
 * In future you can allow OTP flow here.
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

    // Activate memberships
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

    // Mark invite accepted
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
 * Assign user to room (room_assignments.user_id)
 */
export async function assignUserToRoom(req: any, res: Response) {
  try {
    const { room_id, user_id, role, permissions } = req.body;
    if (!room_id || !user_id)
      return res.status(400).json({ error: "room_id and user_id are required" });

    // Validate room -> estate for permission check
    const { data: room, error: roomErr } = await supabaseAdmin
      .from("rooms")
      .select("id, estate_id")
      .eq("id", room_id)
      .single();

    if (roomErr || !room) return res.status(404).json({ error: "Room not found" });

    const canManage = await assertCanManageEstate(req.user.id, room.estate_id);
    if (!canManage && req.user.role !== "admin")
      return res.status(403).json({ error: "Not allowed to manage this estate" });

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
