import type { OyiSurface } from "../../services/oyiUnifiedIntelligenceService";

export type OperationClass =
  | "read"
  | "report"
  | "recommend"
  | "list"
  | "navigate"
  | "propose_mutation"
  | "confirm_mutation"
  | "execute_mutation"
  | "compose"
  | "approve"
  | "reject"
  | "cancel"
  | "handoff"
  | "continue_workflow"
  | "clarify";

export type CanonicalIntent =
  | "information"
  | "capability"
  | "current_state"
  | "health_check"
  | "recent_changes"
  | "activity_history"
  | "failure_history"
  | "explanation"
  | "investigation"
  | "diagnosis"
  | "relationships"
  | "device_availability_inventory"
  | "home_operational_summary"
  | "evidence"
  | "comparison"
  | "trend"
  | "forecast"
  | "recommendation"
  | "report"
  | "device_control"
  | "scene_execution"
  | "automation_operation"
  | "visitor_operation"
  | "access_operation"
  | "security_operation"
  | "maintenance_operation"
  | "wallet_operation"
  | "service_operation"
  | "community_operation"
  | "message_operation"
  | "notification_operation"
  | "configuration_operation"
  | "general_help"
  | "command_outcome"
  | "module_navigation"
  | "domain_list";

export type ScopeMode =
  | "exact_target"
  | "room_scope"
  | "home_scope"
  | "building_scope"
  | "estate_scope"
  | "explicit_broad_scope"
  | "thread_scope"
  | "global_scope"
  | "clarification";

export type OyiDestinationDefinition = {
  key: string;
  domain: string;
  object_type: string | null;
  mode: "module" | "list" | "detail" | "drawer" | "live_view" | "review" | "approval";
  supported_surfaces: OyiSurface[];
  required_parameters: string[];
  required_permission: string | null;
  label: string;
};

export type SemanticOperationResult = {
  intent: CanonicalIntent;
  operationClass: OperationClass;
  scopeMode: ScopeMode;
  answerBuilder: string;
  domain: string;
  destination: OyiDestinationDefinition;
  parameters: Record<string, string>;
};

export type IntelligenceRequestContract = {
  conversation_request_id: string;
  thread_id: string | null;
  surface: OyiSurface;
  operation_class: OperationClass;
  intent: CanonicalIntent;
  scope_mode: ScopeMode;
  temporal_scope: {
    mode: "current" | "recent" | "today" | "yesterday" | "custom" | "historical" | "forecast" | "this_week" | "last_week" | "last_month";
    from: string | null;
    to: string | null;
  };
  target: {
    object_type: string | null;
    canonical_id: string | null;
    parent_id: string | null;
    channel_code: string | null;
    label: string | null;
  };
  mutation: {
    requested: boolean;
    confirmed: boolean;
    command: string | null;
    desired_state: unknown;
    risk_class: string | null;
  };
  evidence_requirements: {
    current_state: boolean;
    recent_events: boolean;
    execution_history: boolean;
    audit_history: boolean;
    relationships: boolean;
    permissions: boolean;
    provider_state: boolean;
    financial_ledger: boolean;
    access_records: boolean;
  };
  answer_builder: string;
  report_builder: string | null;
  truth_policy: string;
  confidence: number;
  ambiguity?: {
    required: boolean;
    reason: "ambiguous" | "not_found" | null;
    question: string | null;
    candidates: Array<Record<string, unknown>>;
  };
};

