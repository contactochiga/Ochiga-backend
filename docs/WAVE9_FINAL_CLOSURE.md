# Wave 9 convergence review — NOT CLOSED

2026-09-26. This is a durable progress and blocker record, not a declaration of completion. No lost Claude cloud commit was recovered or reconstructed. Work starts from durable GitHub source. No Wave 10 work or deployment occurred.

## Authoritative branches (reverified)

### Latest checkpoint — migration-authority and dependency review

This section supersedes older counts and limitations below, which remain historical snapshots. Backend implementation checkpoint `c5b7531ea14be9b1ba28cd7a04c77afbfacea91a` is pushed; the documentation commit containing this entry is its successor (resolve with `git log -1 --format=%H -- docs/WAVE9_FINAL_CLOSURE.md`). Office development remains `e4b6f3a59d552bbf7e5289b38d1c899dea9ea0b8`; Facility development is `d6b87f08a3273a2f9b1fd5bed7549c70cf481aa9`; Twin development remains `2862dba4780b655de17b0a21ecb4c635fef8d9be`. All are remote-reachable. The four authoritative branch HEADs in the table below remain unchanged. No merge/deployment occurred.

Migration authority: see `WAVE9_CAMERA_MIGRATION_AUTHORITY_FINDING.md`. The March camera-event migration references a table before the first retained May creation. Production's retained May `CREATE TABLE IF NOT EXISTS` does not prove it created the existing table. Original creation provenance remains unknown. Production has 41 camera columns but neither `home_id` nor `privacy_scope`; the DVR registry script is outside the Supabase chain and its table is absent in production. A narrowly scoped forward migration, `20260926205543_wave9_camera_scope_schema_correction.sql`, adds nullable scope columns to the existing canonical table, preserves metadata and restricts direct table access to service_role. It is **not deployed**, does not create a replacement camera table, and does not repair the historical fresh-replay baseline. Isolated legacy-shape and tracked-May-shape upgrades pass; complete fresh replay and whole-schema/function/RLS equivalence remain **NOT PASS**. No applied migration was deleted or rewritten.

Validation this checkpoint:

- Backend `npm run typecheck`, `npm run build`: PASS. Sequential execution of every `scripts/wave[5-9]*smoke.mjs`: **66/66 exit 0**, including PostgreSQL suites and the new camera-schema upgrade smoke. Local-only SQL/physical-execution fixtures; no hardware proof. Harness used `node` per script, 45-second timeout, loopback Supabase and the existing local container's service credential held in process only. No production credential or data was used for these tests.
- Office `npm run check`, `npm run lint`, `npm run build`, `npm run office:test`, `npm run office:oyi-core-delegation:test`, `npm run office:communications-handoff:test`, `npm run office:knowledge-positioning:test`, `npm run security:secrets`, plus `node scripts/test-wave9-public-session.js`, `node scripts/test-wave9-plan-core.js`, `node scripts/test-wave9-authority-boundaries.js`: PASS. Expected unauthorized-request logs are negative-test evidence, not suite failures.
- Facility `npm ci --ignore-scripts`, `npm ls postcss --all`, `npm run build`, `npm run lint`, `npm run validate:release`, `node scripts/wave9-core-authority-smoke.mjs`, `node scripts/wave9-capacitor-template-smoke.mjs`: PASS. Actual resolved PostCSS is 8.5.28 throughout. Five bundled native templates extract successfully; this is compatibility, not native device validation.
- Twin `npm run build`, `npm run lint`, `npm run test:representation`, `npm run test:ingestion`, `npm run test:architecture`: PASS, including real Chrome browser verification (`errors: []`). Generated architecture JSON/PNG remain unstaged, not product changes.

