# IQ-3A evidence contract hardening — implementation checkpoint

Starting HEAD: `7526f09a77aa38c34b8fa5d025474e0fdda39803`.
Branch: `codex/intelligence-quality-v1`. No production, schema, merge or deployment operation.

## Status

**Not certified.** This checkpoint delivers the collection-result primitive and
a verified room-inventory false-zero correction. It does not claim that every
collector has been audited or converted. No multi-domain planner is present.

## Contract

`contracts/evidence.ts` extends the existing evidence contract with
`EvidenceReadOutcome`. Individual records remain `OyiEvidence`, with their
existing truth, privacy, confidence, scope and freshness semantics.

`evidence/EvidenceReadOutcome.ts` normalizes explicit adapter proofs:

- available complete / partial / zero;
- unavailable / authority denied;
- unsupported / insufficient scope;
- stale / error / timeout.

Zero requires allowed authority, enforced matching scope, an executed available
query, a named population, proven completeness, no truncation/failure sentinel,
zero records and current source freshness. Empty unknown/historical/stale results
cannot prove current zero. Completeness refers to the named query population,
not every record or issue in a domain.

Denied and unsupported results suppress records, totals and effective scope.
Contradictory record scope fails closed. This is defense in depth, not a new
permission engine: adapters must still invoke canonical capability authority
and validate source-level scope before collection. Missing record membership
fields are not independently proven by this normalizer.

Returned records are capped at 50; an exceeded cap or a larger source total makes
the result partial. This does not claim upstream database queries are bounded.
Freshness and lifecycle are supplied by source semantics, not guessed from
generic timestamps or invented scores. A lifecycle classification does not rank
importance. Raw records stay in the runtime result; no trace/persistence integration
has been added.

`withinEvidenceDeadline` bounds acceptance of one asynchronous read and provides
an AbortSignal. Cancellation is cooperative. A source ignoring it can continue,
but its late result is not delivered to the completed caller. No assessment state
is written by this helper. It does not claim to prevent arbitrary side effects
inside an unsafe collector; such collectors must not be admitted.

## Concrete source findings

| Source | Actual boundary / bound | Empty-result finding | Readiness |
|---|---|---|---|
| CRM lead collector | Supplied Office snapshot `leads.needing_attention`; `total_open` is a different population | Missing section returns `[]`; subset cannot prove completeness over all open leads | Adapter proof pending |
| CRM opportunity collector | Supplied `opportunities.stale`; separate `total_open` | Missing section returns `[]`; stale subset is not entire pipeline | Adapter proof pending |
| Maintenance | Verified-context estate/home preferred; Facility estate filter, Consumer home filter; limit 50 | Missing scope returns `[]`; errors have unavailable sentinel; no count/truncation proof | Building/room scope unsupported until enforced; adapter pending |
| Security incidents | Estate filter plus Consumer home filter; limit 50 | Missing scope returns `[]`; errors have unavailable sentinel | Building/room scope and completeness proof pending |
| Visitor access | Facility estate / Consumer home filter; limit 50 | Missing scope returns `[]`; temporal/lifecycle population needs explicit declaration | Full collector audit pending |
| Device inventory | Home query limit 100; room filtering happens after the home limit; canonical current-state hydration | Missing home and caught query errors return `[]`; empty room subset can be incomplete | False-zero integration and completeness proof pending |
| Facility cameras | Estate query limit 100, camera access policy, canonical camera state resolution | Failure sentinel exists; unknown state does not prove offline; building filter not present in collection query | Full policy/dependency audit pending |
| Room inventory | Home filter limit 100; verified context now wins over request scope | Missing home / query error now explicitly unavailable | False-zero fixed; outcome adapter/truncation proof pending |
| Public opportunity | Existing thread objective collector; response handler can invoke callback workflow | Objective absence is not corporate-source absence; collector-only authority review remains necessary | Full ownership audit pending |
| Home/room aggregates | Existing contributors, pending aggregate map, bounded 30-fact projection | Unresolved room returns `[]` with separate state; fact projection is not coverage proof | Full contributor audit pending |
| Utilities | Existing estate/home loaders; accounts/assignments 200, purchases 50, tariff estate scope | Scope absence can return `[]`; source-specific current/historical semantics required | Full service audit pending |

