import express from "express";
import { requireAuth } from "../middleware/auth";
import { supabaseAdmin } from "../supabase/supabaseClient";

const router = express.Router();

async function getTuyaUidForUser(userId: string): Promise<string | null> {
  // 1) preferred: users.tuya_uid
  const direct = await supabaseAdmin
    .from("users")
    .select("tuya_uid")
    .eq("id", userId)
    .maybeSingle();

  if (!direct.error) {
    const uid = String((direct.data as any)?.tuya_uid || "").trim();
    if (uid) return uid;
  }

  // 2) fallback: user_integrations(provider='tuya')
  const integ = await supabaseAdmin
    .from("user_integrations")
    .select("external_user_id")
    .eq("user_id", userId)
    .eq("provider", "tuya")
    .maybeSingle();

  if (!integ.error) {
    const uid = String((integ.data as any)?.external_user_id || "").trim();
    if (uid) return uid;
  }

  return null;
}

async function setTuyaUidForUser(userId: string, tuyaUid: string): Promise<{ ok: boolean; error?: string }> {
  // 1) preferred: users.tuya_uid
  const direct = await supabaseAdmin
    .from("users")
    .update({ tuya_uid: tuyaUid, updated_at: new Date().toISOString() } as any)
    .eq("id", userId);

  if (!direct.error) return { ok: true };

  // 2) fallback: user_integrations
  const integ = await supabaseAdmin
    .from("user_integrations")
    .upsert(
      {
        user_id: userId,
        provider: "tuya",
        external_user_id: tuyaUid,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" }
    );

  if (!integ.error) return { ok: true };
  return { ok: false, error: integ.error.message || direct.error.message };
}

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
    | {
        id: string;
        name: string | null;
        block: string | null;
        unit: string | null;
        electricity_meter: string | null;
        water_meter: string | null;
        internet_id: string | null;
        gate_code: string | null;
      }
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
      .select("id, name, block, unit, electricity_meter, water_meter, internet_id, gate_code")
      .eq("id", user.home_id)
      .single();

    if (!error && data) {
      home = {
        id: data.id,
        name: data.name ?? null,
        block: data.block ?? null,
        unit: data.unit ?? null,
        electricity_meter: data.electricity_meter ?? null,
        water_meter: data.water_meter ?? null,
        internet_id: data.internet_id ?? null,
        gate_code: data.gate_code ?? null,
      };
    }
  }

  return res.json({
    estate,
    home,
    estate_id: estate?.id || null,
    home_id: home?.id || null,
  });
});

router.get("/integrations/tuya", requireAuth, async (req, res) => {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const uid = await getTuyaUidForUser(user.id);
  const masked = uid ? `${uid.slice(0, 4)}***${uid.slice(-3)}` : null;
  return res.json({ provider: "tuya", connected: !!uid, tuya_uid: uid, masked_uid: masked });
});

router.patch("/integrations/tuya", requireAuth, async (req, res) => {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const tuya_uid = String(req.body?.tuya_uid || "").trim();
  if (!tuya_uid) return res.status(400).json({ error: "tuya_uid is required" });

  const result = await setTuyaUidForUser(user.id, tuya_uid);
  if (!result.ok) return res.status(500).json({ error: result.error || "Failed to save Tuya UID" });

  return res.json({ ok: true, provider: "tuya", connected: true, tuya_uid });
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
