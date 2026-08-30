// Phase 2 commercial-hardening: estate team-invite-by-role. Lets an
// already-authorized estate_admin/facility_manager invite a NEW person into
// their OWN estate with a specific operational role (security_operator,
// maintenance_operator, finance_operator, facility_manager, or another
// estate_admin) -- distinct from the resident/home invite flow and from
// Phase 1's Office-only estate-OWNER invite flow.
//
// Deliberately reuses, not duplicates: the SAME `invites` table shape and
// the SAME validate_estate_owner_invite/activate_estate_owner_invite RPC
// pair Phase 1 already built (an estate-scoped invite is just an `invites`
// row with home_id null; those RPCs already handle an arbitrary role via
// estate_membership_role_to_platform_role()) -- this file only adds the
// missing piece: an authenticated endpoint for an existing estate admin to
// CREATE such an invite, list pending ones, resend, and revoke.
import { Request, Response } from "express";
import crypto from "crypto";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { emitAuditEvent } from "../core/foundation";
import { canGrantMembershipRole, isValidMembershipRole } from "../services/estateMembershipRoles";
import { sendEmail } from "../services/emailService";
import { hashInviteToken as hashToken, rotateEstateInviteToken, revokeEstateInviteById } from "../services/estateInviteMutationService";

const INVITE_EXPIRY_DAYS = 14;

function facilityInviteUrl(rawToken: string) {
  const base = process.env.FACILITY_APP_BASE || process.env.VISITOR_LINK_BASE || "https://facility.oyi.com";
  return `${String(base).replace(/\/+$/, "")}/facility-invite?token=${rawToken}`;
}

function escapeHtml(value?: string | null) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// sendEmail()/sendWithResend() THROWS on any failure (missing API key,
// provider error) and, on success, resolves to the raw Resend SDK response
// (which has no "delivered" field at all) -- delivery outcome can only be
// determined by whether the call threw, exactly the pattern
// deliverResidentInvite() in homeUsers.controller.ts already established.
async function sendEstateTeamInviteEmail(input: { to: string; estateName: string; role: string; inviteUrl: string; expiresAt: string }): Promise<{ delivered: boolean; reason?: string }> {
  const estateName = escapeHtml(input.estateName || "your Facility");
  const role = escapeHtml(input.role);
  const expiry = new Date(input.expiresAt).toUTCString();
  try {
    await sendEmail({
      to: input.to,
      subject: `You've been invited to join ${input.estateName || "a Facility"} on Oyi`,
      html: `<div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:620px;margin:auto;"><h1 style="margin:0 0 12px;font-size:24px;">Join ${estateName} on Oyi Facility</h1><p>You've been invited as <strong>${role}</strong>.</p><p><a href="${input.inviteUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#0284c7;color:#fff;text-decoration:none;font-weight:700;">Accept invitation</a></p><p style="font-size:12px;color:#64748b;">This link expires ${expiry}.</p></div>`,
      text: `You've been invited to join ${input.estateName || "a Facility"} on Oyi as ${input.role}. Accept: ${input.inviteUrl} (expires ${expiry})`,
    });
    return { delivered: true };
  } catch (error: any) {
    return { delivered: false, reason: error?.message || "email_send_failed" };
  }
}

/**
 * GET /facility/estate-invites
 * List pending (and recently resolved) invites for the caller's own estate.
 */
