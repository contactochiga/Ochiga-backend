import express from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { auditOnSuccess } from "../middleware/audit";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { initAdaptersOnce } from "../device/adapters/initAdapters";
import { adapterRegistry } from "../device/adapters/registry";
import type { AdapterContext } from "../device/adapters/types";

const router = express.Router();
const SUPPORTED_INTEGRATIONS = new Set(["tuya", "alexa", "google_assistant"]);

function cleanStr(v: any) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}

function isMissingTable(err: any, table: string) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes(String(table).toLowerCase()) &&
    (msg.includes("could not find the table") || msg.includes("relation") || msg.includes("does not exist"))
  );
}

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
    .eq("status", "active");

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

const PROFILE_SELECT = "id, email, username, full_name, phone, avatar_url, profile_image_url, role, estate_id, home_id";
const PROFILE_SELECT_FALLBACK = "id, email, username, full_name, avatar_url, profile_image_url, role, estate_id, home_id";
const PROFILE_SELECT_BASE = "id, email, username, full_name, role, estate_id, home_id";
const PROFILE_AVATAR_BUCKET = process.env.PROFILE_AVATAR_BUCKET || "profile-avatars";

function isMissingColumn(error: any, column: string) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes(column.toLowerCase()) || (msg.includes("column") && msg.includes("does not exist"));
}

async function selectUserProfile(userId: string) {
  const attempts = [PROFILE_SELECT, PROFILE_SELECT_FALLBACK, PROFILE_SELECT_BASE];
  let lastError: any = null;
  for (const select of attempts) {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select(select)
      .eq("id", userId)
      .maybeSingle();
    if (!error) return { data, error: null };
    lastError = error;
  }
  return { data: null, error: lastError };
}

async function uploadProfileAvatar(storageKey: string, buffer: Buffer, mime: string) {
  const { error } = await supabaseAdmin.storage
    .from(PROFILE_AVATAR_BUCKET)
    .upload(storageKey, buffer, { contentType: mime, upsert: false });

  if (error) throw new Error(`Profile avatar upload failed: ${error.message}`);

  const { data } = supabaseAdmin.storage.from(PROFILE_AVATAR_BUCKET).getPublicUrl(storageKey);
  if (!data?.publicUrl) throw new Error("Profile avatar public URL could not be generated");
  return data.publicUrl;
}

function avatarExtensionForMime(mime: string): string {
  const clean = String(mime || "").toLowerCase().split(";")[0].trim();
  if (clean === "image/png") return "png";
  if (clean === "image/webp") return "webp";
  if (clean === "image/gif") return "gif";
  return "jpg";
}

function sanitizeAvatarFilename(input: unknown): string {
  const name = String(input || "avatar").trim().toLowerCase();
  return name.replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 80) || "avatar";
}

function decodeAvatarBase64(input: unknown): Buffer | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const clean = raw.includes(",") ? raw.split(",").pop() || "" : raw;
  try {
    return Buffer.from(clean, "base64");
  } catch {
    return null;
  }
}

function isMissingAvatarColumn(error: any) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("avatar_url") || msg.includes("profile_image_url") || msg.includes("column");
}

async function updateUserAvatarProfile(userId: string, avatarUrl: string | null) {
  const attempts: Array<Record<string, string | null>> = [
    { avatar_url: avatarUrl, profile_image_url: avatarUrl },
    { avatar_url: avatarUrl },
    { profile_image_url: avatarUrl },
  ];

  let lastError: any = null;
  for (const updates of attempts) {
    const { data, error } = await supabaseAdmin
      .from("users")
      .update(updates)
      .eq("id", userId)
      .select(PROFILE_SELECT_FALLBACK)
      .single();

    if (!error) {
      return {
        data: {
          ...(data as any),
          avatar_url: (data as any)?.avatar_url ?? avatarUrl,
          profile_image_url: (data as any)?.profile_image_url ?? avatarUrl,
        },
        error: null,
      };
    }

    lastError = error;
    if (!isMissingAvatarColumn(error)) break;
  }

  return { data: null, error: lastError };
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

  if (integ.error && isMissingTable(integ.error, "user_integrations")) {
    return null;
  }
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

  if (integ.error && isMissingTable(integ.error, "user_integrations")) {
    return { ok: false, error: "user_integrations table is missing. Run the integration schema SQL first." };
  }
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

  if (integration.error && isMissingTable(integration.error, "user_integrations")) {
    return {
      ok: true as const,
      provider,
      connected: false,
      external_user_id: null,
      masked_external_user_id: null,
    };
  }
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

  if (integration.error && isMissingTable(integration.error, "user_integrations")) {
    return {
      ok: false as const,
      error: "user_integrations table is missing. Run the integration schema SQL first.",
    };
  }
  if (integration.error) {
    return { ok: false as const, error: integration.error.message };
  }

  return { ok: true as const, provider };
}

function discoveredExternalId(d: any): string {
  return cleanStr(d?.externalId || d?.external_id || d?.dev_id || d?.device_id || d?.id || d?.uuid);
}

