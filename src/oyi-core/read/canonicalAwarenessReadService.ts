// Wave 6 Slice 2 -- Canonical Awareness Read Path.
//
// This is the one authoritative READ boundary for what Oyi Core's canonical
// write lifecycle (submitCanonicalSignal -> oyiCoreRuntime.receiveSignal ->
// UniversalSignalRuntime -> buildAwarenessFromSignal/correlateIncident ->
// canonicalIntelligenceStore.recordBundle) has persisted into
// operational_awareness / operational_incidents / operational_insights /
// operational_recommendations / operational_plans.
//
// Hard rules this file exists to enforce (see docs/WAVE6_AWARENESS_STATE_AUDIT.md
// and the Slice 1 / Slice 1B reports this repo already contains):
//   1. SURFACE IS NOT AUTHORITY. Every function below takes the authenticated
//      actor and a server-resolved OisContext; nothing here ever derives
//      visibility from a client-supplied surface string alone.
//   2. DERIVED INTELLIGENCE MUST NOT EXPOSE MORE THAN SOURCE EVIDENCE
//      AUTHORITY. Camera-derived awareness is re-checked against
//      cameraAccess.policy.ts before its content is returned, exactly as
//      Slice 1 already enforces for the legacy ambient-awareness feed.
//   3. NO LEGACY FALLBACK. If canonical rows are absent or unresolvable,
//      the result is a truthful empty/unavailable outcome -- never a
//      silent substitution of intelligence-core / oyiUnifiedIntelligenceService
//      output. See listActiveAwareness's coverage_gap accounting for the
//      one honest, disclosed exception to "every row is scoped": awareness
//      rows written with no incident_id (see KNOWN GAP below) are excluded,
//      not guessed at.
//
// KNOWN GAP (see Slice 2 final report "canonical write lifecycle" section
// for the full trace): operational_awareness has no estate_id/home_id
// column of its own. Scope is resolved via incident_id -> operational_incidents
// (estate_id, home_id, privacy_class, scope jsonb), which is reliably
// present for every signal that correlateIncident() does not filter out.
// correlateIncident() deliberately returns null for command-lifecycle
// acks, user-initiated "off" actions, expired-only pings, audit-recursion,
// and routine info-severity private signals -- buildAwarenessFromSignal()
// still runs unconditionally for those, producing operational_awareness
// rows with incident_id = null. There is no reliable, indexed way to
// recover scope for those rows from persisted canonical truth today (the
// only candidate join, related_signals[0] -> a signal's own id, does not
// match any indexed column on operational_signals -- the business signal
// id only exists inside operational_signals.payload->signal->>'id', a jsonb
// path with no index). Per this slice's mandate ("Unknown remains unknown";
// "if the current implementation cannot support a privacy-safe read
// contract, STOP and report the exact missing field"), this service
// intentionally EXCLUDES incident_id-less awareness rows from every read
// path rather than guessing their scope. This is reported, not silently
// patched -- see the Slice 2 final report for the exact missing
// relationship (a plain, indexed operational_signals.id-compatible column
// on operational_awareness, or a plain signal_id column) that would close
// this gap in a future slice.

import { supabaseAdmin } from "../../supabase/supabaseClient";
import { logger } from "../../observability/logger";
import type { AuthUser } from "../../middleware/auth";
import type { OisContext } from "../../types/oisContext";
import { getIntelligencePermissionPolicy } from "../../intelligence-core/permissionEngine";
import { canAccessCamera, cameraAccessActor } from "../../modules/cameras/cameraAccess.policy";
import { isPrivateAudienceClass } from "../policy/intelligencePolicyResolver";

// ---------------------------------------------------------------------
// Read contract types
// ---------------------------------------------------------------------

export type CanonicalScope = {
  estateId: string | null;
  homeId: string | null;
  buildingId: string | null;
  roomId: string | null;
};

export type CanonicalFreshness = "current" | "stale" | "unspecified";

export type EvidenceReference = {
  // Reference only -- id/type/source-table pointers into the evidence the
  // canonical write path already recorded. Never the raw evidence payload
  // itself (see module header: evidence reference vs evidence content).
  type: string | null;
  id: string | null;
  sourceTable?: string | null;
  timestamp?: string | null;
};

export type AwarenessReadItem = {
  awarenessId: string;
  awarenessKey: string;
  incidentId: string | null;
  incidentKey: string | null;
  domain: string | null;
  title: string;
  summary: string;
  reason: string | null;
  impact: string | null;
  urgency: string | null;
  confidence: number | null;
  owner: string | null;
  recommendedAction: string | null;
  verification: string | null;
  status: string;
  generatedAt: string;
  updatedAt: string;
  expiresAt: string | null;
  freshness: CanonicalFreshness;
  scope: CanonicalScope;
  privacyClass: string | null;
  relatedSignals: string[];
  relatedExecutions: string[];
  // A single, most-relevant execution pointer the write path also tracks
  // separately from relatedExecutions[] (contextAwareness.ts's
  // OperationalAwareness.executionReference). Preserved as-is -- per Wave 5,
  // its mere presence is never treated as proof of physical state.
  executionReference: string | null;
  evidence: EvidenceReference[];
  sourceEntity: { type: string | null; id: string | null } | null;
};

