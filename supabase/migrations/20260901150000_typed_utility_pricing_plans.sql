-- Facility <-> Consumer Utilities acceptance, Part B/C: typed pricing model.
--
-- Root cause audit (read-only, evidence-gathered before this migration was
-- written): estate_service_configs has never had a real tariff/pricing
-- table -- pricing is a flat unit_cost/unit_name pair plus an unstructured
-- metadata.electricity JSON blob that ONLY electricity ever reads
-- (buildElectricityQuote(), src/controllers/servicesController.ts). Water,
-- Gas, Internet/Fibre and Service Charge fundamentally need different
-- pricing semantics (usage-based rate, subscription plan, fixed/recurring
-- charge) but the current model treats every service_key identically.
-- Confirmed directly against production: the real estate
-- (cedba104-8155-41d5-a5cc-23fc2710f7ab) has exactly one
-- estate_service_configs row at all (electricity), and Buy Electricity is
-- disabled purely because metadata.electricity (the vending-enablement
-- policy) was never set on it -- not a frontend bug.
--
-- Prerequisite bug fix, found while preparing this migration: two
-- conflicting CHECK constraints exist on estate_service_configs.service_key
-- in production -- the tracked, correct 9-value
-- estate_service_configs_key_check (added by
-- 20260709000100_infrastructure_services_home_provisioning.sql) AND an
-- untracked, stale 5-value estate_service_configs_service_key_check that
-- does not appear in any migration file in this repo (schema drift from an
-- ad hoc change made directly against production, outside the tracked
-- migration history). Because Postgres enforces the INTERSECTION of all
-- CHECK constraints on a column, this stale constraint silently blocks
-- Facility from ever configuring water_service/gas_service/
-- generator_recovery/solar_battery_service in estate_service_configs --
-- confirmed empirically via a rolled-back transaction attempting a
-- water_service insert, which failed with exactly this constraint name.
-- Dropping it here is required before Water/Gas pricing can be configured
-- at all, and is safe: the correctly-tracked 9-value constraint already
-- covers everything the stale one covered, plus the 4 keys it was
-- silently blocking.
alter table if exists estate_service_configs
  drop constraint if exists estate_service_configs_service_key_check;

-- Canonical typed pricing model. One row = one priced configuration for a
-- service at an estate, for a given effective period. estate_service_configs
-- remains the service catalog/display entry (title, description,
-- account_label/hint) and keeps its legacy unit_cost/unit_name/billing_mode
-- columns untouched for backward compatibility -- this table becomes the
-- authoritative source for the actual rate/plan/amount going forward.
--
-- pricing_type intentionally covers only what's needed now
-- (usage_based/fixed/recurring/subscription); tiered/time_of_use/hybrid can
-- be added later as new pricing_type values plus new metadata shape,
-- without another schema redesign, since rate_amount/unit_name/metadata
-- already carry enough structure to extend.
create table if not exists service_pricing_plans (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references estates(id) on delete cascade,
  service_key text not null,
  pricing_type text not null,
  plan_name text,
  unit_name text,
  currency text not null default 'NGN',
  rate_amount numeric(14,2) not null,
  -- How often billed (subscription/recurring), distinct from payment_timing.
  billing_frequency text,
  -- prepaid/postpaid where the utility actually supports both (electricity,
  -- water). Deliberately named differently from estate_service_configs.
  -- billing_mode, which means something else there (wallet_only/metered/
  -- fixed -- a payment MECHANISM, not payment TIMING) -- reusing that name
  -- here for a different concept would be exactly the kind of accidental
  -- universal-tariff conflation this migration exists to fix.
  payment_timing text,
  -- The rate's source, e.g. "EKEDC Distribution Tariff" or an ISP name.
  -- Deliberately separate from home_service_accounts.provider (the
  -- Home-level meter/account provider) -- production data shows that field
  -- already gets a single value fanned out identically across every
  -- service_key on a Home (electricity's disco name copied onto water/gas/
  -- internet/service_charge), which is exactly the kind of incorrect
  -- generic-model behavior this table must not repeat.
  provider text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_pricing_plans_service_key_check check (service_key in (
    'utility_token', 'water_service', 'gas_service', 'internet_service',
    'fiber_internet', 'generator_recovery', 'solar_battery_service',
    'service_charge', 'other_facility_fees'
  )),
  constraint service_pricing_plans_type_check check (pricing_type in (
    'usage_based', 'fixed', 'recurring', 'subscription'
  )),
  constraint service_pricing_plans_frequency_check check (
    billing_frequency is null or billing_frequency in ('once', 'monthly', 'quarterly', 'yearly')
  ),
  constraint service_pricing_plans_timing_check check (
    payment_timing is null or payment_timing in ('prepaid', 'postpaid')
  ),
  constraint service_pricing_plans_rate_check check (rate_amount >= 0)
);

