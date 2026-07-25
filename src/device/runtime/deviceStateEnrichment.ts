type AnyRecord = Record<string, any>;

export type NormalizedDeviceState = {
  online: boolean | null;
  power: boolean | null;
  switches: Record<string, boolean>;
  brightness: number | null;
  color: string | null;
  color_temperature: number | null;
  temperature: number | null;
  humidity: number | null;
  battery: number | null;
  lock_state: string | null;
  curtain_position: number | null;
  countdown: number | null;
  timer_active: boolean | null;
  schedule_enabled: boolean | null;
  faults: string[];
};

export type EnrichedDeviceState = AnyRecord & {
  normalized_state: NormalizedDeviceState;
  primary_state: string;
  health_status: string;
  telemetry_summary: AnyRecord;
  supported_controls: string[];
  capability_codes: string[];
  channel_definitions: Array<{
    index: number;
    code: string;
    name: string;
    state: boolean | null;
    controllable: boolean;
    last_update: string | null;
  }>;
  control_profile: string;
  device_type: string;
  device_family: string;
  provider_health: string;
  activity_summary: string;
};

export type CanonicalDeviceAvailability =
  | "online"
  | "offline"
  | "stale"
  | "unknown"
  | "provider_disconnected"
  | "setup_incomplete";

export type CanonicalDeviceState = {
  availability: CanonicalDeviceAvailability;
  availabilityReason?: CanonicalDeviceAvailabilityReason;
  lastSeenAt: string | null;
  lastProviderSyncAt: string | null;
  staleAfterMs: number | null;
  primaryState: {
    key: string;
    value: string | number | boolean | null;
    label: string;
    confidence?: "live" | "last_confirmed" | "inferred" | "unknown";
  };
  secondaryState?: {
    key: string;
    value: string | number | boolean | null;
    label: string;
  };
  batteryPercentage?: number | null;
  batteryLevel?: "normal" | "low" | "critical" | "unknown";
  alerts: Array<{
    type: string;
    severity: "info" | "warning" | "critical";
    message: string;
  }>;
  supportedActions: string[];
  executableActions: string[];
  providerEvidence: Record<string, unknown>;
};

export type CanonicalDeviceAvailabilityReason =
  | "provider_reports_online"
  | "provider_reports_offline"
  | "last_success_too_old"
  | "provider_connection_missing"
  | "provider_permission_denied"
  | "gateway_offline"
  | "local_only_unreachable"
  | "setup_incomplete"
  | "unknown";

export type CanonicalDevicePresentation = {
  availability: CanonicalDeviceAvailability;
  availabilityReason: CanonicalDeviceAvailabilityReason;
  assignment: {
    estateId: string | null;
    buildingId: string | null;
    homeId: string | null;
    roomId: string | null;
    roomName: string | null;
  };
  lastSeenAt: string | null;
  lastCheckedAt: string | null;
  lastConfirmedStateAt: string | null;
  staleAfterMs: number | null;
  primaryState: CanonicalDeviceState["primaryState"] & {
    confidence: "live" | "last_confirmed" | "inferred" | "unknown";
  };
  secondaryState?: CanonicalDeviceState["secondaryState"];
  batteryPercentage: number | null;
  batteryLevel: NonNullable<CanonicalDeviceState["batteryLevel"]>;
  supportedActions: string[];
  executableActions: string[];
  alerts: CanonicalDeviceState["alerts"];
  summary: string;
};

export type DeviceStateEventSummary = {
  changed: boolean;
  changed_keys: string[];
  meaningful_keys: string[];
  event_type:
    | "device.power.on"
    | "device.power.off"
    | "device.state.changed"
    | "device.telemetry.received"
    | "device.online"
    | "device.offline"
    | "device.health.degraded"
    | "device.command.executed"
    | "device.command.failed"
    | "device.provider.sync";
  title: string;
  message: string;
};

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function text(...values: any[]) {
  for (const value of values) {
    const next = String(value ?? "").trim();
    if (next) return next;
  }
  return "";
}

function boolValue(value: any): boolean | null {
  if (value === true || value === false) return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "on", "yes", "active", "open", "online"].includes(raw)) return true;
  if (["0", "false", "off", "no", "inactive", "closed", "offline"].includes(raw)) return false;
  return null;
}

function numberValue(value: any): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isoTimestamp(...values: any[]) {
  for (const value of values) {
    const raw = text(value);
    if (!raw) continue;
    const date = new Date(raw);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return null;
}

function flatten(value: AnyRecord, prefix = "", out: AnyRecord = {}) {
  for (const [key, nested] of Object.entries(value || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (nested && typeof nested === "object" && !Array.isArray(nested) && key !== "_oyi_timeline" && key !== "__raw") {
      flatten(asRecord(nested), path, out);
    } else {
      out[path] = nested;
    }
  }
  return out;
}

function uniqueLower(values: Array<any>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)));
}

const INTERNAL_CAPABILITY_CODES = new Set([
  "online",
  "is_online",
  "connected",
  "__raw",
  "normalized_state",
  "provider_health",
  "health_status",
  "primary_state",
  "telemetry_summary",
  "activity_summary",
  "supported_controls",
  "control_profile",
  "device_family",
  "device_type",
  "capability_codes",
  "channel_definitions",
  "switch",
  "kg",
  "wnykq",
  "infrared_tv",
  "infrared_ac",
  "poweron",
  "poweroff",
  "f",
  "m",
  "t",
  "device",
  "generic",
  "unknown",
]);

