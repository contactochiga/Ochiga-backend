# Wave 9 convergence review — NOT CLOSED

## Certification continuation — expanded provisioning evidence

All four remotes were fetched. The following source candidates are remotely durable and their merge-base equals the listed authoritative HEAD. This evidence-only change does not alter any runtime source or migration. Its containing Backend commit is identified by `git log -1 --format=%H -- docs/WAVE9_FINAL_CLOSURE.md`.

| Repository / draft PR | Candidate | Authoritative HEAD / merge-base | Behind / ahead | Local work preserved |
|---|---|---|---|---|
| Backend #90 | a50dffde569cbb370e4589b6ad02aeb67a7ce805 | 17e876d78d0baf19913845195e140c812075a2ec | 0 / 23 | Initially clean; existing `pre-camera-backend-capacitor-push-dependency` stash untouched |
| Office #85 | 0410dd61249119d27418f3e3cb8697ffb791c607 | 8f58aaef1263dfbd019d319651a95e8fb7617b80 | 0 / 5 | Clean, no stashes |
| Twin #1 | 2862dba4780b655de17b0a21ecb4c635fef8d9be | fda2a27a31208541cb030c40ad26b01f1bc0fee0 | 0 / 2 | Existing generated architecture JSON/PNG changes left unstaged; no stashes |
| Facility #38 | f14db75ab25042265514016e6e1ccaab3aed9788 | 60a0681968cedc0f303cf02b12c8964c879965f2 | 0 / 6 | Clean, no stashes |

Backend/Office development branch remains `codex/wave9-final-convergence`; Twin `codex/wave9-build-verification`; Facility `codex/wave9-dependency-hardening`. Authoritative branches remain main except Office `codex/office-extraction`.

**Provenance progressed, not closed.** All 214 accessible PR heads, 6,439 reachable historical text blobs and 71 unreachable blobs across the four repositories were searched. Supported SQL Editor metadata access then located 39 retained snippets over four pages. One genuine original definition was recovered: room_device_bindings, snippet `689b8acb-34db-4078-8934-0fa104e245a8`. It is preserved outside migration directories, hash-verified against the retained original, and replays successfully twice on the retained schema.sql. Its columns, constraints and indexes match production. Execution time/order remains unproven; saved-snippet time is not an execution log.

community_posts and five other objects remain classification E, genuinely unresolved in the accessible evidence. Backup metadata lists no available backups; the queried first-reference-day logs have no retained entries. See `WAVE9_PROVISIONING_PROVENANCE_LEDGER.md` and machine-readable `docs/provenance/wave9-provenance-status.json`. No catalog-derived replacement DDL or complete baseline was invented. Full replay and full production equivalence remain BLOCKED, not a partial PASS.

**The five LOCAL_TEST migrations remain intact.** Production history records all five 20260905 versions; current Git retains them unchanged from authoritative main. No historical migration rewrite/deletion occurred, and no lost cloud commit was reconstructed.

**CI is not green.** Backend PR run `36273323719`: quality PASS; runtime-smoke FAIL (`22P02`, invalid UUID `estate-1`, plus Redis connection refused); ecosystem-smoke SKIPPED. Job `108492308034` locates the failure in `scripts/production-readiness-smoke.mjs`. That script inherits configured Supabase credentials and only mocks the users read while receiveSignal now reaches durable persistence. Its synthetic fixture must be isolated from real databases and reconciled with the persistence contract; merely replacing the fake ID with a real UUID is not an acceptable repair. `.github/workflows/backend-ci.yml` currently supplies repository Supabase secrets globally. Their target was not inspected or changed. No production fixture execution was deliberately initiated in this continuation. This evidence-only commit uses `[skip ci]` to avoid retriggering the known non-isolated smoke; skipped checks are **not** a green certification or authority bypass.

Facility validation runs `36272790971` and `36273109141` PASS. Office preview PASS is not a substitute for a full new local matrix. Twin has only a draft-skipped CodeRabbit report, not executable CI certification. All PRs remain drafts and unmerged. The final authority sweep/full four-repository matrix requested **after** DB integrity cannot yet be certified; previous passing runtime tests remain historical evidence, not newly rerun final results.

