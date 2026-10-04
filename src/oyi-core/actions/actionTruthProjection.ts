// Oyi Interaction Layer, Slice 1 -- canonical action truth for the
// conversation response.
//
// The conversation response used to lose an action's real outcome: the
// capability response adapter reported every non-confirmation turn as
// execution.status "read_only" and dropped the action's canonical status,
// so a frontend could not tell "provider accepted" from "physically
// verified". This module projects ONE action into the existing
// `execution.action` slot (which persistence already stores per message)
// using only existing canonical vocabulary:
//   - status: OyiActionStatus, the ActionStateMachine lifecycle
//     (awaiting_confirmation ... confirmed = VERIFIED, unobservable, ...).
//   - truth: the device ledger's existing public projection
//     (commandPublicStatus in deviceCommandController -- the same fields the
//     device REST route already returns to the apps).
// Never exposed: raw provider payloads, external device ids, vendor,
// provider names/latency, command lifecycle internals, evidence, scope ids,
// safe_error text (the answer already carries the safe message).
import type { OyiAction, OyiActionStatus } from "../contracts/action";
import { OYI_ACTION_STATUSES } from "./ActionStateMachine";

export const PUBLIC_DEVICE_COMMAND_TRUTH_FIELDS = [
  "request_status",
  "dispatch_status",
  "provider_status",
  "confirmation_status",
  "physical_effect_status",
  "final_status",
  "truth_state",
] as const;

export type PublicDeviceCommandTruth = Partial<Record<(typeof PUBLIC_DEVICE_COMMAND_TRUTH_FIELDS)[number], string>> & { retryable?: boolean | null };

export type ConversationActionProjection = {
  action_id: string;
  status: OyiActionStatus;
  requested_operation: string | null;
  requested_state: boolean | null;
  target: { label: string | null };
  truth: PublicDeviceCommandTruth | null;
};

const TOKEN = /^[a-z][a-z0-9_]{0,63}$/;
const OPERATION = /^[a-z][a-z0-9_.]{0,63}$/;
const UUIDISH = /^[A-Za-z0-9_.:-]{1,128}$/;

function token(value: unknown): string | null {
  return typeof value === "string" && TOKEN.test(value) ? value : null;
}

export function publicDeviceCommandTruth(result: unknown): PublicDeviceCommandTruth | null {
  if (!result || typeof result !== "object") return null;
  const source = result as Record<string, unknown>;
  const truth: PublicDeviceCommandTruth = {};
  for (const field of PUBLIC_DEVICE_COMMAND_TRUTH_FIELDS) {
    const value = token(source[field]);
    if (value) truth[field] = value;
  }
  if (typeof source.retryable === "boolean") truth.retryable = source.retryable;
  return Object.keys(truth).length ? truth : null;
}

function requestedBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "on" || value === "true") return true;
  if (value === "off" || value === "false") return false;
  return null;
}

export function conversationActionProjection(action: Pick<OyiAction, "action_id" | "status" | "requested_operation" | "requested_state" | "target">, deviceResult?: unknown): ConversationActionProjection {
  return {
    action_id: action.action_id,
    status: action.status,
    requested_operation: typeof action.requested_operation === "string" && OPERATION.test(action.requested_operation) ? action.requested_operation : null,
    requested_state: requestedBoolean(action.requested_state),
    target: { label: typeof action.target?.label === "string" ? action.target.label.slice(0, 120) : null },
    truth: deviceResult === undefined ? null : publicDeviceCommandTruth(deviceResult),
  };
}

// Boundary whitelist used by the response adapter: whatever a capability
// put in metadata.action, only the projection's fields -- with canonical
// values -- can reach the response.
export function sanitizeConversationAction(raw: unknown): ConversationActionProjection | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const status = typeof value.status === "string" && (OYI_ACTION_STATUSES as string[]).includes(value.status) ? (value.status as OyiActionStatus) : null;
  const actionId = typeof value.action_id === "string" && UUIDISH.test(value.action_id) ? value.action_id : null;
  if (!status || !actionId) return null;
  const target = value.target && typeof value.target === "object" ? (value.target as Record<string, unknown>) : {};
  return {
    action_id: actionId,
    status,
    requested_operation: typeof value.requested_operation === "string" && OPERATION.test(value.requested_operation) ? value.requested_operation : null,
    requested_state: typeof value.requested_state === "boolean" ? value.requested_state : null,
    target: { label: typeof target.label === "string" ? target.label.slice(0, 120) : null },
    truth: value.truth ? publicDeviceCommandTruth(value.truth) : null,
  };
}
