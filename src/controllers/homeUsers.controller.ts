// src/controllers/homeUsers.controller.ts
import { Response } from "express";
import crypto from "crypto";
import QRCode from "qrcode";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { NotificationService } from "../services/NotificationService";
import { sendResidentInviteEmail } from "../services/residentInviteEmailService";

/**
 * Rules:
 * - Home Users are PRIVATE by default.
 * - Only:
 *    - Estate owner/admin/manager/security/estate_admin/operator (estate_memberships)
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
function cleanEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

// membership_role enum in your schema
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

function extractMissingColumnName(msg: string): string | null {
  const m = String(msg || "").match(/Could not find the '([^']+)' column/i);
  return m?.[1] || null;
}

function compact<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

function makeInviteToken() {
  const rawToken = crypto.randomBytes(32).toString("hex");
  return {
    rawToken,
    tokenHash: crypto.createHash("sha256").update(rawToken).digest("hex"),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function makeResidentInviteUrl(rawToken: string) {
  const base =
    process.env.CONSUMER_APP_BASE || process.env.VISITOR_LINK_BASE || "https://oyi.com";
  return `${base}/auth/invite?token=${rawToken}`;
}

function homeDisplayLabel(home: { block?: string | null; unit?: string | null; name?: string | null }) {
  return home.block && home.unit ? `${home.block} / ${home.unit}` : home.name || home.unit || home.block || "your home";
}

async function deliverResidentInvite(input: {
  invite: any;
  invitedEmail: string;
  residentName?: string | null;
  estateName?: string | null;
  homeLabel: string;
  role?: string | null;
  inviteUrl: string;
  qrDataUrl: string;
}) {
  await supabaseAdmin.from("invites").update({ delivery_status: "pending" }).eq("id", input.invite.id);
  try {
    await sendResidentInviteEmail({
      to: input.invitedEmail,
      residentName: input.residentName,
      estateName: input.estateName,
      homeLabel: input.homeLabel,
      role: input.role,
      inviteUrl: input.inviteUrl,
      qrDataUrl: input.qrDataUrl,
      expiresAt: input.invite.expires_at,
    });
    const updated = await supabaseAdmin
      .from("invites")
      .update({ delivery_status: "sent", last_sent_at: new Date().toISOString() })
      .eq("id", input.invite.id)
      .select("id, status, expires_at, delivery_status, last_sent_at")
      .single();
    return updated.data || { ...input.invite, delivery_status: "sent" };
  } catch (error) {
    console.warn("Resident invite email failed:", error);
    const updated = await supabaseAdmin
      .from("invites")
      .update({ delivery_status: "failed", last_sent_at: new Date().toISOString() })
      .eq("id", input.invite.id)
      .select("id, status, expires_at, delivery_status, last_sent_at")
      .single();
    return updated.data || { ...input.invite, delivery_status: "failed" };
  }
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

  // 2) Estate membership
  const { data: estMem, error: estErr } = await supabaseAdmin
    .from("estate_memberships")
    .select("role, status")
    .eq("estate_id", home.estate_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (estErr) return { ok: false, code: 500, error: estErr.message };

  const estateRole = String(estMem?.role || "");
  const estateActive = estMem?.status === "active";

  // ✅ FIX: include estate_admin + operator too
  const estateCanManage =
    estateActive &&
    ["owner", "admin", "manager", "security", "estate_admin", "operator"].includes(estateRole);

  // 3) Home membership (owner)
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
      .select(
        `
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
      `
      )
      .eq("home_id", homeId)
      .order("created_at", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    let invites: any[] = [];
    if (access.canManage) {
      const { data: inviteRows, error: invitesError } = await supabaseAdmin
        .from("invites")
        .select("id, home_id, invited_email, role, status, expires_at, delivery_status, last_sent_at, claimed_at, revoked_at, created_at")
        .eq("home_id", homeId)
        .order("created_at", { ascending: false });
      if (invitesError) return res.status(500).json({ error: invitesError.message });
      invites = inviteRows || [];
    }

    return res.json({
      home_id: homeId,
      users: data || [],
      invites,
      can_manage: access.canManage,
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
 * - ✅ Creates in-app notification for invited user
 */
