import { summarizeDeviceFrontendContract } from "../device/runtime/deviceStateEnrichment";

type AnyRecord = Record<string, any>;

export type DeviceMemorySummary = {
  headline: string;
  summary: string;
  evidence: string[];
  patterns: {
    last_used_at: string | null;
    average_runtime_minutes: number | null;
    common_source: string | null;
    common_scene: string | null;
    common_automation: string | null;
    failure_count: number;
  };
};

export type DeviceRelationshipSummary = {
  room_name: string | null;
  parent_device: { id: string; name: string } | null;
  child_devices: Array<{ id: string; name: string; profile: string | null }>;
  active_scenes: Array<{ id: string; name: string; enabled?: boolean }>;
  active_automations: Array<{ id: string; name: string; enabled?: boolean }>;
  affected_if_offline: string[];
};

export type DevicePredictiveFinding = {
  id: string;
  title: string;
  summary: string;
  severity: "info" | "attention" | "warning";
  confidence: number;
  evidence: string[];
  recommended_action: string;
  owner: "resident" | "facility" | "provider";
  expiry: string | null;
  safe_automation_eligible: boolean;
};

export type DeviceIntelligenceContext = {
  memory_summary: DeviceMemorySummary;
  relationships: DeviceRelationshipSummary;
  predictive_findings: DevicePredictiveFinding[];
  recent_executions: Array<{
    id: string;
    title: string;
    summary: string;
    occurred_at: string | null;
    status: string;
    source: string | null;
  }>;
  active_scenes: Array<{ id: string; name: string; enabled?: boolean }>;
  active_automations: Array<{ id: string; name: string; enabled?: boolean }>;
  conversation_context: {
    current_state: string;
    health: string;
    provider_availability: string;
    room_name: string | null;
    supported_controls: string[];
  };
};

function text(value: unknown) {
  const next = String(value ?? "").trim();
  return next || null;
}