export function sanitizePublicCapabilityCodes(values: Array<unknown>) {
  return uniqueLower(values)
    .filter((code) => !INTERNAL_CAPABILITY_CODES.has(code))
    .filter((code) => !code.startsWith("_oyi_") && !code.startsWith("__"))
    .filter((code) => !/^(provider|runtime|health|normalized|primary|activity|telemetry)[_.-]/.test(code))
    .filter((code) => /^[a-z0-9_+./:-]+$/.test(code));
}

function tuyaCategoryFamily(value: unknown) {
  const raw = String(value || "").toLowerCase().trim();
  const map: Record<string, string> = {
    kg: "switch",
    cz: "plug",
    wk: "camera",
    kt: "climate",
    wnykq: "ir_remote",
    cl: "curtain",
    ms: "lock",
    dj: "light",
    switch: "switch",
    socket: "plug",
    plug: "plug",
    smart_plug: "plug",
    outlet: "plug",
    camera: "camera",
    ipc: "camera",
    ipcamera: "camera",
    air_conditioner: "climate",
    ac: "climate",
    climate: "climate",
    thermostat: "climate",
    infrared_remote: "ir_remote",
    ir_remote: "ir_remote",
    remote_control: "ir_remote",
    universal_remote: "ir_remote",
    tv_remote: "television",
    infrared_tv: "television",
    television: "television",
    tv: "television",
    set_top_box: "set_top_box",
    decoder: "set_top_box",
    stb: "set_top_box",
    infrared_ac: "climate",
    air_conditioner_remote: "climate",
    fan_remote: "fan",
    projector_remote: "projector",
    curtain: "curtain",
    blind: "curtain",
    shade: "curtain",
    doorlock: "lock",
    lock: "lock",
    sensor: "sensor",
    pir: "sensor",
    motion: "sensor",
    smoke_sensor: "sensor",
    gas_sensor: "sensor",
    light: "light",
    lighting: "light",
    ceiling_light: "light",
    lamp: "light",
    fan: "fan",
    projector: "projector",
    speaker: "speaker",
    media: "speaker",
    power_meter: "power_meter",
    energy_meter: "energy_meter",
    water_meter: "water_meter",
    internet_service: "internet_service",
    gas_service: "gas_service",
  };
  return map[raw] || raw;
}

function knownFamily(value: unknown) {
  const mapped = tuyaCategoryFamily(value);
  return ["switch", "plug", "camera", "climate", "ir_remote", "television", "curtain", "lock", "sensor", "light", "fan", "projector", "set_top_box", "speaker", "power_meter", "energy_meter", "water_meter", "internet_service", "gas_service"].includes(mapped)
    ? mapped
    : "";
}

function knownControlProfile(value: unknown) {
  const raw = String(value || "").toLowerCase().trim();
  const mapped: Record<string, string> = {
    tv: "television",
    television: "television",
    infrared_tv: "television",
    ac: "air_conditioner",
    climate: "air_conditioner",
    air_conditioner: "air_conditioner",
    infrared_ac: "air_conditioner",
    ir_remote: "ir_remote",
    remote: "ir_remote",
    switch: "switch",
    plug: "plug",
    socket: "plug",
    camera: "camera",
    curtain: "curtain",
    lock: "lock",
    jtmspro: "lock",
    jtmsbh: "lock",
    jtms: "lock",
    doorlock: "lock",
    door_lock: "lock",
    smart_lock: "lock",
    sensor: "sensor",
    light: "light",
    fan: "fan",
    projector: "projector",
    set_top_box: "set_top_box",
    decoder: "set_top_box",
    speaker: "speaker",
    power_meter: "power_meter",
    energy_meter: "energy_meter",
    water_meter: "water_meter",
    internet_service: "internet_service",
    gas_service: "gas_service",
    generic: "generic",
  };
  return mapped[raw] || "";
}

function capabilityCodes(input: { state?: AnyRecord | null; functions?: Array<{ code?: string | null }> | null; metadata?: AnyRecord | null; device?: AnyRecord | null }) {
  const statusCodes = Object.keys(asRecord(input.state));
  const functionCodes = Array.isArray(input.functions) ? input.functions.map((item) => String(item?.code || "")) : [];
  const metadata = asRecord(input.metadata);
  const extra = [
    ...(Array.isArray(metadata.capabilities) ? metadata.capabilities : []),
    ...(Array.isArray(metadata.supported_controls) ? metadata.supported_controls : []),
  ];
  return uniqueLower([...statusCodes, ...functionCodes, ...extra]);
}

