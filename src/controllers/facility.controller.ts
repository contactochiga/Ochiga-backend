// src/controllers/facility.controller.ts
import { Request, Response } from "express";
import crypto from "crypto";
import QRCode from "qrcode";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { NotificationService } from "../services/NotificationService";
import { hasPermission } from "../core/foundation";
import { emitServiceRegistryEvent } from "../services/serviceRegistryEvents";

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

async function updateWithSchemaFallback<T>(
  table: string,
  match: Record<string, any>,
  patch: Record<string, any>,
  maxAttempts = 8
): Promise<T> {
  let payload: Record<string, any> = { ...(compact(patch) as any) };

  let lastErrorMsg = "";
  let lastErrorCode = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const query = supabaseAdmin.from(table).update(payload);
    for (const [key, value] of Object.entries(match)) {
      query.eq(key, value);
    }

    const { data, error } = await query.select().single();
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

    throw new Error(msg || "Update failed");
  }

  throw new Error(
    lastErrorMsg
      ? `Update failed after removing missing columns. Last error: ${lastErrorMsg}${
          lastErrorCode ? ` (${lastErrorCode})` : ""
        }`
      : "Update failed after removing missing columns."
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

      try {
        const { data: estate } = await supabaseAdmin
          .from("estates")
          .select("id,name")
          .eq("id", estate_id)
          .maybeSingle();

        const homeLabel =
          home.block && home.unit ? `${home.block} / ${home.unit}` : home.name || "your home";

        await NotificationService.sendToUser(String(resident_id), {
          title: "Home linked to your account",
          message: estate?.name
            ? `You now have access to ${estate.name} (${homeLabel}).`
            : `You now have access to ${homeLabel}.`,
          type: "home",
          payload: {
            estate_id,
            home_id: home.id,
            home_label: homeLabel,
            kind: "home.linked_on_create",
          },
          entityId: String(home.id),
        });
      } catch (notifyErr) {
        console.warn("createHome resident notification failed:", notifyErr);
      }
    }

    await emitServiceRegistryEvent({
      event: "home.service_registry.updated",
      estate_id,
      home_id: String(home.id),
      user_id: resident_id ? String(resident_id) : null,
      actor_id: String(req.user.id),
      payload: { reason: "home_created" },
    });
    if (electricity_meter || water_meter || internet_id) {
      await emitServiceRegistryEvent({
        event: "home.utility_account.updated",
        estate_id,
        home_id: String(home.id),
        user_id: resident_id ? String(resident_id) : null,
        actor_id: String(req.user.id),
        payload: {
          electricity_meter: Boolean(electricity_meter),
          water_meter: Boolean(water_meter),
          internet_id: Boolean(internet_id),
        },
      });
    }

    return res.json({ message: "Home created", home });
  } catch (e: any) {
    console.error("createHome error:", e);
    return res.status(400).json({ error: e.message || "Failed to create home" });
  }
}

/**
 * PATCH /facility/homes/:homeId
 */
