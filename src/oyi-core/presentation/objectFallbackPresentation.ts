import type { CanonicalConversationRequest, IntelligenceFact, OperationalObject, OperationalObjectType, TruthState } from "../contracts/canonicalConversation";
import { requestedPowerState, isControlRequest, isExplanationRequest } from "../context/currentTurnAuthority";
import { visitorConfirmationReply, visitorContextualActions, visitorObjectProfile, visitorObjectVoice, visitorRecommendation } from "../domains/visitors/visitorConversationAnswers";
import { maintenanceConfirmationReply, maintenanceContextualActions, maintenanceLinkedIssueSummary, maintenanceObjectProfile, maintenanceObjectVoice, maintenanceRecommendation } from "../domains/maintenance/maintenanceConversationAnswers";
import { unresolvedMaintenanceRecordsForContext } from "../domains/maintenance/maintenanceEvidence";
import { securityConfirmationReply, securityContextualActions, securityObjectProfile, securityObjectVoice, securityRecommendation } from "../domains/security/securityConversationAnswers";
import { serviceConfirmationReply, serviceContextualActions, serviceObjectProfile, serviceObjectVoice, serviceRecommendation } from "../domains/services/serviceConversationAnswers";
import { communityConfirmationReply, communityContextualActions, communityObjectProfile, communityObjectVoice, communityRecommendation } from "../domains/community/communityConversationAnswers";
import { sceneAutomationConfirmationReply, sceneAutomationContextualActions, sceneAutomationObjectProfile, sceneAutomationObjectVoice, sceneAutomationRecommendation } from "../domains/automations/sceneAutomationConversationAnswers";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanLabel(value: unknown, fallback: string) {
  const next = text(value);
  return next || fallback;
}

function severityFor(value: unknown) {
  const raw = text(value).toLowerCase();
  if (["critical", "warning", "attention", "info"].includes(raw)) return raw;
  return "normal";
}

function truthStateFromCompatibility(response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const status = text(execution.status).toLowerCase();
  if (status === "pending_confirmation") return "pending_confirmation" as const;
  if (status === "permission_denied" || status === "denied") return "permission_restricted" as const;
  if (status === "unsupported" || status === "validation_required") return "unsupported" as const;
  if (status === "failed") return "observed" as const;
  if (status === "executed" || status === "processed") return "confirmed" as const;
  if (response.awareness && severityFor(recordOf(response.awareness).severity) !== "normal") return "observed" as const;
  if (Array.isArray(response.sources) && response.sources.length) return "observed" as const;
  return "inferred" as const;
}

function human(value: unknown) {
  return text(value).replace(/_/g, " ");
}

function sentence(value: unknown) {
  const raw = human(value).replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return raw.endsWith(".") || raw.endsWith("?") || raw.endsWith("!") ? raw : `${raw}.`;
}