function inferDeviceFamily(device: AnyRecord, metadata: AnyRecord, codes: string[]) {
  const metadataFamily = knownFamily(metadata?.device_family);
  if (metadataFamily) return metadataFamily;

  const virtualFamily = knownFamily(metadata?.virtual_device ? metadata?.ir_appliance?.appliance_type : "");
  if (virtualFamily) return virtualFamily;

  const deviceFamily = knownFamily(device?.device_family);
  if (deviceFamily) return deviceFamily;

  const rawCategoryFamily = knownFamily(metadata?.raw?.category);
  if (rawCategoryFamily) return rawCategoryFamily;

  const metadataCategoryFamily = knownFamily(metadata?.category);
  if (metadataCategoryFamily) return metadataCategoryFamily;

  const deviceCategoryFamily = knownFamily(device?.category);
  if (deviceCategoryFamily) return deviceCategoryFamily;

  const productFamily = knownFamily(metadata?.product_name || metadata?.productName);
  if (productFamily) return productFamily;

  const modelFamily = knownFamily(metadata?.model);
  if (modelFamily) return modelFamily;

  const explicitProfile = knownFamily(metadata?.control_profile || device?.control_profile);
  if (explicitProfile) return explicitProfile;

  const haystack = [
    metadata?.product_name,
    metadata?.productName,
    metadata?.remote_type,
    metadata?.ir_profile,
    metadata?.model,
    device?.type,
  ]
    .map((item) => String(item || "").toLowerCase())
    .join(" ");

  const hasSwitch = codes.some((code) => /^switch(_\d+)?$/i.test(code));
  const hasPower =
    hasSwitch ||
    codes.includes("switch") ||
    codes.includes("power") ||
    codes.includes("on");

  const hasClimate = codes.some((code) =>
    /temp|temperature|fan|windspeed|mode|swing/i.test(code),
  );

  const hasRemote = codes.some((code) =>
    /ir_|remote|key_code|command_key|control/i.test(code),
  );

  if (/camera|ipc|rtsp|onvif|dvr|nvr/.test(haystack)) return "camera";

  if (/lock|doorlock/.test(haystack)) return "lock";

  if (/curtain|blind|shade/.test(haystack)) return "curtain";

  if (
    /sensor|humidity|temperature|pir|smoke|gas_sensor/.test(haystack) &&
    !hasPower
  ) {
    return "sensor";
  }

  if (
    hasRemote ||
    /ir|infrared|remote|tv_remote|set_top|stb/.test(haystack)
  ) {
    return "ir_remote";
  }

  if (hasClimate || (/ac|air_conditioner|climate|thermostat|hvac|kt/.test(haystack) && !hasPower)) {
    return "climate";
  }

  if (/plug|socket|outlet/.test(haystack)) return "plug";

  if (
    hasSwitch ||
    /\b(light|light switch|wall switch|switch|relay)\b/.test(haystack)
  ) {
    return "switch";
  }

  return (
    text(
      metadata?.device_family,
      metadata?.category,
      device?.category,
      metadata?.product_name,
      device?.type,
    ) || "generic"
  ).toLowerCase();
}

function inferControlProfile(deviceFamily: string, codes: string[], metadata?: AnyRecord, device?: AnyRecord) {
  const explicit = knownControlProfile(
    metadata?.control_profile ||
    metadata?.profile ||
    metadata?.ir_appliance?.control_profile ||
    device?.control_profile,
  );
  if (explicit) return explicit;
  if (deviceFamily === "camera") return "camera";
  if (deviceFamily === "climate") return "air_conditioner";
  if (deviceFamily === "television") return "television";
  if (deviceFamily === "ir_remote") return "ir_remote";
  if (deviceFamily === "curtain") return "curtain";
  if (deviceFamily === "lock") return "lock";
  if (deviceFamily === "sensor") return "sensor";
  if (deviceFamily === "plug") return "plug";
  if (deviceFamily === "switch") return "switch";
  if (deviceFamily === "light") return "switch";
  if (deviceFamily === "fan") return "fan";
  if (deviceFamily === "projector") return "projector";
  if (deviceFamily === "set_top_box") return "set_top_box";
  if (deviceFamily === "speaker") return "speaker";
  if (["power_meter", "energy_meter", "water_meter", "internet_service", "gas_service"].includes(deviceFamily)) return deviceFamily;
  if (codes.some((code) => /^switch(_\d+)?$/.test(code) || ["switch", "power", "on"].includes(code))) return deviceFamily === "plug" ? "plug" : "switch";
  return "generic";
}

