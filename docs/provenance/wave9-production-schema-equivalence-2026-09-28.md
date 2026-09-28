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

## Material column-contract review

The comparison found 19 shared relations with a column-contract difference. The
following is a **current production versus replay** classification, not a claim
about historical creation provenance. Read-only production catalog/data checks,
the current runtime writers, and the tracked migration intent were used for each
classification.

| Relation | Production/replay difference | Classification | Resolution |
|---|---|---|---|
| `community_comments` | production requires audit timestamps; replay permits legacy nulls | B — production canonical | retain production-compatible baseline constraint |
| `community_live_sessions` | production requires host/scope and lifecycle timestamps; replay retains unused guest compatibility fields | C — intentional compatibility | live service writes the production lifecycle fields; no production change |
| `community_reactions` | production requires audit timestamps; replay permits legacy nulls | B — production canonical | retain production-compatible baseline constraint |
| `devices` | production permits onboarding/provider fields that replay had tightened | C — required compatibility | do not tighten production; discovery/onboarding may be incomplete initially |
| `estate_service_configs` | legacy nullable description and utility pricing fields differ | C — required compatibility | current service contract accepts both retained forms |
| `estates` | production retains legacy `owner_id` | D — legacy drift safe to retain | no runtime contract is removed by this remediation |
| `facility_cameras` | production required `ip`/`rtsp_url`; accepted observation contract permits unknown acquisition configuration | A — repository canonical | forward migration drops only those `NOT NULL` constraints; scope correction remains separate |
| `homes` | production has retained meter/gate fields; runtime writes `type` | A/C — additive runtime contract plus retained legacy fields | add `type text default 'home'`; retain legacy fields |
| `maintenance_requests` | production uses `resident_id`; replay retained `user_id` | B — production canonical | controller now maps compatible request `user_id` to `resident_id` |
| `notifications` | production retains `updated_at` and stricter type lifecycle | B — production canonical | baseline remains production-compatible |
| `ochiga_agent_observability` | production retains `tool_name` and older nullable fields | C — intentional compatibility | observability readers tolerate retained shape |
| `ochiga_intelligence_events` | populated legacy nullable `scope_type`/`scope_id` and object `payload` alongside newer metadata | C — legacy compatibility | preserve; no scope/payload rewrite |
| `ochiga_intelligence_predictions` | `confidence numeric(5,2)`, `source_event_ids jsonb`, and object/null `evidence` versus Core semantic text, `text[]`, and evidence array | A — repository canonical | guarded forward conversion; unsafe rows abort |
| `ochiga_memory_directory` | retained legacy scope columns/defaults | C — required compatibility | governed memory uses newer scope contract without deleting retained data |
| `room_assignments` | production owns `resident_id`; replay also carries historic `user_id` | B — production canonical | focused controller correction, no schema rewrite |
| `suggestions` | production retains `rule_id` and strict lifecycle status | C — legacy compatibility | retained deliberately |
| `user_push_tokens` | production requires audit timestamps | B — production canonical | baseline remains production-compatible |
| `users` | production retains historic credential/role columns | D — legacy drift safe to retain | no Core contract relies on deleting them |
| `wallet_transactions` | retained category and nullable legacy direction shape | C — required compatibility | wallet RPC contract remains the authoritative mutation boundary |

The three prediction conversions are data-safe by construction: the read-only
production count was zero on 2026-09-28, and the forward migration still
validates any future populated legacy table before it converts it. In
particular, a non-array or non-string source-event value, or scalar evidence,
aborts the transaction rather than silently discarding meaning. The event legacy
fields are populated in production and are intentionally not removed.

No historical migration was rewritten, and no inferred DDL was relabelled as
historical provenance.

## Production security observation

The current production dump still shows the four wallet mutation RPCs as
`SECURITY DEFINER` with `anon` and `authenticated` execution grants. Candidate
migration `20260926211819_wallet_rpc_service_boundary.sql` is the reviewed
forward correction; it has not been applied to production. This is a deployment
security gate, not evidence that the candidate correction is deployed.

## Current conclusion

The historical baseline/replay failure is resolved as a reproducible diagnostic
installation sequence. The remaining production changes are reviewed,
forward-only candidates: `20260928090000_wave9_production_contract_reconciliation.sql`
and the existing wallet service-boundary migration. They are intentionally
**not applied to production** in this repository audit.