Security: Facility's scoped PostCSS fix reduces five findings to **three (two high, one critical)**. An attempted tar 7 override broke Capacitor 6's actual extractor and was fully removed; critical tar remains a release gate. Backend remains **six (three high, three moderate)**; reviewed call paths narrow exposure but do not constitute remediation. See `WAVE9_AUTHORITY_SECURITY_REVIEW.md` and Facility `docs/WAVE9_DEPENDENCY_REVIEW.md`. Scoped added-diff secret review is not a universal credential guarantee.

Authority: Backend owns canonical signals, reasoning, knowledge retrieval, governed memory admission, decisions/capabilities and feedback. Office owns CRM/staff execution and bounded media/geometry adapters; Facility presents Core outputs; Twin owns deterministic spatial navigation/simulation/rendering. This trace does **not** close remaining common-context/persona adoption, Office CRM-memory retention/access review, or exhaustive per-path authority verification. No additional parallel reasoning implementation was introduced.

PRs: Backend #90 and Office #85 remain drafts. Twin/Facility creation attempts returned GitHub integration HTTP 403; local `gh` credentials are invalid. Git SSH pushes succeeded. Opening those PRs requires restored GitHub API authorization, not another source change.

Merge order is conditional, not authorization: (1) Backend #90 after migration/privacy/security/context gates and CI pass; (2) Office #85 after Core compatibility verification; (3) Twin build/browser PR; (4) Facility dependency/authority PR. Twin can be independently reviewed; Facility retains its existing durable Twin pin. After each merge rerun relevant CI against the merged branch; before deployment verify migration bootstrap/upgrade equivalence on isolated production-shaped schema, bridge authorization and Core outage behavior, native installer safety, and the complete four-repository suite. Do not deploy this order while baseline/schema truth remains unresolved.

Remaining material gates: verified historical fresh-database baseline (including community_posts), complete production schema/function/constraint/index/trigger/RLS equivalence and DVR disposition, full context/persona/CRM-memory adoption and privacy proof, dependency remediation, PR authorization and final combined CI. **WAVE 9 NOT CLOSED — WAVE 10 BASELINE NOT READY.**

### Continuation update (supersedes earlier validation limitations below)

Final unified continuation run: **65/65 Wave 5–9 smoke scripts exit 0**, including SQL suites. `c01edc8` fixes 22 hard-coded old-checkout paths; those old results were not proof of this branch. Device reader suites now exit normally (34 and 149 assertions). Wave 7 identity's unmocked ingress uses local loopback with a non-authoritative fixture key; its 7 checks prove identity behavior, not successful canonical materialization (proved separately by Final A SQL). Three physical-execution suites use local-only Supabase credentials and synthetic fixtures, not hardware. Office check/lint/build, architecture, knowledge (7), delegation, handoff and secret checks pass. High-confidence added-diff secret scan found zero candidates; not a universal secret-detection guarantee.

Facility additionally pushes `f180ece` (Next/eslint-config-next 15.5.26) with successful build/lint/release/authority validation. Five advisories remain, including critical Capacitor installer-chain tar. Backend remains six advisories (three high/three moderate). No security-clean claim.

Isolated replay **fails even after the documented schema bootstrap**: first camera-event migration references absent `facility_cameras`. See migration ledger. No schema/history repair attempted without establishing the correct bootstrap truth. All four authoritative remote heads below were reverified unchanged after development pushes.

Merge readiness: **NO**. Review order, once remaining gates pass: Backend #90 before Office #85 because Office's Plan Studio acknowledgement requires the new Core capability; Twin build/browser PR can be reviewed independently; Facility fallback/security PR follows Backend review. Facility retains its existing durable Twin pin, so these changes do not require repinning to the new Twin branch. No exact executable merge schedule is authorized by this incomplete evidence.

Backend `2d33190` adds actual governed memory recall through Core and an executable 73-capability inventory; `f5f2faf` removes vulnerable bcrypt installer/BullMQ dependency chains. Typecheck/build and focused tests pass. Actual orchestrator routing is now tested; this is not a claim of full cross-domain memory adoption. Backend audit is now six advisories, zero critical (previously 15).

