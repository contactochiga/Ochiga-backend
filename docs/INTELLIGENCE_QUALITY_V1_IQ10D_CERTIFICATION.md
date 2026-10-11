# IQ-10D — typed evidence and answer completeness

Targeted development certification only. Overall Oyi intelligence remains **NOT CERTIFIED**.

## Checkpoint and frozen contract

- Worktree: `/Users/ochigaidoko/Documents/oyi-intelligence-quality`.
- Branch: `codex/intelligence-quality-v1`.
- Starting local and remote HEAD: `993bc507673e6c7665e6e5332a3202e4daf57743`; worktree was clean.
- Origin: `git@github.com:contactochiga/Ochiga-backend.git`.
- Contract committed **before runtime changes**: `2109ff365642065afe254e010ed1e03dfea5ec8c`.
- Frozen contract: `docs/INTELLIGENCE_QUALITY_V1_IQ10D_CONTRACT.md`, synthetic journey definitions, and the unchanged 33-assertion `iq10d-evidence-contracts.mjs`.
- Implementation identity is the commit containing this report and its hashed source manifest; the delivery message records the full pushed HEAD. No merge, deployment, schema migration, provider configuration change or other repository change.

The report artifact is `artifacts/intelligence-quality-v1-iq10d-certification.json`. It includes source/contract hashes, exact changed answers, individual preservation reviews, all 58 regression-suite outcomes, local run hashes, and the four-worker synthetic answers. Existing frozen corpora were not rewritten or regraded. The sealed IQ-9B corpus was not replayed or used for tuning.

## Audit and canonical owners

The existing inventory contains 71 read collectors. The current response adapter has 23 explicit capability-family entries, enumerated automatically in the artifact; other capabilities retain generic typed-table or specialized presentation ownership. This is not a new certification of all 71 collectors.

| Family | Evidence-to-answer boundary | Change or preserved boundary |
|---|---|---|
| Office leads/opportunities/projects/tasks/support/meetings/portfolio/documents/reports/financial | Permission-gated supplied snapshot → record list → envelope | Keep supplied fields, identity, owner and age; label known total as the open population, not the attention/stale subset. No Backend query around Office. |
| Maintenance | Existing fact loader → `maintenanceAnswerRows` | Retain category, priority, assignment, timestamps, scope, freshness, identity and provenance. Assignment alone does not prove work has started. |
| Visitors | Existing fact loader → `visitorAnswerRows` | Retain expiry, pass state, purpose and identity. Exclude access codes. Every applicable projection preserves permission-versus-arrival limitations. |
| Wallet | Verified-home wallet/transaction loader → capability → envelope | Actual scoped wallet currency; unknown amounts remain unknown; source balance and as-of stay separate from transaction history. |
| Devices | Existing authorized inventory/table → envelope | Preserve device ID and stale/current distinctions; a state filter cannot silently turn stale records into matching current-state evidence. |
| Cameras | Existing registry/current-state reader → capability | Preserve already-selected location and camera identity in typed records, with explicit partial/unobserved limitations. No new acquisition or live-video claim. |
| Utilities | Existing spending/purchase/disabled-usage contracts | Spending remains distinct from consumption. Disabled usage stays unsupported. |
| Public opportunities | IQ-10C selected entity → held facts/projector | Retain constraints and caller-supplied provenance. A no-sale correction cannot replace lease with sale or disappear in a selection-only return. |
| Multi-source | IQ-3B planner and R3 multipart | Existing bounded, authority-checked collection remains owner; available sources survive missing/partial companions. No fan-out added. |
| Actions/communications | Existing specialized action truth and handoff | No generic projector takeover of confirmation, action results, receipt or verified completion. |

### Small contract extensions

`EnvelopeRecord` adds optional entity type, scope, freshness, truth state and provenance, copying only supplied structured members. Existing identity/time/age fields now survive metadata mapping. No prose extraction, new evidence engine or context store.

`AnswerTarget.requested_fields` carries safe factual facets once from the existing derivation boundary. Multiple requested fields, including status plus another field, are answered or explicitly unavailable; they are not clipped after three. Unmatched subjects clarify rather than borrow another record. Internal UUIDs stay out of generic detail prose.

The narrow plural-possession factual follow-up class reuses the authorized current-collection read. It cannot introduce another domain or an action. The orchestrator still revalidates result-set authority before rereading; no cached reference becomes authorization.

## Truth and completeness results