function inferSupportedControls(deviceFamily: string, codes: string[]) {
  const controls = new Set<string>();
  if (["switch", "plug", "light"].includes(deviceFamily) && codes.some((code) => /^switch(_\d+)?$/.test(code) || ["switch", "power", "on"].includes(code))) controls.add("power");
  if (codes.some((code) => code.includes("bright"))) controls.add("brightness");
  if (codes.some((code) => code.includes("colour") || code.includes("color"))) controls.add("color");
  if (codes.some((code) => code.includes("temp"))) controls.add(deviceFamily === "climate" ? "temperature" : "sensor_temperature");
  if (codes.some((code) => code.includes("humid"))) controls.add("humidity");
  if (codes.some((code) => code.includes("countdown") || code.includes("timer"))) controls.add("timer");
  if (codes.some((code) => code.includes("schedule"))) controls.add("schedule");
  if (codes.some((code) => code.includes("percent") || code.includes("position"))) controls.add("position");
  if (deviceFamily === "camera") {
    controls.add("stream");
    controls.add("snapshot");
  }
  if (deviceFamily === "lock") {
    controls.add("lock_state");
    // Sensitive access controls are exposed only by the Smart Access evidence
    // model after a real executable provider mapping is known.
    if (codes.some((code) => /battery|electricity/.test(code))) controls.add("battery_level");
    if (codes.some((code) => /tamper|hijack|alarm|wrong|trial|attempt|jam/.test(code))) controls.add("security_event");
    if (codes.some((code) => /record|history|log/.test(code))) controls.add("operation_history");
  }
  if (deviceFamily === "curtain") controls.add("position");
  if (deviceFamily === "ir_remote") {
    controls.add("remote");
    if (codes.includes("power") || codes.includes("switch") || codes.includes("on")) controls.add("power");
  }
  if (["television", "projector", "set_top_box", "speaker"].includes(deviceFamily)) {
    controls.add("remote");
    if (codes.some((code) => /power|on|off/.test(code))) controls.add("power");
    if (codes.some((code) => /volume|vol[_+.-]/.test(code))) controls.add("volume");
    if (codes.some((code) => /channel|ch[_+.-]/.test(code))) controls.add("channel");
    if (codes.some((code) => /mute/.test(code))) controls.add("mute");
    if (codes.some((code) => /source|input/.test(code))) controls.add("source");
  }
  if (deviceFamily === "climate") {
    if (codes.some((code) => /power|on|off/.test(code))) controls.add("power");
    if (codes.some((code) => /temp|temperature/.test(code))) controls.add("temperature");
    if (codes.some((code) => /mode/.test(code))) controls.add("mode");
    if (codes.some((code) => /fan|wind/.test(code))) controls.add("fan_speed");
    if (codes.some((code) => /swing/.test(code))) controls.add("swing");
  }
  if (deviceFamily === "fan") {
    controls.add("remote");
    if (codes.some((code) => /power|on|off/.test(code))) controls.add("power");
    if (codes.some((code) => /speed|fan|wind/.test(code))) controls.add("fan_speed");
    if (codes.some((code) => /swing|oscillat/.test(code))) controls.add("swing");
  }
  return Array.from(controls);
}

function deriveChannelDefinitions(args: {
  codes: string[];
  normalized: NormalizedDeviceState;
  rawState: AnyRecord;
  metadata: AnyRecord;
  deviceFamily?: string;
}) {
  if (!["switch", "plug", "light"].includes(String(args.deviceFamily || "").toLowerCase())) return [];
  const explicitNames = asRecord(args.metadata.channel_names);
  const channelCodes = args.codes
    .filter((code) => /^switch(_\d+)?$/i.test(code) || code === "switch")
    .sort((left, right) => {
      const leftIndex = Number(String(left).match(/(\d+)/)?.[1] || "0");
      const rightIndex = Number(String(right).match(/(\d+)/)?.[1] || "0");
      return leftIndex - rightIndex;
    });
  const uniqueCodes = Array.from(new Set(channelCodes));
  const numberedChannels = uniqueCodes.filter((code) => /^switch_\d+$/i.test(code));
  const resolvedCodes = numberedChannels.length ? numberedChannels : uniqueCodes;
  return resolvedCodes.map((code, index) => {
    const channelIndex = Number(String(code).match(/(\d+)/)?.[1] || index + 1);
    return {
      index: channelIndex,
      code,
      name: text(explicitNames[code], explicitNames[String(channelIndex)], code === "switch" ? "Main switch" : `Channel ${channelIndex}`),
      state: boolValue(args.normalized.switches[code] ?? args.rawState[code]),
      controllable: true,
      last_update: text(args.rawState?._oyi_timeline?.received_at) || null,
    };
  });
}

function normalizeStateFields(state: AnyRecord) {
  const switches = Object.entries(state).reduce<Record<string, boolean>>((acc, [key, value]) => {
    if (key === "switch" || key === "power" || key === "on" || /^switch_\d+$/i.test(key)) {
      const resolved = boolValue(value);
      if (resolved !== null) acc[key] = resolved;
    }
    return acc;
  }, {});

  const power =
    boolValue(state.switch) ??
    boolValue(state.power) ??
    boolValue(state.on) ??
    Object.values(switches)[0] ??
    null;

  const online =
    boolValue(state.online) ??
    boolValue(state.is_online) ??
    boolValue(state.connected) ??
    null;

  const brightness = numberValue(state.bright_value_v2 ?? state.bright_value ?? state.brightness);
  const color = text(state.colour_data_v2, state.colour_data, state.color_data, state.color) || null;
  const color_temperature = numberValue(state.temp_value_v2 ?? state.temp_value ?? state.colour_temp ?? state.color_temp);
  const temperature = numberValue(state.va_temperature ?? state.temp_current ?? state.temperature);
  const humidity = numberValue(state.va_humidity ?? state.humidity_value ?? state.humidity);
  const battery = numberValue(
    state.battery_percentage ??
    state.residual_electricity ??
    state.battery_value ??
    state.battery ??
    state.electricity,
  );
  const lock_state = text(state.closed_opened, state.lock_state, state.status_lock) || null;
  const curtain_position = numberValue(state.percent_state ?? state.percent_control ?? state.position);
  const countdown = numberValue(state.countdown_1 ?? state.countdown ?? state.timer_countdown);
  const timer_active = countdown != null ? countdown > 0 : null;
  const schedule_enabled = state.schedule ? true : null;
  const faults = [
    state.fault,
    state.fault_code,
    ...(Array.isArray(state.faults) ? state.faults : []),
  ]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return {
    online,
    power,
    switches,
    brightness,
    color,
    color_temperature,
    temperature,
    humidity,
    battery,
    lock_state,
    curtain_position,
    countdown,
    timer_active,
    schedule_enabled,
    faults,
  } satisfies NormalizedDeviceState;
}

