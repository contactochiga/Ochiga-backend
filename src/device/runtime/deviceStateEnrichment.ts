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
    tv_remote: "ir_remote",
    set_top_box: "ir_remote",
    stb: "ir_remote",
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
  };
  return map[raw] || raw;
}

function knownFamily(value: unknown) {
  const mapped = tuyaCategoryFamily(value);
  return ["switch", "plug", "camera", "climate", "ir_remote", "curtain", "lock", "sensor", "light"].includes(mapped)
    ? mapped
    : "";
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

  if (
    hasClimate ||
    (/ac|air_conditioner|climate|thermostat|hvac|kt/.test(haystack) &&
      !hasPower)
  ) {
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

function inferControlProfile(deviceFamily: string, codes: string[]) {
  if (deviceFamily === "camera") return "camera";
  if (deviceFamily === "climate") return "climate";
  if (deviceFamily === "ir_remote") return "ir_remote";
  if (deviceFamily === "curtain") return "curtain";
  if (deviceFamily === "lock") return "lock";
  if (deviceFamily === "sensor") return "sensor";
  if (deviceFamily === "plug") return "plug";
  if (deviceFamily === "switch") return "switch";
  if (deviceFamily === "light") return "switch";
  if (codes.some((code) => /^switch(_\d+)?$/.test(code) || ["switch", "power", "on"].includes(code))) return deviceFamily === "plug" ? "plug" : "switch";
  return "generic";
}

function inferSupportedControls(deviceFamily: string, codes: string[]) {
  const controls = new Set<string>();
  if (["switch", "plug", "light", "climate", "ir_remote"].includes(deviceFamily) && codes.some((code) => /^switch(_\d+)?$/.test(code) || ["switch", "power", "on"].includes(code))) controls.add("power");
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
  if (deviceFamily === "lock") controls.add("lock");
  if (deviceFamily === "curtain") controls.add("position");
  if (deviceFamily === "ir_remote") {
    controls.add("remote");
    if (codes.includes("power") || codes.includes("switch") || codes.includes("on")) controls.add("power");
  }
  if (deviceFamily === "climate") {
    if (codes.some((code) => /mode/.test(code))) controls.add("mode");
    if (codes.some((code) => /fan|wind/.test(code))) controls.add("fan");
    if (codes.some((code) => /swing/.test(code))) controls.add("swing");
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
  const battery = numberValue(state.battery_percentage ?? state.battery_value ?? state.battery);
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
  if (args.primaryState === "on") return `${name} is active.`;
  if (args.primaryState === "off") return `${name} is idle.`;
  return `${name} reported a new device update.`;
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
  const controlProfile = inferControlProfile(deviceFamily, codes);
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
  return {
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
}