-- At most one active rate for a non-subscription service at a time -- keeps
-- "what is the current price" unambiguous for usage_based/fixed/recurring.
-- Subscription is deliberately excluded: Internet must support multiple
-- simultaneous active plans (e.g. 100Mbps and 200Mbps both offered at once).
create unique index if not exists uidx_service_pricing_plans_single_active_rate
  on service_pricing_plans (estate_id, service_key)
  where active and pricing_type <> 'subscription';

create index if not exists idx_service_pricing_plans_lookup
  on service_pricing_plans (estate_id, service_key, active);

alter table service_pricing_plans enable row level security;

-- Mirrors the exact read policy already on estate_service_configs (same
-- estate-operator role set) -- reusing the established pattern, not
-- inventing a new authorization shape for this table.
create policy oyi_service_pricing_plans_estate_operator_select
  on service_pricing_plans
  for select
  to authenticated
  using (
    exists (
      select 1 from estate_memberships em
      where em.estate_id::text = service_pricing_plans.estate_id::text
        and em.user_id = auth.uid()
        and coalesce(em.status, 'active') = 'active'
        and lower(coalesce(em.role::text, '')) = any (array[
          'owner', 'admin', 'manager', 'estate_admin', 'facility_manager',
          'security', 'security_operator', 'maintenance_operator', 'finance_operator'
        ])
    )
  );

-- Deterministic, additive backfill. Every existing estate_service_configs
-- row is preserved untouched -- this only ADDS pricing_plans rows, and only
-- where the pricing_type can be inferred with zero ambiguity:
--   billing_mode = 'metered' + unit_cost set  -> usage_based (metered
--     unambiguously means "priced per unit of consumption").
--   service_key in (service_charge, other_facility_fees) + an amount set
--     -> recurring, monthly (these are definitionally recurring dues, never
--     metered consumption, per product intent).
-- Every other combination (e.g. billing_mode = 'fixed' for a service_key
-- that isn't a dues/fee type, or billing_mode = 'wallet_only') is left
-- unmigrated rather than guessed -- those services simply have no
-- service_pricing_plans row yet and correctly read as "needs configuration"
-- to both Facility and Consumer, which matches their actual, honest,
-- pre-migration state (already shown as "managed by facility for now" /
-- not configured before this change -- nothing regresses).
insert into service_pricing_plans (
  estate_id, service_key, pricing_type, unit_name, currency, rate_amount,
  billing_frequency, effective_from, active, metadata
)
select
  esc.estate_id,
  esc.service_key,
  'usage_based',
  esc.unit_name,
  coalesce(esc.currency, 'NGN'),
  esc.unit_cost,
  null,
  now(),
  true,
  jsonb_build_object('backfilled_from', 'estate_service_configs.unit_cost', 'backfilled_at', now())
from estate_service_configs esc
where esc.billing_mode = 'metered'
  and esc.unit_cost is not null
  and not exists (
    select 1 from service_pricing_plans spp
    where spp.estate_id = esc.estate_id and spp.service_key = esc.service_key
  );

insert into service_pricing_plans (
  estate_id, service_key, pricing_type, currency, rate_amount,
  billing_frequency, effective_from, active, metadata
)
select
  esc.estate_id,
  esc.service_key,
  'recurring',
  coalesce(esc.currency, 'NGN'),
  coalesce(esc.unit_cost, esc.suggested_amount),
  'monthly',
  now(),
  true,
  jsonb_build_object('backfilled_from', 'estate_service_configs.unit_cost_or_suggested_amount', 'backfilled_at', now())
from estate_service_configs esc
where esc.service_key in ('service_charge', 'other_facility_fees')
  and coalesce(esc.unit_cost, esc.suggested_amount) is not null
  and not exists (
    select 1 from service_pricing_plans spp
    where spp.estate_id = esc.estate_id and spp.service_key = esc.service_key
  );