| Facet | Verified behavior |
|---|---|
| LIST | Records remain named; active/inactive and other supported status filters are enforced. Unknown does not become active/open. |
| COUNT | Returned count differs from known population total. The known open total survives filtering, including a genuine total of zero. Partial empty does not establish population zero. |
| STATUS / DETAIL | Requested category, owner, status, priority and other supplied safe fields survive; unavailable fields are explicit and entity-bound. |
| HISTORY | Wallet rows retain denomination/direction; a current-only source cannot invent an earlier snapshot. |
| VALUE | Actual balance, currency and as-of are preserved; null/non-finite values do not become zero. |
| SUM | Only the existing governed calculation is used. Missing amount, currency or direction prevents a certified aggregate; mixed currencies are grouped separately. The actual 50-record bound marks partiality. |
| YES/NO | Unknown lifecycle is not open; assignment is not commencement; visitor permission is not arrival; online availability is not power state. |
| EXPLANATION | A recorded reason can be shown. Status alone is described as insufficient to establish why. |
| COMPARISON | Named, finite, like-currency values can be compared as recorded fields. Unlike currencies/missing values receive an explicit limitation, not conversion or strategic judgment. |
| LIMITATION | Denied/unavailable evidence cannot become a related affirmative answer. Partial source coverage is not mislabeled as pagination truncation. |
| ACTION RESULT | Specialized ownership remains intact. No approval/provider acceptance is promoted to physical verification. |

The severity/priority correction adds source-field provenance to the existing judgment factor. It corrects a mislabeled supporting fact; it does **not** change ranking, weights, dominance, provider-off behavior or strategic judgment.

## New development validation

| Check | Before | Final |
|---|---:|---:|
| Frozen pre-implementation pure contract | 14 PASS / 19 FAIL | 33 PASS / 0 FAIL |
| Additional discovered-defect/positive controls | Added with failing reproductions where applicable | 34 PASS / 0 FAIL |
| Four-worker canonical journeys | New synthetic scenarios | 20 turns; 32 checks PASS; all saved and trace-correlated |

The four journeys cover Office selected owner and plural project status; Facility maintenance category and visitor epistemic limits; Consumer separate wallet history/balance, maintenance and device truth; and Osa two properties with different locations/structures, one no-sale constraint, targeted recall and withdrawal. The first property's lease and constraint do not contaminate the second property's JV. No private Office access is added to Osa.

No physical devices were executed in these journeys. Existing isolated-sink controls remain fixtures, not real-world execution. No new P0 was observed within the targeted tests and preservation review. These numbers are **not** a fresh overall intelligence score.

Paraphrases and new scenarios are maintainer-authored, not independently blinded. Changed frozen-PASS answers received a separate source/contract review, recorded individually in the artifact; no independent external grader was commissioned. Do not describe this as independent certification or evidence of broad linguistic generalization.

### Discovered during validation

- Lease/no-sale update was initially misinterpreted or discarded for a selected property; the new two-property control caught both paths.
- Plural project-status follow-up fell into capability advertising; the authorized collection continuation now answers it.
- An intermediate stale-device answer omitted device names; preservation review rejected it. The final answer keeps the names while explicitly denying knowledge of current offline status.
- New assignment fields exposed an existing assignment-implies-work-started shortcut. Assignment-only and recorded-progress controls now distinguish them.
- Additional tests preserve mixed field/status coverage, named-record filters, known totals, unknown lifecycle and source-partial-versus-truncated semantics.

Two legacy implementation-shape assertions were migrated openly, not silently waived:

1. `iq9a15-focused-tests.mjs`: cross-currency comparison previously required a null projection. It now requires an explicit LIMITATION, differing-currency disclosure and no ranking. This enforces the new requested-facet contract without allowing a comparison.
2. `iq9a4-r0-tests.mjs`: the progress-positive assertion now expects “recorded as in progress” instead of conflating it with assignment. The affirmative progress expectation remains; a separate assignment-only negative control was added.

All original frozen corpus/scoring expectations and the IQ-10D pre-implementation tests are unchanged. 846 other pre-existing documentation, artifact and script files remain byte-identical to starting HEAD.

## Preservation and full regressions

The final run prefix is `/tmp/iq10d-complete`. Its source-diff hash is unchanged from first typecheck through the last suite. Intermediate runs with source edits were explicitly excluded. `iq10d-report.mjs` fails closed on unexpected changed answers, source drift, new failed suites, missing persistence/correlation, IQ-7 drift, workflow-control drift or frozen-file changes.

| Suite | Final result |
|---|---|
| Frozen 280 | All 280 executed; 280 saved; 280 durable trace links; 560 paired messages |
| Answer preservation | 260 byte-identical answers; 20 changed, individually accounted for |
| Original frozen PASS set | 36 unchanged + 4 reviewed = all 40 preserved; no defensible regression found |
| IQ-10A | 33 safety live checks PASS; invariant suite PASS |
| IQ-1 cancellation | 10 scenarios PASS; no unintended execution attempts |
| IQ-10B | 25 reliability checks PASS; trace privacy/contract checks PASS; 11 export checks PASS |
| IQ-10C | 57 pure context checks PASS; 62 live checks PASS |
| IQ-7 held-out | Objective 219/226; subject 76/79; fact 65/66; follow-up 70/72; action 89/89; safety 19/19; explicit discovery 5/5; non-assessment 4/4 — all unchanged |
| IQ-7 E2E | 45/45; zero menu/private-ack leaks; zero executed actions |
| Wave 11 | 132 PASS / 0 FAIL |
| Broad chain | 53 PASS / 5 historical suite failures, unchanged from the accepted starting controls |
| Build/hygiene | Typecheck, build, diff check, changed-diff secret-pattern scan PASS |

