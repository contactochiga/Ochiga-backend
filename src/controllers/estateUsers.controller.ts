import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

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

    // Only owner/admin allowed
    if (!["owner", "admin"].includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    // Prevent removing last owner
    if (role && role !== "owner") {
      const { count } = await supabaseAdmin
        .from("estate_memberships")
        .select("*", { count: "exact", head: true })
        .eq("estate_id", req.user.estate_id)
        .eq("role", "owner")
        .eq("status", "active");

      if ((count || 0) <= 1) {
        return res.status(400).json({
          error: "Estate must have at least one owner",
        });
      }
    }

    const { data, error } = await supabaseAdmin
      .from("estate_memberships")
      .update({
        role: role || undefined,
        status: status || undefined,
      })
      .eq("id", membershipId)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

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

    if (!["owner", "admin"].includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const { error } = await supabaseAdmin
      .from("estate_memberships")
      .delete()
      .eq("id", membershipId);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ message: "User removed from estate" });
  } catch (err: any) {
    console.error("removeEstateUser error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}