function inferPrimaryState(normalized: NormalizedDeviceState, deviceFamily: string) {
  if (normalized.online === false) return "offline";
  if (normalized.faults.length) return "fault";
  if (deviceFamily === "lock" && normalized.lock_state) return normalized.lock_state.toLowerCase();
  if (deviceFamily === "curtain" && normalized.curtain_position != null) return `position_${normalized.curtain_position}`;
  if (normalized.power === true) return "on";
  if (normalized.power === false) return "off";
  if (normalized.temperature != null || normalized.humidity != null) return "reporting";
  if (normalized.online === true) return "online";
  return "idle";
}

function inferHealthStatus(normalized: NormalizedDeviceState) {
  if (normalized.online === false) return "offline";
  if (normalized.faults.length) return "degraded";
  if (normalized.battery != null && normalized.battery <= 15) return "battery_low";
  return "stable";
}

function activitySummary(args: { name?: string | null; primaryState: string; healthStatus: string; deviceFamily: string }) {
  const name = text(args.name, "Device");
  if (args.healthStatus === "offline") return `${name} is offline.`;
  if (args.healthStatus === "degraded") return `${name} reported a device fault.`;
  if (args.healthStatus === "battery_low") return `${name} battery is low.`;
  if (args.primaryState === "on") return `${name} is active.`;
  if (args.primaryState === "off") return `${name} is idle.`;
  if (args.primaryState === "locked") return `${name} is locked.`;
  if (args.primaryState === "unlocked") return `${name} is unlocked.`;
  if (args.deviceFamily === "ir_remote") return `${name} remote is ready.`;
  if (args.primaryState === "reporting") return `${name} is reporting normally.`;
  return `${name} is ready.`;
}

export function enrichDeviceProviderState(input: {
  state: AnyRecord | null | undefined;
  functions?: Array<{ code?: string | null }> | null;
  metadata?: AnyRecord | null;
  device?: AnyRecord | null;
  provider?: string | null;
  adapter?: string | null;
}) {
  const rawState = asRecord(input.state);
  const metadata = asRecord(input.metadata);
  const device = asRecord(input.device);
  const codes = capabilityCodes({ state: rawState, functions: input.functions, metadata, device });
  const normalized = normalizeStateFields(rawState);
  const deviceFamily = inferDeviceFamily(device, metadata, codes);
  const controlProfile = inferControlProfile(deviceFamily, codes, metadata, device);
  const supportedControls = inferSupportedControls(deviceFamily, codes);
  const publicCapabilityCodes = sanitizePublicCapabilityCodes(codes);
  const channelDefinitions = deriveChannelDefinitions({ codes, normalized, rawState, metadata, deviceFamily });
  const primaryState = inferPrimaryState(normalized, deviceFamily);
  const healthStatus = inferHealthStatus(normalized);
  const telemetrySummary = {
    online: normalized.online,
    power_state: normalized.power,
    brightness: normalized.brightness,
    temperature: normalized.temperature,
    humidity: normalized.humidity,
    battery: normalized.battery,
    faults: normalized.faults,
    switch_count: Object.keys(normalized.switches).length,
    provider_reported_at: text(rawState?._oyi_timeline?.provider_reported_at, rawState.provider_reported_at) || null,
  };

  return {
    ...rawState,
    online: normalized.online ?? rawState.online ?? null,
    normalized_state: normalized,
    primary_state: primaryState,
    health_status: healthStatus,
    telemetry_summary: telemetrySummary,
    supported_controls: supportedControls,
    capability_codes: publicCapabilityCodes,
    channel_definitions: channelDefinitions,
    control_profile: controlProfile,
    device_type: text(metadata.device_type, metadata.raw?.category, device.type, device.category, metadata.product_name, deviceFamily) || "device",
    device_family: deviceFamily,
    provider_health: normalized.online === false ? "offline" : "healthy",
    activity_summary: activitySummary({
      name: text(device.name, metadata.name),
      primaryState,
      healthStatus,
      deviceFamily,
    }),
  } satisfies EnrichedDeviceState;
}

