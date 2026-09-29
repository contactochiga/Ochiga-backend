# Wave 9 runtime smoke isolation correction

Starting Backend: `1b78517d07aecde5aa9307e3691e0697f3a10a2e`; main: `17e876d78d0baf19913845195e140c812075a2ec`. PR #90 remains draft. No production source or migration changes.

## Root cause and boundary inventory

`production-readiness-smoke.mjs` retained inherited Supabase credentials with `||=`, imported the application before installing overrides, and replaced only `from("users")`. `oyiCoreRuntime.receiveSignal` now performs real Final A signal lookup, prepared-bundle registration, claim/completion and acknowledgement lookup through `src/oyi-core/persistence/materialization.ts`. The synthetic `estate-1` therefore reached a UUID-backed durable write. Execution start/completion also upserts `ai_execution_ledger`; audit logging writes `audit_events`. A users-only override does not isolate those ports.

`src/config/env.ts` uses REDIS_ENABLED to decide whether to validate Redis configuration. It does not suppress module-level IORedis/BullMQ construction in intentWorker, intentDlqWorker, automationWorker or proactiveIntelligenceScheduler. Importing app/provider adapters can reach these modules before a late ping override. `src/config/redis.ts` is another Redis port; its explicit production connection is not the same as BullMQ's connections.

The shared **test-only** helper installs before imports:

- In-memory ports for the health users read, audit writes, execution-ledger writes and the exact materialization lookup/register/claim/complete protocol exercised here.
- Queue/Redis construction ports; unexpected enqueue, scheduling, worker startup or explicit connection fails.
- A TCP/TLS and UDP guard. Only the smoke's explicitly bound ephemeral loopback HTTP server is permitted, preserving actual Express health/metrics requests. Unexpected fetch/network access fails.
- Unconditional fixture-only environment values; inherited configured service credentials are never used by these smokes.
- A violation ledger checked at the end, so application error swallowing cannot conceal an attempted escape. Scripts finish naturally rather than process.exit masking retry loops.

Real Core normalization, reasoning, awareness/prepared-bundle construction, identity scoping, subscriptions, realtime projection, metrics, provider registry and HTTP handlers remain exercised. The old hard-coded awareness ID assertion is replaced with equality to the actual registered signal-scoped awareness identity and related signal. `estate-1` remains synthetic. These ports do **not** prove SQL durability: the separate real PostgreSQL suites retain that responsibility.

CI Supabase credentials are no longer global. Only the existing quality job's release-schema integration check retains them; runtime-smoke receives noncredential fixtures. No existing smoke/assertion is skipped. A hostile-inherited-configuration regression runs all three smokes and explicitly checks rejected DB/RPC/queue/Redis/TCP/TLS/UDP/fetch access.

## Validation

- `npm run typecheck`, `npm run build`: PASS.
- `node scripts/wave9-runtime-smoke-isolation-smoke.mjs`: PASS (four groups, including all three runtime smokes); also PASS using `npx --yes --package=node@22 node scripts/wave9-runtime-smoke-isolation-smoke.mjs`, matching CI Node major.
- Every `scripts/wave[5-9]*smoke.mjs`, sorted and run individually with a 60-second timeout: **68/68 PASS**, including real local PostgreSQL suites. Local-only Supabase credentials came from the existing local Docker environment, not production.
- full-domain-architecture, oyi-security-adversarial, oyi-security-closure, oyi-canonical-signal-ingress, oyi-awareness-v3 and evidence-presentation smoke scripts: PASS.
- `npm run lint`, `npm run validate:security`, `npm run smoke:camera-runtime-canonicalization`, `npm run validate:env` with valid fixture environment: PASS.
- `npm run validate:release`: local schema integration **BLOCKED/FAIL**, because local PostgREST has no public.devices table. Earlier fixture-only run also cannot perform that integration by design. This is not reported as release certification; remote quality integration is tracked separately.
- The first full matrix exposed a test-format flake in the 14B SQL suite: PostgreSQL serializes `.950` as `.95`. Its assertion now compares normalized instants and deliberately exercises that fractional value. Ordering/history/concurrency assertions and runtime code are unchanged. Final matrix above passes.

## Independent provisioning gate

The retained room_device_bindings definition is unchanged. Six objects still lack verified creation provenance: community_posts, estate_devices, user_integrations, user_presence, visitor_access, visitors_legacy. The existing exhaustive evidence ledger remains authoritative about search coverage, not a claim that inaccessible records do not exist. Fresh replay still cannot be certified beyond the missing community_posts prerequisite; full schema equivalence is not computed. No catalog-derived historical DDL was invented, no protected migration changed, and no production mutation occurred.

Green runtime CI cannot close Wave 9 while this provisioning gate remains unresolved. No merge, deployment or ready-for-review conversion is authorized by this correction alone.
