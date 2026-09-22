import { Signal } from "../contracts/signal.types";
import { Intent } from "../contracts/intent.types";

// Wave 5D -- RETIRED. This function's device-authority-enforcement body
// (the two role/deviceScope throw checks) is deliberately gutted, for
// two independent reasons:
//
// 1. Duplicate + weaker authority. It duplicated canonical
//    DeviceCommandAuthority.authorizeDeviceCommand()'s devices.power.control
//    check using a cruder, client-self-asserted `deviceScope` string
//    instead of the real resolved device's own estate/home scope, and it
//    had no capability-rollout awareness at all (disabling
//    devices.power.control never stopped this function from passing).
// 2. Already functionally inert. evaluateSignal() (decisionEngine.ts)
//    runs every policy, including this one, inside its own try/catch and
//    SWALLOWS a thrown error -- it does not stop deviceCommandPolicy
//    (which runs later in the same policy array) from still producing
//    and enqueuing a real DeviceCommandIntent. So even before this
//    change, a thrown denial here never actually prevented physical
//    dispatch; it only produced a console.error.
//
// Canonical authority now lives entirely in intentWorker.ts's
// handleDeviceIntent, which calls authorizeDeviceCommand() before
// executeDeviceCommandForActor(), using devices.power.control against
// the real resolved device's scope -- the same capability every other
// converged physical-command entrance in Oyi already runs through.
//
// This function stays wired into decisionEngine.ts's policy array
// (removing it there is a larger, unnecessary diff for a no-op) but now
// performs no device-authority responsibility. It never produced any
// Intent of its own (device.command.requested intents come from
// deviceCommandPolicy, not this one), so returning [] here changes no
// enqueue behavior.
export function devicePermissionPolicy(_signal: Signal): Intent[] {
  return [];
}