The broad chain includes IQ-9A R0–R7 and closure, IQ-8 target/bridge/metamorphic/projector/routing, IQ-1–6, source certification/isolation, authority/privacy, security/adversarial, device/action truth, context/memory, semantic capability inventory, terminal persistence, canonical convergence and automation authority guards. Exact suite results are in the artifact, not summarized as a meaningless overall percentage.

The four changed original-PASS answers are FAC-002:1 and FAC-006:3 (camera identity with unknown current state), FAC-006:1 (same open water request plus category/timestamps), and CON-005:1 (same four device identities with explicit stale-state limits). The 16 other changes are source-label correction, known-population labeling, explicit partiality, visitor expiry, denomination and balance as-of. No FAIL-to-PASS promotion is claimed without new independent grading.

### Historical workflow exclusions

The original reload, multi-gang, correction and durable-continuation scripts still fail. Their aggregate owned-thread diagnostic is the fifth failing suite. With corrected synthetic ownership, multi-gang and durable continuation pass their assertions, while reload and correction still fail — exactly matching IQ-10C's recorded control. These are not repaired or relabeled as passing here. Multi-gang release claims remain excluded.

## Performance and infrastructure

Local provider-off frozen-280 timing: mean **84 → 85 ms**, p50 **81 → 85 ms**, p95 **123 → 115 ms**. Host/cache conditions are uncontrolled; neither a production SLO nor a speedup claim. The source changes add zero query round trips: wallet currency is selected in the existing wallet lookup, and camera location was already selected. There are no count queries, new fan-out, provider calls or background jobs.

Only the approved local fixture (`127.0.0.1:55421`) was used. IQ-10B's privacy allowlist, atomic persistence, trace correlation and failure-injection checks remain unchanged. Existing crash-before-trace-flush and whole-HTTP exactly-once limitations are not solved by this slice.

## Exact changed files

Runtime (14):

- `src/oyi-core/capabilities/PublicOpportunityCapabilityModule.ts`
- `src/oyi-core/capabilities/ReadCapabilityModules.ts`
- `src/oyi-core/domains/wallet/walletEvidence.ts`
- `src/oyi-core/evidence/judgment/dominance.ts`
- `src/oyi-core/evidence/judgment/evidenceIndex.ts`
- `src/oyi-core/evidence/judgment/types.ts`
- `src/oyi-core/evidence/sources/cameraReads.ts`
- `src/oyi-core/interpretation/followUpResolver.ts`
- `src/oyi-core/orchestration/ConversationOrchestrator.ts`
- `src/oyi-core/presentation/conversationAnswerPresentation.ts`
- `src/oyi-core/response/answerTarget.ts`
- `src/oyi-core/response/envelopeMappers.ts`
- `src/oyi-core/response/projector.ts`
- `src/oyi-core/response/resultEnvelope.ts`

Tests/reports/artifacts:

- `scripts/iq9a15-focused-tests.mjs`
- `scripts/iq9a4-r0-tests.mjs`
- `scripts/iq10d-control280.mjs`
- `scripts/iq10d-evidence-contracts.mjs`
- `scripts/iq10d-additional-contracts.mjs`
- `scripts/iq10d-evidence-live.mjs`
- `scripts/iq10d-validation.mjs`
- `scripts/iq10d-report.mjs`
- `scripts/iq10d-source-audit.mjs`
- `docs/INTELLIGENCE_QUALITY_V1_IQ10D_CONTRACT.md`
- `docs/INTELLIGENCE_QUALITY_V1_IQ10D_CERTIFICATION.md`
- `artifacts/intelligence-quality-v1-iq10d-development-contract.json`
- `artifacts/intelligence-quality-v1-iq10d-certification.json`

## Remaining limitations and decision

This is bounded typed-facet coverage, not arbitrary schema/language coverage. Unsupported consumption, unavailable physical measurements, strategic/provider-off judgment and historical workflow debt remain. Some public recall still uses technical field labels; no prose-polishing campaign or Initiative was undertaken. Source-provided partiality remains partial, not complete capability success. Broad intelligence and production readiness are not certified.

IQ-10E may begin **only after separate approval**. No IQ-10E/F or Initiative work has begun.

**IQ-10D TYPED EVIDENCE & ANSWER COMPLETENESS CERTIFIED — IQ-10E APPROVAL REQUIRED**