Twin `2862dba` is pushed; its real Chrome architecture suite now passes, with no browser errors. Facility `10054ff` and `bfb5676` are pushed on `codex/wave9-dependency-hardening`: compatible dependency refresh and removal of five competing local-intelligence fallback loaders. Facility build/lint/release checks pass. Earlier Facility authority assessment was incomplete; the deeper trace found this genuine conflict.

Real PostgreSQL Final A, Final B and 14E pass. Wave 5 device-verification, reconciliation and consumer-authority suites also pass using local-only Supabase credentials after initial credential-gate failures. Complete all-suite rerun/CI remains outstanding. Twin/Facility PR creation still needs authenticated GitHub write access; the connector returns 403 and the in-app browser is signed out. No drafts merged.

See `WAVE9_CONTINUATION_VALIDATION.md` and `WAVE9_CAPABILITY_AUTHORITY_INVENTORY.md`. Schema equivalence/fresh migration-chain integrity, final authority/persona sweep and remaining dependency/security findings still prevent closure. The following original snapshot is retained for provenance, not as the latest test status.

| Repository | Branch | HEAD |
|---|---|---|
| Backend | main | 17e876d78d0baf19913845195e140c812075a2ec |
| Office | codex/office-extraction | 8f58aaef1263dfbd019d319651a95e8fb7617b80 |
| Facility | main | 60a0681968cedc0f303cf02b12c8964c879965f2 |
| Twin | main | fda2a27a31208541cb030c40ad26b01f1bc0fee0 |

No authoritative branch has been merged during this task. Existing Office positioning and Facility integration are retained, not reimplemented.

## New review commits

