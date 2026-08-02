import type { OyiActionStatus } from "../contracts/action";

const TERMINAL: OyiActionStatus[] = ["confirmed", "unobservable", "timed_out", "failed", "cancelled", "superseded", "provider_rejected"];

const ALLOWED: Record<OyiActionStatus, OyiActionStatus[]> = {
  draft: ["awaiting_confirmation", "cancelled", "superseded"],
  awaiting_confirmation: ["approved", "cancelled", "superseded"],
  approved: ["queued", "cancelled", "superseded"],
  queued: ["sent", "failed", "superseded"],
  sent: ["provider_accepted", "provider_rejected", "failed", "superseded"],
  provider_accepted: ["verifying", "unobservable", "failed", "superseded"],
  provider_rejected: [],
  verifying: ["confirmed", "timed_out", "failed", "unobservable"],
  confirmed: [],
  unobservable: [],
  timed_out: [],
  failed: [],
  cancelled: [],
  superseded: [],
};

export function isTerminalActionStatus(status: OyiActionStatus) {
  return TERMINAL.includes(status);
}

export function canTransitionAction(from: OyiActionStatus, to: OyiActionStatus) {
  return ALLOWED[from]?.includes(to) || false;
}

export function assertActionTransition(from: OyiActionStatus, to: OyiActionStatus) {
  if (!canTransitionAction(from, to)) {
    throw new Error(`Invalid action transition: ${from} -> ${to}`);
  }
}
