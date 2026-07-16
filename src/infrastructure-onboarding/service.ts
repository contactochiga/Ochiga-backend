import { randomUUID } from "crypto";
import { adapterRegistry } from "../device/adapters/registry";
import { initAdaptersOnce } from "../device/adapters/initAdapters";
import type { AdapterContext } from "../device/adapters/types";
import { emitAuditEvent } from "../core/foundation";
import { emitSignal, makeBaseSignal } from "../realtime/emitSignal";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { getTuyaUidForUser } from "../services/tuyaRegistrySyncService";
import { keepDeviceOverrides, upsertCanonicalDeviceIdentity } from "../services/deviceIdentityService";
import { deviceRuntimeStateService } from "../services/deviceRuntimeStateService";
import { createPublicApiError } from "../services/publicApi";
import { logger } from "../observability/logger";
import {
  discoverWithInfrastructureProvider,
  getInfrastructureProviderManifest,
  listInfrastructureProviderManifests,
} from "./providerRegistry";
import type {
  DiscoveryClassification,
  InfrastructureProviderManifest,
  NormalizedDiscoveryCandidate,
  OnboardingActor,
  OnboardingVerificationCheck,
} from "./types";

type ProviderCredentials = Record<string, Record<string, unknown>>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

export function sanitizeOnboardingMetadata(value: unknown, depth = 0): any {
  if (value == null || depth > 5) return value == null ? null : {};
  if (Array.isArray(value)) return value.slice(0, 250).map((item) => sanitizeOnboardingMetadata(item, depth + 1));
  if (typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/(pass(word)?|secret|token|credential(?!_ref)|api[_-]?key|access[_-]?id|access[_-]?secret|private[_-]?key|authorization)/i.test(key))
      .map(([key, nested]) => [key, sanitizeOnboardingMetadata(nested, depth + 1)]),
  );
}

