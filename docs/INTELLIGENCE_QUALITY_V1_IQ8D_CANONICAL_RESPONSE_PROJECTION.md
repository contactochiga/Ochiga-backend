# IQ-8D — Canonical Response Projection

Pipeline: user language → semantic frame → **one carried AnswerTarget** → capability resolution → governed execution → **structured ResultEnvelope** → **one projector** → final response.

Capability owns truth. The AnswerTarget owns what was asked. The projector owns shaping truth to the ask. The projector is not a reasoning engine: it never ranks, judges, queries, widens authority, writes data or parses prose.

## Carried target
`SemanticFrameParser.parseSemanticFrame` derives the AnswerTarget once and carries it as `frame.answerTarget`. Consumers (adapter, judge, public module, orchestrator early-direct block) read it. Any later change goes through `refineAnswerTarget(target, reason, patch)`, which records the reason in `refinements`. `deriveAnswerTarget(` may appear only in `answerTarget.ts` and the parser (guard in `scripts/iq8d-projector-tests.mjs`). The target is ephemeral, non-authoritative, non-durable. New typed fields: object, facet, state_concept, negated_qualifiers, ask_facet, fact_keys, past_reference, refinements.

## Envelope (`response/resultEnvelope.ts`, `envelopeMappers.ts`)
availability, capability_status (enabled/declared), truth_state, subject (domain/object/noun/population/facets), records, count, total_count (+qualifier), truncated, value, state_facts, limitations (UNAVAILABLE, MISSING_CAPABILITY, UNSUPPORTED_SCOPE, INSUFFICIENT_SCOPE, PARTIAL, PROVIDER_REQUIRED, AUTHORITY_DENIED, AMBIGUOUS, STALE, UNOBSERVED), held_facts, actions, hints, legacy_prose. Nothing is mandatory or fabricated; it is separate from the IQ-3 evidence bundle. `responseContract(envelope)` returns CAPABILITY_SUCCESS / HONEST_LIMITATION / AUTHORITY_DENIED from structure, never from wording, and is exposed as `metadata.response_contract`. `utilities.usage.read` stays a declared/unavailable capability: HONEST_LIMITATION, not a success.

## Response ownership (one owner per class)
| Class | Owner |
|---|---|
| list / count / status / detail / yes-no-on-records / value / history-limit / limitation-by-kind / held-fact recall | projector |
| judgment & ranking presentation | judgment composer (consumes the carried target) |
| action truth, confirmation, constraint acknowledgement, hazard report | orchestrator early-direct (specialised; the projector returns null for these intents) |
| reassessment | reassessment integration |
| safety / authority refusals, public handoff governance | unchanged specialised paths |
| capability discovery | capability discovery |

Old module prose is kept as "Supporting detail" and as the fallback whenever the projector returns null.

## Removed
`targetedRetrieval.ts`, `targetedPublic.ts`, five `deriveAnswerTarget` calls in the adapter, one in the judge, one in the public module, one in the orchestrator, and the adapter's special-case regexes (camera, visitor arrival, consumption, ranking limitation) — now envelope facts (`state_facts.unobserved`, `permission_only`, `facets`, `requires_judgment`).

## Not done (IQ-8E)
The 21 routing failures. IQ-8 is not certified by this slice.

## IQ-8D2 addendum — answer target + result contract completion
Frozen contract: `artifacts/intelligence-quality-v1-iq8d2-contract-matrix.json` (committed before implementation). Tests: `scripts/iq8d2-contract-tests.mjs` (one test per class, matrix-coverage check, target-application guarantee, specialised exemptions).
- Target: `quantity` now `count|list|sum|value`; `flow` (out/in); `ask_facet=submission`; `yes_no.kind=fact|submission`; `constraint_kind` (disclosure/channel/commitment/other); `clarify_reason`. No product- or benchmark-specific fields.
- Envelope: `measures[]` (capability-computed named amounts, independent of `records`), `records[].age_days`, `actions.submission`. Wallet transactions expose money in/out; financial summary exposes portfolio totals even when `estates` is empty; opportunities expose activity age.
- Projector: aggregate values, current value, fact recall/confirmation, submission state (unknown never claims submitted), constraint acknowledgement (this conversation only), clarification, targeted limitation when truth is missing, `projectionRequired` guarantee recorded as `projection_contract_violation` metadata.
- Regression found and fixed: IQ-8 had broken multi-gang device commands (domain override); a cancellation ("don't send it") was briefly read as a disclosure constraint; both are covered by guards.
Not done: routing closure (IQ-8E). IQ-8 is not certified.

## IQ-8D3 closure
Phase A (frozen before any runtime change): `artifacts/intelligence-quality-v1-iq8d3-adjudication.json` — 14 downgrades = 1 genuine regression (OSA-004:4, lost approach/difference branch in the IQ-8D port), 11 interpretation differences, 2 inadequate-evidence (not comparable); 5 DOES_NOT_MEET by upstream owner; 25 changed PASS answers = 24 preserved, 1 degraded (CON-009:1).
Phase B (shared contract fixes by semantic family, each covered by multi-phrasing tests in `scripts/iq8d2-contract-tests.mjs`): existence / state-ellipsis / "between X and Y" / which-object lists / "what's the concern" / unobservable measurement targets; refusals win in multi-sentence turns; judgment explanation from the record's own recorded signals and the limitation chosen by the ask; unavailable-source empty reads; difference-vs-trade-off held comparisons; fact updates are not held-fact questions; outcome predictions and choice questions are polarity-free; past-tense action questions are never commands; role phrases in capability inquiries; intrusion reports are unverified safety reports.
Regressions found by diffing and fixed: IQ-8 multi-gang device routing; cancellation read as a disclosure constraint (IQ-8D); judgment-required ranking without records.
IQ-8 is NOT certified. Routing/evidence-planning debt is reserved for IQ-8E.
