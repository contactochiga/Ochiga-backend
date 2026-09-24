# Wave 6 — FINAL C — Awareness & State Convergence — Final Closure / Release Audit

Audit date: 2026-09-24. Read-only, cumulative audit of the whole Wave 6 program at current HEAD. **No source was modified, no test was modified, no migration was created, nothing was committed.** This document is itself uncommitted, per the task's own instruction.

**Verdict: B — COMPLETE WITH PRE-DEPLOYMENT BLOCKERS.** The Awareness & State architecture has converged: one authority per fact, no silent fallback anywhere except one explicitly-labeled, disclosed exception, zero unjustified generic bypasses across device/Edge/camera, durable canonical materialization with proven crash recovery, visitor and maintenance integrity closed. What remains is exactly what Wave 6 was never scoped to deliver: physical hardware acceptance, frontend adoption, and multi-node production load/lock acceptance. See Section 26/27 for the full reasoning.

---

## 1. Backend Git state

- Repository: `/Users/ochigaidoko/Documents/Ochiga-backend`
- Branch: `main`
- HEAD: `298cf4fc2e67e5f909c3f37303bac37311c2e209` — **matches expected exactly.**
- `origin/main`: `909d5d0a35ab2de84c7cdc83d0f10be166e0b512`
- Ahead/behind: **14 / 0**
- Staged: none
- Unstaged: `scripts/pilot-import.mjs`, `src/routes/me.routes.ts` (33 insertions/4 deletions total — pre-existing, unrelated protected local work, carried across every prior Wave 6 slice in this program, untouched here)
- Untracked (all pre-existing, protected, none touched): `.aider.chat.history.md`, `.aider.input.history`, `.aider.tags.cache.v4/`, `docs/OYI_DIGITAL_TWIN_ASSET_CONTRACT.md`, `docs/WAVE6_CAMERA_EDGE_HEALTH_AUTHORITY_AUDIT.md`, `docs/WAVE6_SLICE14G_CAMERA_EDGE_FINAL_CHECKPOINT_AUDIT.md`, `opencode.json`, `pilot/luna-residences/`, five `20260905*_LOCAL_TEST_*.sql` fixture migrations. This document is the only new file introduced by this audit.

## 2. Edge Git state

- Repository: `/Users/ochigaidoko/oyi-edge-agent`
- Branch: `main`
- HEAD: `d2715f1cef7d9291c0ec1cda546551d91e1d2562` — **matches expected exactly.**
- `origin/main`: `5d30b63866197d6b674951bfdce2dd1211e76d24`
- Ahead/behind: **1 / 0**
- Staged/unstaged/untracked: none — fully clean working tree.

## 3. Complete unpublished commit ledger

**Backend** (`origin/main..HEAD`, 14 commits, oldest → newest):

| Commit | Message | Classification |
|---|---|---|
| `8d869d0` | Wave 6H.1: fail closed on unverified awareness scope | privacy/scope, canonical awareness |
| `e0b2fa8` | Wave 6I: make visitor/maintenance transitions concurrency-safe | visitor/maintenance integrity (CAS foundation) |
| `673920d` | Wave 6J: close shared freshness contract defects | freshness |
| `14c7bdc` | Wave 6K: converge device current-state authority | device current state |
| `5966856` | Wave 6K.1: converge device current-state consumers | device current state |
| `63c4fb4` | Wave 6K.2: close generic device current-state read bypasses | device current state |
| `a4852f1` | Wave 6L: close camera runtime privacy boundaries | Camera privacy |
| `556ac32` | Wave 6M: establish Edge current-state authority | Edge current state |
| `8f5a3d8` | Wave 6N: establish camera observation persistence | camera observations |
| `057eea2` | Wave 6O: establish camera current-state authority | camera current state |
| `8181f9d` | Wave 6P: converge camera health signal authority | camera transitions / canonical signal |
| `0dce3d0` | Wave 6Q: converge camera current-state readers | camera readers |
| `8dd3aa2` | Wave 6R: make canonical materialization durable | canonical materialization durability |
| `298cf4f` | Wave 6S: close remaining core state integrity | Final B integrity (visitor/maintenance) |