export async function updateHome(req: any, res: Response) {
  try {
    const { homeId } = req.params;
    const {
      name,
      unit,
      block,
      description,
      electricity_meter,
      water_meter,
      internet_id,
      gate_code,
      lat,
      lng,
      resident_id,
    } = req.body || {};

    if (!homeId) return res.status(400).json({ error: "homeId is required" });

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("homes")
      .select("id, estate_id")
      .eq("id", homeId)
      .maybeSingle();

    if (existingErr) return res.status(500).json({ error: existingErr.message });
    if (!existing?.id) return res.status(404).json({ error: "Home not found" });

    const canManage = await assertCanManageEstate(req.user.id, existing.estate_id);
    if (!canManage && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not allowed to manage this estate" });
    }

    const patch = compact({
      name: name === undefined ? undefined : String(name || "").trim() || null,
      unit: unit === undefined ? undefined : String(unit || "").trim() || null,
      block: block === undefined ? undefined : String(block || "").trim() || null,
      description: description === undefined ? undefined : String(description || "").trim() || null,
      electricity_meter:
        electricity_meter === undefined ? undefined : String(electricity_meter || "").trim() || null,
      water_meter: water_meter === undefined ? undefined : String(water_meter || "").trim() || null,
      internet_id: internet_id === undefined ? undefined : String(internet_id || "").trim() || null,
      gate_code: gate_code === undefined ? undefined : String(gate_code || "").trim() || null,
      resident_id: resident_id === undefined ? undefined : resident_id || null,
      lat: lat === undefined ? undefined : lat ?? null,
      lng: lng === undefined ? undefined : lng ?? null,
      updated_at: new Date().toISOString(),
    });

    const home = await updateWithSchemaFallback<any>("homes", { id: homeId }, patch);

    const utilityChanged = electricity_meter !== undefined || water_meter !== undefined || internet_id !== undefined;
    await emitServiceRegistryEvent({
      event: "home.service_registry.updated",
      estate_id: String(existing.estate_id),
      home_id: String(homeId),
      user_id: resident_id === undefined ? String(home?.resident_id || "") || null : resident_id ? String(resident_id) : null,
      actor_id: String(req.user.id),
      payload: { reason: utilityChanged ? "utility_account_updated" : "home_updated" },
    });
    if (utilityChanged) {
      await emitServiceRegistryEvent({
        event: "home.utility_account.updated",
        estate_id: String(existing.estate_id),
        home_id: String(homeId),
        user_id: resident_id === undefined ? String(home?.resident_id || "") || null : resident_id ? String(resident_id) : null,
        actor_id: String(req.user.id),
        payload: {
          electricity_meter: electricity_meter !== undefined,
          water_meter: water_meter !== undefined,
          internet_id: internet_id !== undefined,
        },
      });
    }

    return res.json({ message: "Home updated", home });
  } catch (e: any) {
    console.error("updateHome error:", e);
    return res.status(400).json({ error: e.message || "Failed to update home" });
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

    return res.json(await loadEstateStructure(estateId));
  } catch (e: any) {
    console.error("listEstateHomes error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}

async function loadEstateStructure(estateId: string, includeInviteRows = false) {
  const [{ data: estate, error: estateError }, homesResult] = await Promise.all([
    supabaseAdmin.from("estates").select("id, name").eq("id", estateId).maybeSingle(),
    supabaseAdmin.from("homes").select("*").eq("estate_id", estateId).order("created_at", { ascending: false }),
  ]);
  if (estateError) throw new Error(estateError.message);
  if (homesResult.error) throw new Error(homesResult.error.message);

  const homes = homesResult.data || [];
  const homeIds = homes.map((home: any) => String(home.id)).filter(Boolean);
  const empty = { data: [] as any[], error: null as any };
  const [memberships, rooms, devices, invites] = homeIds.length
    ? await Promise.all([
        supabaseAdmin.from("home_memberships").select("id, home_id, user_id, role, status, created_at, updated_at").in("home_id", homeIds),
        supabaseAdmin.from("rooms").select("id, home_id, name, type, floor, created_at").in("home_id", homeIds),
        supabaseAdmin.from("devices").select("id, home_id, room_id, status, online").in("home_id", homeIds),
        supabaseAdmin
          .from("invites")
          .select("id, home_id, invited_email, role, status, expires_at, delivery_status, last_sent_at, claimed_at, revoked_at, created_at")
          .eq("estate_id", estateId)
          .order("created_at", { ascending: false }),
      ])
    : [empty, empty, empty, empty];

  const rows = {
    memberships: memberships.error ? [] : memberships.data || [],
    rooms: rooms.error ? [] : rooms.data || [],
    devices: devices.error ? [] : devices.data || [],
    invites: invites.error ? [] : invites.data || [],
  };
  const sources = {
    homes: "available",
    memberships: memberships.error ? "pending_source" : "available",
    rooms: rooms.error ? "pending_source" : "available",
    devices: devices.error ? "pending_source" : "available",
    invites: invites.error ? "pending_source" : "available",
  };
  const byHome = (items: any[], homeId: string) => items.filter((item) => String(item.home_id || "") === homeId);
  const enrichedHomes = homes.map((home: any) => {
    const id = String(home.id);
    const homeMembers = byHome(rows.memberships, id);
    const homeRooms = byHome(rows.rooms, id);
    const homeDevices = byHome(rows.devices, id);
    const homeInvites = byHome(rows.invites, id);
    const activeMembers = homeMembers.filter((item) => String(item.status || "").toLowerCase() === "active");
    const invitedMembers = homeMembers.filter((item) => String(item.status || "").toLowerCase() === "invited");
    const suspendedMembers = homeMembers.filter((item) => ["disabled", "suspended"].includes(String(item.status || "").toLowerCase()));
    return {
      ...home,
      room_count: homeRooms.length,
      device_count: homeDevices.length,
      member_count: homeMembers.length,
      active_member_count: activeMembers.length,
      invited_member_count: invitedMembers.length,
      suspended_member_count: suspendedMembers.length,
      pending_invite_count: homeInvites.filter((item) => inviteLifecycleStatus(item) === "pending").length,
      expired_invite_count: homeInvites.filter((item) => inviteLifecycleStatus(item) === "expired").length,
      occupancy_status: activeMembers.length ? "occupied" : invitedMembers.length ? "pending_activation" : "vacant",
    };
  });
  const activeMemberships = rows.memberships.filter((item) => String(item.status || "").toLowerCase() === "active");
  const suspendedMemberships = rows.memberships.filter((item) => ["disabled", "suspended"].includes(String(item.status || "").toLowerCase()));
  const pendingInvites = rows.invites.filter((item) => inviteLifecycleStatus(item) === "pending");
  const expiredInvites = rows.invites.filter((item) => inviteLifecycleStatus(item) === "expired");
  const revokedInvites = rows.invites.filter((item) => inviteLifecycleStatus(item) === "revoked");
  const failedDeliveries = rows.invites.filter((item) => String(item.delivery_status || "").toLowerCase() === "failed");

  return {
    estate: estate || { id: estateId, name: "Estate" },
    homes: enrichedHomes,
    invitations: includeInviteRows
      ? rows.invites.map((invite) => ({ ...invite, lifecycle_status: inviteLifecycleStatus(invite) }))
      : [],
    summary: {
      homes: enrichedHomes.length,
      occupied_homes: enrichedHomes.filter((home) => home.occupancy_status === "occupied").length,
      vacant_homes: enrichedHomes.filter((home) => home.occupancy_status === "vacant").length,
      pending_activation_homes: enrichedHomes.filter((home) => home.occupancy_status === "pending_activation").length,
      pending_invitations: pendingInvites.length,
      expired_invitations: expiredInvites.length,
      revoked_invitations: revokedInvites.length,
      failed_deliveries: failedDeliveries.length,
      active_residents: new Set(activeMemberships.map((item) => item.user_id).filter(Boolean)).size,
      suspended_residents: new Set(suspendedMemberships.map((item) => item.user_id).filter(Boolean)).size,
      rooms_configured: rows.rooms.length,
      devices_assigned: rows.devices.length,
      homes_without_residents: enrichedHomes.filter((home) => home.active_member_count === 0).length,
      homes_with_multiple_members: enrichedHomes.filter((home) => home.active_member_count > 1).length,
      resident_access_issues: expiredInvites.length + failedDeliveries.length + suspendedMemberships.length,
      recently_activated_residents: rows.invites.filter((item) => {
        if (inviteLifecycleStatus(item) !== "accepted" || !item.claimed_at) return false;
        return new Date(item.claimed_at).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000;
      }).length,
    },
    sources: { ...sources, invitation_rows: includeInviteRows ? "available" : "permission_required" },
  };
}

function inviteLifecycleStatus(invite: any) {
  const status = String(invite?.status || "pending").toLowerCase();
  if (status === "pending" && invite?.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
    return "expired";
  }
  return status;
}

/**
 * GET /facility/estate-structure
 */
export async function getEstateStructure(req: any, res: Response) {
  try {
    let estateId = String(req.query?.estate_id || req.user?.estate_id || "").trim();
    if (!estateId) {
      const { data: membership, error } = await supabaseAdmin
        .from("estate_memberships")
        .select("estate_id")
        .eq("user_id", req.user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      estateId = String(membership?.estate_id || "");
    }
    if (!estateId) return res.status(400).json({ error: "No active estate context" });

    const { data: membership, error } = await supabaseAdmin
      .from("estate_memberships")
      .select("id, status")
      .eq("estate_id", estateId)
      .eq("user_id", req.user.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!membership || membership.status !== "active") return res.status(403).json({ error: "No access to this estate" });

    return res.json(await loadEstateStructure(estateId, hasPermission(req.user, "staff.manage")));
  } catch (error: any) {
    console.error("getEstateStructure error:", error);
    return res.status(500).json({ error: error.message || "Unable to load estate structure" });
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
 * PATCH /facility/rooms/:roomId
 */
export async function updateRoom(req: any, res: Response) {
  try {
    const { roomId } = req.params;
    const { name, type, floor } = req.body || {};
    if (name === undefined && type === undefined && floor === undefined) {
      return res.status(400).json({ error: "Nothing to update" });
    }
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("rooms")
      .select("id, estate_id, home_id")
      .eq("id", roomId)
      .maybeSingle();
    if (existingError) return res.status(500).json({ error: existingError.message });
    if (!existing) return res.status(404).json({ error: "Room not found" });

    const canManage = await assertCanManageEstate(req.user.id, existing.estate_id);
    if (!canManage && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not allowed to manage this estate" });
    }
    const room = await updateWithSchemaFallback<any>(
      "rooms",
      { id: roomId },
      {
        name: name === undefined ? undefined : String(name || "").trim(),
        type: type === undefined ? undefined : String(type || "").trim() || null,
      floor: floor === undefined ? undefined : floor === "" || floor === null ? null : Number(floor),
      }
    );
    return res.json({ message: "Room updated", room });
  } catch (error: any) {
    console.error("updateRoom error:", error);
    return res.status(400).json({ error: error.message || "Failed to update room" });
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

    const rooms = data || [];
    const roomIds = rooms.map((room: any) => String(room.id)).filter(Boolean);
    const deviceCounts = new Map<string, number>();
    if (roomIds.length) {
      const { data: devices } = await supabaseAdmin.from("devices").select("room_id").in("room_id", roomIds);
      for (const device of devices || []) {
        const roomId = String((device as any).room_id || "");
        if (roomId) deviceCounts.set(roomId, (deviceCounts.get(roomId) || 0) + 1);
      }
    }
    return res.json({
      rooms: rooms.map((room: any) => ({ ...room, device_count: deviceCounts.get(String(room.id)) || 0 })),
    });
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