Backend draft [PR #90](https://github.com/contactochiga/Ochiga-backend/pull/90), branch `codex/wave9-final-convergence`:

| Commit | Scope |
|---|---|
| d2ae280 | Fresh audit, existing corpus product-reference completion, checkout-correct Wave 9 tests |
| 1aab6c2 | Thread actor/surface/scope ownership before hydration; public session actor separation |
| 0f4e16b | Governed resident-memory admission, bounded private context, stable null-home write identity |
| 8c7fd7e | Unverified commercial maturity source classification |
| 348f1ed | Plan Studio advisory capability in Core and actual-execution acknowledgement |
| e3cf8eb | Stale camera test fixture correction; production camera semantics unchanged |
| 598a3ff | Server-only role/permissions in presentation context; resolved memory-write error proof |
| 77d5cbf | Decision/learning tests use current checkout, not another Mac repository |

Office draft [PR #85](https://github.com/contactochiga/ochiga-office/pull/85): `6240613` authenticated staff and plan reads; `861e92b` signed public CRM continuity and bounded public projection; `e4b6f3a` Plan Studio delegation/no local reasoning fallback. Twin `2ff904bda256ebdddf1163e41f4c30160858445e` fixes Vite/Next image typing compatibly on `codex/wave9-build-verification`; a PR is still required. Facility has no new changes.

## Authority map and limitations

| Stage | Existing owner / interpretation |
|---|---|
| Signal | Backend canonical signal ingress and materialization |
| Context | Backend conversation orchestrator; new ownership/admission guard; full adapter convergence incomplete |
| Knowledge | Backend knowledge contracts/index/retrieval; Office contributes an authenticated knowledge pack, not ranking authority |
| Memory | Core conversation stores and resident_memory; Office retains CRM context as domain truth; complete common-contract adoption not yet proven |
| Oyi reasoning | Backend Core; Plan Studio reasoning moved here; full final provider-call sweep still required |
| Decision / plan / capability | Existing Backend decision, goal and capability services; exhaustive ownership metadata inventory outstanding |
| Domain execution | Authorized Office/Facility/device execution, not model-owned execution |
| Outcome / feedback / learning | Existing Backend governed evaluators and learning-parameter authority |

Office production conversation delegates to Core. Its remaining direct model call found in `src/lead-agents/server.js` extracts bounded plan geometry; it is not the removed planning-answer path. Retained legacy LeadAgentRuntime is guarded out, not deleted. Twin deterministic spatial interpretation/navigation/simulation and Facility rendering are not competing intelligence merely because they contain rules. No claim is made that every surviving occurrence has received the final exhaustive classification.

Public Office continuity now requires a signed, purpose-bound, expiring token; unverified lead/contact/thread identifiers do not establish ownership. Staff authority comes from authenticated context. Core checks existing thread actor, surface and scope before hydration. Public session trust through every other bridge, Office retained CRM-memory route authorization/retention, and complete persona coverage remain audit gates.

Resident memory is bounded, owner/scope filtered, context-only, and expires for use after 30 days; this is not physical deletion. It cannot establish facts or permissions. The governed slot is currently admission metadata, not proof every reasoning/context consumer adopts it. Do not label the memory requirement PASS yet.

## Migration / production consistency

Read-only production migration-history comparison found all 115 tracked Backend versions applied, including all five LOCAL_TEST-named migrations. None was deleted. This proves history membership, **not** full schema/RLS/function equivalence or clean-chain replay. Office uses its own application-schema path; one Supabase migration-history entry is not proof of missing application schema. No migration was created or applied. See the migration ledger accompanying the audit.

## Validation actually performed

- Backend typecheck/build PASS. Wave 9 knowledge suites: 19 + 21 + 11 checks PASS; product, conversation ownership, resident memory, context-authority and Plan Studio tests PASS.
- Backend Camera 14A–14F, awareness V3 and security adversarial suites PASS in the refreshed 14-suite batch. Decision 19 and learning 21 checks PASS against this checkout with mocked/local test configuration.
- Canonical-truth smoke PASS after correcting its obsolete fixture. Full `validate:release` is **NOT PASS**: it now stops at the credential-requiring device-schema check. Earlier PR CI failure was the obsolete fixture; post-update CI still requires verification.
- Office check (101 JS files), lint, build, signed public-session, authority-boundary, Core delegation, Plan Studio and architecture guard tests PASS. Secret-check script PASS.
- Facility clean authoritative-main production build (41 routes), lint, release checks and intelligence-context smoke PASS. Remote Twin pin unchanged.
- Twin clean install, build, lint, image helper and deterministic representation/apartment/map-policy/ingestion tests PASS. Browser architecture verification unavailable because `puppeteer-core` is undeclared/missing; not PASS. Large bundle warning remains.
- Backend high-confidence added-diff secret patterns across eight commits: zero candidates. This is a scoped scan, not a guarantee against every credential format. No generated outputs, env files or unrelated Mac work were staged.
- Dependency audits: Backend 15 advisories (including critical transitive tar and high ip-address with no offered fix); Facility 18 (including 2 critical); Office/Twin clean installs reported zero. Reachability/remediation must be reviewed, not hidden by blind upgrades.

No live provider-quality, hardware, production mutation, or real-database concurrency proof was performed for the new memory/identity work. Existing mocked regression coverage must not be represented as those guarantees.

## Required before closure / merge

1. Complete actual memory/context adapter adoption and persona privacy coverage; avoid creating another memory store or reasoning authority.
2. Finish per-capability ownership/action/approval/evidence/failure inventory and final four-repository duplicate-authority sweep.
3. Verify schema/function/RLS equivalence and safe fresh migration chain in isolated infrastructure; preserve applied migrations.
4. Complete missing release/physical-execution/browser checks with appropriate isolated dependencies and credentials. Recheck CI after all commits.
5. Triage dependency advisories and distinguish exploitable runtime paths from installer-only exposure; resolve release blockers.
6. Complete secret review, Twin PR, review updated changed-file/test/migration summaries, then merge only passing PRs. Current drafts are not merge-ready.

Original Mac user edits remain untouched. These branches preserve validated progress but do not satisfy all requested closure criteria.

**WAVE 9: NOT CLOSED. WAVE 10 BASELINE: NOT READY.**
