# IQ-10B infrastructure baseline — frozen before implementation

Starting clean local/remote commit: `9dd062e8fea069afb40e5c99c0946318c16fd71b`.
Branch: `codex/intelligence-quality-v1`; origin: `contactochiga/Ochiga-backend`.
Inspection date: 2026-10-11. No runtime changes preceded this diagnosis.

## Demonstrated defects

1. `conversationTraceProjection.ts` emits `planner_admitted` and
   `planner_admission_reason`. Neither exists in the committed
   `20261001120000_intelligence_conversation_traces.sql` nor the isolated
   `supabase_db_wave11-behavioural-fixture` table (35 columns inspected).
   The recorder inserts the entire projection: PostgREST rejects it. This is
   writer/schema drift with a missing migration in source control, not proof
   that an operator failed to apply an existing migration.
2. The previous preflight selected only `trace_id`. It did not prove full write
   compatibility. Recorder status `active` means configured, not successful.
   Background failures are counted/logged but no durable receipt is returned.
3. Reader detail uses `select('*')` but explicitly projects safe fields. The
   two planner fields are not presented. Older records must remain valid with
   null values. Projection defaults unspecified persistence to true: this is
   stronger than the underlying evidence and must become unknown.
4. The canonical writer separately upserts thread metadata, inserts the user
   and assistant rows, verifies, and updates thread summary. Failures trigger
   best-effort compensation; there is no atomic transaction, request-key
   deduplication or safe retry of ambiguous transport delivery. Metadata may
   outlive compensated messages. New generated message IDs make retries
   duplicate rather than idempotent.
5. Multipart collapse selects the last N rows without request IDs, uses
   separate updates/deletes and its result is ignored by the orchestrator.
   Concurrent requests can select the wrong rows; a failed component/collapse
   can leave a final response overstating persistence. Sub-turn trace references
   are not explicitly retained in the collapsed exchange.
6. The trace request ID comes from the per-subturn tracer. Persisted messages
   already carry `conversation_request_id`, but outer composed turns can lose
   the complete correlation set. Correlation must use IDs, not answer text.

## IQ-9B evidence (not replayed)

IQ-9C reports 0/1267 durable trace correlations, with PGRST204 on the two
columns. Osa-F007 setup index 1 reported `persistence_saved:false` after
`thread_upsert` failed with `UND_ERR_SOCKET: other side closed`. The origin of
the socket closure is unproven. The continuation was infrastructure-blocked.
This is not evidence of an intentionally skipped application save. No sealed
utterances, grading or artifacts will be edited or replayed.

## Bounded repair contract

- One allowlisted trace projection, additive migration for the two columns;
  no private content, raw IDs, provider payloads or reasoning in trace.
- Bounded schema/write/read preflight: compatible, missing migration,
  database unavailable, permission denied, contract mismatch. A deployment
  readiness gate must not call configured-but-failing writes healthy.
- Trace receipts distinguish pending/saved/failed/disabled/unconfigured.
  Retries reuse the same trace ID; no unbounded waiting or false saved claim.
- Existing canonical persistence remains the sole writer. Use a service-only
  atomic database transaction for the existing thread/message operations,
  with idempotent turn identity and no automatic rerun of capabilities/actions.
- Multipart history consolidation must address exact request IDs, retain all
  trace correlations, transact atomically and surface partial-save failure.
- New synthetic tests: outage, missing column, denial, write/save failure,
  ambiguous retry, concurrency, multipart partial failure and reconnection.
  Preserve answers, safety and existing authority contracts.

## Isolation and gates

Only verified loopback fixture `http://127.0.0.1:55421`, synthetic Wave 11 world.
No production migration/deployment, other worktree, provider change, cognitive
tuning, IQ-10C–F or Initiative. Additive migration replay must be reproducible;
failures stay visible. Full frozen-280 answer preservation and IQ-10A regression
are required. Historical workflow exclusions remain exclusions.
