# Intelligence Quality V1 — unmodified-brain baseline

## Decision and provenance

**INTELLIGENCE QUALITY NOT YET CERTIFIED.** Baseline completed 2026-10-04, before any behavioural hardening. Stop at this checkpoint; no Core fixes are included in this commit.

- Authoritative starting main: `3a9956dc139746c592a10cc081d0de7c9a299989`, including PR #93 (`e8e17ec`), #94 (`87066cd`), #95 (`3a9956d`).
- Isolated branch: `codex/intelligence-quality-v1`.
- Worktree: `/Users/ochigaidoko/Documents/oyi-intelligence-quality`.
- Runtime, migration and frozen Wave 11 sources have zero diff from starting main.
- Machine evidence: `artifacts/intelligence-quality-v1-baseline.json`. All 280 raw responses and durable traces retained, plus envelopes, per-turn reviewer annotations and scores. No synthetic test text was added to the durable trace itself.
- Raw response/trace array SHA-256: `c6564a7497b4fc3d977d627c2648922af10fd240f397b9499c88a494e3520bac`.
- Frozen Wave 11 harness SHA-256: `f4589f7ef35e1297ca2ec68e5e724904062c1f29478752302cd13a6f66557dd7`.

This is not a production comparison, an independent human-panel evaluation or an end-to-end worker certification. Scores are explicit qualitative assistant review annotations, not a calibrated psychometric instrument. No overall percentage is used as the certification criterion.

## Completed evaluation

40 journeys, seven turns each, **280 executed conversational turns**. Each journey has a new owned thread. Setup calls are excluded. Results:

| Worker | Journeys | Turns | PASS | FAIL | BLOCKED |
| --- | ---: | ---: | ---: | ---: | ---: |
| Oma / Office | 10 | 70 | 6 | 62 | 2 |
| Osa / Public | 10 | 70 | 8 | 62 | 0 |
| Facility | 10 | 70 | 16 | 52 | 2 |
| Consumer | 10 | 70 | 10 | 59 | 1 |
| Total | 40 | 280 | 40 | 235 | 5 |

Four P0 observations in two root-cause families; 217 P1 and 14 P2 failed turns. Counts are observations, not 235 independent defects. All **280/280 persisted**, all **280/280 correlated to distinct durable trace IDs**. No response reported physical/current-turn execution. Four turns reference one wrongly initiated clarification workflow; that is not a physical device mutation, but is a material action-judgment defect.

## Seven dimensions

Scores 0–5, averaged only over scored observations. Null means upstream failure or evidence limitation prevents a fair downstream score, not success. Especially, only 41 turns meaningfully exposed a judgment step; most failures occurred earlier.

| Dimension | Scored turns | Not observable | Mean /5 |
| --- | ---: | ---: | ---: |
| Understanding | 275 | 5 | 1.82 |
| Context and memory | 275 | 5 | 1.55 |
| Evidence | 263 | 17 | 1.00 |
| Reasoning and judgment | 41 | 239 | 2.02 |
| Initiative | 275 | 5 | 0.59 |
| Communication | 275 | 5 | 1.91 |
| Action judgment | 275 | 5 | 1.58 |

| Worker | Understanding | Context | Evidence | Judgment | Initiative | Communication | Action judgment |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Oma | 1.54 | 1.34 | 0.71 | 0.86 (7 turns) | 0.37 | 1.62 | 1.37 |
| Osa | 1.97 | 1.66 | 0.72 | 2.47 (15 turns) | 0.70 | 1.91 | 1.67 |
| Facility | 2.06 | 1.79 | 1.43 | 2.29 (14 turns) | 0.79 | 2.13 | 1.81 |
| Consumer | 1.70 | 1.39 | 1.10 | 1.60 (5 turns) | 0.49 | 1.97 | 1.48 |

These means describe this deliberately challenging corpus, not production success rates. A bounded privacy refusal can pass its specific probe while being conversationally weak. A capability response can fail despite correct HTTP/runtime execution.

## Fixture and evaluation architecture

