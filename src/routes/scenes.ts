import { Router } from "express";
import crypto from "crypto";
import { emitAuditEvent } from "../core/foundation";
import { requireAuth, requirePermission, type AuthUser } from "../middleware/auth";
import { resolveRequestContext } from "../middleware/contextResolver";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { resolveVisibleDevice } from "../services/deviceRuntimeService";
import { hasWatchScope } from "../services/watchPolicy";
import { summarizeDeviceFrontendContract } from "../device/runtime/deviceStateEnrichment";
import { deviceRuntimeStateService } from "../services/deviceRuntimeStateService";
import { logger } from "../observability/logger";
import {
  executeResidentActionBatch,
  residentBatchCounts,
  residentBatchStatus,
  type ResidentCanonicalAction,
} from "../services/residentActionBatchExecutionService";
import {
  executeRegisteredActionBatch,
  type RegisteredCanonicalAction,
} from "../services/registeredActionBatchExecutionService";
import { getRegisteredExecutionAction } from "../intelligence-core/executionRegistry";
import {
  executeWorkflowActionBatch,
  workflowContractFor,
  type WorkflowCanonicalAction,
} from "../services/workflowActionBatchExecutionService";
import {
  executeCommunicationActionBatch,
  type CommunicationCanonicalAction,
} from "../services/communicationActionBatchExecutionService";
import { WORKFLOW_STATUSES } from "../intelligence-core/workflows";
import {
  automationOccurrenceKey,
  nextAutomationRunAt,
  validateAutomationTrigger,
} from "../services/automationScheduleService";

const router = Router();
router.use(requireAuth);
router.use(resolveRequestContext);

const SCENE_ACTION_LIMIT = 24;
const SCENE_ACTION_CONCURRENCY = 3;
const SCENE_ACTION_TIMEOUT_MS = 15_000;

function isUuid(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

// Shared Automation Runtime, PR 1 (infrastructure only) — canonical
// surface contract. consumer_automations.surface defaults to
// "consumer" for every existing row (see migration
// 20260820000000_automation_surface_contract.sql), so this constant
// list, not the column, is what actually gates whether the scheduler
// or the create/update routes will ever touch a non-consumer row.
// Facility and Office go from "off" to "on" independently, later,
// each its own approved pass — see docs/architecture/
// SHARED_AUTOMATION_RUNTIME.md.
export type AutomationSurface = "consumer" | "facility" | "office";
const AUTOMATION_SURFACES: AutomationSurface[] = ["consumer", "facility", "office"];
const AUTOMATION_SURFACE_FACILITY_ENABLED = String(process.env.AUTOMATION_SURFACE_FACILITY_ENABLED || "false").toLowerCase() === "true";
const AUTOMATION_SURFACE_OFFICE_ENABLED = String(process.env.AUTOMATION_SURFACE_OFFICE_ENABLED || "false").toLowerCase() === "true";

function enabledAutomationSurfaces(): AutomationSurface[] {
  const surfaces: AutomationSurface[] = ["consumer"];
  if (AUTOMATION_SURFACE_FACILITY_ENABLED) surfaces.push("facility");
  if (AUTOMATION_SURFACE_OFFICE_ENABLED) surfaces.push("office");
  return surfaces;
}

export function isAutomationSurfaceEnabled(surface: AutomationSurface): boolean {
  return enabledAutomationSurfaces().includes(surface);
}

// Office automations have no per-user row in Backend's `users` table —
// Office's own admin/staff identities live in ochiga-office, not here.
// This mirrors the exact synthetic-actor pattern already established
// and running in production for officeExport.ts's officeWorkflowActor:
// role "ochiga_admin" is a real PlatformRole every permission check in
// this codebase already understands, cast past AuthUser's narrower
// UserRole type (a pre-existing, documented type/runtime gap, not
// something introduced here). Dead code while
// AUTOMATION_SURFACE_OFFICE_ENABLED is false — the scheduler query
// below never returns an office row until that flag flips.
export function officeAutomationActor(automation: any): AuthUser {
  return {
    id: "office_automation_runtime",
    email: "office-automation-runtime@ochiga.local",
    role: "ochiga_admin",
    permissions: [],
    permission_scopes: [],
    estate_id: automation?.estate_id || null,
    home_id: automation?.home_id || null,
  } as unknown as AuthUser;
}

// Shared Automation Runtime PR 2 (Facility) — the second action shape,
// alongside the existing device_command shape below. Dispatches through
// executeRegisteredAction (intelligence-core/executionRegistry.ts),
// which already owns scope/permission enforcement and observability —
// this file only validates structure and routes to it.
//
// Deliberately narrower than the full EXECUTION_REGISTRY: excludes
// device.on/off/toggle (devices already go through the proven
// device_command lane below, not duplicated here) and excludes
// community.approve/reject, service.assign/complete, wallet.approve/
// cancel (all marked available:false in the registry itself — not
// implemented anywhere, not invented here either). A real, live
// Facility "report" export endpoint and a real service-config toggle
// endpoint were both found during this pass's audit but are
// synchronous/interactive-only with no automation-shaped delivery
// target or registry entry yet — named as follow-ups, not wired in.
const FACILITY_REGISTERED_ACTION_IDS = [
  "visitor.approve",
  "visitor.revoke",
  "visitor.expire",
  "maintenance.assign",
  "maintenance.complete",
  "maintenance.cancel",
] as const;

type CleanRegisteredAction = {
  action_id: string;
  entity_id: string;
  assignee?: string | null;
  label?: string | null;
};

function isRegisteredActionItem(item: any): boolean {
  return Boolean(item && typeof item === "object" && item.action_type === "registered_action");
}

function cleanRegisteredActions(value: unknown): CleanRegisteredAction[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRegisteredActionItem)
    .slice(0, SCENE_ACTION_LIMIT)
    .map((item: any) => ({
      action_id: String(item?.action_id || "").trim(),
      entity_id: String(item?.entity_id || "").trim(),
      assignee: item?.assignee ? String(item.assignee).trim() : null,
      label: item?.label ? String(item.label).trim() : null,
    }))
    .filter((item) => item.action_id && item.entity_id);
}

// Structural validation only — no DB lookup, no execution. Full
// scope/permission enforcement happens once, consistently, at every
// run (scheduled or manual) inside executeRegisteredAction itself, not
// re-implemented here at save time.
function validateRegisteredActions(actions: CleanRegisteredAction[]) {
  if (!actions.length) return { ok: false as const, error: "At least one action is required.", code: "automation_action_required" };
  for (const action of actions) {
    if (!(FACILITY_REGISTERED_ACTION_IDS as readonly string[]).includes(action.action_id)) {
      return { ok: false as const, error: `${action.action_id} is not a supported Facility automation action.`, code: "unsupported_registered_action" };
    }
    const registered = getRegisteredExecutionAction(action.action_id);
    if (!registered?.available) {
      return { ok: false as const, error: `${action.action_id} is not yet available.`, code: "registered_action_unavailable" };
    }
    if (action.action_id === "maintenance.assign" && !action.assignee) {
      return { ok: false as const, error: "maintenance.assign requires an assignee.", code: "assignee_required" };
    }
  }
  return { ok: true as const };
}

// Shared Automation Runtime PR 3 (Office) — the third action shape.
// Dispatches through createWorkflow/transitionWorkflow/getWorkflow
// (intelligence-core/workflows.ts), the exact same functions the Oyi
// Runtime Contract Task-domain bridge (officeExport.ts) already calls
// in production. No new workflow logic, no crm_tasks interaction —
// this is a second, independent way to reach the same Task domain
// (scheduled, not CRM-event-triggered), not a replacement for the
// bridge. workflow_type is restricted to WORKFLOW_CONTRACTS (already
// declared, already has real origin/responsible agent pairs) rather
// than accepting an arbitrary string.
export type CleanWorkflowAction = {
  operation: "create" | "transition";
  workflow_type: string | null;
  workflow_id: string | null;
  status: string | null;
  title: string | null;
  summary: string | null;
  label: string | null;
};