export type IncidentReadItem = {
  incidentId: string;
  incidentKey: string;
  incidentType: string;
  domain: string;
  title: string;
  status: string;
  severity: string;
  confidence: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  summary: string | null;
  affectedEntities: Array<Record<string, unknown>>;
  evidence: EvidenceReference[];
  scope: CanonicalScope;
  privacyClass: string;
  parentIncidentId: string | null;
};

export type RecommendationReadItem = {
  recommendationId: string;
  recommendationKey: string;
  incidentId: string | null;
  actionType: string;
  title: string;
  summary: string;
  reason: string | null;
  expectedImpact: string | null;
  confidence: number | null;
  urgency: string | null;
  riskClass: string | null;
  verificationRequired: boolean;
  approvalRequired: boolean;
  status: string;
  scope: CanonicalScope;
  privacyClass: string | null;
  generatedAt: string;
  expiresAt: string | null;
};

export type InsightReadItem = {
  insightId: string;
  incidentId: string | null;
  domain: string;
  insightType: string;
  title: string;
  summary: string;
  reason: string | null;
  impact: string | null;
  confidence: number | null;
  evidence: EvidenceReference[];
  status: string;
  generatedAt: string;
  scope: CanonicalScope | null;
  privacyClass: string | null;
};

export type PlanReadItem = {
  planId: string;
  recommendationId: string | null;
  planType: string;
  canonicalOperationId: string | null;
  approvalState: string | null;
  status: string;
  generatedAt: string;
  expiresAt: string | null;
  scope: CanonicalScope | null;
  privacyClass: string | null;
};

// Deliberately no estateId/homeId here: scope always comes from the
// server-verified actor/oisContext (resolveActorAuthority), never from a
// caller-supplied filter -- that would be exactly the "surface expands
// authority" pattern Slice 1B closed. Filters may only narrow within the
// actor's own authority (e.g. domain), never redirect it.
export type ReadFilters = {
  domain?: string | null;
  limit?: number;
  includeResolved?: boolean;
};

