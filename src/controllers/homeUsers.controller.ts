// src/controllers/homeUsers.controller.ts
import { Response } from "express";
import crypto from "crypto";
import QRCode from "qrcode";
import { supabaseAdmin } from "../supabase/supabaseClient";

/**
 * Rules:
 * - Home Users are PRIVATE by default.
 * - Only:
 *    - Estate owner/admin/manager/security (estate_memberships)
 *    - Home owner (home_memberships role=owner)
 *   can manage home users.
 *
 * IMPORTANT (YOUR SCHEMA):
 * - home_memberships has NO estate_id column.
 * - invites table is `invites` (NOT home_invites).
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

  // 2) Estate membership (owner/admin/manager/security)
  const { data: estMem, error: estErr } = await supabaseAdmin
    .from("estate_memberships")
    .select("role, status")
    .eq("estate_id", home.estate_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (estErr) return { ok: false, code: 500, error: estErr.message };

  const estateRole = String(estMem?.role || "");
  const estateActive = estMem?.status === "active";
  const estateCanManage =
    estateActive && ["owner", "admin", "manager", "security"].includes(estateRole);

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
 * Body: { email, role?, permissions? }
 *
 * ✅ Uses YOUR schema:
 * - Writes membership to `home_memberships` (NO estate_id)
 * - Creates invite in `invites` table
 * - Returns inviteUrl + qrDataUrl
 */
export async function inviteHomeUser(req: ReqAny, res: Response) {
  try {
    const { homeId } = req.params;
    const { email, role, permissions } = req.body || {};
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      return res.status(400).json({ error: "Valid email is required" });
    }

    const access = await assertHomeAccess(userId, homeId);
    if (!access.ok) return res.status(access.code).json({ error: access.error });
    if (!access.canManage) return res.status(403).json({ error: "Insufficient permissions" });

    // Load home for estate_id
    const { data: home, error: homeErr } = await supabaseAdmin
      .from("homes")
      .select("id, estate_id")
      .eq("id", homeId)
      .single();

    if (homeErr || !home) return res.status(404).json({ error: "Home not found" });

    // Find or create user (so facility UI can show it immediately)
    const { data: existingUser, error: findErr } = await supabaseAdmin
      .from("users")
      .select("id, email")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (findErr) return res.status(500).json({ error: findErr.message });

    let invitedUserId = existingUser?.id as string | undefined;

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
      invitedUserId = created?.id;
    }

    // ✅ Upsert membership as invited (NO estate_id in your schema)
    const { data: membership, error: memErr } = await supabaseAdmin
      .from("home_memberships")
      .upsert(
        compact({
          home_id: homeId,
          user_id: invitedUserId,
          role: role || "resident",
          status: "invited",
          permissions: permissions || {},
        }),
        { onConflict: "home_id,user_id" }
      )
      .select()
      .single();

    if (memErr) return res.status(500).json({ error: memErr.message });

    // Create invite record in `invites`
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const { error: inviteErr } = await supabaseAdmin.from("invites").insert({
      created_by: userId,
      estate_id: home.estate_id || null,
      home_id: homeId,
      role: role || "resident",
      invite_type: "link",
      token_hash: tokenHash,
      invited_email: normalizedEmail,
      status: "pending",
      // expires_at uses DB default (7 days) unless you want to set it
    });

    if (inviteErr) return res.status(500).json({ error: inviteErr.message });

    // Build link to your consumer app invite screen
    const base = process.env.VISITOR_LINK_BASE || process.env.CONSUMER_APP_BASE || "https://oyi.com";
    const inviteUrl = `${base}/auth/invite?token=${rawToken}`;
    const qrDataUrl = await QRCode.toDataURL(inviteUrl);

    return res.json({
      message: "Home invite created",
      inviteUrl,
      qrDataUrl,
      invited_user_id: invitedUserId,
      membership,
    });
  } catch (err: any) {
    console.error("inviteHomeUser error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}

/**
 * PATCH /facility/home-users/:membershipId
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
      .select("id, home_id, role, status")
      .eq("id", membershipId)
      .single();

    if (memErr || !mem) return res.status(404).json({ error: "Membership not found" });

    const access = await assertHomeAccess(userId, mem.home_id);
    if (!access.ok) return res.status(access.code).json({ error: access.error });
    if (!access.canManage) return res.status(403).json({ error: "Insufficient permissions" });

    // prevent removing last owner
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

    // prevent deleting last owner
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

    const { error } = await supabaseAdmin.from("home_memberships").delete().eq("id", membershipId);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ message: "User removed from home" });
  } catch (err: any) {
    console.error("removeHomeUser error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
