// src/controllers/homeUsers.controller.ts
import { Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { createInvite } from "../services/invitesService"; // ✅ use the SAME home_invites flow consumer uses

/**
 * Rules:
 * - Home Users are PRIVATE by default.
 * - Only:
 *    - Estate owner/admin/manager/security/operator/estate_admin (estate_memberships)
 *    - Home owner (home_memberships role=owner)
 *   can manage home users.
 */

type ReqAny = any;

/** -----------------------------
 * Types
 * ---------------------------- */
type AccessDenied = { ok: false; code: number; error: string };
type AccessOk = {
  ok: true;
  home: { id: string; estate_id: string | null };
  canView: boolean;
  canManage: boolean;
  estateRole: string | null;
  homeRole: string | null;
};
type AccessResult = AccessDenied | AccessOk;

/** -----------------------------
 * Helpers
 * ---------------------------- */
function extractMissingColumnName(msg: string): string | null {
  const m = msg.match(/Could not find the '([^']+)' column/i);
  return m?.[1] || null;
}

function compact<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

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

    if (missingCol && Object.prototype.hasOwnProperty.call(payload, missingCol)) {
      delete payload[missingCol];
      continue;
    }

    throw new Error(error.message);
  }

  throw new Error("Insert failed after removing missing columns.");
}

/** -----------------------------
 * Access Guard
 * ---------------------------- */
