# IQ-11C — Trace reliability and certification integrity

## Targeted decision and repository boundary

**IQ-11C TRACE RELIABILITY CERTIFIED — INTELLIGENCE REMEDIATION APPROVAL REQUIRED.** Overall intelligence remains **NOT CERTIFIED**. This result validates the tested capture, failure-detection and reconciliation contracts, not lossless delivery under every infrastructure failure or production readiness.

Starting local and live remote HEAD: `5858bfec66e49d4a30f03d7454b07a46fa2628d2`. Worktree `/Users/ochigaidoko/Documents/oyi-intelligence-quality`, branch `codex/intelligence-quality-v1`, origin `git@github.com:contactochiga/Ochiga-backend.git`; worktree clean before editing. The final delivery SHA is the commit containing this report; local/remote equality is checked after push rather than self-embedded in the commit.

The contract was frozen in commit `e1b14bf` before runtime modifications. Tests use new synthetic development scenarios and the setup-only prefix of the existing isolated harness. They are maintainer-authored, not blinded intelligence certification. No sealed IQ-10F/IQ-9B turns were replayed or changed. No production database, schema migration, provider configuration, physical device, customer communication, other repository, merge, deployment, model-assisted interpretation or Initiative work was performed.

## Historical failure reconstruction: what is and is not proven

IQ-11A's preserved reconciliation reports 1,285 attempts, 1,283 saved pairs and 1,282 captured durable correlations. All 765 setup calls were saved/correlated. There were no failed authorized saves demonstrated in that run; the two no-save outcomes were correct cross-owner rejections.

The Facility failure, request `4b698c6b-1bc2-45c7-9433-0fa846f205ad`, trace `c599f990-83b1-48d8-a3c7-a3cae3e989b1`, had a failed write receipt and no row at both preserved exact-ID audits. **The underlying database/transport cause remains unknown.** Its sanitized code was `trace_write_failed`. Schema mismatch, network interruption, timeout and retry exhaustion cannot be retroactively distinguished. The runner had flushed writes, so an ordinary pre-flush lookup race is not demonstrated. No historical row was queried anew, replayed or backfilled by this slice.

The two ownership rejections had no response receipt for the runner to capture. The finally writer could have run; missing capture did not prove missing storage. The per-process HMAC key was ephemeral, so request text/timestamps cannot defensibly recover their traces. The fix preserves new exception correlation prospectively; it does not repair or recertify the old run.

## Existing infrastructure extended

### Exception correlation and failed-save identity

The single `ConversationOrchestrator.run` finally boundary still calls the one trace writer exactly once. Returned responses carry the receipt as before. Thrown object errors now have a private in-process association available through `exceptionTraceCorrelation(error)`, containing the canonical request ID and receipt. The error is rethrown unchanged; no new public error endpoint or authority path is introduced.

A canonical ownership rejection projects `authority_denied` and `persistence_saved=false` without persisting the rejected conversation content. The synthetic other-resident attempt remains rejected and has zero message rows.

On save failure, the existing persistence writer retains `persistence_attempt_thread_id` and `persistence_trace_request_id`. These are diagnostic identities, **not a claim that the thread exists or the save succeeded**. The normal `thread_id` and unsaved warning remain truthful. This makes exact, indexed reconciliation possible even after a lost acknowledgement on a newly created thread.

### Durable receipts

Legacy `status` values remain compatible. Additional structural fields carry delivery state, safe failure class, stage, attempt count and opaque turn reference.

| Delivery state | Meaning |
|---|---|
| `pending` | Write/verification is in progress; no durability promise. |
| `saved_verified` | Exact trace ID was read back and its structural request/thread/persistence/authority/outcome fields matched. |
| `failed` | A classified failure was observed; no successful delivery is claimed. |
| `timed_out` | Our bounded deadline expired; storage may still complete later. |
| `uncertain` | Transport/acknowledgement or verification ambiguity remains. |

