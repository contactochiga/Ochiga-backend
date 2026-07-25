import type { AuthUser } from "../middleware/auth";

function clean(value: any) {
  return String(value ?? "").trim();
}

const FACILITY_ROLES = /admin|estate_admin|manager|owner|operator|security|maintenance|facility/i;

export type DeviceProjectionSurface = "consumer" | "facility";

export function deviceOwnershipClass(device: any) {
  const explicit = clean(device?.ownership_class).toLowerCase();
  if (explicit) return explicit;
  if (device?.metadata?.oyi?.technical_visibility === "hidden_from_residents") return "hidden_technical";
  if (device?.provider_connection_id || device?.owner_user_id) return "resident_owned";
  if (device?.home_id) return "shared_home";
  return "building_managed";
}

export function isFacilityActor(actor: Partial<AuthUser> | null | undefined) {
  return FACILITY_ROLES.test(clean(actor?.role));
}

export function canConsumerViewDevice(device: any, actor: Partial<AuthUser>, activeHomeId?: string | null) {
  const homeId = clean(activeHomeId || actor?.home_id);
  if (!homeId || clean(device?.home_id) !== homeId) return false;
  const ownership = deviceOwnershipClass(device);
  if (ownership === "hidden_technical" || ownership === "facility_private") return false;
  const policy = device?.visibility_policy || {};
  if (policy?.consumer_visible === false) return false;
  return ["resident_owned", "shared_home", "resident_shared", "building_managed"].includes(ownership);
}

export function canConsumerControlDevice(device: any, actor: Partial<AuthUser>, activeHomeId?: string | null) {
  if (!canConsumerViewDevice(device, actor, activeHomeId)) return false;
  const policy = device?.control_policy || {};
  if (policy?.resident_control_enabled === false || policy?.consumer_control_enabled === false) return false;
  const ownership = deviceOwnershipClass(device);
  if (ownership === "building_managed" && policy?.consumer_control_enabled !== true) return false;
  return true;
}

export function canFacilityViewDevice(device: any, actor: Partial<AuthUser>) {
  if (!isFacilityActor(actor)) return false;
  if (actor?.estate_id && clean(device?.estate_id) !== clean(actor.estate_id)) return false;
  const ownership = deviceOwnershipClass(device);
  const policy = device?.visibility_policy || {};
  if (ownership === "resident_owned" && policy?.facility_visible !== true) return false;
  return ownership !== "hidden_technical" || policy?.facility_diagnostics === true;
}

export function canFacilityControlDevice(device: any, actor: Partial<AuthUser>) {
  if (!canFacilityViewDevice(device, actor)) return false;
  const policy = device?.control_policy || {};
  if (policy?.facility_control_enabled === false) return false;
  return deviceOwnershipClass(device) !== "resident_owned" || policy?.facility_control_enabled === true;
}

export function projectDeviceForSurface(device: any, input: { actor?: Partial<AuthUser>; surface: DeviceProjectionSurface; activeHomeId?: string | null }) {
  const ownership = deviceOwnershipClass(device);
  const canView = input.surface === "consumer"
    ? canConsumerViewDevice(device, input.actor || {}, input.activeHomeId)
    : canFacilityViewDevice(device, input.actor || {});
  const canControl = input.surface === "consumer"
    ? canConsumerControlDevice(device, input.actor || {}, input.activeHomeId)
    : canFacilityControlDevice(device, input.actor || {});

  return {
    ...device,
    ownership_class: ownership,
    assignment_scope: device?.assignment_scope || (device?.home_id ? "home" : "estate"),
    commissioning_status: device?.commissioning_status || (device?.home_id ? "assigned" : "discovered"),
    projection: {
      surface: input.surface,
      visible: canView,
      controllable: canControl,
      ownership_class: ownership,
      assignment_scope: device?.assignment_scope || (device?.home_id ? "home" : "estate"),
      provider_connection_id: device?.provider_connection_id || null,
    },
  };
}
