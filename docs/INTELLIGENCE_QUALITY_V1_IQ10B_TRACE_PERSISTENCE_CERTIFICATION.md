# IQ-10B — Trace and persistence reliability

## Scope and provenance

Starting clean local/remote HEAD: `9dd062e8fea069afb40e5c99c0946318c16fd71b`.
Repository: `contactochiga/Ochiga-backend`; branch: `codex/intelligence-quality-v1`.
The pre-implementation diagnosis was committed as
`bf58119163758b45f65dfa7595428eecb5fcccda`.
The implementation commit containing this report is the final candidate; its
source hashes and detailed results are in
`artifacts/intelligence-quality-v1-iq10b-certification.json`.

This certifies infrastructure reliability within the tested scope, **not overall
intelligence quality**. No IQ-9B sealed case was replayed or tuned against. No
production schema, other product worktree, provider configuration or cognitive
contract was changed. IQ-10C has not begun.

## Diagnosis and repair

The writer emitted `planner_admitted` and `planner_admission_reason`, but neither
the committed trace migration nor the isolated fixture defined them. This was
source/schema drift—a missing migration in the repository—not proof that an
operator omitted an existing migration. The previous single-column probe could
not detect it. Planner admission event capture also omitted the structural
`admit`/`reason` fields; these now pass through the existing allowlist.

The IQ-9B unsaved turn had a socket closure at `thread_upsert`. Its physical
cause remains unproven. The old multi-request save and best-effort compensation
were not atomic or safely retryable after an ambiguous acknowledgement.

### One canonical schema and writer

`20261011072042_iq10b_trace_persistence_reliability.sql` adds the two nullable
columns. Existing traces remain readable. Writer and reader use the existing
allowlisted projection as the column contract. Unknown persistence remains
`null`, not an inferred success. Authority-denied traces reflect IQ-10A denials.

The existing canonical conversation writer now calls a service-only transaction
for thread, message pair and summary persistence. Transaction-scoped per-thread
advisory locks serialize conflicting saves. Stable request identity makes a
retry return the already committed pair; conflicting content is rejected.
Frontend roles cannot execute either persistence function. No new persistence
store, orchestrator or action engine was introduced.

Multipart consolidation uses exact request IDs in an atomic transaction rather
than selecting the last N rows. It retains subturn correlation IDs and stores
the combined answer actually presented. A failed component or consolidation
makes the final save unconfirmed. It does not claim complete history.

### Preflight and failure reporting

The bounded preflight checks all columns, performs an expired synthetic
write/read/delete canary, and verifies both persistence RPC contracts without
writing conversation data. It distinguishes compatible, missing migration,
database unavailable, permission denied and contract mismatch. The default
deadline is 3 seconds (maximum 10 seconds), with at most 500ms independent
canary cleanup. Failed cleanup leaves an already-expired row, not a dashboard
conversation. No raw error payload is exposed.

Configured tracing must pass before the server listens. Environments requiring
tracing can set `OYI_TRACE_PREFLIGHT_REQUIRED=true`; disabled/unconfigured trace
then fails readiness. Without that requirement, intentional disabled or
unconfigured tracing is reported explicitly, never as healthy recording.
`scripts/iq10b-trace-preflight.mjs` provides the same standalone gate. The full
worker-starting server was not launched in this test fixture.

Trace receipts distinguish pending, saved, failed, disabled and unconfigured.
The default transport has a 2-second request timeout and 2.2-second hard attempt
deadline, with at most one transient retry using the same trace UUID. Late
completion cannot change a timed-out receipt into a success. Save retries never
rerun capabilities or actions. If both save acknowledgements are lost, the
response says its save could not be confirmed—even if the database committed.
It does not delete the potentially committed pair.

## Validation

All database work used the verified synthetic Wave 11 fixture at loopback port
55421. The migration replayed twice, preserved existing record hashes and
proved frontend execution denial. Removing a column in the isolated schema
caused `missing_migration`; restoring it returned `compatible`.

The 25 IQ-10B checks cover 28 new synthetic turns plus direct failure injection:
schema mismatch, real anonymous denial, outage, timeout, trace failure, late
completion, rollback, lost acknowledgements, reconnect, partial multipart save,
collapse failure, concurrent duplicate and distinct saves, long-ID collision
resistance, ordinary/assessment/reassessment/follow-up/confirmation/cancellation
correlation, provider-off behavior and trace privacy. No physical execution was
attempted.

The trace API/export suite passes 11 checks, including authorization, bounded
queries, retention, failure visibility, and absence of 20 private-content
sentinels. Trace columns contain structural allowlisted metadata, not synthetic
prompts, answers, raw evidence, provider payloads or reasoning chains. Synthetic
test prompts/results are retained only in the dedicated evaluation artifact.

The frozen 280 preservation and final correlation counts are recorded in the
machine artifact. Preservation compares answers to an archived starting-HEAD
runtime on the same repaired isolated schema; it is not a new cognitive score.
The database correlation check uses canonical IDs, not answer-text matching.