export function isWorkflowActionItem(item: any): boolean {
  return Boolean(item && typeof item === "object" && item.action_type === "workflow_action");
}

export function cleanWorkflowActions(value: unknown): CleanWorkflowAction[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isWorkflowActionItem)
    .slice(0, SCENE_ACTION_LIMIT)
    .map((item: any) => ({
      operation: item?.operation === "transition" ? "transition" : item?.operation === "create" ? "create" : null,
      workflow_type: item?.workflow_type ? String(item.workflow_type).trim() : null,
      workflow_id: item?.workflow_id ? String(item.workflow_id).trim() : null,
      status: item?.status ? String(item.status).trim() : null,
      title: item?.title ? String(item.title).trim().slice(0, 180) : null,
      summary: item?.summary ? String(item.summary).trim().slice(0, 500) : null,
      label: item?.label ? String(item.label).trim() : null,
    }))
    .filter((item): item is CleanWorkflowAction => item.operation !== null);
}

// Structural validation only — no DB lookup, no execution. Full
// permission/scope enforcement happens once, consistently, at every
// run inside createWorkflow/transitionWorkflow/getWorkflow themselves
// (same as the existing Office bridge), not re-implemented here.
export function validateWorkflowActions(actions: CleanWorkflowAction[]) {
  if (!actions.length) return { ok: false as const, error: "At least one action is required.", code: "automation_action_required" };
  for (const action of actions) {
    if (action.operation === "create") {
      if (!action.workflow_type || !workflowContractFor(action.workflow_type)) {
        return { ok: false as const, error: `${action.workflow_type || "(missing)"} is not a supported automation workflow type.`, code: "unsupported_workflow_type" };
      }
      if (!action.title || !action.summary) {
        return { ok: false as const, error: "workflow_action create requires a title and summary.", code: "workflow_title_summary_required" };
      }
    } else {
      if (!action.workflow_id) {
        return { ok: false as const, error: "workflow_action transition requires a workflow_id.", code: "workflow_id_required" };
      }
      if (!action.status || !(WORKFLOW_STATUSES as readonly string[]).includes(action.status)) {
        return { ok: false as const, error: `${action.status || "(missing)"} is not a supported workflow status.`, code: "unsupported_workflow_status" };
      }
    }
  }
  return { ok: true as const };
}

// Shared Automation Runtime — the Communication action shape (Phase M/N
// of the Communication Runtime programme). Dispatches through
// CommunicationRuntime.plan/authorize/dispatch — the SAME runtime the
// conversational propose/confirm path uses (ConversationOrchestrator.ts).
// No email/WhatsApp-specific logic here; one channel field, same as
// workflow_action's own operation field distinguishing sub-behavior
// within a single homogeneous lane.
export function isCommunicationActionItem(item: any): boolean {
  return Boolean(item && typeof item === "object" && item.action_type === "communication_action");
}

const COMMUNICATION_ACTION_CHANNELS = new Set(["email", "whatsapp", "sms", "auto"]);

export function cleanCommunicationActions(value: unknown): CommunicationCanonicalAction[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isCommunicationActionItem)
    .slice(0, SCENE_ACTION_LIMIT)
    .map((item: any) => ({
      channel: COMMUNICATION_ACTION_CHANNELS.has(String(item?.channel)) ? item.channel : "auto",
      recipient_email: item?.recipient_email ? String(item.recipient_email).trim() : null,
      recipient_phone: item?.recipient_phone ? String(item.recipient_phone).trim() : null,
      // Phase 15 -- a role phrase ("Head of Sales") instead of a fixed
      // person, resolved fresh at every run (see
      // communicationActionBatchExecutionService.ts's runOne).
      recipient_role_query: item?.recipient_role_query ? String(item.recipient_role_query).trim().slice(0, 120) : null,
      subject: item?.subject ? String(item.subject).trim().slice(0, 180) : null,
      body: item?.body ? String(item.body).trim().slice(0, 4000) : "",
      label: item?.label ? String(item.label).trim() : null,
    }));
}

// Structural validation only — no send, no DB lookup. Real recipient/
// channel resolution and adapter-level validation happen inside
// CommunicationRuntime.plan()/validate() at execution time (the same
// checks the conversational path relies on), not duplicated here.
export function validateCommunicationActions(actions: CommunicationCanonicalAction[]) {
  if (!actions.length) return { ok: false as const, error: "At least one action is required.", code: "automation_action_required" };
  for (const action of actions) {
    if (!action.body) {
      return { ok: false as const, error: "communication_action requires a message body.", code: "communication_body_required" };
    }
    if (!action.recipient_email && !action.recipient_phone && !action.recipient_role_query) {
      return { ok: false as const, error: "communication_action requires an explicit recipient_email/recipient_phone, or a recipient_role_query (e.g. \"Head of Sales\") — it cannot resolve \"him/her/them\" outside a live conversation.", code: "communication_recipient_required" };
    }
  }
  return { ok: true as const };
}

type CleanSceneAction = {
  device_id: string;
  command: Record<string, any>;
  label?: string | null;
  action_label?: string | null;
};

export type CanonicalSceneAction = CleanSceneAction & ResidentCanonicalAction & {
  device_name: string;
  command_code: string;
  action_label: string;
};

function activeScope(req: any) {
  return {
    estate_id: req.oisContext?.estate_id || req.user?.estate_id || null,
    home_id: req.oisContext?.home_id || req.user?.home_id || null,
  };
}

function scoped(query: any, req: any) {
  const scope = activeScope(req);
  let next = query;
  if (scope.estate_id) next = next.eq("estate_id", scope.estate_id);
  if (scope.home_id) next = next.eq("home_id", scope.home_id);
  return next;
}

function cleanActions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, SCENE_ACTION_LIMIT).map((item: any) => ({
    device_id: String(item?.device_id || item?.deviceId || "").trim(),
    command: item?.command && typeof item.command === "object" ? item.command : {},
    label: String(item?.label || item?.action_label || "").trim() || null,
    action_label: String(item?.action_label || item?.label || "").trim() || null,
  })).filter((item) => item.device_id && Object.keys(item.command).length);
}

function publicActionError(message: string, statusCode = 422, code = "unsupported_scene_action") {
  const error: any = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function sceneActionError(
  message: string,
  statusCode: number,
  code: string,
  context: {
    actionIndex?: number;
    canonicalDeviceId?: string | null;
    commandKey?: string | null;
    legacyCode?: string;
    exposedChannelKeys?: string[];
    runtimeFreshness?: string | null;
  } = {},
) {
  const error: any = publicActionError(message, statusCode, code);
  error.action_index = context.actionIndex;
  error.canonical_device_id = context.canonicalDeviceId || null;
  error.command_key = context.commandKey || null;
  if (context.legacyCode) error.legacy_code = context.legacyCode;
  error.exposed_channel_keys = Array.isArray(context.exposedChannelKeys) ? context.exposedChannelKeys : [];
  error.runtime_freshness = context.runtimeFreshness || null;
  return error;
}

function sceneActionErrorPayload(err: any) {
  return {
    error: err?.message || "Scene contains an unavailable or unsafe device action",
    message: err?.message || "Scene contains an unavailable or unsafe device action",
    code: err?.code || "scene_action_invalid",
    legacy_code: err?.legacy_code || null,
    action_index: Number.isInteger(err?.action_index) ? err.action_index : null,
    canonical_device_id: err?.canonical_device_id || null,
    command_key: err?.command_key || null,
    exposed_channel_keys: Array.isArray(err?.exposed_channel_keys) ? err.exposed_channel_keys : [],
    runtime_freshness: err?.runtime_freshness || null,
  };
}

function boolValue(value: any): boolean | null {
  if (value === true || value === false) return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "on", "yes"].includes(raw)) return true;
  if (["false", "0", "off", "no"].includes(raw)) return false;
  return null;
}