Current focused checks: archived snippet content verification PASS (original plus one final LF), local PostgreSQL foundation + snippet + repeat PASS (8 columns / 5 constraints / 4 indexes), JSON evidence parse and diff whitespace checks PASS. No historical DDL applied to production. No product architecture, security, memory or dependency gate was reopened.

**WAVE 9 NOT CLOSED.** Remaining concrete work: recover verified provisioning evidence for the six E objects and establish complete replay/equivalence; repair/isolate the failing Backend runtime-smoke fixture, then obtain complete exact-candidate validation/CI and merged-state proof. No merge is permitted around either failure. Conditional order remains Backend → Office → Twin → Facility; Facility's existing remote Twin pin does not require the new Twin build-only commit, so Twin review is otherwise independent.

## Two-blocker continuation — current result

This section supersedes older PR-permission findings. Starting candidates were verified after fetching all remotes: Backend `1f9961bde64d37b0134fa5fc288d37382b4d7773`, Office `0410dd61249119d27418f3e3cb8697ffb791c607`, Twin `2862dba4780b655de17b0a21ecb4c635fef8d9be`, Facility `f14db75ab25042265514016e6e1ccaab3aed9788`. This documentation-only commit advances Backend; resolve its full SHA with `git log -1 --format=%H -- docs/WAVE9_FINAL_CLOSURE.md`. No runtime source, migration, dependency or cleared authority contract changed.

