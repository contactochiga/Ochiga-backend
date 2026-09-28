# Wave 9 production schema equivalence — 2026-09-28

## Scope and provenance boundary

Read-only Supabase CLI access to linked project `zcpgtdakqxyvjkmiibei` was
verified. `supabase migration list --linked` showed matching local/remote
versions through `20260926090000`. A schema-only `public` dump was written to
`/tmp/ochiga-production-schema.sql`; it is deliberately not committed. No
application data or production mutation was performed.

The original creators for `community_posts`, `estate_devices`,
`user_integrations`, `user_presence`, `visitor_access`, and `visitors_legacy`
remain unrecovered. The two SQL files in `supabase/baselines/` therefore record
**verified current production compatibility state**, not historical migrations
or a claim about original provisioning order.

## Reproducible diagnostic installation sequence

On an empty disposable local Supabase PostgreSQL database, the following
sequence completed with `psql -v ON_ERROR_STOP=1`:

1. Local Supabase platform-owned `auth` and `storage` schemas.
2. `migrations/schema.sql`.
3. `supabase/migrations/20260521000100_pilot_onboarding_foundation.sql`.
4. `supabase/baselines/verified-production-prerequisites.sql`.
5. All 118 tracked `supabase/migrations/*.sql` files in lexical timestamp order.
6. `supabase/baselines/verified-production-compatibility.sql`.

The prerequisites file contains the six verified production foundations, the
wallet owner column needed by an earlier retained security policy, and the five
pre-existing trigger functions that an earlier retained hardening migration only
alters. The compatibility file adds the retained `room_device_bindings`
definition, production indexes/triggers/policies, and the verified
`visitor_access` compatibility view. It refuses to replace a populated legacy
`visitors` table. Neither file is a production migration or safe to run against
an arbitrary populated database.

## Named-object comparison

Comparing schema-only dumps after the successful replay to the linked production
dump produced:

| Class | Production | Replay | Missing from replay | Replay-only |
|---|---:|---:|---:|---:|
| tables | 145 | 147 | 0 | 2 |
| functions/signatures | 23 | 23 | 0 | 0 |
| indexes | 402 | 411 | 0 | 9 |
| triggers | 18 | 18 | 0 | 0 |
| RLS policies | 65 | 65 | 0 | 0 |
| views | 2 | 2 | 0 | 0 |

The replay-only tables are `camera_dvrs` (the reviewed candidate forward
migration) and legacy `estate_wallets`; their associated replay-only indexes,
along with retained legacy indexes on already-existing objects, are expected
candidate/legacy differences and not missing production objects.

## Material column-contract drift — unresolved

The object-name comparison does **not** establish full equivalence. A normalized
column comparison found 19 shared relations with differences. The material set
requires a data-safe, reviewed forward reconciliation before Wave 9 can close:

- `ochiga_intelligence_predictions`: production stores `confidence` as
  `numeric(5,2)` and `source_event_ids` as `jsonb`; replay has the later Core
  contract of textual confidence and `text[]` source IDs.
- `ochiga_intelligence_events`: production retains nullable
  `scope_type`, `scope_id`, and `payload`, while replay has the newer required
  Core defaults.
- `community_live_sessions`, `facility_cameras`, `devices`,
  `estate_service_configs`, `homes`, `notifications`, `users`,
  `wallet_transactions`, and the legacy intelligence/memory/room tables have
  nullable/default/type/legacy-column differences recorded by the disposable
  catalog comparison.

These are not safely fixable by a blind `ALTER COLUMN TYPE`: existing production
data may require conversion and application compatibility review. They are
classified **BLOCKING UNKNOWN** until a per-table forward migration plan maps
actual rows and confirms the canonical contract. No historical migration was
rewritten, and no inferred DDL was relabelled as historical provenance.

## Production security observation

The current production dump still shows the four wallet mutation RPCs as
`SECURITY DEFINER` with `anon` and `authenticated` execution grants. Candidate
migration `20260926211819_wallet_rpc_service_boundary.sql` is the reviewed
forward correction; it has not been applied to production. This is a deployment
security gate, not evidence that the candidate correction is deployed.

## Current conclusion

The historical baseline/replay failure is resolved as a reproducible diagnostic
installation sequence. Full production schema equivalence is **not** resolved:
the remaining column-contract drift and the undeployed wallet privilege
correction prevent Wave 9 certification.