function numberValue(value: any): number | null {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function titleCase(value: string, fallback = "Device") {
  const text = value.replace(/[_-]+/g, " ").trim();
  if (!text) return fallback;
  return text.split(/\s+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function commandEntries(command: Record<string, any>) {
  return Object.entries(command || {}).filter(([key]) => !["source", "metadata", "meta", "idempotency_key", "command_key"].includes(String(key).toLowerCase()));
}

function sceneDeviceFamily(device: any, summary: any) {
  const family = String(summary?.device_family || device?.device_family || device?.category || device?.type || "").toLowerCase();
  const profile = String(summary?.control_profile || device?.control_profile || "").toLowerCase();
  const haystack = [
    family,
    profile,
    device?.name,
    device?.type,
    device?.category,
    device?.metadata?.raw?.category,
    device?.metadata?.category,
    device?.metadata?.product_name,
    device?.metadata?.model,
  ].map((item) => String(item || "").toLowerCase()).join(" ");
  if (family === "lock" || profile === "lock" || /\b(jtmspro|lock|doorlock|smart_access)\b/.test(haystack)) return "lock";
  if (family === "television" || profile === "television" || family === "ir_remote" || profile === "ir_remote" || /\b(tv|television|infrared|ir remote)\b/.test(haystack)) return "ir";
  if (family === "curtain" || profile === "curtain") return "curtain";
  if (family === "climate" || family === "air_conditioner" || profile === "air_conditioner" || profile === "climate") return "climate";
  if (family === "switch" || family === "plug" || family === "light" || profile === "switch" || profile === "plug") return "switch";
  const codes = new Set([...(summary?.capability_codes || []), ...(summary?.supported_controls || [])].map((item: any) => String(item).toLowerCase()));
  if (Array.from(codes).some((code) => /^switch(_\d+)?$/.test(code) || ["power", "on"].includes(code))) return "switch";
  return "unknown";
}

function controllableChannels(summary: any) {
  return (Array.isArray(summary?.channel_definitions) ? summary.channel_definitions : [])
    .filter((channel: any) => channel?.controllable !== false && channel?.code)
    .map((channel: any, index: number) => ({
      index: Number(channel.index || index + 1),
      code: String(channel.code),
      name: String(channel.name || channel.label || `Channel ${Number(channel.index || index + 1)}`),
    }));
}

function validationLogBase(req: any) {
  const scope = activeScope(req);
  return {
    actor_id: req.user?.id || null,
    estate_id: scope.estate_id,
    home_id: scope.home_id,
  };
}

function sanitizedActionsForLog(actions: CleanSceneAction[]) {
  return actions.map((action, index) => {
    const [commandKey, value] = commandEntries(action.command)[0] || [];
    return {
      action_index: index,
      canonical_device_id: action.device_id,
      command_key: commandKey ? String(commandKey) : null,
      value_type: typeof value,
      value: typeof value === "boolean" || typeof value === "number" || typeof value === "string" ? value : null,
    };
  });
}

async function frontendContractForSceneValidation(device: any) {
  const snapshot = await deviceRuntimeStateService.getOrHydrate(device).catch((error) => {
    logger.warn("scene_action_runtime_snapshot_unavailable", {
      device_id: String(device?.id || ""),
      error,
    });
    return null;
  });
  const stateRow = snapshot
    ? {
      status: snapshot.state,
      last_seen: snapshot.last_refresh,
      updated_at: snapshot.runtime_timestamp,
    }
    : null;
  return {
    summary: snapshot?.summary || summarizeDeviceFrontendContract(device, stateRow),
    runtimeFreshness: snapshot?.freshness || "unavailable",
    runtimeSource: snapshot?.source || "none",
  };
}

async function canonicalizeSceneAction(req: any, action: CleanSceneAction, index: number): Promise<CanonicalSceneAction> {
  const scope = activeScope(req);
  const [submittedKey, submittedValue] = commandEntries(action.command)[0] || [];
  logger.info("scene_action_validation_started", {
    ...validationLogBase(req),
    action_index: index,
    canonical_device_id: action.device_id,
    command_key: submittedKey ? String(submittedKey) : null,
    value_type: typeof submittedValue,
  });

  const device = await resolveVisibleDevice(req.user!, action.device_id, { estateId: scope.estate_id, homeId: scope.home_id });
  if (!device?.id) {
    logger.warn("scene_action_validation_failed", {
      ...validationLogBase(req),
      action_index: index,
      canonical_device_id: action.device_id,
      command_key: submittedKey ? String(submittedKey) : null,
      exposed_channel_keys: [],
      runtime_freshness: "unavailable",
      validation_code: "device_out_of_scope",
    });
    throw sceneActionError("Scene contains a device outside this home.", 403, "device_out_of_scope", {
      actionIndex: index,
      canonicalDeviceId: action.device_id,
      commandKey: submittedKey ? String(submittedKey) : null,
      runtimeFreshness: "unavailable",
    });
  }

  const { summary, runtimeFreshness, runtimeSource } = await frontendContractForSceneValidation(device);
  const family = sceneDeviceFamily(device, summary);
  const entries = commandEntries(action.command);
  const [rawKey, rawValue] = entries[0] || [];
  const key = String(rawKey || "").trim();
  const keyLower = key.toLowerCase();
  const channels = controllableChannels(summary);
  const exposedChannelKeys = channels.map((channel: { code: string }) => channel.code);
  const capabilityCodes = new Set([...(summary.capability_codes || []), ...(summary.supported_controls || [])].map((item: any) => String(item).toLowerCase()));
  const errorContext = { actionIndex: index, canonicalDeviceId: String(device.id), commandKey: key || null, exposedChannelKeys, runtimeFreshness };

  logger.info("scene_action_capability_contract", {
    ...validationLogBase(req),
    action_index: index,
    canonical_device_id: String(device.id),
    command_key: key || null,
    device_family: family,
    exposed_channel_keys: exposedChannelKeys,
    capability_keys: Array.from(capabilityCodes).filter((code) => /^switch(_\d+)?$/.test(code) || ["switch", "power", "on"].includes(code)),
    runtime_freshness: runtimeFreshness,
    runtime_source: runtimeSource,
  });

  const fail = (error: any) => {
    logger.warn("scene_action_validation_failed", {
      ...validationLogBase(req),
      action_index: Number.isInteger(error?.action_index) ? error.action_index : index,
      canonical_device_id: error?.canonical_device_id || String(device.id),
      command_key: error?.command_key || key || null,
      exposed_channel_keys: Array.isArray(error?.exposed_channel_keys) ? error.exposed_channel_keys : exposedChannelKeys,
      runtime_freshness: error?.runtime_freshness || runtimeFreshness,
      validation_code: error?.code || "scene_action_invalid",
    });
    return error;
  };

  if (family === "lock") throw fail(sceneActionError("Lock actions are unavailable in scenes for safety.", 422, "lock_scene_action_blocked", errorContext));
  if (family === "ir") throw fail(sceneActionError("TV and IR remote actions are not enabled for scenes in this phase.", 422, "ir_scene_action_blocked", errorContext));

  if (entries.length !== 1) throw fail(sceneActionError("Each scene action must control exactly one device action.", 422, "scene_action_not_atomic", errorContext));
  const deviceName = String(device.name || "Device");

  if (family === "switch") {
    const desired = boolValue(rawValue);
    if (desired === null) throw fail(sceneActionError("Switch scene actions must be On or Off.", 422, "invalid_switch_value", errorContext));
    let commandCode = key;
    if (["switch", "power", "on"].includes(keyLower)) {
      if (channels.length > 1) {
        throw fail(sceneActionError("Choose a specific switch channel for this multi-gang device.", 422, "ambiguous_multi_gang_scene_action", errorContext));
      }
      commandCode = channels[0]?.code || (capabilityCodes.has("switch_1") ? "switch_1" : keyLower);
    } else if (/^switch_\d+$/i.test(key)) {
      const hasChannel = channels.some((channel: { code: string }) => channel.code.toLowerCase() === keyLower);
      if (!hasChannel && !capabilityCodes.has(keyLower)) {
        throw fail(sceneActionError("This switch channel is not exposed by the device.", 422, "SCENE_CHANNEL_NOT_EXPOSED", {
          ...errorContext,
          legacyCode: "unsupported_switch_channel",
        }));
      }
    } else if (!capabilityCodes.has(keyLower)) {
      throw fail(sceneActionError("This device does not expose that scene action.", 422, "unsupported_scene_command", errorContext));
    }
    const channel = channels.find((item: { code: string; name: string }) => item.code.toLowerCase() === String(commandCode).toLowerCase());
    const actionLabel = action.action_label || action.label || `${channel?.name || titleCase(commandCode, "Power")} → ${desired ? "On" : "Off"}`;
    return {
      device_id: String(device.id),
      command: { [commandCode]: desired },
      label: action.label || actionLabel,
      action_label: actionLabel,
      device_name: deviceName,
      command_code: commandCode,
    };
  }

  if (family === "curtain") {
    if (!["open", "close", "position"].includes(keyLower) || !capabilityCodes.has(keyLower)) {
      throw fail(sceneActionError("This curtain does not expose that safe scene action.", 422, "unsupported_curtain_action", errorContext));
    }
    const value = keyLower === "position" ? numberValue(rawValue) : boolValue(rawValue);
    if (value === null || (typeof value === "number" && (value < 0 || value > 100))) {
      throw fail(sceneActionError("Curtain scene action value is invalid.", 422, "invalid_curtain_value", errorContext));
    }
    const actionLabel = action.action_label || action.label || `${titleCase(keyLower)} → ${String(value)}`;
    return { device_id: String(device.id), command: { [keyLower]: value }, label: action.label || actionLabel, action_label: actionLabel, device_name: deviceName, command_code: keyLower };
  }

  if (family === "climate") {
    if (!["temperature", "temp_set", "mode"].includes(keyLower) || !capabilityCodes.has(keyLower)) {
      throw fail(sceneActionError("This climate device does not expose that scene action.", 422, "unsupported_climate_action", errorContext));
    }
    const value = keyLower === "mode" ? String(rawValue || "").trim() : numberValue(rawValue);
    if (value === "" || value === null) throw fail(sceneActionError("Climate scene action value is invalid.", 422, "invalid_climate_value", errorContext));
    const actionLabel = action.action_label || action.label || `${titleCase(keyLower)} → ${String(value)}`;
    return { device_id: String(device.id), command: { [keyLower]: value }, label: action.label || actionLabel, action_label: actionLabel, device_name: deviceName, command_code: keyLower };
  }

  throw fail(sceneActionError("This device is not supported by scenes yet.", 422, "unsupported_scene_device", errorContext));
}

export async function canonicalizeSceneActions(req: any, actions: CleanSceneAction[]) {
  const canonical: CanonicalSceneAction[] = [];
  for (let index = 0; index < actions.length; index += 1) {
    canonical.push(await canonicalizeSceneAction(req, actions[index], index));
  }
  return canonical;
}

function sceneRunId(req: any, sceneId: string) {
  const explicit = String(req.headers?.["idempotency-key"] || req.body?.scene_run_id || req.body?.run_id || "").trim();
  if (explicit && /^[a-zA-Z0-9:_-]{8,128}$/.test(explicit)) return explicit;
  return crypto.randomUUID();
}

function overallSceneStatus(results: Array<{ status: string }>) {
  return residentBatchStatus(results, "scene");
}

function sceneRunCounts(results: Array<{ status: string }>) {
  return residentBatchCounts(results);
}

async function audit(actor: AuthUser, action: string, resourceId: string, metadata: Record<string, any> = {}, req?: any) {
  const scope = req ? activeScope(req) : { estate_id: actor.estate_id || null, home_id: actor.home_id || null };
  await emitAuditEvent({
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action,
    resourceType: "scene",
    resourceId,
    estateId: scope.estate_id || undefined,
    homeId: scope.home_id || undefined,
    status: "success",
    metadata,
  } as any);
}

router.get("/", requirePermission("devices.read"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const { data, error } = await scoped(supabaseAdmin.from("consumer_scenes").select("*"), req)
    .order("created_at", { ascending: false });
  if (error) return res.json({ available: false, scenes: [], error: error.message });
  res.json({ available: true, scenes: data || [] });
});

router.post("/", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const name = String(req.body?.name || "").trim().slice(0, 80);
  const actions = cleanActions(req.body?.actions);
  logger.info("scene_create_request_received", {
    ...validationLogBase(req),
    action_count: actions.length,
    actions: sanitizedActionsForLog(actions),
  });
  if (!name || !actions.length) return res.status(400).json({ error: "A scene name and at least one device action are required" });
  let canonicalActions: CanonicalSceneAction[];
  try {
    canonicalActions = await canonicalizeSceneActions(req, actions);
  } catch (err: any) {
    const payload = sceneActionErrorPayload(err);
    logger.warn("scene_create_rejected", {
      ...validationLogBase(req),
      ...payload,
    });
    return res.status(Number(err?.statusCode || 422)).json(payload);
  }
  const row = {
    ...activeScope(req),
    created_by: req.user!.id,
    name,
    description: String(req.body?.description || "").trim().slice(0, 240) || null,
    icon: String(req.body?.icon || "sparkles").slice(0, 32),
    mood: String(req.body?.mood || "").slice(0, 48),
    actions: canonicalActions,
    enabled: true,
  };
  const { data, error } = await supabaseAdmin.from("consumer_scenes").insert(row as any).select("*").single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user!, "scene.created", data.id, { action_count: actions.length }, req);
  logger.info("scene_create_completed", {
    ...validationLogBase(req),
    scene_id: data.id,
    action_count: canonicalActions.length,
  });
  res.status(201).json(data);
});


router.patch("/:id", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const name = req.body?.name == null ? undefined : String(req.body.name || "").trim().slice(0, 80);
  const actions = req.body?.actions == null ? undefined : cleanActions(req.body.actions);
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (name !== undefined) {
    if (!name) return res.status(400).json({ error: "Scene name is required" });
    updates.name = name;
  }
  if (req.body?.icon != null) updates.icon = String(req.body.icon || "sparkles").slice(0, 32);
  if (req.body?.description != null) updates.description = String(req.body.description || "").trim().slice(0, 240) || null;
  if (req.body?.mood != null) updates.mood = String(req.body.mood || "").slice(0, 48);
  if (actions !== undefined) {
    if (!actions.length) return res.status(400).json({ error: "At least one device action is required" });
    try {
      updates.actions = await canonicalizeSceneActions(req, actions);
    } catch (err: any) {
      return res.status(Number(err?.statusCode || 422)).json(sceneActionErrorPayload(err));
    }
  }
  const { data, error } = await scoped(supabaseAdmin.from("consumer_scenes").update(updates).eq("id", req.params.id).select("*") as any, req).single();
  if (error) return res.status(404).json({ error: error.message || "Scene not found" });
  await audit(req.user!, "scene.updated", data.id, { action_count: cleanActions(data.actions).length }, req);
  res.json(data);
});