function onboardingRef() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `ONB-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function actorEstate(actor: OnboardingActor) {
  const estateId = text(actor?.estate_id);
  if (!actor?.id) throw createPublicApiError(401, "not_authenticated", "Sign in to continue.");
  if (!estateId) throw createPublicApiError(400, "estate_context_required", "Select a property before onboarding infrastructure.");
  return estateId;
}

async function sessionForActor(actor: OnboardingActor, sessionId: string) {
  const estateId = actorEstate(actor);
  const { data, error } = await supabaseAdmin
    .from("infrastructure_onboarding_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("estate_id", estateId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw createPublicApiError(404, "onboarding_session_not_found", "This onboarding session is not available in the current property.");
  return data;
}

async function candidateForActor(actor: OnboardingActor, sessionId: string, candidateId: string) {
  const session = await sessionForActor(actor, sessionId);
  const { data, error } = await supabaseAdmin
    .from("infrastructure_discovery_candidates")
    .select("*")
    .eq("id", candidateId)
    .eq("session_id", session.id)
    .eq("estate_id", session.estate_id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw createPublicApiError(404, "discovery_candidate_not_found", "This discovered system is no longer available.");
  return { session, candidate: data };
}

async function recordEvent(input: {
  actor: OnboardingActor;
  session: any;
  eventType: string;
  summary: string;
  status?: string;
  candidateId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const metadata = sanitizeOnboardingMetadata(input.metadata || {});
  const { error } = await supabaseAdmin.from("infrastructure_onboarding_events").insert({
    session_id: input.session.id,
    estate_id: input.session.estate_id,
    candidate_id: input.candidateId || null,
    actor_id: input.actor.id,
    event_type: input.eventType,
    status: input.status || "recorded",
    summary: input.summary,
    metadata,
  } as any);
  if (error) logger.warn("infrastructure_onboarding_event_write_failed", { error: error.message, session_id: input.session.id, event_type: input.eventType });

  void emitAuditEvent({
    actorId: input.actor.id,
    actorEmail: input.actor.email || "",
    actorRole: input.actor.role || "",
    action: input.eventType,
    resourceType: "infrastructure_onboarding",
    resourceId: input.candidateId || input.session.id,
    estateId: input.session.estate_id,
    homeId: input.session.home_id || null,
    status: input.status === "failed" ? "failed" : "success",
    metadata: { onboarding_ref: input.session.onboarding_ref, ...metadata },
  } as any);
  void emitSignal(makeBaseSignal({
    type: input.eventType,
    source: "infrastructure_onboarding",
    estateId: input.session.estate_id,
    homeId: input.session.home_id || undefined,
    status: input.status || "recorded",
    requestedBy: { userId: input.actor.id, role: input.actor.role || "" },
    metadata: { onboarding_session_id: input.session.id, onboarding_ref: input.session.onboarding_ref, candidate_id: input.candidateId || null, summary: input.summary, ...metadata },
  } as any));
}

async function updateSession(sessionId: string, patch: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin
    .from("infrastructure_onboarding_sessions")
    .update({ ...patch, updated_at: new Date().toISOString() } as any)
    .eq("id", sessionId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function refreshSessionSummary(sessionId: string, preferredStatus?: string) {
  const { data: candidates, error } = await supabaseAdmin
    .from("infrastructure_discovery_candidates")
    .select("classification,discovery_status,provider_key")
    .eq("session_id", sessionId);
  if (error) throw error;
  const rows = candidates || [];
  const byClassification: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const row of rows as any[]) {
    byClassification[row.classification] = (byClassification[row.classification] || 0) + 1;
    byStatus[row.discovery_status] = (byStatus[row.discovery_status] || 0) + 1;
  }
  let status = preferredStatus || "discovered";
  if (rows.length && rows.every((row: any) => row.discovery_status === "promoted")) status = "operational";
  else if (byStatus.verification_failed) status = "attention";
  else if (byClassification.needs_credentials) status = "authentication_required";
  else if (rows.length && rows.every((row: any) => ["verified", "promoted"].includes(row.discovery_status))) status = "ready";
  const summary = {
    total: rows.length,
    classifications: byClassification,
    statuses: byStatus,
    providers: Array.from(new Set((rows as any[]).map((row) => row.provider_key))),
  };
  return updateSession(sessionId, {
    status,
    summary,
    completed_at: status === "operational" ? new Date().toISOString() : null,
  });
}

export async function createInfrastructurePartner(actor: OnboardingActor, input: Record<string, unknown>) {
  actorEstate(actor);
  const name = text(input.name);
  if (!name) throw createPublicApiError(400, "partner_name_required", "Enter the partner name.");
  const { data, error } = await supabaseAdmin.from("infrastructure_partners").insert({
    name,
    partner_type: lower(input.partner_type) || "other",
    external_ref: text(input.external_ref) || null,
    certification_status: lower(input.certification_status) || "unverified",
    contact_name: text(input.contact_name) || null,
    contact_email: lower(input.contact_email) || null,
    contact_phone: text(input.contact_phone) || null,
    metadata: sanitizeOnboardingMetadata(input.metadata || {}),
    created_by: actor.id,
  } as any).select("*").single();
  if (error) throw error;
  return data;
}

export async function listInfrastructurePartners(actor: OnboardingActor) {
  actorEstate(actor);
  const { data, error } = await supabaseAdmin
    .from("infrastructure_partners")
    .select("id,name,partner_type,status,certification_status")
    .eq("status", "active")
    .order("name");
  if (error) throw error;
  return data || [];
}

export async function createInfrastructureOnboardingSession(actor: OnboardingActor, input: Record<string, unknown>) {
  const estateId = actorEstate(actor);
  const homeId = text(input.home_id) || null;
  const buildingId = text(input.building_id) || null;
  const partnerId = text(input.partner_id) || null;
  const installerId = text(input.installer_id) || actor.id;
  let homeBuildingId: string | null = null;
  if (homeId) {
    const { data: home, error } = await supabaseAdmin.from("homes").select("id,building_id").eq("id", homeId).eq("estate_id", estateId).maybeSingle();
    if (error) throw error;
    if (!home?.id) throw createPublicApiError(400, "home_scope_invalid", "The selected home is not part of this property.");
    homeBuildingId = text(home.building_id) || null;
  }
  if (buildingId) {
    const { data: building, error } = await supabaseAdmin.from("estate_buildings").select("id").eq("id", buildingId).eq("estate_id", estateId).maybeSingle();
    if (error) throw error;
    if (!building?.id) throw createPublicApiError(400, "building_scope_invalid", "The selected building is not part of this property.");
    if (homeBuildingId && homeBuildingId !== buildingId) throw createPublicApiError(400, "home_building_scope_invalid", "The selected home belongs to a different building.");
  }
  if (partnerId) {
    const { data: partner, error } = await supabaseAdmin.from("infrastructure_partners").select("id,status").eq("id", partnerId).eq("status", "active").maybeSingle();
    if (error) throw error;
    if (!partner?.id) throw createPublicApiError(400, "partner_unavailable", "The selected onboarding partner is not active.");
    const { data: member, error: memberError } = await supabaseAdmin
      .from("infrastructure_partner_members")
      .select("id,status,expires_at")
      .eq("partner_id", partnerId)
      .eq("user_id", installerId)
      .eq("status", "active")
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member?.id || (member.expires_at && new Date(member.expires_at).getTime() <= Date.now())) {
      throw createPublicApiError(400, "installer_partner_scope_invalid", "The selected installer is not active for this partner.");
    }
  } else if (installerId !== actor.id) {
    const { data: membership, error } = await supabaseAdmin
      .from("estate_memberships")
      .select("id")
      .eq("estate_id", estateId)
      .eq("user_id", installerId)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    if (!membership?.id) throw createPublicApiError(400, "installer_scope_invalid", "The selected installer is not active in this property.");
  }
  const row = {
    onboarding_ref: onboardingRef(),
    estate_id: estateId,
    building_id: buildingId || homeBuildingId,
    home_id: homeId,
    partner_id: partnerId,
    installer_id: installerId,
    initiated_by: actor.id,
    source_surface: text(input.source_surface) || "facility",
    status: "created",
    notes: text(input.notes) || null,
    metadata: sanitizeOnboardingMetadata({ property_type: input.property_type, onboarding_type: input.onboarding_type, ...((input.metadata as any) || {}) }),
  };
  const { data, error } = await supabaseAdmin.from("infrastructure_onboarding_sessions").insert(row as any).select("*").single();
  if (error) throw error;
  await recordEvent({ actor, session: data, eventType: "infrastructure.onboarding.started", summary: "Infrastructure onboarding started.", metadata: { partner_id: row.partner_id, installer_id: row.installer_id } });
  return data;
}

async function hasOnlineEdge(estateId: string) {
  const { data, error } = await supabaseAdmin
    .from("edge_nodes")
    .select("id")
    .eq("estate_id", estateId)
    .in("heartbeat_status", ["online", "healthy", "active"])
    .limit(1);
  if (error) return false;
  return Boolean(data?.length);
}

async function connectionFor(estateId: string, providerKey: string) {
  const { data } = await supabaseAdmin
    .from("infrastructure_provider_connections")
    .select("*")
    .eq("estate_id", estateId)
    .eq("provider_key", providerKey)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

export async function authenticateInfrastructureProvider(actor: OnboardingActor, sessionId: string, providerKey: string, input: Record<string, unknown>) {
  const session = await sessionForActor(actor, sessionId);
  const manifest = getInfrastructureProviderManifest(providerKey);
  if (!manifest) throw createPublicApiError(400, "provider_unknown", "This infrastructure provider is not recognized.");

  let authenticationStatus = "pending";
  let externalAccountId = text(input.external_account_id) || null;
  let method = text(input.authentication_method) || manifest.authentication_methods[0] || "none";
  const credentialRef = text(input.credential_ref) || null;
  let lastErrorCode: string | null = null;

  if (manifest.authentication_methods.includes("none")) {
    authenticationStatus = "not_required";
    method = "none";
  } else if (providerKey === "tuya") {
    externalAccountId = await getTuyaUidForUser(actor.id);
    if (!externalAccountId) {
      authenticationStatus = "required";
      lastErrorCode = "linked_account_required";
    } else {
      authenticationStatus = "authenticated";
    }
  } else if (!credentialRef) {
    authenticationStatus = "required";
    lastErrorCode = "credentials_required";
  } else {
    lastErrorCode = "provider_verification_pending";
  }

  const connectionKey = text(input.connection_key) || `${providerKey}:${externalAccountId || actor.id}`;
  const { data, error } = await supabaseAdmin.from("infrastructure_provider_connections").upsert({
    estate_id: session.estate_id,
    onboarding_session_id: session.id,
    provider_key: providerKey,
    adapter_key: manifest.adapter_key || null,
    connection_key: connectionKey,
    authentication_method: method,
    authentication_status: authenticationStatus,
    credential_ref: credentialRef,
    integration_owner_user_id: actor.id,
    external_account_id: externalAccountId,
    last_verified_at: ["authenticated", "not_required"].includes(authenticationStatus) ? new Date().toISOString() : null,
    last_error_code: lastErrorCode,
    metadata: sanitizeOnboardingMetadata({ provider_label: manifest.label, authentication_methods: manifest.authentication_methods }),
    created_by: actor.id,
    updated_at: new Date().toISOString(),
  } as any, { onConflict: "estate_id,provider_key,connection_key" }).select("*").single();
  if (error) throw error;

  await recordEvent({
    actor,
    session,
    eventType: authenticationStatus === "required" ? "infrastructure.onboarding.authentication_required" : authenticationStatus === "pending" ? "infrastructure.onboarding.authentication_pending" : "infrastructure.onboarding.provider_authenticated",
    summary: authenticationStatus === "required" ? `${manifest.label} needs authentication.` : authenticationStatus === "pending" ? `${manifest.label} credentials are awaiting provider verification.` : `${manifest.label} connection verified.`,
    status: ["required", "pending"].includes(authenticationStatus) ? "attention" : "recorded",
    metadata: { provider_key: providerKey, authentication_method: method, authentication_status: authenticationStatus, credential_ref_present: Boolean(credentialRef) },
  });
  if (["required", "pending"].includes(authenticationStatus)) await updateSession(session.id, { status: "authentication_required" });
  return data;
}

async function duplicateForCandidate(estateId: string, candidate: NormalizedDiscoveryCandidate) {
  if (!candidate.external_id) return null;
  if (candidate.candidate_type === "camera") {
    const ip = text((candidate.provider_metadata as any)?.raw?.ip || candidate.external_id);
    const query = supabaseAdmin.from("facility_cameras").select("id").eq("estate_id", estateId);
    const { data } = await (ip ? query.eq("ip", ip) : query.eq("camera_id", candidate.external_id)).limit(1).maybeSingle();
    if (data?.id) return { type: "camera", id: data.id };
  }
  const { data } = await supabaseAdmin
    .from("devices")
    .select("id")
    .eq("estate_id", estateId)
    .eq("external_id", candidate.external_id)
    .or(`provider.eq.${candidate.provider_key},vendor.eq.${candidate.provider_key},adapter.eq.${candidate.adapter_key}`)
    .limit(1)
    .maybeSingle();
  return data?.id ? { type: "device", id: data.id } : null;
}

async function edgeCandidates(session: any): Promise<NormalizedDiscoveryCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from("discovered_devices")
    .select("*")
    .eq("estate_id", session.estate_id)
    .order("last_seen_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data || []).map((row: any) => {
    const externalId = text(row.external_id || row.id);
    const category = lower(row.category) || "unknown";
    const provider = lower(row.provider) || "oyi_edge";
    let candidateType: any = "device";
    if (/camera|onvif|rtsp/.test(category)) candidateType = "camera";
    else if (/gateway|hub|bridge/.test(category)) candidateType = "gateway";
    else if (/meter/.test(category)) candidateType = "meter";
    else if (/sensor/.test(category)) candidateType = "sensor";
    return {
      provider_key: provider,
      adapter_key: "oyi_edge",
      identity_key: `${provider}:${externalId}`,
      external_id: externalId || null,
      candidate_type: candidateType,
      name: text(row.name) || "Edge-discovered infrastructure",
      category,
      classification: externalId ? "compatible" : "unknown",
      classification_reason: externalId ? "Oyi Edge supplied a stable local identity." : "The Edge source did not supply a stable identity.",
      online: row.last_seen_at ? true : null,
      capabilities: asArray(row.capabilities || row.metadata?.capabilities),
      protocols: asArray(row.protocols || row.metadata?.protocols),
      provider_metadata: sanitizeOnboardingMetadata({ ...(row.metadata || {}), edge_node_id: row.edge_node_id, last_seen_at: row.last_seen_at, source_record_id: row.id }),
    } as NormalizedDiscoveryCandidate;
  });
}

function edgeCandidatesForProvider(candidates: NormalizedDiscoveryCandidate[], providerKey: string) {
  if (providerKey === "onvif") {
    return candidates.filter((candidate) => candidate.provider_key === "onvif" || candidate.candidate_type === "camera" || candidate.protocols.some((protocol) => /onvif|rtsp/i.test(protocol)));
  }
  if (providerKey === "ssdp") {
    return candidates.filter((candidate) => candidate.provider_key === "ssdp" || candidate.protocols.some((protocol) => /ssdp|upnp/i.test(protocol)));
  }
  return candidates.filter((candidate) => candidate.provider_key === providerKey);
}

async function upsertDiscoveredCandidate(session: any, candidate: NormalizedDiscoveryCandidate) {
  const duplicate = await duplicateForCandidate(session.estate_id, candidate);
  const classification: DiscoveryClassification = duplicate ? "compatible" : candidate.classification;
  const reason = duplicate ? "A matching canonical record already exists and will be updated instead of duplicated." : candidate.classification_reason;
  const { data, error } = await supabaseAdmin.from("infrastructure_discovery_candidates").upsert({
    session_id: session.id,
    estate_id: session.estate_id,
    provider_key: candidate.provider_key,
    adapter_key: candidate.adapter_key,
    identity_key: candidate.identity_key,
    external_id: candidate.external_id,
    candidate_type: candidate.candidate_type,
    name: candidate.name,
    category: candidate.category,
    classification,
    classification_reason: reason,
    discovery_status: "classified",
    online: candidate.online,
    capabilities: candidate.capabilities,
    protocols: candidate.protocols,
    duplicate_target_type: duplicate?.type || null,
    duplicate_target_id: duplicate?.id || null,
    provider_metadata: sanitizeOnboardingMetadata(candidate.provider_metadata),
    discovered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as any, { onConflict: "session_id,identity_key" }).select("*").single();
  if (error) throw error;
  return data;
}

export async function discoverInfrastructure(actor: OnboardingActor, sessionId: string, input: {
  providers?: string[];
  provider_credentials?: ProviderCredentials;
  allow_local_scan?: boolean;
}) {
  let session = await sessionForActor(actor, sessionId);
  session = await updateSession(session.id, { status: "discovering" });
  const onlineEdge = await hasOnlineEdge(session.estate_id);
  const allowServerLocalScan = input.allow_local_scan === true && process.env.INFRASTRUCTURE_ONBOARDING_ALLOW_SERVER_LAN_SCAN === "true";
  const providerKeys = (input.providers?.length ? input.providers : ["tuya", "onvif", "ssdp", "oyi_edge"])
    .map(lower)
    .filter(Boolean);
  const providerResults: any[] = [];
  const staged: any[] = [];

  for (const providerKey of providerKeys) {
    const manifest = getInfrastructureProviderManifest(providerKey);
    if (!manifest) {
      providerResults.push({ provider_key: providerKey, classification: "unknown", count: 0, message: "Provider not recognized." });
      continue;
    }
    if (manifest.implementation === "future" || manifest.implementation === "adapter_required" || !manifest.supports_discovery) {
      const classification = manifest.implementation === "future" ? "unsupported" : "needs_adapter";
      providerResults.push({ provider_key: providerKey, classification, count: 0, message: manifest.notes || "A discovery adapter is not active yet." });
      continue;
    }
    if (manifest.requires_edge && !onlineEdge && !allowServerLocalScan) {
      providerResults.push({ provider_key: providerKey, classification: "needs_edge", count: 0, message: "An online Oyi Edge node is required for local discovery." });
      continue;
    }

    const credentials = input.provider_credentials?.[providerKey] || {};
    let tuyaUid: string | null = null;
    if (providerKey === "tuya") {
      tuyaUid = await getTuyaUidForUser(actor.id);
      if (!tuyaUid) {
        providerResults.push({ provider_key: providerKey, classification: "needs_credentials", count: 0, message: "Connect Tuya / Smart Life before importing its systems." });
        continue;
      }
    }

    try {
      let discovered: NormalizedDiscoveryCandidate[];
      if (providerKey === "oyi_edge") {
        discovered = await edgeCandidates(session);
      } else if (manifest.discovery_mode === "local_network" && onlineEdge && !allowServerLocalScan) {
        discovered = edgeCandidatesForProvider(await edgeCandidates(session), providerKey);
      } else {
        const adapterContext: AdapterContext = {
          estateId: session.estate_id,
          homeId: session.home_id || actor.home_id || undefined,
          userId: actor.id,
          credentials: {
            ...credentials,
            apiKey: providerKey === "tuya" ? process.env.TUYA_ACCESS_ID : undefined,
            apiSecret: providerKey === "tuya" ? process.env.TUYA_ACCESS_SECRET : undefined,
            tuyaUid,
            username: text(credentials.username) || undefined,
            password: text(credentials.password) || undefined,
            cidr: text(credentials.cidr) || undefined,
          },
        };
        discovered = await discoverWithInfrastructureProvider({
          provider: manifest,
          adapterContext,
          estateId: session.estate_id,
          sessionId: session.id,
          hasOnlineEdge: onlineEdge,
          allowLocalScan: allowServerLocalScan,
        });
      }
      for (const candidate of discovered) staged.push(await upsertDiscoveredCandidate(session, candidate));
      providerResults.push({ provider_key: providerKey, classification: "compatible", count: discovered.length, message: discovered.length ? `${discovered.length} systems found.` : "No systems were found." });
      if (providerKey === "tuya") {
        await authenticateInfrastructureProvider(actor, session.id, providerKey, { authentication_method: "linked_account", external_account_id: tuyaUid, connection_key: `tuya:${tuyaUid}` });
      }
    } catch (error: any) {
      logger.warn("infrastructure_onboarding_discovery_failed", { provider_key: providerKey, session_id: session.id, estate_id: session.estate_id, error: error?.message || String(error) });
      providerResults.push({ provider_key: providerKey, classification: "unknown", count: 0, message: "Discovery could not complete for this provider." });
    }
  }

  session = await refreshSessionSummary(session.id, providerResults.some((result) => result.classification === "needs_credentials") ? "authentication_required" : "discovered");
  session = await updateSession(session.id, { metadata: { ...(session.metadata || {}), provider_results: providerResults, last_discovery_at: new Date().toISOString() } });
  await recordEvent({ actor, session, eventType: "infrastructure.onboarding.discovery_completed", summary: `Discovery completed with ${staged.length} staged systems.`, metadata: { provider_results: providerResults, staged_count: staged.length } });
  return { session, candidates: staged, provider_results: providerResults };
}

async function validateProposedLocation(estateId: string, homeId: string | null, roomId: string | null) {
  if (!homeId && roomId) throw createPublicApiError(400, "home_required_for_room", "Select a home before assigning a room.");
  if (homeId) {
    const { data, error } = await supabaseAdmin.from("homes").select("id").eq("id", homeId).eq("estate_id", estateId).maybeSingle();
    if (error) throw error;
    if (!data?.id) throw createPublicApiError(400, "home_scope_invalid", "The selected home is not part of this property.");
  }
  if (roomId) {
    const { data, error } = await supabaseAdmin.from("rooms").select("id").eq("id", roomId).eq("estate_id", estateId).eq("home_id", homeId).maybeSingle();
    if (error) throw error;
    if (!data?.id) throw createPublicApiError(400, "room_scope_invalid", "The selected room is not part of this home.");
  }
}

export async function importInfrastructureCandidates(actor: OnboardingActor, sessionId: string, input: {
  candidate_ids?: string[];
  mappings?: Record<string, { home_id?: string | null; room_id?: string | null; zone_id?: string | null; metadata?: Record<string, unknown> }>;
}) {
  const session = await sessionForActor(actor, sessionId);
  let query = supabaseAdmin.from("infrastructure_discovery_candidates").select("*").eq("session_id", session.id).eq("estate_id", session.estate_id);
  if (input.candidate_ids?.length) query = query.in("id", input.candidate_ids);
  const { data, error } = await query;
  if (error) throw error;
  const imported: any[] = [];
  for (const candidate of data || []) {
    if (candidate.classification !== "compatible") continue;
    const mapping = input.mappings?.[candidate.id] || {};
    const homeId = text(mapping.home_id) || session.home_id || null;
    const roomId = text(mapping.room_id) || null;
    await validateProposedLocation(session.estate_id, homeId, roomId);
    const { data: next, error: updateError } = await supabaseAdmin.from("infrastructure_discovery_candidates").update({
      discovery_status: "imported",
      proposed_home_id: homeId,
      proposed_room_id: roomId,
      proposed_zone_id: text(mapping.zone_id) || null,
      mapping_metadata: sanitizeOnboardingMetadata(mapping.metadata || {}),
      updated_at: new Date().toISOString(),
    } as any).eq("id", candidate.id).select("*").single();
    if (updateError) throw updateError;
    imported.push(next);
    await recordEvent({ actor, session, candidateId: candidate.id, eventType: "infrastructure.onboarding.candidate_imported", summary: `${candidate.name} prepared for verification.`, metadata: { home_id: homeId, room_id: roomId } });
  }
  const nextSession = await refreshSessionSummary(session.id, "importing");
  return { session: nextSession, candidates: imported };
}

async function candidateAuthenticationCheck(candidate: any, manifest: InfrastructureProviderManifest | null): Promise<OnboardingVerificationCheck> {
  if (!manifest || manifest.authentication_methods.includes("none")) return { key: "permissions", state: "passed", summary: "No provider authentication is required." };
  const discoveredThroughEdge = candidate.adapter_key === "oyi_edge" || Boolean(candidate.provider_metadata?.edge_node_id || candidate.provider_metadata?.source_edge_node_id);
  if (discoveredThroughEdge) {
    return {
      key: "permissions",
      state: "passed",
      summary: "Provider access is held by the authenticated Oyi Edge node.",
      evidence: {
        authentication_method: "edge_credential_reference",
        edge_node_id: candidate.provider_metadata?.edge_node_id || candidate.provider_metadata?.source_edge_node_id || null,
        credential_ref: candidate.provider_metadata?.credential_ref || null,
      },
    };
  }
  const connection = await connectionFor(candidate.estate_id, candidate.provider_key);
  if (connection && ["authenticated", "not_required"].includes(connection.authentication_status)) {
    return { key: "permissions", state: "passed", summary: "Provider access is authenticated.", evidence: { connection_id: connection.id, authentication_method: connection.authentication_method } };
  }
  return { key: "permissions", state: "failed", summary: "Provider access must be authenticated before promotion." };
}

export async function verifyInfrastructureCandidate(actor: OnboardingActor, sessionId: string, candidateId: string, input: { live_read?: boolean } = {}) {
  const { session, candidate } = await candidateForActor(actor, sessionId, candidateId);
  initAdaptersOnce();
  await supabaseAdmin.from("infrastructure_discovery_candidates").update({ discovery_status: "verifying", updated_at: new Date().toISOString() } as any).eq("id", candidate.id);
  const manifest = getInfrastructureProviderManifest(candidate.provider_key) || (candidate.adapter_key === "oyi_edge" ? getInfrastructureProviderManifest("oyi_edge") : null);
  const checks: OnboardingVerificationCheck[] = [];

  checks.push(candidate.external_id
    ? { key: "identity", state: "passed", summary: "A stable provider identity is available.", evidence: { external_id: candidate.external_id, identity_key: candidate.identity_key } }
    : { key: "identity", state: "failed", summary: "A stable provider identity is missing." });
  checks.push(candidate.duplicate_target_id
    ? { key: "duplicate_detection", state: "passed", summary: "A matching registry record will be updated rather than duplicated.", evidence: { target_type: candidate.duplicate_target_type, target_id: candidate.duplicate_target_id } }
    : { key: "duplicate_detection", state: "passed", summary: "No conflicting canonical identity was found." });
  checks.push(await candidateAuthenticationCheck(candidate, manifest));
  checks.push(candidate.online === true
    ? { key: "communication", state: "passed", summary: "The source reported this system as reachable." }
    : candidate.online === false
      ? { key: "communication", state: "conditional", summary: "The identity is valid, but the system is not currently reachable." }
      : { key: "communication", state: "conditional", summary: "Reachability has not yet been confirmed." });
  checks.push(candidate.proposed_room_id && !candidate.proposed_home_id
    ? { key: "relationships", state: "failed", summary: "A room cannot be assigned without a home." }
    : { key: "relationships", state: "passed", summary: candidate.proposed_home_id ? "The proposed property relationship is valid." : "The system may remain at property scope until ownership is assigned." });

  const adapter = candidate.adapter_key ? adapterRegistry.get(candidate.adapter_key) : null;
  if (input.live_read !== false && candidate.external_id && adapter?.getLiveState && candidate.online !== false) {
    try {
      const liveState = await adapter.getLiveState(candidate.external_id);
      checks.push({ key: "state", state: "passed", summary: "Live state was read successfully.", evidence: { state_keys: Object.keys(liveState || {}).slice(0, 50) } });
    } catch (error: any) {
      checks.push({ key: "state", state: "conditional", summary: "The system was discovered, but live state could not be confirmed yet.", evidence: { provider_error: text(error?.code) || "state_read_unavailable" } });
    }
  } else {
    checks.push({ key: "state", state: "not_applicable", summary: "This provider does not expose a safe pre-import state read." });
  }
  checks.push({ key: "command", state: "not_applicable", summary: "No command was executed during onboarding verification." });
  checks.push(candidate.duplicate_target_id
    ? { key: "runtime", state: "passed", summary: "The matching canonical record already has a runtime identity." }
    : { key: "runtime", state: "conditional", summary: "Runtime initialization will occur after registry promotion." });

  if (candidate.classification !== "compatible") checks.push({ key: "identity", state: "failed", summary: candidate.classification_reason || "This system is not ready for promotion." });
  const result = checks.some((check) => check.state === "failed") ? "failed" : checks.some((check) => check.state === "conditional") ? "conditional" : "passed";
  const now = new Date().toISOString();
  const { data: verification, error } = await supabaseAdmin.from("infrastructure_onboarding_verifications").insert({
    session_id: session.id,
    candidate_id: candidate.id,
    estate_id: session.estate_id,
    result,
    checks,
    evidence: { provider_key: candidate.provider_key, adapter_key: candidate.adapter_key, verified_from: candidate.duplicate_target_id ? "canonical_registry_and_discovery" : "provider_discovery" },
    verified_by: actor.id,
    verified_at: now,
  } as any).select("*").single();
  if (error) throw error;
  await supabaseAdmin.from("infrastructure_discovery_candidates").update({
    discovery_status: result === "failed" ? "verification_failed" : "verified",
    verified_at: now,
    updated_at: now,
  } as any).eq("id", candidate.id);
  await recordEvent({ actor, session, candidateId: candidate.id, eventType: result === "failed" ? "infrastructure.onboarding.verification_failed" : "infrastructure.onboarding.verified", summary: result === "failed" ? `${candidate.name} did not pass verification.` : `${candidate.name} verification completed.`, status: result === "failed" ? "failed" : "recorded", metadata: { result, checks } });
  await refreshSessionSummary(session.id, result === "failed" ? "attention" : "verifying");
  return verification;
}

export async function verifyInfrastructureCandidates(actor: OnboardingActor, sessionId: string, input: { candidate_ids?: string[]; live_read?: boolean }) {
  const session = await sessionForActor(actor, sessionId);
  let query = supabaseAdmin.from("infrastructure_discovery_candidates").select("id").eq("session_id", session.id).in("discovery_status", ["imported", "verification_failed", "verified"]);
  if (input.candidate_ids?.length) query = query.in("id", input.candidate_ids);
  const { data, error } = await query;
  if (error) throw error;
  const results = [];
  for (const row of data || []) results.push(await verifyInfrastructureCandidate(actor, session.id, row.id, { live_read: input.live_read }));
  return { session: await refreshSessionSummary(session.id), verifications: results };
}

async function promoteCamera(actor: OnboardingActor, session: any, candidate: any) {
  const raw = candidate.provider_metadata?.raw || {};
  const ip = text(raw.ip || candidate.external_id);
  const cameraId = text(candidate.external_id);
  if (!cameraId) throw createPublicApiError(400, "camera_identity_missing", "This camera cannot be imported without a stable identity.");
  const { data: existing } = candidate.duplicate_target_type === "camera" && candidate.duplicate_target_id
    ? await supabaseAdmin.from("facility_cameras").select("*").eq("id", candidate.duplicate_target_id).maybeSingle()
    : await supabaseAdmin.from("facility_cameras").select("*").eq("estate_id", session.estate_id).eq("camera_id", cameraId).maybeSingle();
  const row = {
    estate_id: session.estate_id,
    camera_id: cameraId,
    name: text(existing?.name) || candidate.name,
    location: existing?.location || null,
    ip: existing?.ip || ip || null,
    onvif_port: existing?.onvif_port || null,
    rtsp_url: existing?.rtsp_url || text(raw.rtsp) || null,
    provider: existing?.provider || candidate.provider_key,
    status: candidate.online === true ? "online" : existing?.status || "pending",
    health_status: candidate.online === true ? "healthy" : existing?.health_status || "pending_stream_details",
    metadata: sanitizeOnboardingMetadata({
      ...(existing?.metadata || {}),
      ...(candidate.provider_metadata || {}),
      onboarding: { session_id: session.id, onboarding_ref: session.onboarding_ref, candidate_id: candidate.id, partner_id: session.partner_id, installer_id: session.installer_id, imported_by: actor.id },
    }),
    created_by: existing?.created_by || actor.id,
    updated_at: new Date().toISOString(),
  };
  const result = existing?.id
    ? await supabaseAdmin.from("facility_cameras").update(row as any).eq("id", existing.id).select("*").single()
    : await supabaseAdmin.from("facility_cameras").insert(row as any).select("*").single();
  if (result.error) throw result.error;
  return { target_type: "camera", target: result.data };
}

async function promoteDevice(actor: OnboardingActor, session: any, candidate: any) {
  let existing: any = null;
  if (candidate.duplicate_target_id) {
    const result = await supabaseAdmin.from("devices").select("*").eq("id", candidate.duplicate_target_id).maybeSingle();
    existing = result.data || null;
  }
  const row = keepDeviceOverrides(existing, {
    estate_id: session.estate_id,
    home_id: candidate.proposed_home_id || session.home_id || existing?.home_id || null,
    room_id: candidate.proposed_room_id || existing?.room_id || null,
    name: candidate.name,
    type: candidate.category || candidate.candidate_type || "device",
    category: candidate.category || candidate.candidate_type || "unknown",
    adapter: candidate.adapter_key,
    provider: candidate.provider_key,
    vendor: candidate.provider_key,
    external_id: candidate.external_id,
    bind_state: candidate.proposed_room_id ? "room_bound" : candidate.proposed_home_id || session.home_id ? "home_bound" : "estate_bound",
    status: candidate.online === true ? "online" : candidate.online === false ? "offline" : "unknown",
    online: candidate.online,
    capabilities: asArray(candidate.capabilities),
    protocols: asArray(candidate.protocols),
    sync_state: candidate.proposed_home_id || session.home_id ? "assigned" : "available_unassigned",
    metadata: sanitizeOnboardingMetadata({
      ...(existing?.metadata || {}),
      ...(candidate.provider_metadata || {}),
      onboarding: { session_id: session.id, onboarding_ref: session.onboarding_ref, candidate_id: candidate.id, partner_id: session.partner_id, installer_id: session.installer_id, imported_by: actor.id },
    }),
    last_seen_at: candidate.online === true ? new Date().toISOString() : existing?.last_seen_at || null,
    last_event_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const result = await upsertCanonicalDeviceIdentity(row);
  deviceRuntimeStateService.scheduleRefresh(result.data, { priority: "high", reason: "infrastructure_onboarding_promotion", delayMs: 100 });
  return { target_type: "device", target: result.data };
}

export async function promoteInfrastructureCandidate(actor: OnboardingActor, sessionId: string, candidateId: string) {
  const { session, candidate } = await candidateForActor(actor, sessionId, candidateId);
  if (candidate.discovery_status !== "verified") throw createPublicApiError(409, "verification_required", "Verify this system before adding it to the registry.");
  const { data: verification, error: verificationError } = await supabaseAdmin
    .from("infrastructure_onboarding_verifications")
    .select("result")
    .eq("candidate_id", candidate.id)
    .order("verified_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (verificationError) throw verificationError;
  if (!verification || !["passed", "conditional", "waived"].includes(verification.result)) throw createPublicApiError(409, "verification_required", "This system has not passed onboarding verification.");
  if (!candidate.external_id) throw createPublicApiError(400, "stable_identity_required", "This system cannot be imported without a stable identity.");

  const promoted = candidate.candidate_type === "camera"
    ? await promoteCamera(actor, session, candidate)
    : await promoteDevice(actor, session, candidate);
  const now = new Date().toISOString();
  const { data: next, error } = await supabaseAdmin.from("infrastructure_discovery_candidates").update({
    discovery_status: "promoted",
    promoted_target_type: promoted.target_type,
    promoted_target_id: promoted.target.id,
    promoted_at: now,
    updated_at: now,
  } as any).eq("id", candidate.id).select("*").single();
  if (error) throw error;
  await supabaseAdmin.from("infrastructure_compatibility_observations").insert({
    estate_id: session.estate_id,
    session_id: session.id,
    provider_key: candidate.provider_key,
    adapter_key: candidate.adapter_key,
    category: candidate.category,
    product_key: text(candidate.provider_metadata?.product_id || candidate.provider_metadata?.model) || null,
    firmware_version: text(candidate.provider_metadata?.firmwareVersion || candidate.provider_metadata?.raw?.firmware) || null,
    classification: candidate.classification,
    outcome: "promoted",
    evidence: { verification_result: verification.result, target_type: promoted.target_type, target_id: promoted.target.id, duplicate_merged: Boolean(candidate.duplicate_target_id) },
  } as any);
  await recordEvent({ actor, session, candidateId: candidate.id, eventType: "infrastructure.onboarding.promoted", summary: `${candidate.name} is now operational in the canonical registry.`, metadata: { target_type: promoted.target_type, target_id: promoted.target.id, duplicate_merged: Boolean(candidate.duplicate_target_id) } });
  return { session: await refreshSessionSummary(session.id, "promoting"), candidate: next, target: promoted.target };
}

export async function promoteInfrastructureCandidates(actor: OnboardingActor, sessionId: string, input: { candidate_ids?: string[] }) {
  const session = await sessionForActor(actor, sessionId);
  let query = supabaseAdmin.from("infrastructure_discovery_candidates").select("id").eq("session_id", session.id).eq("discovery_status", "verified");
  if (input.candidate_ids?.length) query = query.in("id", input.candidate_ids);
  const { data, error } = await query;
  if (error) throw error;
  const promoted = [];
  const failures = [];
  for (const row of data || []) {
    try {
      promoted.push(await promoteInfrastructureCandidate(actor, session.id, row.id));
    } catch (promotionError: any) {
      failures.push({ candidate_id: row.id, code: promotionError?.code || "promotion_failed", message: promotionError instanceof Error ? promotionError.message : "Promotion failed" });
    }
  }
  return { session: await refreshSessionSummary(session.id), promoted: promoted.map((item) => item.candidate), failures };
}

export async function infrastructureProviderCatalog(actor: OnboardingActor) {
  const estateId = actorEstate(actor);
  const [connectionsResult, edgeResult] = await Promise.all([
    supabaseAdmin.from("infrastructure_provider_connections").select("*").eq("estate_id", estateId),
    supabaseAdmin.from("edge_nodes").select("id,heartbeat_status,last_seen_at").eq("estate_id", estateId),
  ]);
  if (connectionsResult.error) throw connectionsResult.error;
  const connections = connectionsResult.data || [];
  const edgeOnline = (edgeResult.data || []).some((row: any) => ["online", "healthy", "active"].includes(lower(row.heartbeat_status)));
  const tuyaUid = await getTuyaUidForUser(actor.id);
  return listInfrastructureProviderManifests().map((manifest) => {
    const connection = connections.find((row: any) => row.provider_key === manifest.key) || null;
    const needsEdge = manifest.requires_edge && !edgeOnline;
    const needsAdapter = ["adapter_required", "future"].includes(manifest.implementation) || !manifest.adapter_registered;
    const needsCredentials = manifest.key === "tuya" && !tuyaUid;
    const readiness = needsAdapter ? (manifest.implementation === "future" ? "unsupported" : "needs_adapter") : needsEdge ? "needs_edge" : needsCredentials ? "needs_credentials" : connection?.authentication_status === "failed" ? "needs_credentials" : "ready";
    return {
      ...manifest,
      readiness,
      connection: connection ? {
        id: connection.id,
        authentication_method: connection.authentication_method,
        authentication_status: connection.authentication_status,
        credential_ref_present: Boolean(connection.credential_ref),
        last_verified_at: connection.last_verified_at,
        last_error_code: connection.last_error_code,
      } : null,
    };
  });
}

export async function getInfrastructureOnboardingSession(actor: OnboardingActor, sessionId: string) {
  const session = await sessionForActor(actor, sessionId);
  const [candidates, verifications, events, connections] = await Promise.all([
    supabaseAdmin.from("infrastructure_discovery_candidates").select("*").eq("session_id", session.id).order("created_at"),
    supabaseAdmin.from("infrastructure_onboarding_verifications").select("*").eq("session_id", session.id).order("verified_at", { ascending: false }),
    supabaseAdmin.from("infrastructure_onboarding_events").select("*").eq("session_id", session.id).order("occurred_at", { ascending: false }),
    supabaseAdmin.from("infrastructure_provider_connections").select("id,provider_key,adapter_key,authentication_method,authentication_status,credential_ref,external_account_id,last_verified_at,last_error_code,metadata").eq("onboarding_session_id", session.id),
  ]);
  const firstError = candidates.error || verifications.error || events.error || connections.error;
  if (firstError) throw firstError;
  return {
    session,
    candidates: (candidates.data || []).map((row: any) => ({ ...row, provider_metadata: sanitizeOnboardingMetadata(row.provider_metadata) })),
    verifications: verifications.data || [],
    events: events.data || [],
    connections: (connections.data || []).map((row: any) => ({ ...row, credential_ref: row.credential_ref ? "configured" : null })),
  };
}

export async function getInfrastructureOnboardingOverview(actor: OnboardingActor) {
  const estateId = actorEstate(actor);
  const [sessions, partners, connections] = await Promise.all([
    supabaseAdmin.from("infrastructure_onboarding_sessions").select("*").eq("estate_id", estateId).order("created_at", { ascending: false }).limit(50),
    supabaseAdmin.from("infrastructure_partners").select("id,name,partner_type,status,certification_status").eq("status", "active").order("name"),
    supabaseAdmin.from("infrastructure_provider_connections").select("id,provider_key,adapter_key,authentication_method,authentication_status,credential_ref,last_verified_at,last_error_code").eq("estate_id", estateId),
  ]);
  const firstError = sessions.error || partners.error || connections.error;
  if (firstError) throw firstError;
  const latest = sessions.data?.[0] || null;
  const detail = latest ? await getInfrastructureOnboardingSession(actor, latest.id) : null;
  return {
    estate_id: estateId,
    sessions: sessions.data || [],
    latest: detail,
    partners: partners.data || [],
    providers: await infrastructureProviderCatalog(actor),
    connections: (connections.data || []).map((row: any) => ({ ...row, credential_ref: row.credential_ref ? "configured" : null })),
  };
}