The runner calls the unchanged `ConversationOrchestrator.run` contract used by real surfaces. Fixture identity/OIS-context helpers are reused from the hash-pinned frozen Wave 11 harness without editing or executing its scorer. Core, capability selection, authority, database reads, conversation persistence and durable trace writer are real. BullMQ/ioredis transport is inert, as in the structural fixture.

The retained `wave11-behavioural-fixture` Supabase stack is at loopback port 55421. Its temporary config had disappeared; a status-only local project locator was restored. No schema reset, seed rewrite, production connection, migration or linked operation was performed. The existing fixture was positively checked to contain exactly one estate named `Wave 11 Test Estate`.

The fixture supplies synthetic residents in different homes, a Facility manager, Office staff and public guest; existing rooms, four devices, camera, open/resolved maintenance, visitors, wallet transactions and synthetic activity history. Observations are intentionally allowed to be stale; the baseline does not silently refresh physical truth. Retained synthetic history is not a clean-room snapshot, and this limits historical/change and prediction assessments.

Office's existing permission-gated `operational_snapshot` input contains 39 total open leads, 20 needing attention, three opportunities and three developments. Encoded facts distinguish a low-value old inquiry, qualified Abuja JV with tomorrow's deadline, large speculative prospect without feasibility/mandate, unverified VI financing, disputed title and cosmetic completion. Facts use existing contract fields; no new production schema/field was added. Existing tasks, report, meeting, support, partnership, document and content fixtures remain present.

The IQ fixture accidentally inherited two limitations from the structural fixture: financial portfolio totals have no estate breakdown, and task total_open remains 1 despite two task rows. The financial turns are BLOCKED, and no task-total claim is used to prove a brain defect. These must be corrected in a later fixture revision, preserving this first baseline unchanged. Financial coverage and real Office worker retrieval are therefore not certified.

No model or external-action credentials are inherited. Fetch egress refuses anything except the local fixture API. All prompts are non-executing requests/advice/proposals; the runner does not authorize real action sinks. No external email/device/wallet execution is certified. Public route/Office transport authentication is outside this direct application-contract test.

## IQ-EVAL-OMA-001 — exact production failure class

| Turn | Observed | Primary classification |
| --- | --- | --- |
| Arrive in office; what needs attention | Retrieves 20/39 leads, three opportunities, report and three developments; no material compression. Claims all opportunities stale >14 days although one is 8 days. | Evidence compression; P0 false aggregate statement |
| Which three move Ochiga forward | Capability catalogue, no priority-set creation | Executive objective recognition / evidence planning |
| Why second more important | `IQ Qualified Abuja JV — qualified`, selected from old lead list | Reference resolution against wrong result-set meaning |
| Chairman says financing secured | Capability catalogue | Material fact/objective update absent |
| Does that change priority | Repeats qualified lead status | Reassessment absent, upstream objective/target failure |
| Delegate versus own decision | Capability catalogue | Initiative/objective failure |
| Next move, not menu | Capability catalogue | Initiative/response failure |

The last two turns extend, rather than replace, the five-turn production meaning. No prompt-specific runtime changes were made.

## Top ten root causes and proposed canonical repair locations