router.delete("/:id", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const { data, error } = await scoped(supabaseAdmin.from("consumer_scenes").delete().eq("id", req.params.id).select("id") as any, req).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Scene not found" });
  await audit(req.user!, "scene.deleted", req.params.id, {}, req);
  res.json({ ok: true, id: req.params.id });
});

router.post("/:id/run", requirePermission("devices.control"), async (req, res) => {
  const { data: scene, error } = await scoped(supabaseAdmin.from("consumer_scenes").select("*").eq("id", req.params.id), req).maybeSingle();
  if (error || !scene) return res.status(404).json({ error: "Scene not found" });
  const actions = cleanActions(scene.actions);
  const requestedAt = new Date().toISOString();
  const runId = sceneRunId(req, String(scene.id));
  let canonicalActions: CanonicalSceneAction[] = [];
  try {
    canonicalActions = await canonicalizeSceneActions(req, actions);
  } catch (err: any) {
    const failed = {
      scene_run_id: runId,
      scene_id: scene.id,
      scene_name: scene.name,
      status: "failed",
      requested_at: requestedAt,
      completed_at: new Date().toISOString(),
      counts: { total: actions.length, completed: 0, failed: actions.length || 1 },
      actions: actions.map((action, index) => ({
        action_index: index,
        device_id: action.device_id,
        status: "denied",
        error: err?.message || "Scene action is not allowed.",
      })),
    };
    await audit(req.user!, "scene.run.failed", scene.id, { ...failed, domain: "resident_device_private" }, req);
    return res.status(Number(err?.statusCode || 422)).json({ ok: false, ...failed, ...sceneActionErrorPayload(err) });
  }

  await audit(req.user!, "scene.run.requested", scene.id, {
    scene_run_id: runId,
    scene_id: scene.id,
    action_count: canonicalActions.length,
    source: "manual",
    domain: "resident_device_private",
  }, req);

  const results = await executeResidentActionBatch({
    kind: "scene",
    actor: req.user!,
    req,
    runId,
    actions: canonicalActions,
    requestedAt,
    scope: { estateId: activeScope(req).estate_id, homeId: activeScope(req).home_id },
  });
  const completedAt = new Date().toISOString();
  const status = overallSceneStatus(results);
  const counts = sceneRunCounts(results);
  const response = {
    ok: status === "completed",
    scene_run_id: runId,
    scene_id: scene.id,
    scene_name: scene.name,
    status,
    requested_at: requestedAt,
    completed_at: completedAt,
    counts,
    actions: results,
  };
  await audit(req.user!, `scene.run.${status}`, scene.id, { ...response, domain: "resident_device_private" }, req);
  res.json(response);
});