function lower(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function titleCase(value: string, fallback: string) {
  const normalized = value.replace(/[_-]+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized
    .split(/\s+/)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function summarizeSource(value: unknown) {
  const raw = lower(value);
  if (!raw) return null;
  if (raw.includes("scene")) return "scene";
  if (raw.includes("automation")) return "automation";
  if (raw.includes("physical")) return "manual";
  if (raw.includes("facility")) return "facility";
  if (raw.includes("provider")) return "provider";
  if (raw.includes("watch")) return "watch";
  if (raw.includes("app")) return "phone";
  return raw;
}

function buildSceneReferences(rows: any[], deviceId: string) {
  return rows
    .filter((row) => Array.isArray(row?.actions) && row.actions.some((action: any) => String(action?.device_id || action?.deviceId || "") === deviceId))
    .map((row) => ({ id: String(row.id), name: String(row.name || "Scene"), enabled: row.enabled !== false }));
}

export function buildDeviceMemorySummary(input: {
  deviceName: string;
  counter?: AnyRecord | null;
  recentEvents?: any[];
}) : DeviceMemorySummary {
  const counter = input.counter || {};
  const events = Array.isArray(input.recentEvents) ? input.recentEvents : [];
  const commonSource = summarizeSource(counter.last_source) || summarizeSource(events[0]?.source);
  const commonScene = events.find((row) => lower(row?.source) === "scene")?.metadata?.scene_name || null;
  const commonAutomation = events.find((row) => lower(row?.source) === "automation")?.metadata?.automation_name || null;
  const failureCount = num(counter.failure_count) + num(counter.command_failure_count);
  const totalToggles = num(counter.total_toggles);
  const avgMinutes = num(counter.average_response_ms) ? Math.max(1, Math.round(num(counter.average_response_ms) / 60000)) : null;
  const evidence: string[] = [];

  if (counter.last_used_at) evidence.push(`Last used ${String(counter.last_used_at)}`);
  if (totalToggles) evidence.push(`${totalToggles} recorded switch event${totalToggles === 1 ? "" : "s"}`);
  if (commonScene) evidence.push(`Usually seen with ${commonScene}`);
  if (commonAutomation) evidence.push(`Often controlled by ${commonAutomation}`);
  if (failureCount) evidence.push(`Failed ${failureCount} time${failureCount === 1 ? "" : "s"} recently`);

  let headline = "Everything looks normal.";
  let summary = `${input.deviceName} is ready to respond.`;

  if (failureCount >= 2) {
    headline = "This device needs attention.";
    summary = `${input.deviceName} has failed more than once recently.`;
  } else if (!counter.last_used_at) {
    headline = "No recent memory yet.";
    summary = `${input.deviceName} has not built enough usage history yet.`;
  } else if (commonScene) {
    headline = "Oyi recognizes a routine.";
    summary = `${input.deviceName} is often controlled by ${commonScene}.`;
  } else if (commonSource === "manual") {
    headline = "Manual control is common.";
    summary = `${input.deviceName} is often changed from a physical switch action.`;
  } else if (commonSource === "phone") {
    headline = "Phone control is common.";
    summary = `${input.deviceName} is usually controlled from the app.`;
  }

  return {
    headline,
    summary,
    evidence,
    patterns: {
      last_used_at: text(counter.last_used_at),
      average_runtime_minutes: avgMinutes,
      common_source: commonSource,
      common_scene: text(commonScene),
      common_automation: text(commonAutomation),
      failure_count: failureCount,
    },
  };
}

export function buildDeviceRelationshipSummary(input: {
  device: AnyRecord;
  parent?: AnyRecord | null;
  children?: AnyRecord[];
  scenes?: Array<{ id: string; name: string; enabled?: boolean }>;
  automations?: Array<{ id: string; name: string; enabled?: boolean }>;
}) : DeviceRelationshipSummary {
  const childDevices = (input.children || []).map((row) => ({
    id: String(row.id),
    name: String(row.name || "Child device"),
    profile: text(row?.metadata?.control_profile || row?.control_profile),
  }));
  const affected = [
    ...(childDevices.length ? [`${childDevices.length} child device${childDevices.length === 1 ? "" : "s"}`] : []),
    ...((input.scenes || []).slice(0, 2).map((scene) => `scene ${scene.name}`)),
    ...((input.automations || []).slice(0, 2).map((automation) => `automation ${automation.name}`)),
  ];

  return {
    room_name: text(input.device?.metadata?.room_name || input.device?.room_name),
    parent_device: input.parent?.id ? { id: String(input.parent.id), name: String(input.parent.name || "Parent hub") } : null,
    child_devices: childDevices,
    active_scenes: input.scenes || [],
    active_automations: input.automations || [],
    affected_if_offline: affected,
  };
}

export function buildDevicePredictiveFindings(input: {
  summary: ReturnType<typeof summarizeDeviceFrontendContract>;
  memory: DeviceMemorySummary;
  relationships: DeviceRelationshipSummary;
  counter?: AnyRecord | null;
}) : DevicePredictiveFinding[] {
  const findings: DevicePredictiveFinding[] = [];
  const health = lower(input.summary.health_status);
  const providerHealth = lower(input.summary.provider_health);
  const battery = num(input.summary.telemetry_summary?.battery);
  const failureCount = input.memory.patterns.failure_count;
  const responseMs = num(input.counter?.average_response_ms);

  if (health === "offline" || providerHealth === "offline") {
    findings.push({
      id: "device-offline",
      title: "This device is offline",
      summary: "Oyi can’t reach this device right now.",
      severity: "warning",
      confidence: 0.98,
      evidence: ["The runtime health state is offline."],
      recommended_action: "Check power and provider connectivity.",
      owner: "resident",
      expiry: null,
      safe_automation_eligible: false,
    });
  }

  if (battery > 0 && battery <= 15) {
    findings.push({
      id: "battery-low",
      title: "Battery is low",
      summary: "This device may stop responding soon if the battery is not replaced or charged.",
      severity: "attention",
      confidence: 0.92,
      evidence: [`Battery level is ${battery}%.`],
      recommended_action: "Recharge or replace the battery.",
      owner: "resident",
      expiry: null,
      safe_automation_eligible: false,
    });
  }

  if (failureCount >= 2) {
    findings.push({
      id: "repeated-failures",
      title: "Repeated command failures detected",
      summary: "This device has failed more than once recently.",
      severity: "attention",
      confidence: 0.88,
      evidence: [`${failureCount} recent device failures were recorded.`],
      recommended_action: "Run a connection check and retry from Oyi.",
      owner: "resident",
      expiry: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      safe_automation_eligible: false,
    });
  }

  if (responseMs > 4500) {
    findings.push({
      id: "slow-response",
      title: "Response time is slower than normal",
      summary: "The provider is accepting commands, but confirmation is taking longer than expected.",
      severity: "info",
      confidence: 0.73,
      evidence: [`Average response time is about ${Math.round(responseMs / 1000)} seconds.`],
      recommended_action: "Wait for confirmation or retry if the state does not update.",
      owner: "provider",
      expiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      safe_automation_eligible: true,
    });
  }

  if (input.relationships.parent_device && health === "offline") {
    findings.push({
      id: "parent-hub-offline",
      title: "Parent hub dependency may be affected",
      summary: "This child device depends on a hub connection that may be unavailable.",
      severity: "warning",
      confidence: 0.81,
      evidence: [`Parent hub: ${input.relationships.parent_device.name}.`],
      recommended_action: "Check the parent hub before retrying this device.",
      owner: "resident",
      expiry: null,
      safe_automation_eligible: false,
    });
  }

  return findings;
}

export async function loadDeviceIntelligenceContext(input: {
  device: AnyRecord;
  stateRow?: AnyRecord | null;
}) : Promise<DeviceIntelligenceContext> {
  const { supabaseAdmin } = await import("../supabase/supabaseClient");
  const deviceId = String(input.device?.id || "").trim();
  const summary = summarizeDeviceFrontendContract(input.device, input.stateRow || null);
  const fallbackRelationships = buildDeviceRelationshipSummary({ device: input.device, children: [], scenes: [], automations: [] });
  const fallbackMemory = buildDeviceMemorySummary({ deviceName: String(input.device?.name || "Device"), counter: null, recentEvents: [] });

  if (!deviceId) {
    return {
      memory_summary: fallbackMemory,
      relationships: fallbackRelationships,
      predictive_findings: buildDevicePredictiveFindings({ summary, memory: fallbackMemory, relationships: fallbackRelationships, counter: null }),
      recent_executions: [],
      active_scenes: [],
      active_automations: [],
      conversation_context: {
        current_state: titleCase(String(summary.primary_state || "idle"), "Idle"),
        health: titleCase(String(summary.health_status || "unknown"), "Unknown"),
        provider_availability: titleCase(String(summary.provider_health || "unknown"), "Unknown"),
        room_name: text(input.device?.metadata?.room_name || input.device?.room_name),
        supported_controls: Array.isArray(summary.supported_controls) ? summary.supported_controls : [],
      },
    };
  }

  const sceneScope = input.device?.home_id ? { home_id: input.device.home_id } : input.device?.estate_id ? { estate_id: input.device.estate_id } : {};
  const [counterResult, eventResult, childResult, parentResult, sceneResult, automationResult] = await Promise.all([
    supabaseAdmin.from("device_usage_counters").select("*").eq("device_id", deviceId).maybeSingle(),
    supabaseAdmin.from("device_events").select("id,event_type,source,occurred_at,metadata,new_state").eq("device_id", deviceId).order("occurred_at", { ascending: false }).limit(12),
    supabaseAdmin.from("devices").select("id,name,metadata,control_profile").eq("parent_device_id", deviceId).limit(12),
    input.device?.parent_device_id ? supabaseAdmin.from("devices").select("id,name").eq("id", String(input.device.parent_device_id)).maybeSingle() : Promise.resolve({ data: null, error: null } as any),
    supabaseAdmin.from("consumer_scenes").select("id,name,enabled,actions").match(sceneScope).order("created_at", { ascending: false }).limit(30),
    supabaseAdmin.from("consumer_automations").select("id,name,enabled,actions").match(sceneScope).order("created_at", { ascending: false }).limit(30),
  ]);

  const recentEvents = Array.isArray(eventResult.data) ? eventResult.data : [];
  const scenes = buildSceneReferences(Array.isArray(sceneResult.data) ? sceneResult.data : [], deviceId);
  const automations = buildSceneReferences(Array.isArray(automationResult.data) ? automationResult.data : [], deviceId);
  const memory = buildDeviceMemorySummary({
    deviceName: String(input.device?.name || "Device"),
    counter: counterResult.data || null,
    recentEvents,
  });
  const relationships = buildDeviceRelationshipSummary({
    device: input.device,
    parent: parentResult.data || null,
    children: Array.isArray(childResult.data) ? childResult.data : [],
    scenes,
    automations,
  });
  const predictive = buildDevicePredictiveFindings({
    summary,
    memory,
    relationships,
    counter: counterResult.data || null,
  });
  const recentExecutions = recentEvents
    .filter((row: any) => /command|scene|automation/.test(lower(row?.event_type)))
    .slice(0, 6)
    .map((row: any) => ({
      id: String(row.id || `${row.event_type}:${row.occurred_at}`),
      title: titleCase(String(row?.event_type || "device update"), "Device update"),
      summary: String(row?.metadata?.summary || row?.metadata?.result_summary || row?.event_type || "Device update"),
      occurred_at: text(row?.occurred_at),
      status: /failed/.test(lower(row?.event_type)) ? "failed" : /offline/.test(lower(row?.event_type)) ? "attention" : "executed",
      source: summarizeSource(row?.source),
    }));

  return {
    memory_summary: memory,
    relationships,
    predictive_findings: predictive,
    recent_executions: recentExecutions,
    active_scenes: scenes,
    active_automations: automations,
    conversation_context: {
      current_state: titleCase(String(summary.primary_state || "idle"), "Idle"),
      health: titleCase(String(summary.health_status || "unknown"), "Unknown"),
      provider_availability: titleCase(String(summary.provider_health || "unknown"), "Unknown"),
      room_name: text(input.device?.metadata?.room_name || input.device?.room_name),
      supported_controls: Array.isArray(summary.supported_controls) ? summary.supported_controls : [],
    },
  };
}

export function buildDeviceConversationPrompt(context: DeviceIntelligenceContext) {
  const signals = [
    context.memory_summary.summary,
    ...context.predictive_findings.map((item) => item.summary),
    ...context.relationships.affected_if_offline.slice(0, 2).map((item) => `Dependency: ${item}`),
  ].filter(Boolean);
  return signals.join(" ");
}