`saved` now requires readback, not only insert acknowledgement. One additional asynchronous exact-ID read is performed per successful verification. Default transport has a 2-second abort signal and 2.2-second hard attempt deadline, at most two idempotent attempts with the same trace UUID. The default drain is bounded to six seconds. Cooperative abort expiry is classified from the actual signal, not guessed from an arbitrary error message.

Known error classes distinguish schema, permission, database rejection/unavailability, transport, timeout and verification mismatch. Unrecognized causes remain unknown. Only structural error codes/classes and trace IDs are retained; raw database/provider error messages are not added to receipts or trace logs. Per-request receipts, not the throttled latest-health log, are the accounting source.

Late callbacks cannot change a terminal receipt to success. A separate exact-ID reconciliation can report recovered durability while retaining the timed-out/uncertain receipt. Failed conversation saves and successful trace writes remain independent.

## Final reconciliation and certification preflight

`conversationTraceReconciliation` is a service-only reader of the existing tables, not a second trace store. It accepts a protected attempt manifest and performs no writes, replay, compensation or backfill.

Each attempt records canonical request ID, trace ID, captured opaque turn/thread references, surface, returned/rejected/exception outcome, expected message persistence, save claim, receipt and duplicate-delivery information. It requires the exact user/assistant pair in the known thread, or zero rows for an ownership rejection. Multipart extra rows, mismatched references, duplicate trace identities, empty manifests and unknown correlations fail closed. Matching by answer text or latest-N messages is never used.

The default reconciliation deadline is six seconds, capped at fifteen seconds, with at most 2,000 attempts and eight concurrent lookups. Reads use the indexed thread plus exact request metadata and exact trace UUID. Cooperative abort and an outer deadline bound even an uncooperative test client. Pending/missing/uncertain traces are polled only to the fixed deadline. Previously observed evidence is not replaced by an empty deadline placeholder.

The synthetic runner fsyncs a structural **started** journal entry before invocation, then a **returned/rejected** correlation entry and a final reconciliation. Interrupted attempts remain visible. Captured opaque references permit later lookup even if the process HMAC key changes; the key itself is never archived.

Preflight fails closed unless all measured gates hold: frozen runtime/dist and fixture hashes, trace schema and persistence RPC compatibility, actual effective grant/denial, ordinary correlation, rejected-request correlation, multipart persistence, fault detection, provider-off state and physical-execution isolation. The existing IQ-10B schema/RPC canary remains the canonical schema check; no schema was added. Its missing-column/RPC, anonymous permission and outage controls continue to pass.

Preflight is point-in-time. Final reconciliation remains mandatory; a healthy preflight cannot declare a later failed write successful. Future certification must use this capture/reconciliation contract, not reuse the sealed IQ-10F runner's response-only exception handling.

## New synthetic results and exact accounting

**32 checks passed, 0 failed; 29 attempted requests; zero physical executor attempts.** All 16 uninjected healthy/rejection controls reconcile. The suite exercises all four workers, real effective denial, ownership rejection, multipart persistence, delayed completion, lost receipt, key rotation, missing/mismatched identifiers, false acknowledgement, save failure, lost save acknowledgements, duplicate read delivery, concurrent reads, transport retry/exhaustion, transport timeout, noncooperative lookup, privacy and every required preflight gate.

| Accounting item | Count |
|---|---:|
| Attempt starts journaled / outcomes captured | 29 / 29 |
| Returned responses / correct ownership rejections | 28 / 1 |
| Responses claiming a saved pair | 25 |
| Durable complete pairs associated with attempts | 26 |
| Distinct message rows | 54 |
| Exact-ID verified traces | 21 |
| Final `saved_verified` receipts | 20 |
| Late trace durably recovered, receipt still timed out | 1 |
| Deliberately missing trace rows | 8 |

