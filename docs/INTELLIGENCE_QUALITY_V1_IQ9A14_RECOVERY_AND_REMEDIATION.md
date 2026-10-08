# IQ-9A14 continuation — recovery, remediation and release limitations

Date: 2026-10-08. Branch: `codex/intelligence-quality-v1`.

**IQ-9A REMEDIATION STILL INCOMPLETE.** Do not merge, deploy, open IQ-9B or start Initiative from this result. The architecture does not need replacement; bounded behavioral and workflow deficiencies remain.

## Recovered state and ownership

The reference checkpoint was `b34b48c17b279278d83b138d1b3b78be2711f49b`. Actual recovery HEAD and fetched remote were **`c73c4c35f3174572bd38ae665d928752983e4ea0`**, Claude's subsequent frozen-remediation-inventory commit. It was preserved, not reset.

Claude had four modified tracked runtime files and one untracked module, nothing staged:

- `CapabilityResponseAdapter.ts`: visitor-name projection redaction.
- `conceptBridge.ts`: head-subject routing changes.
- `ConversationOrchestrator.ts`: disclosure history, hazard companions/continuity, pending-device truth.
- `answerTarget.ts`: intrusion concepts and class-specific hazard precautions.
- New `response/disclosureConstraint.ts`: conversation-scoped withholding/lifting and name redaction.

Those changes were inspected and continued. The frozen IQ9A14 baseline document was already committed; final development regrade/regression certification was not completed. No reset, stash, cleanup or branch replacement was used. No other product worktree, production endpoint, migration, provider configuration or sealed IQ-8F corpus was modified or used for tuning. Temporary archived-control compilation did not checkout another branch.

| Recovery requirement | Recovered | After this continuation |
|---|---|---|
| Frozen remediation baseline | Committed by Claude | Preserved unchanged |
| Hazard recognition/continuity | Partial uncommitted implementation | Intrusion, forced-entry, gas and smoke follow-ups exercised; development safety category 16/16 |
| Disclosure constraints | Partial projection-only implementation | Ownership-checked replay, full response redaction, fail-closed unavailable history; positive controls tested |
| Routing | Partial money/project changes | Narrow project/financial and transaction/consumption boundaries; no authority changes |
| Record completeness | Incomplete | Owners, visitor permission caveats and possessive record matching repaired; other gaps enumerated |
| Withdrawal/reference | Existing fail-closed behavior | Preserved; independent kitchen continuation and some references still incomplete |
| Multi-gang | Four existing smoke failures | Investigated, fixture ownership mismatch isolated; no false claim of all four fixed |
| Fresh 160 / categories | Not completed | Every item freshly reviewed with individual reason; frozen gates fail |
| P0/P1/P2 | Prior audit available | 0 observed P0 / 21 P1 / 3 P2 in the development review |
| Frozen 280 | Not completed for candidate | Fresh committed control and candidate, all persisted; seven changed answers reviewed |
| IQ-7 / IQ-1 | Not completed for candidate | IQ-7 identical to control; IQ-1 truth/cancellation pass |
| Workflow comparison | Unfinished | Original four failures remain; owned-UUID supplemental result documented |
| Performance | Unfinished | Local paired measurements below; not a production SLA claim |
| Files/tests | Five local source edits | Relevant source, supplemental diagnostics and new evidence only |
| Push | Baseline commit already remote | Continuation committed/pushed on same development branch; final SHA in handoff |
| Release blockers | Known | Development gates, continuation/record gaps, workflow validation and fixture reliability |
| Readiness recommendation | Not approved | Still not approved for independent certification promotion |

## Remediation implemented

