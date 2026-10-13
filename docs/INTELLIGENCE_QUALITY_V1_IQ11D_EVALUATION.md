# IQ-11D — generalization experiment not certified

## Decision and runtime disposition

**IQ-11D NOT YET CERTIFIED.** The bounded deterministic candidate did not meet the frozen generalization gates. It introduced a subject-binding regression and three regression-suite failures. It was rejected in full, not tuned against the unblinded author cases. The final runtime is byte-identical to starting runtime `2984e9205708ab0e4d109377ac6877b6b2ef7855`.

Only new contracts, synthetic tests, the separate qualification proposal, rejected-candidate patch and evaluation evidence are delivered. No runtime implementation is promoted. No overall intelligence certification, merge, deployment, production migration, other-repository change or autonomous Initiative work occurred.

Starting branch and origin were verified clean: `codex/intelligence-quality-v1`, `git@github.com:contactochiga/Ochiga-backend.git`; local and live remote both matched the starting SHA. Final delivery SHA and remote verification are reported in the handoff. A document cannot embed its own resulting commit hash.

## Frozen sequence and independence

1. Diagnosis and measurable contract: `662eee6273b8441321ef0257dbf08b94fbe9df1e`.
2. Maintainer structural/live controls: `40477bb7051f263a05b6f92f82d7ad7529048ef6`.
3. Pre-runtime expiry-harness repair: `0ee3f2dea53486b68e6a34892beba1d54a1a9b69`. The first test compared nonexistent IDs; the repaired assertion checks canonical TTL expiry. Original failing output remains archived.
4. Structural scorer: `48bd83b272224d8bab6e431cc30b59383cf948f7`.
5. Separate model qualification proposal: `bfe8b382962d0239a3b845ee6f4f0b5de9dcc997`.
6. Reference/ambiguity controls and manifest freeze: `69c65009ee7d2c16ecdae4dfd680e6728ed05974`.
7. Independent-author corpus seal: `f58fd7d99a3485ef1dba6c3cba822bc4c53414f2`.

The fresh-context author received a bounded synthetic capability/authority specification and did not inspect implementation, prior examples, results or sealed corpora. The corpus records that provenance. This is procedural same-model separation, not human/statistical or OS-enforced independence. The maintainer saw aggregate baseline results before implementing and unblinded the author rows only after the candidate was frozen. No runtime tuning followed unblinding; the candidate was entirely reverted.

No sealed IQ-9B or IQ-10F questions were replayed. Historical diagnosis documents informed architectural ownership, not phrase additions.

## Architectural finding

Meaning is independently interpreted at several existing boundaries: legacy language understanding, operation derivation, conceptBridge, objective recognition, AnswerTarget, planner admission and contextual continuation. A coherent-looking individual field does not guarantee a coherent whole frame.

The attempted changes reused the existing owners:

| Owner | Candidate change | Why insufficient |
|---|---|---|
| SemanticFrameParser | Reconcile generic device-read operations with non-device domains; use corrected text consistently | A correction to the operation is not necessarily a replacement subject. Discarding the preceding clause lost a valid task subject. |
| AnswerTarget | Reuse the existing concept view for identical text; preserve clause-local multipart derivation | Sharing a concept view prevents duplicate work but does not establish correct clause attachment or negation scope. |
| plannerAdmission | Specialized/action and explicit factual ownership before inherited assessment | A factual facet can belong to the current assessment. Treating it as a new lookup broke established continuation. |
| conversationAssessmentContext | Suspend old assessment for an explicit factual read with null objective | Suspension dropped useful parked context and broke room/topic return. |
| ConversationOrchestrator | Do not treat null objective as positive assessment evidence | Removing a permissive fallback alone does not supply the missing discourse relation. |

The rejected patch is retained losslessly at `artifacts/intelligence-quality-v1-iq11d-rejected-candidate.patch.gz`; it is **not** applied runtime code. Compression preserves unified-diff whitespace without treating it as source whitespace. No second parser, registry, authority engine, store or orchestrator was introduced.

The next semantic contract needs an explicit, validated relationship between the current request and existing subject: new subject, same-subject facet, operation correction, entity correction, material fact, selection or return to parked context. Authority remains independently revalidated. Merely reordering precedence cannot reliably infer that relationship.

## Frozen generalization results

64 authored structural cases: 32 primary, 16 paraphrases and 16 operation flips; each worker has 8/4/4. These are parser-level cases, **not 64 independently graded end-to-end conversations**. `prior_context` activates assessment interpretation; it does not restore a full entity graph.

