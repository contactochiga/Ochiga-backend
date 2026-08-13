import type { AuthUser } from "../../middleware/auth";
import { hasPermission, permissionsForRole } from "../../core/foundation";
import { logger } from "../../observability/logger";
import type { OisContext } from "../../types/oisContext";
import type { OyiSurface } from "../../services/oyiUnifiedIntelligenceService";
import type { CapabilityContext, CapabilityModule, CapabilityRolloutStatus } from "../contracts/capability";
import type { OyiEvidence } from "../contracts/evidence";
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
  rollout_status: CapabilityRolloutStatus | "not_registered";
  authority: CapabilityAuthorityResult | null;
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
  }
  return null;
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
    const candidate = capabilityRegistry.all().find((module) => module.supports(frame)) || null;
    if (!candidate) {
      return { capability: null, rollout_status: "not_registered", authority: null, legacy_fallback_reason: "capability_not_registered" };
    }
    const authority = this.canUse(candidate.key, { actor: context.actor, oisContext: context.oisContext, surface, scope });
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
    if (!capabilityEnabled(candidate)) return { capability: null, rollout_status: candidate.rolloutStatus, authority, legacy_fallback_reason: `capability_${candidate.rolloutStatus}` };
    if (!authority.allowed) return { capability: candidate, rollout_status: candidate.rolloutStatus, authority, legacy_fallback_reason: null };
    return { capability: candidate, rollout_status: candidate.rolloutStatus, authority, legacy_fallback_reason: null };
  }

  assertEvidenceAllowed(module: CapabilityModule, evidence: OyiEvidence[], input: { actor: AuthUser | null; oisContext: OisContext | null | undefined; surface: OyiSurface; scope: CapabilityAuthorityResult["scope"] }) {
    const reason = privacyAllowed(module, evidence, input);
    if (!reason) return { allowed: true, reason: null };
    return { allowed: false, reason };
  }

  actorPermissions(actor: AuthUser | null) {
    return actorPermissions(actor);
  }
}

export const capabilityService = new CapabilityService();