export async function inviteHomeUser(req: ReqAny, res: Response) {
  try {
    const { homeId } = req.params;
    const { email, role, permissions, full_name } = req.body || {};
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const normalizedEmail = cleanEmail(email);
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      return res.status(400).json({ error: "Valid email is required" });
    }

    const access = await assertHomeAccess(userId, homeId);
    if (!access.ok) return res.status(access.code).json({ error: access.error });
    if (!access.canManage) return res.status(403).json({ error: "Insufficient permissions" });

    // Load home details (for message + estate_id)
    const { data: home, error: homeErr } = await supabaseAdmin
      .from("homes")
      .select("id, estate_id, name, block, unit")
      .eq("id", homeId)
      .single();

    if (homeErr || !home) return res.status(404).json({ error: "Home not found" });

    // Load estate name (optional)
    let estateName: string | null = null;
    if (home.estate_id) {
      const { data: estateRow } = await supabaseAdmin
        .from("estates")
        .select("id, name")
        .eq("id", home.estate_id)
        .maybeSingle();

      estateName = estateRow?.name ?? null;
    }

    // Find or create user
    const { data: existingUser, error: findErr } = await supabaseAdmin
      .from("users")
      .select("id, email, full_name")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (findErr) return res.status(500).json({ error: findErr.message });

    let invitedUserId = existingUser?.id as string | undefined;

    if (!invitedUserId) {
      const created = await insertWithSchemaFallback<any>(
        "users",
        compact({
          email: normalizedEmail,
          full_name: String(full_name || "").trim() || null,
          password_hash: null,
          role: "resident",
        })
      );
      invitedUserId = created?.id;
    } else if (!existingUser?.full_name && String(full_name || "").trim()) {
      await supabaseAdmin
        .from("users")
        .update({ full_name: String(full_name).trim(), updated_at: new Date().toISOString() })
        .eq("id", invitedUserId);
    }

    const safeRole = normalizeMembershipRole(role);
    const { data: existingHomeMembership, error: existingHomeMembershipError } = await supabaseAdmin
      .from("home_memberships")
      .select("id, status")
      .eq("home_id", homeId)
      .eq("user_id", invitedUserId)
      .maybeSingle();
    if (existingHomeMembershipError) return res.status(500).json({ error: existingHomeMembershipError.message });
    if (existingHomeMembership?.status === "active") {
      return res.status(409).json({ error: "This resident already has active access to the home" });
    }

    // ✅ Upsert membership as invited (NO estate_id)
    const { data: membership, error: memErr } = await supabaseAdmin
      .from("home_memberships")
      .upsert(
        compact({
          home_id: homeId,
          user_id: invitedUserId,
          role: safeRole || "member",
          status: "invited",
          permissions: permissions || {},
        }),
        { onConflict: "home_id,user_id" }
      )
      .select()
      .single();

    if (memErr) return res.status(500).json({ error: memErr.message });

    if (home.estate_id) {
      const { data: existingEstateMembership, error: existingEstateMembershipError } = await supabaseAdmin
        .from("estate_memberships")
        .select("status")
        .eq("estate_id", home.estate_id)
        .eq("user_id", invitedUserId)
        .maybeSingle();
      if (existingEstateMembershipError) return res.status(500).json({ error: existingEstateMembershipError.message });

      const { error: estateMembershipError } = await supabaseAdmin
        .from("estate_memberships")
        .upsert(
          {
            estate_id: home.estate_id,
            user_id: invitedUserId,
            role: "resident",
            status: existingEstateMembership?.status === "active" ? "active" : "invited",
            permissions: {},
            updated_at: new Date().toISOString(),
          },
          { onConflict: "estate_id,user_id" }
        );
      if (estateMembershipError) return res.status(500).json({ error: estateMembershipError.message });
    }

    const existingPendingInvite = await supabaseAdmin
      .from("invites")
      .select("id")
      .eq("home_id", homeId)
      .eq("invited_email", normalizedEmail)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingPendingInvite.error) {
      return res.status(500).json({ error: existingPendingInvite.error.message });
    }

    // Create invite record in `invites`
    const { rawToken, tokenHash, expiresAt } = makeInviteToken();

    let inviteRow = existingPendingInvite.data || null;
    if (inviteRow?.id) {
      const refreshedInvite = await supabaseAdmin
        .from("invites")
        .update({
          created_by: userId,
          estate_id: home.estate_id || null,
          role: safeRole || "member",
          invite_type: "link",
          token_hash: tokenHash,
          invited_email: normalizedEmail,
          status: "pending",
          claimed_by: null,
          claimed_at: null,
          expires_at: expiresAt,
          delivery_status: "generated",
          last_sent_at: new Date().toISOString(),
          revoked_at: null,
          revoked_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", inviteRow.id)
        .select("id, expires_at, delivery_status")
        .single();

      if (refreshedInvite.error) return res.status(500).json({ error: refreshedInvite.error.message });
      inviteRow = refreshedInvite.data;
    } else {
      const createdInvite = await supabaseAdmin
        .from("invites")
        .insert({
          created_by: userId,
          estate_id: home.estate_id || null,
          home_id: homeId,
          role: safeRole || "member",
          invite_type: "link",
          token_hash: tokenHash,
          invited_email: normalizedEmail,
          status: "pending",
          expires_at: expiresAt,
          delivery_status: "generated",
          last_sent_at: new Date().toISOString(),
        })
        .select("id, expires_at, delivery_status")
        .single();

      if (createdInvite.error) return res.status(500).json({ error: createdInvite.error.message });
      inviteRow = createdInvite.data;
    }

    const inviteUrl = makeResidentInviteUrl(rawToken);
    const qrDataUrl = await QRCode.toDataURL(inviteUrl);
    inviteRow = await deliverResidentInvite({
      invite: inviteRow,
      invitedEmail: normalizedEmail,
      residentName: String(full_name || existingUser?.full_name || "").trim() || null,
      estateName,
      homeLabel: homeDisplayLabel(home),
      role: safeRole || "member",
      inviteUrl,
      qrDataUrl,
    });

    // ✅ Notification (best effort, don’t fail request if notif fails)
    try {
      const homeLabel = homeDisplayLabel(home);

      const message = estateName
        ? `You’ve been invited to join ${estateName} (${homeLabel}).`
        : `You’ve been invited to join ${homeLabel}.`;

      if (!existingPendingInvite.data?.id) {
        await NotificationService.sendToUser(invitedUserId!, {
          title: "New invite",
          message,
          type: "estate",
          payload: {
            inviteType: "home",
            invite_id: inviteRow?.id || null,
            estate_id: home.estate_id || null,
            estate_name: estateName,
            home_id: homeId,
            home_label: homeLabel,
            membership_id: membership?.id || null,
          },
          entityId: homeId,
        });
      }
    } catch (notifyErr) {
      console.warn("inviteHomeUser notification failed:", notifyErr);
    }

    return res.json({
      message: "Home invite created",
      inviteUrl,
      qrDataUrl,
      invited_user_id: invitedUserId,
      membership,
      invite: inviteRow,
    });
  } catch (err: any) {
    console.error("inviteHomeUser error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}

/**
 * POST /facility/homes/:homeId/invites/:inviteId/revoke
 */
export async function revokeHomeInvite(req: ReqAny, res: Response) {
  try {
    const { homeId, inviteId } = req.params;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const access = await assertHomeAccess(userId, homeId);
    if (!access.ok) return res.status(access.code).json({ error: access.error });
    if (!access.canManage) return res.status(403).json({ error: "Insufficient permissions" });

    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("invites")
      .select("id, home_id, status")
      .eq("id", inviteId)
      .eq("home_id", homeId)
      .maybeSingle();
    if (inviteError) return res.status(500).json({ error: inviteError.message });
    if (!invite) return res.status(404).json({ error: "Invite not found" });
    if (invite.status !== "pending") return res.status(400).json({ error: "Only pending invites can be revoked" });

    const { data, error } = await supabaseAdmin
      .from("invites")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_by: userId,
        delivery_status: "revoked",
        updated_at: new Date().toISOString(),
      })
      .eq("id", inviteId)
      .select("id, status, revoked_at")
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, invite: data });
  } catch (err: any) {
    console.error("revokeHomeInvite error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}

/**
 * POST /facility/homes/:homeId/invites/:inviteId/resend
 * Rotates the token, emails a fresh link + QR, and returns the delivery state.
 */
export async function resendHomeInvite(req: ReqAny, res: Response) {
  try {
    const { homeId, inviteId } = req.params;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const access = await assertHomeAccess(userId, homeId);
    if (!access.ok) return res.status(access.code).json({ error: access.error });
    if (!access.canManage) return res.status(403).json({ error: "Insufficient permissions" });

    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("invites")
      .select("id, home_id, status, invited_email, role")
      .eq("id", inviteId)
      .eq("home_id", homeId)
      .maybeSingle();
    if (inviteError) return res.status(500).json({ error: inviteError.message });
    if (!invite) return res.status(404).json({ error: "Invite not found" });
    if (invite.status === "accepted") return res.status(400).json({ error: "Accepted invites cannot be resent" });

    const { rawToken, tokenHash, expiresAt } = makeInviteToken();
    const { data, error } = await supabaseAdmin
      .from("invites")
      .update({
        token_hash: tokenHash,
        status: "pending",
        expires_at: expiresAt,
        claimed_by: null,
        claimed_at: null,
        revoked_at: null,
        revoked_by: null,
        delivery_status: "generated",
        last_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", inviteId)
      .select("id, status, expires_at, delivery_status, last_sent_at")
      .single();
    if (error) return res.status(500).json({ error: error.message });

    const inviteUrl = makeResidentInviteUrl(rawToken);
    const qrDataUrl = await QRCode.toDataURL(inviteUrl);
    const { data: home } = await supabaseAdmin
      .from("homes")
      .select("id, estate_id, name, block, unit")
      .eq("id", homeId)
      .single();
    const { data: estate } = home?.estate_id
      ? await supabaseAdmin.from("estates").select("name").eq("id", home.estate_id).maybeSingle()
      : { data: null };
    const { data: resident } = invite.invited_email
      ? await supabaseAdmin.from("users").select("full_name").eq("email", invite.invited_email).maybeSingle()
      : { data: null };
    const deliveredInvite = invite.invited_email && home
      ? await deliverResidentInvite({
          invite: data,
          invitedEmail: invite.invited_email,
          residentName: resident?.full_name || null,
          estateName: estate?.name || null,
          homeLabel: homeDisplayLabel(home),
          role: invite.role || "member",
          inviteUrl,
          qrDataUrl,
        })
      : data;
    return res.json({ ok: true, invite: deliveredInvite, inviteUrl, qrDataUrl });
  } catch (err: any) {
    console.error("resendHomeInvite error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}

/**
 * PATCH /facility/home-users/:membershipId
 */
export async function updateHomeUser(req: ReqAny, res: Response) {
  try {
    const { membershipId } = req.params;
    const { role, status, permissions, full_name, username, email } = req.body;
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    if (!role && !status && permissions === undefined && full_name === undefined && username === undefined && email === undefined) {
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

    const safeRole = role ? normalizeMembershipRole(role) : undefined;

    if (full_name !== undefined || username !== undefined || email !== undefined) {
      const userPatch = compact({
        full_name: full_name === undefined ? undefined : String(full_name || "").trim() || null,
        username: username === undefined ? undefined : String(username || "").trim() || null,
        email: email === undefined ? undefined : cleanEmail(String(email || "")),
        updated_at: new Date().toISOString(),
      });

      const { error: userErr } = await supabaseAdmin
        .from("users")
        .update(userPatch)
        .eq("id", mem.user_id);

      if (userErr) return res.status(400).json({ error: userErr.message });
    }

    const { data, error } = await supabaseAdmin
      .from("home_memberships")
      .update(
        compact({
          role: safeRole || undefined,
          status: status || undefined,
          permissions: permissions === undefined ? undefined : permissions,
        })
      )
      .eq("id", membershipId)
      .select(
        `
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
      `
      )
      .single();

    if (error) return res.status(400).json({ error: error.message });

    try {
      const { data: home } = await supabaseAdmin
        .from("homes")
        .select("id, estate_id, name, block, unit")
        .eq("id", mem.home_id)
        .maybeSingle();

      const { data: estate } = home?.estate_id
        ? await supabaseAdmin.from("estates").select("id, name").eq("id", home.estate_id).maybeSingle()
        : { data: null as any };

      const homeLabel =
        home?.block && home?.unit
          ? `${home.block} / ${home.unit}`
          : home?.name || "your home";

      if (status && String(status).toLowerCase() === "active") {
        await NotificationService.sendToUser(String(mem.user_id), {
          title: "New home access activated",
          message: estate?.name
            ? `You now have active access to ${estate.name} (${homeLabel}).`
            : `You now have active access to ${homeLabel}.`,
          type: "home",
          payload: {
            home_id: mem.home_id,
            estate_id: home?.estate_id || null,
            home_label: homeLabel,
            membership_id: mem.id,
            kind: "home.membership_activated",
          },
          entityId: String(mem.id),
        });
      } else if (status && String(status).toLowerCase() === "disabled") {
        await NotificationService.sendToUser(String(mem.user_id), {
          title: "Home access updated",
          message: estate?.name
            ? `Your access to ${estate.name} (${homeLabel}) was disabled.`
            : `Your access to ${homeLabel} was disabled.`,
          type: "home",
          payload: {
            home_id: mem.home_id,
            estate_id: home?.estate_id || null,
            home_label: homeLabel,
            membership_id: mem.id,
            kind: "home.membership_disabled",
          },
          entityId: String(mem.id),
        });
      }
    } catch (notifyErr) {
      console.warn("updateHomeUser notification failed:", notifyErr);
    }

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

    const { error } = await supabaseAdmin.from("home_memberships").delete().eq("id", membershipId);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ message: "User removed from home" });
  } catch (err: any) {
    console.error("removeHomeUser error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
