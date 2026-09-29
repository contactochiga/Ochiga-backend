# Camera migration authority finding — 2026-09-26

## Proven lineage, not reconstructed history

`6306a05` (2026-03-13) adds `migrations/2026-03-12-camera-events.sql`, already referencing facility_cameras. `ed9c69c` (2026-05-22) introduces the first retained production-oriented CREATE TABLE in `migrations/2026-05-21-pilot-onboarding-foundation.sql`. `900d575` copies these into timestamped Supabase migrations. Searching all available Git refs for table creation finds no earlier baseline definition; `migrations/schema.sql` never defined it. Wave 6 SQL smoke definitions are isolated fixtures, not deployment authority.

Production migration records retain the May `CREATE TABLE IF NOT EXISTS`, matching its Git definition. This does NOT prove that statement created the live table: IF NOT EXISTS preserves an existing table. Migration version is not a trustworthy execution timestamp. PostgreSQL catalogs do not retain original creation DDL/author. **Original production creation provenance remains UNKNOWN**: a pre-existing untracked/manual/provisioning table is consistent with evidence but not conclusively established.

## Production catalog evidence (read-only, no camera/user rows)

Project `zcpgtdakqxyvjkmiibei` has 41 camera columns, RLS enabled, no non-internal camera triggers. Only service_role has listed direct camera table grants. A retained authenticated estate-operator SELECT policy exists but does not itself grant table access. The two camera RPCs are SECURITY INVOKER with empty search_path and no anon/authenticated EXECUTE.

Material differences from the May creation definition: production `name` is nullable; `ip` and `rtsp_url` are NOT NULL; status and health_status are nullable. Only primary-key and zone FK constraints exist; estate/creator FKs and May camera/IP unique constraints are absent. Do not add uniqueness/FKs or weaken required columns without data-safe review. No row-level data was fetched to assume those changes safe.

Production lacks **home_id and privacy_scope**, while CAMERA_ACCESS_SELECT and accepted-transition SQL require them. This is a real deployment/schema risk, not merely fresh-install ordering. `ba7b6e0` introduced `migrations/2026-06-11-camera-dvr-registry.sql`, adding privacy_scope and creating camera_dvrs, but it has no Supabase-chain counterpart. Production camera_dvrs is absent. Gateway Phase 3 adds home_id to **discovered_devices/edge_commands**, not facility_cameras. No retained camera home_id migration was found.

## Narrow forward correction for review

`20260926205543_wave9_camera_scope_schema_correction.sql` adds nullable home_id UUID / privacy_scope text to the EXISTING table, verifies types, preserves metadata and existing policies/functions/triggers, enables RLS and retains Backend-service-only direct table access. No table replacement, no privacy default/backfill, no legacy constraint reconciliation, no history repair/deletion. Existing cameraAccess.policy metadata fallback remains unchanged. The home FK uses ON DELETE SET NULL; no observation or health semantics change.

The isolated SQL smoke tests a legacy-shaped existing table and an actual May-foundation schema: repeated application, row/metadata preservation, home FK, service/client grants, RLS and unchanged policy/index/function/trigger. These are **targeted upgrade tests**, not proof of full production schema equivalence. No migration was deployed.

## Full replay remains blocked

Both empty replay and documented schema.sql-plus-replay fail at March camera_events. Running the existing May foundation first can diagnose the ordering issue, but is not an approved replacement history. The already tracked Twin asset contract explicitly documents a minimal subset rather than full replay, and separately records missing community_posts creation. A new migration at the end cannot fix an earlier failed statement on an empty database.

Required closure: obtain a reviewed schema-only provisioning baseline (including non-camera prerequisites), compare catalog/function/RLS/grants against production, and define an explicit fresh-install path without falsifying deployed migration history. Do not use `db pull` to silently change remote migration history; no such operation was run. Applied migrations stay intact. The omitted DVR migration requires its own reviewed forward adoption/security treatment; this narrow patch does not claim to solve it.

**Migration authority gate: NOT CLOSED.** The forward scope fix is safe to review independently, not permission to deploy or certify fresh replay.