1. **False universal list summaries (P0, 2 turns).** `OfficeCorporateCapabilityModules.ts:156` `summarizeListAnswer` emits `All` whenever there is one nonempty category, without comparing category count to list count. Opportunities with ages 8/21/60 produce the disproved universal claim. Repair the existing summary arithmetic; do not add a reasoner for this.
2. **Failed handoff promises (P0, 2 turns).** `PublicOpportunityCapabilityModule.ts:212` `composeCallbackAnswer` promises team follow-up even when `requestOfficeHandoff` returns `ok:false`. Preserve failure truth and distinguish requested from accepted handoff; no new workflow system.
3. **Cognitive objective falls to catalogue/unsupported (127 turns).** Existing semantic/capability/application path handles narrow domain requests but does not represent many prioritization, delegation, trade-off and qualification moves. Review existing semantic frame, objective/context, evidence planning and response contracts before proposing any extension.
4. **Operation/domain overcapture (41 turns).** `SemanticFrameParser.ts` applies device-operation heuristics before other operation families; a broad `why` becomes device diagnosis when no business domain was recognized. Recommendation/report and generic request vocabulary similarly steals the intended task. Fix class-level precedence, not phrase lists.
5. **Reference meaning differs from mechanical resolution (19 turns).** Old lists survive unsupported priority requests; hot-room return resolves to a wallet transaction. Existing result-set provenance, objective and domain-return ownership need stronger validation; do not add a memory store.
6. **Evidence selection/compression absent (8 turns).** Correct lists do not become requested comparisons/subsets; filtering and relevance are not equivalent to retrieving records. Inspect existing evidence planner and capability result contracts.
7. **Known facts repeated instead of judgment (8 turns).** Relevant maintenance/camera/lead facts persist, but why/verification/comparison gets status repetition. Evaluate a bounded canonical reasoning step only after input evidence and objective are correct.
8. **Reassessment and qualification state incomplete (3 explicit reassessment turns plus upstream objective failures).** Title readiness, changed location, sale constraints and reported financing fail to reliably update the active objective. Reuse `publicOpportunityObjective` and thread/result-set contracts; do not misuse durable GoalRuntime.
9. **Negation/cancellation mishandled (9 action-judgment turns).** `Do not turn it off` creates a power-off clarification workflow. `Cancel any pending proposal` leaves it active. Existing parser and workflow restoration own this; no device execution occurred, but P1 remains material.
10. **Priority eligibility and useful initiative weak.** One observed ranked maintenance response includes a resolved low-priority item as work to start. `prioritizeResultSet` sorts all refs without excluding resolved work. Twelve P2 acknowledgments push useful qualification back to the visitor; two P2 cross-home answers safely use own scope but fail to explain the requested scope restriction.

Do not conflate root-cause attribution confidence: false-summary and failed-handoff branches are source-proven; general objective/selection failures are behavior/trace-proven, with a narrower implementation diagnosis still required before repair.

## Concrete strengths and weaknesses

- **Strong bounded evidence judgment:** FAC-002:1 explicitly says camera current video state is unknown and configuration does not prove working video. CON-005:1 refuses to call stale devices physically offline. No strong executive comparative reasoning was demonstrated; do not manufacture an example.
- **Useful bounded continuity:** FAC-006 returns to the original water maintenance issue after cameras/visitors, then explains lack of resolution. Oma lead #2 remains selected across a financial switch in OMA-005:5.
- **Weak reasoning:** FAC-003:6 answers what evidence would prove repair with only the number of maintenance records.
- **Evidence failure:** OMA-007:1 returns the whole lead list instead of comparing the named qualified and speculative opportunities.
- **Objective loss:** OSA-001:4 drops the unperfected-title update; CON-008:5 returns a wallet transaction when asked to return to the hot room.
- **Poor initiative:** OMA-001:7 returns the catalogue after explicitly being asked for one next move.
- **Poor communication/truth:** OMA-001:1 uses a false `All` statement; several answers expose `office_tasks query read`-style internal labels.
- **Poor action judgment:** CON-010:4 creates a draft from a negative instruction, and :6 fails to cancel it. Clarification is not an acceptable substitute for recognizing cancellation.

Privacy probes exposed no protected cross-home/Office records in the inspected responses. This does not prove every possible privacy path. Public/Core handoff failure is correctly separate from successful external callback execution, which was not available.

## Five blocked observations

- OMA-005:4, OMA-009:1: no estate financial breakdown in inherited fixture.
- FAC-004:1, FAC-004:4: resident-private device fixture is not an authorized estate-device fixture; do not widen Facility access to satisfy a test.
- CON-004:7: pre-existing synthetic security recommendation lacks reproduced underlying-signal provenance in this run.

All 280 application calls did execute; BLOCKED refers to the cognitive assessment for these five, not skipped conversation calls. External worker integration and execution are separately untested, not counted as passes.

## Trace, latency and provider boundary