Pair counts are attempt-based: duplicate delivery reuses the same pair rather than adding two rows. One lost-save-acknowledgement case has a durable pair despite an honest unsaved response; another failed save has no pair. Failed multipart consolidation deliberately leaves four rows, not a valid combined pair. No unauthorized rejected content is saved.

The mixed fault run correctly returns **not ready**:

| Final classification | Attempts |
|---|---:|
| Saved and correlated | 16 |
| Rejected and correlated | 1 |
| Durable trace recovered | 1 |
| Missing trace after classified failure | 4 |
| Uncertain trace delivery | 4 |
| Missing expected save | 1 |
| Durable pair but save unconfirmed | 1 |
| Unexpected multipart message set | 1 |
| Total | **29** |

These injected defects are **not** counted as successful persistence. The targeted test succeeds because it detects and accounts for each fault and blocks certification of the faulty batch. Default trace retry after a lost first acknowledgement verifies one durable trace; retry exhaustion remains uncertain. Persistence retries do not rerun capabilities. Duplicate read testing does not assert exactly-once physical execution.

Intermediate development runs are preserved: v1 exposed unbounded-scope message lookup delays; v2 isolated the missing failed-save thread identity; v3 passed the initial 23 controls; expansion passed 31, then 32 including default transport abort classification. No original expected outcome was weakened.

## Preservation and privacy

| Gate | Result |
|---|---:|
| IQ-11B | Fresh unchanged run: 25/25 live; 22/22 structural. Earlier run: 24/25, with one genuine infrastructure failure detailed below. |
| IQ-10A | 33/33 live safety |
| IQ-10B | 25/25 reliability; trace contract/export pass |
| IQ-10C | 57/57 structural; 62/62 live |
| IQ-10D | 33/33 contract; 34/34 additional; 32/32 live |
| IQ-10E | 22/22 contract; 14/14 additional; 29/29 live assertions |
| IQ-7 held-out E2E | 45/45; parser metrics unchanged, not perfect |
| Broader IQ-9A/IQ-8/IQ-7/IQ-1–6, authority/privacy, action truth, One-Core and workflow chain | 53 PASS; 5 unchanged historical failures |
| Wave 11 | **132/132 PASS** |
| Frozen 280 | **280 persisted and correlated; 560 message rows** |
| Original frozen-PASS preservation | **40/40 byte-identical** |
| Typecheck / build / diff / changed-file secret-pattern checks | PASS |

Frozen-280 comparison has 278 identical answers and two fixture wallet as-of timestamp changes. Both were separately reviewed; values, currency, scope and answer content are unchanged. No cognitive score is promoted or rewritten. All 964 pre-existing docs/artifacts/scripts are byte-verified against the starting commit. Frozen IQ-10F findings remain unchanged.

### Unexpected local infrastructure incident — not erased by a passing repeat

The final-chain IQ-11B run failed `HAZARD-02-1` during its ordinary maintenance setup read, before the hazard assertion. It returned an honest unsaved answer and an uncertain trace receipt after two insert attempts. Request `92dca611-b96e-45bb-8aec-93880b5cb158`, thread `c60f996d-3c7f-4687-b3e2-53734e07aa9f`, trace `2d4ab155-e0db-4dfe-a1ac-928c71406157` were captured. Read-only exact-ID inspection found **zero message rows and zero trace rows**. No turn was replayed or backfilled. The original batch is **not integrity-valid** and remains archived with its failed assertion.

The safe failure class is `unknown`; retained database/PostgREST logs do not establish whether transport, database rejection or timeout caused the incident. Containers were healthy at inspection. A separate unchanged development run with fresh request IDs passed all 25 checks, but does not turn the failed request into a successful one. Targeted IQ-11C certification concerns tested failure detection, bounded delivery and fail-closed reconciliation; it is **not a guarantee that this local environment never loses a save or trace**. A future independent certification run encountering this condition must stop or remain integrity-blocked, not rerun questions to recover its score. Operational cause diagnosis remains infrastructure debt.

