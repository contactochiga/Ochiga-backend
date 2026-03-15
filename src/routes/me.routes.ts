import express from "express";
import { requireAuth } from "../middleware/auth";
import { supabaseAdmin } from "../supabase/supabaseClient";

const router = express.Router();
const SUPPORTED_INTEGRATIONS = new Set(["tuya", "alexa", "google_assistant"]);

type ContextHomeSummary = {
  id: string;
  name: string | null;
  block: string | null;
  unit: string | null;
  electricity_meter: string | null;
  water_meter: string | null;
  internet_id: string | null;
  gate_code: string | null;
};

async function getHomeContext(homeId?: string | null): Promise<ContextHomeSummary | null> {
  const clean = String(homeId || "").trim();
  if (!clean) return null;

  const { data, error } = await supabaseAdmin
    .from("homes")
    .select("id, name, block, unit, electricity_meter, water_meter, internet_id, gate_code")
    .eq("id", clean)
    .maybeSingle();

  if (error || !data) return null;
  return {
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

async function getEstateContext(estateId?: string | null): Promise<{ id: string; name: string } | null> {
  const clean = String(estateId || "").trim();
  if (!clean) return null;

  const { data, error } = await supabaseAdmin
    .from("estates")
    .select("id, name")
    .eq("id", clean)
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id, name: data.name };
}

async function listAvailableContexts(userId: string) {
  const { data: memberships, error } = await supabaseAdmin
    .from("home_memberships")
    .select("home_id, role, status, homes(id, estate_id, name, block, unit, electricity_meter, water_meter, internet_id, gate_code)")
    .eq("user_id", userId)
    .in("status", ["active", "invited"]);

  if (error) throw new Error(error.message);

  const rows = Array.isArray(memberships) ? memberships : [];
  const estateIds = Array.from(
    new Set(
      rows
        .map((row: any) => String(row?.homes?.estate_id || "").trim())
        .filter(Boolean)
    )
  );

  const estateMap = new Map<string, { id: string; name: string }>();
  if (estateIds.length) {
    const { data: estates } = await supabaseAdmin.from("estates").select("id, name").in("id", estateIds);
    for (const estate of estates || []) {
      estateMap.set(String((estate as any).id), { id: String((estate as any).id), name: String((estate as any).name || "Estate") });
    }
  }

  return rows
    .map((row: any) => {
      const home = row?.homes;
      const homeId = String(home?.id || row?.home_id || "").trim();
      const estateId = String(home?.estate_id || "").trim();
      if (!homeId || !estateId) return null;
      return {
        estate_id: estateId,
        estate_name: estateMap.get(estateId)?.name || "Estate",
        home_id: homeId,
        home_name: home?.name ?? null,
        block: home?.block ?? null,
        unit: home?.unit ?? null,
        electricity_meter: home?.electricity_meter ?? null,
        water_meter: home?.water_meter ?? null,
        internet_id: home?.internet_id ?? null,
        gate_code: home?.gate_code ?? null,
        role: String(row?.role || ""),
        status: String(row?.status || ""),
      };
    })
    .filter(Boolean);
}

function normalizeIntegrationProvider(input: unknown): string {
  const value = String(input || "").trim().toLowerCase();
  if (value === "google" || value === "google-assistant") return "google_assistant";
  return value;
}

function maskExternalId(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 7) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}***${value.slice(-3)}`;
}

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

async function getStoredIntegration(userId: string, providerInput: string) {
  const provider = normalizeIntegrationProvider(providerInput);
  if (!SUPPORTED_INTEGRATIONS.has(provider)) {
    return { ok: false as const, error: "Unsupported integration provider" };
  }

  if (provider === "tuya") {
    const externalUserId = await getTuyaUidForUser(userId);
    return {
      ok: true as const,
      provider,
      connected: !!externalUserId,
      external_user_id: externalUserId,
      masked_external_user_id: maskExternalId(externalUserId),
    };
  }

  const integration = await supabaseAdmin
    .from("user_integrations")
    .select("external_user_id")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (integration.error) {
    return { ok: false as const, error: integration.error.message };
  }

  const externalUserId = String((integration.data as any)?.external_user_id || "").trim() || null;
  return {
    ok: true as const,
    provider,
    connected: !!externalUserId,
    external_user_id: externalUserId,
    masked_external_user_id: maskExternalId(externalUserId),
  };
}

async function setStoredIntegration(userId: string, providerInput: string, externalUserId: string) {
  const provider = normalizeIntegrationProvider(providerInput);
  if (!SUPPORTED_INTEGRATIONS.has(provider)) {
    return { ok: false as const, error: "Unsupported integration provider" };
  }

  if (provider === "tuya") {
    const result = await setTuyaUidForUser(userId, externalUserId);
    return result.ok
      ? { ok: true as const, provider }
      : { ok: false as const, error: result.error || "Failed to save Tuya UID" };
  }

  const integration = await supabaseAdmin
    .from("user_integrations")
    .upsert(
      {
        user_id: userId,
        provider,
        external_user_id: externalUserId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" }
    );

  if (integration.error) {
    return { ok: false as const, error: integration.error.message };
  }

  return { ok: true as const, provider };
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

  const estate = await getEstateContext(user.estate_id);
  const home = await getHomeContext(user.home_id);
  const availableContexts = await listAvailableContexts(user.id);

  return res.json({
    estate,
    home,
    estate_id: estate?.id || null,
    home_id: home?.id || null,
    available_contexts: availableContexts,
  });
});

router.get("/contexts", requireAuth, async (req, res) => {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  try {
    const contexts = await listAvailableContexts(user.id);
    return res.json({
      ok: true,
      contexts: contexts.map((ctx: any) => ({
        ...ctx,
        is_active:
          String(ctx.estate_id) === String(user.estate_id || "") &&
          String(ctx.home_id) === String(user.home_id || ""),
      })),
      active: {
        estate_id: user.estate_id || null,
        home_id: user.home_id || null,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to load contexts" });
  }
});

router.post("/context/select", requireAuth, async (req, res) => {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const homeId = String(req.body?.home_id || "").trim();
  if (!homeId) return res.status(400).json({ error: "home_id is required" });

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from("home_memberships")
    .select("home_id, status, homes(id, estate_id)")
    .eq("user_id", user.id)
    .eq("home_id", homeId)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError) return res.status(500).json({ error: membershipError.message });
  const selectedHome = Array.isArray((membership as any)?.homes)
    ? (membership as any)?.homes?.[0] || null
    : ((membership as any)?.homes || null);
  if (!selectedHome?.id) return res.status(404).json({ error: "Active home membership not found" });

  const nextEstateId = String(selectedHome?.estate_id || "").trim();
  if (!nextEstateId) return res.status(400).json({ error: "Selected home has no estate context" });

  const { error: updateError } = await supabaseAdmin
    .from("users")
    .update({
      estate_id: nextEstateId,
      home_id: homeId,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", user.id);

  if (updateError) return res.status(500).json({ error: updateError.message });

  const estate = await getEstateContext(nextEstateId);
  const home = await getHomeContext(homeId);

  return res.json({
    ok: true,
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

router.get("/integrations/:provider", requireAuth, async (req, res) => {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const provider = normalizeIntegrationProvider(req.params.provider);
  const result = await getStoredIntegration(user.id, provider);
  if (!result.ok) return res.status(400).json({ error: result.error });

  if (provider === "tuya") {
    return res.json({
      provider,
      connected: result.connected,
      tuya_uid: result.external_user_id,
      masked_uid: result.masked_external_user_id,
    });
  }

  return res.json({
    provider,
    connected: result.connected,
    external_user_id: result.external_user_id,
    masked_external_user_id: result.masked_external_user_id,
  });
});

router.patch("/integrations/:provider", requireAuth, async (req, res) => {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const provider = normalizeIntegrationProvider(req.params.provider);
  const externalUserId = String(
    req.body?.external_user_id ??
      req.body?.account_id ??
      req.body?.assistant_user_id ??
      ""
  ).trim();

  if (!externalUserId) {
    return res.status(400).json({ error: "external_user_id is required" });
  }

  const result = await setStoredIntegration(user.id, provider, externalUserId);
  if (!result.ok) return res.status(400).json({ error: result.error });

  return res.json({
    ok: true,
    provider,
    connected: true,
    external_user_id: externalUserId,
    masked_external_user_id: maskExternalId(externalUserId),
  });
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
