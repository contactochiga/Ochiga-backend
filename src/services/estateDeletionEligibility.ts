import { supabaseAdmin } from "../supabase/supabaseClient";

// Office -> Facility provisioning lifecycle -- governed Portfolio delete
// (requirement: "block Delete and return a clear reason" for any Facility
// with real operational dependencies). This only ever answers "is it safe
// to remove this never-activated deployment attempt", never performs the
// deletion itself.
//
// estate_memberships is the primary gate: every activation path (new-user
// and existing-user) upserts a membership row in the same transaction that
// sets users.estate_id (estateOwnerInviteActivationService.ts /
// activate_estate_owner_invite RPC). So zero memberships means nobody has
// ever activated this estate, which in turn means every table below that
// requires an authenticated Facility session to populate (homes,
// buildings, devices, maintenance, automations, incidents) should also be
// empty. The other checks are still queried explicitly rather than relying
// on that inference alone, both to give a precise/honest blocking reason
// and because `users.estate_id` carries a NO ACTION foreign key back to
// estates -- a stray row there would otherwise surface as a raw
// constraint-violation error instead of a clear response. Wallet/financial
// history is intentionally not queried separately: wallets are user-
// scoped, not estate-scoped, so a zero `users` count already rules it out.
const DEPENDENCY_CHECKS: Array<{ table: string; label: string }> = [
  { table: "estate_memberships", label: "Facility has been activated (has an owner/admin membership)" },
  { table: "users", label: "Facility has associated user identities" },
  { table: "homes", label: "Facility has Homes" },
  { table: "estate_buildings", label: "Facility has Buildings" },
  { table: "devices", label: "Facility has registered devices" },
  { table: "maintenance_requests", label: "Facility has maintenance history" },
  { table: "consumer_automations", label: "Facility has automations" },
  { table: "facility_automation_event_rules", label: "Facility has automation event rules" },
  { table: "automation_approvals", label: "Facility has automation approval history" },
  { table: "facility_incidents", label: "Facility has recorded incidents" },
];

export type EstateDeletionEligibility =
  | { eligible: true }
  | { eligible: false; blocking: string[] };

export async function checkEstateDeletionEligibility(estateId: string): Promise<EstateDeletionEligibility> {
  const blocking: string[] = [];
  for (const dependency of DEPENDENCY_CHECKS) {
    const { count, error } = await supabaseAdmin
      .from(dependency.table)
      .select("id", { count: "exact", head: true })
      .eq("estate_id", estateId);
    if (error) throw new Error(`eligibility_check_failed:${dependency.table}:${error.message}`);
    if ((count || 0) > 0) blocking.push(dependency.label);
  }
  if (blocking.length) return { eligible: false, blocking };
  return { eligible: true };
}
