# IQ-11B — Effective authority and hazard continuity closure

## Decision and verified boundary

**IQ-11B SAFETY & EFFECTIVE AUTHORITY CERTIFIED — TRACE REMEDIATION APPROVAL REQUIRED.** This is a targeted safety-contract result, not overall intelligence, production, workflow or independent generalization certification.

Starting local HEAD and live `origin/codex/intelligence-quality-v1` both resolved to `a06004b53c875228fefc9a2424cf5a6ffe5d6439`. The worktree was clean, on `codex/intelligence-quality-v1`, at `/Users/ochigaidoko/Documents/oyi-intelligence-quality`; origin is `git@github.com:contactochiga/Ochiga-backend.git`. The remote was checked again before delivery and was still at that starting commit. The final delivery SHA is the commit containing this report, verified after push; it is not self-embedded in its own contents.

No other repository was changed. No production migration, provider configuration, physical-device execution, merge, deployment, IQ-11C or Initiative work occurred. Sealed IQ-10F/IQ-9B corpora were neither replayed nor edited. All 952 pre-existing tracked files under docs/artifacts/scripts were byte-verified against the starting HEAD.

## Frozen contract and development provenance

Before runtime edits, commit `29501c29a177779cd0469d9f72501568081e41ee` froze the authority/safety contract and 22 synthetic control families. Commit `f49616896eb2a54445f6aeb8a35cc77aa01cf63f` froze the executable live controls. Commit `0fda78debbd40780f84c80eb1cf5ce6402ff5328` corrected a setup-only baseline defect: capability registration is lazy, so `canUse` must be checked after initial registration. This correction preceded runtime changes and did not change the expected authority policy. The corrected pre-change baseline was 13 PASS / 9 FAIL across 22 checks and 48 calls.

These new scenarios and paraphrases are maintainer-authored development controls, not independently blinded authorship. The full frozen-PASS preservation comparison was reviewed separately from new-test verdicts by the same maintainer. No independent-grader claim is made. New subjects and wording test general boundaries; sealed utterances were not turned into phrase rules.

Acceptance remained: all new safety and positive controls pass, zero observed P0, zero executor attempts, no defensible original frozen-PASS regression. Unsupported explicit revocation is documented as N/A, never counted as implemented success.

## Effective authority: fixture discrepancy versus runtime defect

The canonical `core/foundation/permissions` calculation unions role-derived permissions, `permissions` and `permission_scopes`. CapabilityService retains its existing aliases and resource/surface eligibility. **Empty explicit arrays do not revoke role grants.** There is no supported explicit negative-permission policy in this path.

Consequently, the IQ-10F restricted Resident fixture did not create the effective denial its specification assumed. IQ-11B does not change sealed grades or invent a revocation policy. New controls establish actual denial with the same synthetic identity as Guest, assert canonical `canUse` denial, and test both fresh reads and cached-assessment continuation. A Guest with an explicit `wallets.read` grant remains a positive control. A Resident with empty arrays retains legitimate reads. Role/permission functions were not modified.

Authentication must supply the current role/grants on each turn; context is not authority. This slice does not implement external credential/session revocation propagation.

## Implementation and canonical ownership

| Boundary | Correction | Existing owner |
|---|---|---|
| Requested subject versus lexical domain | Consumer non-own subjects cannot substitute own-home evidence even when the legacy domain is reports/global. Domain concepts also inform household evidence detection. | `response/scopeProvenance.ts` |
| Estate-authorized home selection | Uniquely resolve an in-estate home from server-verified operating context, narrow the query, preserve actual source scope. Unknown, duplicate or foreign-estate references remain limited. | `scopeProvenance`, `ConversationOrchestrator`, maintenance evidence collector |
| Retrieved versus presented scope | Reject estate-only or foreign-home evidence when a home-specific Facility answer was requested. No label-derived authority or arbitrary home choice. | Existing response provenance check |
| Private-read restriction | Honor the existing conversation disclosure constraint before cached/private retrieval; response adapter is a second publication guard. Lifting the restriction does not grant permission. | `disclosureConstraint`, orchestrator, response adapter |
| Restriction versus cancellation | A prohibition on reading private records is not withdrawal of a pending device command. Explicit cancel and device negation retain precedence. | Existing `semanticObjective` cancellation recognizer |
| Read-only hazard judgment | Pass server-derived hazard/history availability into the existing judge before reuse, ranking or targeted response projection. Bound conclusions; retain records as administrative facts, not proof of safety. | IQ-4 `judgeAssessment` |
| Follow-up/draft/recap continuity | Preserve the unresolved, unverified hazard and precautions on capability and terminal response paths before canonical persistence. Keep all action-truth fields intact. | Existing response adapter and persistence entry points |

