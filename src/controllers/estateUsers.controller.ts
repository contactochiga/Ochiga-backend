import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { emitAuditEvent } from "../core/foundation";
import {
  canGrantMembershipRole,
  canManageTargetRole,
  isValidMembershipRole,
  rankOfMembershipRole,
} from "../services/estateMembershipRoles";

/**
 * GET /facility/estate-users
 * List all users + roles in current estate
 */
export async function listEstateUsers(req: any, res: Response) {
  try {
    const estateId = req.user?.estate_id;
    if (!estateId) {
      return res.status(400).json({ error: "User has no estate" });
    }

    const { data, error } = await supabaseAdmin
      .from("estate_memberships")
      .select(`
        id,
        role,
        status,
        created_at,
        users (
          id,
          email,
          full_name,
          username,
          role
        )
      `)
      .eq("estate_id", estateId)
      .order("created_at", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      estate_id: estateId,
      users: data || [],
    });
  } catch (err: any) {
    console.error("listEstateUsers error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}

// Loads the target membership AND verifies it belongs to the caller's own
// estate -- Phase 2 finding: neither mutation endpoint previously checked
// this, so a membership row's UUID alone (no tenant check at all) was
// sufficient to update/remove ANY estate's membership, a real cross-tenant
// bug. Returns null (and has already responded) if the check fails.
async function loadOwnEstateMembership(req: any, res: Response, membershipId: string) {
  const estateId = req.user?.estate_id;
  if (!estateId) {
    res.status(400).json({ error: "User has no estate" });
    return null;
  }
  const { data, error } = await supabaseAdmin
    .from("estate_memberships")
    .select("id, estate_id, user_id, role, status")
    .eq("id", membershipId)
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return null;
  }
  if (!data || data.estate_id !== estateId) {
    // 404, not 403 -- never confirm to the caller that a membership ID
    // exists in a DIFFERENT tenant.
    res.status(404).json({ error: "Membership not found" });
    return null;
  }
  return data as { id: string; estate_id: string; user_id: string; role: string; status: string };
}

/**
 * PATCH /facility/estate-users/:membershipId
 * Change role or status
 */
export async function updateEstateUser(req: any, res: Response) {
  try {
    const { membershipId } = req.params;
    const { role, status } = req.body;

    if (!role && !status) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const membership = await loadOwnEstateMembership(req, res, membershipId);
    if (!membership) return;

    // Self-mutation is never allowed through this admin endpoint --
    // prevents self-promotion and gaming the last-owner check by
    // demoting/removing oneself. Leaving a team is a separate, explicit
    // action, not implemented here.
    if (membership.user_id === req.user.id) {
      return res.status(403).json({ error: "You cannot change your own membership here." });
    }

    // Actor may not manage a member ranked above them, and may not grant a
    // role ranked above their own -- e.g. a facility_manager must not alter
    // an estate_admin, and must not promote anyone to estate_admin.
    if (!canManageTargetRole(req.user.role, membership.role)) {
      return res.status(403).json({ error: "You are not authorized to manage this team member." });
    }
    if (role) {
      if (!isValidMembershipRole(role)) {
        return res.status(400).json({ error: "Unknown role." });
      }
      if (!canGrantMembershipRole(req.user.role, role)) {
        return res.status(403).json({ error: "You are not authorized to grant that role." });
      }
    }

    // Prevent demoting the last owner-tier member.
    if (role && rankOfMembershipRole(role) < rankOfMembershipRole(membership.role) && rankOfMembershipRole(membership.role) >= 100) {
      const { count } = await supabaseAdmin
        .from("estate_memberships")
        .select("*", { count: "exact", head: true })
        .eq("estate_id", req.user.estate_id)
        .in("role", ["owner", "estate_admin"])
        .eq("status", "active");

      if ((count || 0) <= 1) {
        return res.status(400).json({
          error: "Estate must have at least one owner/administrator",
        });
      }
    }

    const { data, error } = await supabaseAdmin
      .from("estate_memberships")
      .update({
        role: role || undefined,
        status: status || undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", membershipId)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    void emitAuditEvent({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "team.member.updated",
      resourceType: "estate_membership",
      resourceId: membershipId,
      estateId: req.user.estate_id,
      status: "success",
      metadata: { previous_role: membership.role, new_role: role || membership.role, new_status: status || membership.status },
      req,
    } as any);

    return res.json({
      message: "Estate user updated",
      membership: data,
    });
  } catch (err: any) {
    console.error("updateEstateUser error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}

/**
 * DELETE /facility/estate-users/:membershipId
 * Remove user from estate
 */
export async function removeEstateUser(req: any, res: Response) {
  try {
    const { membershipId } = req.params;

    const membership = await loadOwnEstateMembership(req, res, membershipId);
    if (!membership) return;

    if (membership.user_id === req.user.id) {
      return res.status(403).json({ error: "You cannot remove your own membership here." });
    }
    if (!canManageTargetRole(req.user.role, membership.role)) {
      return res.status(403).json({ error: "You are not authorized to remove this team member." });
    }

    // FIX (Phase 2): the PATCH path had last-owner protection; DELETE had
    // none at all -- an estate could previously be deleted down to zero
    // active owners outright via this route.
    if (rankOfMembershipRole(membership.role) >= 100 && membership.status === "active") {
      const { count } = await supabaseAdmin
        .from("estate_memberships")
        .select("*", { count: "exact", head: true })
        .eq("estate_id", req.user.estate_id)
        .in("role", ["owner", "estate_admin"])
        .eq("status", "active");

      if ((count || 0) <= 1) {
        return res.status(400).json({
          error: "Estate must have at least one owner/administrator",
        });
      }
    }

    const { error } = await supabaseAdmin
      .from("estate_memberships")
      .delete()
      .eq("id", membershipId);

    if (error) return res.status(500).json({ error: error.message });

    void emitAuditEvent({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "team.member.removed",
      resourceType: "estate_membership",
      resourceId: membershipId,
      estateId: req.user.estate_id,
      status: "success",
      metadata: { removed_user_id: membership.user_id, removed_role: membership.role },
      req,
    } as any);

    return res.json({ message: "User removed from estate" });
  } catch (err: any) {
    console.error("removeEstateUser error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}
