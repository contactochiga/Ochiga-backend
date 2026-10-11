# IQ-10E — governed judgment and communication

## Scope and provenance

Worktree `/Users/ochigaidoko/Documents/oyi-intelligence-quality`; branch
`codex/intelligence-quality-v1`; origin `contactochiga/Ochiga-backend`.
Clean starting HEAD and live remote HEAD were both
`6ed093ed914121275c3c89a80c2a20d3a1128622`. Initial SSH DNS failed;
HTTPS verification subsequently succeeded. No other repository was modified.

Contract commit: `0649afc8cecb3266a8f90c7075e36796ca9b98c2`.
The frozen contract, synthetic scenarios and first 22 executable assertions
were committed before runtime changes. The unchanged build passed 10 and
failed 12. Contract hashes, final source hashes and validation records are in
`artifacts/intelligence-quality-v1-iq10e-certification.json`. The implementation
commit containing this report is the final delivery HEAD (reported with the
remote verification in the delivery response).

Only the `/tmp/iq10e-release-*` unchanged-source run supports this report.
Earlier runs are diagnostics, including rejected context changes; they are not
combined to manufacture a passing run. Review notes preserve those discoveries.

## Implementation and quality boundaries

| Area | Change / retained contract |
| --- | --- |
| Judgment admission | Existing planner admission retains retrieval, action, denial and public-objective ownership. Open verification questions use existing NEXT_STEP, not execution. |
| Grounded judgment | IQ-4 typed factors, declared ordering, validator and evidence index remain the owners. No materiality formula or new judgment engine. |
| Provider off | No live provider configured or called. Business comparison presents named recorded facts and unavailable comparative-judgment limitation, never strategic ranking. |
| Explanation | No first-active-record guess. Ambiguous raw references clarify; absent rankings are explicitly absent. Compact authorised-record support remains available without the full boilerplate. |
| Comparison | Distinctive token matches identify each named side. Multiple equal matches clarify rather than selecting array entry zero. IQ-10D unlike-currency limits remain. |
| Reassessment | IQ-6 remains unchanged. Caller facts stay unverified; title updates bind to the selected public entity rather than inventing a third entity. |
| Direct answers | Counts disclose partiality; unknown status is Unknown. Unknown filter values cannot prove zero; resolved counts retain the filter. Focused answers omit unrelated rationale, but not material limitations. |
| Next steps | Explicit requests may identify current observations, missing coverage, separate authorised arrival evidence, or public-safe qualification facts. No action, new retrieval authority, contact or work is initiated. |
| Context | A suspended assessment yields only to a newer authorised retrieval matching the explicit question's domain. Lexical overlap alone does not change scope. Existing authority/TTL checks still apply. |
| Derived presentation | A focused answer does not mint a new unseen ranking. Existing derived-reference owner retains scope, expiry and selected-reference guarantees. |

The only added presentation flag is optional `TargetedLead.focused`; it chooses
supporting-detail presentation and prevents an unshown derived artifact. It
does not add memory, a capability, authority, a workflow or another composer.

## Four-worker development review

| Worker | Turns | Observed result |
| --- | ---: | --- |
| Oma | 5 | Status evidence retained; investment ordering remains honestly provider-off; explanation and missing-judgment requirement are explicit. |
| Osa | 6 | Two properties retain identity, location, size and structure. Unverified title attaches only to the second. Next-step qualification does not restart or promise contact. |
| Facility | 5 | Recorded maintenance/operational evidence remains bounded. Verification response identifies missing coverage, camera observations and permission-versus-arrival evidence. |
| Consumer | 5 | Availability does not prove power. Explicit verification advice initiates nothing. Visitor-arrival follow-up uses visitors, not the older device assessment. |

Development: **22/22 frozen assertions**, **14/14 additional controls**,
**21 canonical live turns**, **29/29 live transport/truth assertions**, plus
**6/6 separate answer/context review checks**. All 21 turns were saved and
durably trace-correlated. Physical execution: **0**. New observed P0: **0**.