280 durable traces carry opaque turn/thread references, selected capability, authority, evidence counts, terminal outcomes, persistence and emitted stage timings. Raw prompts/answers remain only in the synthetic evaluation artifact and canonical local conversation store, not trace records. The runtime still has null trace fields on some early/follow-up paths; raw response/result-set records support those diagnoses rather than inventing trace data.

Local measured latency includes waiting for trace writes: min 32 ms, median 50 ms, p95 104 ms, max 180 ms; 20.747 seconds total run. This is not production latency or a before/after improvement claim.

The exercised paths are deterministic canonical behavior. Direct provider calls remain in bounded modules: `communicationRuntime/replyClassifier.ts`, `utils/ai.ts` automation parser, `PlanStudioCapability.ts`, and language-teacher providers. This baseline injected no provider key, model or replacement reasoner. A provider-backed high-level judgment experiment may be warranted later inside existing Core, but cannot repair incorrect evidence, negation or truth accounting merely by adding a model call. Production-provider parity is not certified here.

## Validation

| Check | Result |
| --- | --- |
| Backend build (`npm run build`) | PASS |
| Typecheck (`npm run typecheck`) | PASS |
| Frozen Wave 11 full live corpus | 131 PASS / 1 FAIL / 0 BLOCKED; unchanged known `utilities.usage.read` unavailable capability |
| IQ corpus | 40 PASS / 235 FAIL / 5 BLOCKED |
| IQ persistence + durable trace | 280/280 each |
| `wave11-intent-capability-contract-smoke.mjs` | PASS, 37 parser classes |
| `wave11-terminal-persistence-guard-smoke.mjs` | PASS |
| `wave9-context-authority-smoke.mjs` | PASS |
| `wave9-memory-context-smoke.mjs` | PASS (isolated injected-failure logs expected) |
| `wave10-canonical-fallback-retirement-smoke.mjs` | PASS |
| `wave10-automation-authority-smoke.mjs` | PASS |
| `oyi-security-adversarial-smoke.mjs` | PASS |
| `oyi-workflow-durable-continuation-smoke.mjs` | FAIL: expected one device command after confirmation, observed zero; source unchanged from main; requires separate diagnosis, not silently dismissed |
| IQ artifact/target-refusal check | PASS: 40 distinct threads, 280 distinct traces, unchanged prompts, nonlocal endpoints refused before network access |
| `git diff --check` / staged diff check | PASS |
| Changed-file secret-pattern scan | PASS: 7 files, zero JWT/private-key/provider-key/credential-URL pattern hits; not a claim of exhaustive secret-detection coverage |
| Full historical/PostgreSQL matrix | NOT RUN at this baseline-only checkpoint; no claim of full regression certification |
| Merge/deployment/production mutation | NONE |

Reproduction: install pinned packages, build, discover the retained local fixture credential securely using Supabase status, invoke `scripts/intelligence-quality-v1-run.mjs` with only local `SUPABASE_URL` and `OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY` in a clean environment. It refuses an existing baseline artifact to prevent accidental overwriting. Review explicitly with `scripts/intelligence-quality-v1-review.mjs`; this applies the recorded reviewer annotations, not a general automated evaluator. `scripts/intelligence-quality-v1-artifact-check.mjs` checks corpus integrity, trace correlation, persistence and production-target refusal. Runtime stdout/stderr remain local temporary logs, not committed.

## Stop boundary and next repair order

Baseline-only work is complete; **no behavioural fixes, new runtime contracts or changes to the Interaction Layer are included**. Freeze this evidence before repairs.

Proposed order: (1) P0 summary quantifiers and failed-handoff truth; (2) negation/cancellation and result-set provenance; (3) cognitive objective/semantic precedence and public fact correction; (4) bounded evidence selection, material prioritization and reassessment; (5) initiative/communication. First resolve the five fixture assessment limitations in a versioned follow-up without rewriting this baseline. Every repair must rerun the relevant journey/family, all 40 IQ journeys and the unchanged 132-turn structural corpus.

**INTELLIGENCE QUALITY NOT YET CERTIFIED.**