export function diffEnrichedDeviceState(previousState: AnyRecord | null | undefined, nextState: AnyRecord | null | undefined): DeviceStateEventSummary {
  const prev = asRecord(previousState);
  const next = asRecord(nextState);
  const prevFlat = flatten(prev.normalized_state ? prev : enrichDeviceProviderState({ state: prev }));
  const nextFlat = flatten(next.normalized_state ? next : enrichDeviceProviderState({ state: next }));
  const changedKeys = Array.from(new Set([...Object.keys(prevFlat), ...Object.keys(nextFlat)])).filter((key) => JSON.stringify(prevFlat[key]) !== JSON.stringify(nextFlat[key]));
  const meaningful = changedKeys.filter((key) => !key.startsWith("_oyi_") && !key.startsWith("__raw"));
  const prevNormalized = asRecord(prev.normalized_state);
  const nextNormalized = asRecord(next.normalized_state);
  const prevOnline = boolValue(prevNormalized.online ?? prev.online);
  const nextOnline = boolValue(nextNormalized.online ?? next.online);
  const prevPower = boolValue(prevNormalized.power ?? prev.switch ?? prev.power ?? prev.on);
  const nextPower = boolValue(nextNormalized.power ?? next.switch ?? next.power ?? next.on);
  const prevHealth = text(prev.health_status, prevNormalized.health_status).toLowerCase();
  const nextHealth = text(next.health_status, nextNormalized.health_status).toLowerCase();

  if (prevOnline !== null && nextOnline !== null && prevOnline !== nextOnline) {
    return {
      changed: true,
      changed_keys: changedKeys,
      meaningful_keys: meaningful,
      event_type: nextOnline ? "device.online" : "device.offline",
      title: nextOnline ? "Device back online" : "Device offline",
      message: nextOnline ? "A connected device is reporting again." : "A connected device has gone offline.",
    };
  }

  if (nextHealth && nextHealth !== prevHealth && ["degraded", "battery_low"].includes(nextHealth)) {
    return {
      changed: true,
      changed_keys: changedKeys,
      meaningful_keys: meaningful,
      event_type: "device.health.degraded",
      title: "Device health warning",
      message: "A connected device reported a health issue.",
    };
  }

  if (prevPower !== null && nextPower !== null && prevPower !== nextPower) {
    return {
      changed: true,
      changed_keys: changedKeys,
      meaningful_keys: meaningful,
      event_type: nextPower ? "device.power.on" : "device.power.off",
      title: nextPower ? "Device turned on" : "Device turned off",
      message: nextPower ? "A connected device is now active." : "A connected device is no longer active.",
    };
  }

  if (meaningful.length) {
    return {
      changed: true,
      changed_keys: changedKeys,
      meaningful_keys: meaningful,
      event_type: "device.state.changed",
      title: "Device state changed",
      message: "A connected device changed state.",
    };
  }

  return {
    changed: false,
    changed_keys: changedKeys,
    meaningful_keys: meaningful,
    event_type: "device.telemetry.received",
    title: "Device updated",
    message: "A connected device reported a new update.",
  };
}