function discoveredDeviceRow(d: any, user: any) {
  const external_id = discoveredExternalId(d);
  if (!external_id) return null;
  return {
    estate_id: user.estate_id,
    home_id: user.home_id || null,
    room_id: null,
    vendor: "tuya",
    external_id,
    name: cleanStr(d?.name || d?.device_name || d?.product_name) || "Device",
    type: cleanStr(d?.type || d?.category) || "device",
    status: cleanStr(d?.status) || (typeof d?.online === "boolean" ? (d.online ? "online" : "offline") : "available"),
    icon: cleanStr(d?.icon) || null,
    metadata: d?.metadata ?? d,
    updated_at: new Date().toISOString(),
  };
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

  const availableContexts = await listAvailableContexts(user.id);
  const activeContext = availableContexts.find(
    (ctx: any) =>
      String(ctx.home_id || "") === String(user.home_id || "") &&
      String(ctx.estate_id || "") === String(user.estate_id || "")
  ) as any;
  const estate = activeContext ? await getEstateContext(activeContext.estate_id) : null;
  const home = activeContext ? await getHomeContext(activeContext.home_id) : null;
  const profileResult = await selectUserProfile(user.id);
  const profile = profileResult.data || {
    id: user.id,
    email: user.email || null,
    role: user.role || null,
    estate_id: user.estate_id || null,
    home_id: user.home_id || null,
  };

  return res.json({
    estate,
    home,
    user: profile,
    profile,
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

router.post("/context/select", requireAuth, auditOnSuccess("user.context.selected", "home", "home_id"), async (req, res) => {
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

router.get("/integrations/tuya", requireAuth, requirePermission("devices.read"), async (req, res) => {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const uid = await getTuyaUidForUser(user.id);
  const masked = uid ? `${uid.slice(0, 4)}***${uid.slice(-3)}` : null;
  return res.json({ provider: "tuya", connected: !!uid, tuya_uid: uid, masked_uid: masked });
});

router.patch("/integrations/tuya", requireAuth, requirePermission("devices.control"), auditOnSuccess("settings.updated", "integration", "tuya"), async (req, res) => {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const tuya_uid = String(req.body?.tuya_uid || "").trim();
  if (!tuya_uid) return res.status(400).json({ error: "tuya_uid is required" });

  const result = await setTuyaUidForUser(user.id, tuya_uid);
  if (!result.ok) return res.status(500).json({ error: result.error || "Failed to save Tuya UID" });

  return res.json({ ok: true, provider: "tuya", connected: true, tuya_uid });
});

router.post("/integrations/tuya/sync", requireAuth, requirePermission("devices.control"), auditOnSuccess("integration.tuya.synced", "integration", "tuya"), async (req, res) => {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
  if (!user.estate_id) return res.status(400).json({ error: "User has no estate context" });

  const tuyaUid = await getTuyaUidForUser(user.id);
  if (!tuyaUid) {
    return res.status(409).json({
      ok: false,
      connected: false,
      error: "Tuya / Smart Life is not linked for this account.",
    });
  }

  try {
    initAdaptersOnce();
    const adapter = adapterRegistry.get("tuya");
    if (!adapter) return res.status(500).json({ error: "Tuya adapter not registered" });

    const context: AdapterContext = {
      estateId: user.estate_id,
      homeId: user.home_id,
      userId: user.id,
      credentials: {
        apiKey: process.env.TUYA_ACCESS_ID,
        apiSecret: process.env.TUYA_ACCESS_SECRET,
        tuyaUid,
      } as any,
    };

    const discovered = await adapter.discover(context);
    const externalIds = discovered.map(discoveredExternalId).filter(Boolean);
    const existingByExternal = new Map<string, any>();
    if (externalIds.length) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from("devices")
        .select("*")
        .eq("estate_id", user.estate_id)
        .eq("vendor", "tuya")
        .in("external_id", externalIds);
      if (existingError) return res.status(500).json({ error: existingError.message });
      for (const row of existing || []) existingByExternal.set(String((row as any).external_id), row);
    }

    const rows = discovered
      .map((device: any) => {
        const externalId = discoveredExternalId(device);
        const existing = existingByExternal.get(externalId);
        const row = discoveredDeviceRow(device, user);
        if (!row) return null;
        if (existing) {
          return {
            id: existing.id,
            estate_id: existing.estate_id,
            home_id: existing.home_id || user.home_id || null,
            room_id: existing.room_id || null,
            vendor: "tuya",
            external_id: externalId,
            name: row.name || existing.name,
            type: row.type || existing.type,
            status: row.status || existing.status,
            icon: row.icon || existing.icon || null,
            metadata: { ...(existing.metadata || {}), ...(row.metadata || {}) },
            updated_at: row.updated_at,
          };
        }
        return row;
      })
      .filter(Boolean);

    if (!rows.length) return res.json({ ok: true, provider: "tuya", discovered: 0, updated: 0, created: 0, devices: [] });

    const { data, error } = await supabaseAdmin
      .from("devices")
      .upsert(rows as any[], { onConflict: "vendor,external_id" })
      .select("*");
    if (error) return res.status(500).json({ error: error.message });

    const created = (data || []).filter((row: any) => !existingByExternal.has(String(row.external_id))).length;
    return res.json({
      ok: true,
      provider: "tuya",
      discovered: discovered.length,
      updated: (data || []).length - created,
      created,
      devices: data || [],
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Tuya sync failed" });
  }
});

router.get("/integrations/:provider", requireAuth, requirePermission("devices.read"), async (req, res) => {
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

router.patch("/integrations/:provider", requireAuth, requirePermission("devices.control"), auditOnSuccess("settings.updated", "integration", "provider"), async (req, res) => {
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
router.patch("/profile", requireAuth, auditOnSuccess("user.updated", "user", "id"), async (req, res) => {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const username =
    req.body?.username == null ? undefined : String(req.body.username).trim();
  const fullName =
    req.body?.full_name == null ? undefined : String(req.body.full_name).trim();
  const phone =
    req.body?.phone == null ? undefined : String(req.body.phone).trim();

  if (username !== undefined && username.length > 80) {
    return res.status(400).json({ error: "Username is too long" });
  }
  if (fullName !== undefined && fullName.length > 120) {
    return res.status(400).json({ error: "Full name is too long" });
  }
  if (phone !== undefined && phone.length > 40) {
    return res.status(400).json({ error: "Phone number is too long" });
  }

  const updates: Record<string, string | null> = {};
  if (username !== undefined) updates.username = username || null;
  if (fullName !== undefined) updates.full_name = fullName || null;
  if (phone !== undefined) updates.phone = phone || null;

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: "No valid profile field provided" });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("users")
      .update(updates)
      .eq("id", user.id)
      .select(PROFILE_SELECT_FALLBACK)
      .single();

    if (error) {
      if (phone !== undefined && isMissingColumn(error, "phone")) {
        return res.status(501).json({
          error: "Profile phone support is not configured yet",
          required_migration: "users.phone",
        });
      }
      return res.status(500).json({ error: error.message });
    }

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
 * POST /me/profile/avatar
 * Uploads authenticated user's profile image and stores the public image URL on the user profile.
 */
router.post("/profile/avatar", requireAuth, auditOnSuccess("user.avatar.updated", "user", "id"), async (req, res) => {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  const mime = String(req.body?.mime || "").toLowerCase().split(";")[0].trim();
  if (!mime || !mime.startsWith("image/")) {
    return res.status(400).json({ error: "A valid image mime type is required" });
  }
  if (!["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"].includes(mime)) {
    return res.status(400).json({ error: "Unsupported image type" });
  }

  const buffer = decodeAvatarBase64(req.body?.base64);
  if (!buffer || buffer.length === 0) {
    return res.status(400).json({ error: "Avatar image data is required" });
  }
  if (buffer.length > 6 * 1024 * 1024) {
    return res.status(413).json({ error: "Avatar image must be 6MB or smaller" });
  }

  try {
    const extension = avatarExtensionForMime(mime);
    const safeName = sanitizeAvatarFilename(req.body?.filename).replace(/\.[a-z0-9]+$/i, "");
    const storageKey = `avatars/${user.id}/${Date.now()}-${safeName}.${extension}`;
    const avatarUrl = await uploadProfileAvatar(storageKey, buffer, mime);
    const { data, error } = await updateUserAvatarProfile(user.id, avatarUrl);

    if (error) {
      return res.status(500).json({
        error: "Profile avatar storage is configured, but the user profile avatar column is missing or unavailable",
        detail: error.message,
        required_columns: ["users.avatar_url", "users.profile_image_url"],
      });
    }

    return res.json({
      ok: true,
      message: "Profile image updated",
      avatar_url: avatarUrl,
      profile_image_url: avatarUrl,
      user: data,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to upload profile image" });
  }
});

/**
 * DELETE /me/profile/avatar
 * Removes authenticated user's profile image URL from the user profile.
 */
router.delete("/profile/avatar", requireAuth, auditOnSuccess("user.avatar.removed", "user", "id"), async (req, res) => {
  const user = req.user;
  if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

  try {
    const { data, error } = await updateUserAvatarProfile(user.id, null);
    if (error) {
      return res.status(500).json({
        error: "Profile avatar columns are missing or unavailable",
        detail: error.message,
        required_columns: ["users.avatar_url", "users.profile_image_url"],
      });
    }

    return res.json({
      ok: true,
      message: "Profile image removed",
      avatar_url: null,
      profile_image_url: null,
      user: data,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to remove profile image" });
  }
});

/**
 * DELETE /me/account
 * Permanently deletes the authenticated user's account.
 */
router.delete("/account", requireAuth, auditOnSuccess("user.deleted", "user", "id"), async (req, res) => {
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
