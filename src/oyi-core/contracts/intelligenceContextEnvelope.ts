export type IntelligenceSurface = "consumer" | "facility" | "office";
export type IntelligenceModule =
  | "dashboard"
  | "device"
  | "room"
  | "scenes"
  | "automations"
  | "visitors"
  | "maintenance"
  | "wallet"
  | "services"
  | "community"
  | "notifications"
  | "security"
  | "infrastructure"
  | "meters"
  | "cameras"
  | "digital_twin"
  | "executive"
  | "support"
  | "other";

export type IntelligenceContextEnvelope = {
  surface: IntelligenceSurface;
  module: IntelligenceModule;
  route: string | null;
  estate_id: string | null;
  building_id: string | null;
  home_id: string | null;
  unit_id: string | null;
  room_id: string | null;
  object_type: string | null;
  object_id: string | null;
  object_name: string | null;
  canonical_target: Record<string, unknown> | null;
  selected_tab: string | null;
  selected_filter: string | null;
  user_role: string | null;
  permissions: string[];
  ownership: Record<string, unknown> | null;
  privacy_class: string | null;
  client_timestamp: string | null;
  timezone: string | null;
  visible_data_version: string | null;
  conversation_thread_id: string | null;
  prior_target_history: Array<Record<string, unknown>>;
  explicit_user_references: string[];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function moduleFrom(value: unknown): IntelligenceModule {
  const raw = text(value).toLowerCase();
  const allowed = new Set<IntelligenceModule>(["dashboard", "device", "room", "scenes", "automations", "visitors", "maintenance", "wallet", "services", "community", "notifications", "security", "infrastructure", "meters", "cameras", "digital_twin", "executive", "support", "other"]);
  return allowed.has(raw as IntelligenceModule) ? raw as IntelligenceModule : "other";
}

function surfaceFrom(value: unknown): IntelligenceSurface {
  const raw = text(value).toLowerCase();
  return raw === "facility" || raw === "office" ? raw : "consumer";
}

export function normalizeIntelligenceContextEnvelope(input: Record<string, unknown> = {}, actor: Record<string, unknown> = {}): IntelligenceContextEnvelope {
  const target = record(input.target) || record(input.canonical_target);
  return {
    surface: surfaceFrom(input.surface || actor.surface),
    module: moduleFrom(input.module || input.page || input.route),
    route: text(input.route || input.pathname || input.page) || null,
    estate_id: text(input.estate_id || input.estateId || actor.estate_id) || null,
    building_id: text(input.building_id || input.buildingId || actor.building_id) || null,
    home_id: text(input.home_id || input.homeId || actor.home_id) || null,
    unit_id: text(input.unit_id || input.unitId || actor.unit_id) || null,
    room_id: text(input.room_id || input.roomId) || null,
    object_type: text(input.object_type || input.objectType || target?.type || target?.object_type) || null,
    object_id: text(input.object_id || input.objectId || target?.id || target?.canonical_id) || null,
    object_name: text(input.object_name || input.objectName || target?.name || target?.label) || null,
    canonical_target: target,
    selected_tab: text(input.selected_tab || input.tab) || null,
    selected_filter: text(input.selected_filter || input.filter) || null,
    user_role: text(input.user_role || actor.role) || null,
    permissions: arrayOfStrings(input.permissions || actor.permissions),
    ownership: record(input.ownership),
    privacy_class: text(input.privacy_class || input.privacyClass) || null,
    client_timestamp: text(input.client_timestamp || input.clientTimestamp) || null,
    timezone: text(input.timezone || input.tz) || null,
    visible_data_version: text(input.visible_data_version || input.visibleDataVersion) || null,
    conversation_thread_id: text(input.conversation_thread_id || input.thread_id || input.threadId) || null,
    prior_target_history: Array.isArray(input.prior_target_history) ? input.prior_target_history.filter(record) as Array<Record<string, unknown>> : [],
    explicit_user_references: arrayOfStrings(input.explicit_user_references || input.references),
  };
}