function stateLabel(key: string, value: string | number | boolean | null) {
  if (value === null || value === undefined || value === "") return "State unknown";
  if (key === "temperature" && typeof value === "number") return `${Math.round(value)}°C`;
  if (key === "battery" && typeof value === "number") return `${Math.round(value)}% battery`;
  const raw = String(value).replace(/[_-]+/g, " ").trim().toLowerCase();
  if (raw === "on") return "On";
  if (raw === "off") return "Off";
  if (raw === "online") return "Online";
  if (raw === "offline") return "Offline";
  if (raw === "locked") return "Locked";
  if (raw === "unlocked") return "Unlocked";
  if (raw === "open") return "Open";
  if (raw === "closed") return "Closed";
  if (raw === "reporting") return "Reporting";
  if (raw === "fault") return "Attention";
  if (raw === "idle") return "Ready";
  return raw
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function batteryLevel(value: number | null): CanonicalDeviceState["batteryLevel"] {
  if (value == null || !Number.isFinite(value)) return "unknown";
  if (value <= 20) return "critical";
  if (value <= 35) return "low";
  return "normal";
}

function canonicalPrimaryState(enriched: EnrichedDeviceState): CanonicalDeviceState["primaryState"] {
  const normalized = enriched.normalized_state || normalizeStateFields(enriched);
  if (enriched.device_family === "lock" && normalized.lock_state) {
    const value = String(normalized.lock_state).toLowerCase().includes("unlock") ? "unlocked" : "locked";
    return { key: "lock_state", value, label: stateLabel("lock_state", value) };
  }
  if (normalized.power !== null) return { key: "power", value: normalized.power, label: normalized.power ? "On" : "Off" };
  if (normalized.temperature !== null) return { key: "temperature", value: normalized.temperature, label: stateLabel("temperature", normalized.temperature) };
  if (enriched.device_family === "ir_remote") return { key: "remote", value: "ready", label: "Remote ready" };
  if (["television", "projector", "set_top_box", "speaker"].includes(enriched.device_family) && normalized.power === null) {
    return { key: "remote_state", value: "unknown", label: "State unknown" };
  }
  if (enriched.device_family === "climate" && normalized.power === null) {
    return { key: "climate_state", value: "unknown", label: "State unknown" };
  }
  const primary = text(enriched.primary_state).toLowerCase() || "unknown";
  return { key: "primary_state", value: primary === "unknown" ? null : primary, label: stateLabel("primary_state", primary) };
}

function canonicalSecondaryState(enriched: EnrichedDeviceState): CanonicalDeviceState["secondaryState"] | undefined {
  const normalized = enriched.normalized_state || normalizeStateFields(enriched);
  if (normalized.battery !== null) return { key: "battery", value: normalized.battery, label: stateLabel("battery", normalized.battery) };
  if (normalized.humidity !== null) return { key: "humidity", value: normalized.humidity, label: `${Math.round(normalized.humidity)}% humidity` };
  const channels = Array.isArray(enriched.channel_definitions) ? enriched.channel_definitions : [];
  if (channels.length > 1) {
    const active = channels.filter((channel) => channel.state === true).length;
    return { key: "channels", value: active, label: `${active} of ${channels.length} channels on` };
  }
  return undefined;
}

function canonicalAvailabilityWithReason(enriched: EnrichedDeviceState, device: AnyRecord, stateRow?: AnyRecord | null): { availability: CanonicalDeviceAvailability; reason: CanonicalDeviceAvailabilityReason } {
  const providerHealth = text(enriched.provider_health, stateRow?.provider_health).toLowerCase();
  const authorizationState = text(enriched?._oyi_runtime?.authorization_state, stateRow?.authorization_state).toLowerCase();
  const normalized = enriched.normalized_state || normalizeStateFields(enriched);
  const freshness = text(stateRow?.freshness, enriched?._oyi_runtime?.freshness).toLowerCase();
  if (!text(device?.external_id, device?.provider_device_id, device?.metadata?.provider_device_id) && !device?.is_virtual) return { availability: "setup_incomplete", reason: "setup_incomplete" };
  if (/permission|authorization|required/.test(providerHealth) || /required|denied|expired|failed/.test(authorizationState)) return { availability: "provider_disconnected", reason: "provider_permission_denied" };
  if (/expired|disconnected|not_linked|authentication/.test(providerHealth)) return { availability: "provider_disconnected", reason: "provider_connection_missing" };
  if (normalized.online === false || providerHealth === "offline" || enriched.health_status === "offline") return { availability: "offline", reason: "provider_reports_offline" };
  if (freshness === "stale" || freshness === "expired" || stateRow?.stale === true) return { availability: "stale", reason: "last_success_too_old" };
  if (normalized.online === true || providerHealth === "healthy" || providerHealth === "ok") return { availability: "online", reason: "provider_reports_online" };
  return { availability: "unknown", reason: "unknown" };
}

function canonicalExecutableActions(enriched: EnrichedDeviceState, device: AnyRecord) {
  const supported = new Set((Array.isArray(enriched.supported_controls) ? enriched.supported_controls : []).map((value) => String(value || "").toLowerCase()));
  const metadata = asRecord(device?.metadata);
  const smartAccess = asRecord(metadata.smart_access || metadata.smartAccess || enriched.smart_access || enriched.smartAccess);
  const evidence = asRecord(smartAccess.capability_evidence || smartAccess.capabilityEvidence || smartAccess.evidence);
  const actions = new Set<string>();
  for (const control of supported) {
    if (["battery_level", "lock_state", "security_event", "operation_history", "stream", "snapshot"].includes(control)) continue;
    actions.add(control);
  }
  const unlockEvidence = asRecord(evidence.remote_unlock || evidence.unlock);
  const lockEvidence = asRecord(evidence.remote_lock || evidence.lock);
  if (unlockEvidence.executableByOyi === true || unlockEvidence.executable_by_oyi === true) actions.add("unlock");
  if (lockEvidence.executableByOyi === true || lockEvidence.executable_by_oyi === true) actions.add("lock");
  if (enriched.device_family === "lock" && !actions.has("unlock")) actions.delete("unlock");
  return Array.from(actions);
}

export function buildCanonicalDeviceState(device: AnyRecord, enrichedInput: EnrichedDeviceState | AnyRecord, stateRow?: AnyRecord | null): CanonicalDeviceState {
  const enriched = (enrichedInput?.normalized_state ? enrichedInput : enrichDeviceProviderState({
    state: enrichedInput,
    metadata: device?.metadata,
    device,
    provider: device?.provider || device?.vendor,
    adapter: device?.adapter || device?.vendor,
  })) as EnrichedDeviceState;
  const normalized = enriched.normalized_state || normalizeStateFields(enriched);
  const battery = normalized.battery;
  const batteryState = batteryLevel(battery);
  const availabilityInfo = canonicalAvailabilityWithReason(enriched, device, stateRow);
  const availability = availabilityInfo.availability;
  const alerts: CanonicalDeviceState["alerts"] = [];
  if (availability === "offline") alerts.push({ type: "offline", severity: "warning", message: "Device is offline." });
  if (availability === "provider_disconnected") alerts.push({ type: "provider_disconnected", severity: "warning", message: "Provider connection needs attention." });
  if (batteryState === "critical") alerts.push({ type: "battery_critical", severity: "critical", message: "Battery is critically low." });
  else if (batteryState === "low") alerts.push({ type: "battery_low", severity: "warning", message: "Battery is low." });
  for (const fault of normalized.faults || []) alerts.push({ type: "fault", severity: "warning", message: String(fault) });
  return {
    availability,
    availabilityReason: availabilityInfo.reason,
    lastSeenAt: isoTimestamp(stateRow?.last_seen, enriched?._oyi_runtime?.last_refresh, enriched?._oyi_timeline?.received_at, device?.last_seen_at, device?.updated_at),
    lastProviderSyncAt: isoTimestamp(stateRow?.provider_timestamp, enriched?._oyi_runtime?.provider_timestamp, enriched?._oyi_timeline?.provider_reported_at),
    staleAfterMs: Number(enriched?._oyi_runtime?.ttl || stateRow?.ttl || 0) || null,
    primaryState: {
      ...canonicalPrimaryState(enriched),
      confidence: availability === "online" ? "live" : availability === "stale" || availability === "offline" ? "last_confirmed" : "unknown",
    },
    secondaryState: canonicalSecondaryState(enriched),
    batteryPercentage: battery,
    batteryLevel: batteryState,
    alerts,
    supportedActions: Array.isArray(enriched.supported_controls) ? enriched.supported_controls : [],
    executableActions: canonicalExecutableActions(enriched, device),
    providerEvidence: {
      provider: device?.provider || device?.vendor || null,
      adapter: device?.adapter || device?.vendor || null,
      provider_health: enriched.provider_health || null,
      authorization_state: enriched?._oyi_runtime?.authorization_state || stateRow?.authorization_state || null,
      control_profile: enriched.control_profile || null,
      device_family: enriched.device_family || null,
      capability_codes: sanitizePublicCapabilityCodes(enriched.capability_codes || []),
    },
  };
}

function assignmentForDevice(device: AnyRecord) {
  return {
    estateId: text(device?.estate_id) || null,
    buildingId: text(device?.building_id, device?.metadata?.building_id) || null,
    homeId: text(device?.home_id) || null,
    roomId: text(device?.room_id) || null,
    roomName: text(device?.room_name, device?.rooms?.name, device?.room?.name, device?.metadata?.room_name) || null,
  };
}

function presentationSummary(input: {
  deviceFamily: string;
  canonical: CanonicalDeviceState;
  availabilityReason: CanonicalDeviceAvailabilityReason;
}) {
  const { deviceFamily, canonical, availabilityReason } = input;
  const availability = canonical.availability;
  const primary = canonical.primaryState?.label || "State unknown";
  const battery = typeof canonical.batteryPercentage === "number" ? `Battery ${Math.round(canonical.batteryPercentage)}%` : "";
  if (availabilityReason === "provider_reports_offline") return "Provider reports offline";
  if (availability === "offline") return "Offline";
  if (availability === "provider_disconnected") return "Provider connection needs attention";
  if (availability === "setup_incomplete") return "Setup incomplete";
  if (availability === "stale") return `Stale · ${primary}`;
  if (deviceFamily === "lock") return [primary, battery].filter(Boolean).join(" · ") || primary;
  if (deviceFamily === "ir_remote") return "Remote ready";
  if (["television", "projector", "set_top_box", "speaker"].includes(deviceFamily) && canonical.primaryState?.key === "remote_state") return "Remote ready";
  if (deviceFamily === "climate" && canonical.primaryState?.key === "climate_state") return "Remote ready";
  return canonical.secondaryState?.key === "channels" ? canonical.secondaryState.label : primary;
}

export function buildCanonicalDevicePresentation(
  device: AnyRecord,
  canonical: CanonicalDeviceState,
  enrichedInput: EnrichedDeviceState | AnyRecord,
): CanonicalDevicePresentation {
  const enriched = (enrichedInput?.normalized_state ? enrichedInput : enrichDeviceProviderState({
    state: enrichedInput,
    metadata: device?.metadata,
    device,
    provider: device?.provider || device?.vendor,
    adapter: device?.adapter || device?.vendor,
  })) as EnrichedDeviceState;
  const availabilityReason = canonical.availabilityReason || canonicalAvailabilityWithReason(enriched, device).reason;
  return {
    availability: canonical.availability,
    availabilityReason,
    assignment: assignmentForDevice(device),
    lastSeenAt: canonical.lastSeenAt,
    lastCheckedAt: canonical.lastProviderSyncAt || isoTimestamp(enriched?._oyi_runtime?.last_refresh, device?.updated_at),
    lastConfirmedStateAt: canonical.primaryState?.value !== null ? (canonical.lastSeenAt || canonical.lastProviderSyncAt) : null,
    staleAfterMs: canonical.staleAfterMs,
    primaryState: {
      ...canonical.primaryState,
      confidence: canonical.primaryState.confidence || (canonical.availability === "online" ? "live" : canonical.availability === "stale" || canonical.availability === "offline" ? "last_confirmed" : "unknown"),
    },
    secondaryState: canonical.secondaryState,
    batteryPercentage: typeof canonical.batteryPercentage === "number" ? canonical.batteryPercentage : null,
    batteryLevel: canonical.batteryLevel || "unknown",
    supportedActions: canonical.supportedActions || [],
    executableActions: canonical.executableActions || [],
    alerts: canonical.alerts || [],
    summary: presentationSummary({ deviceFamily: enriched.device_family, canonical, availabilityReason }),
  };
}

export function summarizeDeviceFrontendContract(device: AnyRecord, stateRow?: AnyRecord | null) {
  const state = asRecord(stateRow?.status);
  const enriched = state.normalized_state ? state : enrichDeviceProviderState({
    state,
    metadata: device?.metadata,
    device,
    provider: device?.provider || device?.vendor,
    adapter: device?.adapter || device?.vendor,
  });
  const publicCapabilityCodes = sanitizePublicCapabilityCodes(enriched.capability_codes || []);
  const summary = {
    state,
    normalized_state: enriched.normalized_state,
    capabilities: Array.from(new Set([...(Array.isArray(device?.capabilities) ? device.capabilities : []), ...publicCapabilityCodes])),
    supported_controls: enriched.supported_controls,
    control_profile: enriched.control_profile,
    channel_definitions: enriched.channel_definitions,
    health_status: enriched.health_status,
    provider_health: enriched.provider_health,
    primary_state: enriched.primary_state,
    telemetry_summary: enriched.telemetry_summary,
    device_family: enriched.device_family,
    device_type: enriched.device_type,
    last_signal: enriched.activity_summary,
    activity_summary: enriched.activity_summary,
    capability_codes: publicCapabilityCodes,
  };
  const canonicalState = buildCanonicalDeviceState(device, enriched, stateRow);
  return {
    ...summary,
    canonical_state: canonicalState,
    canonical_presentation: buildCanonicalDevicePresentation(device, canonicalState, enriched),
  };
}
