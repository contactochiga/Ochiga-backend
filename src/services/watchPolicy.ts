import { hasPermission } from "../core/foundation/permissions";
import type { AuthUser } from "../middleware/auth";

type ScopedDevice = {
  estate_id?: string | null;
  home_id?: string | null;
};

export function hasWatchScope(actor: AuthUser): boolean {
  return Boolean(actor.home_id || actor.estate_id);
}

export function canReadWatch(actor: AuthUser): boolean {
  return hasWatchScope(actor) && hasPermission(actor, "devices.read");
}

export function canControlWatch(actor: AuthUser): boolean {
  return hasWatchScope(actor) && hasPermission(actor, "devices.control");
}

export function deviceWithinActorScope(actor: AuthUser, device: ScopedDevice): boolean {
  if (!hasWatchScope(actor)) return false;
  if (actor.estate_id && device.estate_id !== actor.estate_id) return false;
  // Some integrations initially create estate-scoped devices before room/home assignment.
  // Allow those for residents in the same estate, but deny explicit cross-home devices.
  if (!actor.estate_id && actor.home_id && !device.home_id) return false;
  if (actor.home_id && device.home_id && device.home_id !== actor.home_id) return false;
  return true;
}