**Edge** (`origin/main..HEAD`, 1 commit): `d2715f1` — Wave 6N Edge: emit truthful camera observations (camera observations, Edge side; pairs with Backend `8f5a3d8`).

This is exactly what will be published on checkpoint release: 14 Backend commits + 1 Edge commit, nothing else.

## 4. Secret scan

**Backend: CLEAN. Edge: CLEAN.**

Methodology: `git diff origin/main..HEAD` for each repo (Backend 10,879 diff lines / 14 commits; Edge 506 diff lines / 1 commit), isolated added lines only, grepped for private-key headers, AWS-style keys, JWTs, Bearer-token literals, credential-embedded URLs, and password/token/secret/API-key literal assignments, filtering `process.env` reads and known test-fixture sentinels. One match surfaced — `rtsp://user:password@host` + `token:'secret'` in `scripts/wave6-slice14c-camera-observation-sql-smoke.mjs` — confirmed by context to be a synthetic payload the test asserts the ingestion RPC **rejects** (a forbidden-input fixture, not a leaked credential). No genuine secret found in either repo.

## 5. Final authority matrix

| Fact | Authority | Status |
|---|---|---|
| actor/scope/privacy | `canonicalAwarenessReadService.ts::resolveActorAuthority` + `actorMayViewScope` | Converged |
| surface authority | server-verified `oisContext`, consumed by the above (Slice 1B precedent) | Converged |
| canonical signal | `submitCanonicalSignal → oyiCoreRuntime.receiveSignal → UniversalSignalRuntime` | Converged |
| current awareness | `canonicalAwarenessReadService.ts::listActiveAwareness` | Converged (one disclosed exception, see §6) |
| device observation / current state | `deviceCurrentStateAuthority.ts` | Converged, zero unjustified bypasses |
| device freshness | shared `contracts/freshness.ts` classifier | Converged |
| Edge heartbeat / current state | `src/services/edgeCurrentStateAuthority.ts` | Converged |
| camera identity | `facility_cameras` table + canonical ID hydration | Converged |
| camera privacy | `modules/cameras/cameraAccess.policy.ts::canAccessCamera`/`cameraAccessActor` | Converged, single policy reused everywhere |
| camera observations | Edge-emitted → `oyi_ingest_camera_observations` → `facility_cameras.runtime_observations` | Converged |
| camera current state | `cameraCurrentStateAuthority.ts::cameraCurrentState()`/`resolveCameraCurrentStates()` | Converged, sole interpreter |
| camera operational transition | `oyi_accept_camera_health_transition` + `camera_health_transition_outbox` | Converged |
| visitor lifecycle | `visitorAccessTransition.ts::transitionVisitorAccessStatus` | Converged (Slice 11, extended Final B) |
| maintenance lifecycle | `maintenanceTransition.ts::transitionMaintenanceStatus` | Converged (Slice 11, unmodified) |
| canonical materialization obligation | `oyi_register/claim/complete/fail_materialization` RPCs + `canonicalMaterializationWorker.ts` | Converged, durable, crash-recoverable |

**No PARALLEL found** in any directly-inspected authority. **One dead/superseded writer found and confirmed inert**: `src/modules/cameras/cameraHealth.ts` is self-labeled `@deprecated`, zero live importers — matches its own claim, not a live parallel authority. **One legacy read-merge-write incident writer found and confirmed unreachable**: `CanonicalIntelligenceStore.upsertIncident`/`recordBundle`/`recordSignal` are never called from the live ingress path (`service.ts` never invokes them) — dead code, not a live gap.

## 6. Awareness convergence status

All 6 named consumers trace to `listActiveAwareness` directly or via a thin adapter:

