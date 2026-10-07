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
