-- Cross-Domain Operational Automation -- security regression
-- (npm run audit:security) surfaced that automation_approvals and
-- facility_automation_policy (both created by the Phase 3 milestone
-- migration, 20260830090000) never had row level security enabled, unlike
-- every comparable Facility automation table (e.g.
-- consumer_automation_runs). Every code path that touches these two
-- tables already goes exclusively through supabaseAdmin (the service-role
-- client, which bypasses RLS), so this was not a live exposure -- no
-- route ever queries them with an anon/authenticated-scoped key. Still, a
-- real gap the audit tooling is designed to catch, found while this pass
-- was already extending automation_approvals -- fixed here rather than
-- left for a future pass to rediscover. Same pattern as
-- consumer_automation_runs: enable RLS, revoke direct anon/authenticated
-- access, no bespoke policies needed because access is exclusively via
-- authenticated backend routes using the service-role client.
alter table automation_approvals enable row level security;
revoke all on automation_approvals from anon, authenticated;

alter table facility_automation_policy enable row level security;
revoke all on facility_automation_policy from anon, authenticated;