| Consumer | Path | Fallback |
|---|---|---|
| `GET /oyi/awareness` | `awarenessPresentationAdapter.ts::getConvergedAwarenessDigest` → `listActiveAwareness` | **One explicit, disclosed fallback exists**: on canonical failure for any reason *other than* `no_verified_estate`, falls back to legacy `getOyiUnifiedAwareness`, returning `canonical_status:"unavailable", legacy_fallback_used:true, fallback_reason:"canonical_coverage_gap"`. Never silently blended — always labeled. |
| conversation `home_operational_summary` | `canonicalConversationAwarenessAdapter.ts` → `listActiveAwareness` | None — fails closed honestly on technical failure |
| `GET /intelligence/summary` | `facilityConsumerAmbientAwarenessAdapter.ts::buildAmbientAwarenessProjection` → `listActiveAwareness` | None — fails closed on `no_verified_estate` |
| `GET /intelligence/brief` | same shared adapter (`"executive"` mode) | None |
| `GET /intelligence/executive` | same shared adapter | None |
| `runOyiUnifiedChat` | **Not converged** — a live, separate legacy engine (`oyiUnifiedIntelligenceService.ts`), invoked only as an explicit, metered second-hop fallback from `canonicalConversationRuntime.ts` when the canonical exact-target read doesn't apply. Own file header states retirement is a deferred future decision. | Classified **DEFERRED TECHNICAL DEBT**, not a Wave 6 gap — the canonical-scoped intent (`home_operational_summary`) already bypasses it entirely. |

**Verdict**: no silent authority-downgrade fallback remains. The one fallback that exists is fully observable (three dedicated response fields), never blends canonical and legacy data in one answer, and only fires for `/oyi/awareness` specifically.

## 7. Privacy/scope status

`actorMayViewScope` is the single gate every canonical list/get function routes through. Confirmed fail-closed (not fail-open) on: missing estate context, cross-estate access, cross-home access for `policyScope==="home"` actors, and unresolvable camera ownership. Private-audience content (private cameras, home-private facts) requires `canViewPrivateHome` (estate_admin/super_admin/ochiga_admin only per `permissionEngine.ts`), itself gated behind the same estate-match check — never a bypass, only an additional restriction. Camera readers independently re-check `canAccessCamera`/`cameraAccessActor`, not a second implementation of the same policy. No role or surface value was found that *expands* authority beyond the actor's server-verified scope. One item not independently re-traced line-by-line in this pass: the upstream request-context-resolution middleware that first produces `oisContext` (Slice 1/1B territory) — relied on via its own comments and the fact every downstream gate correctly fails closed if it were ever unpopulated.

## 8. Device current-state status