export function naturalizeUserCopy(value: unknown) {
  let next = sentence(value);
  const replacements: Array<[RegExp, string]> = [
    [/\bai\.[a-z0-9_.-]+\b/gi, "Oyi background event"],
    [/\boyi\.[a-z0-9_.-]+\b/gi, "Oyi background event"],
    [/\b[a-z]+(?:\.[a-z0-9_-]+){2,}\b/gi, "system event"],
    [/\bruntime\b/gi, "system"],
    [/\bprovider acknowledgement\b/gi, "controller confirmation"],
    [/\bprovider\b/gi, "controller"],
    [/\btelemetry\b/gi, "device updates"],
    [/\bbackend\b/gi, "Oyi"],
    [/\bapi\b/gi, "connection"],
    [/\bexecution pipeline\b/gi, "control path"],
    [/\bsignal normalization\b/gi, "event processing"],
    [/\binternal enum(?:s)?\b/gi, "status"],
    [/\bunsupported capability\b/gi, "feature this object does not support"],
    [/\bcapability unsupported\b/gi, "feature not supported"],
    [/\bpermission restricted\b/gi, "not allowed right now"],
    [/\bpending_confirmation\b/gi, "waiting for confirmation"],
    [/\bstate_confirmed\b/gi, "confirmed"],
    [/\bpartial_confirmation\b/gi, "partially confirmed"],
    [/\bvalidation_required\b/gi, "needs checking first"],
    [/\bexecution ledger\b/gi, "activity history"],
    [/\baudit events?\b/gi, "activity record"],
    [/\bprivacy_class\b/gi, "privacy setting"],
    [/\borganization_restricted\b/gi, "restricted"],
    [/\bresident_device_private\b/gi, "home-private"],
    [/\bInvalid Date\b/g, "time unavailable"],
    [/\bundefined\b/gi, "unavailable"],
    [/\bnull\b/gi, "unavailable"],
    [/\bpermitted surface\b/gi, "available in this view"],
    [/\bFacility projection\b/gi, "building view"],
  ];
  for (const [pattern, replacement] of replacements) next = next.replace(pattern, replacement);
  return next
    .replace(/\b([0-9]{1,2}:[0-9]{2}\s?(?:AM|PM)?)\s*\(\s*\1\s*\)/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function listNames(value: unknown, fallbackPrefix: string) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((row, index) => {
      const record = recordOf(row);
      return text(record.name || record.label || record.title || record.id) || `${fallbackPrefix} ${index + 1}`;
    })
    .filter(Boolean);
}

function objectTypeLabel(object: OperationalObject) {
  const labels: Record<string, string> = {
    device: "device",
    device_channel: "channel",
    tower: "tower",
    block: "block",
    room: "room",
    corridor: "corridor",
    wing: "wing",
    visitor: "visitor",
    access_pass: "access pass",
    maintenance_request: "maintenance request",
    wallet: "wallet",
    transaction: "transaction",
    service_account: "service",
    camera: "camera",
    meter: "meter",
    scene: "scene",
    automation: "automation",
    message_thread: "message thread",
    community_post: "community post",
    notification: "notification",
    operational_incident: "incident",
    operational_event: "event",
    infrastructure_asset: "asset",
    access_point: "access point",
    emergency_asset: "emergency asset",
    provider: "provider",
    estate: "estate",
    building: "building",
    home: "home",
    floor: "floor",
    zone: "zone",
    twin_node: "twin object",
  };
  return labels[object.object_type] || "object";
}

function objectPersonality(object: OperationalObject) {
  const profiles: Partial<Record<OperationalObjectType, { role: string; diagnostics: string[]; actions: string[] }>> = {
    device: {
      role: "I operate from this device's live state, controls, health, activity, and relationships.",
      diagnostics: ["state", "health", "last control", "automation", "connection"],
      actions: ["control", "timer", "schedule", "rename", "diagnose"],
    },
    device_channel: {
      role: "I operate this device channel independently while keeping the parent device context.",
      diagnostics: ["channel state", "last update", "parent device", "automation"],
      actions: ["control", "timer", "schedule", "rename channel"],
    },
    room: {
      role: "I read the room as a living operational space: devices, occupancy, activity, scenes, and comfort.",
      diagnostics: ["active devices", "occupancy", "room activity", "scenes"],
      actions: ["turn devices off", "run scene", "check occupancy", "summarize activity"],
    },
    building: {
      role: "I read this building as a connected operational system: floors, zones, rooms, infrastructure, devices, people, and service impact.",
      diagnostics: ["operational health", "occupancy", "infrastructure", "maintenance"],
      actions: ["show affected areas", "check infrastructure", "review maintenance", "show evidence"],
    },
    floor: {
      role: "I read this floor through its zones, rooms, devices, occupancy, incidents, and infrastructure dependencies.",
      diagnostics: ["rooms", "active devices", "incidents", "service impact"],
      actions: ["show rooms", "check offline areas", "review maintenance", "show evidence"],
    },
    zone: {
      role: "I read this zone as a spatial operating area with contained rooms, assets, devices, and incidents.",
      diagnostics: ["contained objects", "health", "dependencies", "activity"],
      actions: ["show contained objects", "check health", "show affected areas"],
    },
    corridor: {
      role: "I read this corridor through access, lighting, cameras, sensors, and movement-related events.",
      diagnostics: ["lighting", "cameras", "access points", "activity"],
      actions: ["check lighting", "show cameras", "review access activity"],
    },
    wing: {
      role: "I read this wing across its rooms, corridors, infrastructure, occupants, and operational risks.",
      diagnostics: ["rooms", "maintenance", "security", "infrastructure"],
      actions: ["show affected rooms", "check maintenance", "review security"],
    },
    visitor: visitorObjectProfile("visitor"),
    access_pass: visitorObjectProfile("access_pass"),
    maintenance_request: maintenanceObjectProfile(),
    wallet: {
      role: "I track this wallet's balance, funding, charges, receipts, and payment safety.",
      diagnostics: ["balance", "last payment", "receipts", "outstanding charges"],
      actions: ["verify payment", "show receipt", "show transactions"],
    },
    transaction: {
      role: "I track this transaction's amount, confirmation state, receipt, and ledger evidence.",
      diagnostics: ["payment status", "receipt", "ledger", "confirmation"],
      actions: ["verify", "show receipt", "explain status"],
    },
    service_account: serviceObjectProfile("service_account"),
    infrastructure_asset: {
      role: "I track this asset's health, dependencies, incidents, services, and operational impact.",
      diagnostics: ["health", "dependencies", "incidents", "affected homes"],
      actions: ["diagnose", "show dependencies", "review incidents"],
    },
    access_point: securityObjectProfile("access_point"),
    emergency_asset: {
      role: "I track this emergency asset's location, readiness, inspection state, and affected area.",
      diagnostics: ["readiness", "location", "inspection", "coverage"],
      actions: ["show location", "review inspection", "check coverage"],
    },
    camera: securityObjectProfile("camera"),
    meter: serviceObjectProfile("meter"),
    scene: sceneAutomationObjectProfile("scene"),
    automation: sceneAutomationObjectProfile("automation"),
    message_thread: communityObjectProfile("message_thread"),
    community_post: communityObjectProfile("community_post"),
    notification: {
      role: "I track this notification's event, read state, deep link, and evidence.",
      diagnostics: ["event", "delivery", "read state"],
      actions: ["open event", "mark read", "show evidence"],
    },
    operational_incident: securityObjectProfile("operational_incident"),
    operational_event: {
      role: "I track this operational event, evidence, impact, and follow-up.",
      diagnostics: ["evidence", "impact", "status"],
      actions: ["show evidence", "review follow-up"],
    },
    twin_node: {
      role: "I represent the selected spatial object and its live operational relationships.",
      diagnostics: ["position", "relationships", "state", "activity"],
      actions: ["show relationships", "show activity", "diagnose"],
    },
  };
  return profiles[object.object_type] || {
    role: `I answer from this ${objectTypeLabel(object)} and its operational evidence.`,
    diagnostics: ["status", "health", "activity", "relationships"],
    actions: ["status", "activity", "relationships", "evidence"],
  };
}

function objectVoice(object: OperationalObject) {
  const type = object.object_type;
  if (type === "device" || type === "device_channel") return {
    healthy: "Everything responded normally.",
    unavailable: "I can’t verify it right now.",
    next: "Would you like to check health, view history, or create an automation?",
  };
  if (type === "wallet" || type === "transaction") return {
    healthy: "The financial record looks consistent.",
    unavailable: "I can’t verify the payment record right now.",
    next: "Would you like recent transactions or a receipt?",
  };
  if (type === "visitor" || type === "access_pass") return {
    ...visitorObjectVoice(),
  };
  if (type === "maintenance_request") return {
    ...maintenanceObjectVoice(),
  };
  if (type === "service_account" || type === "meter") return {
    ...serviceObjectVoice(),
  };
  if (type === "message_thread" || type === "community_post") return {
    ...communityObjectVoice(type),
  };
  if (type === "scene" || type === "automation") return {
    ...sceneAutomationObjectVoice(type),
  };
  if (type === "camera" || type === "access_point" || type === "operational_incident") return {
    ...securityObjectVoice(type),
  };
  return {
    healthy: "Everything I can verify looks normal.",
    unavailable: "I can’t verify that right now.",
    next: "Would you like activity, relationships, or evidence?",
  };
}

function naturalState(value: unknown) {
  const raw = human(value).toLowerCase();
  if (!raw) return "";
  const map: Record<string, string> = {
    on: "ON",
    off: "OFF",
    online: "online",
    offline: "offline",
    healthy: "healthy",
    normal: "normal",
    degraded: "degraded",
    unavailable: "unavailable",
    pending: "pending",
    "pending confirmation": "waiting for confirmation",
    active: "active",
    inactive: "inactive",
    open: "open",
    closed: "closed",
    resolved: "resolved",
    failed: "not completed",
  };
  return map[raw] || human(value);
}

export function objectStateLine(object: OperationalObject) {
  const state = naturalState(object.current_state);
  const health = naturalState(object.health);
  if (state && health && state.toLowerCase() !== health.toLowerCase()) return `${object.label} is ${state}. Health is ${health}.`;
  if (state) return `${object.label} is ${state}.`;
  if (health) return `${object.label} health is ${health}.`;
  return `${object.label} is selected.`;
}

function relationshipLine(object: OperationalObject, input: CanonicalConversationRequest) {
  const relationships = { ...recordOf(object.relationships), ...recordOf(input.relationships) };
  const parts: string[] = [];
  const room = text(input.room_name || relationships.room_name || relationships.room || object.room_id);
  const parent = recordOf(relationships.parent_device || relationships.parent || {});
  const children = Array.isArray(relationships.child_devices) ? relationships.child_devices : Array.isArray(relationships.children) ? relationships.children : [];
  const scenes = Array.isArray(input.active_scenes) ? input.active_scenes : Array.isArray(relationships.scenes) ? relationships.scenes : [];
  const automations = Array.isArray(input.active_automations) ? input.active_automations : Array.isArray(relationships.automations) ? relationships.automations : [];
  const schedules = Array.isArray(relationships.schedules) ? relationships.schedules : [];
  const sensors = Array.isArray(relationships.sensors) ? relationships.sensors : [];
  const affectedHomes = Array.isArray(relationships.affected_homes) ? relationships.affected_homes : [];
  const transactions = Array.isArray(relationships.transactions) ? relationships.transactions : [];
  const assignee = text(relationships.assignee_name || relationships.assignee || relationships.technician);
  const controller = text(relationships.controller || relationships.provider || recordOf(object.metadata).controller || recordOf(object.metadata).provider);
  const sceneNames = listNames(scenes, "scene");
  const automationNames = listNames(automations, "automation");
  if (room) parts.push(`${object.label} belongs to ${room}.`);
  if (parent.name || parent.id) parts.push(`It depends on ${text(parent.name || parent.id)}.`);
  if (children.length) parts.push(`${children.length} linked child ${children.length === 1 ? "object depends" : "objects depend"} on it.`);
  if (sceneNames.length) parts.push(`${sceneNames.slice(0, 2).join(" and ")} ${sceneNames.length === 1 ? "can affect it" : "can affect it"}.`);
  if (automationNames.length) parts.push(`${automationNames.slice(0, 2).join(" and ")} ${automationNames.length === 1 ? "can control it" : "can control it"}.`);
  if (schedules.length) parts.push(`${schedules.length} ${schedules.length === 1 ? "schedule is" : "schedules are"} linked.`);
  if (sensors.length) parts.push(`${sensors.length} ${sensors.length === 1 ? "sensor informs" : "sensors inform"} it.`);
  if (affectedHomes.length) parts.push(`${affectedHomes.length} ${affectedHomes.length === 1 ? "home is" : "homes are"} affected.`);
  if (transactions.length) parts.push(`${transactions.length} recent ${transactions.length === 1 ? "transaction is" : "transactions are"} linked.`);
  if (assignee) parts.push(`Current assignee is ${assignee}.`);
  if (controller) parts.push(`It is connected through ${controller}.`);
  return parts.join(" ");
}

function memoryLine(object: OperationalObject, input: CanonicalConversationRequest) {
  const memory = recordOf(input.memory_summary);
  const executions = Array.isArray(input.recent_executions) ? input.recent_executions : [];
  const activity = text(recordOf(input.conversation_context).activity_summary || recordOf(object.metadata).activity_summary);
  const summary = text(memory.summary || memory.headline || memory.last_event || memory.last_activity || activity);
  if (summary) return summary;
  const usually = text(memory.usual_time || memory.normal_time || memory.pattern);
  if (usually) return `${object.label} usually follows this pattern: ${usually}.`;
  if (executions.length) {
    const latest = recordOf(executions[0]);
    const latestSummary = text(latest.summary || latest.title || latest.status);
    return latestSummary ? `Last activity: ${latestSummary}.` : `${object.label} has ${executions.length} recent recorded ${executions.length === 1 ? "action" : "actions"}.`;
  }
  return "";
}

function evidenceLine(object: OperationalObject, response: Record<string, unknown>) {
  const sourceCount = Array.isArray(response.sources) ? response.sources.length : 0;
  const freshness = object.freshness ? ` Last updated ${new Date(object.freshness).toLocaleString()}.` : "";
  if (sourceCount) return `I checked ${sourceCount} relevant ${sourceCount === 1 ? "record" : "records"} for ${object.label}.${freshness}`;
  return `I checked the current ${objectTypeLabel(object)} record for ${object.label}.${freshness || " I don’t have a freshness time for it yet."}`;
}

function truthLanguage(state: TruthState, object: OperationalObject) {
  const label = object.label;
  const map: Record<TruthState, string> = {
    confirmed: `I've confirmed that for ${label}.`,
    observed: `I can see that in ${label}'s recent records.`,
    inferred: `Everything suggests that for ${label}.`,
    predicted: `Based on recent activity, I expect that for ${label}.`,
    pending_confirmation: `${label} responded, but I’m still waiting for final confirmation.`,
    unavailable: `I can’t verify ${label} right now.`,
    unsupported: `${label} doesn’t support that feature.`,
    permission_restricted: `You’re not allowed to do that on ${label} right now.`,
  };
  return map[state];
}

function broadSummaryRequested(message: string) {
  return /\b(how many|all devices|all visitors|whole house|whole home|entire estate|whole estate|everything|estate summary|home summary|list all|show all)\b/i.test(message);
}

function looksLikeBroadFallback(message: string) {
  return /\bthere (?:are|is) \d+|connected devices|current home|current estate|i can help|what can you do|available devices|records available/i.test(message);
}

function relationshipEvidence(object: OperationalObject, input: CanonicalConversationRequest) {
  const relationships = { ...recordOf(object.relationships), ...recordOf(input.relationships) };
  const scenes = listNames(input.active_scenes || relationships.scenes, "scene");
  const automations = listNames(input.active_automations || relationships.automations, "automation");
  const sensors = listNames(relationships.sensors, "sensor");
  const occupiedRooms = Array.isArray(relationships.occupied_rooms) ? relationships.occupied_rooms : [];
  const affectedHomes = Array.isArray(relationships.affected_homes) ? relationships.affected_homes : [];
  const evidence: string[] = [];
  if (scenes.length) evidence.push(`${scenes.slice(0, 2).join(" and ")} can affect it`);
  if (automations.length) evidence.push(`${automations.slice(0, 2).join(" and ")} can control it`);
  if (sensors.length) evidence.push(`${sensors.slice(0, 2).join(" and ")} ${sensors.length === 1 ? "informs" : "inform"} it`);
  if (occupiedRooms.length) evidence.push(`${occupiedRooms.length} ${occupiedRooms.length === 1 ? "room is" : "rooms are"} still occupied`);
  if (affectedHomes.length) evidence.push(`${affectedHomes.length} ${affectedHomes.length === 1 ? "home is" : "homes are"} affected`);
  return evidence;
}

function spatialRelationships(object: OperationalObject, input: CanonicalConversationRequest) {
  return { ...recordOf(object.metadata), ...recordOf(object.relationships), ...recordOf(input.relationships) };
}

function isSpatialObject(object: OperationalObject) {
  return new Set<OperationalObjectType>([
    "estate",
    "building",
    "tower",
    "block",
    "floor",
    "wing",
    "zone",
    "corridor",
    "room",
    "home",
    "infrastructure_asset",
    "access_point",
    "emergency_asset",
    "twin_node",
  ]).has(object.object_type);
}

function isSpatialRequest(message: string) {
  return /\b(upstairs|downstairs|floor|building|tower|block|wing|corridor|zone|room|area|areas|where|located|contains|contain|inside|affected|offline|occupied|lights on|dark|consumes|power|water pressure|entrance|protecting|owns this|belongs)\b/i.test(message);
}

function namesFromRelationship(value: unknown, fallback: string) {
  return listNames(value, fallback).slice(0, 6);
}

function spatialHierarchyLine(object: OperationalObject, input: CanonicalConversationRequest) {
  const relationships = spatialRelationships(object, input);
  const parts = [
    text(relationships.estate_name || relationships.estate || object.estate_id),
    text(relationships.building_name || relationships.building || object.building_id),
    text(relationships.floor_name || relationships.floor),
    text(relationships.wing_name || relationships.wing),
    text(relationships.zone_name || relationships.zone),
    text(input.room_name || relationships.room_name || relationships.room || object.room_id),
  ].filter(Boolean);
  if (!parts.length) return "";
  return `${object.label} sits in ${parts.join(" → ")}.`;
}

function spatialContainmentLine(object: OperationalObject, input: CanonicalConversationRequest) {
  const relationships = spatialRelationships(object, input);
  const rooms = namesFromRelationship(relationships.rooms, "room");
  const floors = namesFromRelationship(relationships.floors, "floor");
  const zones = namesFromRelationship(relationships.zones, "zone");
  const devices = namesFromRelationship(relationships.devices, "device");
  const cameras = namesFromRelationship(relationships.cameras, "camera");
  const assets = namesFromRelationship(relationships.infrastructure_assets || relationships.assets, "asset");
  const people = namesFromRelationship(relationships.people || relationships.occupants || relationships.residents, "person");
  const parts: string[] = [];
  if (floors.length) parts.push(`${floors.length} ${floors.length === 1 ? "floor" : "floors"}`);
  if (zones.length) parts.push(`${zones.length} ${zones.length === 1 ? "zone" : "zones"}`);
  if (rooms.length) parts.push(`${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}`);
  if (devices.length) parts.push(`${devices.length} ${devices.length === 1 ? "device" : "devices"}`);
  if (cameras.length) parts.push(`${cameras.length} ${cameras.length === 1 ? "camera" : "cameras"}`);
  if (assets.length) parts.push(`${assets.length} infrastructure ${assets.length === 1 ? "asset" : "assets"}`);
  if (people.length) parts.push(`${people.length} ${people.length === 1 ? "person" : "people"}`);
  if (!parts.length) return "";
  return `${object.label} contains ${parts.join(", ")}.`;
}

function spatialAreaAggregation(input: CanonicalConversationRequest, object: OperationalObject) {
  const relationships = spatialRelationships(object, input);
  const message = input.message.toLowerCase();
  const rooms = Array.isArray(relationships.rooms) ? relationships.rooms.map(recordOf) : [];
  const devices = Array.isArray(relationships.devices) ? relationships.devices.map(recordOf) : [];
  const cameras = Array.isArray(relationships.cameras) ? relationships.cameras.map(recordOf) : [];

  if (/occupied/.test(message)) {
    const occupied = rooms.filter((room) => /occupied|active|present/i.test(text(room.occupancy || room.status || room.state)));
    if (occupied.length) return `${occupied.map((room) => text(room.name || room.label || room.id)).filter(Boolean).join(", ")} ${occupied.length === 1 ? "is" : "are"} occupied.`;
    return `I don’t see confirmed occupied rooms for ${object.label} right now.`;
  }
  if (/lights on|rooms.*on|still.*on/.test(message)) {
    const onDevices = devices.filter((device) => /light|switch|relay/i.test(text(device.type || device.family || device.name || device.label)) && /on|active/i.test(text(device.state || device.status || device.primary_state)));
    if (onDevices.length) return `${onDevices.map((device) => text(device.room_name || device.room || device.name || device.label)).filter(Boolean).join(", ")} still ${onDevices.length === 1 ? "has" : "have"} lights on.`;
    return `I don’t see any confirmed lights still on in ${object.label}.`;
  }
  if (/offline|unavailable|down/.test(message)) {
    const offlineDevices = [...devices, ...cameras].filter((item) => /offline|unavailable|down|degraded/i.test(text(item.health || item.status || item.state)));
    if (offlineDevices.length) return `${offlineDevices.length} ${offlineDevices.length === 1 ? "object is" : "objects are"} offline or degraded in ${object.label}: ${offlineDevices.map((item) => text(item.name || item.label || item.id)).filter(Boolean).slice(0, 5).join(", ")}.`;
    return `I don’t see confirmed offline areas in ${object.label}.`;
  }
  if (/maintenance|unresolved|fault|issue/.test(message)) {
    const unresolved = unresolvedMaintenanceRecordsForContext(object, input);
    return maintenanceLinkedIssueSummary(object, unresolved.length);
  }
  return "";
}

function spatialDependencyLine(object: OperationalObject, input: CanonicalConversationRequest) {
  const relationships = spatialRelationships(object, input);
  const dependencies = namesFromRelationship(relationships.dependencies || relationships.upstream_assets, "dependency");
  const affectedAreas = namesFromRelationship(relationships.affected_areas || relationships.affected_rooms || relationships.affected_homes, "area");
  const dependentObjects = namesFromRelationship(relationships.dependent_devices || relationships.dependent_objects || relationships.downstream_objects, "object");
  const parts: string[] = [];
  if (dependencies.length) parts.push(`It depends on ${dependencies.slice(0, 3).join(", ")}.`);
  if (dependentObjects.length) parts.push(`${dependentObjects.length} downstream ${dependentObjects.length === 1 ? "object depends" : "objects depend"} on it: ${dependentObjects.slice(0, 4).join(", ")}.`);
  if (affectedAreas.length) parts.push(`Affected areas include ${affectedAreas.slice(0, 4).join(", ")}.`);
  return parts.join(" ");
}

function spatialReasoningReply(input: CanonicalConversationRequest, object: OperationalObject) {
  if (!isSpatialRequest(input.message)) return "";
  const message = input.message.toLowerCase();
  const hierarchy = spatialHierarchyLine(object, input);
  const containment = spatialContainmentLine(object, input);
  const dependencies = spatialDependencyLine(object, input);
  const aggregate = spatialAreaAggregation(input, object);
  if (/\b(where|located|which room|which floor|which building|entrance|protecting|owns this|belongs)\b/i.test(message)) {
    return hierarchy || dependencies || `I don’t have a confirmed spatial location for ${object.label} yet.`;
  }
  if (/\b(contains|contain|inside|what is in|show me)\b/i.test(message) || /\b(upstairs|downstairs|second floor|floor|building|wing|block|tower)\b/i.test(message)) {
    return [hierarchy, containment, dependencies].filter(Boolean).join(" ") || `I don’t have contained-object evidence for ${object.label} yet.`;
  }
  if (aggregate) return `${aggregate} ${dependencies || recommendationFor(object, input)}`;
  if (/\b(why|dark|wrong|affected|failure|impact|depends|dependency)\b/i.test(message)) {
    return [objectStateLine(object), dependencies || containment, recommendationFor(object, input)].filter(Boolean).join(" ");
  }
  if (hierarchy || containment || dependencies) return [hierarchy, containment, dependencies, recommendationFor(object, input)].filter(Boolean).join(" ");
  return "";
}

function predictionEvidence(input: CanonicalConversationRequest) {
  const predictions = Array.isArray(input.predictive_findings) ? input.predictive_findings.map(recordOf) : [];
  return predictions
    .map((item) => text(item.summary || item.title || item.finding || item.recommended_action))
    .filter(Boolean)
    .slice(0, 2);
}

export function recommendationFor(object: OperationalObject, input: CanonicalConversationRequest) {
  const lower = input.message.toLowerCase();
  const state = `${object.current_state || ""} ${input.primary_state || ""}`.toLowerCase();
  if ((object.object_type === "device" || object.object_type === "device_channel") && /\b(on|active)\b/.test(state)) {
    if (/\benergy|usage|power\b/.test(lower)) return "I recommend reviewing energy usage next.";
    return "Would you like to view history, check energy usage, or create an automation?";
  }
  if ((object.object_type === "device" || object.object_type === "device_channel") && /\b(off|inactive)\b/.test(state)) {
    return "Would you like to check health, view history, or create a schedule?";
  }
  if (object.object_type === "maintenance_request") return maintenanceRecommendation();
  if (object.object_type === "wallet" || object.object_type === "transaction") return "I recommend checking the receipt or recent transactions next.";
  if (object.object_type === "service_account" || object.object_type === "meter") return serviceRecommendation();
  if (object.object_type === "visitor" || object.object_type === "access_pass") return visitorRecommendation();
  if (object.object_type === "access_point" || object.object_type === "camera" || object.object_type === "operational_incident") return securityRecommendation(object);
  if (object.object_type === "message_thread" || object.object_type === "community_post") return communityRecommendation(object);
  if (object.object_type === "scene" || object.object_type === "automation") return sceneAutomationRecommendation(object);
  if (object.object_type === "room" || object.object_type === "zone") return "I recommend checking active devices before changing the whole room.";
  return objectVoice(object).next;
}

export function buildGenericRecommendationAnswer(object: OperationalObject | null, facts: IntelligenceFact[]) {
  if (object && !["home", "room"].includes(object.object_type)) {
    return recommendationFor(object, { message: "recommend", surface: "consumer" } as CanonicalConversationRequest);
  }
  const availability = facts.filter((fact) => fact.fact_type === "device_availability");
  const notRecent = availability
    .filter((fact) => ["stale", "expired", "unknown", "provider_disconnected", "offline"].includes(text(recordOf(fact.value).availability)))
    .slice(0, 3);
  if (notRecent.length) {
    const names = notRecent.map((fact) => cleanLabel(fact.object?.label, "device")).join(", ");
    const scope = object?.object_type === "room" ? ` in ${object.label}` : "";
    return `Start with ${names}${scope}. These have the clearest availability or freshness concern in the authorised evidence.`;
  }
  const failures = facts.filter((fact) => /failed|unavailable|timeout|warning|critical/i.test(`${fact.statement} ${JSON.stringify(fact.value)}`));
  return failures.length ? "I recommend checking the unresolved item with the freshest failed evidence first." : "No immediate action is required from the evidence I can see.";
}

function operationalReasoningReply(input: CanonicalConversationRequest, response: Record<string, unknown>, object: OperationalObject) {
  const requested = requestedPowerState(input.message);
  const state = `${object.current_state || ""} ${input.primary_state || ""}`.toLowerCase();
  const relationshipFacts = relationshipEvidence(object, input);
  const predictionFacts = predictionEvidence(input);
  const memory = memoryLine(object, input);
  const recommendation = recommendationFor(object, input);
  const spatialReply = spatialReasoningReply(input, object);
  if (spatialReply) return spatialReply;

  if (isExplanationRequest(input.message)) {
    const evidence = [...relationshipFacts, memory, ...predictionFacts].filter(Boolean);
    if (evidence.length) {
      return `${evidence.slice(0, 2).map(sentence).join(" ")} ${recommendation}`;
    }
    return `I don’t have enough evidence to explain that confidently yet. ${recommendation}`;
  }

  if (requested && (object.object_type === "device" || object.object_type === "device_channel")) {
    const isAlreadyOn = requested === "on" && /\b(on|active)\b/.test(state);
    const isAlreadyOff = requested === "off" && /\b(off|inactive)\b/.test(state);
    if (isAlreadyOn || isAlreadyOff) {
      return `${object.label} is already ${requested.toUpperCase()}. Nothing needed to change. ${recommendation}`;
    }
  }

  if (/\bturn everything off\b/i.test(input.message) && relationshipFacts.some((fact) => /occupied/.test(fact))) {
    return `${relationshipFacts.find((fact) => /occupied/.test(fact))}. I recommend switching off only the unoccupied areas first.`;
  }

  if (predictionFacts.length && !isControlRequest(input.message)) {
    return `${objectStateLine(object)} ${predictionFacts.map((item) => `Based on recent activity, ${item.charAt(0).toLowerCase()}${item.slice(1)}`).join(" ")} ${recommendation}`;
  }

  if (isControlRequest(input.message) && relationshipFacts.length && !executionStatus(response)) {
    return `${relationshipFacts.slice(0, 2).map(sentence).join(" ")} ${recommendation}`;
  }

  return "";
}

function executionStatus(response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const direct = text(execution.status).toLowerCase();
  const results = Array.isArray(execution.results) ? execution.results : [];
  const first = recordOf(results[0]);
  return text(first.status || direct).toLowerCase();
}

function executionRealityReply(object: OperationalObject, response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const status = executionStatus(response);
  const results = Array.isArray(execution.results) ? execution.results.map(recordOf) : [];
  const reason = text(execution.reason || execution.error || recordOf(results[0]).reason || recordOf(results[0]).message);
  if (/state_confirmed|executed|success|successful|completed|processed/.test(status)) {
    const state = naturalState(recordOf(results[0]).new_state || recordOf(results[0]).state || object.current_state);
    return state
      ? `Done. ${object.label} is now ${state}. ${objectVoice(object).healthy}`
      : `Done. ${object.label} completed the request successfully. ${objectVoice(object).healthy}`;
  }
  if (/provider accepted|accepted|partial|partial_confirmation/.test(status)) {
    return `${object.label} responded to the request. I’m still waiting for confirmation from the controller, so I’ll keep monitoring it.`;
  }
  if (/pending_confirmation|confirmation_required/.test(status) || response.requiresConfirmation || response.approvalRequired) {
    return contextualConfirmationReply(object, response);
  }
  if (/timeout|timed_out/.test(status)) {
    return `I couldn't complete that action. ${object.label} did not respond before the timeout, so I have not marked anything as changed.`;
  }
  if (/unsupported|validation_required/.test(status)) {
    return `${object.label} doesn’t support that feature. ${reason ? naturalizeUserCopy(reason) : "I can still show its status, health, and activity history."}`;
  }
  if (/permission|denied/.test(status)) {
    return `I can’t do that on ${object.label} from your current access level.`;
  }
  if (/failed|error/.test(status)) {
    return reason ? `I couldn't complete that action for ${object.label}. ${naturalizeUserCopy(reason)}` : `I couldn't complete that action for ${object.label}. Nothing has been confirmed as changed.`;
  }
  return "";
}

function contextualConfirmationReply(object: OperationalObject, response: Record<string, unknown>) {
  const execution = recordOf(response.execution);
  const confirmations = Array.isArray(response.confirmations) ? response.confirmations.map(recordOf) : [];
  const pending = confirmations[0] || recordOf((Array.isArray(execution.results) ? execution.results : []).map(recordOf).find((row) => row.status === "pending_confirmation"));
  const summary = text(pending.summary || pending.title || execution.summary || response.understood);
  const capabilities = object.capabilities.map((item) => item.toLowerCase());
  if (object.object_type === "device" || object.object_type === "device_channel") {
    if (capabilities.some((item) => /switch|power|relay|lock|curtain|scene|automation/.test(item))) {
      return summary
        ? `${naturalizeUserCopy(summary)} Would you like me to continue?`
        : `I found the correct ${objectTypeLabel(object)}. Should I do that now?`;
    }
    return `${object.label} may not support that exact control. Should I continue with the nearest safe option?`;
  }
  if (object.object_type === "wallet" || object.object_type === "transaction") {
    return summary
      ? `${naturalizeUserCopy(summary)} Should I continue with this payment step?`
      : `This affects the financial record for ${object.label}. Should I continue?`;
  }
  if (object.object_type === "visitor" || object.object_type === "access_pass") {
    return visitorConfirmationReply(object, response);
  }
  if (object.object_type === "maintenance_request") {
    return maintenanceConfirmationReply(object, response);
  }
  if (object.object_type === "service_account" || object.object_type === "meter") {
    return serviceConfirmationReply(object, response);
  }
  if (object.object_type === "access_point" || object.object_type === "camera" || object.object_type === "operational_incident") {
    return securityConfirmationReply(object, response);
  }
  if (object.object_type === "message_thread" || object.object_type === "community_post") {
    return communityConfirmationReply(object, response);
  }
  if (object.object_type === "scene" || object.object_type === "automation") {
    return sceneAutomationConfirmationReply(object, response);
  }
  return summary ? `${naturalizeUserCopy(summary)} Would you like me to continue?` : `I can do that for ${object.label}. Should I continue?`;
}

export function objectCapabilityLine(object: OperationalObject) {
  const profile = objectPersonality(object);
  const actions = profile.actions.slice(0, 4).join(", ");
  const diagnostics = profile.diagnostics.slice(0, 4).join(", ");
  return `${profile.role} I can help with ${actions}, and explain ${diagnostics}.`;
}

function objectDefaultReply(object: OperationalObject, input: CanonicalConversationRequest) {
  const lines = [objectStateLine(object)];
  const memory = memoryLine(object, input);
  const relationships = relationshipLine(object, input);
  if (memory) lines.push(memory);
  if (relationships) lines.push(relationships);
  lines.push(memory || relationships ? objectVoice(object).next : objectCapabilityLine(object));
  return lines.join(" ");
}

function objectQuestionReply(input: CanonicalConversationRequest, response: Record<string, unknown>, object: OperationalObject) {
  const message = input.message.toLowerCase();
  const base = objectDefaultReply(object, input);
  if (/\b(activity|history|what happened|last time|last command|last execution|how long|how many times|who turned|who controlled)\b/i.test(message)) {
    const memory = memoryLine(object, input);
    return memory
      ? `${memory} ${relationshipLine(object, input) || ""}`.trim()
      : `I don’t have detailed recent activity for ${object.label} yet. I can still check its current status and relationships.`;
  }
  if (/\b(relationship|relationships|what controls|depends|affected|scene|automation|where is|belongs|parent|children)\b/i.test(message)) {
    return relationshipLine(object, input) || `I don’t see linked relationships for ${object.label} yet.`;
  }
  if (/\b(working|health|healthy|offline|online|fault|diagnose|why.*fail|why.*not|connection|status)\b/i.test(message)) {
    return base;
  }
  if (/\b(evidence|how do you know|are you sure|provider confirm|confirmed|last updated|prediction|fact)\b/i.test(message)) {
    return evidenceLine(object, response);
  }
  if (/\b(what can|who are you|what are you|help)\b/i.test(message)) {
    return `You're talking to ${object.label}. ${objectCapabilityLine(object)}`;
  }
  return "";
}

export function contextualObjectActions(object: OperationalObject, input: CanonicalConversationRequest) {
  const actions: Array<Record<string, unknown>> = [];
  const state = `${object.current_state || ""} ${input.primary_state || ""}`.toLowerCase();
  const capabilities = new Set([...(object.capabilities || []), ...(input.supported_controls || [])].map((item) => item.toLowerCase()));
  const add = (label: string, prompt: string, risk = "read") => actions.push({ label, prompt, risk, operational_object: { object_type: object.object_type, canonical_id: object.canonical_id } });
  if (object.object_type === "device" || object.object_type === "device_channel") {
    if (capabilities.has("switch") || capabilities.has("power") || capabilities.has("switch_1") || /switch|light|plug|relay/.test([...capabilities].join(" "))) {
      add(/on|active/.test(state) ? "Turn Off" : "Turn On", /on|active/.test(state) ? "Turn it off" : "Turn it on", "control");
    }
    add("Show Activity", "Show activity");
    add("Health", "Is it working?");
    if (/off|inactive|closed/.test(state)) add("Create Schedule", "Create schedule");
    else add("Energy", "Show energy usage");
    add("Automation", "Create automation");
    add("Relationships", "What controls you?");
  } else if (object.object_type === "room" || object.object_type === "zone") {
    add("Active Devices", "What is on?");
    add("Turn Off Room", "Turn everything off", "control");
    add("Occupancy", "Is it occupied?");
    add("Activity", "What happened here today?");
  } else if (object.object_type === "visitor" || object.object_type === "access_pass") {
    actions.push(...visitorContextualActions(object));
  } else if (object.object_type === "maintenance_request") {
    actions.push(...maintenanceContextualActions(object));
  } else if (object.object_type === "wallet" || object.object_type === "transaction") {
    add("Status", object.object_type === "transaction" ? "Did this payment enter?" : "Show balance");
    add("Receipt", "Show receipt");
    add("History", "Show transactions");
  } else if (object.object_type === "service_account" || object.object_type === "meter") {
    actions.push(...serviceContextualActions(object));
  } else if (object.object_type === "camera") {
    actions.push(...securityContextualActions(object));
  } else if (object.object_type === "access_point" || object.object_type === "operational_incident") {
    actions.push(...securityContextualActions(object));
  } else if (object.object_type === "message_thread" || object.object_type === "community_post") {
    actions.push(...communityContextualActions(object));
  } else if (object.object_type === "scene" || object.object_type === "automation") {
    actions.push(...sceneAutomationContextualActions(object));
  } else {
    add("Status", "What is happening?");
    add("Activity", "Show activity");
    add("Relationships", "What depends on this?");
    add("Evidence", "Show evidence");
  }
  return actions.slice(0, 6);
}


export function shapeObjectConversation(input: CanonicalConversationRequest, response: Record<string, unknown>, object: OperationalObject | null) {
  if (!object) return response;
  const next = { ...response };
  const status = executionStatus(response);
  const existing = cleanLabel(response.reply || response.message, "");
  const executionReply = executionRealityReply(object, response);
  const reasoningReply = !executionReply ? operationalReasoningReply(input, response, object) : "";
  let objectReply = executionReply || reasoningReply || objectQuestionReply(input, response, object);
  if (!objectReply && !broadSummaryRequested(input.message) && looksLikeBroadFallback(existing)) objectReply = objectDefaultReply(object, input);
  if (!objectReply && !broadSummaryRequested(input.message) && /^(yes|yep|yeah|proceed|confirm|go ahead|do it|continue|execute)$/i.test(input.message.trim())) {
    objectReply = contextualConfirmationReply(object, response);
  }
  if (objectReply) {
    next.message = objectReply;
    next.reply = objectReply;
    next.understood = text(next.understood) || `I am answering for ${object.label}.`;
  }
  if (objectReply && /\b(evidence|how do you know|are you sure|provider confirm|confirmed|last updated|prediction|fact)\b/i.test(input.message)) {
    next.truth_note = truthLanguage(truthStateFromCompatibility(next), object);
  }
  const existingActions = Array.isArray(next.suggested_actions) ? next.suggested_actions : [];
  next.suggested_actions = contextualObjectActions(object, input).length
    ? contextualObjectActions(object, input)
    : existingActions;
  if (next.message) next.message = naturalizeUserCopy(next.message);
  if (next.reply) next.reply = naturalizeUserCopy(next.reply);
  return next;
}