router.get("/:id/runs", requirePermission("devices.read"), async (req, res) => {
  const { data: scene, error: sceneError } = await scoped(supabaseAdmin.from("consumer_scenes").select("id,name").eq("id", req.params.id), req).maybeSingle();
  if (sceneError || !scene) return res.status(404).json({ error: "Scene not found" });
  const { data, error } = await scoped(
    supabaseAdmin
      .from("audit_events")
      .select("action,resource_id,metadata,created_at")
      .eq("resource_type", "scene")
      .eq("resource_id", req.params.id)
      .in("action", ["scene.run.completed", "scene.run.partially_completed", "scene.run.failed"])
      .order("created_at", { ascending: false })
      .limit(20),
    req,
  );
  if (error) return res.status(500).json({ error: error.message });
  const runs = (data || []).map((row: any) => {
    const metadata = row?.metadata || {};
    return {
      scene_run_id: metadata.scene_run_id || null,
      scene_id: metadata.scene_id || row.resource_id,
      scene_name: metadata.scene_name || scene.name,
      status: metadata.status || String(row.action || "").replace("scene.run.", ""),
      requested_at: metadata.requested_at || row.created_at,
      completed_at: metadata.completed_at || row.created_at,
      counts: metadata.counts || { total: 0, completed: 0, failed: 0 },
      actions: Array.isArray(metadata.actions) ? metadata.actions.map((action: any) => ({
        device_id: action.device_id || null,
        device_name: action.device_name || "Device",
        action_label: action.action_label || "Scene action",
        status: action.status || "unknown",
        command_execution_id: action.command_execution_id || null,
      })) : [],
    };
  });
  res.json({ available: true, runs });
});

