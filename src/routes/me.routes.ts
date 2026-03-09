import express from "express";
import { requireAuth } from "../middleware/auth";
import { supabaseAdmin } from "../supabase/supabaseClient";

const router = express.Router();

/**
 * GET /me/context
 * Consumer app header/sidebar context:
 * - estate: { id, name }
 * - home:   { id, block, unit, name }
 */
router.get("/context", requireAuth, async (req, res) => {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  let estate: { id: string; name: string } | null = null;
  let home:
    | { id: string; name: string | null; block: string | null; unit: string | null }
    | null = null;

  // ✅ Estate context
  if (user.estate_id) {
    const { data, error } = await supabaseAdmin
      .from("estates")
      .select("id, name")
      .eq("id", user.estate_id)
      .single();

    if (!error && data) estate = { id: data.id, name: data.name };
  }

  // ✅ Home context
  if (user.home_id) {
    const { data, error } = await supabaseAdmin
      .from("homes")
      .select("id, name, block, unit")
      .eq("id", user.home_id)
      .single();

    if (!error && data) {
      home = {
        id: data.id,
        name: data.name ?? null,
        block: data.block ?? null,
        unit: data.unit ?? null,
      };
    }
  }

  return res.json({ estate, home });
});

/**
 * PATCH /me/profile
 * Updates authenticated user profile fields.
 */
router.patch("/profile", requireAuth, async (req, res) => {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const username =
    req.body?.username == null ? undefined : String(req.body.username).trim();
  const fullName =
    req.body?.full_name == null ? undefined : String(req.body.full_name).trim();

  if (username !== undefined && username.length > 80) {
    return res.status(400).json({ error: "Username is too long" });
  }
  if (fullName !== undefined && fullName.length > 120) {
    return res.status(400).json({ error: "Full name is too long" });
  }

  const updates: Record<string, string | null> = {};
  if (username !== undefined) updates.username = username || null;
  if (fullName !== undefined) updates.full_name = fullName || null;

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: "No valid profile field provided" });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("users")
      .update(updates)
      .eq("id", user.id)
      .select("id, email, username, full_name, role, estate_id, home_id")
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      message: "Profile updated",
      user: data,
    });
  } catch (err) {
    console.error("update profile error:", err);
    return res.status(500).json({ error: "Unexpected server error" });
  }
});

/**
 * DELETE /me/account
 * Permanently deletes the authenticated user's account.
 */
router.delete("/account", requireAuth, async (req, res) => {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  try {
    // If the estate table has an owner_id column in your deployed schema, clear ownership first.
    // Ignore "column does not exist" because some environments may not have owner_id.
    const { error: ownerUnsetError } = await supabaseAdmin
      .from("estates")
      .update({ owner_id: null })
      .eq("owner_id", user.id);

    if (ownerUnsetError && !ownerUnsetError.message.includes("owner_id")) {
      return res.status(500).json({ error: ownerUnsetError.message });
    }

    const { error: deleteError } = await supabaseAdmin
      .from("users")
      .delete()
      .eq("id", user.id);

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }

    return res.json({
      message: "Account deleted successfully",
    });
  } catch (err) {
    console.error("delete account error:", err);
    return res.status(500).json({ error: "Unexpected server error" });
  }
});

export default router;