This is an explicit partial inventory. The prior candidate artifact identifies
29 currently allowed capability keys; aliases share collectors. Permission and
surface metadata alone do not certify any row above. Wallet and denied/missing
candidate sources must also be included before the requested cross-home audit
can be called complete.

## Changes affecting ordinary responses

1. `rooms.inventory.read`: query failure previously returned `[]` and could say
   no registered rooms. It now returns an unavailable sentinel and an honest
   unavailable response. Missing scope also no longer means zero.
2. Room/home helper scope now prefers server-verified context over request IDs,
   consistent with maintenance/security loaders.
3. `evidenceFromFact`: `confidence || 0.75` promoted a supplied zero to 0.75.
   Zero is now preserved; absent/non-finite values do not gain confidence.

No other ordinary answer wording was intentionally changed. No ranking,
assessment fan-out, provider call or external action was added.

## Outstanding certification work

- Complete actual-service audit for all candidate collectors and denied sources.
- Attach explicit result proofs at canonical collection boundaries; until then
  the new type is a substrate, not a working planner interface.
- Enforce unsupported building/room scope before invoking broad collectors.
- Prove all Consumer cross-home and Osa/Office boundaries with source fixtures,
  not just normalizer tests.
- Source-specific freshness, pagination and completeness integration.
- Complete per-turn readiness reclassification of the 133 planning failures.

None of these is an invitation to begin IQ-3B. Frozen artifacts remain unchanged.

## Validation at this checkpoint

Commands executed:

```text
npm run build
npm run typecheck
node scripts/iq3a-evidence-outcome-smoke.mjs
node scripts/iq1-local-run.mjs script /tmp/iq3a-room-final scripts/iq3a-room-truth-smoke.mjs
node scripts/iq1-local-run.mjs iq /tmp/iq3a-final-iq
node scripts/iq1-local-run.mjs wave11 /tmp/iq3a-final-wave11
node scripts/iq1-local-run.mjs adversarial /tmp/iq3a-final-safety
node scripts/iq1-local-run.mjs script /tmp/iq3a-final-objective scripts/iq2-objective-smoke.mjs
node scripts/iq1-regression-run.mjs /tmp/iq3a-final-regressions
node scripts/iq3a-checkpoint-review.mjs
git diff --check
```

- Build/typecheck: PASS on final source (an intermediate nullable-confidence
  type error was corrected before the final build).
- Outcome tests: 28 PASS; deadline cases: 4 PASS.
- Room fault/scope injection: 4 PASS, including successful empty vs failed query,
  missing scope, and request-home B not overriding verified home A.
- Full IQ: 280 executed, all answers equal to the prior accepted run; frozen
  envelopes unchanged. Retained classifications: **51 PASS / 224 FAIL / 5 BLOCKED**.
  Persistence and trace correlation: 280/280. No new seven-dimension regrade.
- IQ-2 focused and IQ-1 adversarial runners: PASS.
- Wave 11: **131 PASS / 1 FAIL**, the known utilities case remains a failure.
- Existing 23-suite regression matrix: **19 PASS / 4 FAIL**. All four assertion
  failures match the stored pre-IQ1 controls: reload, multigang, correction and
  durable continuation. They are not relabelled PASS.
- Diff check and targeted changed-file secret-pattern checks: PASS.

Machine-readable evidence and raw-run hashes:
`artifacts/intelligence-quality-v1-iq3a-checkpoint.json`.

All 133 evidence-planning rows remain **SOURCE_CONTRACT_BLOCKED for planner
readiness** at this incomplete checkpoint: the primitive is not a fully connected,
audited collection boundary yet. This deliberately does not claim that all 133
share the same cognitive cause or lack source data. Per-source causal subdivision
remains part of the outstanding audit. IQ-3B must not begin on this result.

**IQ-3A NOT YET CERTIFIED**