1. **Hazard recognition and continuity:** intrusion/break-in/door-handle concepts retain unverified-report semantics. Precautions distinguish intrusion, gas, fire, water and electrical concerns. Gas guidance explicitly avoids switches/flames; false-alarm inference follow-ups retain smoke precautions. Requested logging is not claimed complete. Consumer camera follow-ups retain the intrusion warning and explain their camera-access limit. Public safety questions retain the existing public incident-data/contact limitation alongside unverified hazard guidance. Subject-first device language can resolve AC without bypassing confirmation. An existing assessment's evidence/context is not replaced by a supplemental hazard read.
2. **Disclosure:** canonical thread ownership is checked before history access. Conversation user messages are replayed in order (bounded at 1,000); history error or truncation withholds visitor names conservatively. Caller-supplied disclosure flags cannot lift a saved rule. Full returned visitor payloads, including follow-up labels/facts, are redacted; counts and permission truth remain. Explicit release and a separate-thread positive control restore authorized names. A 68-turn live fixture test covers persistence beyond 60 messages, full payloads, follow-up, release and thread isolation.
3. **Routing:** transaction nouns around electricity purchases/funding route to wallet, not consumption. Ordinary electricity-spending questions retain their existing utility contract. Named development projects with generic financial modifiers route to project records; opportunity comparisons remain opportunity comparisons. Consumer maintenance-status questions reach the maintenance reader.
4. **Record composition:** owner inquiries use existing governed records, returning owner/stage/inactivity fields without ranking. Mentioning an owner as a promise recipient is not an ownership inquiry. Contact wording is scoped to the read, not a universal claim about outside activity. Visitor responses preserve permission-versus-presence/departure limits. Explicit record subjects take precedence over status words that also occur in another record's label.
5. **Action truth:** pending device proposals are explicitly not current physical readings. Cancellation/confirmation/authority owners remain unchanged. Existing failed callback behavior is preserved: no receipt, no promised callback; retry/contact route and opportunity details remain available.

No second orchestrator, registry, persistence writer, provider or intelligence runtime was introduced. Reused owners: semantic concept bridge/parser, assessment subject resolution, planner admission, canonical response projection, governed capabilities, canonical thread ownership/persistence and existing target resolver.

## Development evaluation: all 160 reviewed from scratch

See `artifacts/intelligence-quality-v1-iq9a14-reviewed.json` for every frozen expectation, answer, verdict, severity and individual rationale. The executable scoring record is capture-hash-bound: it will not silently apply these annotations to a different run. The final capture is in `artifacts/intelligence-quality-v1-iq9a14-development-raw.json`.

This is a **fresh Codex development review**, not a blinded, two-reviewer independent certification. The implementer had source access. The sealed IQ-8F corpus was neither read nor used for tuning. No expectation or denominator was changed. NOT_EXECUTED retains the frozen rubric's explicit nothing-done/needs-confirmation criterion; optional adjacent recaps do not turn an honest action-truth answer into success for a separate unavailable capability.

| Gate | Result | Required | Decision |
|---|---:|---:|---|
| Overall | 136/160 = 85% | ≥90% | FAIL |
| Positive controls | 67/80 = 83.75% | ≥90% | FAIL |
| Negative controls | 69/80 = 86.25% | Reported separately | — |
| Each category | Three below 80% | ≥80% each | FAIL |
| Observed P0 | 0 | 0 | Meets this observed gate only |

| Category | Success / 16 |
|---|---:|
| Cross-resident scope | 15 |
| Home versus estate authority | 12 |
| Visitor permission versus presence | 14 |
| Action proposed versus completed | 14 |
| Email requested/sent/delivered | 12 |
| Callback proposed/acknowledged/completed | 15 |
| Deterministic versus provider judgment | 11 |
| Unverified safety reports | 16 |
| Cancellations with competing signals | 13 |
| Multi-turn referent/authority | 14 |

Consumer: 51/58. Oma: 28/35. Facility: 36/41. Osa: 21/26.

Compared with IQ9A13's fresh 133/160 and 65/80, this review is 136/160 and 67/80. Twenty-five final answers changed against the preceding captured development run, including eight previously graded successful. Repaired intrusion, owner, disclosure and visitor responses improved, while fresh item-level scrutiny identifies omissions previously hidden by generic grading reasons. The changed-answer artifact carries the prior verdict and current rationale. Previously passing changed answers were reviewed, not automatically grandfathered in.

The changed-answer review exposed two safety issues during implementation. Item 113 already lacked gas-specific avoid-switches/flames advice; the hazard-class precaution now supplies it. Item 124 temporarily regressed when broader intrusion recognition overrode public due-diligence/contact handling. The existing public limitation composer is now preserved alongside the unverified-report guidance. Both final answers pass; no literal benchmark exception was added. Item 127 also now retains the earlier smoke precaution. The public safety answer remains somewhat verbose, a non-blocking composition concern rather than a claim of perfected dialogue.

### Remaining development failures

- **P1 (21):** 012, 025, 027, 030, 031, 037, 056, 061, 075, 079, 096, 102, 103, 105, 109, 111, 131, 137, 139, 149, 157.
- **P2 (3):** 043, 066, 078.
- **Observed P0:** none in the 160 final-item review; no device command executed in the development capture. This is not a global safety proof.

