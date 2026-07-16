import { TuyaClient } from "../device/adapters/tuya/tuyaClient";
import { classifyProviderError, type ProviderErrorClassification } from "../device/runtime/providerErrors";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { getTuyaUidForUser } from "./tuyaRegistrySyncService";

const TUYA_DEVICE_SELECT = "id,name,external_id,estate_id,home_id,room_id,parent_device_id,is_virtual,provider,vendor,adapter,status,online,metadata,last_seen_at,updated_at";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function integrationOwner(device: Record<string, any>) {
  return text(device?.metadata?.oyi?.integration_owner_user_id || device?.metadata?.context?.userId) || null;
}

function metadataUid(device: Record<string, any>) {
  return text(device?.metadata?.context?.tuyaUid || device?.metadata?.raw?.uid) || null;
}

function providerRegion() {
  const configured = text(process.env.TUYA_REGION);
  if (configured) return configured;
  try {
    const host = new URL(text(process.env.TUYA_BASE_URL)).host.toLowerCase();
    if (host.includes("tuyaeu")) return "eu";
    if (host.includes("tuyaus")) return "us";
    if (host.includes("tuyain")) return "in";
    if (host.includes("tuyacn")) return "cn";
    return host || "unknown";
  } catch {
    return "unknown";
  }
}

function suggestedRemediation(input: {
  classification: ProviderErrorClassification | "authorized" | "unknown";
  malformedIdentity: boolean;
  virtual: boolean;
}) {
  if (input.malformedIdentity) return "Repair this registry row so external_id contains the real Tuya device ID.";
  if (input.classification === "device_not_linked") return "Reconnect Smart Life for the integration owner, then run a Tuya registry sync.";
  if (input.classification === "permission_denied" || input.classification === "integration_expired") return "Refresh the Smart Life connection for the integration owner.";
  if (input.classification === "authentication_failed") return "Verify the Tuya project credentials and EU region binding.";
  if (input.classification === "provider_unavailable" || input.classification === "rate_limited") return "Wait for provider recovery and retry the diagnostic.";
  if (input.virtual) return "No action is required; this virtual appliance reads through its parent IR hub.";
  if (input.classification === "authorized") return "No action required.";
  return "Run the verified diagnostic or refresh this device to confirm authorization.";
}