export async function executeConsumerAutomation(input: {
  automation: any;
  actor: AuthUser;
  req: any;
  source: "scheduled" | "manual_test";
  scheduledFor?: string | null;
  occurrenceKey?: string | null;
}) {
  const { automation, actor, req, source } = input;
  // Shared entry point for both the scheduler (claimAndRunAutomation) and
  // POST /automations/:id/test — checked here too, not only in the
  // scheduler's claim path, so a disabled surface can never execute
  // regardless of which caller reaches this function.
  const surface: AutomationSurface = AUTOMATION_SURFACES.includes(automation.surface) ? automation.surface : "consumer";
  if (!isAutomationSurfaceEnabled(surface)) {
    throw Object.assign(new Error(`The ${surface} automation surface is not yet enabled.`), { statusCode: 403, code: "automation_surface_disabled" });
  }
  const requestedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  const scheduledFor = input.scheduledFor || requestedAt;
  const triggerType = String(automation?.trigger?.type || "schedule");
  const occurrenceKey = automationOccurrenceKey(String(automation.id), scheduledFor, source, input.occurrenceKey || String(req.headers?.["idempotency-key"] || ""));
  const existing = await supabaseAdmin
    .from("consumer_automation_runs")
    .select("*")
    .eq("automation_id", automation.id)
    .eq("trigger_occurrence_key", occurrenceKey)
    .maybeSingle();
  if (existing.data?.id) {
    logger.info("automation_run_duplicate_suppressed", {
      automation_id: automation.id,
      automation_run_id: existing.data.id,
      trigger_occurrence_key: occurrenceKey,
      source,
    });
    return existing.data;
  }

  const runRow = {
    id: runId,
    automation_id: automation.id,
    estate_id: automation.estate_id || null,
    home_id: automation.home_id || null,
    // consumer_automation_runs.created_by is a uuid FK to users(id).
    // automation.created_by is always a real uuid for consumer/facility
    // (residents and facility staff both have real Backend users), but
    // office automations have no per-user identity — actor.id there is
    // the synthetic "office_automation_runtime" string, not a uuid, and
    // would fail this insert with an invalid-uuid error. Only fall back
    // to actor.id when it's actually a uuid; otherwise leave it null,
    // which the FK already permits (ON DELETE SET NULL). Found via
    // Shared Automation Runtime PR 3 production verification.
    created_by: automation.created_by || (isUuid(actor.id) ? actor.id : null),
    trigger_type: triggerType,
    trigger_occurrence_key: occurrenceKey,
    source,
    status: "running",
    scheduled_for: scheduledFor,
    started_at: requestedAt,
    counts: { total: 0, completed: 0, failed: 0 },
    actions: [],
  };
  const inserted = await supabaseAdmin.from("consumer_automation_runs").insert(runRow as any).select("*").single();
  if (inserted.error) {
    if (/duplicate|unique/i.test(inserted.error.message || "")) {
      const { data } = await supabaseAdmin
        .from("consumer_automation_runs")
        .select("*")
        .eq("automation_id", automation.id)
        .eq("trigger_occurrence_key", occurrenceKey)
        .maybeSingle();
      if (data) return data;
    }
    throw inserted.error;
  }

  logger.info("automation_run_created", {
    automation_id: automation.id,
    automation_run_id: runId,
    trigger_occurrence_key: occurrenceKey,
    trigger_type: triggerType,
    source,
    scheduled_for: scheduledFor,
    surface: automation.surface || "consumer",
  });

  // Shared Automation Runtime — an automation's actions are homogeneous:
  // every item is device_command, registered_action (PR 2, Facility),
  // or workflow_action (PR 3, Office). Mixed arrays are rejected at
  // creation time (see the create/update routes below), so this check
  // is a dispatch choice, not a validation gate.
  const rawActions = Array.isArray(automation.actions) ? automation.actions : [];
  const isRegisteredActionAutomation = rawActions.length > 0 && rawActions.every(isRegisteredActionItem);
  const isWorkflowActionAutomation = rawActions.length > 0 && rawActions.every(isWorkflowActionItem);
  const isCommunicationActionAutomation = rawActions.length > 0 && rawActions.every(isCommunicationActionItem);

  let results: any[];
  if (isRegisteredActionAutomation) {
    const registeredActions = cleanRegisteredActions(automation.actions);
    const validation = validateRegisteredActions(registeredActions);
    if (!validation.ok) {
      const completedAt = new Date().toISOString();
      const failedActions = registeredActions.map((action, index) => ({
        action_index: index,
        registered_action_id: action.action_id,
        entity_id: action.entity_id,
        status: "skipped",
        error: validation.error,
      }));
      const failed = {
        status: "failed",
        completed_at: completedAt,
        counts: { total: registeredActions.length, completed: 0, failed: registeredActions.length || 1 },
        actions: failedActions,
        error_code: validation.code,
        error_message: validation.error,
      };
      await supabaseAdmin.from("consumer_automation_runs").update(failed as any).eq("id", runId);
      await supabaseAdmin.from("consumer_automations").update({ last_run_at: completedAt, last_run_status: "failed" }).eq("id", automation.id);
      logger.warn("automation_run_failed", { automation_id: automation.id, automation_run_id: runId, reason: failed.error_code, surface: automation.surface || "consumer" });
      return { ...runRow, ...failed };
    }
    results = await executeRegisteredActionBatch({
      actor,
      runId,
      actions: registeredActions.map((action) => ({ ...action, action_label: action.label || action.action_id })) as RegisteredCanonicalAction[],
      requestedAt,
    });
  } else if (isWorkflowActionAutomation) {
    const workflowActions = cleanWorkflowActions(automation.actions);
    const validation = validateWorkflowActions(workflowActions);
    if (!validation.ok) {
      const completedAt = new Date().toISOString();
      const failedActions = workflowActions.map((action, index) => ({
        action_index: index,
        operation: action.operation,
        workflow_type: action.workflow_type,
        workflow_id: action.workflow_id,
        status: "skipped",
        error: validation.error,
      }));
      const failed = {
        status: "failed",
        completed_at: completedAt,
        counts: { total: workflowActions.length, completed: 0, failed: workflowActions.length || 1 },
        actions: failedActions,
        error_code: validation.code,
        error_message: validation.error,
      };
      await supabaseAdmin.from("consumer_automation_runs").update(failed as any).eq("id", runId);
      await supabaseAdmin.from("consumer_automations").update({ last_run_at: completedAt, last_run_status: "failed" }).eq("id", automation.id);
      logger.warn("automation_run_failed", { automation_id: automation.id, automation_run_id: runId, reason: failed.error_code, surface: automation.surface || "consumer" });
      return { ...runRow, ...failed };
    }
    results = await executeWorkflowActionBatch({
      actor,
      runId,
      actions: workflowActions as WorkflowCanonicalAction[],
      requestedAt,
      scope: { estateId: automation.estate_id, homeId: automation.home_id },
    });
  } else if (isCommunicationActionAutomation) {
    const communicationActions = cleanCommunicationActions(automation.actions);
    const validation = validateCommunicationActions(communicationActions);
    if (!validation.ok) {
      const completedAt = new Date().toISOString();
      const failedActions = communicationActions.map((action, index) => ({
        action_index: index,
        channel: action.channel,
        recipient: action.recipient_email || action.recipient_phone || null,
        status: "skipped",
        error: validation.error,
      }));
      const failed = {
        status: "failed",
        completed_at: completedAt,
        counts: { total: communicationActions.length, completed: 0, failed: communicationActions.length || 1 },
        actions: failedActions,
        error_code: validation.code,
        error_message: validation.error,
      };
      await supabaseAdmin.from("consumer_automation_runs").update(failed as any).eq("id", runId);
      await supabaseAdmin.from("consumer_automations").update({ last_run_at: completedAt, last_run_status: "failed" }).eq("id", automation.id);
      logger.warn("automation_run_failed", { automation_id: automation.id, automation_run_id: runId, reason: failed.error_code, surface: automation.surface || "consumer" });
      return { ...runRow, ...failed };
    }
    results = await executeCommunicationActionBatch({
      actor,
      runId,
      actions: communicationActions,
      requestedAt,
    });
  } else {
    const actions = cleanActions(automation.actions);
    let canonicalActions: CanonicalSceneAction[] = [];
    try {
      canonicalActions = await canonicalizeSceneActions(req, actions);
    } catch (err: any) {
      const completedAt = new Date().toISOString();
      const failedActions = actions.map((action, index) => ({
        action_index: index,
        device_id: action.device_id,
        canonical_device_id: action.device_id,
        status: "skipped",
        error: err?.message || "Automation action is not allowed.",
      }));
      const failed = {
        status: "failed",
        completed_at: completedAt,
        counts: { total: actions.length, completed: 0, failed: actions.length || 1 },
        actions: failedActions,
        error_code: err?.code || "automation_action_invalid",
        error_message: err?.message || "Automation action is not allowed.",
      };
      await supabaseAdmin.from("consumer_automation_runs").update(failed as any).eq("id", runId);
      await supabaseAdmin.from("consumer_automations").update({ last_run_at: completedAt, last_run_status: "failed" }).eq("id", automation.id);
      logger.warn("automation_run_failed", { automation_id: automation.id, automation_run_id: runId, reason: failed.error_code, surface: automation.surface || "consumer" });
      return { ...runRow, ...failed };
    }

    results = await executeResidentActionBatch({
      kind: "automation",
      actor,
      req,
      runId,
      actions: canonicalActions,
      requestedAt,
      scope: { estateId: automation.estate_id, homeId: automation.home_id },
    });
  }
  const completedAt = new Date().toISOString();
  const status = residentBatchStatus(results, "automation");
  const counts = residentBatchCounts(results);
  const completed = {
    status,
    completed_at: completedAt,
    counts,
    actions: results,
    error_code: null,
    error_message: null,
  };
  await supabaseAdmin.from("consumer_automation_runs").update(completed as any).eq("id", runId);
  await supabaseAdmin.from("consumer_automations").update({ last_run_at: completedAt, last_run_status: status }).eq("id", automation.id);
  await audit(actor, `automation.run.${status}`, automation.id, { ...completed, automation_run_id: runId, source, domain: "resident_device_private", surface: automation.surface || "consumer" }, req);
  logger.info("automation_run_completed", {
    automation_id: automation.id,
    automation_run_id: runId,
    trigger_occurrence_key: occurrenceKey,
    source,
    status,
    surface: automation.surface || "consumer",
  });
  return { ...runRow, ...completed };
}

let automationScheduler: NodeJS.Timeout | null = null;
let automationSchedulerRunning = false;

export function startAutomationRuntimeV2Scheduler() {
  if (automationScheduler) return;
  logger.info("automation_scheduler_started", { tick_ms: 30_000 });
  automationScheduler = setInterval(() => {
    void automationSchedulerTick();
  }, 30_000);
  automationScheduler.unref?.();
  void automationSchedulerTick();
}

export function stopAutomationRuntimeV2Scheduler() {
  if (automationScheduler) clearInterval(automationScheduler);
  automationScheduler = null;
}

async function automationSchedulerTick() {
  if (automationSchedulerRunning) return;
  automationSchedulerRunning = true;
  const started = Date.now();
  try {
    const nowIso = new Date().toISOString();
    const surfaces = enabledAutomationSurfaces();
    const { data, error } = await supabaseAdmin
      .from("consumer_automations")
      .select("*")
      .eq("enabled", true)
      .not("next_run_at", "is", null)
      .lte("next_run_at", nowIso)
      .in("surface", surfaces)
      .order("next_run_at", { ascending: true })
      .limit(10);
    if (error) throw error;
    logger.info("automation_scheduler_tick", { due: data?.length || 0, duration_ms: Date.now() - started, enabled_surfaces: surfaces });
    for (const automation of data || []) {
      void claimAndRunAutomation(automation).catch((runError) => logger.error("automation_run_failed", { error: runError, automation_id: automation?.id, source: "scheduled" }));
    }
  } catch (error) {
    logger.error("automation_scheduler_tick_failed", { error });
  } finally {
    automationSchedulerRunning = false;
  }
}

