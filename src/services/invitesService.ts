// src/services/invitesService.ts
import { supabaseAdmin } from "../supabase/supabaseClient";

export type InviteStatus = "pending" | "accepted" | "declined" | "expired";
export type HomeRole = "resident" | "home_member" | "home_admin";

export type CreateInviteInput = {
  estate_id: string;
  home_id: string;
  invited_email: string;
  role?: HomeRole;
  created_by: string; // user id
  expires_at?: string; // ISO string
};

function cleanEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function buildHomeLabel(home: any): string | null {
  if (!home) return null;
  const block = String(home.block || "").trim();
  const unit = String(home.unit || "").trim();
  const name = String(home.name || "").trim();

  if (block && unit) return `${block} / ${unit}`;
  if (block) return block;
  if (unit) return unit;
  if (name) return name;
  return null;
}

/**
 * Create a home invite (facility/admin side)
 * Table: public.invites
 */
export async function createInvite(input: CreateInviteInput) {
  const invited_email = cleanEmail(input.invited_email);
  if (!invited_email.includes("@")) {
    return { error: "Invalid invited email" };
  }

  // ✅ matches your invites table columns
  const payload = {
    created_by: input.created_by,
    estate_id: input.estate_id,
    home_id: input.home_id,
    role: (input.role || "home_member") as any, // role is USER-DEFINED in your schema
    invite_type: "home", // text column exists
    invited_email,
    status: "pending",
    expires_at: input.expires_at || null,
  };

  const { data, error } = await supabaseAdmin
    .from("invites")
    .insert(payload)
    .select("*")
    .single();

  if (error) return { error: error.message };
  return { invite: data };
}

/**
 * List invites for a user (consumer side)
 * - match by email (from JWT)
 * - enrich estate + home label (best effort)
 */