export async function buildTuyaAuthorizationDiagnostics(input: { estateId: string; verifyProvider?: boolean }) {
  const { data: devices, error: devicesError } = await supabaseAdmin
    .from("devices")
    .select(TUYA_DEVICE_SELECT)
    .eq("estate_id", input.estateId)
    .or("vendor.eq.tuya,adapter.eq.tuya,provider.eq.tuya")
    .order("name", { ascending: true })
    .limit(5_000);
  if (devicesError) throw devicesError;

  const rows = devices || [];
  const { data: stateRows, error: stateError } = rows.length
    ? await supabaseAdmin.from("device_states").select("device_id,status,last_seen,updated_at").in("device_id", rows.map((device: any) => device.id))
    : { data: [], error: null };
  if (stateError) throw stateError;

  const deviceMap = new Map(rows.map((device: any) => [String(device.id), device]));
  const stateMap = new Map((stateRows || []).map((row: any) => [String(row.device_id), row]));
  const owners = Array.from(new Set(rows.map((device: any) => integrationOwner(device)).filter((value): value is string => Boolean(value))));
  const uidByOwner = new Map<string, string | null>();
  await Promise.all(owners.map(async (owner) => uidByOwner.set(owner, await getTuyaUidForUser(owner))));

  const linkedByUid = new Map<string, Set<string>>();
  const integrationErrorByUid = new Map<string, ReturnType<typeof classifyProviderError>>();
  if (input.verifyProvider && process.env.TUYA_ACCESS_ID && process.env.TUYA_ACCESS_SECRET && process.env.TUYA_BASE_URL) {
    const client = new TuyaClient();
    const uids = Array.from(new Set(Array.from(uidByOwner.values()).filter((value): value is string => Boolean(value))));
    await Promise.all(uids.map(async (uid) => {
      try {
        const result: any = await client.request("GET", `/v1.0/users/${encodeURIComponent(uid)}/devices`);
        const list = Array.isArray(result) ? result : Array.isArray(result?.list) ? result.list : [];
        linkedByUid.set(uid, new Set(list.map((device: any) => text(device?.id)).filter(Boolean)));
      } catch (error) {
        integrationErrorByUid.set(uid, classifyProviderError(error, { provider: "tuya", operation: "authorization_diagnostic" }));
      }
    }));
  }

  const report = rows.map((device: any) => {
    const metadata = device?.metadata || {};
    const raw = metadata?.raw || {};
    const context = metadata?.context || {};
    const oyi = metadata?.oyi || {};
    const owner = integrationOwner(device);
    const linkedUid = owner ? uidByOwner.get(owner) || null : metadataUid(device);
    const stateRow: any = stateMap.get(String(device.id)) || null;
    const runtime = stateRow?.status?._oyi_runtime || {};
    const runtimeError = runtime?.provider_error && typeof runtime.provider_error === "object" ? runtime.provider_error : null;
    const parent: any = device?.parent_device_id ? deviceMap.get(String(device.parent_device_id)) || null : null;
    const effectiveExternalId = device?.is_virtual && parent?.external_id ? text(parent.external_id) : text(device?.external_id);
    const malformedIdentity = isUuid(text(device?.external_id)) && !text(raw?.id) && !owner;
    const linkedSet = linkedUid ? linkedByUid.get(linkedUid) : null;
    const integrationError = linkedUid ? integrationErrorByUid.get(linkedUid) || null : null;
    const providerVerified = Boolean(input.verifyProvider && linkedSet);
    const authorizedForUid = providerVerified ? linkedSet!.has(effectiveExternalId) : null;
    let classification: ProviderErrorClassification | "authorized" | "unknown" = "unknown";

    if (malformedIdentity || !owner || !linkedUid || oyi.provider_available === false) classification = "device_not_linked";
    else if (integrationError) classification = integrationError.classification;
    else if (providerVerified) classification = authorizedForUid ? "authorized" : "device_not_linked";
    else if (runtimeError?.classification) classification = runtimeError.classification;

    const authorizationState = classification === "authorized"
      ? "authorized"
      : classification === "device_not_linked"
        ? "device_not_linked"
        : classification === "unknown"
          ? "unknown"
          : "authorization_required";
    const lastSuccessfulRefresh = text(runtime.provider_last_success_at) || (!runtimeError ? text(runtime.last_refresh || stateRow?.last_seen) : "") || null;

    return {
      internal_device_id: String(device.id),
      device_name: String(device.name || "Device"),
      external_tuya_id: text(device.external_id) || null,
      effective_provider_device_id: effectiveExternalId || null,
      parent_device_id: device.parent_device_id || null,
      virtual_device: Boolean(device.is_virtual),
      integration_owner_user_id: owner,
      linked_tuya_uid: linkedUid,
      metadata_context: {
        user_id: text(context.userId) || null,
        tuya_uid: text(context.tuyaUid) || null,
        estate_id: text(context.estateId) || null,
        home_id: text(context.homeId) || null,
      },
      metadata_oyi: {
        integration_owner_user_id: text(oyi.integration_owner_user_id) || null,
        provider_available: typeof oyi.provider_available === "boolean" ? oyi.provider_available : null,
        provider_last_synced_at: text(oyi.provider_last_synced_at) || null,
        provider_unavailable_at: text(oyi.provider_unavailable_at) || null,
      },
      raw_tuya_category: text(raw.category || metadata.category) || null,
      raw_tuya_owner_id: text(raw.owner_id || metadata.owner_id) || null,
      raw_tuya_uid: text(raw.uid) || null,
      last_successful_refresh: lastSuccessfulRefresh,
      last_provider_error: runtimeError ? {
        classification: runtimeError.classification || "unknown_provider_error",
        provider_code: runtimeError.provider_code || null,
        occurred_at: runtimeError.occurred_at || null,
        next_retry_at: runtimeError.next_retry_at || null,
        safe_message: runtimeError.safe_message || null,
      } : null,
      authorization_state: authorizationState,
      authorized_for_linked_uid: authorizedForUid,
      provider_verification_performed: providerVerified,
      suggested_remediation: suggestedRemediation({ classification, malformedIdentity, virtual: Boolean(device.is_virtual) }),
    };
  });

  return {
    provider: "tuya",
    generated_at: new Date().toISOString(),
    estate_id: input.estateId,
    provider_configuration: {
      access_id_configured: Boolean(process.env.TUYA_ACCESS_ID),
      access_secret_configured: Boolean(process.env.TUYA_ACCESS_SECRET),
      base_url_configured: Boolean(process.env.TUYA_BASE_URL),
      region: providerRegion(),
    },
    provider_verification_requested: Boolean(input.verifyProvider),
    count: report.length,
    attention_count: report.filter((device) => ["authorization_required", "device_not_linked"].includes(device.authorization_state)).length,
    devices: report,
  };
}