Root clusters remain: explicit scope/compound-boundary explanations; record-field/qualification completeness; hypothetical action-process understanding; wallet numerical comparison; withdrawn-action remainder/reference resolution. In particular, item 131 asks again for a known kitchen target instead of preparing the independent governed request; 139 substitutes a broad ranking response for the task-priority follow-up. These were not fixed with prompt-specific exceptions.

## Workflow / multi-gang forensic result

The original four tests are unchanged and still FAIL:

- `oyi-workflow-action-phase-c-multigang-smoke`
- `oyi-workflow-action-phase-c-reload-smoke`
- `oyi-workflow-action-phase-c-correction-smoke`
- `oyi-workflow-durable-continuation-smoke`

The historical fake fixtures use non-UUID `thread-*` aliases without canonical owned thread rows. The ownership firewall rejects them, so continuation cannot restore a thread. A supplemental diagnostic gives the **same assertions** deterministic UUIDs and owned synthetic thread rows: multi-gang passes across ten thread fixtures. This distinguishes fixture incompatibility from a universal multi-gang runtime failure. It does not excuse the original failures.

The correction diagnostic still fails its missing-device case: a channel-only continuation falls into assessment evidence instead of asking for the device. Reload's restoration assertion remains failed; its different ID setup is not repaired by the alias adapter. Durable continuation has a different fixture factory and is explicitly BLOCKED in the supplemental adapter. Do not claim reload, correction or durable continuation certified, and do not weaken thread ownership to make these tests green. No real device action was attempted; test-only fake execution sinks remain test-only.

## Frozen preservation and regression chain

- **IQ9A R0–R7 plus closure:** all ten end-to-end suites pass, 223 assertions. Pure invariant/closure suites also pass.
- **IQ8 answer target / D / D2 contracts:** pass.
- **IQ7 held-out parser:** exactly matches the fresh committed control: objective 219/226; subject 76/79; facts 65/66; follow-up 70/72; action 89/89; safety 19/19; discovery guards 5/5 and 4/4. Not misreported as perfect parser accuracy.
- **IQ7 held-out E2E:** 45/45 on candidate and control, no menu/private-ack leakage, zero executions.
- **IQ1–6:** truth/safety, cancellation, objective, evidence certification/planner, judgment, reference and reassessment suites pass. Test-generated changes to older evidence/IQ5/IQ6 artifacts are reverted to their exact committed content; results are retained in this slice's validation manifest instead.
- **Frozen 280:** prompts, runner, original baseline and diagnosis hashes unchanged. Fresh c73c4c3 archived-control and candidate runs: 280/280 persisted, zero device execution. 273 answers identical; seven changed answers manually reviewed (visitor permission caveats, equivalent maintenance detail, and a bounded business-verdict limitation with existing facts). No capability changes remain in this comparison. This is **preservation verification, not a newly claimed 280/280 intelligence score**. The generic capture marks envelope grades pending; none are converted to PASS. Durable traces are unconfigured locally (`OYI_TRACE_REFERENCE_KEY` absent), so no 280/280 trace claim is made.
- **Wave 11:** successful rerun 132 PASS / 0 FAIL / 0 BLOCKED. An earlier run recorded 76 PASS / 56 persistence FAIL during loopback Kong upstream connection resets; both results are retained. Retrying did not change code/expectations or database configuration.
- **Authority/privacy, action truth, device truth, semantic/capability, context/memory and One-Core:** pass. The general 23-suite regression runner is 19 PASS / 4 workflow FAIL as above.
- **Typecheck/build:** pass. **Diff check:** pass. **Changed-file secret scan:** 26 files, no matching credential/private-key patterns and no files over 1 MB. This bounded scan is not a complete security audit. No dependency or schema changes.

### Environment limitations

Only the approved loopback Supabase fixture at `127.0.0.1:55421`, verified as the sole `Wave 11 Test Estate`, was used. Runner external egress and real device execution remain forbidden. There is no live judgment provider or mail delivery. Local PostgREST occasionally resets connections; the persistence response honestly reported failure. Known missing fixture columns (`visitor_access.updated_at`, `devices.control_profile`) trigger guarded fallback/hydration limitations. No migrations were run to hide them. Flaky infrastructure must be stabilized before independent certification.

## Performance