export async function listInvitesForEmail(email: string) {
  const invited_email = cleanEmail(email);

  const { data: invites, error } = await supabaseAdmin
    .from("invites")
    .select("*")
    .eq("invited_email", invited_email)
    .order("created_at", { ascending: false });

  if (error) return { error: error.message };

  const rows = invites || [];
  if (rows.length === 0) return { invites: [] };

  // ✅ Enrich (optional): estates + homes
  const estateIds = Array.from(
    new Set(rows.map((i: any) => i.estate_id).filter(Boolean))
  );
  const homeIds = Array.from(
    new Set(rows.map((i: any) => i.home_id).filter(Boolean))
  );

  const [estRes, homeRes] = await Promise.all([
    estateIds.length
      ? supabaseAdmin
          .from("estates")
          .select("id,name")
          .in("id", estateIds)
      : Promise.resolve({ data: [], error: null } as any),
    homeIds.length
      ? supabaseAdmin
          .from("homes")
          .select("id,name,block,unit")
          .in("id", homeIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const estates = (estRes?.data || []) as any[];
  const homes = (homeRes?.data || []) as any[];

  const estateMap = new Map(estates.map((e) => [e.id, e]));
  const homeMap = new Map(homes.map((h) => [h.id, h]));

  const enriched = rows.map((inv: any) => {
    const estate = inv.estate_id ? estateMap.get(inv.estate_id) || null : null;
    const home = inv.home_id ? homeMap.get(inv.home_id) || null : null;

    return {
      ...inv,
      estate: estate ? { id: estate.id, name: estate.name } : null,
      home: home
        ? { id: home.id, name: home.name, block: home.block, unit: home.unit }
        : null,
      home_label: buildHomeLabel(home),
    };
  });

  return { invites: enriched };
}

/**
 * Accept invite:
 * - checks pending
 * - checks expiry
 * - upserts home_memberships (home_id,user_id)
 * - upserts estate_memberships (estate_id,user_id) [best effort]
 * - updates users.estate_id + users.home_id
 * - marks invite accepted using claimed_by + claimed_at
 */
export async function acceptInvite(args: {
  inviteId: string;
  userId: string;
  userEmail: string;
}) {
  const inviteId = String(args.inviteId || "");
  const userEmail = cleanEmail(args.userEmail);

  if (!inviteId) return { error: "Missing inviteId" };

  // 1) load invite
  const { data: invite, error: inviteErr } = await supabaseAdmin
    .from("invites")
    .select("*")
    .eq("id", inviteId)
    .single();

  if (inviteErr || !invite) {
    return { error: inviteErr?.message || "Invite not found" };
  }

  // 2) validate invite
  if (invite.status !== "pending") {
    return { error: "Invite is not pending" };
  }

  if (invite.invited_email && cleanEmail(invite.invited_email) !== userEmail) {
    return { error: "This invite was not sent to your email" };
  }

  if (invite.expires_at) {
    const exp = new Date(invite.expires_at).getTime();
    if (Number.isFinite(exp) && Date.now() > exp) {
      // mark expired (best effort)
      await supabaseAdmin
        .from("invites")
        .update({ status: "expired" })
        .eq("id", inviteId);

      return { error: "Invite expired" };
    }
  }

  const estateId = invite.estate_id || null;
  const homeId = invite.home_id || null;

  if (!estateId || !homeId) {
    return { error: "Invite is missing estate_id or home_id" };
  }

  // 3) create membership in home_memberships
  // NOTE: home_memberships has: home_id, user_id, role, status, permissions, timestamps
  const membershipPayload = {
    home_id: homeId,
    user_id: args.userId,
    role: (invite.role as any) || "home_member",
    status: "active",
    updated_at: new Date().toISOString(),
  };

  const { error: memErr } = await supabaseAdmin
    .from("home_memberships")
    .upsert(membershipPayload, { onConflict: "home_id,user_id" });

  if (memErr) return { error: memErr.message };

  // 4) ensure estate membership (best effort)
  // estate_memberships has: estate_id, user_id, role, status, permissions, timestamps
  const estateMembershipPayload = {
    estate_id: estateId,
    user_id: args.userId,
    role: "resident" as any, // safe default; adjust later if you want mapping
    status: "active",
    updated_at: new Date().toISOString(),
  };

  await supabaseAdmin
    .from("estate_memberships")
    .upsert(estateMembershipPayload, { onConflict: "estate_id,user_id" });

  // 5) update user context (this powers /me/context + the hamburger header)
  const { error: userUpdErr } = await supabaseAdmin
    .from("users")
    .update({
      estate_id: estateId,
      home_id: homeId,
      isresident: true,
    })
    .eq("id", args.userId);

  if (userUpdErr) return { error: userUpdErr.message };

  // 6) mark invite accepted using claimed_* columns (your schema)
  const { error: updErr } = await supabaseAdmin
    .from("invites")
    .update({
      status: "accepted",
      claimed_by: args.userId,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", inviteId);

  if (updErr) return { error: updErr.message };

  return { ok: true };
}

/**
 * Decline invite:
 * - checks pending
 * - marks declined (status + claimed_by + claimed_at)
 */
export async function declineInvite(args: {
  inviteId: string;
  userId: string;
  userEmail: string;
}) {
  const inviteId = String(args.inviteId || "");
  const userEmail = cleanEmail(args.userEmail);

  if (!inviteId) return { error: "Missing inviteId" };

  const { data: invite, error: inviteErr } = await supabaseAdmin
    .from("invites")
    .select("*")
    .eq("id", inviteId)
    .single();

  if (inviteErr || !invite) {
    return { error: inviteErr?.message || "Invite not found" };
  }

  if (invite.status !== "pending") {
    return { error: "Invite is not pending" };
  }

  if (invite.invited_email && cleanEmail(invite.invited_email) !== userEmail) {
    return { error: "This invite was not sent to your email" };
  }

  const { error: updErr } = await supabaseAdmin
    .from("invites")
    .update({
      status: "declined",
      claimed_by: args.userId,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", inviteId);

  if (updErr) return { error: updErr.message };

  return { ok: true };
}