| Worker | Primary joint baseline → candidate | Objective /16 | Subject /16 baseline → candidate | Operation class /16 | Target /16 | Successful paraphrase pairs /4 | Flips /4 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Oma | 1/8 → 1/8 | 8 | 12 → 11 | 15 | 6 | 0 | 0 |
| Osa | 1/8 → 1/8 | 8 | 3 → 3 | 15 | 8 | 0 | 0 |
| Facility | 0/8 → 0/8 | 9 | 11 → 11 | 16 | 5 | 0 | 0 |
| Consumer | 0/8 → 0/8 | 12 | 11 → 11 | 15 | 5 | 0 | 1 |

Primary joint: **2/32 → 2/32**. Successful paraphrase pairs: **0/16 → 0/16**. Operation flips: **1/16 → 1/16**. No worker meets the frozen gates. A pair of matching failures is not successful consistency. The only metric change is a lost Oma subject; its overall case already failed before the candidate.

Important protocol defects are retained, not silently repaired after observing answers:

- The author/scorer DETAIL mapping excludes SUMMARY, penalizing some legitimate summary frames.
- Some authored new-action expectations use ACTION_RESULT, although proposing an action and reporting its result are different contracts.
- A supported assessment may appropriately project YES_NO_WITH_REASON rather than ASSESSMENT. Exact target equality can overstate such failures.
- The operation metric checks mutation/non-mutation, not the correctness of every read/status/history operation. It can understate routing errors.
- Null versus explicit retrieve is graded strictly. A downstream path may still answer correctly.

Therefore **2/32 is the frozen structural gate result, not an independently established end-to-end intelligence score**. These defects prevent strong numerical product claims, but do not erase demonstrated wrong domains, negated-facet routing, regression failures or the lack of improvement. Future evaluation must validate the semantic grading schema before authoring and include full multi-turn execution and adjudication.

## Targeted controls and conversational continuity

Maintainer structural tests: **38/89 baseline → 89/89 rejected candidate → 38/89 restored runtime**. The candidate's local gains did not generalize. Sixteen explicit-name/ordinal/ambiguous-location/other reference controls continue to pass; they exercise existing IQ-10C owners, not broad novel conversational grammar.

The new 32-turn live baseline (eight turns per worker) passed its bounded assertions and exact reconciliation. It covers Osa entity sizes/corrections/withdrawal, Office and Consumer subject returns, Facility hazard continuity and Consumer cancellation. These checks were already green before the candidate; they cannot demonstrate an improvement. They also do not amount to exhaustive seven-dimension answer grading.

Remaining general mechanisms include sentence-level constraints stealing the principal answer target, incidental nouns determining domain, negated evidence facets still determining operation, overly broad cancellation/negation, weak public-opportunity admission and incomplete discourse attachment. Do not convert the now-exposed authored examples into another phrase dictionary.

## Candidate preflight failure and durable audit

The candidate's IQ-11C preflight failed `save-failure-independent-of-successful-trace`: bounded reconciliation returned `lookup_unavailable` rather than the expected `missing_expected_save`. The wrapper stopped before all 32 development journey turns. This batch is **not integrity-valid** and is not assigned a conversational success score.

All 29 prerequisite/failure-injection attempts were journaled. Later read-only exact-ID local inspection found zero messages and one trace for the injected failed-save request. The trace was not missing merely because its earlier lookup was unavailable. The specific underlying lookup transport/deadline cause remains unproven. No request was replayed or backfilled to repair that evidence. The audit artifact preserves all attempted IDs and counts.

The final restored-runtime run uses separate request IDs. It is a repeated development/regression run, not a second independent certification attempt. Its preflight, journal, receipts and exact-ID reconciliation are preserved separately in the machine report. Injected missing/uncertain writes must still make the combined fault batch non-ready; that is expected and is not counted as successful durable delivery.

## Regression and frozen preservation

The rejected candidate passed typecheck/build, IQ-10A–E targeted tests and Wave 11, but introduced three suite regressions:

- IQ-9A6 R1 planner admission: established assessment continuation incorrectly ceded to a factual lookup.
- IQ-2 objective smoke: a room clarification/return produced the raw room list rather than retaining the corrected room.
- IQ-5 reference tests: topic switching dropped rather than parked context.

These are not waived as harmless. The candidate changed 13 frozen-corpus answers: 11 content changes and two fixture wallet timestamps. All 40 original PASS answers remained byte-identical; existing FAIL/BLOCKED status does **not** excuse a new quality regression. A capability catalogue reappeared and room continuity degraded, independently supporting rollback.

The final runtime has no source diff from the verified starting SHA. The complete regression chain is rerun on that restored runtime. Exact counts, known workflow failures, IQ-7 held-out metrics, 280 answer comparisons, saved pairs and durable correlation are in `artifacts/intelligence-quality-v1-iq11d-evaluation.json` and its hash-indexed evidence bundles. No frozen expectations or historical artifacts are changed; the original 40 PASS / 235 FAIL / 5 BLOCKED score is not rescored.