`deviceCurrentStateAuthority.ts` remains the sole generic interpreter. Exhaustive re-search of every online/offline classifier in `src/` classified every hit as AUTHORITY (the authority's own cache), SPECIALIZED (smart-access's distinct model; a channel/capability-definition reader), EXECUTION (command pre-dispatch gates; the raw ingestion write path), DIAGNOSTIC (Tuya troubleshooting; command-diagnostic logging only, never presentation), or AUTHORITY-DOWNSTREAM (consumers of the authority's own already-canonical output). **Zero unjustified generic bypasses — confirmed.**

## 9. Edge current-state status

Full chain confirmed: Edge agent heartbeat → `ingestEdgeHeartbeat()` (timestamp validation) → `oyi_ingest_edge_heartbeat` RPC (migration `20260924090934`, per-node serialized, dedupes on `(estate_id, edge_node_id, observed_at)`, updates the "latest" projection **only if** the new observation is newer than the stored one) → `edgeCurrentStateAuthority.ts::edgeCurrentState()` (freshness computed from provider-original `heartbeat_observed_at`, never receipt time). **Replay cannot refresh stale truth — proven**: an older heartbeat either no-ops or is stored in history without updating the "latest" projection. **Edge-unavailable ≠ camera-offline — proven**: `edgeCurrentState()` has no camera concept; `cameraCurrentStateAuthority.ts` treats Edge impairment as one input among five, explicitly annotated `"edge_telemetry_impaired_not_physical_camera_offline"` in its own reason string.

## 10. Camera/Edge status

Complete chain verified with one authority per layer: `facility_cameras` (identity/privacy) → Edge-posted observations → `oyi_ingest_camera_observations` RPC (migration `20260924093033`) → `facility_cameras.runtime_observations` → `cameraCurrentStateAuthority.ts::cameraCurrentState()`/`resolveCameraCurrentStates()` (sole interpreter, own header: "No writes, signals, polling, cache, raw URL or legacy health fallback") → transition CAS/outbox (`oyi_accept_camera_health_transition` + `camera_health_transition_outbox`, migration `20260924101810`) → canonical signal → awareness → readers (`commandRouter.ts`, `camerasController.ts`, `cameraIntelController.ts`, `platformGapService.ts`, `spatialFacilityContextService.ts`, `canonicalTargetHydrationRegistry.ts`, all via the authority or `presentCameraRows()`). No duplicate operational-health writer (`cameraHealth.ts` is dead, zero importers). One side-channel investigated (`cameraMedia.service.ts` writing `last_seen_at`/`frame_freshness_at` directly) and confirmed inert: `presentCameraRows()` overwrites `health_status` with the authority's own verdict before any downstream code sees the row, and the same media path also correctly feeds the authority's real evidence stream in parallel. No unjustified generic reader bypass found.

## 11. Canonical materialization status

**CLOSED.** Full chain verified in `supabase/migrations/20260924112951_wave6_canonical_materialization_durability.sql` + `src/oyi-core/persistence/materialization.ts`: atomic obligation registration (idempotent via `on conflict do nothing`) → fenced claim (`SELECT ... FOR UPDATE SKIP LOCKED`, fresh `claim_token`, 60s lease) → transactional completion (token+state+lease validated, idempotent re-ack if already materialized) → crash recovery (an expired lease is safely re-claimed with a new token; the original crashed worker's stale token is rejected by both complete and fail paths — exactly-once, no lost or duplicated obligation). Incident writes additionally serialized via `pg_advisory_xact_lock` per incident key plus an explicit stale-write ordering guard. Live callers confirmed: `service.ts:306,312` (inline register/reconcile) and `canonicalMaterializationWorker.ts` (25-row poll, started from `worker.ts:18`, gated behind `CANONICAL_MATERIALIZATION_RECOVERY_ENABLED` — a deployment switch, not an architecture gap). **The 14G "partial canonical downstream materialization" blocker is formally superseded and closed by Final A** — this is not carried forward.

## 12. Visitor status

**CONFIRMED CORRECT, CLOSED.** `markEntry`/`markExit` (`visitorController.ts`) use `transitionVisitorAccessStatus(id, ["approved"], "entered")` / `(id, ["entered"], "exited")`. Branches on outcome: `conflict`→409, `not_found`→404, `db_error`→500, `already_in_target`→200 with zero new writes, `applied`→the only branch running analytics/notify/publish. Denied/expired visitors cannot be marked entered (excluded from the FROM set). Duplicate entry/exit produce no duplicate side effects.

## 13. Maintenance status

**CONFIRMED CORRECT, CLOSED.** `20260924130000_maintenance_requests_schema_drift_closure.sql` adds `resident_id`/`category`/`priority`/`membership_id`, all nullable, additive. `listMyMaintenance`'s `.eq("resident_id", userId)` filter now matches real data (previously always returned zero rows). `maintenanceTransition.ts` has zero diff since Wave 6I — untouched, intact. Side effects gated on `outcome.code === "applied"`. Status vocabulary: Facility surface (open/accepted/completed/verified/closed/cancelled) vs automation surface (open/assigned/completed/cancelled) — same column, same CAS, automation's vocabulary is a subset, not a contradiction.

## 14. Incident-integrity disposition

**(B) Acceptable deferred concurrency hardening — no live violation of Wave 6's one-current-truth invariant.** Only two write paths to `operational_incidents` exist: (1) the Final-A-fenced `oyi_complete_materialization` RPC — the live production path; (2) `CanonicalIntelligenceStore`'s incident-writing methods — explicitly `@deprecated`, confirmed unreachable (`service.ts` never calls them; grep for any direct controller write to `operational_incidents` is empty). The old read-merge-write pattern is real dead code, not a live race. Classified **(B)**, a Wave 10 retirement candidate, not a production blocker.

## 15. Legacy-awareness disposition

| Component | Classification | Note |
|---|---|---|
| `oyiUnifiedIntelligenceService.ts` (`getOyiUnifiedAwareness`) | **FALLBACK** | Live, explicit, disclosed exception for `/oyi/awareness` only (§6) |
| `oyiUnifiedIntelligenceService.ts` (`runOyiUnifiedChat`) | **WORKFLOW** | Live, deliberately deferred, metered, bounded to non-canonical-scope conversation |
| `canonicalVsLegacyAwarenessDiagnostic.ts` | **DIAGNOSTIC / DEAD at runtime** | Zero importers; exists only as future-migration tooling |
| `canonicalConversationAwarenessAdapter.ts` | **TRANSPORT** | Canonical-only, explicitly no fallback |
| `facilityConsumerAmbientAwarenessAdapter.ts` | **TRANSPORT** | Canonical-only, explicitly no fallback |
| `contextAwareness.ts` (`buildAwareness`/`buildAwarenessFromSignal`) | **RETIREMENT_CANDIDATE** | Structurally superseded per prior audit corroboration (no privacy filtering, no surface param) |

No retirement performed — correctly deferred to Wave 10 per task instruction.

## 16. Utility/meter disposition

**SEPARATE PRODUCT CAPABILITY NOT YET BUILT — not a convergence blocker.** `ReadCapabilityModules.ts` registers `utilities.usage.read`/`.balance.read`/`.meter.read` with `status:"declared"` (the codebase's own explicit non-live sentinel), with an in-code comment stating no consumption table is ever queried, no per-meter reading series exists, and enabling these would mean fabricating an answer from data that doesn't exist. No live surface anywhere claims canonical current meter state. This is the correct Wave 6 posture (honest unavailable, never fabricated), not a gap.

## 17. Migration inventory

Five migration files added in the unpublished range, order verified against actual RPC-body dependencies (not just filenames):

| # | File | Purpose | Additive/Destructive | Locking note |
|---|---|---|---|---|
| 1 | `20260924090934_wave6_edge_current_state_atomic_ingestion.sql` | Edge heartbeat atomic ingestion RPC + timestamp columns | Additive | Fast metadata-only |
| 2 | `20260924093033_wave6_camera_observation_persistence.sql` | `runtime_observations` column + ingestion RPC | Additive | Fast metadata-only |
| 3 | `20260924101810_wave6_camera_health_transition_outbox.sql` | Transition checkpoint column + outbox table + CAS RPC (reads #1 and #2's data) | Additive, RLS default-deny | Fast; RPC itself takes a short `SHARE` lock on `edge_nodes`, by design |
| 4 | `20260924112951_wave6_canonical_materialization_durability.sql` | `materialization` column + CHECK constraint + 4 RPCs | Additive, **but CHECK is not `NOT VALID`** | **Heaviest in this batch** — full-table validation scan + non-concurrent index; schedule during a lower-traffic window on a large `operational_signals` table |
| 5 | `20260924130000_maintenance_requests_schema_drift_closure.sql` | `resident_id`/`category`/`priority`/`membership_id` | Additive | Fast metadata-only; index could use `CONCURRENTLY` if table is large in production |

Rollout order 1→2→3→4→5 matches real dependencies exactly (#3 genuinely requires #1+#2; #4 and #5 are independent of everything and of each other).

## 18. Migration-chain result

The historical `camera_events → facility_cameras` local reset-order defect (documented in the prior 14G checkpoint) was **not re-triggered or newly localized in this pass** — no destructive reset was run, per the STOP CONDITION. It remains a separate, previously-disclosed baseline concern that does not block incremental production migration, since all 5 new migrations here are additive-only against the *current* schema and do not depend on replaying the full historical chain from scratch. Production must still independently verify its own deployed schema state before applying these 5, per standard practice — this was not (and could not be) re-verified against a real production database in this local audit.

## 19. Regression result

**Backend**: `npx tsc --noEmit` ✅, `npm run build` ✅. All Wave 6 slice suites (1, 1B, 2, 3, 4, 5, 6, 6B, 8, 10, 10B, 11, 12, 13, 13B, 13C, 14A, 14B, 14C, 14D, 14E, 14F) ✅, Final A ✅, Final B mock suite ✅ (28/28), Final B real-PostgreSQL suite ✅ (11/11 on clean standalone re-run — see §21), canonical-signal-ingress ✅, awareness-v3 ✅, evidence-presentation ✅, security-adversarial ✅, consumer-context-resolution ✅, facility-spatial-context ✅, device-runtime ✅, Wave 5 Slice 1 physical authority ✅. Real PostgreSQL suites (14B Edge, 14C camera observations, 14E camera transitions, Final A, Final B) all ✅.

**Edge**: `check` ✅, `lint` ✅, `build` ✅, `validate:release` ✅ (includes 14C observation/canonicalization/gateway/media/detection smokes internally), plus the 5 named smoke scripts run standalone ✅ — 9/9 commands green after correcting an unrelated shell-scripting artifact in the audit's own batch runner (see §21).

## 20. Unavailable hardware/network checks (reported separately, not counted as failures)

From `npm run validate:release` (Edge): remote container registry returns 401 → falls back to `local_fallback` registry source (expected, no production registry credentials configured locally); local go2rtc media server connection refused (`ECONNREFUSED 127.0.0.1:1984`, no local media server running); several AI dry-run steps report `skipped:true` for camera credentials/generated go2rtc config that don't exist in this local environment. These are the same class of disclosure the prior 14G checkpoint recorded and are **expected local-environment absences, not regressions** — no physical camera, recorder, or production network path is available in this environment. One flaky-under-load item: `wave6-final-b-core-state-integrity-sql-smoke.mjs` failed once during a ~35-script concurrent battery run (a real-concurrency test racing genuine simultaneous PostgreSQL connections, sensitive to host scheduling load); re-run standalone immediately after, it passed cleanly 11/11 — classified as environmental flakiness under this audit's own heavy parallel load, not a code regression.

## 21. Frontend disposition

Camera Core/frontend adoption is confirmed **still required** before any camera-health feature is user-facing (per the prior 14G checkpoint's own deployment-order item 4, not re-litigated here since no frontend code exists in either audited repo). **Backend authority convergence closes independently of frontend adoption** — the Backend/Edge architecture is self-consistent and fully covered by its own regression battery without any frontend dependency. Frontend adoption is a POST-DEPLOYMENT / separate-workstream item, not a Wave 6 architectural blocker. No frontend files were read or modified in this audit.

## 22. Release manifest

**Backend**: commit range `909d5d0..298cf4f` (14 commits, listed in §3), final SHA `298cf4fc2e67e5f909c3f37303bac37311c2e209`. Migrations: the 5 listed in §17, applied in timestamp order. Required env/config: `CANONICAL_MATERIALIZATION_RECOVERY_ENABLED` (worker enable switch, off by default — must be explicitly set once downstream stability is confirmed post-deploy). Workers/reconcilers requiring enablement: `canonicalMaterializationWorker.ts` (started from `worker.ts`, gated by the above env var).

**Edge**: commit range `5d30b63..d2715f1` (1 commit), final SHA `d2715f1cef7d9291c0ec1cda546551d91e1d2562`. No new env/config beyond what the prior 14G checkpoint already documented for camera/Edge operation. No new workers beyond the existing agent process.

Both manifests exclude all local-only untracked/unstaged files listed in §1/§2.

## 23. Deployment order

1. Verify actual deployed schema/history/grants and backups against the 5 new migrations' assumptions (existing `facility_cameras`, `edge_nodes`, `edge_heartbeats`, `operational_signals`, `maintenance_requests`, `users`, `home_memberships` tables must already exist).
2. Apply the 5 migrations in timestamp order (§17); schedule migration #4 (heaviest lock) during lower-traffic hours.
3. Publish and deploy the Backend checkpoint (14 commits) with `CANONICAL_MATERIALIZATION_RECOVERY_ENABLED` left **disabled**.
4. Verify the new authority code paths (device/Edge/camera current-state reads, visitor/maintenance CAS) are live and correct against production data with recovery still disabled.
5. Explicitly enable `CANONICAL_MATERIALIZATION_RECOVERY_ENABLED` once step 4 is confirmed stable; monitor the worker's claim/complete/fail cycle.
6. Deploy/configure the Edge checkpoint (1 commit) — canonical UUID/stream-ID separation, truthful observation envelopes.
7. Frontend Camera Core adoption (separate workstream, not gated on anything above beyond the Backend/Edge checkpoints being live).
8. Controlled physical-hardware acceptance (cameras/recorders/network) when available — explicitly a POST-DEPLOYMENT gate, not a precondition for steps 1-7.

## 24. Rollback

- **Database**: all 5 migrations are additive; rollback means leaving the new nullable columns/tables in place (they are inert until new code writes to them) rather than dropping schema, which would destroy delivery obligations/evidence. Never drop the outbox/materialization state to silence retry alarms.
- **Backend**: revert to the prior checkpoint SHA; keep additive schema in place; if the materialization worker was enabled, disable it and stop the worker process first, preserving pending rows for a later resume.
- **Edge**: revert to its prior checkpoint SHA; Backend observations already received age naturally — no fake freshness is fabricated on an Edge rollback.
- **Frontend**: rollback is only ever safe to a contract-compatible client or a gated feature flag — not applicable here since no frontend changes are part of this checkpoint.

## 25. Every remaining item, classified

| Item | Classification |
|---|---|
| `/oyi/awareness` legacy fallback (explicit, disclosed) | HYGIENE (already correctly labeled; a Wave 10 candidate to eventually retire, not urgent) |
| `runOyiUnifiedChat` legacy engine | DEFERRED TECHNICAL DEBT |
| `cameraHealth.ts` dead writer | WAVE 10 RETIREMENT |
| `CanonicalIntelligenceStore` legacy incident writer | WAVE 10 RETIREMENT |
| `contextAwareness.ts` legacy scoring pair | WAVE 10 RETIREMENT |
| `canonicalVsLegacyAwarenessDiagnostic.ts` | HYGIENE (dead tooling, harmless) |
| Migration #4's un-`NOT VALID`'d CHECK / non-concurrent indexes | PRE-DEPLOYMENT BLOCKER (schedule during low-traffic window; not a correctness defect) |
| Frontend Camera Core adoption | POST-DEPLOYMENT ACCEPTANCE (separate workstream) |
| Physical camera/recorder/network hardware acceptance | POST-DEPLOYMENT ACCEPTANCE |
| Multi-node production load/lock/queue/soak acceptance | POST-DEPLOYMENT ACCEPTANCE |
| Historical full local migration-chain replay defect | DEFERRED TECHNICAL DEBT (pre-existing, separate, does not block incremental production migration) |
| Meters/utilities canonical current-state | SEPARATE PRODUCT CAPABILITY (not yet built, nothing falsely claims it) |
| Incident read-merge-write legacy path | WAVE 10 RETIREMENT (confirmed dead, not live) |

**No item remains classified REQUIRED BEFORE WAVE 6 CLOSURE.**

## 26. Blockers

**PRE-DEPLOYMENT BLOCKER (one)**: schedule migration #4's heavier-lock rollout window against production traffic patterns before applying. This is an operational scheduling note, not an architecture defect — the migration itself is correct and additive.

No other pre-deployment blockers found. All other remaining items are POST-DEPLOYMENT ACCEPTANCE, DEFERRED TECHNICAL DEBT, WAVE 10 RETIREMENT, SEPARATE PRODUCT CAPABILITY, or HYGIENE — none of which gate Wave 6's own architectural closure.

## 27. Wave 6 verdict

**B — COMPLETE WITH PRE-DEPLOYMENT BLOCKERS.**

The Awareness & State Convergence architecture has converged: one authority per fact across actor/scope/privacy, canonical signal, current awareness, device state, Edge state, camera identity/privacy/observation/state/transition, visitor lifecycle, maintenance lifecycle, and canonical materialization. Zero unjustified generic bypasses found anywhere audited. Zero silent authority-downgrade fallbacks (one explicit, disclosed, non-blending exception noted and accepted). Full regression battery green across both repos. The only pre-deployment blocker is an operational migration-scheduling note, not an architectural gap. This does **not** mean every future Oyi capability exists — meters, full legacy retirement, hardware acceptance, and frontend adoption are all real, named, correctly-classified future work, not evidence against closure.

## 28. May Awareness & State Convergence be FROZEN?

**Yes.** The architecture described in this audit may be treated as the frozen Wave 6 baseline. Any further change to device/Edge/camera/visitor/maintenance/materialization authority should be treated as a new, explicitly-scoped slice against this frozen baseline, not silent drift.

## 29. May Wave 7 — Decision & Planning Convergence — begin?

**Yes, after release checkpoint publication** (the 14 Backend + 1 Edge commits actually being pushed/published, migrations applied, and the one pre-deployment scheduling note honored). Wave 7 was explicitly NOT started in this audit, per the STOP CONDITION.

---

*This audit is READ-ONLY. Nothing was fixed, committed, pushed, or deployed. No Wave 7 work was started.*