No second authority engine, safety store, parser, orchestrator, provider or capability registry was introduced. Existing owned-thread safety history is reused. No additional database query was introduced; the maintenance change adds a `home_id` filter to the existing estate query.

### Hazard semantics and limits

A newly reported hazard cannot be negated by an old resolved ticket. Status, assessment, comparison, explanation, draft, recap and follow-up controls all retain the report as material but unverified. Unavailable safety history cannot produce a safety ranking. Caller metadata cannot erase server-derived history. A caller saying a plumber repaired an issue is still unverified; no physical-resolution claim is minted.

The guard is deliberately conservative and conversation-scoped. It does not invent a matching device/request when identity is uncertain, nor implement a new verified-resolution workflow. Unrelated assessments may remain bounded after a hazard; old reports are not automatically cleared by administrative closure or caller assertions. Deterministic hazard recognition and existing bounded-history limits remain generalization debt. This is not a universal language-safety guarantee.

## New controls and safety results

| Suite | Result |
|---|---:|
| Frozen live controls before runtime edits | 13/22; 48 calls |
| Same original live controls after | 22/22; 48 calls |
| Additional privacy/cancellation, permission-lift and cached-scope controls | 3/3; 7 additional calls |
| Final combined live run | **25/25; 55 calls** |
| Structural authority, routing-independent scope, judgment and response tests | **22/22** |
| Final new live persistence / durable trace correlation | **55/55 / 55/55** |
| Physical executor attempts | **0** |
| New observed P0 in targeted checks | **0** |

Positive controls include role-derived own-wallet access, explicit grant, own-home maintenance, uniquely verified Facility home maintenance, ordinary non-hazard records, unrelated visitor facts after a hazard, protective-off proposals still requiring confirmation, and fresh actions after terminal cancellation. Negative controls include genuine denial, changed role after cached assessment, cross-household scope after cached records, unknown/ambiguous/foreign home references, hazardous power-on requests and repeated approval after cancellation.

Review found one additional test assertion error: the workflow state is `awaiting_approval`, while the action state is `awaiting_confirmation`. The failed attempt is retained in evidence; the corrected test checks both durable records. It proves a private-read restriction leaves the existing action pending (not executed), then explicit cancellation makes it terminal. No runtime correction was needed for that enum mismatch.

## Regression and frozen preservation

| Gate | Result |
|---|---:|
| IQ-10A safety | 33/33 |
| IQ-10B live reliability | 25/25; trace-contract/export checks also pass |
| IQ-10C context | 57/57 structural; 62/62 live |
| IQ-10D evidence | 33/33 contract; 34/34 additional; 32/32 live |
| IQ-10E judgment | 22/22 contract; 14/14 additional; 29/29 live assertions |
| IQ-7 held-out E2E | 45/45; parser metrics unchanged |
| IQ-9A, IQ-8, IQ-7, IQ-1–6, authority/privacy, device/action truth, One-Core and workflow chain | 53/58 suites; five unchanged historical failures |
| Wave 11 structured corpus | **132/132 PASS** |
| Frozen 280 execution | **280/280 persisted and durably correlated; 560 paired messages** |
| Original 40 frozen-PASS answers | **40/40 byte-identical** |
| Typecheck / build | PASS / PASS |

The IQ-7 parser scores are unchanged: objective 219/226, subject 76/79, fact 65/66, follow-up 70/72, action 89/89, safety 19/19, not-capability 5/5, not-assessment 4/4. They are not represented as perfect.

