// Oyi Intelligence Convergence, Wave 4 (Action & Execution Convergence)
// -- explicit authority gate for requestDeviceCommand()
// (src/controllers/deviceCommandController.ts), the direct HTTP
// device-command bypass identified by the Wave 4 execution-path audit.
//
// Reuses the SAME production capability ("devices.power.control") and the
// SAME capabilityService.canUse() authority decision every canonical
// device action path already runs through (ConversationOrchestrator's
// device confirm-turn; Spatial Mode's initiateSpatialDeviceAction in
// SpatialDeviceActionService.ts) -- not a new, competing authority
// system. This module owns NO device resolution, execution or
// verification: requestDeviceCommand's own resolveCommandTarget /
// executeDeviceCommandForActor machinery (idempotency cache, IR
// ack-only lane, background async execution, the existing
// device_command_executions durable record) is untouched by this
// change. See the Wave 4 report for why the full OyiWorkflow/OyiAction
// wrap of this specific endpoint is deferred to a follow-up slice
// (async-202 timing + IR lane semantics + the existing durable
// device_command_executions record all need to be preserved exactly,
// and are safer to converge in a dedicated slice than bundled into the
// authority fix).
import type { AuthUser } from "../../middleware/auth";
import type { OyiSurface } from "../../services/oyiUnifiedIntelligenceService";
import { capabilityService } from "../capabilities/CapabilityService";
import { capabilityRegistry } from "../capabilities/CapabilityRegistry";
import { buildDeviceActionCapabilities } from "../capabilities/DeviceActionCapabilityModules";

export const DEVICE_COMMAND_CAPABILITY_KEY = "devices.power.control";

// The device capability module is registered lazily and idempotently by
// several independent call sites already (ConversationOrchestrator's
// ensureRegistered(), SpatialDeviceActionService's
// ensureDeviceCapabilityRegistered()) -- this follows the same
// established pattern rather than centralizing it, since each caller
// re-checks capabilityRegistry.get() before registering and registration
// itself is a pure, idempotent operation.
let registered = false;
function ensureDeviceCapabilityRegistered() {
  if (registered) return;
  if (!capabilityRegistry.get(DEVICE_COMMAND_CAPABILITY_KEY)) {
    for (const capability of buildDeviceActionCapabilities()) capabilityRegistry.register(capability);
  }
  registered = true;
}

export type DeviceCommandAuthorityInput = {
  actor: AuthUser;
  commandSource: string;
  estateId: string | null;
  homeId: string | null;
  roomId: string | null;
};

export type DeviceCommandAuthorityResult = {
  allowed: boolean;
  reason: string | null;
  required_permissions: string[];
};

// requestDeviceCommand is reached from 3 route mount points (the
// consumer-app device route, the facility operator console route, and
// the /signals convenience alias -- which itself defaults to
// source: "consumer-ui"). devices.power.control only distinguishes
// "consumer" and "facility" surfaces (supported_surfaces in
// DeviceActionCapabilityModules.ts), so this reuses the EXISTING
// commandSourceFor() classification (explicit body source, or a
// facility/operator/admin/security/maintenance actor role) rather than
// re-deriving surface from which route matched -- the same mapping
// already established in src/ai/commandRouter.ts
// (source: args.__oyi_surface === "facility" ? "facility" : "app").
//
// Wave 4B Slice 1 -- "office_automation" added as a third recognized
// commandSource (executeConsumerAutomation's Office device-command
// authority gate, scenes.ts). It maps to the existing "facility"
// surface rather than a new one: an Office-triggered automation is
// operationally non-consumer/non-resident, and devices.power.control's
// supported_surfaces already covers "facility" -- no new surface value,
// no second devices.power.control registration.
export function authorizeDeviceCommand(input: DeviceCommandAuthorityInput): DeviceCommandAuthorityResult {
  ensureDeviceCapabilityRegistered();
  const surface: OyiSurface = input.commandSource === "facility" || input.commandSource === "office_automation" ? "facility" : "consumer";
  const authority = capabilityService.canUse(DEVICE_COMMAND_CAPABILITY_KEY, {
    actor: input.actor,
    oisContext: null,
    surface,
    scope: { estate_id: input.estateId, building_id: null, home_id: input.homeId, room_id: input.roomId },
  });
  return { allowed: authority.allowed, reason: authority.reason, required_permissions: authority.required_permissions };
}