function text(value: unknown) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizeLookupText(value: unknown) {
  return text(value).toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanLabel(value: unknown, fallback: string) {
  const raw = text(value);
  return raw || fallback;
}

export const SEMANTIC_DESTINATIONS: Record<string, OyiDestinationDefinition> = {
  "devices.module": { key: "devices.module", domain: "devices", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "devices.read", label: "Devices" },
  "devices.detail": { key: "devices.detail", domain: "devices", object_type: "device", mode: "detail", supported_surfaces: ["consumer", "facility"], required_parameters: ["device_id"], required_permission: "devices.read", label: "Device details" },
  "devices.channel": { key: "devices.channel", domain: "devices", object_type: "device_channel", mode: "detail", supported_surfaces: ["consumer"], required_parameters: ["device_id", "channel_code"], required_permission: "devices.read", label: "Device channel" },
  "visitors.module": { key: "visitors.module", domain: "visitors", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "visitors.read", label: "Visitors" },
  "visitors.detail": { key: "visitors.detail", domain: "visitors", object_type: "visitor", mode: "detail", supported_surfaces: ["consumer", "facility"], required_parameters: ["visitor_id"], required_permission: "visitors.read", label: "Visitor details" },
  "wallet.summary": { key: "wallet.summary", domain: "wallet", object_type: "wallet", mode: "module", supported_surfaces: ["consumer"], required_parameters: [], required_permission: "wallet.read", label: "Wallet" },
  "wallet.transaction": { key: "wallet.transaction", domain: "transactions", object_type: "transaction", mode: "detail", supported_surfaces: ["consumer"], required_parameters: ["transaction_id"], required_permission: "wallet.read", label: "Transaction" },
  "wallet.review": { key: "wallet.review", domain: "wallet", object_type: "wallet", mode: "review", supported_surfaces: ["consumer"], required_parameters: [], required_permission: "wallet.review", label: "Wallet review" },
  "maintenance.module": { key: "maintenance.module", domain: "maintenance", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "maintenance.read", label: "Maintenance" },
  "maintenance.detail": { key: "maintenance.detail", domain: "maintenance", object_type: "maintenance_request", mode: "detail", supported_surfaces: ["consumer", "facility"], required_parameters: ["request_id"], required_permission: "maintenance.read", label: "Maintenance request" },
  "scenes.module": { key: "scenes.module", domain: "scenes", object_type: null, mode: "module", supported_surfaces: ["consumer"], required_parameters: [], required_permission: "scenes.read", label: "Scenes" },
  "scenes.detail": { key: "scenes.detail", domain: "scenes", object_type: "scene", mode: "detail", supported_surfaces: ["consumer"], required_parameters: ["scene_id"], required_permission: "scenes.read", label: "Scene" },
  "automations.module": { key: "automations.module", domain: "automations", object_type: null, mode: "module", supported_surfaces: ["consumer"], required_parameters: [], required_permission: "automations.read", label: "Automations" },
  "automations.detail": { key: "automations.detail", domain: "automations", object_type: "automation", mode: "detail", supported_surfaces: ["consumer"], required_parameters: ["automation_id"], required_permission: "automations.read", label: "Automation" },
  "rooms.module": { key: "rooms.module", domain: "rooms", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "rooms.read", label: "Rooms" },
  "rooms.detail": { key: "rooms.detail", domain: "rooms", object_type: "room", mode: "detail", supported_surfaces: ["consumer", "facility"], required_parameters: ["room_name"], required_permission: "rooms.read", label: "Room" },
  "community.module": { key: "community.module", domain: "community", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "community.read", label: "Community" },
  "services.module": { key: "services.module", domain: "services", object_type: null, mode: "module", supported_surfaces: ["consumer"], required_parameters: [], required_permission: "services.read", label: "Services" },
  "messages.module": { key: "messages.module", domain: "messages", object_type: null, mode: "module", supported_surfaces: ["consumer"], required_parameters: [], required_permission: "messages.read", label: "Messages" },
  "notifications.module": { key: "notifications.module", domain: "notifications", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "notifications.read", label: "Notifications" },
  "security.module": { key: "security.module", domain: "security", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "security.read", label: "Security" },
  "utilities.module": { key: "utilities.module", domain: "utilities", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "utilities.read", label: "Utilities" },
  "cameras.module": { key: "cameras.module", domain: "cameras", object_type: null, mode: "module", supported_surfaces: ["consumer", "facility"], required_parameters: [], required_permission: "cameras.read", label: "Cameras" },
  "camera.private_live_view": { key: "camera.private_live_view", domain: "cameras", object_type: "camera", mode: "live_view", supported_surfaces: ["consumer"], required_parameters: ["camera_id"], required_permission: "cameras.private.read", label: "Camera live view" },
  "camera.shared_live_view": { key: "camera.shared_live_view", domain: "cameras", object_type: "camera", mode: "live_view", supported_surfaces: ["facility"], required_parameters: ["camera_id"], required_permission: "cameras.shared.read", label: "Shared camera live view" },
  "incident.detail": { key: "incident.detail", domain: "incidents", object_type: "operational_incident", mode: "detail", supported_surfaces: ["consumer", "facility"], required_parameters: ["incident_id"], required_permission: "incidents.read", label: "Incident" },
  "digital_twin.object": { key: "digital_twin.object", domain: "digital_twin", object_type: "twin_node", mode: "detail", supported_surfaces: ["facility"], required_parameters: ["node_id"], required_permission: "digital_twin.read", label: "Digital twin object" },
};

const MODULE_DOMAIN_ALIASES: Array<{ domain: string; destination: string; pattern: RegExp }> = [
  { domain: "devices", destination: "devices.module", pattern: /\b(devices?|hardware|switches?|sockets?|lights?)\b/i },
  { domain: "visitors", destination: "visitors.module", pattern: /\b(visitors?|guests?|access requests?|passes?)\b/i },
  { domain: "wallet", destination: "wallet.summary", pattern: /\b(wallet|balance|dues|payments?|transactions?)\b/i },
  { domain: "maintenance", destination: "maintenance.module", pattern: /\b(maintenance|repairs?|tickets?|requests?)\b/i },
  { domain: "scenes", destination: "scenes.module", pattern: /\b(scenes?)\b/i },
  { domain: "automations", destination: "automations.module", pattern: /\b(automations?|routines?|schedules?)\b/i },
  { domain: "rooms", destination: "rooms.module", pattern: /\b(rooms?|spaces?)\b/i },
  { domain: "community", destination: "community.module", pattern: /\b(community|announcements?|building announce(?:d)?|management updates?|residents group|posts?)\b/i },
  { domain: "services", destination: "services.module", pattern: /\b(services?|vendors?|providers?)\b/i },
  { domain: "messages", destination: "messages.module", pattern: /\b(messages?|chat|inbox|dm|direct messages?)\b/i },
  { domain: "notifications", destination: "notifications.module", pattern: /\b(notifications?|alerts?)\b/i },
  { domain: "security", destination: "security.module", pattern: /\b(security)\b/i },
  { domain: "utilities", destination: "utilities.module", pattern: /\b(utilities|utility|power|water|internet|gas|electricity)\b/i },
  { domain: "cameras", destination: "cameras.module", pattern: /\b(cameras?|cctv)\b/i },
];

export function isReadOnlyBroadDeviceIntent(message: string) {
  return /\b(show|list|which|what|check|find)\b[\s\S]{0,40}\b(offline|unavailable|down|failed)\b[\s\S]{0,30}\bdevices?\b/i.test(message)
    || /\b(show|list|which)\b[\s\S]{0,40}\bdevices?\b[\s\S]{0,30}\b(offline|unavailable|down|failed)\b/i.test(message);
}

export function isExplicitBroadHomeReadIntent(message: string, scopeHint?: string | null) {
  const lower = message.toLowerCase();
  if (isReadOnlyBroadDeviceIntent(message)) return true;
  if (/\b(this|selected|current)\b[\s\S]{0,20}\b(device|channel|switch|tv|remote|light|socket|plug)\b/i.test(lower)) return false;
  if (/\b(channel|gang|switch)\s*[123]\b/i.test(lower)) return false;
  if (/\bfor\s+this\s+(device|channel|switch|tv|remote|light|socket|plug)\b/i.test(lower)) return false;
  if (/\bwhat(?:'s| is) happening\b[\s\S]{0,24}\b(home|house|apartment|unit)\b/i.test(lower)) return true;
  if (/\bwhat changed recently\b/i.test(lower)) return true;
  if (/\brecent changes\b[\s\S]{0,24}\b(home|house|apartment|unit)\b/i.test(lower)) return true;
  if (/\bwhat needs attention\b/i.test(lower)) return true;
  if (/\bis everything okay\b/i.test(lower)) return true;
  if (/\b(home|house|apartment|unit)\b[\s\S]{0,24}\b(report|summary|recent|changed|changes|offline|unavailable)\b/i.test(lower)) return true;
  if (/\b(show|list|check|find)\b[\s\S]{0,24}\b(all|home|house)\b[\s\S]{0,24}\b(devices|changes|activity|issues)\b/i.test(lower)) return true;
  return false;
}

export function currentTurnExplicitlyGlobal(message: string) {
  const normalized = normalizeLookupText(message);
  return /\b(what can you do|what can u do|help me understand oyi|^help\b|what should i (?:check|cheek) first\??$|what needs attention overall|is everything okay at home)\b/i.test(text(message))
    || ["what can you do", "what can u do", "what should i check first", "what should i cheek first"].includes(normalized);
}

export function domainForCurrentTurn(message: string) {
  const lower = text(message).toLowerCase();
  if (/\breport\b[\s\S]{0,24}\b(problem|issue|fault|repair|broken|not working)\b/i.test(lower)) return "maintenance";
  if (/\b(report|analytics?|trend|trends|comparison|compare|performance summary)\b/i.test(lower)) return "reports";
  if (/\b(community|announcements?|building announce(?:d)?|management updates?|residents group|community posts?|post this to the community|tell (?:the )?residents|notify (?:the )?residents)\b/i.test(lower)) return "community";
  if (/\b(tell me what|what did|what was the last|latest message|unread messages?|reply\b|send a message|message from|direct message|inbox|dm)\b/i.test(lower)) return "messages";
  if (/\b(scenes?|movie mode|good night|bedtime scene)\b/i.test(lower)) return "scenes";
  if (/\b(automations?|routines?|schedules?|every\s+(?:night|morning|day|weekday)|at\s+midnight|when i leave|when i arrive|turn .* every night|make .* turn off)\b/i.test(lower)) return "automations";
  if (/\b(wallet|balance|dues|payments?|transactions?|histry|history)\b/i.test(lower) && /\b(wallet|transactions?|payments?|balance|dues|histry|history)\b/i.test(lower)) return "wallet";
  if (/\b(utilities|utility|electricity|power|water|internet|gas)\b/i.test(lower)) return "utilities";
  if (/\b(visitors?|visiting|guests?|visitor access|guest access|access pass|gate pass|access code|invite\b|arrived|arrival|came in|come in|allowed in|give .* access|revoke .* access|extend .* access|(?:extend|revoke|cancel|approve|deny|reject)\b[\s\S]{0,24}\bcode)\b/i.test(lower)) return "visitors";
  if (/\b(security|alerts?|alarms?|gate|front door|access denied|unusual access|security issues?|incidents?|acknowledge|escalate)\b/i.test(lower)) return "security";
  if (/\b(services?|service requests?|service bookings?|providers?|book cleaning|cleaning service|cleaning request|cleaning booking|request a technician|book .*servicing|service status|available services)\b/i.test(lower)) return "services";
  const matched = MODULE_DOMAIN_ALIASES.find((entry) => entry.pattern.test(message));
  return matched?.domain || null;
}

export function currentTurnHasExplicitDomain(message: string) {
  return Boolean(domainForCurrentTurn(message));
}

export function operationForCurrentTurn(message: string, isControlRequest: (message: string) => boolean) {
  const lower = text(message).toLowerCase();
  if (/^\s*(open|go to|take me to)\b/i.test(lower)) return "navigate";
  if (/\bhow much\b[\s\S]{0,50}\b(spent|spend|paid|pay)\b/i.test(lower)) return "summarize";
  if (/\bwhat should i (?:check|cheek) first\b|\bwhat needs attention\b/i.test(lower)) return "recommend";
  if (/\bwhat can (?:you|u) do\b|\bcapabilit|^help\b/i.test(lower)) return "inform";
  if (/\b(show|list|view)\b/i.test(lower)) return "list";
  if (/\bwhat(?:'s| is) happening|summary|everything okay\b/i.test(lower)) return "summarize";
  if (isControlRequest(message)) return "execute";
  return "inform";
}

export function currentTurnAllowsDeviceResolution(message: string, options: {
  roomPhraseFromMessage: (message: string) => string;
  isControlRequest: (message: string) => boolean;
  currentTurnReferencesInheritedTarget: (message: string) => boolean;
}) {
  const lower = text(message).toLowerCase();
  const domain = domainForCurrentTurn(message);
  if (domain && domain !== "devices") return false;
  if (currentTurnExplicitlyGlobal(message)) return false;
  if (options.roomPhraseFromMessage(message)) return false;
  if (/\b(wallet|transactions?|utilities|utility|electricity|water|internet|services?|visitors?|maintenance|messages?|community|announcements?|posts?|scenes?|automations?)\b/i.test(lower)) return false;
  return options.isControlRequest(message)
    || /\b(device|channel|switch|socket|plug|light|lamp|tv|remote|ac|fan)\b/i.test(lower)
    || options.currentTurnReferencesInheritedTarget(message);
}

export function interpretSemanticOperation(message: string, options: {
  roomPhraseFromMessage: (message: string) => string;
}) {
  const lower = message.toLowerCase();
  const verb = lower.match(/^\s*(open|go to|take me to|show|list|view)\b/i)?.[1] || "";
  if (!verb) return null;
  if (/^(show|list|view)$/i.test(verb) && options.roomPhraseFromMessage(message)) return null;
  if (
    isReadOnlyBroadDeviceIntent(message)
    || /\bwhat changed|changed recently|recent changes\b/i.test(lower)
    || /\b(activity|history|failures?|errors?|diagnose|diagnosis|relationships?|what controls|where.*belong)\b/i.test(lower)
    || /\bwhat(?:'s| is) happening\b[\s\S]{0,24}\b(home|house|apartment|unit)\b/i.test(lower)
    || /\bwhat needs attention|is everything okay|home summary|home report\b/i.test(lower)
  ) {
    return null;
  }
  const roomMatch = message.match(/^\s*(open|go to|take me to)\s+(?:the\s+)?((?:(?:second|first|third)\s+)?(?:bedroom|room|living room|kitchen|bathroom|parlor|lounge|office|study|garage|balcony|dining room)\s*[a-z0-9-]*)\b/i);
  if (roomMatch) {
    const roomName = cleanLabel(roomMatch[2], "");
    return {
      intent: "module_navigation" as CanonicalIntent,
      operationClass: "navigate" as OperationClass,
      scopeMode: "room_scope" as ScopeMode,
      answerBuilder: "semantic_navigation",
      domain: "rooms",
      destination: SEMANTIC_DESTINATIONS["rooms.detail"],
      parameters: { room_name: roomName },
    };
  }
  const matched = MODULE_DOMAIN_ALIASES.find((entry) => entry.pattern.test(message));
  if (!matched) return null;
  const destination = SEMANTIC_DESTINATIONS[matched.destination];
  const operationClass: OperationClass = /^open|go to|take me to$/i.test(verb) ? "navigate" : "list";
  return {
    intent: operationClass === "navigate" ? "module_navigation" as CanonicalIntent : "domain_list" as CanonicalIntent,
    operationClass,
    scopeMode: "home_scope" as ScopeMode,
    answerBuilder: operationClass === "navigate" ? "semantic_navigation" : "domain_list",
    domain: matched.domain,
    destination,
    parameters: {},
  };
}

export function routeForSemanticDestination(destinationKey: string, surface: OyiSurface) {
  const consumerRoutes: Record<string, string> = {
    "devices.module": "/devices",
    "visitors.module": "/visitors",
    "wallet.summary": "/wallet",
    "maintenance.module": "/maintenance",
    "scenes.module": "/scenes",
    "automations.module": "/scenes?tab=automations",
    "rooms.module": "/rooms",
    "rooms.detail": "/room",
    "community.module": "/community",
    "services.module": "/services",
    "messages.module": "/messages",
    "notifications.module": "/notifications",
    "security.module": "/security",
    "utilities.module": "/utilities",
    "cameras.module": "/security?tab=cameras",
  };
  const facilityRoutes: Record<string, string> = {
    "devices.module": "/devices",
    "visitors.module": "/visitors",
    "maintenance.module": "/maintenance",
    "rooms.module": "/estate",
    "rooms.detail": "/estate",
    "community.module": "/community",
    "notifications.module": "/notifications",
    "security.module": "/security",
    "utilities.module": "/utilities",
    "cameras.module": "/cameras",
  };
  return (surface === "facility" ? facilityRoutes : consumerRoutes)[destinationKey] || "/";
}

export function routeWithSemanticParameters(route: string, parameters: Record<string, string>) {
  const entries = Object.entries(parameters).filter(([, value]) => text(value));
  if (!entries.length) return route;
  const separator = route.includes("?") ? "&" : "?";
  return `${route}${separator}${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&")}`;
}

export function semanticOperationAction(message: string, surface: OyiSurface, options: {
  roomPhraseFromMessage: (message: string) => string;
}) {
  const operation = interpretSemanticOperation(message, options);
  if (!operation?.destination) return null;
  const allowed = operation.destination.supported_surfaces.includes(surface);
  const route = routeWithSemanticParameters(routeForSemanticDestination(operation.destination.key, surface), recordOf(operation.parameters) as Record<string, string>);
  return {
    operation,
    allowed,
    route,
    action: {
      type: operation.operationClass === "navigate" ? "navigation" : "open_module",
      label: operation.operationClass === "navigate" ? `Open ${operation.destination.label}` : `View ${operation.destination.label}`,
      route,
      destination: {
        key: operation.destination.key,
        domain: operation.destination.domain,
        mode: operation.destination.mode,
        parameters: recordOf(operation.parameters),
      },
      operation_class: operation.operationClass,
      risk: "read",
    },
  };
}