Of 280 answers, 268 are byte-identical to the pre-change runtime control. Twelve changed: ten in FAC-007/CON-007 preserve hazard uncertainty and prevent administrative lifecycle from dismissing it; two wallet answers differ only in fixture as-of timestamps. All changed answers were reviewed, and the machine-readable artifact includes exact before/after text. Existing ambiguity, verbosity and broad cognitive shortcomings remain failures/debt, not automatic PASS promotions. The frozen baseline stays 40 PASS / 235 FAIL / 5 BLOCKED; this is a preservation run, not a fresh cognitive regrade.

Historical failures remain visible: workflow phase-C reload, multi-gang, correction, durable continuation, and the aggregate owned-workflow control. The owned variant still passes multi-gang and durable continuation but fails reload and correction, exactly as before. That does not certify the original cases. Multi-gang control remains excluded from release claims.

## Performance, evidence integrity and security

Local sequential provider-off measurements:

| Same-case population | Before mean / p50 / p95 | After mean / p50 / p95 |
|---|---|---|
| Original 48 new-development calls | 73 / 66 / 120 ms | 83 / 70 / 154 ms |
| Frozen 280 | 91 / 85 / 139 ms | 89 / 86 / 130 ms |

No provider calls or new queries were added. These samples include fixture/host/cache variation and are not a production SLO or a causal speedup claim. The new controls show a small absolute latency increase; long hazard responses are communication debt.

The isolated runner verifies loopback fixture port 55421, performs trace-schema preflight and traps physical execution. Final runtime source hashes were stable throughout the full regression chain. Raw synthetic results, logs, run failures and SHA-256 manifests are stored in three compressed evidence bundles, each below 2 MB.

The pre-commit scan found two appearances of the deliberately key-shaped `SENTINEL` from the existing trace-export test in stdout, not a real credential. The archived copy replaces those values with an explicit redaction marker while preserving original file hashes and redaction counts. Durable trace privacy tests passed. Existing raw diagnostic logging of synthetic prompt sentinels is not evidence that arbitrary runtime logs are privacy-certified; broader trace/log reliability remains a separate remediation gate. Pattern scanning is not a repository-wide security certification.

IQ-11A's exception-path ownership-rejection correlation and trace-write/final-reconciliation defects remain outside this slice. The 55 and 280 normal-path correlations do not claim to fix those mechanisms. Trace remediation can be proposed next, but requires approval.

## Exact changed files and delivery

Runtime (8):

- `src/oyi-core/capabilities/CapabilityResponseAdapter.ts`
- `src/oyi-core/domains/maintenance/maintenanceEvidence.ts`
- `src/oyi-core/evidence/judgment/judge.ts`
- `src/oyi-core/interpretation/semanticObjective.ts`
- `src/oyi-core/orchestration/ConversationOrchestrator.ts`
- `src/oyi-core/response/answerTarget.ts`
- `src/oyi-core/response/disclosureConstraint.ts`
- `src/oyi-core/response/scopeProvenance.ts`

New tests/verification (5): `scripts/iq11b-safety-live.mjs`, `scripts/iq11b-additional-live.mjs`, `scripts/iq11b-contracts.mjs`, `scripts/iq11b-report.mjs`, `scripts/iq11b-source-audit.mjs`.

Documentation/artifacts: this report; `docs/INTELLIGENCE_QUALITY_V1_IQ11B_CONTRACT.md`; `artifacts/intelligence-quality-v1-iq11b-development-contract.json`; `artifacts/intelligence-quality-v1-iq11b-certification.json`; three `intelligence-quality-v1-iq11b-{baseline,candidate,regressions}-evidence.json.gz` bundles. Existing artifacts, expectations and regression scripts remain unchanged.

Only the existing IQ branch is pushed. Final local/remote SHA equality and the clean worktree are verified after commit. No overall intelligence or production release approval follows from this result.

**IQ-11B SAFETY & EFFECTIVE AUTHORITY CERTIFIED — TRACE REMEDIATION APPROVAL REQUIRED**
