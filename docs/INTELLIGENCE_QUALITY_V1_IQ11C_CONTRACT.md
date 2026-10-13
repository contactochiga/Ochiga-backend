# IQ-11C frozen reliability contract

Starting clean local/remote HEAD: `5858bfec66e49d4a30f03d7454b07a46fa2628d2`, `codex/intelligence-quality-v1`, origin `contactochiga/Ochiga-backend`. Frozen before runtime changes. No sealed IQ-10F/IQ-9B replay, production change, model-assisted interpretation or Initiative.

## Diagnosis and known limits

IQ-11A's preserved exact-ID evidence proves one Facility insert failed and remained absent. Its original cause is unknown: the captured code was `trace_write_failed`. It does not prove schema drift, network failure, timeout or retry exhaustion. Two correct cross-owner rejections had no captured trace IDs; storage absence was not established. The runner flushed writes but only read receipts from responses, not exceptions.

The existing asynchronous writer uses a UUID and bounded idempotent upsert; success is currently acknowledgement-only. The response wrapper attaches a receipt only to a returned response. The existing schema/persistence preflight remains canonical. No second trace table or store is needed.

## Invariants

1. Every invocation has a canonical request ID and a distinct trace-attempt UUID; retries of the same write retain that UUID. Protected certification captures retain request-to-trace mappings, including exceptions. Arbitrary private error payloads are never copied into receipts.
2. Ownership rejection stays rejected and writes no unauthorized conversation messages. Safe exception correlation must not alter the thrown error's identity, meaning or HTTP authorization behavior.
3. Legacy receipt status remains compatible; additional structured delivery state distinguishes pending, saved-and-verified, failed, timed-out and uncertain late delivery. Save success never implies trace success. Only exact-ID lookup matching the expected structural request reference may verify a trace.
4. Error classes are allowlisted: schema, permission, database rejection/unavailability, transport, timeout, verification mismatch and unknown. Unknown stays unknown; no raw database/provider message or caller-controlled code is logged as a cause.
5. Insert/verification are bounded, retries limited and idempotent. Late callbacks cannot silently rewrite a terminal receipt into saved. Reconciliation may separately establish late durability; it never replays a conversation or backfills certification evidence.
6. Final reconciliation accounts for each attempt: request ID, outcome, expected save, actual pair, trace ID/receipt, exact durable lookup, duplicate/retry and final classification. Poll only until a fixed deadline. Reject missing, mismatched or extra message rows; never match answer text. A rejected attempt requires zero rows and an authority-denied trace.
7. Preflight requires runtime/fixture hash matches, schema/RPC compatibility, actual actor grants/denials, ordinary/rejected/multipart correlation, fault detection, provider-off and a physical-execution trap. Unknown or failed conditions block certification. No assertion of whole-request or physical exactly-once execution.
8. Trace remains approved structural metadata only. Protected evaluation artifacts may contain synthetic prompts/results; trace rows may not. No new schema is planned.
9. Existing atomic persistence and exact multipart consolidation remain the only conversation writer. Changes must not alter cognitive answers or safety/authority decisions.

## Frozen synthetic controls and thresholds

New synthetic scenarios (maintainer-authored, not blinded certification): ordinary balance/read; rejected other-owner thread; multipart balance/device read; injected permission/schema/transport insert failure; delayed commit; lost receipt with retained attempt mapping; outage and reconnection; save failure; duplicate delivery of a stable read request; lost acknowledgement followed by same-ID persistence retry; concurrent independent requests; absent/mismatched/extra durable evidence; privacy canaries; missing migration/RPC/hash/authority/provider/executor preflight blockers.

Every injected fault must yield its expected non-success/uncertainty classification. Healthy/rejection controls require complete reconciliation. All new assertions pass, zero physical execution, zero missing attempt accounting, no cognitive-answer regression beyond explained fixture timestamps, all original frozen-PASS preserved. Historical workflow failures remain disclosed. Original tests and sealed artifacts stay unchanged. Runtime/source/fixture hashes freeze each run; do not treat exposed development repeats as independent certification.

The final report must distinguish attempted calls, expected pairs, saved pairs, verified traces, injected failures, uncertain/late recovery and correct rejections. Preserved regressions include IQ-11B, IQ-10A–E, IQ-9A/IQ-8/IQ-7/IQ-1–6, frozen 280, Wave 11, authority/privacy, action truth, One-Core, historical workflow controls and build/typecheck/diff/secret checks.