The paraphrases are maintainer-authored, frozen before implementation where
included in the initial contract. Additional grammar controls test open
verification questions without a new parser. This is not independent blinded
authorship or an independent intelligence-certification score. No sealed
IQ-9B utterances or grading expectations were used for tuning.

## Preservation and regression

The frozen 280 is a preservation run, not a regraded claim of 280 PASS. Every
turn was persisted and durably correlated (560 paired messages). All **40
original frozen-PASS answers are byte-identical** to the archived starting
build. Every changed answer is individually listed and reviewed in the JSON;
fixture wallet timestamps are separated from behavioral changes. No baseline,
historical artifact, corpus or old test expectation was modified.

Exact comparison: **268 identical answers**, **10 reviewed behavioral changes**,
and **2 fixture-as-of timestamp changes**. None is an automatic pass promotion.

| Gate | Result |
| --- | --- |
| IQ-10A | 49 invariant checks and 33 live safety checks pass. |
| IQ-10B | 25 reliability checks, trace contract/privacy and export tests pass. |
| IQ-10C | 57 pure context checks and 62 live checks pass. |
| IQ-10D | 33 evidence contracts, 34 additional controls and 32 live checks pass. |
| IQ-1–6, IQ-7, IQ-8, IQ-9A, authority/privacy, device truth, One-Core | Applicable existing regression chain preserved. IQ-7 held-out summary is unchanged, not relabelled as perfect. |
| Broad chain | 58 suite outcomes: 53 PASS, 5 unchanged historical FAIL. |
| Wave 11 | 132 PASS, 0 FAIL, 0 BLOCKED. |
| Typecheck / build | PASS on the final source. |
| Diff / changed-diff secret scan | PASS; pattern-based hygiene, not a whole-repository security certification. |

Historical failures remain: phase-C reload, multigang, correction, durable
continuation, plus their aggregate owned-thread control. The owned-thread
diagnostic still passes multigang and durable continuation but fails reload and
correction. **Multi-gang control remains excluded from release claims.** No
assertion was weakened to hide those failures.

## Performance and limits

Exact local provider-off mean/p50/p95 before and after are recorded in the JSON.
Starting build: **107/94/194 ms**; candidate: **86/87/113 ms** (280 turns each).
The change adds no provider call, database count query or evidence fan-out.
Projection works over existing bounded evidence. Host/cache load and fixture
timestamps vary; local timings are not a production SLO or proof of speedup.

Remaining debt:

* Overall intelligence is **not certified**. Strategic judgment requires a
  separately qualified provider; missing physical observations remain unknown.
* Some multi-source responses remain verbose; this was not a general prose
  rewrite. Unsupported scope/capability cases remain limitations, not successful
  execution. Existing upstream qualification gaps are not promoted to passes.
* Independent paraphrase authorship and fresh independent certification remain
  separate gates. No autonomous Initiative was introduced.
* Historical workflows and IQ-10B crash-before-flush/whole-HTTP exactly-once
  limitations remain documented release constraints.

## Exact runtime files

* `src/oyi-core/context/publicOpportunityObjective.ts`
* `src/oyi-core/evidence/judgment/compose.ts`
* `src/oyi-core/evidence/judgment/judge.ts`
* `src/oyi-core/interpretation/conceptBridge.ts`
* `src/oyi-core/orchestration/ConversationOrchestrator.ts`
* `src/oyi-core/response/answerTarget.ts`
* `src/oyi-core/response/targetedJudgment.ts`

New test/diagnostic files: `scripts/iq10e-contracts.mjs`,
`iq10e-additional.mjs`, `iq10e-live.mjs`, `iq10e-live-review.mjs`,
`iq10e-control280.mjs`, `iq10e-validation.mjs`, `iq10e-report.mjs`, and
`iq10e-source-audit.mjs`. New artifacts are the IQ-10E development contract and
certification JSON; new documents are this report, the frozen contract and
review notes. Git provides the exact complete manifest.

No merge, deployment, production change, schema migration, IQ-10F work or
autonomous Initiative. IQ-10F may begin only after separate approval.

**IQ-10E JUDGMENT & COMMUNICATION CERTIFIED — IQ-10F APPROVAL REQUIRED**