Historical workflow exclusions remain reload, multi-gang, correction and durable continuation, plus the owned-workflow aggregate exposing two failing cases. Multi-gang is not released or certified by this work.

Final restored-runtime results:

| Validation | Result |
|---|---:|
| IQ-11B structural / additional live | 22/22; 25/25 |
| IQ-11C failure-injection checks and preflight | 32/32; ready |
| New IQ-11D live assertions | 32/32, eight per worker |
| New live persistence / exact trace correlation | 32/32; 32/32 |
| IQ-10A safety live | 33/33 |
| IQ-10B reliability live | 25/25 |
| IQ-10C structural / live | 57/57; 62/62 |
| IQ-10D structural / additional / live | 33/33; 34/34; 32/32 |
| IQ-10E structural / additional / live | 22/22; 14/14; 29/29 |
| Broad regression suites | 53/58; five unchanged historical workflow suite failures |
| IQ-7 held-out E2E | 45/45 |
| Wave 11 structured | 132/132 |
| Frozen 280 saved / paired messages / correlated traces | 280 / 560 / 280 |
| Original frozen-PASS answers changed | 0/40 |
| Typecheck / build / diff check | PASS |

The IQ-7 parser remains imperfect at its historical levels: objective 219/226, subject 76/79, fact 65/66, follow-up 70/72, action 89/89 and safety 19/19. These are not new IQ-11D successes.

The restored 280 differs from the starting control only in two synthetic wallet as-of timestamps; amounts, currency, scope and content are unchanged. All 976 pre-existing tracked docs/artifacts/scripts were byte-verified unchanged. Final runtime and build manifest exactly matches the sealed baseline manifest: `5bd944c36a99e89d5859e4cffc725efa246100a1d089dfcdd9483516ed495ce7`.

The combined 61-attempt restored fault/development batch has 58 durable pairs and 53 verified traces. It is deliberately **not ready** because injected failures remain missing/uncertain. The separate healthy 32-turn development subset is ready, with all 32 pairs/traces verified. Neither denominator is silently substituted for the other.

## Safety, performance and delivery boundary

No new P0 was observed in the executed synthetic safety controls. This is not new independent safety certification. Structural mismatches have not been assigned invented conversational P1/P2 totals; the demonstrated subject/continuity defects are quality regressions and block promotion. No physical device or customer communication was executed. No provider was configured or called; provider cost is zero.

Local 280-turn latency summaries for starting/candidate/restored runtime are machine-recorded. Host, cache and fixture variation prevents a production latency claim. The final runtime is unchanged, so no new runtime overhead is shipped.

Local mean/p50/p95 milliseconds: starting 107/98/178; rejected candidate 98/86/180; restored 90/88/129. No provider tokens or inference charges.

The Supabase skill was used to constrain database work to the verified loopback synthetic fixture and read-only incident audit. No production credentials/schema were used. Exported evidence is scanned after decompression; deliberately key-shaped synthetic privacy-test sentinels are redacted only in exported copies, with original hashes retained.

## Recommended next approval

Do not advance as though IQ-11D passed. Review the separate `INTELLIGENCE_QUALITY_V1_IQ11D_INTERPRETATION_QUALIFICATION_PROPOSAL.md`.

Deterministic contracts remain essential for authority, hazard handling, cancellation, confirmation, evidence truth and output validation. This experiment did not establish that further precedence changes will achieve unfamiliar-language robustness. A **shadow-only bounded model-assisted interpretation qualification** is reasonable to evaluate, not assumed superior. It requires explicit provider/model, privacy, budget and failure-policy approval before any live calls. Use the existing SemanticFrameParser/AnswerTarget boundary, no retrieval/tool authority, a fresh validated multi-turn corpus, independent grading and IQ-11C reconciliation. No such model path is implemented here.

**IQ-11D NOT YET CERTIFIED**

## Files delivered

New documentation: this report, `INTELLIGENCE_QUALITY_V1_IQ11D_CONTRACT.md`, and `INTELLIGENCE_QUALITY_V1_IQ11D_INTERPRETATION_QUALIFICATION_PROPOSAL.md`.

New scripts: `iq11d-contracts.mjs`, `iq11d-independent.mjs`, `iq11d-live.mjs`, `iq11d-freeze.mjs`, `iq11d-incident-audit.mjs`, `iq11d-restoration-check.mjs`, and `iq11d-report.mjs`.

New artifacts: independent authored cases, evaluation JSON, rejected-candidate patch, and six compressed evidence bundles (baseline280, candidate280, restored280, candidate-regressions, restored-regressions and development). The evaluation JSON inventories original/exported file hashes and synthetic-sentinel redactions. Each bundle is approximately 0.85–1.03 MB. No existing runtime file is changed.