async function claimAndRunAutomation(automation: any) {
  // Defense in depth: automationSchedulerTick() already filters the due-scan
  // by enabledAutomationSurfaces(), so this branch is unreachable in
  // production while a surface's flag is off. Kept here too so this
  // function stays safe to call directly (tests, a future manual-run path)
  // without relying solely on the caller having filtered correctly.
  const surface: AutomationSurface = AUTOMATION_SURFACES.includes(automation.surface) ? automation.surface : "consumer";
  if (!isAutomationSurfaceEnabled(surface)) {
    logger.info("automation_run_skipped", { automation_id: automation.id, reason: "surface_disabled", surface });
    return;
  }
  const triggerResult = validateAutomationTrigger(automation.trigger);
  if (!triggerResult.ok) {
    await supabaseAdmin.from("consumer_automations").update({ last_run_status: "skipped", enabled: false, next_run_at: null }).eq("id", automation.id);
    logger.warn("automation_run_skipped", { automation_id: automation.id, reason: triggerResult.code });
    return;
  }
  const scheduledFor = String(automation.next_run_at || new Date().toISOString());
  const occurrenceKey = automationOccurrenceKey(String(automation.id), scheduledFor, "scheduled");
  logger.info("automation_trigger_due", {
    automation_id: automation.id,
    trigger_occurrence_key: occurrenceKey,
    trigger_type: triggerResult.trigger.schedule_type,
    scheduled_for: scheduledFor,
  });
  const next = triggerResult.trigger.schedule_type === "once" ? null : nextAutomationRunAt(triggerResult.trigger, new Date(new Date(scheduledFor).getTime() + 1000));
  const claim = await supabaseAdmin
    .from("consumer_automations")
    .update({
      next_run_at: next ? next.toISOString() : null,
      enabled: triggerResult.trigger.schedule_type === "once" ? false : automation.enabled,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", automation.id)
    .eq("next_run_at", scheduledFor)
    .select("*")
    .maybeSingle();
  if (!claim.data) {
    logger.info("automation_run_duplicate_suppressed", { automation_id: automation.id, trigger_occurrence_key: occurrenceKey, reason: "claim_lost" });
    return;
  }
  logger.info("automation_next_run_calculated", {
    automation_id: automation.id,
    trigger_occurrence_key: occurrenceKey,
    next_run_at: next ? next.toISOString() : null,
  });
  // consumer + facility automations are always created by a real Backend
  // user (resident or facility staff both have real `users` rows), so
  // actor resolution is unchanged for them. office is the one surface
  // with no per-user Backend identity — see officeAutomationActor above.
  let actor: AuthUser | null = null;
  if (surface === "office") {
    actor = officeAutomationActor(automation);
  } else {
    const { data } = await supabaseAdmin.from("users").select("*").eq("id", automation.created_by).maybeSingle();
    actor = (data as AuthUser) || null;
  }
  if (!actor?.id) {
    logger.warn("automation_run_skipped", { automation_id: automation.id, trigger_occurrence_key: occurrenceKey, reason: "creator_unavailable", surface });
    return;
  }
  const req = {
    user: actor,
    headers: {},
    body: { source: "automation" },
    oisContext: { estate_id: automation.estate_id, home_id: automation.home_id },
  };
  await executeConsumerAutomation({ automation: claim.data, actor, req, source: "scheduled", scheduledFor, occurrenceKey });
}

// Automation Workspace UI/UX completion -- scoped(req) only filters by
// estate_id/home_id, never by surface. A Facility-staff caller typically
// has an estate_id but no home_id, so the home_id clause never applies to
// them -- without this filter they would receive every automation in the
// estate, including residents' own personal consumer-surface automations
// (a real, pre-existing cross-surface exposure, not one this pass
// introduces). Optional and additive: omitting ?surface= preserves the
// exact prior behavior for any existing caller.
router.get("/automations", requirePermission("devices.read"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  let query = scoped(supabaseAdmin.from("consumer_automations").select("*"), req);
  const surfaceFilter = String(req.query?.surface || "");
  if (AUTOMATION_SURFACES.includes(surfaceFilter as AutomationSurface)) query = query.eq("surface", surfaceFilter);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return res.json({ available: false, automations: [], error: error.message });
  res.json({ available: true, automations: data || [] });
});

router.post("/automations", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const surface: AutomationSurface = AUTOMATION_SURFACES.includes(req.body?.surface) ? req.body.surface : "consumer";
  if (!isAutomationSurfaceEnabled(surface)) {
    return res.status(403).json({ error: `The ${surface} automation surface is not yet enabled.`, code: "automation_surface_disabled" });
  }
  const name = String(req.body?.name || "").trim().slice(0, 80);
  const triggerResult = validateAutomationTrigger(req.body?.trigger);
  if (!triggerResult.ok) return res.status(422).json({ error: triggerResult.error, code: triggerResult.code });
  const trigger = triggerResult.trigger;
  const condition = req.body?.condition && typeof req.body.condition === "object" ? req.body.condition : {};
  const rawActions = Array.isArray(req.body?.actions) ? req.body.actions : [];
  const requestedRegisteredActions = rawActions.length > 0 && rawActions.every(isRegisteredActionItem);
  const requestedWorkflowActions = rawActions.length > 0 && rawActions.every(isWorkflowActionItem);
  const requestedCommunicationActions = rawActions.length > 0 && rawActions.every(isCommunicationActionItem);
  if (requestedRegisteredActions && surface !== "facility") {
    return res.status(422).json({ error: "Registered actions (visitor/maintenance) are currently only supported on the facility surface.", code: "registered_action_surface_mismatch" });
  }
  if (requestedWorkflowActions && surface !== "office") {
    return res.status(422).json({ error: "Workflow actions are currently only supported on the office surface.", code: "workflow_action_surface_mismatch" });
  }
  if (requestedCommunicationActions && surface !== "office") {
    return res.status(422).json({ error: "Communication actions are currently only supported on the office surface.", code: "communication_action_surface_mismatch" });
  }
  let finalActions: any[];
  let actionCount: number;
  if (requestedRegisteredActions) {
    const registeredActions = cleanRegisteredActions(rawActions);
    const validation = validateRegisteredActions(registeredActions);
    if (!validation.ok) return res.status(422).json({ error: validation.error, code: validation.code });
    finalActions = registeredActions.map((action) => ({ action_type: "registered_action", ...action }));
    actionCount = registeredActions.length;
  } else if (requestedWorkflowActions) {
    const workflowActions = cleanWorkflowActions(rawActions);
    const validation = validateWorkflowActions(workflowActions);
    if (!validation.ok) return res.status(422).json({ error: validation.error, code: validation.code });
    finalActions = workflowActions.map((action) => ({ action_type: "workflow_action", ...action }));
    actionCount = workflowActions.length;
  } else if (requestedCommunicationActions) {
    const communicationActions = cleanCommunicationActions(rawActions);
    const validation = validateCommunicationActions(communicationActions);
    if (!validation.ok) return res.status(422).json({ error: validation.error, code: validation.code });
    finalActions = communicationActions.map((action) => ({ action_type: "communication_action", ...action }));
    actionCount = communicationActions.length;
  } else {
    const actions = cleanActions(rawActions);
    if (!name || !trigger || !actions.length) return res.status(400).json({ error: "A name, trigger, and at least one device action are required" });
    try {
      finalActions = await canonicalizeSceneActions(req, actions);
    } catch (err: any) {
      return res.status(Number(err?.statusCode || 422)).json({ error: err?.message || "Automation contains an unavailable or unsafe device action", code: err?.code || "automation_action_invalid" });
    }
    actionCount = actions.length;
  }
  if (!name || !trigger) return res.status(400).json({ error: "A name and trigger are required" });
  const nextRun = req.body?.enabled === false ? null : nextAutomationRunAt(trigger);
  const row = {
    ...activeScope(req),
    created_by: req.user!.id,
    name,
    surface,
    trigger,
    condition,
    actions: finalActions,
    enabled: req.body?.enabled !== false,
    timezone: trigger.timezone,
    schedule_version: 1,
    next_run_at: nextRun ? nextRun.toISOString() : null,
  };
  const { data, error } = await supabaseAdmin.from("consumer_automations").insert(row as any).select("*").single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user!, "automation.created", data.id, { action_count: actionCount, surface }, req);
  res.status(201).json(data);
});

