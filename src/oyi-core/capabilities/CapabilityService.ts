import type { AuthUser } from "../../middleware/auth";
import { hasPermission, permissionsForRole } from "../../core/foundation";
import { logger } from "../../observability/logger";
import { operationalMetrics } from "../../observability/metrics";
import type { OisContext } from "../../types/oisContext";
import type { OyiSurface } from "../../services/oyiUnifiedIntelligenceService";
import type { CapabilityContext, CapabilityModule, CapabilityRolloutStatus } from "../contracts/capability";
import type { OyiEvidence, EvidenceReadOutcome, EvidenceScopeClass } from "../contracts/evidence";
import { evidenceReadOutcome, withinEvidenceDeadline } from "../evidence/EvidenceReadOutcome";
import { readOnlyEvidenceDb } from "../evidence/ReadOnlyEvidenceDb";
import { actorHasFacilityReadScope } from "../../intelligence-core/permissionEngine";
import type { SemanticFrame } from "../contracts/semanticFrame";
import { capabilityRegistry } from "./CapabilityRegistry";
import { capabilityEnabled } from "./CapabilityRollout";

export type CapabilityAuthorityResult = {
  allowed: boolean;
  reason: string | null;
  required_permissions: string[];
  surface: OyiSurface;
  scope: {
    estate_id: string | null;
    building_id: string | null;
    home_id: string | null;
    room_id: string | null;
  };
};

export type CapabilitySelection = {
  capability: CapabilityModule | null;
  matched_capability: CapabilityModule | null;
  rollout_status: CapabilityRolloutStatus | "not_registered";
  authority: CapabilityAuthorityResult | null;
  // The semantic frame, registry key, and final routing decision are
  // intentionally different concepts.  Keep this explicit so telemetry and
  // callers never describe a no-match as a missing `${domain}.${operation}`
  // capability (those strings are descriptive turn labels, not registry IDs).
  resolution_outcome: "matched" | "declared_disabled" | "permission_restricted" | "scope_restricted" | "surface_restricted" | "no_match";
  legacy_fallback_reason: string | null;
};

