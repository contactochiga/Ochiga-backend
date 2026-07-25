import { supabaseAdmin } from "../supabase/supabaseClient";

type ActorLike = {
  id: string;
  estate_id?: string | null;
  home_id?: string | null;
};

function clean(value: any) {
  return String(value ?? "").trim();
}

function mask(value: string | null) {
  if (!value) return null;
  if (value.length <= 7) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}***${value.slice(-3)}`;
}

async function activeMembership(userId: string, homeId: string) {
  const { data, error } = await supabaseAdmin
    .from("home_memberships")
    .select("id, home_id, status, homes(id, estate_id, building_id)")
    .eq("user_id", userId)
    .eq("home_id", homeId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  const home = Array.isArray((data as any)?.homes) ? (data as any).homes[0] : (data as any)?.homes;
  if (!data?.id || !home?.id) return null;
  return {
    id: String(data.id),
    home_id: String(home.id),
    estate_id: String(home.estate_id || ""),
    building_id: clean(home.building_id) || null,
  };
}

export async function getLegacyProviderAccountId(userId: string, provider = "tuya") {
  if (provider === "tuya") {
    const direct = await supabaseAdmin.from("users").select("tuya_uid").eq("id", userId).maybeSingle();
    if (!direct.error) {
      const uid = clean((direct.data as any)?.tuya_uid);
      if (uid) return uid;
    }
  }

  const integration = await supabaseAdmin
    .from("user_integrations")
    .select("external_user_id")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (!integration.error) {
    const uid = clean((integration.data as any)?.external_user_id);
    if (uid) return uid;
  }
  return null;
}

export async function getHomeProviderConnection(actor: ActorLike, provider = "tuya") {
  const userId = clean(actor?.id);
  const homeId = clean(actor?.home_id);
  if (!userId || !homeId) return null;

  const { data, error } = await supabaseAdmin
    .from("provider_connections")
    .select("*")
    .eq("owner_user_id", userId)
    .eq("home_id", homeId)
    .eq("provider", provider)
    .is("disconnected_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data?.id) return data as any;

  const legacyAccountId = await getLegacyProviderAccountId(userId, provider);
  if (!legacyAccountId) return null;
  return upsertHomeProviderConnection(actor, provider, legacyAccountId, { source: "legacy_lazy_hydration" });
}

export async function upsertHomeProviderConnection(
  actor: ActorLike,
  provider: string,
  providerAccountId: string,
  metadata: Record<string, any> = {},
) {
  const userId = clean(actor?.id);
  const homeId = clean(actor?.home_id);
  const accountId = clean(providerAccountId);
  if (!userId) throw new Error("Not authenticated");
  if (!homeId) throw new Error("Active home context required");
  if (!accountId) throw new Error("Provider account ID is required");

  const membership = await activeMembership(userId, homeId);
  if (!membership?.id) throw new Error("Active home membership not found");
  if (actor.estate_id && clean(actor.estate_id) !== membership.estate_id) {
    throw new Error("Provider connection is outside the selected estate");
  }

  const payload = {
    provider,
    provider_account_id: accountId,
    owner_user_id: userId,
    home_membership_id: membership.id,
    estate_id: membership.estate_id,
    building_id: membership.building_id,
    home_id: membership.home_id,
    connection_scope: "resident_home",
    status: "active",
    metadata: {
      ...metadata,
      last_saved_from: metadata?.last_saved_from || "oyi_api",
    },
    disconnected_at: null,
    updated_at: new Date().toISOString(),
  };

  const existing = await supabaseAdmin
    .from("provider_connections")
    .select("id")
    .eq("provider", provider)
    .eq("owner_user_id", userId)
    .eq("home_id", membership.home_id)
    .eq("provider_account_id", accountId)
    .is("disconnected_at", null)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const write = existing.data?.id
    ? supabaseAdmin
        .from("provider_connections")
        .update(payload as any)
        .eq("id", existing.data.id)
        .select("*")
        .single()
    : supabaseAdmin
        .from("provider_connections")
        .insert(payload as any)
        .select("*")
        .single();

  const { data, error } = await write;
  if (error) {
    if (String(error.code || "") === "23505") {
      const retry = await supabaseAdmin
        .from("provider_connections")
        .select("*")
        .eq("provider", provider)
        .eq("owner_user_id", userId)
        .eq("home_id", membership.home_id)
        .eq("provider_account_id", accountId)
        .is("disconnected_at", null)
        .maybeSingle();
      if (!retry.error && retry.data?.id) return retry.data as any;
    }
    throw error;
  }
  return data as any;
}

export async function markProviderConnectionSync(
  connectionId: string | null | undefined,
  patch: { ok: boolean; error?: any; syncedAt?: string },
) {
  const id = clean(connectionId);
  if (!id) return;
  const syncedAt = patch.syncedAt || new Date().toISOString();
  const update = patch.ok
    ? {
        status: "active",
        last_sync_at: syncedAt,
        last_successful_sync_at: syncedAt,
        last_error: null,
        updated_at: syncedAt,
      }
    : {
        status: "degraded",
        last_sync_at: syncedAt,
        last_error: {
          message: patch.error?.message || String(patch.error || "Provider sync failed"),
          at: syncedAt,
        },
        updated_at: syncedAt,
      };
  await supabaseAdmin.from("provider_connections").update(update as any).eq("id", id);
}

export function serializeProviderConnection(connection: any) {
  const providerAccountId = clean(connection?.provider_account_id) || null;
  return {
    connection_id: connection?.id || null,
    provider: connection?.provider || "tuya",
    connected: Boolean(providerAccountId) && !connection?.disconnected_at,
    status: connection?.status || (providerAccountId ? "active" : "disconnected"),
    home_id: connection?.home_id || null,
    estate_id: connection?.estate_id || null,
    external_user_id: providerAccountId,
    tuya_uid: connection?.provider === "tuya" ? providerAccountId : undefined,
    masked_external_user_id: mask(providerAccountId),
    masked_uid: mask(providerAccountId),
    connection_scope: connection?.connection_scope || null,
    last_sync_at: connection?.last_sync_at || null,
    last_successful_sync_at: connection?.last_successful_sync_at || null,
  };
}
