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

/**
 * Create a home invite (facility/admin side)
 */
export async function createInvite(input: CreateInviteInput) {
  const invited_email = cleanEmail(input.invited_email);
  if (!invited_email.includes("@")) {
    return { error: "Invalid invited email" as const };
  }

  const payload = {
    estate_id: input.estate_id,
    home_id: input.home_id,
    invited_email,
    role: input.role || "home_member",
    status: "pending" as InviteStatus,
    created_by: input.created_by,
    expires_at: input.expires_at || null,
  };

  const { data, error } = await supabaseAdmin
    .from("home_invites")
    .insert(payload)
    .select("*")
    .single();

  if (error) return { error: error.message as const };
  return { invite: data };
}

/**
 * List invites for a user (consumer side)
 * - We match by email (most reliable early on)
 */
export async function listInvitesForEmail(email: string) {
  const invited_email = cleanEmail(email);

  const { data, error } = await supabaseAdmin
    .from("home_invites")
    .select("*")
    .eq("invited_email", invited_email)
    .order("created_at", { ascending: false });

  if (error) return { error: error.message as const };
  return { invites: data || [] };
}

/**
 * Accept invite:
 * - checks pending
 * - checks expiry (if expires_at exists)
 * - creates membership in home_memberships
 * - marks invite as accepted
 */
export async function acceptInvite(args: {
  inviteId: string;
  userId: string;
  userEmail: string;
}) {
  const inviteId = args.inviteId;
  const userEmail = cleanEmail(args.userEmail);

  // 1) load invite
  const { data: invite, error: inviteErr } = await supabaseAdmin
    .from("home_invites")
    .select("*")
    .eq("id", inviteId)
    .single();

  if (inviteErr || !invite) return { error: inviteErr?.message || "Invite not found" as const };

  // 2) validate invite
  if (invite.status !== "pending") {
    return { error: "Invite is not pending" as const };
  }

  if (invite.invited_email && cleanEmail(invite.invited_email) !== userEmail) {
    return { error: "This invite was not sent to your email" as const };
  }

  if (invite.expires_at) {
    const exp = new Date(invite.expires_at).getTime();
    if (Number.isFinite(exp) && Date.now() > exp) {
      // mark expired (best effort)
      await supabaseAdmin.from("home_invites").update({ status: "expired" }).eq("id", inviteId);
      return { error: "Invite expired" as const };
    }
  }

  // 3) create membership (NO `.catch` — use {data,error})
  // NOTE: adjust column names if your schema differs.
  const membershipPayload = {
    estate_id: invite.estate_id,
    home_id: invite.home_id,
    user_id: args.userId,
    role: invite.role || "home_member",
  };

  const { error: memErr } = await supabaseAdmin
    .from("home_memberships")
    .upsert(membershipPayload, { onConflict: "home_id,user_id" });

  if (memErr) return { error: memErr.message as const };

  // 4) mark invite accepted
  const { error: updErr } = await supabaseAdmin
    .from("home_invites")
    .update({
      status: "accepted",
      accepted_by: args.userId,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", inviteId);

  if (updErr) return { error: updErr.message as const };

  return { ok: true as const };
}

/**
 * Decline invite:
 * - checks pending
 * - marks declined
 */
export async function declineInvite(args: {
  inviteId: string;
  userId: string;
  userEmail: string;
}) {
  const userEmail = cleanEmail(args.userEmail);

  const { data: invite, error: inviteErr } = await supabaseAdmin
    .from("home_invites")
    .select("*")
    .eq("id", args.inviteId)
    .single();

  if (inviteErr || !invite) return { error: inviteErr?.message || "Invite not found" as const };

  if (invite.status !== "pending") {
    return { error: "Invite is not pending" as const };
  }

  if (invite.invited_email && cleanEmail(invite.invited_email) !== userEmail) {
    return { error: "This invite was not sent to your email" as const };
  }

  const { error: updErr } = await supabaseAdmin
    .from("home_invites")
    .update({
      status: "declined",
      declined_by: args.userId,
      declined_at: new Date().toISOString(),
    })
    .eq("id", args.inviteId);

  if (updErr) return { error: updErr.message as const };

  return { ok: true as const };
}