async function assertHomeAccess(userId: string, homeId: string): Promise<AccessResult> {
  // 1) Load home -> estate_id
  const { data: home, error: homeErr } = await supabaseAdmin
    .from("homes")
    .select("id, estate_id")
    .eq("id", homeId)
    .single();

  if (homeErr || !home) return { ok: false, code: 404, error: "Home not found" };

  // 2) Estate membership (match *your* real roles)
  const { data: estMem, error: estErr } = await supabaseAdmin
    .from("estate_memberships")
    .select("role, status")
    .eq("estate_id", home.estate_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (estErr) return { ok: false, code: 500, error: estErr.message };

  const estateRole = String(estMem?.role || "");
  const estateActive = estMem?.status === "active";

  // ✅ FIX: include estate_admin + operator (and keep the old ones)
  const estateCanManage =
    estateActive &&
    ["owner", "admin", "estate_admin", "manager", "operator", "security"].includes(estateRole);

  // 3) Home membership (owner/staff/resident)
  const { data: homeMem, error: homeErr2 } = await supabaseAdmin
    .from("home_memberships")
    .select("role, status")
    .eq("home_id", homeId)
    .eq("user_id", userId)
    .maybeSingle();

  if (homeErr2) return { ok: false, code: 500, error: homeErr2.message };

  const homeRole = String(homeMem?.role || "");
  const homeActive = homeMem?.status === "active";
  const homeIsOwner = homeActive && homeRole === "owner";

  // 4) Read access:
  const canView = estateActive || homeActive;

  // 5) Manage access:
  const canManage = estateCanManage || homeIsOwner;

  return {
    ok: true,
    home,
    canView,
    canManage,
    estateRole: estateRole || null,
    homeRole: homeRole || null,
  };
}

/**
 * GET /facility/homes/:homeId/users
 * Lists users & roles in a home.
 */
export async function listHomeUsers(req: ReqAny, res: Response) {
  try {
    const { homeId } = req.params;
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const access = await assertHomeAccess(userId, homeId);
    if (!access.ok) return res.status(access.code).json({ error: access.error });
    if (!access.canView) return res.status(403).json({ error: "No access to this home" });

    const { data, error } = await supabaseAdmin
      .from("home_memberships")
      .select(`
        id,
        home_id,
        role,
        status,
        permissions,
        created_at,
        users (
          id,
          email,
          full_name,
          username,
          role
        )
      `)
      .eq("home_id", homeId)
      .order("created_at", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      home_id: homeId,
      users: data || [],
    });
  } catch (err: any) {
    console.error("listHomeUsers error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}

/**
 * POST /facility/homes/:homeId/invite
 * Invite user to a home.
 * Body: { email, role?, permissions? }
 *
 * ✅ This now writes to home_invites (same flow consumer uses)
 * ✅ and also upserts home_memberships as "invited" for facility UI.
 */
export async function inviteHomeUser(req: ReqAny, res: Response) {
  try {
    const { homeId } = req.params;
    const { email, role, permissions } = req.body || {};
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    if (!email) return res.status(400).json({ error: "email is required" });

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const access = await assertHomeAccess(userId, homeId);
    if (!access.ok) return res.status(access.code).json({ error: access.error });
    if (!access.canManage) return res.status(403).json({ error: "Insufficient permissions" });

    // Load home again (need estate_id)
    const { data: home, error: homeErr } = await supabaseAdmin
      .from("homes")
      .select("id, estate_id")
      .eq("id", homeId)
      .single();

    if (homeErr || !home) return res.status(404).json({ error: "Home not found" });
    if (!home.estate_id) return res.status(400).json({ error: "Home has no estate_id" });

    // Optional: ensure user exists (nice for membership UI join)
    const { data: existingUser, error: findErr } = await supabaseAdmin
      .from("users")
      .select("id, email")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (findErr) return res.status(500).json({ error: findErr.message });

    let invitedUserId: string | null = existingUser?.id || null;

    if (!invitedUserId) {
      const created = await insertWithSchemaFallback<any>(
        "users",
        compact({
          email: normalizedEmail,
          password_hash: null,
          role: "resident",
          onboarding_complete: false,
        })
      );
      invitedUserId = created?.id || null;
    }

    // ✅ Upsert membership as invited (so facility “Home Users” page shows it)
    if (invitedUserId) {
      const { error: memErr } = await supabaseAdmin
        .from("home_memberships")
        .upsert(
          compact({
            estate_id: home.estate_id,
            home_id: homeId,
            user_id: invitedUserId,
            role: role || "resident",
            status: "invited",
            permissions: permissions || {},
          }),
          { onConflict: "home_id,user_id" }
        );

      if (memErr) return res.status(500).json({ error: memErr.message });
    }

    // ✅ Create the REAL invite record consumer reads (/invites/mine)
    const invRes = await createInvite({
      estate_id: String(home.estate_id),
      home_id: String(homeId),
      invited_email: normalizedEmail,
      role: (role || "home_member") as any, // home_invites roles
      created_by: userId,
      // expires_at: new Date(Date.now() + 7*864e5).toISOString(), // optional
    });

    if ("error" in invRes) {
      return res.status(400).json({ error: invRes.error });
    }

    return res.json({
      message: "Home invite created (consumer will see it in-app)",
      invite: invRes.invite,
      invited_user_id: invitedUserId,
    });
  } catch (err: any) {
    console.error("inviteHomeUser error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}

/**
 * PATCH /facility/home-users/:membershipId
 * Update home membership: role / status / permissions
 */
export async function updateHomeUser(req: ReqAny, res: Response) {
  try {
    const { membershipId } = req.params;
    const { role, status, permissions } = req.body;
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    if (!role && !status && permissions === undefined) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const { data: mem, error: memErr } = await supabaseAdmin
      .from("home_memberships")
      .select("id, home_id, role, status, user_id")
      .eq("id", membershipId)
      .single();

    if (memErr || !mem) return res.status(404).json({ error: "Membership not found" });

    const access = await assertHomeAccess(userId, mem.home_id);
    if (!access.ok) return res.status(access.code).json({ error: access.error });
    if (!access.canManage) return res.status(403).json({ error: "Insufficient permissions" });

    if (role && String(mem.role) === "owner" && role !== "owner") {
      const { count, error: cErr } = await supabaseAdmin
        .from("home_memberships")
        .select("*", { count: "exact", head: true })
        .eq("home_id", mem.home_id)
        .eq("role", "owner")
        .eq("status", "active");

      if (cErr) return res.status(500).json({ error: cErr.message });
      if ((count || 0) <= 1) {
        return res.status(400).json({ error: "Home must have at least one active owner" });
      }
    }

    const { data, error } = await supabaseAdmin
      .from("home_memberships")
      .update(
        compact({
          role: role || undefined,
          status: status || undefined,
          permissions: permissions === undefined ? undefined : permissions,
        })
      )
      .eq("id", membershipId)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    return res.json({ message: "Home user updated", membership: data });
  } catch (err: any) {
    console.error("updateHomeUser error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}

/**
 * DELETE /facility/home-users/:membershipId
 * Remove user from home
 */
export async function removeHomeUser(req: ReqAny, res: Response) {
  try {
    const { membershipId } = req.params;
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const { data: mem, error: memErr } = await supabaseAdmin
      .from("home_memberships")
      .select("id, home_id, role, status")
      .eq("id", membershipId)
      .single();

    if (memErr || !mem) return res.status(404).json({ error: "Membership not found" });

    const access = await assertHomeAccess(userId, mem.home_id);
    if (!access.ok) return res.status(access.code).json({ error: access.error });
    if (!access.canManage) return res.status(403).json({ error: "Insufficient permissions" });

    if (String(mem.role) === "owner" && mem.status === "active") {
      const { count, error: cErr } = await supabaseAdmin
        .from("home_memberships")
        .select("*", { count: "exact", head: true })
        .eq("home_id", mem.home_id)
        .eq("role", "owner")
        .eq("status", "active");

      if (cErr) return res.status(500).json({ error: cErr.message });
      if ((count || 0) <= 1) {
        return res.status(400).json({ error: "Home must have at least one active owner" });
      }
    }

    const { error } = await supabaseAdmin
      .from("home_memberships")
      .delete()
      .eq("id", membershipId);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ message: "User removed from home" });
  } catch (err: any) {
    console.error("removeHomeUser error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
