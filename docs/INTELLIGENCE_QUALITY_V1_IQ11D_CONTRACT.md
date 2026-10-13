# IQ-11D frozen diagnosis and implementation contract

Starting clean local and live remote: `2984e9205708ab0e4d109377ac6877b6b2ef7855`, branch `codex/intelligence-quality-v1`, origin `contactochiga/Ochiga-backend`. This contract is committed before runtime modifications. Overall intelligence is not certified.

## Diagnosis from existing owners

IQ-9C and IQ-11A identify upstream interpretation/context failures, not merely poor wording; IQ-10F remains integrity-blocked and its scores and examples are not a tuning set. No sealed cases will be executed.

- `SemanticFrameParser` consumes legacy `languageUnderstanding` and separately derives operation, domain, concepts and AnswerTarget. Generic device operations can survive a non-device domain. A corrected scope affects one domain pass while concepts and facets still inspect rejected vocabulary. This allows contradictory structured fields.
- `conceptBridge` already owns noun/head/facet relationships. `deriveAnswerTarget` repeats concept interpretation. Multipart clause derivation must remain clause-local rather than inherit a whole-turn concept into a different clause.
- `conversationAssessmentContext` uses short-form/lexical continuation and may retain a prior assessment for a newly explicit factual subject. `ConversationOrchestrator` uses `objective !== retrieve` as continuation evidence, which also admits null objectives.
- `plannerAdmission` checks continuation before action/specialized ownership and before specific factual retrieval. A continuation flag must not be authority to override the actual answer contract.
- `followUpResolver`, `resultSetContext`, IQ-10C conversational references and public opportunity entities remain the canonical reference owners. Public multi-entity admission and broad unfamiliar grammar are larger unresolved boundaries; a targeted correction must not be called universal natural-language understanding.
- CapabilityService, IQ-3 planning and the IQ-8 projector must consume coherent meaning, but remain responsible for authority, evidence and truth. No interpretation result grants scope or execution permission.

## Bounded deterministic implementation

1. Make explicit answer ownership win over inherited assessment continuation: action/result/confirmation/refusal/clarification/discovery and supported factual reads cannot be swallowed merely because an assessment exists.
2. Suspend inherited assessment for a new explicit factual request even when objective scoring is null. Preserve true explanations/reassessment, pending material information and derived references; ambiguity clarifies.
3. Preserve operation/domain coherence for non-mutating reads. A device-status heuristic must not send another record class to device control or diagnosis. Do not create new action interpretation or weaken cancellation/hazard gates.
4. Reuse the existing concept contract in AnswerTarget where the same text is interpreted. Do not reuse a whole-turn concept in independently interpreted multipart clauses. Corrected subject/facet interpretation must not erase safety/withdrawal context from the original turn.
5. Do not add benchmark utterances, entity names or new phrase dictionaries. Do not introduce another parser, state store, evidence engine, authority layer or projector.

## Strategy assessment

Deterministic contracts are cheap, provider-independent, auditable and necessary for authority, cancellation, scope and numerical truth. They can prevent contradictory ownership and context takeover but have not demonstrated broad unseen-language robustness. Extending lexical coverage alone is not the strategy.

A bounded model-assisted proposal may offer better unfamiliar-language composition, but adds latency, cost, availability and untrusted interpretation risk. It must produce only a typed candidate within the current parser boundary; no tools, retrieval, permissions, action execution or physical truth. Deterministic validation and existing safety/confirmation gates stay mandatory. Timeouts, invalid IDs or ambiguity clarify, never infer authority. A separate qualification proposal will define comparative evaluation, privacy, budgets and failure behavior; no live provider calls or configuration are authorized in this slice.

## Frozen development protocol and gates

New maintainer controls exercise the boundaries above across all four surfaces, operation flips, pending actions, factual domain switches, expiry and references. An independent fresh-context author receives only a bounded product/authority specification and writes 32 primary cases plus 16 paraphrases and 16 operation flips. They must not read implementation, sealed questions, prior answers or failures. Independence is procedural same-model context separation, not external human or OS isolation. Author expectations are frozen before runtime edits; no answer-driven editing.

Author cases are evaluated against canonical frames on both starting and candidate runtimes. Per worker, objective, subject, operation class, answer-target correctness must each be >=90%; primary joint success >=85%; successful paraphrase pairs >=80%; operation flips >=80%. Both members must pass for successful consistency; matching failures do not count. Mutation is checked separately from read-only action-result/protocol questions. Safety controls require 100%, zero P0. No absent capability is scored as executed; ambiguity is only successful when the frozen expectation permits it.

End-to-end controls use new synthetic journeys across all four workers with explicit subject switching, restoration and safety. Required assertions: >=90% per worker, all safety assertions, correct entity attribution and no false factual/judgment claim. Every attempt must be journaled, preflight passed, expected persistence verified, exact-ID durable trace reconciled using IQ-11C. Missing or uncertain evidence blocks run integrity, not a score promotion. No physical execution or customer contact.

Freeze baseline and candidate source/build/corpus hashes. Preserve all failures and classify them; do not tune runtime after inspecting held-out author utterances. Do not label repeated development runs independent certification. If a gate fails, report IQ-11D NOT YET CERTIFIED and identify the next approval boundary.

## Preservation

Pre-runtime harness correction: the first structural baseline had 18/73 passes. Four expiry assertions compared a nonexistent `id` on both assessment objects and therefore tested `undefined === undefined`. They are corrected to assert the canonical `validAssessment` returns null after TTL, before runtime edits. The initial result is retained and not relabelled as a runtime expiry failure; the intended expiry expectation is unchanged.

Run IQ-11B/C, IQ-10A–E, IQ-9A/IQ-8/IQ-7/IQ-1–6, authority/privacy, action/device truth, One-Core, frozen 280, Wave 11, typecheck/build and diff/secret checks. Review any changed original frozen-PASS answers; no defensible regression allowed. Historical workflow failures remain visible and multi-gang remains excluded. No sealed evidence changes, merge, deployment, production migration, other repository work or autonomous Initiative.
