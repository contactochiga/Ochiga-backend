# Wave 11 Brain Behavioural Certification — Final Convergence

## 1. Executive certification

**BRAIN CERTIFIED WITH NON-BLOCKING DEBT.**

The Wave 11 behavioural-hardening branch has been rebased cleanly onto current authoritative Backend `main` (which now includes PR #93's socket/unhandled-rejection reliability fix), re-verified against a freshly recreated isolated Supabase fixture (schema dropped and replayed from the authoritative migration/baseline sequence, not a reused/dirty instance), and re-run through the complete frozen 132-turn behavioural corpus. The converged candidate reproduces the exact documented checkpoint: **131 PASS / 1 FAIL / 0 BLOCKED**, zero P0, zero structural P1. The one remaining failure (`utilities.usage.read`) is a genuinely unimplemented, honestly-declared capability — accepted product/capability debt, not a brain defect, and was **not** implemented merely to obtain 132/132. The PR #93 reliability guard set (socket lifecycle protection, fire-and-forget audit-signal safety, structured unhandled-rejection telemetry) is present and verified intact: the 10-boundary crash matrix survives 10/10 on the converged branch.

## 2. Final authoritative candidate SHA

- **Converged Wave 11 HEAD:** `7eb89cfd92c0c12b9359fba4ffd68bb56be0b766`
- **Rebased onto origin/main:** `e8e17ec1591b9e141a5c94d7994950c151bee1dd` (PR #93 merge)
- **Branch:** `codex/wave11-brain-behavioural-hardening`
- **Pre-rebase safety tag (local):** `backup/wave11-pre-rebase-f58e90a` → `f58e90a6e6c889737840e84513a9cbf7096d87a0`

## 3. One-Core architecture statement

A direct search of the live route surface confirms a single conversational authority. Both HTTP conversational entry points call the same orchestrator:

- `src/routes/oyiRoutes.ts` `POST /chat` and `POST /runtime/conversation` → `conversationOrchestrator.run(...)`
- `src/routes/aiRoutes.ts` `POST /chat` → `conversationOrchestrator.run(...)`
- `src/routes/officeExport.ts` also imports `conversationOrchestrator` (Office delegates, does not reason independently)

`runOyiUnifiedChat` (in `src/services/oyiUnifiedIntelligenceService.ts`) has **zero callers** anywhere in the codebase outside its own file's internal comments — it is dead code, not restored, not wired into any live path. The only symbols imported from that file elsewhere (`oyiRoutes.ts`) are `getOyiConversationMessages`/`listOyiConversationThreads`, pure read helpers for displaying conversation history, not reasoning.

`commandRouter`-named modules present in the tree (`DeviceCommandAuthority.ts`, `permissionEngine.ts`, `watchAdapterService.ts`, `residentActionBatchExecutionService.ts`) are device-command **dispatch/authority** layers invoked *by* capabilities the canonical Core selects — none of them independently interpret natural language or compete with `ConversationOrchestrator` for reasoning authority.

No provider-backed general chat-completion call site (`openai.chat`, `generateChatCompletion`, `callOpenAI` or equivalent) exists anywhere in `src/` for the assistant's own reasoning; the only LLM-adjacent surface (`knowledgeRetrieval`) is a narrow, bounded FAQ/knowledge lookup, not a competing brain.

Legacy/compatibility bridges (`legacyFallback`, `canonicalUnavailableFallback`, `business_surface.fallback`) remain bounded: each is reached only when no canonical capability matches, and each returns a terminal, honest "unsupported" response — none re-enters a second reasoning system.

## 4. Worker/surface authority model

| Worker | Domain | Delegates to Core |
| --- | --- | --- |
| **Osa** | Public-safe corporate/qualification/handoff | Yes — `public_corporate` surface, same `conversationOrchestrator.run()` |
| **Oma** | Business/CRM/development/Office operations | Yes — `office_internal` surface, same orchestrator |
| **Facility** | Estate/building operational intelligence | Yes — `facility` surface, same orchestrator |
| **Consumer** | Home/resident intelligence and governed control | Yes — `consumer` surface, same orchestrator |

All four are surface-scoped manifestations of the same `ConversationOrchestrator` instance, differentiated only by `surface` (and resulting capability/authority scoping), not by separate reasoning engines. This was verified structurally (route imports) and behaviourally (all four surfaces pass through the identical 132-turn harness against the identical Core entry point).

## 5. Capability inventory (recomputed from converged code, not assumed)

Recomputed live against the converged build via `capabilityRegistry.all()`:

- **Total registered:** 78
- **Enabled:** 73
- **Declared (not enabled):** 3 — `utilities.usage.read`, `utilities.balance.read`, `utilities.meter.read`
- **Implemented (intermediate status):** 1 — `messages.unread.read`
- **Shadow:** 1 — `reports.period_summary.read`
- **Read-shaped:** 71 · **Action-shaped:** 7
- **Risk class:** `read` 71 · `low_risk_action` 3 · `consequential_action` 4
- **Confirmation policy:** `none` 71 · `explicit_confirmation` 7
- **By supported surface:** `consumer` 41 · `office_internal` 29 · `facility` 22 · `public_corporate` 8 (capabilities may support more than one surface)
- **By domain:** 32 distinct domains, spanning devices/wallet/utilities/visitors/maintenance/security/scenes/automations/rooms/home/reports (Consumer/Facility) and crm/office_tasks/office_meetings/office_support/office_portfolio/corporate_partnerships/corporate_opportunity/etc. (Office/Osa)

`utilities.usage.read` is confirmed `rolloutStatus: "declared"` in the live registry — not fabricated, not silently promoted. This number (78) supersedes any prior assumed figure; it was recomputed, not carried forward.

## 6. Isolated fixture architecture

- Local Supabase project `wave11-behavioural-fixture`: API `http://127.0.0.1:55421`, database port `55422` — separate from the pre-existing local dev stack and from production.
- **This convergence performed a full clean replay, not a reuse of prior state:** `DROP SCHEMA public CASCADE` (173 objects dropped) → `CREATE SCHEMA public` → replay `migrations/schema.sql` → `supabase/migrations/20260521000100_pilot_onboarding_foundation.sql` (documented retained-compatibility foundation, supplies `facility_cameras` and other pre-March prerequisites) → `supabase/baselines/verified-production-prerequisites.sql` → all 119 tracked migrations in lexical order → `supabase/baselines/verified-production-compatibility.sql` → `scripts/wave11-behavioural-fixture-seed.sql` (synthetic data only).
- Verified zero rows in `estates`/`homes`/`users`/`devices`/`oyi_conversation_threads` immediately after the migration replay and before seeding — proving no dirty carryover.
- After seeding: exactly 1 estate, 3 homes, 6 users, 4 devices, 2 visitor-access records, 2 maintenance requests, 1 wallet, 2 wallet transactions — matching the documented fixture shape exactly.
- One operational note: dropping/recreating the `public` schema also drops the platform-level default privilege grants Supabase normally establishes once per project; these were reapplied explicitly (`GRANT`/`ALTER DEFAULT PRIVILEGES` for `service_role`/`anon`/`authenticated`) after the schema was rebuilt. This is a fixture-bootstrap operational detail, not an application-schema or migration defect.
- Queue/Redis transports are stubbed in-process for the harness; Core, capability registry, authority, Supabase persistence and evidence readers are the real production code paths, not mocked.

## 7. Production-target safety proof

Tested directly before running any behavioural turn: pointing the harness at `SUPABASE_URL=https://zcpgtdakqxyvjkmiibei.supabase.co` (the real production project reference) causes an immediate, unconditional throw — `"Wave 11 fixture refuses a non-isolated or production Supabase URL"` — before any request is issued. The refusal check matches both the exact isolated-URL allowlist and a direct substring check for the production project ref, so it cannot be bypassed by URL obfuscation. No production credentials were used or required at any point in this convergence.

## 8. 132-turn result

**131 PASS / 1 FAIL / 0 BLOCKED**, verified stable across 3 consecutive full-corpus runs against the freshly replayed fixture, exit code correctly nonzero (1 failure present).

## 9. Results by surface

| Surface | Turns | PASS | FAIL | BLOCKED |
| --- | ---: | ---: | ---: | ---: |
| Public/Osa | 23 | 23 | 0 | 0 |
| Office/Oma | 31 | 31 | 0 | 0 |
| Facility | 27 | 27 | 0 | 0 |
| Consumer | 51 | 50 | 1 | 0 |
| **Total** | **132** | **131** | **1** | **0** |

## 10. Persistence result

**132/132** — every turn reported `persistence_saved: true` against the freshly replayed isolated database.

## 11. Privacy/authority result

Zero P0 findings across the full corpus (all 1 remaining failure classifies as EVIDENCE, not PRIVACY or AUTHORITY). Cross-home adversarial probe (Resident B against Resident A's devices, wallet, visitor history, maintenance records, cameras/security, and a direct device-ACTION attempt) — zero leakage, zero unauthorised execution across every probe; every response was an honest denial, empty result, or clarification request. Production-target refusal proven per §7.

## 12. Workflow/confirmation result

Required continuity journey proven end-to-end via direct probe: "What's happening at home?" → governed summary; "Which devices are offline?" → authorised result set; "Tell me about the second one." → exact device; "Turn it off." → clarification when ambiguous, governed proposal once resolved; "No, the bedroom one." → resolves the clarification by room reference (fixed this slice: the clarification continuation no longer treats a room-name answer as an unrelated domain switch); "Actually, don't." → cancels the real pending action; "Turn it off." → fresh proposal; "Yes." → confirms only the current proposal. Verified: a bare confirm/cancel with nothing pending does nothing (honest "nothing pending" response, not silent failure or the generic fallback); a stale/absent action state is never silently confirmed; confirmation never applies across devices/homes/domains.

## 13. Cross-domain continuity result

Office/Oma business-object continuity (draft → shorten → send-proposal → cancel → re-propose → confirm) and Consumer device-clarification continuity both verified intact post-convergence. Office/CRM domain keywords (`crm`, `office_tasks`, `office_meetings`, `office_support`, `office_portfolio`, `corporate_partnerships`) remain present in the shared cross-domain-switch resolver, unaffected by the rebase (no upstream changes touched this file).

## 14. Osa (Public) objective result

23/23. The short-lived `public_opportunity_objective` conversational-objective mechanism (progressive JV/technology-inquiry qualification without re-asking known facts) verified via `wave11-public-opportunity-generalization-smoke.mjs` on the converged branch — PASS, including two alternate synthetic journeys using no literal required-journey vocabulary.

## 15. Oma (Office) business-continuity result

31/31. The DRAFT ARTIFACT contract (draft → shorten → send → cancel → resend → confirm, as a fourth state kind distinct from RESULT SET/ACTIVE BUSINESS OBJECT/PENDING GOVERNED ACTION) verified intact; `office-internal-surface-smoke.mjs` PASS on the converged branch.

## 16. Facility operational result

27/27. `facility-canonical-ref-resolver-smoke.mjs` PASS on the converged branch; no Facility-specific files were touched by this convergence beyond what the original Wave 11 Facility commit (`89e01f0`) already contained.

## 17. Consumer result

50/51. All structural Consumer fixes from the prior slice (workflow thread-id reconciliation, broadened confirm/cancel phrasing, capability-selection gaps, bare-instruction/confirm/cancel honesty, condense-the-previous-answer) verified intact. One additional fix was required **during this convergence's clean-replay verification** (see §21) to restore the exact documented checkpoint after the fresh fixture data exposed a follow-up-resolution bug that a long-running, previously-dirty fixture had been masking.

## 18. Reliability regression result

PR #93's 10-boundary socket-unhandled-rejection crash matrix (`auth_db`, `auth_fail_audit`, `subscribe_estate_deny`, `subscribe_user_deny`, `subscribe_room`, `subscribe_home`, `subscribe_device`, `subscribe_thread`, `scope_replace_home`, `disconnect`) run in `--guarded` mode against the converged branch's compiled server: **10/10 survived**. Verified present: `emitSignalSafely` (fire-and-forget audit-signal safety), `safeSocketHandler` (guards every protected async socket listener, 8 occurrences in `server.ts`), and structured plain-object `unhandledRejection` telemetry (`logger.error("unhandled_rejection", { reason: ... })`, never re-throws). No secret literal was introduced by the reliability changes (scanned the full PR #93 diff against `origin/main`'s base). `package.json`/`package-lock.json` are byte-identical between the converged branch and `origin/main` — Wave 11 never touched dependencies, so PR #93's dependency additions carried through the rebase untouched.

## 19. P0/P1/P2 debt

- **P0:** zero.
- **Structural P1:** zero.
- **P2 (non-blocking, explicitly accepted):**
  - `utilities.usage.read` genuinely unimplemented (declared, not enabled) — no evidence loader exists anywhere in the codebase for utility usage metering; implementing one now would be fabricating capability behaviour to force a green test, which this and the prior slice's instructions explicitly forbid.
  - Ordinal vocabulary (generic follow-up resolver) still caps at first/second/third/last/latest/oldest — a fourth/fifth ordinal reference falls through to an honest "nothing selected" response rather than a precise range statement. Pre-existing, cross-surface, not touched this slice.
  - Room-name device-clarification resolution reaches the governed clarification loop correctly but does not always resolve to a single device from a bare room reference alone.

## 20. BLOCKED/SKIPPED validations

- `business-surface-capability-smoke.mjs`: **BLOCKED** — requires a live Redis instance at `127.0.0.1:6379`, not present in this environment. Reproduced identically BLOCKED on a clean `origin/main` worktree (same missing dependency, unrelated to Wave 11). Not counted as PASS.
- `oyi-workflow-durable-continuation-smoke.mjs`: **FAIL** — pre-existing assertion failure (`0 !== 1`, confirmation not executing) reproduced identically on a clean `origin/main` worktree before any Wave 11 or convergence change was applied. Confirmed non-regression, not fixed (out of this slice's scope — a device-workflow test-harness authorization-clearing interaction unrelated to anything touched by Wave 11 or PR #93).

Neither is counted as PASS; both are reported honestly as their own distinct status.

## 21. Remaining product capability debt

`utilities.usage.read` remains the sole accepted capability gap (see §5, §19). No expectation was silently altered to hide it — the frozen harness's own generic "unavailable" scoring regex correctly and honestly marks this turn FAIL, and it is left that way.

**Documented mid-convergence correction** (transparency, not a silent expectation change): the clean isolated fixture replay (§6) initially produced 132/132 instead of the expected 131/1. Investigation traced this to a real bug — `parseFollowUpIntent`'s bare `/\bhow much\b/` pattern was hijacking "How much electricity have I used?" against the wallet result set planted by the immediately preceding turn, answering with an unrelated wallet transaction's cost instead of reaching the honestly-declared-unavailable `utilities.usage.read`. This is not a case of "test expects nonexistent truth" (§9's governing principle) — it is the opposite: the system was fabricating a plausible-looking answer instead of being honest about unavailable evidence. Fixed by excluding the bare "how much" follow-up pattern when the message names its own utility topic (commit `7eb89cf`). This restored the exact documented, previously-verified checkpoint; it did not change what is expected, it corrected the code to match what was already correctly expected and previously verified in the prior slice (against a since-superseded, longer-running fixture instance that had not exposed this interaction).

## 22. Exact validation commands

```
npm run typecheck
npm run build
WAVE11_FIXTURE_MODE=live SUPABASE_URL=http://127.0.0.1:55421 OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY=<local-fixture-service-role-jwt> node scripts/wave11-behavioural-torture-harness.mjs
node scripts/wave11-intent-capability-contract-smoke.mjs
node scripts/wave11-terminal-persistence-guard-smoke.mjs
node scripts/wave11-public-opportunity-generalization-smoke.mjs
node scripts/socket-unhandled-rejection-matrix.mjs --guarded
node scripts/wave9-capability-inventory.mjs
node scripts/oyi-programme4-authority-privacy-closure-smoke.mjs
node scripts/oyi-security-adversarial-smoke.mjs
node scripts/wave6-slice1-privacy-boundary-smoke.mjs
node scripts/wave9-context-authority-smoke.mjs
node scripts/wave9-product-authority-smoke.mjs
node scripts/wave9-memory-context-smoke.mjs
node scripts/consumer-context-resolution-smoke.mjs
node scripts/device-memory-smoke.mjs
node scripts/office-internal-surface-smoke.mjs
node scripts/corporate-public-integration-smoke.mjs
node scripts/facility-canonical-ref-resolver-smoke.mjs
node scripts/wave5c-consumer-device-authority-smoke.mjs
git diff --check origin/main HEAD
git diff origin/main HEAD -- src/ scripts/ | grep -iE 'api[_-]?key|secret|password|bearer|service_role|private[_-]?key'
```

Production-target refusal proof: run the harness with `SUPABASE_URL` set to the production project reference — it must throw immediately (§7).

## 23. Exact commits

Rebased Wave 11 commit list (`origin/main..HEAD`, `e8e17ec1591b9e141a5c94d7994950c151bee1dd..7eb89cfd92c0c12b9359fba4ffd68bb56be0b766`), oldest first:

```
b29a232 Wave 11: harden semantic capability and terminal persistence contracts
cf132f1 Wave 11: add non-destructive behavioural torture harness
4a0766c Wave 11: record behavioural hardening baseline
ffe29ef Wave 11: correct visitor evidence and follow-up authority collisions
5ac926a Wave 11: activate isolated 100-turn Core fixture and record failures
7ca5029 Wave 11: route target-first device commands to governed control
6355935 Wave 11: extend isolated harness with deep and cross-home journeys
89e01f0 Wave 11: recover Facility overview/camera evidence and follow-up resolution
582090e Wave 11: eliminate the 14 Public/Osa structural failures via a canonical short-lived conversational objective
28db85b Wave 11: eliminate the 10 Office/Oma structural failures via a DRAFT ARTIFACT contract and honest evidence responses
5a08b20 Wave 11: eliminate 14 of 15 Consumer structural failures via honest continuity handling and a workflow thread-id fix
7eb89cf Wave 11: fix a follow-up hijack exposed by clean isolated fixture replay
```

12 commits, 31 files changed, 2222 insertions(+), 53 deletions(-) relative to `origin/main`. Zero merge conflicts occurred during the rebase (documented in lieu of a conflict log, since none arose — the Wave 11 diff and PR #93's diff touch entirely disjoint files).

## 24. Production impact statement

No production database, credentials, deployment, or authoritative branch was touched by this convergence. All schema/migration replay, seeding, and behavioural testing ran exclusively against the disposable, isolated `wave11-behavioural-fixture` local Supabase stack. Production-target refusal was proven, not assumed (§7). No migrations were added by Wave 11 (§ pre-convergence audit: zero files under `supabase/migrations/` in the Wave 11 diff). `package.json`/`package-lock.json` are identical to `origin/main` — no new production dependency was introduced by Wave 11. This branch has **not** been merged and **not** been deployed; both remain explicitly withheld pending human approval.