export type ReadOutcome<T> = {
  ok: boolean;
  items: T[];
  coverageGap: {
    // How many canonical rows existed in the actor's estate but were
    // excluded from this result because their scope could not be
    // resolved (incident_id null). Diagnostic only -- never used to
    // fabricate a row.
    scopeUnresolvedExcluded: number;
  };
  reason?: string;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(limit: unknown) {
  const n = Number.parseInt(String(limit ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, n));
}

function text(value: unknown, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

// ---------------------------------------------------------------------
// Actor scope authority -- reuses exactly what Slice 1 / Slice 1B
// established. Never derives visibility from oisContext.surface alone.
// ---------------------------------------------------------------------

type ActorAuthority = {
  policyScope: "home" | "estate" | "office" | "system";
  estateId: string | null;
  homeId: string | null;
  canViewPrivateHome: boolean;
};

function resolveActorAuthority(actor: AuthUser, oisContext: OisContext | null | undefined): ActorAuthority {
  const policy = getIntelligencePermissionPolicy(actor);
  // Wave 6 Slice 1B precedent: the server-verified oisContext estate/home
  // (membership-checked, and after Slice 1 cannot itself leak a home the
  // actor doesn't have) must win over the raw, potentially-stale actor.*
  // JWT fields.
  const estateId = text(oisContext?.estate_id || actor.estate_id) || null;
  const homeId = text(oisContext?.home_id || actor.home_id) || null;
  return {
    policyScope: policy.scope,
    estateId,
    homeId,
    canViewPrivateHome: policy.can_view_private_home,
  };
}

// Core scope+privacy gate. Given a row's resolved CanonicalScope and
// privacy_class, decide whether this actor may see it. This is the ONLY
// place that decision is made -- every list/get function below routes
// through it rather than re-implementing scope logic.
function actorMayViewScope(authority: ActorAuthority, scope: CanonicalScope, privacyClass: string | null | undefined): boolean {
  // Cross-estate is always denied, for every role, per Slice 1B section 8.
  if (authority.estateId && scope.estateId && scope.estateId !== authority.estateId) return false;
  if (!authority.estateId) return false; // no verified estate at all -> fail closed

  if (authority.policyScope === "home") {
    // Resident: only their own verified home. A row scoped to no
    // specific home (estate/building-wide operational awareness) is not
    // resident-visible by default -- residents get their own home's
    // awareness, not the estate's operational feed.
    if (!authority.homeId || !scope.homeId) return false;
    return scope.homeId === authority.homeId;
  }

  // Non-resident (estate/office/system scope): estate match already
  // confirmed above. Private-audience classes (resident_device_private /
  // smart_access_private / home_private) must still be denied to
  // facility/security/finance/maintenance actors -- this mirrors
  // intelligencePolicyResolver.ts's facilityProjectionPermitted exactly
  // (isPrivateAudienceClass), reused rather than re-derived.
  if (isPrivateAudienceClass(privacyClass)) {
    // Only an actor who is explicitly allowed to view private-home
    // content (estate_admin, super_admin, ochiga_admin -- the same
    // can_view_private_home flag Slice 1's contextResolutionService.ts
    // and permissionEngine.ts already compute) may cross this boundary,
    // and only for their own estate (already checked above).
    return authority.canViewPrivateHome;
  }
  return true;
}

// ---------------------------------------------------------------------
// Freshness -- uses only what the canonical write contract already
// persists (expires_at). No universal TTL invented, per this slice's
// explicit instruction.
// ---------------------------------------------------------------------

function classifyFreshness(expiresAt: string | null | undefined): CanonicalFreshness {
  if (!expiresAt) return "unspecified";
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return "unspecified";
  return Date.now() < expiry ? "current" : "stale";
}

// ---------------------------------------------------------------------
// Camera source-evidence privacy -- reuses cameraAccess.policy.ts exactly
// as Slice 1's ambient-awareness fix does. Batches lookups (Section 21).
// ---------------------------------------------------------------------

async function loadCameraLookupForEntities(entityRefs: Array<{ type: string | null; id: string | null }>): Promise<Map<string, any>> {
  const ids = Array.from(
    new Set(
      entityRefs
        .filter((ref) => text(ref.type).toLowerCase() === "camera" && text(ref.id))
        .map((ref) => text(ref.id))
    )
  );
  const lookup = new Map<string, any>();
  if (!ids.length) return lookup;
  const { data, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("id,estate_id,home_id,privacy_scope,metadata")
    .in("id", ids);
  if (error || !data) return lookup;
  for (const camera of data) lookup.set(text((camera as any).id), camera);
  return lookup;
}

function cameraContentAllowed(actor: AuthUser, oisContext: OisContext | null | undefined, sourceEntity: { type: string | null; id: string | null } | null, cameraLookup: Map<string, any>): boolean {
  if (!sourceEntity || text(sourceEntity.type).toLowerCase() !== "camera") return true; // not camera-derived; domain/estate scope already gates it
  const cameraId = text(sourceEntity.id);
  if (!cameraId) return false; // camera-derived but unidentifiable -> fail closed
  const camera = cameraLookup.get(cameraId);
  if (!camera) return false; // could not resolve the source camera row -> fail closed
  return canAccessCamera(camera, cameraAccessActor(actor, oisContext ? { estate_id: oisContext.estate_id, home_id: oisContext.home_id } : null)).ok;
}

// ---------------------------------------------------------------------
// Incident scope resolution (batched)
// ---------------------------------------------------------------------

type IncidentScopeRow = {
  id: string;
  incident_key: string;
  estate_id: string | null;
  home_id: string | null;
  privacy_class: string;
  scope: Record<string, unknown> | null;
  status: string;
};

async function loadIncidentScopeById(incidentIds: string[]): Promise<Map<string, IncidentScopeRow>> {
  const ids = Array.from(new Set(incidentIds.filter(Boolean)));
  const map = new Map<string, IncidentScopeRow>();
  if (!ids.length) return map;
  const { data, error } = await supabaseAdmin
    .from("operational_incidents")
    .select("id,incident_key,estate_id,home_id,privacy_class,scope,status")
    .in("id", ids);
  if (error || !data) return map;
  for (const row of data as any[]) map.set(text(row.id), row);
  return map;
}

function scopeFromIncidentRow(row: IncidentScopeRow | undefined): CanonicalScope {
  const jsonScope = (row?.scope || {}) as Record<string, unknown>;
  return {
    estateId: text(row?.estate_id || jsonScope.estate_id) || null,
    homeId: text(row?.home_id || jsonScope.home_id) || null,
    buildingId: text(jsonScope.building_id) || null,
    roomId: text(jsonScope.room_id) || null,
  };
}

function entityFromIncidentRow(row: IncidentScopeRow | undefined): { type: string | null; id: string | null } | null {
  const jsonScope = (row?.scope || {}) as Record<string, unknown>;
  const type = text(jsonScope.entity_type) || null;
  const id = text(jsonScope.entity_id) || null;
  if (!type && !id) return null;
  return { type, id };
}

// ---------------------------------------------------------------------
// AWARENESS
// ---------------------------------------------------------------------

function mapAwarenessRow(row: any, incidentRow: IncidentScopeRow | undefined): AwarenessReadItem {
  const scope = scopeFromIncidentRow(incidentRow);
  // recordBundle() persists payload: item where item is the full
  // OperationalAwareness object (contextAwareness.ts) -- its evidence
  // array is keyed supporting_evidence, not evidence.
  const evidence: EvidenceReference[] = Array.isArray(row.payload?.supporting_evidence)
    ? row.payload.supporting_evidence.map((item: any) => ({ type: text(item?.type) || null, id: text(item?.id) || null, sourceTable: text(item?.source) || null, timestamp: text(item?.timestamp) || null }))
    : [];
  return {
    awarenessId: text(row.id),
    awarenessKey: text(row.awareness_key),
    incidentId: text(row.incident_id) || null,
    incidentKey: incidentRow ? text(incidentRow.incident_key) : null,
    domain: incidentRow ? text((incidentRow as any).domain) || null : null,
    title: text(row.title),
    summary: text(row.summary),
    reason: text(row.reason) || null,
    impact: text(row.impact) || null,
    urgency: text(row.urgency) || null,
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    owner: text(row.owner) || null,
    recommendedAction: text(row.recommended_action) || null,
    verification: text(row.verification) || null,
    status: text(row.status, "open") || "open",
    generatedAt: text(row.generated_at),
    updatedAt: text(row.updated_at),
    expiresAt: text(row.expires_at) || null,
    freshness: classifyFreshness(row.expires_at),
    scope,
    privacyClass: incidentRow ? text(incidentRow.privacy_class) || null : null,
    relatedSignals: Array.isArray(row.related_signals) ? row.related_signals.map(text) : [],
    relatedExecutions: Array.isArray(row.related_executions) ? row.related_executions.map(text) : [],
    executionReference: text(row.payload?.executionReference) || null,
    evidence,
    sourceEntity: entityFromIncidentRow(incidentRow),
  };
}

// listActiveAwareness -- default "what does Oyi Core currently believe"
// view: status "open" only (never suppressed, never resolved unless
// includeResolved is requested), scoped to the actor's authority, with
// camera-derived rows additionally re-checked against
// cameraAccess.policy.ts before their content is returned.
export async function listActiveAwareness(actor: AuthUser, oisContext: OisContext | null | undefined, filters: ReadFilters = {}): Promise<ReadOutcome<AwarenessReadItem>> {
  const started = Date.now();
  const authority = resolveActorAuthority(actor, oisContext);
  if (!authority.estateId) {
    recordMetric("canonical_awareness_read_denied_total", { reason: "no_verified_estate" });
    return { ok: false, items: [], coverageGap: { scopeUnresolvedExcluded: 0 }, reason: "no_verified_estate" };
  }
  const limit = clampLimit(filters.limit);
  const statuses = filters.includeResolved ? ["open", "resolved"] : ["open"];

  try {
    let query = supabaseAdmin
      .from("operational_awareness")
      .select("id,incident_id,awareness_key,audience,status,title,summary,reason,impact,urgency,owner,recommended_action,verification,confidence,related_signals,related_executions,payload,generated_at,updated_at,expires_at")
      .in("status", statuses)
      .not("incident_id", "is", null)
      .order("generated_at", { ascending: false })
      .limit(limit * 3); // over-fetch before scope filtering; see note below
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data || []) as any[];

    // Count scope-unresolved rows honestly (same page, excluded above via
    // .not("incident_id","is",null) -- run a lightweight count separately
    // so callers can see the coverage gap without paying for the full rows).
    const { count: unresolvedCount } = await supabaseAdmin
      .from("operational_awareness")
      .select("id", { count: "exact", head: true })
      .in("status", statuses)
      .is("incident_id", null);

    const incidentIds = rows.map((row) => text(row.incident_id)).filter(Boolean);
    const incidentById = await loadIncidentScopeById(incidentIds);

    const scopedRows = rows.filter((row) => {
      const incidentRow = incidentById.get(text(row.incident_id));
      if (!incidentRow) return false; // dangling incident_id -> fail closed, not fabricated
      if (filters.domain && text((incidentRow as any).domain) !== filters.domain) return false;
      const scope = scopeFromIncidentRow(incidentRow);
      return actorMayViewScope(authority, scope, incidentRow.privacy_class);
    });

    const cameraLookup = await loadCameraLookupForEntities(
      scopedRows.map((row) => entityFromIncidentRow(incidentById.get(text(row.incident_id))) || { type: null, id: null })
    );

    const items = scopedRows
      .filter((row) => {
        const incidentRow = incidentById.get(text(row.incident_id));
        const entity = entityFromIncidentRow(incidentRow);
        return cameraContentAllowed(actor, oisContext, entity, cameraLookup);
      })
      .slice(0, limit)
      .map((row) => mapAwarenessRow(row, incidentById.get(text(row.incident_id))));

    recordMetric("canonical_awareness_read_total", { count: items.length });
    recordMetric("canonical_awareness_items_returned", { count: items.length });
    recordMetric("canonical_awareness_read_latency_ms", { ms: Date.now() - started });
    return { ok: true, items, coverageGap: { scopeUnresolvedExcluded: unresolvedCount || 0 } };
  } catch (error: any) {
    logger.warn("canonical_awareness_read_failed", { error: error?.message || String(error) });
    return { ok: false, items: [], coverageGap: { scopeUnresolvedExcluded: 0 }, reason: error?.message || "read_failed" };
  }
}

export async function getAwareness(actor: AuthUser, oisContext: OisContext | null | undefined, awarenessId: string): Promise<{ ok: boolean; item: AwarenessReadItem | null; reason?: string }> {
  const authority = resolveActorAuthority(actor, oisContext);
  const cleanId = text(awarenessId);
  if (!authority.estateId || !cleanId) return { ok: false, item: null, reason: "invalid_request" };
  try {
    const { data: row, error } = await supabaseAdmin
      .from("operational_awareness")
      .select("id,incident_id,awareness_key,audience,status,title,summary,reason,impact,urgency,owner,recommended_action,verification,confidence,related_signals,related_executions,payload,generated_at,updated_at,expires_at")
      .eq("id", cleanId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return { ok: false, item: null, reason: "not_found" };
    if (!row.incident_id) return { ok: false, item: null, reason: "scope_unresolved" }; // known gap -- fail closed, not fabricated
    const incidentById = await loadIncidentScopeById([text(row.incident_id)]);
    const incidentRow = incidentById.get(text(row.incident_id));
    if (!incidentRow) return { ok: false, item: null, reason: "not_found" };
    const scope = scopeFromIncidentRow(incidentRow);
    if (!actorMayViewScope(authority, scope, incidentRow.privacy_class)) {
      recordMetric("canonical_awareness_read_denied_total", { reason: "scope_denied" });
      return { ok: false, item: null, reason: "denied" };
    }
    const entity = entityFromIncidentRow(incidentRow);
    const cameraLookup = await loadCameraLookupForEntities([entity || { type: null, id: null }]);
    if (!cameraContentAllowed(actor, oisContext, entity, cameraLookup)) {
      recordMetric("canonical_awareness_read_denied_total", { reason: "camera_denied" });
      return { ok: false, item: null, reason: "denied" };
    }
    recordMetric("canonical_awareness_read_total", { count: 1 });
    return { ok: true, item: mapAwarenessRow(row, incidentRow) };
  } catch (error: any) {
    logger.warn("canonical_awareness_get_failed", { error: error?.message || String(error), awareness_id: cleanId });
    return { ok: false, item: null, reason: error?.message || "read_failed" };
  }
}

// ---------------------------------------------------------------------
// INCIDENTS
// ---------------------------------------------------------------------

function mapIncidentRow(row: any): IncidentReadItem {
  const jsonScope = (row.scope || {}) as Record<string, unknown>;
  return {
    incidentId: text(row.id),
    incidentKey: text(row.incident_key),
    incidentType: text(row.incident_type),
    domain: text(row.domain),
    title: text(row.title),
    status: text(row.status, "open") || "open",
    severity: text(row.severity, "info") || "info",
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    firstSeenAt: text(row.first_seen_at),
    lastSeenAt: text(row.last_seen_at),
    resolvedAt: text(row.resolved_at) || null,
    summary: text(row.current_summary) || null,
    affectedEntities: Array.isArray(row.affected_entities) ? row.affected_entities : [],
    evidence: Array.isArray(row.evidence) ? row.evidence.map((item: any) => ({ type: text(item?.type) || null, id: text(item?.id) || null, sourceTable: text(item?.source) || null, timestamp: text(item?.timestamp) || null })) : [],
    scope: { estateId: text(row.estate_id) || null, homeId: text(row.home_id) || null, buildingId: text(jsonScope.building_id) || null, roomId: text(jsonScope.room_id) || null },
    privacyClass: text(row.privacy_class),
    parentIncidentId: text(row.parent_incident_id) || null,
  };
}

export async function listIncidents(actor: AuthUser, oisContext: OisContext | null | undefined, filters: ReadFilters & { status?: string | null } = {}): Promise<ReadOutcome<IncidentReadItem>> {
  const authority = resolveActorAuthority(actor, oisContext);
  if (!authority.estateId) return { ok: false, items: [], coverageGap: { scopeUnresolvedExcluded: 0 }, reason: "no_verified_estate" };
  const limit = clampLimit(filters.limit);
  try {
    let query = supabaseAdmin
      .from("operational_incidents")
      .select("id,incident_key,incident_type,domain,title,scope,privacy_class,status,severity,confidence,first_seen_at,last_seen_at,resolved_at,current_summary,affected_entities,evidence,parent_incident_id,estate_id,home_id")
      .eq("estate_id", authority.estateId)
      .order("last_seen_at", { ascending: false })
      .limit(limit * 2);
    if (filters.status) query = query.eq("status", filters.status);
    else if (!filters.includeResolved) query = query.neq("status", "resolved");
    if (filters.domain) query = query.eq("domain", filters.domain);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data || []) as any[];
    const entityRefs = rows.map((row) => {
      const jsonScope = (row.scope || {}) as Record<string, unknown>;
      return { type: text(jsonScope.entity_type) || null, id: text(jsonScope.entity_id) || null };
    });
    const cameraLookup = await loadCameraLookupForEntities(entityRefs);
    const items = rows
      .filter((row) => {
        const scope: CanonicalScope = { estateId: text(row.estate_id) || null, homeId: text(row.home_id) || null, buildingId: null, roomId: null };
        if (!actorMayViewScope(authority, scope, row.privacy_class)) return false;
        const jsonScope = (row.scope || {}) as Record<string, unknown>;
        const entity = { type: text(jsonScope.entity_type) || null, id: text(jsonScope.entity_id) || null };
        return cameraContentAllowed(actor, oisContext, entity.type ? entity : null, cameraLookup);
      })
      .slice(0, limit)
      .map(mapIncidentRow);
    return { ok: true, items, coverageGap: { scopeUnresolvedExcluded: 0 } };
  } catch (error: any) {
    logger.warn("canonical_incident_list_failed", { error: error?.message || String(error) });
    return { ok: false, items: [], coverageGap: { scopeUnresolvedExcluded: 0 }, reason: error?.message || "read_failed" };
  }
}

export async function getIncident(actor: AuthUser, oisContext: OisContext | null | undefined, incidentId: string): Promise<{ ok: boolean; item: IncidentReadItem | null; reason?: string }> {
  const authority = resolveActorAuthority(actor, oisContext);
  const cleanId = text(incidentId);
  if (!authority.estateId || !cleanId) return { ok: false, item: null, reason: "invalid_request" };
  try {
    const { data: row, error } = await supabaseAdmin
      .from("operational_incidents")
      .select("id,incident_key,incident_type,domain,title,scope,privacy_class,status,severity,confidence,first_seen_at,last_seen_at,resolved_at,current_summary,affected_entities,evidence,parent_incident_id,estate_id,home_id")
      .eq("id", cleanId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return { ok: false, item: null, reason: "not_found" };
    const scope: CanonicalScope = { estateId: text(row.estate_id) || null, homeId: text(row.home_id) || null, buildingId: null, roomId: null };
    if (!actorMayViewScope(authority, scope, row.privacy_class)) return { ok: false, item: null, reason: "denied" };
    const jsonScope = (row.scope || {}) as Record<string, unknown>;
    const entity = { type: text(jsonScope.entity_type) || null, id: text(jsonScope.entity_id) || null };
    const cameraLookup = await loadCameraLookupForEntities([entity]);
    if (!cameraContentAllowed(actor, oisContext, entity.type ? entity : null, cameraLookup)) return { ok: false, item: null, reason: "denied" };
    return { ok: true, item: mapIncidentRow(row) };
  } catch (error: any) {
    logger.warn("canonical_incident_get_failed", { error: error?.message || String(error), incident_id: cleanId });
    return { ok: false, item: null, reason: error?.message || "read_failed" };
  }
}

// Correlated observations for one incident -- lets a later surface "group
// by incident, show latest awareness, inspect supporting observations"
// (Section 12) without redesigning incidentCorrelation.ts; this only reads
// the awareness rows that already carry this incident_id.
export async function listAwarenessForIncident(actor: AuthUser, oisContext: OisContext | null | undefined, incidentId: string): Promise<ReadOutcome<AwarenessReadItem>> {
  const incident = await getIncident(actor, oisContext, incidentId);
  if (!incident.ok || !incident.item) return { ok: false, items: [], coverageGap: { scopeUnresolvedExcluded: 0 }, reason: incident.reason || "not_found" };
  try {
    const { data, error } = await supabaseAdmin
      .from("operational_awareness")
      .select("id,incident_id,awareness_key,audience,status,title,summary,reason,impact,urgency,owner,recommended_action,verification,confidence,related_signals,related_executions,payload,generated_at,updated_at,expires_at")
      .eq("incident_id", text(incidentId))
      .order("generated_at", { ascending: false });
    if (error) throw error;
    const incidentById = await loadIncidentScopeById([text(incidentId)]);
    const incidentRow = incidentById.get(text(incidentId));
    const items = ((data || []) as any[]).map((row) => mapAwarenessRow(row, incidentRow));
    return { ok: true, items, coverageGap: { scopeUnresolvedExcluded: 0 } };
  } catch (error: any) {
    logger.warn("canonical_awareness_for_incident_failed", { error: error?.message || String(error), incident_id: incidentId });
    return { ok: false, items: [], coverageGap: { scopeUnresolvedExcluded: 0 }, reason: error?.message || "read_failed" };
  }
}

// ---------------------------------------------------------------------
// RECOMMENDATIONS -- these carry their own estate_id/home_id/privacy_class
// columns directly (no incident join needed for scope).
// ---------------------------------------------------------------------

function mapRecommendationRow(row: any): RecommendationReadItem {
  return {
    recommendationId: text(row.id),
    recommendationKey: text(row.recommendation_key),
    incidentId: text(row.incident_id) || null,
    actionType: text(row.action_type),
    title: text(row.title),
    summary: text(row.summary),
    reason: text(row.reason) || null,
    expectedImpact: text(row.expected_impact) || null,
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    urgency: text(row.urgency) || null,
    riskClass: text(row.risk_class) || null,
    verificationRequired: Boolean(row.verification_required),
    approvalRequired: Boolean(row.approval_required),
    status: text(row.status, "pending") || "pending",
    scope: { estateId: text(row.estate_id) || null, homeId: text(row.home_id) || null, buildingId: null, roomId: null },
    privacyClass: text(row.privacy_class) || null,
    generatedAt: text(row.generated_at),
    expiresAt: text(row.expires_at) || null,
  };
}

export async function listRecommendations(actor: AuthUser, oisContext: OisContext | null | undefined, filters: ReadFilters & { status?: string | null } = {}): Promise<ReadOutcome<RecommendationReadItem>> {
  const authority = resolveActorAuthority(actor, oisContext);
  if (!authority.estateId) return { ok: false, items: [], coverageGap: { scopeUnresolvedExcluded: 0 }, reason: "no_verified_estate" };
  const limit = clampLimit(filters.limit);
  try {
    let query = supabaseAdmin
      .from("operational_recommendations")
      .select("id,incident_id,recommendation_key,action_type,title,summary,reason,expected_impact,confidence,urgency,risk_class,verification_required,approval_required,status,estate_id,home_id,privacy_class,generated_at,expires_at")
      .eq("estate_id", authority.estateId)
      .order("generated_at", { ascending: false })
      .limit(limit * 2);
    if (filters.status) query = query.eq("status", filters.status);
    const { data, error } = await query;
    if (error) throw error;
    const items = ((data || []) as any[])
      .filter((row) => actorMayViewScope(authority, { estateId: text(row.estate_id) || null, homeId: text(row.home_id) || null, buildingId: null, roomId: null }, row.privacy_class))
      .slice(0, limit)
      .map(mapRecommendationRow);
    return { ok: true, items, coverageGap: { scopeUnresolvedExcluded: 0 } };
  } catch (error: any) {
    logger.warn("canonical_recommendation_list_failed", { error: error?.message || String(error) });
    return { ok: false, items: [], coverageGap: { scopeUnresolvedExcluded: 0 }, reason: error?.message || "read_failed" };
  }
}

// ---------------------------------------------------------------------
// INSIGHTS -- no scope columns of their own; resolved via incident_id
// exactly like awareness. insight_type/reasoning_version preserved as-is
// (not reinterpreted as a recommendation or a fact).
// ---------------------------------------------------------------------

function mapInsightRow(row: any, incidentRow: IncidentScopeRow | undefined): InsightReadItem {
  return {
    insightId: text(row.id),
    incidentId: text(row.incident_id) || null,
    domain: text(row.domain),
    insightType: text(row.insight_type),
    title: text(row.title),
    summary: text(row.summary),
    reason: text(row.reason) || null,
    impact: text(row.impact) || null,
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    evidence: Array.isArray(row.evidence) ? row.evidence.map((item: any) => ({ type: text(item?.type) || null, id: text(item?.id) || null, sourceTable: text(item?.source) || null, timestamp: text(item?.timestamp) || null })) : [],
    status: text(row.status, "open") || "open",
    generatedAt: text(row.generated_at),
    scope: incidentRow ? scopeFromIncidentRow(incidentRow) : null,
    privacyClass: incidentRow ? text(incidentRow.privacy_class) || null : null,
  };
}

export async function listInsights(actor: AuthUser, oisContext: OisContext | null | undefined, filters: ReadFilters = {}): Promise<ReadOutcome<InsightReadItem>> {
  const authority = resolveActorAuthority(actor, oisContext);
  if (!authority.estateId) return { ok: false, items: [], coverageGap: { scopeUnresolvedExcluded: 0 }, reason: "no_verified_estate" };
  const limit = clampLimit(filters.limit);
  try {
    let query = supabaseAdmin
      .from("operational_insights")
      .select("id,incident_id,domain,insight_type,title,summary,reason,impact,confidence,evidence,status,generated_at")
      .not("incident_id", "is", null)
      .order("generated_at", { ascending: false })
      .limit(limit * 3);
    if (filters.domain) query = query.eq("domain", filters.domain);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data || []) as any[];
    const { count: unresolvedCount } = await supabaseAdmin.from("operational_insights").select("id", { count: "exact", head: true }).is("incident_id", null);
    const incidentById = await loadIncidentScopeById(rows.map((row) => text(row.incident_id)));
    const items = rows
      .filter((row) => {
        const incidentRow = incidentById.get(text(row.incident_id));
        if (!incidentRow) return false;
        return actorMayViewScope(authority, scopeFromIncidentRow(incidentRow), incidentRow.privacy_class);
      })
      .slice(0, limit)
      .map((row) => mapInsightRow(row, incidentById.get(text(row.incident_id))));
    return { ok: true, items, coverageGap: { scopeUnresolvedExcluded: unresolvedCount || 0 } };
  } catch (error: any) {
    logger.warn("canonical_insight_list_failed", { error: error?.message || String(error) });
    return { ok: false, items: [], coverageGap: { scopeUnresolvedExcluded: 0 }, reason: error?.message || "read_failed" };
  }
}

// ---------------------------------------------------------------------
// PLANS -- no scope columns; resolved via recommendation_id ->
// operational_recommendations (which does have estate_id/home_id).
// Existence of a plan is never treated as execution/physical success --
// Wave 5's "command accepted != physical state confirmed" is preserved
// verbatim; this contract exposes approval_state/status only.
// ---------------------------------------------------------------------

function mapPlanRow(row: any, recommendationScope: CanonicalScope | null, privacyClass: string | null): PlanReadItem {
  return {
    planId: text(row.id),
    recommendationId: text(row.recommendation_id) || null,
    planType: text(row.plan_type),
    canonicalOperationId: text(row.canonical_operation_id) || null,
    approvalState: text(row.approval_state) || null,
    status: text(row.status, "planned") || "planned",
    generatedAt: text(row.generated_at),
    expiresAt: text(row.expires_at) || null,
    scope: recommendationScope,
    privacyClass,
  };
}

export async function listPlans(actor: AuthUser, oisContext: OisContext | null | undefined, filters: ReadFilters = {}): Promise<ReadOutcome<PlanReadItem>> {
  const authority = resolveActorAuthority(actor, oisContext);
  if (!authority.estateId) return { ok: false, items: [], coverageGap: { scopeUnresolvedExcluded: 0 }, reason: "no_verified_estate" };
  const limit = clampLimit(filters.limit);
  try {
    const { data, error } = await supabaseAdmin
      .from("operational_plans")
      .select("id,recommendation_id,plan_type,canonical_operation_id,approval_state,status,generated_at,expires_at")
      .not("recommendation_id", "is", null)
      .order("generated_at", { ascending: false })
      .limit(limit * 3);
    if (error) throw error;
    const rows = (data || []) as any[];
    const { count: unresolvedCount } = await supabaseAdmin.from("operational_plans").select("id", { count: "exact", head: true }).is("recommendation_id", null);
    const recIds = Array.from(new Set(rows.map((row) => text(row.recommendation_id)).filter(Boolean)));
    const recById = new Map<string, any>();
    if (recIds.length) {
      const { data: recRows } = await supabaseAdmin.from("operational_recommendations").select("id,estate_id,home_id,privacy_class").in("id", recIds);
      for (const rec of recRows || []) recById.set(text((rec as any).id), rec);
    }
    const items = rows
      .filter((row) => {
        const rec = recById.get(text(row.recommendation_id));
        if (!rec) return false;
        return actorMayViewScope(authority, { estateId: text(rec.estate_id) || null, homeId: text(rec.home_id) || null, buildingId: null, roomId: null }, rec.privacy_class);
      })
      .slice(0, limit)
      .map((row) => {
        const rec = recById.get(text(row.recommendation_id));
        return mapPlanRow(row, rec ? { estateId: text(rec.estate_id) || null, homeId: text(rec.home_id) || null, buildingId: null, roomId: null } : null, rec ? text(rec.privacy_class) || null : null);
      });
    return { ok: true, items, coverageGap: { scopeUnresolvedExcluded: unresolvedCount || 0 } };
  } catch (error: any) {
    logger.warn("canonical_plan_list_failed", { error: error?.message || String(error) });
    return { ok: false, items: [], coverageGap: { scopeUnresolvedExcluded: 0 }, reason: error?.message || "read_failed" };
  }
}

// ---------------------------------------------------------------------
// Observability -- minimal, uses the existing logger convention rather
// than a new telemetry framework (Section 22).
// ---------------------------------------------------------------------

function recordMetric(name: string, fields: Record<string, unknown>) {
  logger.info(name, fields);
}
