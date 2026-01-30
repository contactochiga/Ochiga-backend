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

export default router;