router.patch("/automations/:id", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (req.body?.surface != null) {
    if (!AUTOMATION_SURFACES.includes(req.body.surface)) return res.status(422).json({ error: "Unsupported automation surface.", code: "invalid_automation_surface" });
    if (!isAutomationSurfaceEnabled(req.body.surface)) return res.status(403).json({ error: `The ${req.body.surface} automation surface is not yet enabled.`, code: "automation_surface_disabled" });
    updates.surface = req.body.surface;
  }
  if (req.body?.name != null) {
    const name = String(req.body.name || "").trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: "Automation name is required" });
    updates.name = name;
  }
  if (req.body?.enabled != null) updates.enabled = req.body.enabled === true;
  let validatedTrigger: ReturnType<typeof validateAutomationTrigger> | null = null;
  if (req.body?.trigger != null) {
    validatedTrigger = validateAutomationTrigger(req.body.trigger);
    if (!validatedTrigger.ok) return res.status(422).json({ error: validatedTrigger.error, code: validatedTrigger.code });
    updates.trigger = validatedTrigger.trigger;
    updates.timezone = validatedTrigger.trigger.timezone;
    updates.schedule_version = 1;
  }
  if (req.body?.condition != null) updates.condition = req.body.condition && typeof req.body.condition === "object" ? req.body.condition : {};
  const current = await scoped(supabaseAdmin.from("consumer_automations").select("*").eq("id", req.params.id), req).maybeSingle();
  if (!current.data) return res.status(404).json({ error: "Automation not found" });
  if (req.body?.actions != null) {
    const effectiveSurface: AutomationSurface = updates.surface || current.data.surface || "consumer";
    const rawActions = Array.isArray(req.body.actions) ? req.body.actions : [];
    const requestedRegisteredActions = rawActions.length > 0 && rawActions.every(isRegisteredActionItem);
    const requestedWorkflowActions = rawActions.length > 0 && rawActions.every(isWorkflowActionItem);
    const requestedCommunicationActions = rawActions.length > 0 && rawActions.every(isCommunicationActionItem);
    if (requestedRegisteredActions && effectiveSurface !== "facility") {
      return res.status(422).json({ error: "Registered actions (visitor/maintenance) are currently only supported on the facility surface.", code: "registered_action_surface_mismatch" });
    }
    if (requestedWorkflowActions && effectiveSurface !== "office") {
      return res.status(422).json({ error: "Workflow actions are currently only supported on the office surface.", code: "workflow_action_surface_mismatch" });
    }
    if (requestedCommunicationActions && effectiveSurface !== "office") {
      return res.status(422).json({ error: "Communication actions are currently only supported on the office surface.", code: "communication_action_surface_mismatch" });
    }
    if (requestedRegisteredActions) {
      const registeredActions = cleanRegisteredActions(rawActions);
      const validation = validateRegisteredActions(registeredActions);
      if (!validation.ok) return res.status(422).json({ error: validation.error, code: validation.code });
      updates.actions = registeredActions.map((action) => ({ action_type: "registered_action", ...action }));
    } else if (requestedWorkflowActions) {
      const workflowActions = cleanWorkflowActions(rawActions);
      const validation = validateWorkflowActions(workflowActions);
      if (!validation.ok) return res.status(422).json({ error: validation.error, code: validation.code });
      updates.actions = workflowActions.map((action) => ({ action_type: "workflow_action", ...action }));
    } else if (requestedCommunicationActions) {
      const communicationActions = cleanCommunicationActions(rawActions);
      const validation = validateCommunicationActions(communicationActions);
      if (!validation.ok) return res.status(422).json({ error: validation.error, code: validation.code });
      updates.actions = communicationActions.map((action) => ({ action_type: "communication_action", ...action }));
    } else {
      const actions = cleanActions(rawActions);
      if (!actions.length) return res.status(400).json({ error: "At least one device action is required" });
      try {
        updates.actions = await canonicalizeSceneActions(req, actions);
      } catch (err: any) {
        return res.status(Number(err?.statusCode || 422)).json({ error: err?.message || "Automation contains an unavailable or unsafe device action", code: err?.code || "automation_action_invalid" });
      }
    }
  }
  const triggerForNext = validatedTrigger || validateAutomationTrigger(current.data.trigger);
  const enabledForNext = updates.enabled == null ? current.data.enabled !== false : updates.enabled === true;
  updates.next_run_at = enabledForNext && triggerForNext.ok ? nextAutomationRunAt(triggerForNext.trigger)?.toISOString() || null : null;
  const { data, error } = await scoped(supabaseAdmin.from("consumer_automations").update(updates).eq("id", req.params.id).select("*") as any, req).single();
  if (error) return res.status(404).json({ error: error.message || "Automation not found" });
  await audit(req.user!, updates.enabled === false ? "automation.paused" : "automation.updated", data.id, { enabled: data.enabled }, req);
  res.json(data);
});

router.delete("/automations/:id", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const { data, error } = await scoped(supabaseAdmin.from("consumer_automations").delete().eq("id", req.params.id).select("id") as any, req).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Automation not found" });
  await audit(req.user!, "automation.deleted", req.params.id, {}, req);
  res.json({ ok: true, id: req.params.id });
});

router.post("/automations/:id/test", requirePermission("devices.control"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const { data: automation, error } = await scoped(supabaseAdmin.from("consumer_automations").select("*").eq("id", req.params.id), req).maybeSingle();
  if (error || !automation) return res.status(404).json({ error: "Automation not found" });
  try {
    const result = await executeConsumerAutomation({ automation, actor: req.user!, req, source: "manual_test" });
    return res.json({
      ok: ["succeeded", "partially_succeeded"].includes(String(result.status)),
      automation_run_id: result.id,
      scene_run_id: result.id,
      scene_id: automation.id,
      scene_name: automation.name,
      status: result.status,
      requested_at: result.started_at,
      completed_at: result.completed_at,
      counts: result.counts || { total: 0, completed: 0, failed: 0 },
      actions: result.actions || [],
      source: "manual_test",
    });
  } catch (runError: any) {
    logger.error("automation_run_failed", { error: runError, automation_id: req.params.id, source: "manual_test" });
    return res.status(500).json({ error: "Automation test could not run.", code: "automation_test_failed" });
  }
});

router.get("/automations/:id/runs", requirePermission("devices.read"), async (req, res) => {
  if (!hasWatchScope(req.user!)) return res.status(403).json({ error: "Home or estate context required" });
  const { data: automation, error: automationError } = await scoped(supabaseAdmin.from("consumer_automations").select("id,name").eq("id", req.params.id), req).maybeSingle();
  if (automationError || !automation) return res.status(404).json({ error: "Automation not found" });
  const { data, error } = await scoped(
    supabaseAdmin
      .from("consumer_automation_runs")
      .select("*")
      .eq("automation_id", req.params.id)
      .order("created_at", { ascending: false })
      .limit(20),
    req,
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ available: true, runs: data || [] });
});

export default router;
