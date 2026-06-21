import type { AuthUser } from "../middleware/auth";

/** Request scope is advisory only; persisted authenticated context is authoritative. */
export function authenticatedActorScope(actor: Pick<AuthUser, "estate_id" | "home_id">) {
  return {
    estate_id: actor.estate_id || null,
    home_id: actor.home_id || null,
  };
}