Trace privacy tests inspect the existing allowlist and reject prompts, home IDs, private sentinels and credentials in trace rows. Protected synthetic evidence is archived separately. Export logs contain deliberately key-shaped sentinels from existing privacy tests; committed copies redact those values while retaining original hashes and explicit redaction counts. Decompressed evidence and changed files pass secret-pattern checks; this is not a repository-wide security certification. Supabase skill guidance was used to keep all checks within the verified loopback fixture; no production schema or credentials were accessed.

The five historical failing suite outcomes are phase-C reload, multi-gang, correction, durable continuation, and the owned-workflow aggregate. The owned variants retain their existing two PASS/two FAIL split. Multi-gang remains excluded from release claims; no workflow failure is repaired or hidden here.

## Performance and limitations

Measured before/after frozen-280 mean, p50 and p95 are recorded in the machine artifact. The added cost is one asynchronous exact-ID verification read per successful trace. Measurements are sequential local provider-off runs, not production SLOs; host/cache/fixture variation is not controlled. The writer is still off the conversation response path, while certification explicitly waits and reconciles it.

- No durable outbox was added. A crash before delivery can lose a trace; the started-attempt journal exposes the unresolved gap and certification must block.
- Exception associations are process-local and must be copied promptly into protected capture. This slice does not add a public trace-error API.
- Stable-ID database delivery is idempotent; whole-HTTP-request, external communication and physical-action exactly-once behavior are not claimed.
- A failed or ambiguous save can remain a certification blocker even if some storage later exists. No evidence is silently repaired or deleted.
- The original Facility transport/database cause and historical rejection-trace storage presence remain unproven.
- The new local regression incident lost both save and trace; its underlying cause is unproven. A later healthy run does not validate that failed batch. Strict final reconciliation is mandatory for every future certification.
- Existing workflow and broad intelligence/generalization defects remain. No overall intelligence certification or production approval follows.

## Files, reproduction and delivery

Runtime owners changed:

- `src/oyi-core/observability/conversationTraceRecorder.ts`
- `src/oyi-core/observability/conversationTraceProjection.ts`
- `src/oyi-core/observability/conversationTraceReconciliation.ts` (new reader/gate over existing stores)
- `src/oyi-core/orchestration/ConversationOrchestrator.ts`
- `src/oyi-core/persistence/canonicalConversationPersistence.ts`

New scripts: `iq11c-freeze.mjs`, `iq11c-reliability-live.mjs`, `iq11c-report.mjs`, `iq11c-source-audit.mjs`, `iq11c-incident-audit.mjs` (read-only exact-ID local incident diagnosis). New documentation: frozen contract and this report. New artifacts: certification JSON plus baseline, candidate, development and regression compressed bundles with hashes. Existing regression and certification scripts remain unchanged.

For a new development run, build first, freeze a fresh `/tmp/iq11c-…-manifest.json`, then use the existing isolated launcher with the matching output prefix:

```sh
npm run build
node scripts/iq11c-freeze.mjs /tmp/iq11c-new-manifest.json
node scripts/iq1-local-run.mjs script /tmp/iq11c-new scripts/iq11c-reliability-live.mjs
```

Do not call that development repeat independent certification. A future first-contact runner must freeze its own corpus, fsync attempt identities before execution, capture both response receipts and `exceptionTraceCorrelation`, preserve opaque references, and finish with `reconcileConversationAttempts`. Any required gap or unverified preflight gate blocks that certification. Never replay turns to fill missing evidence.

The contract and tested implementation/evidence are pushed only to the existing IQ development branch. Final SHA and remote equality are reported after push. Compositional-intelligence remediation may be proposed next, but requires explicit approval. Model-assisted interpretation and Initiative remain outside authorization.

**IQ-11C TRACE RELIABILITY CERTIFIED — INTELLIGENCE REMEDIATION APPROVAL REQUIRED**
