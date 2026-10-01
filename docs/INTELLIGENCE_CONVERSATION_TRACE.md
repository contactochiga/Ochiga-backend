# Durable canonical conversation trace (Intelligence Visibility, Slice 7)

One sanitized, structural record per `ConversationOrchestrator.run()` invocation, stored in
`public.oyi_conversation_traces` and read only through Backend's authenticated
`/office/intelligence/traces` export. It is operational telemetry, not conversation history.

## Writer
- Single finalization boundary: `ConversationOrchestrator.run()` wraps `runTurn()` and calls
  `recordConversationTrace()` exactly once on return **or** throw. No return path inserts traces.
- `conversationTraceRecorder.ts` is the only inserter. The call is synchronous and never throws;
  the insert runs after the response (and its canonical persistence) and is never awaited by the
  conversation path. Failures increment `oyi_conversation_trace_write_total{outcome="failed"}` and
  log a throttled `oyi_conversation_trace_write_failed`; a failed trace is never reported saved.
- Semantics: best-effort, at most once per turn. `gracefulShutdown` (server.ts) flushes in-flight
  writes for up to 2s. A process that calls `process.exit()` directly can drop its final write.
- Kill switch: `OYI_CONVERSATION_TRACE_ENABLED=false`.

## Projection (`conversationTraceProjection.ts`)
Every column is listed in `TRACE_FIELD_CLASSIFICATION` (AVAILABLE_NOW / DERIVED_SAFELY);
`TRACE_EXCLUDED_FIELDS` lists what is never read (prompt, reply, raw thread/request/actor/home/
target ids and labels, evidence, context, memory, knowledge, communication, error messages,
credentials). Values are closed vocabularies (OyiDomain, SemanticOperation, Wave 11 resolution
outcomes, TargetSource, rollout statuses), registered capability keys, UUID-only lineage, and
keyed one-way references (`OYI_TRACE_REFERENCE_KEY`; without it an unkeyed domain-separated hash
is used). Only the 12 stages the runtime actually emits are persisted; declared-but-never-emitted
stages are never fabricated. Errors persist a class name only.

Terminal outcomes (canonical taxonomy): capability_response, governed_continuation,
canonical_unsupported, capability_no_match, business_surface_fallback, declared_disabled,
authority_denied, runtime_error; persistence failure is `response_status = returned_unsaved`.
The tracer's older "legacy" capability label is translated at the projection boundary and kept
only as `compatibility_label_seen`.

## Retention
`expires_at = started_at + OYI_TRACE_RETENTION_DAYS` (default 30, matching camera "standard" media
and resident-context retention; valid range 1-365). Reads exclude expired rows.
`conversationTraceRetentionWorker` (worker process only; `OYI_TRACE_RETENTION_ENABLED=false` to
disable; `OYI_TRACE_RETENTION_INTERVAL_MS`, default hourly) deletes expired rows in bounded
batches (500).

## Access
RLS enabled with no policies; `anon`/`authenticated` have no privileges; `service_role` has
select/insert/delete only (append-only, no update). Office never queries the table.

## Tests
`scripts/intelligence-trace-projection-contract-smoke.mjs` (pure contract, single writer) and
`scripts/intelligence-trace-live-smoke.mjs` (real turns on the isolated Wave 11 fixture:
exactly-once, privacy torture, failure isolation, list/filter/pagination, detail, taxonomy,
lineage, retention, performance).