export async function listEstateInvites(req: any, res: Response) {
  try {
    const estateId = req.user?.estate_id;
    if (!estateId) return res.status(400).json({ error: "User has no estate" });

    const { data, error } = await supabaseAdmin
      .from("invites")
      .select("id, invited_email, role, status, expires_at, created_at, claimed_at, revoked_at, last_sent_at, created_by")
      .eq("estate_id", estateId)
      .is("home_id", null)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ estate_id: estateId, invites: data || [] });
  } catch (err: any) {
    console.error("listEstateInvites error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}

/**
 * POST /facility/estate-invites
 * Body: { email, role }
 */
export async function createEstateInvite(req: any, res: Response) {
  try {
    const estateId = req.user?.estate_id;
    if (!estateId) return res.status(400).json({ error: "User has no estate" });

    const email = String(req.body?.email || "").trim().toLowerCase();
    const role = String(req.body?.role || "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "A valid email is required" });
    }
    if (!isValidMembershipRole(role)) {
      return res.status(400).json({ error: "Unknown role" });
    }
    if (!canGrantMembershipRole(req.user.role, role)) {
      return res.status(403).json({ error: "You are not authorized to grant that role" });
    }

    // Refuse to invite someone who's already an active member of this
    // estate -- avoids a confusing duplicate-invite/role-mismatch state.
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existingUser?.id) {
      const { data: existingMembership } = await supabaseAdmin
        .from("estate_memberships")
        .select("id, status")
        .eq("estate_id", estateId)
        .eq("user_id", existingUser.id)
        .maybeSingle();
      if (existingMembership && existingMembership.status === "active") {
        return res.status(409).json({ error: "This person is already a member of your estate." });
      }
    }

    // Supersede any still-pending invite for the same email in this estate
    // rather than allowing two live invites to coexist.
    await supabaseAdmin
      .from("invites")
      .update({ status: "revoked", revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("estate_id", estateId)
      .is("home_id", null)
      .eq("invited_email", email)
      .eq("status", "pending");

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from("invites")
      .insert({
        estate_id: estateId,
        home_id: null,
        room_id: null,
        role,
        invite_type: "email",
        token_hash: tokenHash,
        invited_email: email,
        status: "pending",
        expires_at: expiresAt,
        created_by: req.user.id,
        last_sent_at: new Date().toISOString(),
      })
      .select("id, invited_email, role, status, expires_at, created_at")
      .single();

    if (inviteErr) return res.status(500).json({ error: inviteErr.message });

    const { data: estate } = await supabaseAdmin.from("estates").select("name").eq("id", estateId).maybeSingle();
    const inviteUrl = facilityInviteUrl(rawToken);
    const emailResult = await sendEstateTeamInviteEmail({
      to: email,
      estateName: estate?.name || "",
      role,
      inviteUrl,
      expiresAt,
    });

    void emitAuditEvent({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "team.member.invited",
      resourceType: "invite",
      resourceId: invite.id,
      estateId,
      status: "success",
      metadata: { invited_email: email, role, email_delivered: emailResult.delivered },
      req,
    } as any);

    return res.status(201).json({
      invite,
      email_delivered: emailResult.delivered,
      // Only ever returned once, to the inviter, so the link can be shared
      // manually if email delivery isn't configured/fails -- same pattern
      // as Office's own staff-invite flow.
      invite_url: emailResult.delivered ? undefined : inviteUrl,
    });
  } catch (err: any) {
    console.error("createEstateInvite error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}

async function loadOwnEstateInvite(req: any, res: Response, inviteId: string) {
  const estateId = req.user?.estate_id;
  if (!estateId) {
    res.status(400).json({ error: "User has no estate" });
    return null;
  }
  const { data, error } = await supabaseAdmin
    .from("invites")
    .select("id, estate_id, invited_email, role, status, expires_at")
    .eq("id", inviteId)
    .is("home_id", null)
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return null;
  }
  if (!data || data.estate_id !== estateId) {
    res.status(404).json({ error: "Invite not found" });
    return null;
  }
  return data;
}

/**
 * POST /facility/estate-invites/:inviteId/revoke
 */
export async function revokeEstateInvite(req: any, res: Response) {
  try {
    const invite = await loadOwnEstateInvite(req, res, req.params.inviteId);
    if (!invite) return;
    if (invite.status !== "pending") {
      return res.status(400).json({ error: "Only a pending invite can be revoked" });
    }
    const revoked = await revokeEstateInviteById(invite.id, req.user.id);
    if (!revoked.ok) return res.status(500).json({ error: revoked.error });

    void emitAuditEvent({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "team.member.invite_revoked",
      resourceType: "invite",
      resourceId: invite.id,
      estateId: req.user.estate_id,
      status: "success",
      metadata: { invited_email: invite.invited_email },
      req,
    } as any);

    return res.json({ message: "Invite revoked" });
  } catch (err: any) {
    console.error("revokeEstateInvite error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}

/**
 * POST /facility/estate-invites/:inviteId/resend
 */
export async function resendEstateInvite(req: any, res: Response) {
  try {
    const invite = await loadOwnEstateInvite(req, res, req.params.inviteId);
    if (!invite) return;
    if (invite.status !== "pending") {
      return res.status(400).json({ error: "Only a pending invite can be resent" });
    }

    // Rotate the token on resend -- the previous link stops working, which
    // is the correct behavior if it was sent to the wrong place or leaked.
    const rotated = await rotateEstateInviteToken(invite.id);
    if (!rotated.ok) return res.status(500).json({ error: rotated.error });
    const { rawToken, expiresAt } = rotated;

    const { data: estate } = await supabaseAdmin.from("estates").select("name").eq("id", req.user.estate_id).maybeSingle();
    const inviteUrl = facilityInviteUrl(rawToken);
    const emailResult = await sendEstateTeamInviteEmail({
      to: invite.invited_email,
      estateName: estate?.name || "",
      role: invite.role,
      inviteUrl,
      expiresAt,
    });

    void emitAuditEvent({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "team.member.invite_resent",
      resourceType: "invite",
      resourceId: invite.id,
      estateId: req.user.estate_id,
      status: "success",
      metadata: { invited_email: invite.invited_email, email_delivered: emailResult.delivered },
      req,
    } as any);

    return res.json({
      message: "Invite resent",
      email_delivered: emailResult.delivered,
      invite_url: emailResult.delivered ? undefined : inviteUrl,
    });
  } catch (err: any) {
    console.error("resendEstateInvite error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}