| Final gate | Result |
| --- | --- |
| IQ-10B synthetic reliability | 25 PASS, 0 FAIL; 28 turns |
| Frozen 280 answer preservation | 280/280 identical answers |
| Durable conversation/trace linkage | 280/280 turns; 560 message rows |
| Wave 11 structured corpus | 132 PASS, 0 FAIL |
| IQ-10A live / pure invariants | 33/33 / 49/49 |
| Broader regression suite outcomes | 53 PASS, 5 historical FAIL |
| Trace API/export | 11 PASS |
| Existing docs/artifacts/scripts preserved | 828 byte-identical files |
| Typecheck, build, diff and changed-file secret-pattern scan | PASS |

Local frozen-280 latency: control mean 102ms / p50 87ms / p95 185ms;
candidate mean 89ms / p50 87ms / p95 128ms. The interleaved trace-export probe
measured trace-off median 30ms and trace-on 27ms (8 samples each), trace insert
median 4ms off the response path, list 8ms, filtered list 21ms and detail 9ms.
Host load and caches were uncontrolled: these observations show no measured
regression, not a causal speedup. Restored-schema preflight took 47ms locally.

### Regression qualifications

The complete regression chain records 53 passing suite outcomes and five known
failing outcomes:

- `oyi-workflow-action-phase-c-reload-smoke`
- `oyi-workflow-action-phase-c-multigang-smoke`
- `oyi-workflow-action-phase-c-correction-smoke`
- `oyi-workflow-durable-continuation-smoke`
- `iq9a15-owned-workflow-smoke` (aggregate retaining the target-correction failure)

These are not certified here. Multi-gang control remains excluded from release
claims. IQ-10A live safety passes 33/33; its pure invariant suite passes 49/49.
IQ-1 cancellation passes 10/10 with zero physical execution. IQ-7 held-out
action/safety and E2E checks remain sound; existing parser misses remain visible
in the artifact, not converted to passes.

Two old trace guards were already stale at the starting commit. The original
projection guard's source-layout regex did not match the existing multipart
implementation. The original live export guard expected 12 stages although
canonical inventory already contained 13. New wrappers retain the functional
privacy/assertion suites, check the actual finally boundary and derive stage
count from canonical inventory. Original scripts and all frozen artifacts are
unchanged. Their literal stale assertions are documented, not silently edited.

Intermediate runs also encountered a socket closure in the IQ-2 test and an
IQ-3A fixture-cleanup transport failure. Neither failed attempt is called a
pass. Nine identified synthetic leftover rows were removed from the isolated
fixture; unchanged assertions and the complete chain were rerun successfully
apart from the known workflow exclusions.

## Reproduction

Run sequentially in the authorized worktree, using fresh output prefixes:

```sh
npm run typecheck
npm run build
node scripts/iq10b-contract-smoke.mjs
node scripts/iq1-local-run.mjs script /tmp/iq10b-certified-schema scripts/iq10b-schema-replay.mjs
node scripts/iq1-local-run.mjs script /tmp/iq10b-certified-safety scripts/iq10b-reliability-live.mjs
node scripts/iq1-local-run.mjs script /tmp/iq10b-certified-export scripts/iq10b-trace-export-smoke.mjs
node scripts/iq1-local-run.mjs script /tmp/iq10b-certified-reg scripts/iq10a-regressions.mjs
node scripts/iq1-local-run.mjs script /tmp/iq10b-certified280 scripts/iq10b-candidate280.mjs
node scripts/iq1-local-run.mjs wave11 /tmp/iq10b-certified-wave
node scripts/iq1-local-run.mjs script /tmp/iq10b-certified-links scripts/iq10b-verify280-links.mjs
node scripts/iq10b-report.mjs /tmp/iq10b-certified
git diff --check
```

The regression command exits nonzero for the five disclosed historical suite
failures. The report generator verifies precisely that set, zero changed
answers, durable links and frozen-file preservation. A changed-diff secret scan
covers private keys, access tokens, credential URLs and JWT-shaped secrets.

## Limits and release conditions

Changed runtime owners are `conversationTraceProjection`,
`conversationTraceRecorder`, new `conversationTraceSchema`,
`ConversationOrchestrator`, `canonicalConversationPersistence`,
`conversationTraceView` and startup in `server.ts`. The additive SQL migration,
nine new `scripts/iq10b-*.mjs` diagnostic/test runners, the frozen diagnosis,
this report and one machine-readable certification artifact comprise the rest
of the change. Existing canonical persistence remains the single writer.
The Supabase/Postgres skill guidance informed the local-only migration replay,
transaction-scoped locking and least-privilege function grants.

- No production migration has been applied. Release requires the additive
  migration and a successful preflight before serving traffic.
- A pending asynchronous trace is not a durability promise. Forced process
  death before delivery can still lose it; no outbox was added. Graceful
  shutdown allows six seconds to drain and warns on incomplete draining.
- Idempotence is for database delivery with stable thread/request identity,
  not whole-HTTP-request or physical-action exactly-once execution.
- Historical partial/duplicate records are not rewritten; identity conflicts
  fail honestly. Concurrent persistence preserves complete pairs, not a new
  conversational scheduling policy.
- Local latency observations are recorded separately from quality. They do
  not establish a production speedup or workload capacity guarantee.
- The five workflow outcomes, existing cognitive defects and failed IQ-9B
  independent certification remain outside this targeted certification.

IQ-10C may begin only after explicit approval. No merge or deployment occurred.

**IQ-10B TRACE & PERSISTENCE CERTIFIED — IQ-10C APPROVAL REQUIRED**