type ActorContext = {
  actor: AuthUser | null;
  oisContext: OisContext | null | undefined;
  surface: OyiSurface;
  scope: CapabilityAuthorityResult["scope"];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function actorPermissions(actor: AuthUser | null) {
  if (!actor) return [];
  return unique([...(actor.permissions || []), ...permissionsForRole(actor.role, actor.permission_scopes || [])]);
}

function permissionAliases(permission: string) {
  const aliases: Record<string, string[]> = {
    "wallet.read": ["wallets.read"],
    "maintenance.read": ["support.read"],
    "visitors.read": ["visitors.create", "visitors.manage"],
    "security.read": ["support.read", "visitors.manage", "cameras.view"],
    "utilities.read": ["services.read", "wallets.read"],
    "scenes.read": ["devices.read"],
    "automations.read": ["devices.read"],
    "messages.read": ["community.read"],
  };
  return [permission, ...(aliases[permission] || [])];
}

function hasAnyPermission(actor: AuthUser | null, permission: string) {
  if (!actor) return false;
  return permissionAliases(permission).some((candidate) => hasPermission(actor, candidate));
}

function scopeFrom(context: { actor: AuthUser | null; oisContext: OisContext | null | undefined; input?: { estate_id?: string | null; home_id?: string | null; room_id?: string | null; context?: unknown } }) {
  const requestContext = context.input?.context && typeof context.input.context === "object" && !Array.isArray(context.input.context)
    ? context.input.context as Record<string, unknown>
    : {};
  return {
    estate_id: context.input?.estate_id || context.oisContext?.estate_id || context.actor?.estate_id || null,
    building_id: text(requestContext.building_id || (context.oisContext as any)?.building_id) || null,
    home_id: context.input?.home_id || context.oisContext?.home_id || context.actor?.home_id || null,
    room_id: context.input?.room_id || text(requestContext.room_id) || null,
  };
}

function surfaceAllowed(module: CapabilityModule, surface: OyiSurface) {
  return !module.supported_surfaces?.length || module.supported_surfaces.includes(surface);
}

function publicSurfaceDenied(module: CapabilityModule, surface: OyiSurface) {
  if (surface !== "public_corporate") return null;
  if (["devices", "wallet", "maintenance", "visitors", "access", "security", "services", "community", "messages", "scenes", "automations", "cameras", "notifications", "incidents", "utilities"].includes(module.domain)) {
    return "public_corporate_surface_cannot_use_operational_capability";
  }
  return null;
}

function scopeAllowed(module: CapabilityModule, context: ActorContext) {
  const scopes = module.scope_requirements || [];
  for (const requirement of scopes) {
    if (!requirement.required) continue;
    if (requirement.scope === "home" && !context.scope.home_id) return "home_scope_required";
    if (requirement.scope === "estate" && !context.scope.estate_id) return "estate_scope_required";
    if (requirement.scope === "room" && !context.scope.room_id) return "room_scope_required";
    if (requirement.scope === "public_session" && !context.oisContext?.account_id && !context.oisContext?.actor_id && context.surface === "public_corporate") return "public_session_scope_required";
  }
  if (context.actor?.role === "resident" && context.scope.home_id && context.actor.home_id && context.scope.home_id !== context.actor.home_id) return "home_scope_not_owned_by_actor";
  if (context.actor?.role === "resident" && context.scope.estate_id && context.actor.estate_id && context.scope.estate_id !== context.actor.estate_id) return "estate_scope_not_authorized_for_actor";
  return null;
}

function privacyAllowed(module: CapabilityModule, evidence: OyiEvidence[], context: ActorContext) {
  for (const item of evidence) {
    if (item.privacy_class === "financial_sensitive" && context.surface !== "consumer") return "financial_evidence_restricted_to_consumer";
    if (item.privacy_class === "credential_sensitive") return "credential_evidence_not_allowed_for_read_capability";
    if (item.privacy_class === "resident_private" || item.privacy_class === "household_private") {
      if (context.surface === "facility" && module.domain === "wallet") return "resident_private_financial_evidence_restricted";
      if (context.surface === "public_corporate" || context.surface === "office_internal") return "resident_private_evidence_restricted_to_operational_surfaces";
    }
    if (item.privacy_class === "facility_sensitive" && (context.surface === "public_corporate" || context.surface === "office_internal")) {
      return "facility_sensitive_evidence_restricted_to_operational_surfaces";
    }
  }
  return null;
}

// IQ-9A: the requested SUBJECT scope is resolved before a private capability runs. A resident may only see their own home; a request for another
// person, a neighbour, other homes or the estate as a whole is denied here (never answered with the actor's own data), whatever role is claimed in chat.
function requestedScopeConflict(module: CapabilityModule, frame: SemanticFrame, surface: OyiSurface): string | null {
  const scope = frame.answerTarget?.subject_scope;
  if (surface !== "consumer" || !scope || scope === "own") return null;
  if (module.key.startsWith("global.") || module.domain === "global") return null;
  return "requested_scope_not_authorized";
}

function capabilityMatchScore(module: CapabilityModule, frame: SemanticFrame) {
  if (!module.supports(frame)) return 0;
  if ((module.operations || []).includes(frame.operation)) return 100;
  if (module.domain === frame.domain) return 25;
  return 10;
}

export class CapabilityService {
  describe(key: string) {
    return capabilityRegistry.get(key);
  }

  listForActor(input: { actor: AuthUser | null; oisContext: OisContext | null | undefined; surface: OyiSurface }) {
    const scope = scopeFrom({ actor: input.actor, oisContext: input.oisContext });
    return capabilityRegistry.all().map((capability) => {
      const authority = this.canUse(capability.key, { actor: input.actor, oisContext: input.oisContext, surface: input.surface, scope });
      return {
        key: capability.key,
        domain: capability.domain,
        operations: capability.operations || [],
        rollout_status: capability.rolloutStatus,
        risk_class: capability.risk_class || "read",
        supported_surfaces: capability.supported_surfaces || [],
        presentation_policy: capability.presentation_policy || null,
        authority,
      };
    }).filter((item) => item.rollout_status === "enabled" && item.authority.allowed);
  }

  canUse(key: string, input: { actor: AuthUser | null; oisContext: OisContext | null | undefined; surface: OyiSurface; scope?: CapabilityAuthorityResult["scope"] }): CapabilityAuthorityResult {
    const capability = capabilityRegistry.get(key);
    const scope = input.scope || scopeFrom({ actor: input.actor, oisContext: input.oisContext });
    const base = { surface: input.surface, scope, required_permissions: capability?.permission_requirements || [] };
    if (!capability) return { ...base, allowed: false, reason: "capability_not_registered" };
    if (capability.rolloutStatus !== "enabled") return { ...base, allowed: false, reason: `capability_${capability.rolloutStatus}` };
    if (!surfaceAllowed(capability, input.surface)) return { ...base, allowed: false, reason: "surface_not_supported" };
    const publicDenied = publicSurfaceDenied(capability, input.surface);
    if (publicDenied) return { ...base, allowed: false, reason: publicDenied };
    const scopeDenied = scopeAllowed(capability, { actor: input.actor, oisContext: input.oisContext, surface: input.surface, scope });
    if (scopeDenied) return { ...base, allowed: false, reason: scopeDenied };
    const required = capability.permission_requirements || [];
    const missing = required.filter((permission) => !hasAnyPermission(input.actor, permission));
    if (missing.length) return { ...base, allowed: false, reason: "missing_permission", required_permissions: missing };
    return { ...base, allowed: true, reason: null };
  }

  resolve(context: Omit<CapabilityContext, "legacyFallback">): CapabilitySelection {
    const surface = context.input.surface;
    const scope = scopeFrom({ actor: context.actor, oisContext: context.oisContext, input: context.input });
    const frame: SemanticFrame = context.resolvedTurn.semantic_frame;
    // A module's supports()/score is domain-only — it cannot see the
    // request surface (SemanticFrame carries no surface field), so two
    // modules covering the same domain on different surfaces can score
    // identically. Without this tie-break, whichever registered first
    // wins arbitrarily, which can select a module that's certain to be
    // denied for "surface_not_supported" over one that would have
    // actually answered. Prefer surface-compatible candidates first,
    // then fall back to score — this only narrows/reorders candidates
    // that already scored > 0, so it cannot make an otherwise-denied
    // capability newly authorized.
    let candidate = capabilityRegistry.all()
      .map((module) => ({ module, score: capabilityMatchScore(module, frame), surfaceMatch: surfaceAllowed(module, surface) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => (Number(b.surfaceMatch) - Number(a.surfaceMatch)) || (b.score - a.score))[0]?.module || null;
    // IQ-8E: a selected-record reader with nothing selected hands the turn to its query sibling (same domain, same authority model); it never
    // widens authority: the sibling is checked by the same canUse() below.
    if (candidate?.selection && !candidate.selection.present(context as CapabilityContext)) {
      const sibling = capabilityRegistry.get(candidate.selection.query_sibling);
      if (sibling && capabilityEnabled(sibling) && sibling.domain === candidate.domain) candidate = sibling;
    }
    if (!candidate) {
      operationalMetrics.increment("oyi_capability_resolution_total", { outcome: "unsupported", reason: "capability_not_registered" });
      return { capability: null, matched_capability: null, rollout_status: "not_registered", authority: null, resolution_outcome: "no_match", legacy_fallback_reason: "capability_not_registered" };
    }
    let authority = this.canUse(candidate.key, { actor: context.actor, oisContext: context.oisContext, surface, scope });
    const scopeConflict = requestedScopeConflict(candidate, frame, surface);
    if (scopeConflict) authority = { ...authority, allowed: false, reason: scopeConflict };
    logger.info("oyi_capability_authority_decided", {
      request_id: context.resolvedTurn.request_id,
      correlation_id: context.resolvedTurn.correlation_id,
      thread_id: context.input.thread_id || null,
      actor_id: context.actor?.id || null,
      surface,
      capability_key: candidate.key,
      domain: candidate.domain,
      rollout_status: candidate.rolloutStatus,
      target_type: context.resolvedTurn.target?.object_type || null,
      estate_id: scope.estate_id,
      building_id: scope.building_id,
      home_id: scope.home_id,
      room_id: scope.room_id,
      authority_allowed: authority.allowed,
      reason: authority.reason,
    });
    // Programme 4 Phase J — "capability unsupported" / "permission
    // restricted" from the spec's explicit counter list, promoted from
    // the log line above into a queryable counter.
    if (!capabilityEnabled(candidate)) {
      operationalMetrics.increment("oyi_capability_resolution_total", { outcome: "unsupported", reason: `capability_${candidate.rolloutStatus}` });
      return { capability: null, matched_capability: candidate, rollout_status: candidate.rolloutStatus, authority, resolution_outcome: "declared_disabled", legacy_fallback_reason: `capability_${candidate.rolloutStatus}` };
    }
    if (!authority.allowed) {
      operationalMetrics.increment("oyi_capability_resolution_total", { outcome: authority.reason === "missing_permission" ? "permission_restricted" : "denied", reason: authority.reason || "unknown" });
      const resolution_outcome = authority.reason === "missing_permission"
        ? "permission_restricted"
        : authority.reason?.includes("scope")
          ? "scope_restricted"
          : "surface_restricted";
      return { capability: candidate, matched_capability: candidate, rollout_status: candidate.rolloutStatus, authority, resolution_outcome, legacy_fallback_reason: null };
    }
    operationalMetrics.increment("oyi_capability_resolution_total", { outcome: "allowed", reason: "ok" });
    return { capability: candidate, matched_capability: candidate, rollout_status: candidate.rolloutStatus, authority, resolution_outcome: "matched", legacy_fallback_reason: null };
  }

  assertEvidenceAllowed(module: CapabilityModule, evidence: OyiEvidence[], input: { actor: AuthUser | null; oisContext: OisContext | null | undefined; surface: OyiSurface; scope: CapabilityAuthorityResult["scope"] }) {
    const reason = privacyAllowed(module, evidence, input);
    if (!reason) return { allowed: true, reason: null };
    return { allowed: false, reason };
  }

  actorPermissions(actor: AuthUser | null) {
    return actorPermissions(actor);
  }

  // A single certified read, NOT assessment planning or fan-out. All ordinary
  // conversation paths retain their existing behaviour until separately wired.
  async readEvidence(key: string, context: CapabilityContext, timeoutMs = 2000): Promise<EvidenceReadOutcome> {
    const module = capabilityRegistry.get(key);
    const scope = scopeFrom(context);
    const base = {
      capability_key: key, domain: module?.domain || "unknown" as const,
      requested_scope: scope, effective_scope: scope, authority: "allowed" as const,
      scope: "enforced" as const, query_executed: false, availability: "unavailable" as const,
      population: module?.evidence_read?.population || "uncertified_source",
      complete: false, truncated: false, freshness: "unknown" as const, records: [],
    };
    const authority = this.canUse(key, { actor: context.actor, oisContext: context.oisContext, surface: context.input.surface, scope });
    if (!authority.allowed || module?.risk_class !== "read") return evidenceReadOutcome({ ...base, authority: "denied" });
    if (!module.evidence_read) return evidenceReadOutcome({ ...base, scope: "unsupported" });
    // Exact-record reads are never silently broadened to a collection read.
    if (context.resolvedTurn.target?.canonical_id) return evidenceReadOutcome({ ...base, scope: "unsupported" });
    const verified = context.oisContext;
    if (!context.actor || !verified || verified.actor_id !== context.actor.id || verified.role !== context.actor.role) {
      return evidenceReadOutcome({ ...base, authority: "denied" });
    }
    if (scope.estate_id !== verified.estate_id || (scope.home_id && scope.home_id !== verified.home_id)) {
      return evidenceReadOutcome({ ...base, authority: "denied" });
    }
    // Surface x scope admission. The request's scope class must be one this
    // collector was certified for; otherwise it is rejected before collection.
    const admitted = module.evidence_read.scopes;
    const surface = context.input.surface;
    let scopeClass: EvidenceScopeClass;
    if (surface === "office_internal") {
      if (!admitted.includes("office_permissioned_snapshot")) return evidenceReadOutcome({ ...base, authority: "denied" });
      if (scope.estate_id || scope.home_id || scope.building_id || scope.room_id) return evidenceReadOutcome({ ...base, scope: "unsupported" });
      scopeClass = "office_permissioned_snapshot";
    } else if (surface === "facility") {
      if (!actorHasFacilityReadScope(context.actor.role)) return evidenceReadOutcome({ ...base, authority: "denied" });
      scopeClass = scope.room_id ? "facility_room" : scope.building_id ? "facility_building" : scope.home_id ? "facility_home" : "facility_estate";
      if (scopeClass === "facility_estate" && !scope.estate_id) return evidenceReadOutcome({ ...base, scope: "insufficient" });
      if (!admitted.includes(scopeClass)) return evidenceReadOutcome({ ...base, scope: "unsupported" });
    } else if (surface === "consumer") {
      if (!scope.home_id || !scope.estate_id) return evidenceReadOutcome({ ...base, scope: "insufficient" });
      if (context.actor.home_id !== scope.home_id || context.actor.estate_id !== scope.estate_id) return evidenceReadOutcome({ ...base, authority: "denied" });
      if (scope.building_id) return evidenceReadOutcome({ ...base, scope: "unsupported" });
      scopeClass = scope.room_id ? "consumer_room" : "consumer_home";
      if (!admitted.includes(scopeClass)) return evidenceReadOutcome({ ...base, scope: "unsupported" });
    } else if (surface === "public_corporate") {
      if (!admitted.includes("public_thread") && !admitted.includes("public_corporate")) return evidenceReadOutcome({ ...base, authority: "denied" });
      if (scope.estate_id || scope.home_id || scope.building_id || scope.room_id) return evidenceReadOutcome({ ...base, scope: "unsupported" });
      // A thread-state source needs a thread; public knowledge/listing sources do not.
      if (admitted.includes("public_thread") && !text(context.input.thread_id)) return evidenceReadOutcome({ ...base, scope: "insufficient" });
      scopeClass = admitted.includes("public_thread") ? "public_thread" : "public_corporate";
    } else return evidenceReadOutcome({ ...base, authority: "denied" });
    // PURE READ by construction: the source receives a read-only database dependency (no write verbs, no RPC)
    // and nothing global is patched. A test may inject its own via context.evidence_db.
    const evidenceContext: CapabilityContext = { ...context, evidence_db: context.evidence_db ?? readOnlyEvidenceDb() };
    const read = await withinEvidenceDeadline(() => module.evidence_read!.collect(evidenceContext, scope), timeoutMs);
    if (read.status !== "completed") return evidenceReadOutcome({ ...base, query_executed: true, availability: read.status });
    const privacy = this.assertEvidenceAllowed(module, read.value.records, { actor: context.actor, oisContext: verified, surface: context.input.surface, scope });
    return privacy.allowed ? read.value : evidenceReadOutcome({ ...base, query_executed: true, authority: "denied" });
  }
}

export const capabilityService = new CapabilityService();
