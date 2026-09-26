# Historical provisioning evidence — 2026-09-26

## Expanded search and one recovered definition (supersedes the seven-unresolved count below)

All four remotes and 214 accessible GitHub PR heads were fetched into separate local `refs/audit/wave9-pr/*` refs without changing product branches. Scanned all reachable text blobs under 10 MB, not only SQL-named files: Backend 3,805; Office 731; Facility 1,326; Twin 577. The only creation matches were two Backend visitor_access smoke fixtures, not production provenance. Read-only `git fsck --full --no-reflogs --unreachable` then exposed 22/20/29/0 unreachable blobs respectively; none contained the missing CREATE definitions. Original Office/Twin SQL paths outside Documents were also searched. No recovered cloud implementation was reconstructed.

The supported Supabase CLI exposed a previously unexamined evidence source: retained SQL Editor snippets. The CLI first-page list returned a cursor, so the documented read-only Management API `/v1/snippets?project_ref=...&cursor=...` was paginated through all four pages, and all **39 accessible snippets** were inspected in memory. Credentials remained in process and were not written or printed. Names are not reliable content summaries: some snippets contain unrelated later SQL. Neither a saved snippet nor its inserted_at proves execution time.

**room_device_bindings: classification A, original definition found.** Snippet `689b8acb-34db-4078-8934-0fa104e245a8`, misleadingly named “Estate membership columns,” has inserted_at and updated_at `2026-01-17T13:06:05.147176+00:00`. Its 664-byte SQL SHA-256 is `1366bcc742442694ba123033cb354a9733456c7615da40626fb01e44b1d52ed5`. It is archived verbatim plus one final LF in `docs/provenance/room_device_bindings.retained-snippet.sql`, **outside migrations**. No executed provisioning timestamp is inferred. Its eight columns, five PK/FK/check/unique constraints and four indexes match production. A newly created empty local DB replay of retained schema.sql followed by the snippet, twice, PASSes. Production RLS=true is explained by the June security migration's all-public-tables loop; the snippet itself does not enable RLS. This is a narrow structural comparison, not full grants or whole-database equivalence.

**The other six objects remain classification E.** No creation definition for community_posts, estate_devices, user_integrations, user_presence, visitor_access or visitors_legacy appeared in these accessible snippets. Retained February community snippets only reference/alter posts. November foundation snippets reproduce base tables but do not create posts. Read-only backup metadata returns an empty backups array and PITR=false. A bounded log query for the first community application-reference day (2025-11-29 UTC) returned no retained entries. These results do not prove manual provisioning and do not cover inaccessible/deleted snippets or externally held backups.

The exact next evidence needed is the original definition/provisioning artifact for those six objects, especially community_posts, from another owner's retained SQL history or an external historical schema backup. Under the current instruction, a newly inferred catalog-based CREATE cannot substitute for that evidence. Therefore no full replay or full schema-equivalence report is fabricated. Machine-readable status and scoped comparison are in `docs/provenance/wave9-provenance-status.json`.

### Five historical migrations protected

Production migration history confirms `20260905010000` through `20260905050000`: home_zone_building_link, home_canonical_ref, room_canonical_ref, device_canonical_ref and device_parent_relationship, all named LOCAL_TEST. All five files remain tracked and unchanged from origin/main. The current migration diff has only three additive forward files (camera scope, wallet privilege boundary, DVR registry), no deletions or modifications. The lost c35bf0c deletion assumption is not repeated; that lost commit was not reconstructed.

Sources for supported read-only metadata access: https://supabase.com/docs/reference/api/v1-list-all-snippets and https://supabase.com/docs/reference/api/v1-list-all-backups. No production mutation or backup restore was performed.

This is a blocked provenance finding, not a replacement schema or an equivalence certification. No production data was read or mutated. No historical migration was changed.

## Search coverage

- Fetched all four repositories' remotes. Backend all-ref history includes local branches, remote branches and the `oyi-core-v1.0` tag.
- Inspected all 195 reachable historical blob candidates whose paths identify SQL/dumps/schema/bootstrap/foundation/provisioning/setup/archive material, including deleted historical versions. No CREATE TABLE definition was found for the seven objects below.
- Searched 446 SQL/dump/backup paths under the accessible Mac Documents tree, excluding dependencies and Git internals. No creation match for those seven objects. This is not a claim about unavailable backups or former cloud files.
- `git log --all --reverse -S OBJECT -- .` establishes the first retained application reference below. SQL creation searches and deleted-file history were checked separately.
- Read production `supabase_migrations.schema_migrations` statements and `pg_catalog` / `information_schema` metadata only. Production migration CREATE matching is a discovery aid, not a SQL parser; the two community migration statement arrays were inspected in full to exclude matches inside foreign-key references.

