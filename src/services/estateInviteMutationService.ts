// Office->Facility provisioning lifecycle. The actual token-rotation/
// revocation SQL, extracted out of estateInvites.controller.ts so it has
// exactly one implementation shared by two authorization contexts: an
// already-authenticated Facility estate_admin managing their own team
// invites (estateInvites.controller.ts, unchanged), and Office managing
// the pending owner invite it just issued via /office/facility/provision
// (officeExport.ts, new). Neither caller duplicates this SQL.
import crypto from "crypto";
import { supabaseAdmin } from "../supabase/supabaseClient";

const INVITE_EXPIRY_DAYS = 14;

export function hashInviteToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function rotateEstateInviteToken(inviteId: string): Promise<{ ok: true; rawToken: string; expiresAt: string } | { ok: false; error: string }> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashInviteToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabaseAdmin
    .from("invites")
    .update({ token_hash: tokenHash, expires_at: expiresAt, last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", inviteId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, rawToken, expiresAt };
}

export async function revokeEstateInviteById(inviteId: string, revokedBy: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabaseAdmin
    .from("invites")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: revokedBy, updated_at: new Date().toISOString() })
    .eq("id", inviteId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// The single pending owner invite for an estate -- by construction there is
// at most one (provisioning creates exactly one, and nothing else creates a
// role="owner", home_id=null invite for a brand-new estate with zero
// members). Ordered/limited defensively in case that invariant is ever
// violated, rather than erroring.
export async function findPendingOwnerInvite(estateId: string) {
  const { data, error } = await supabaseAdmin
    .from("invites")
    .select("id, estate_id, invited_email, role, status, expires_at")
    .eq("estate_id", estateId)
    .is("home_id", null)
    .eq("role", "owner")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "no_pending_owner_invite" };
  return { ok: true as const, invite: data };
}
