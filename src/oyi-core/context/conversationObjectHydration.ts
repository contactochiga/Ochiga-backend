import type { AuthUser } from "../../middleware/auth";
import type { OisContext } from "../../types/oisContext";
import {
  hydrateCanonicalTarget,
  type CanonicalHydrationResult,
} from "../runtime/canonicalTargetHydrationRegistry";
import type {
  OperationalObject,
  OperationalObjectType,
} from "../runtime/canonicalConversationRuntime";
import type { ResolvedConversationTarget } from "../runtime/conversationTargetResolver";

export type ConversationObjectCandidate = {
  object_type: OperationalObjectType;
  canonical_id: string;
  label?: string | null;
  estate_id?: string | null;
  home_id?: string | null;
  room_id?: string | null;
  source_module?: string | null;
  metadata?: Record<string, unknown>;
  source:
    | "explicit_request"
    | "thread_state"
    | "page_selection"
    | "home_scope"
    | "estate_scope"
    | "global_scope";
};

export type ResolvedOperationalObject = {
  object: OperationalObject | null;
  source: ConversationObjectCandidate["source"];
  warnings: string[];
};

export type SurfaceHydrationPolicy = {
  surface: "consumer" | "facility" | "office" | "website" | "voice";
  defaultScope: "home" | "estate" | "global";
  allowedPrivateScope: "home" | "building" | "estate" | "none";
  canUseVisibleStateFallback: boolean;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function cleanLabel(value: unknown, fallback: string) {
  return text(value) || fallback;
}

function objectTypeLabel(type: OperationalObjectType) {
  return cleanLabel(type, "Operational object").replace(/_/g, " ");
}

export function hydrationPolicyForSurface(surface: unknown): SurfaceHydrationPolicy {
  if (surface === "facility") {
    return {
      surface: "facility",
      defaultScope: "estate",
      allowedPrivateScope: "building",
      canUseVisibleStateFallback: false,
    };
  }
  if (surface === "office" || surface === "website" || surface === "voice") {
    return {
      surface: surface as SurfaceHydrationPolicy["surface"],
      defaultScope: "global",
      allowedPrivateScope: "none",
      canUseVisibleStateFallback: false,
    };
  }
  return {
    surface: "consumer",
    defaultScope: "home",
    allowedPrivateScope: "home",
    canUseVisibleStateFallback: true,
  };
}

function permissionsFor(actor: AuthUser | null, oisContext: OisContext | null | undefined) {
  return Array.isArray(oisContext?.permissions)
    ? oisContext.permissions
    : Array.isArray(actor?.permissions)
      ? actor.permissions
      : [];
}

function fallbackScopeObject(actor: AuthUser | null, oisContext: OisContext | null | undefined): ResolvedOperationalObject {
  const permissions = permissionsFor(actor, oisContext);
  if (oisContext?.home_id) {
    return {
      object: {
        object_type: "home",
        canonical_id: oisContext.home_id,
        label: cleanLabel(oisContext.home?.name, "Home"),
        estate_id: oisContext.estate_id || null,
        building_id: null,
        home_id: oisContext.home_id,
        room_id: null,
        parent_id: oisContext.estate_id || null,
        source_module: oisContext.module || null,
        capabilities: ["conversation"],
        current_state: null,
        health: null,
        permissions,
        relationships: {},
        evidence_references: [],
        metadata: {},
        freshness: oisContext.resolved_at || null,
      },
      source: "home_scope",
      warnings: [],
    };
  }
  if (oisContext?.estate_id) {
    return {
      object: {
        object_type: "estate",
        canonical_id: oisContext.estate_id,
        label: cleanLabel(oisContext.estate?.name, "Estate"),
        estate_id: oisContext.estate_id,
        building_id: null,
        home_id: null,
        room_id: null,
        parent_id: null,
        source_module: oisContext.module || null,
        capabilities: ["conversation"],
        current_state: null,
        health: null,
        permissions,
        relationships: {},
        evidence_references: [],
        metadata: {},
        freshness: oisContext.resolved_at || null,
      },
      source: "estate_scope",
      warnings: [],
    };
  }
  return { object: null, source: "global_scope", warnings: [] };
}

function targetFromCandidate(candidate: ConversationObjectCandidate): ResolvedConversationTarget {
  const source = candidate.source === "explicit_request"
    ? "explicit_canonical_target"
    : candidate.source === "thread_state"
      ? "thread_target"
      : candidate.source === "page_selection"
        ? "active_page_object"
        : candidate.source === "home_scope"
          ? "home_scope"
          : "module_scope";
  return {
    objectType: candidate.object_type,
    objectId: candidate.canonical_id,
    objectName: candidate.label || null,
    source,
    confidence: candidate.source === "explicit_request" ? 0.96 : candidate.source === "thread_state" ? 0.72 : 0.82,
    ambiguous: false,
    clarificationQuestion: null,
    hydrationStatus: "pending",
    scopeWidened: false,
  };
}

function metadataBackedObject(
  candidate: ConversationObjectCandidate,
  actor: AuthUser | null,
  oisContext: OisContext | null | undefined,
): OperationalObject {
  const metadata = recordOf(candidate.metadata);
  const estateId = candidate.estate_id || oisContext?.estate_id || text(metadata.estate_id || metadata.estateId) || null;
  const homeId = candidate.home_id || oisContext?.home_id || text(metadata.home_id || metadata.homeId) || null;
  const buildingId = text(metadata.building_id || metadata.buildingId) || null;
  return {
    object_type: candidate.object_type,
    canonical_id: candidate.canonical_id,
    label: cleanLabel(candidate.label || metadata.name || metadata.label, objectTypeLabel(candidate.object_type)),
    estate_id: estateId,
    building_id: buildingId,
    home_id: homeId,
    room_id: candidate.room_id || text(metadata.room_id || metadata.roomId) || null,
    parent_id: text(metadata.parent_id || metadata.parentId || metadata.floor_id || metadata.floorId || buildingId || homeId || estateId) || null,
    source_module: candidate.source_module || text(metadata.source_module) || null,
    capabilities: ["conversation", "spatial_reasoning", "registry"],
    current_state: text(metadata.status || metadata.current_state) || null,
    health: text(metadata.health || metadata.health_status) || null,
    permissions: permissionsFor(actor, oisContext),
    relationships: {
      estate_id: estateId,
      building_id: buildingId,
      floor: text(metadata.floor || metadata.floor_name || metadata.floorName) || null,
      zone: text(metadata.zone || metadata.zone_name || metadata.zoneName) || null,
      room: text(metadata.room || metadata.room_name || metadata.roomName) || null,
      child_objects: Array.isArray(metadata.child_objects) ? metadata.child_objects : [],
      contained_objects: Array.isArray(metadata.contained_objects) ? metadata.contained_objects : [],
      dependencies: Array.isArray(metadata.dependencies) ? metadata.dependencies : [],
      affected_areas: Array.isArray(metadata.affected_areas) ? metadata.affected_areas : [],
    },
    evidence_references: arrayOfStrings(metadata.evidence_references),
    metadata,
    freshness: text(metadata.updated_at || metadata.freshness) || null,
  };
}

function compatibleMetadataFallbackTypes(type: OperationalObjectType) {
  return new Set<OperationalObjectType>([
    "floor",
    "tower",
    "block",
    "wing",
    "corridor",
    "access_point",
    "emergency_asset",
    "provider",
    "twin_node",
    "operational_event",
  ]).has(type);
}

export function resolvedFromHydrationForTest(input: {
  candidate: ConversationObjectCandidate | null;
  hydration?: Pick<CanonicalHydrationResult, "status" | "object" | "reason"> | null;
}) {
  if (!input.candidate) return { source: "global_scope", warnings: [] };
  return {
    source: input.candidate.source,
    warnings: input.hydration?.status === "hydrated" ? [] : input.hydration?.reason ? [input.hydration.reason] : [],
  };
}

export async function hydrateOperationalObjectCandidate(input: {
  actor: AuthUser | null;
  oisContext: OisContext | null | undefined;
  candidate: ConversationObjectCandidate | null;
  activeContext: Record<string, unknown> | null;
  visibleState: Record<string, unknown> | null;
  surface: unknown;
}): Promise<ResolvedOperationalObject> {
  if (!input.candidate) return fallbackScopeObject(input.actor, input.oisContext);

  const policy = hydrationPolicyForSurface(input.surface);
  const visibleState = policy.canUseVisibleStateFallback ? input.visibleState : null;
  const hydration = await hydrateCanonicalTarget({
    actor: input.actor,
    oisContext: input.oisContext,
    target: targetFromCandidate(input.candidate),
    activeContext: input.activeContext,
    visibleState,
  });

  if (hydration.status === "hydrated") {
    return {
      object: hydration.object,
      source: input.candidate.source,
      warnings: [],
    };
  }

  if (compatibleMetadataFallbackTypes(input.candidate.object_type)) {
    return {
      object: metadataBackedObject(input.candidate, input.actor, input.oisContext),
      source: input.candidate.source,
      warnings: [],
    };
  }

  const warnings = hydration.reason ? [hydration.reason] : [];
  if (input.candidate.source === "explicit_request" && !warnings.length) {
    warnings.push("The selected operational object could not be verified in the active scope.");
  }
  return {
    object: null,
    source: input.candidate.source,
    warnings,
  };
}

export function resolveContextSourceForTest(input: { explicit?: boolean; thread?: boolean; home?: boolean; estate?: boolean }) {
  if (input.explicit) return "explicit_request" as const;
  if (input.thread) return "thread_state" as const;
  if (input.home) return "home_scope" as const;
  if (input.estate) return "estate_scope" as const;
  return "global_scope" as const;
}
