// src/services/invitesService.ts
import { supabaseAdmin } from "../supabase/supabaseClient";

export type InviteStatus = "pending" | "accepted" | "declined" | "revoked" | "expired";

export async function findUserByEmail(email: string) {
  const clean = String(email || "").trim().toLowerCase();
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id,email,estate_id,home_id,role,full_name")
    .eq("email", clean)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data || null;
}

export async function createHomeInvite(args: {
  homeId: string;
  estateId?: string | null;
  email: string;
  role?: string;
  createdBy?: string | null;
}) {
  const cleanEmail = String(args.email || "").trim().toLowerCase();
  if (!cleanEmail.includes("@")) throw new Error("Invalid email");

  const user = await findUserByEmail(cleanEmail);

  const { data, error } = await supabaseAdmin
    .from("home_invites")
    .insert({
      home_id: args.homeId,
      estate_id: args.estateId ?? null,
      email: cleanEmail,
      invited_user_id: user?.id ?? null,
      role: args.role || "resident",
      status: "pending",
      created_by: args.createdBy ?? null,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return { invite: data, invitedUser: user };
}

export async function listMyInvites(userId: string, email: string) {
  const cleanEmail = String(email || "").trim().toLowerCase();

  const { data, error } = await supabaseAdmin
    .from("home_invites")
    .select("*")
    .eq("status", "pending")
    .or(`invited_user_id.eq.${userId},email.eq.${cleanEmail}`)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function acceptInvite(inviteId: string, userId: string, email: string) {
  const cleanEmail = String(email || "").trim().toLowerCase();

  // 1) load invite
  const { data: invite, error: invErr } = await supabaseAdmin
    .from("home_invites")
    .select("*")
    .eq("id", inviteId)
    .single();

  if (invErr || !invite) throw new Error("Invite not found");

  // 2) validate
  if (invite.status !== "pending") throw new Error(`Invite is ${invite.status}`);
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    // mark expired
    await supabaseAdmin.from("home_invites").update({ status: "expired" }).eq("id", inviteId);
    throw new Error("Invite expired");
  }

  const matchesUser =
    (invite.invited_user_id && invite.invited_user_id === userId) ||
    String(invite.email || "").toLowerCase() === cleanEmail;

  if (!matchesUser) throw new Error("This invite is not for your account");

  // 3) create membership (idempotent)
  const { error: memErr } = await supabaseAdmin
    .from("home_memberships")
    .insert({
      home_id: invite.home_id,
      user_id: userId,
      role: invite.role || "resident",
    })
    .throwOnError()
    .catch((e) => e); // ignore duplicates

  // 4) update user.home_id (optional but useful for consumer context)
  // only set if user has no home_id yet
  const { data: userRow } = await supabaseAdmin
    .from("users")
    .select("home_id")
    .eq("id", userId)
    .maybeSingle();

  if (!userRow?.home_id) {
    await supabaseAdmin.from("users").update({ home_id: invite.home_id }).eq("id", userId);
  }

  // 5) mark invite accepted
  const { data: updated, error: upErr } = await supabaseAdmin
    .from("home_invites")
    .update({ status: "accepted", responded_at: new Date().toISOString(), invited_user_id: userId })
    .eq("id", inviteId)
    .select()
    .single();

  if (upErr) throw new Error(upErr.message);

  return updated;
}

export async function declineInvite(inviteId: string, userId: string, email: string) {
  const cleanEmail = String(email || "").trim().toLowerCase();

  const { data: invite, error: invErr } = await supabaseAdmin
    .from("home_invites")
    .select("*")
    .eq("id", inviteId)
    .single();

  if (invErr || !invite) throw new Error("Invite not found");

  const matchesUser =
    (invite.invited_user_id && invite.invited_user_id === userId) ||
    String(invite.email || "").toLowerCase() === cleanEmail;

  if (!matchesUser) throw new Error("This invite is not for your account");

  if (invite.status !== "pending") throw new Error(`Invite is ${invite.status}`);

  const { data: updated, error } = await supabaseAdmin
    .from("home_invites")
    .update({ status: "declined", responded_at: new Date().toISOString(), invited_user_id: userId })
    .eq("id", inviteId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return updated;
}

export async function revokeInvite(inviteId: string, requesterId: string) {
  const { data: invite, error: invErr } = await supabaseAdmin
    .from("home_invites")
    .select("*")
    .eq("id", inviteId)
    .single();

  if (invErr || !invite) throw new Error("Invite not found");

  // allow: creator can revoke, or any estate admin endpoint can do role checks before calling
  if (invite.created_by && invite.created_by !== requesterId) {
    throw new Error("Only the inviter can revoke this invite");
  }

  if (invite.status !== "pending") throw new Error(`Invite is ${invite.status}`);

  const { data: updated, error } = await supabaseAdmin
    .from("home_invites")
    .update({ status: "revoked", responded_at: new Date().toISOString() })
    .eq("id", inviteId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return updated;
}