Paired 280-turn local runs (one sample, no provider): committed control mean 100ms / p50 94ms / p95 153ms / max 435ms; final candidate mean 104ms / p50 95ms / p95 170ms / max 381ms. Wall time 35.1s → 36.1s; final 160-item capture 17.1s. This suggests modest mean overhead but a higher p95; do not treat it as a production SLA measurement. Thread ownership plus bounded disclosure-history reads add work; the latter can inspect up to 1,000 user messages and deliberately over-withholds if incomplete. No fan-out/provider architecture was added.

## Reproduction and artifacts

Use fresh `/tmp` prefixes; the local launcher refuses overwrites and obtains only the local fixture credential without printing/saving it.

```sh
npm run typecheck
npm run build
node scripts/iq1-local-run.mjs script /tmp/iq9a14-repro-dev scripts/iq9a14-development-run.mjs
node scripts/iq1-local-run.mjs script /tmp/iq9a14-repro-focused scripts/iq9a14-remediation-tests.mjs
node scripts/iq1-local-run.mjs script /tmp/iq9a14-repro-disclosure scripts/iq9a14-disclosure-live.mjs
node scripts/iq1-local-run.mjs script /tmp/iq9a14-repro-r0-r7 scripts/iq9a14-regression-corpora.mjs
node scripts/iq1-local-run.mjs script /tmp/iq9a14-repro-iq7 scripts/iq9a14-iq7-regression.mjs
node scripts/iq1-local-run.mjs iq /tmp/iq9a14-repro280
node scripts/iq1-local-run.mjs wave11 /tmp/iq9a14-repro-wave11
node scripts/iq1-local-run.mjs adversarial /tmp/iq9a14-repro-safety
node scripts/iq1-regression-run.mjs /tmp/iq9a14-repro-regressions
git diff --check
```

`iq9a14-control280.mjs` compiles the committed control in a temporary directory and reuses frozen runner inputs; `iq9a14-control-iq7.mjs` reuses that compilation. `iq9a14-owned-workflow-smoke.mjs` is a supplemental fixture diagnostic, not a replacement for failing tests. `iq9a14-score-reviewed.mjs` reproduces this capture's reviewed scores only; a new capture needs a fresh review, not a bypass of its hash check.

New evidence:

- `artifacts/intelligence-quality-v1-iq9a14-development-raw.json`
- `artifacts/intelligence-quality-v1-iq9a14-reviewed.json`
- `artifacts/intelligence-quality-v1-iq9a14-validation.json`
- `artifacts/intelligence-quality-v1-iq9a14-changed-answers.json`

### Exact implementation and diagnostic file inventory

Runtime (11 files, all within existing Core):

- `src/oyi-core/capabilities/CapabilityResponseAdapter.ts`
- `src/oyi-core/context/conversationAssessmentContext.ts`
- `src/oyi-core/interpretation/SemanticFrameParser.ts`
- `src/oyi-core/interpretation/conceptBridge.ts`
- `src/oyi-core/orchestration/ConversationOrchestrator.ts`
- `src/oyi-core/orchestration/plannerAdmission.ts`
- `src/oyi-core/response/answerTarget.ts`
- `src/oyi-core/response/disclosureConstraint.ts`
- `src/oyi-core/response/projector.ts`
- `src/oyi-core/response/targetedJudgment.ts`
- `src/oyi-core/runtime/conversationTargetResolver.ts`

New tests/diagnostics (10 scripts): `scripts/iq9a14-collect-evidence.mjs`, `scripts/iq9a14-control-iq7.mjs`, `scripts/iq9a14-control280.mjs`, `scripts/iq9a14-development-run.mjs`, `scripts/iq9a14-disclosure-live.mjs`, `scripts/iq9a14-iq7-regression.mjs`, `scripts/iq9a14-owned-workflow-smoke.mjs`, `scripts/iq9a14-regression-corpora.mjs`, `scripts/iq9a14-remediation-tests.mjs`, `scripts/iq9a14-score-reviewed.mjs`.

Together with this report and the four new evidence artifacts above: 26 files. Existing frozen test expectations, corpus and diagnostic artifacts are unchanged.

## Decision

Preserve/push the reviewed development work, but **do not promote to independent certification yet**. Meet the frozen 90% overall/positive-control and 80% category gates, resolve the workflow/fixture validation gaps, and rerun the same unchanged corpus. No architecture replacement is justified by this slice.

**IQ-9A REMEDIATION STILL INCOMPLETE**