## Unowned production objects

| Object | First retained reference | Creation / bootstrap owner | Production presence | Required definition / disposition |
|---|---|---|---|---|
| community_posts | `6cc7031128fc52152e0d1806d14810f195341f0c`, 2025-11-29, communityController | Not retained in searched Git SQL or production migration statements | Present | Current 18-column catalog exists; original pre-March definition is unproven. March comments/reactions requires its PK before execution. |
| estate_devices | No tracked reference found | Unproven | Present | Production-only object; ownership and continued requirement need classification, not speculative adoption. |
| room_device_bindings | No tracked reference found | Unproven | Present | Production-only object; ownership and continued requirement need classification. |
| user_integrations | `246a40a`, 2026-03-11 | Unproven | Present | Application predates any retained creation; baseline definition must be established. |
| user_presence | `dd8e8b5`, 2026-03-15 | Unproven | Present | Same provisioning gap; current catalog is not historical installation evidence. |
| visitor_access | `3a7ea2a`, 2025-11-29 | Unproven | Present | Historical application reference, no retained creation found. |
| visitors_legacy | No tracked reference found | Unproven; no retained rename found in production migration history | Present | Do not infer a rename from the tracked `visitors` table merely from the name. |

Other production objects without a matched migration CREATE include users, estates, homes, rooms, room_assignments, room_rules, devices, suggestions, notifications, wallets, wallet_transactions, estate_services, maintenance_requests, estate_memberships, home_memberships and invites. These have an explicit retained owner in `migrations/schema.sql` (first introduced `ee67974`, 2025-11-17; latest retained edit `fc5e09c`, 2026-01-17). Presence of a bootstrap definition does **not** prove current production equivalence.

Camera provenance remains as documented in `WAVE9_CAMERA_MIGRATION_AUTHORITY_FINDING.md`: March references precede the first retained May foundation CREATE. The May file cannot be certified as the complete historical baseline.

## Community production catalog evidence

Current columns: id uuid PK/default gen_random_uuid; estate_id and author_id uuid NOT NULL; title/body text nullable; created_at timestamptz NOT NULL/default now; updated_at nullable; status text NOT NULL/default published; media jsonb nullable/no default; live_link text nullable; view_count integer NOT NULL/default 0; category/default resident; is_pinned/default false; pinned_until; audience_type/default all_estate; audience_ref; scheduled_at; priority.

Only the primary-key constraint is present: no estate/author FK may be invented. Six indexes exist (PK, estate, created descending, estate/status/created, estate/category/created, estate/pinning). RLS is enabled; authenticated SELECT policy checks active estate_memberships; no noninternal trigger. Grants and whole-schema equivalence are not certified by this targeted snapshot.

Production March `20260312000200` creates comments/reactions and references community_posts; it does not create posts. May `20260529000100` ALTERs posts and creates related read/report/live tables; it does not create posts. The current nullable media/no-default shape differs from the May ADD IF NOT EXISTS default: historical existing-column behavior matters. A fresh table guessed from May additions would not reproduce that truth.

## Fresh diagnostic replay

Executed against a newly created uniquely named empty PostgreSQL database in local `supabase_db_Ochiga-backend`, psql ON_ERROR_STOP=1; dropped only that disposable database afterward:

1. migrations/schema.sql — PASS.
2. retained 20260521000100_pilot_onboarding_foundation.sql — PASS.
3. chronological 20260312000100_camera_events.sql — PASS.
4. chronological 20260312000200_community_comments_reactions.sql — FAIL: relation community_posts does not exist.

This is a diagnostic ordering experiment, **not** a supported installation. Its process completed cleanup successfully; SQL replay itself FAILED. Later migrations were not called PASS or skipped into a false green state.

## Required resolution

The historical provisioning contract cannot presently be recovered from the searched repository and retained production migration records. Needed evidence is the original provisioning SQL/schema-only pre-migration backup, or an explicitly reviewed adoption of a new catalog-derived installation baseline with historical migration preconditions reconciled across the whole chain. A current schema snapshot alone must not be relabelled the original bootstrap, and blindly applying old migrations on top of it is not proof of chronological replay.

No piecemeal replacement CREATE statements were committed. Whole-schema comparisons (tables/columns/defaults, constraints, indexes, functions/security/grants, RLS/policies, triggers, views, enums/extensions) remain **UNEXPLAINED/BLOCKED** until that baseline is established and the complete chain succeeds. Current production presence is recoverable; original creation ownership/order is the missing evidence. No claim that all possible external backups have been exhausted is made.