1. **Database baseline/replay/equivalence: BLOCKED.** See `WAVE9_PROVISIONING_PROVENANCE_LEDGER.md`. Search progressed beyond community_posts to seven production objects with no retained creation owner. All-ref historical SQL/bootstrap candidates (195 blobs), accessible Documents SQL/dump/backup paths (446), first application references, and production retained migration statements were checked. A new empty local PostgreSQL replay again fails at March comments/reactions after schema.sql + May foundation + camera_events pass. No fabricated table, applied-history rewrite, or false equivalence claim. Original provisioning SQL/pre-migration schema evidence or a fully reviewed catalog-derived baseline with reconciled historical preconditions remains required.
2. **PR write: RESOLVED; final CI/candidate certification remains BLOCKED.** Mac `gh` is authenticated with repository scope. Backend [#90](https://github.com/contactochiga/Ochiga-backend/pull/90) and Office [#85](https://github.com/contactochiga/ochiga-office/pull/85) bodies were updated with accurate gate status. Created draft Twin [#1](https://github.com/contactochiga/Oyi-Twin-Engine/pull/1) and Facility [#38](https://github.com/contactochiga/facility-oyi/pull/38). All four heads match the candidates above. No merge or production deployment was performed. Repository integrations reported Vercel preview completion; that is not production certification.

CI snapshot: Backend runs `36272900048` and `36272903263` remain in progress at release validation; lint/build/environment/security/camera checks succeeded, not overall CI PASS. Facility runs `36272790971` and `36273109141` validate PASS. Office reports Vercel preview PASS; Twin reports only CodeRabbit review-skipped because draft, not executable CI proof. Drafts remain drafts.

Validation this continuation: fresh diagnostic SQL replay FAIL as above; Git diff whitespace check PASS. Previous 67/67 smoke and build results remain prior-source evidence, **not a newly executed final matrix**. User-required final matrix is conditional on database replay/equivalence succeeding; that condition remains unmet. Twin's generated architecture JSON/PNG modifications were preserved unstaged; other worktrees were clean before this documentation edit. No new secret/config/source files were introduced.

Conditional reviewed merge order remains Backend → Office → Twin → Facility, then actual merged-HEAD compatibility validation. No merge is safe while the database gate remains blocked. Cleared architecture/security/memory/dependency gates were not reopened.

**WAVE 9 NOT CLOSED** — remaining work is verified complete provisioning/replay/schema equivalence, followed by final candidate validation/CI and reviewed merged-state compatibility. PR-write permissions are no longer a blocker.

## Five-blocker correction result — latest

This section supersedes earlier blocker dispositions. No historical migration was edited. No production mutation, deployment, merge, cloud reconstruction or new feature slice occurred.

| Blocker | Candidate disposition | Evidence / remaining action |
|---|---|---|
| 1 Migration/provisioning equivalence | **BLOCKED** | Camera scope upgrade test passes. `7ad7f94` forward-adopts the omitted 18-column camera_dvrs registry with original FK/unique/index contract plus RLS and service-only grants. Repeated application passes. Full replay still fails: schema.sql → March camera_events lacks facility_cameras. Diagnostic schema.sql → retained May foundation → ordered migrations passes camera_events, then fails March community_comments_reactions because community_posts has no retained creation. This diagnostic is NOT a supported bootstrap. A verified complete provisioning baseline and full camera/schema equivalence remain necessary. No speculative replacement tables were created. |
| 2 Wallet RPC authorization | **RESOLVED in tested candidate; undeployed** | `c75d026`: four functions changed to SECURITY INVOKER; PUBLIC/anon/authenticated execution revoked; only service_role granted. Real PostgreSQL original-body tests pass for all four, wrong wallet owner, role escalation rejection, ledger persistence, repeat migration. Production service_role already has required table rights. Live exposure remains until authorized deployment. |
| 3 Context/CRM privacy | **RESOLVED for existing production paths** | Office `0410dd6` replaces dashboard-only raw memory reads with identified staff session + crm.read + exact lead owner or crm.manage, scope checks, bounded projection and 30-day retrieval expiry. Pure and actual HTTP owner/other-staff tests pass. Public chat never recalls CRM memory. Existing Core memory/orchestration and ownership tests remain green; no new memory store or general context engine. See Office CRM_MEMORY_ACCESS_CONTRACT.md for explicit constraints. |
| 4 Capacitor/tar | **RESOLVED by restricted web-only risk disposition** | Facility `f14db75`: exact @capacitor/cli@6.2.2 → tar@6.2.1 chain remains high/critical in full audit; production-only audit zero. CLI only extracts shipped templates in traced code. No incompatible override. Web CI must not run native archive operations; isolated developers may use locked bundled assets only, never untrusted archives; native release certification excluded pending compatible upgrade/acceptance. Full audit is not suppressed or declared clean. |
| 5 PR/CI/final candidate | **BLOCKED** | PR creation still returns 403. #90/#85 remain drafts; Twin/Facility PRs absent. Backend run 36272293397 failed an obsolete learning-promotion test missing its now-required approver/CAS options; `965fe3f` corrects the fixture and the complete Programme3 smoke passes locally. New remote CI still must complete; do not infer green from local tests. No merge until blocker 1 and final CI are closed. |

### Wallet least-privilege evidence

Exact identities are `public.oyi_credit_wallet(uuid,numeric,text,text,text,text)`, `public.oyi_debit_wallet(uuid,numeric,text,text,text,text)`, `public.oyi_credit_home_wallet(uuid,uuid,numeric,text,text,text,text)`, and `public.oyi_debit_home_wallet(uuid,uuid,numeric,text,text,text,text)`. Source caller search in all four repos finds only Backend walletController/servicesController `supabaseAdmin.rpc`; no direct client caller. Production pg_proc body search finds no database wrapper calling these functions. Backend payment reconciliation/service purchase paths remain the authorized entry. The migration changes neither balances nor function bodies or financial semantics. Existing swallowed ledger-error behavior is retained debt, not claimed repaired.

`20260926211819_wallet_rpc_service_boundary.sql` is transactional/additive privilege hardening; rollback must not restore public execution. Deploy only through the reviewed migration path. It uses existing table permissions instead of owner escalation. `wave9-wallet-authorization-sql-smoke.mjs` loads the four original tracked function bodies into a unique isolated PostgreSQL database, validates success/denial, then drops only that test database. Five wallet funding/webhook/receipt/notification/return smokes pass as well.

### Context completion (no architecture reopening)

`ConversationOrchestrator.run` admits identity/thread/memory once before capability selection. All LegacyConversationAdapter calls pass that admitted `context.input`; its only target is canonicalConversationRuntime, which rechecks thread ownership before its compatibility call to runOyiUnifiedChat. These are Core-owned compatibility execution, not host context/persona authorities. `buildPersonContext`, resultSetContext and Office active/domain context builders are bounded deterministic reference-resolution state inside Core, not sources of permissions. Domain evidence builders retain domain scope policies. The actual resident recall orchestration regression proves the request reaches the governed memory capability without action dispatch. Public/Facility/staff/system persona exclusion and unknown/future/expired memory fail-closed tests pass. No extra wrapper/reasoning layer was created.

Office CRM: role/permission comes from authenticated server enrichment; API keys and public sessions do not count as identified staff for memory. Exact staff UUID ownership, not agent names or display labels, is accepted. Current null organization scope means this single CRM instance, not all organizations. Any nonmatching explicit org/estate scope is denied; multi-org recall is unsupported without authenticated scope. Missing/deleted leads deny, absent/expired memory returns null, and only bounded business/project classification fields are projected. Contact details, transcripts, arbitrary summaries, prompts and tool outputs remain excluded. No production caller of legacy memory upsert methods exists; do not reactivate one without admission review. Retrieval expiry is not physical deletion; existing CRM data administration remains responsible for deletion.

### Verification and candidate ledger

- Backend typecheck/build PASS; **67/67** Wave5–9 smokes PASS including PostgreSQL, new wallet authorization and updated camera/DVR upgrade test. Programme3 prediction/forecasting release smoke PASS after fixture correction. Wallet five-script battery PASS. Four-repository added-diff secret scan: zero high-confidence candidates; diff against authoritative branches passes `--check` after removing an inventory trailing blank line. These are scoped scans, not absolute secret guarantees.
- Office check (103 files), build, lint, architecture, delegation, handoff, public-session, Plan Studio, CRM pure/HTTP authorization and secret checks PASS. No production DB/test data mutation. Facility/Twin runtime source unchanged this execution; previous build/browser results remain applicable to unchanged source, not newly rerun hardware proof.
- Backend tested source `965fe3f` follows `c75d026` and `7ad7f94`; containing ledger commit follows. Office `0410dd61249119d27418f3e3cb8697ffb791c607`; Twin `2862dba4780b655de17b0a21ecb4c635fef8d9be`; Facility `f14db75ab25042265514016e6e1ccaab3aed9788`. Resolve final Backend ledger SHA with `git log -1 --format=%H -- docs/WAVE9_FINAL_CLOSURE.md`. Authoritative default HEADs remain the four listed below. Twin generated architecture artifacts remain unstaged; no env/generated junk committed.

Authenticated account commands (creation only, no merge):

```sh
gh pr create --repo contactochiga/Oyi-Twin-Engine --base main --head codex/wave9-build-verification --draft --title "Twin build and browser verification" --body "Wave 9 closure review; no merge until Backend closure ledger gates pass."
gh pr create --repo contactochiga/facility-oyi --base main --head codex/wave9-dependency-hardening --draft --title "Facility Core delegation and dependency hardening" --body "Wave 9 closure review; retains remote Twin pin and restricted native-installer risk disposition. No merge until gates pass."
gh pr checks 90 --repo contactochiga/Ochiga-backend
gh pr checks 85 --repo contactochiga/ochiga-office
```

Existing reviews: https://github.com/contactochiga/Ochiga-backend/pull/90 and https://github.com/contactochiga/ochiga-office/pull/85. Conditional merge order remains Backend → Office → Twin as appropriate → Facility; after each authorized merge fetch authoritative HEADs and validate the actual merged cross-system candidate. No merge is authorized by this record.

**WAVE 9 NOT CLOSED** — remaining blockers are complete provisioning/replay/schema equivalence and PR-write/final-CI certification. Candidate fixes are not claims that production migrations were applied.

2026-09-26. This is a durable progress and blocker record, not a declaration of completion. No lost Claude cloud commit was recovered or reconstructed. Work starts from durable GitHub source. No Wave 10 work or deployment occurred.

## FINAL CLOSURE GATE — 2026-09-26, current result

This is the authoritative gate result; older sections below are retained provenance, not current certification. **WAVE 9 NOT CLOSED.**

### Frozen candidates and Git evidence

All remotes were fetched/pruned. Requested starting HEADs matched exactly. No authoritative branch advanced during the audit. No unrelated work was reset or discarded.

| Repository | Candidate branch / tested code HEAD | Authoritative remote HEAD | Initial behind/ahead | PR / merge / CI |
|---|---|---|---|---|
| Backend | codex/wave9-final-convergence / `298cad487a19d8ca7fb3a6ac46b41ccacb258d03` (adds persona test to b6c1947; this ledger-only commit follows) | main / `17e876d78d0baf19913845195e140c812075a2ec` | 0/16 at b6c1947 | #90 open draft, not merged; original candidate Actions run 36271739473 still running at inspection, not certified green |
| Office | codex/wave9-final-convergence / `7b98363200025322e6b355708996f504f677ffee` (adds unauthorized memory-read proof) | codex/office-extraction / `8f58aaef1263dfbd019d319651a95e8fb7617b80` | 0/3 at e4b6f3a | #85 open draft, not merged; no Actions runs returned for e4b6f3a, not CI PASS |
| Facility | codex/wave9-dependency-hardening / `205e6d97ad51705d9fd8c9b1d7ce84a6c2ee6f5d` (compatible Sharp lock update) | main / `60a0681968cedc0f303cf02b12c8964c879965f2` | 0/4 at d6b87f0 | PR creation HTTP 403; no merge; remote CI unverified |
| Twin | codex/wave9-build-verification / `2862dba4780b655de17b0a21ecb4c635fef8d9be` | main / `fda2a27a31208541cb030c40ad26b01f1bc0fee0` | 0/2 | PR creation HTTP 403; no merge; remote CI unverified |

The final Backend documentation HEAD is deterministically discoverable with `git log -1 --format=%H -- docs/WAVE9_FINAL_CLOSURE.md`; embedding the containing commit's own SHA is not possible. Backend/Office/Facility initially clean with no untracked files. Twin retains generated `artifacts/architecture-regression.json` and `.png` modifications, left unstaged. No environment files/build junk were committed. Facility still pins remote Twin `fda2a27a31208541cb030c40ad26b01f1bc0fee0`, not a local file dependency.

### Executable authority classification

A = canonical Core authority; B = delegates to Core; C = domain runtime/deterministic logic; D = presentation; E = legacy/dead; F = competing intelligence blocker.

| Actual path | Class | Evidence / boundary |
|---|---|---|
| Backend oyiRoutes, aiRoutes, officeExport and communicationsOyiTurnService → ConversationOrchestrator.run | A | All live callers found invoke Core; run invokes assembleGovernedContext before selection |
| governedContextAssembly / conversationOwnership / residentMemoryContext / MemoryRecallCapability | A | Server replaces governed slot; owner/estate/home/expiry filtering, bounded recall; actual orchestrator routing tested |
| knowledgeRetrieval, canonical knowledge contracts/index | A | Wave9 A–C source/access/provenance/fabrication suites pass |
| capabilityRegistry / CapabilityService / FallbackFirewall | A | Executable 73-entry unique catalog; enabled risk, approval and surface metadata verified without DB/provider calls |
| canonical signal/materialization, awareness, decision, GoalRuntime, outcome/learning parameter services | A | Wave5–8 and real SQL suites pass; no host replacement introduced |
| LegacyConversationAdapter → canonicalConversationRuntime → runOyiUnifiedChat | A | Backend-owned compatibility branch, not a competing host; sole caller chain traced, thread ownership rechecked. Full semantic adoption of every legacy context consumer is not certified |
| Backend media adapters / replyClassifier / PlanStudioCapability provider invocation | C / C / A respectively | Sensory conversion; bounded inbound reply classification; Core-governed advisory capability. None grants independent host execution authority |
| Backend utils/ai automation parser / external language-teacher null adapters | E | Legacy unmounted route / no active external provider call in inspected adapters |
| Office public/internal chat and Plan Studio advisory route → oyi-core-gateway | B | HTTP delegation, public-session and architecture tests pass; Core outage returns unavailable, no local reasoning fallback |
| Office geometry extraction, voice transcription, CRM store/permissions/execution | C | Domain/sensory ownership, not general reasoning. GET lead memory requires authenticated view_dashboard; public projection sets lead_memory null and omits CRM history |
| Office former runtime.js, prompt-packs.js, lead-memory.js, knowledge-base.js, intelligence-core/index.js | E | Actually absent, enforced by architecture guard (older wording that runtime remains in place was inaccurate) |
| Facility five intelligence loaders | B | Executable outage tests reject instead of synthesizing local answers |
| Facility retained deriveRealtime/build helpers | E | No live consumer found in repeated source caller search; do not reactivate as fallbacks |
| Facility normalization/rendering | D | Presents/domain-normalizes accepted Core payloads |
| Twin Luna intent/navigation/simulation/spatial policies | C | Deterministic source, no provider invocation found; real-browser privacy/representation checks pass |
| Twin rendering/explanatory display | D | Geometry/runtime presentation, not canonical Oyi knowledge or reasoning |

Provider-invocation source search covered chat.completions, responses.create, provider URLs, OpenAI construction and generateContent. It found five Backend adapter/capability files, Office provider configuration/server (plus its `/responses` wrapper traced separately), and no Facility/Twin provider call. No F path was identified in these inspected paths. This does not convert an uncompleted per-consumer context audit into proof of universal adoption.

### Context / memory evidence

Production route trace: authenticated or signed bridge identity → Core request → authorizeConversationThread → assembleGovernedContext → scoped resident-memory read where applicable → Core knowledge/capability/evidence selection → governed execution/response → existing canonical persistence/outcome. Office public identity is signed, purpose-bound and expiring; arbitrary CRM/thread IDs do not establish ownership. Staff role/permissions originate from authContext, not submitted staff fields. Non-resident/public/facility/staff/system personas do not read resident memory even when supplying a forged governed slot. New tests prove that exclusion and cross-estate memory rejection; the Office HTTP test proves unauthenticated CRM-memory reads fail before store access.

Memory is context-only, not a live fact or permission. Institutional knowledge is retrieved separately. CRM retained memory stays a domain store; its broad staff `view_dashboard` entitlement and absence of an explicit retention policy are not a certified per-lead/private-memory contract. Comprehensive legacy-context/persona and CRM retention/access adoption remains a concrete coverage/policy gate; no new store or workflow was invented to conceal it.

### Production equivalence ledger (metadata reads only)

| Object class | Current evidence | Result / required action |
|---|---|---|
| Migration history | 115 historical versions present, including LOCAL_TEST-named applied entries; new camera scope correction absent | History membership confirmed, not schema equivalence; preserve all applied history |
| Fresh replay | Isolated database: migrations/schema.sql exits 0; first 20260312000100_camera_events.sql fails `relation facility_cameras does not exist` | FAIL; obtain/validate missing provisioning baseline, not a fabricated table or reordered applied history |
| facility_cameras | 41 production columns; home_id/privacy_scope absent; May IF NOT EXISTS creation cannot establish original provenance | Reviewed nullable forward correction exists and upgrade smoke passes, but is undeployed and cannot fix earlier replay |
| camera_dvrs | Absent; DDL in migrations/2026-06-11-camera-dvr-registry.sql, outside Supabase chain | Unresolved tracked/deployed mismatch; review forward adoption and security |
| homes | building_id, zone_id, floor, canonical_ref present; canonical_ref partial unique index and building/zone FKs present | Requested canonical relationships present; duplicate resident/estate FKs observed, whole-schema equivalence not certified |
| rooms | canonical_ref and partial unique index present; home/estate FKs present | Canonical identity present; duplicate FK definitions need baseline comparison |
| devices | canonical_ref and partial unique index, parent_device_id FK/index present | Canonical identity/parent relationship present; retained duplicate legacy indexes/FKs are not removed |
| resident_memory | Required columns, owner policy, bounded-read index, home/estate/user FKs present; no noninternal trigger | Schema present; direct anon/authenticated table privileges false; nullable-home uniqueness supplemented by application deterministic ID |
| Knowledge persistence | Backend canonical corpus/index and authenticated Office pack are source authorities, not an invented new knowledge table | No automatic missing-table finding based only on absence of `%knowledge%` table |
| communications sessions/participants/events/handoffs | Tables, constraints/indexes, service-role policies present; no noninternal triggers in queried objects | Structural presence confirmed; full replay-derived equivalence blocked upstream |
| oyi_goals | Table/check/due index/canonical_signal_key present; RLS false, but anon/authenticated direct read/write privileges false | Not falsely classified as exposed solely from RLS flag; broader hardening/equivalence remains review |
| Camera/Edge/materialization RPCs | Correct signatures, SECURITY INVOKER, empty search_path, anon/authenticated execute false | Security posture confirmed from catalog; full replay-derived body equivalence not certified |
| Camera constraints/indexes/triggers/policies | PK+zone FK only; seven indexes; no noninternal triggers; estate-operator SELECT policy, direct access service-only | Diverges from May intended constraints; targeted correction preserves existing objects; do not blindly add constraints without data validation |
| Wallet RPCs — NEW HARD SECURITY FINDING | oyi_credit_wallet, oyi_debit_wallet, oyi_credit_home_wallet, oyi_debit_home_wallet are SECURITY DEFINER and executable by anon/authenticated; bodies mutate caller-selected IDs without caller authorization | BLOCKER. Review service-role-only revoke/grant correction and test compatibility. Never invoke to prove on live funds. No production write performed |

The wallet bodies also swallow transaction-ledger insert errors. That is retained financial integrity debt, not corrected under an unrelated architecture rewrite. The newly verified public execution boundary must be addressed before release certification. Production schema/function/security truth is therefore **not equivalent/safe**, independent of passing mocked/local suites.

### Security disposition

Backend audit remains six (three high, three moderate). `node-ssdp → ip` uses address(), not advisory-affected isPublic; `ip-cidr → ip-address` has no live cidrToIps caller found and no HTML-rendering use. No compatible audited upgrade offered; do not downgrade node-ssdp based on npm's suggested major rollback. These are bounded reachability findings, not a blanket waiver for reactivation. AWS v2 uses deployment-owned region and UUID v4, not affected buffer-based UUID methods. Office and Twin report zero advisories.

Facility Sharp updated within Next's supported range to 0.35.4: build plus JPEG/WebP/AVIF encode/decode pass; Node >=20.9 required (CI Node20). `npm audit --omit=dev`: zero. Full audit: two findings, high Capacitor CLI and critical tar, both native-installer/dev chain. Traced use extracts bundled templates, not web uploads. Unsafe tar-major override remains rejected. Web runtime exposure is not shown; native installer use remains restricted pending a compatible maintained CLI/extractor and native acceptance. This is an explicit residual risk, not remediation or universal acceptance.

### Validation matrix / exact commands

| Check | Result |
|---|---|
| Backend npm run typecheck; npm run build | PASS |
| Every scripts/wave[5-9]*smoke.mjs, sequential node, 60s per-script timeout | 66/66 PASS, rerun again after the persona extension: 66/66 PASS, zero failed |
| node scripts/wave9-capability-inventory.mjs; node scripts/full-domain-architecture-smoke.mjs | PASS: 73 entries; seven domain architecture checks |
| PostgreSQL camera/Edge/materialization/incident/decision/outcome suites | PASS in the 66-script battery; isolated Docker database, no hardware claim |
| Office check; lint; build; office:test; office:oyi-core-delegation:test; office:communications-handoff:test; office:knowledge-positioning:test | PASS |
| Office node scripts/test-wave9-{public-session,plan-core,authority-boundaries}.js; security:secrets | PASS, including added CRM denial test |
| Facility npm run build; lint; validate:release; wave9-core-authority-smoke; wave9-capacitor-template-smoke | PASS; 41 routes, actual pinned Twin integration built |
| Facility npm update sharp --ignore-scripts; npm ls sharp; native encode/decode smoke | PASS 0.35.4; no forced override |
| Twin build; lint; test:representation; test:ingestion; test:architecture | PASS; browser errors [], lint/bundle/deprecation warnings retained |
| Four-repository high-confidence added-diff secret patterns; git diff --check | PASS, zero candidates; not a universal credential-detection guarantee |
| Full fresh migration replay / full production equivalence | FAIL / BLOCKED as above |
| Exact merged-state cross-system verification | NOT APPLICABLE: nothing merged; must run after authorized merges |
| Production migration/deploy/hardware/provider-quality tests | NOT RUN; no deployment authorized |

Conditional review order stays Backend #90 → Office #85 → Twin → Facility (Twin independent review is possible; Facility existing pin is unchanged). Do not mark drafts ready or merge while the database/security/context gates above remain. GitHub API permits reads but Twin/Facility PR creation still returns 403. PR bodies contain stale earlier descriptions and need updating with this ledger when write access is restored. Backend CI on the starting candidate passed lint/build/env/security/camera stages but had not finished release validation at inspection; green CI is not asserted for new candidate commits.

Attempting to update Backend #90's body with this gate result also returned 403. Required access is GitHub pull-request write permission; Git SSH branch pushes work. Final code commits are remote-durable; this ledger-only commit advances Backend to 18 ahead/0 behind, Office 4/0, Facility 5/0, Twin 2/0 relative to unchanged authoritative lines. No merge or deployment took place.

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
