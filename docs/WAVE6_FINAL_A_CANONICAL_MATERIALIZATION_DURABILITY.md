# Wave 6 Final A — Canonical signal materialization durability

2026-09-24. Local implementation only; no push/deploy. Baseline `0dce3d0d9e39180f8feb5a57c6d16962bc615d90`, main, local origin/main `909d5d0a35ab2de84c7cdc83d0f10be166e0b512`, 12 ahead/0 behind. Final commit is the commit containing this report (reported separately to avoid self-referential SHA). Protected dirty pilot/me routes, untracked Aider/pilot/config/audit/LOCAL_TEST files were excluded.

## Failure reproduced and closed

Previously `receiveSignal` called `canonicalIntelligenceStore.recordSignal`, then prepared/published intelligence and separately called `recordBundle` inside a safe hook. A persisted duplicate returned before reasoning/persistence. Partial downstream failure therefore left no durable repair work. Insight/plan upserts omitted conflict identity; incident evidence was appended on retry; some resolved Supabase `{error}` responses were not treated as failures.

New path: normalization/validation → canonical identity lookup → unchanged reasoning → signal-scoped artifact identities → atomic signal + prepared obligation registration → fenced transactional materialization → additive lifecycle acknowledgement. Existing subscription publication occurs only on the initial successful registration path. Recovery never calls reasoning, subscription callbacks, notifications or physical execution.

## Migration and security

Migration: `20260924112951_wave6_canonical_materialization_durability.sql` (created with Supabase migration CLI).

One nullable column: `operational_signals.materialization jsonb`. No new table. A shape/size constraint and a partial state/due/id index support bounded pending claims. Existing rows remain NULL: exposed as `legacy_unverified`, never automatically marked complete or claimed.

Four fixed-purpose RPCs:

| RPC | Purpose |
|---|---|
| `oyi_register_materialization(p_signal jsonb,p_prepared jsonb)` | Insert factual signal and immutable prepared obligation in one row/transaction; duplicate returns original lifecycle without replacing it |
| `oyi_claim_materialization(p_limit integer default 25,p_signal_id uuid default null)` | Claim 1–100 due obligations with row locking/SKIP LOCKED and fresh fencing token |
| `oyi_complete_materialization(p_signal_id uuid,p_token uuid)` | Validate claim, persist required bundle and completion atomically |
| `oyi_fail_materialization(p_signal_id uuid,p_token uuid,p_code text,p_terminal boolean default false)` | Fenced sanitized retry/terminal bookkeeping |

All use SECURITY INVOKER, empty search_path, explicit public table qualification. PUBLIC/anon/authenticated EXECUTE revoked; service_role EXECUTE granted, with explicit SELECT/INSERT/UPDATE on the existing materialization tables required by invoker functions. Existing RLS remains enabled. No dynamic SQL or caller-selected table/function execution. These are trusted Backend operations, not client APIs.

Input bounds: signal JSON <=512KiB, prepared JSON <=1MiB, complete processing JSON <=2MiB, canonical key <=2048 characters, fixed artifact collections (awareness/recommendations/insights/plans/deliveries), each <=100 rows. Stored prepared rows contain existing canonical intelligence, not new credentials/media. Fixed SQL table types validate column types; malformed persistent work is observable rather than silently accepted as complete.

Supabase function/security documentation and skill reviewed. Changelog Markdown retrieval was unavailable (web content-type rejection, then local DNS failure); no changelog verification is claimed. Local error-level security advisors reported no issues on the existing local DB; that is not certification of an applied production migration. Isolated SQL tests separately prove this migration's RPC ACLs and transaction behavior. No shared local schema or production schema was migrated; no destructive reset.

## Processing contract

```text
materialization {
  version: 1,
  state: pending | materializing | materialized | retryable_failure | terminal_failure,
  prepared: {
    version: 1, reasoning_version: canonical-v3-final-a1, evaluated_at,
    incident: prepared correlation row or null,
    suppress_child,
    rows: { awareness[], recommendations[], insights[], plans[], deliveries[] }
  },
  attempt_count, due_at,
  claim_token?, last_error_code?, completed_at?, incident_id?
}
```

Prepared rows themselves carry the stable identity manifest. Original normalized signal/context remains in the existing signal payload; raw signal history is not redundantly copied into the obligation. Prepared outputs retain all persistence inputs, so restart does not recalculate using a new clock/history/context. This is processing state, not domain status or another intelligence authority.

Registration uses the existing unique canonical_signal_key (provider/event/domain/entity/estate/Home). The DB creates its signal UUID and receipt timestamps. Conflict returns original ID/state, including legacy NULL. Registration error is not reported as persisted acceptance. An in-memory dedup hit cannot permanently suppress retry of valid input whose durable registration never happened.

## Claims, completion and crash semantics

Claims use `FOR UPDATE SKIP LOCKED`, ordered due timestamp/id, maximum 100; default worker 25. Lease is 60 seconds. Reclaim replaces token; old worker cannot complete or mark failure for a newer claim. Time is checked after obtaining the signal row lock. Completion holds that lock for the transaction, preventing another active owner from interleaving writes.

Completion writes only artifact kinds actually prepared. Incident, awareness, recommendations, insights, plans, delivery rows and lifecycle completion commit together. Any SQL/constraint/trigger failure rolls the whole completion back; registration remains durable. A crash after all writes but before commit has no partial committed bundle; crash after commit/before client acknowledgement returns materialized on lookup/retry.

| Crash boundary | Recovery |
|---|---|
| Registered signal/obligation, no claim | Pending sweep claims it |
| Claimed, process dies | Expired lease becomes eligible |
| Any bundle stage or completion bookkeeping fails | Entire completion rolls back; fenced retry or lease recovery |
| Completion commits, response lost | Same factual identity returns materialized; no artifact rewrite |
| Failure bookkeeping transport fails | Existing lease eventually expires; obligation remains |

Guarantee: durable obligation and idempotent transactional canonical DB materialization with retry attempts. Not exactly-once external callbacks or commands. Database loss, privileged deletion/corruption, permanently malformed work and disabled workers are not silently claimed recoverable without operator action.

## Artifact identities and mutable state

Awareness and reasoning's reusable insight/recommendation/plan IDs are scoped to the canonical signal key after reasoning, with related-reference mappings preserved. The normalized display signal ID alone is insufficient: different provider events can share it. Deterministic SHA-256-derived UUIDs use existing database primary keys; no added identity columns. Signal-scoped awareness/recommendation keys avoid conflating different accepted bundles. Scores, privacy, urgency, evidence and correlation functions are unchanged.

Completion uses insert-if-missing on awareness/recommendation keys and insight/plan primary keys. Existing acted-on/dismissed/resolved artifact state is not reset. New delivery keys are canonical-signal-scoped plus channel; retries retain the prepared key and never reset acknowledged entries to pending. Legacy keys are untouched. Prepared content is retained as the accepted work; lifecycle projection can recognize an already-recovered incident when filling missing older awareness/recommendation rows.

## Narrow incident guard

No correlation/scoring redesign. Completion serializes the incident correlation key with a transaction advisory lock (including first creation) and locks the existing incident row. The unique incident_key remains identity. Completion's materialized signal guard makes the same contribution apply once. Evidence is deduplicated by stable evidence ID (signal_id fallback, then full value); affected entities are deduplicated; existing bounded 24-entry retention remains.

Incident lifecycle order is source occurrence, original durable acceptance time, then canonical key—not retry time. A narrow `_materialization_order` marker in the existing incident scope JSON records that tuple and last materializer write time; no extra table/column is added. Equal-time legacy incidents without this marker preserve existing lifecycle conservatively. A later non-participating/manual edit identifiable through updated_at is not overwritten by delayed work. Earlier delayed materialization may supply missing evidence and earlier first_seen, but cannot reopen/overwrite newer status, severity, last_seen or recovery. Missing older awareness/recommendation rows inherit resolved lifecycle when the incident is already resolved, without replacing accepted explanatory payload or resetting existing rows.

This is not the generic Final B incident race solution. Legacy/manual writers that do not participate in the new transaction discipline remain a separate integrity boundary. No manual incident workflow was redesigned. During mixed old/new Backend deployment, do not advertise full convergence or durable ordering across old writers.

## Supabase errors and retry

Every new lookup/RPC/diagnostic checks returned `error`; a resolved Promise is not sufficient success. Real-Core integration test injects `Promise.resolve({data:null,error:{code:'08006',...}})` on completion: registration stays persisted, acknowledgement is incomplete/retryable, and later reconciliation completes the original prepared bundle.

Failure codes are sanitized low-cardinality strings. SQLSTATE 22/23 prepared-data/constraint failures become terminal for operator inspection; transport/other persistence failures retry. Backoff is exponential (first failed attempt 10s) capped at one hour. There is no attempt-count rule silently discarding transient failures. Terminal work remains visible and is not auto-replayed. Claim loss/expiry never permits a stale failure update.

## Reconciler, observability and operations

`canonicalMaterializationWorker.ts`: explicit opt-in `CANONICAL_MATERIALIZATION_RECOVERY_ENABLED=true`, initial pass then every 30 seconds, 25 claims/tick, process-local busy guard plus DB cross-process fencing. No busy loop, no provider polling, no full backlog fetch. It handles pending, due retryable failure and expired materializing leases. Immediate first-attempt completion uses the same claim/RPC path.

Metrics: claim attempts/retry flag, completion/stale/retryable/terminal results, worker failures. No signal IDs or private content in labels. `materializationDiagnostics()` provides state counts and oldest pending timestamp/age, with corresponding low-cardinality gauges. It is a service-only programmatic diagnostic, not a new public UI/API. Count queries are constant in number, not per signal; exact counts still have database work proportional to matching indexed data and should not be polled at high frequency on large history.

Operationally monitor oldest pending age, terminal count, retries, claim recovery and worker heartbeat. Alert if recovery is disabled unintentionally or pending age exceeds the configured operational SLO. A terminal record requires explicit diagnosis; no destructive automatic requeue/reset is introduced.

## Acknowledgement and callers

`RuntimeEnvelope.materialization` additively exposes `signalPersisted`, `canonicalSignalId`, `canonicalSignalKey`, `materializationState`, `materializationComplete` and duplicate information. Existing receipt fields remain. `receipt.accepted` describes factual ingress acceptance, not proof of materialization. Duplicate and materialized are independent. A rejected input has no persisted lifecycle to acknowledge.

Camera 14E now checks canonical materialization state=materialized, not merely signal existence or a partial subset of artifacts. Legacy/unverified and pending/failed remain unacknowledged. Functional test proves Camera accepted transition → persisted signal with injected completion failure → no Camera ack → Core reconciler repairs → subsequent Camera retry acks → factual signal count unchanged. No Camera observation/interpreter/transition/privacy/read semantic change.

Caller inventory: platformGapService Facility/ambient producers, officeMaterialEventAdapter/Office export, camera canonical event helpers, Camera transition delivery, and realtime/Core entry paths. Most producers ignore the optional return or preserve never-throw ingress behavior; Camera is the explicit durable acknowledgement consumer. Device/automation/visitor/maintenance/security/infrastructure producers through shared Core retain their factual signal contracts and regression coverage. No producer is forced to await the background reconciler. Old recordSignal/recordBundle methods are deprecated compatibility definitions with no live accepted-ingress caller; they are not recovery paths.

## External effects

Canonical tables and existing delivery-outbox row creation are TRANSACTIONAL_MATERIALIZATION. Runtime subscription publication/audit hooks are NOT_PART_OF_MATERIALIZATION: only the initial successful registration path invokes them. Their in-memory dedup is not durable exactly-once. Recovery never republishes automation/notification callbacks. A crash between registration and these callbacks may omit external effects; this task does not promise external delivery. Existing operational_delivery_outbox processing semantics were not redesigned into a new generic queue. Physical command execution is untouched.

## Validation

Real local PostgreSQL suite uses newly named disposable databases only and actual repository base schema + new migration. Coverage: atomic registration/rejection, duplicate registration, legacy NULL behavior, service-only ACL/invoker, bounded concurrent claims, lease expiry/fencing, stale completion, completion rollback after incident/awareness/recommendation/insight/plan/delivery/bookkeeping, duplicate completion, stable artifact counts, preservation of dismissed/resolved/acknowledged states, evidence dedup, older-signal non-regression, transient retry/backoff and 1/10/50/100 pending sets. Actual compiled Core prepares a bundle, calls real SQL through a Supabase-shaped test transport, suffers resolved `{error}`, then recovers and returns complete on duplicate.

Performance proof: each 1/10/50/100 set uses one bounded claim query, then one completion RPC per claimed signal (necessary separate atomic transactions), no per-artifact network persistence or discovery/history N+1. Fixture population uses individual setup calls and is not a production throughput benchmark. No production load/latency SLO is claimed.

Regressions run: typecheck, build, canonical ingress, awareness V3, evidence presentation, Slice1 privacy, Slice1B, security adversarial, Camera14A/B/C/D/E/F, Wave5 Facility Automation physical authority, Slice11 visitor/maintenance transition safety, Slice13 device current state. Passing process exits observed. 14E harness now understands the new lifecycle RPCs; it is not substituted for real PostgreSQL proof. No environment-only failure was needed to excuse this battery. No hardware/frontend suites required for this Core-only change.

## Rollout / compatibility

1. Review schema/grants and apply additive migration before new Backend. New RPCs/column are dependencies; no non-durable fallback.
2. Deploy Backend registration/completion support with recovery disabled until lifecycle writes are checked.
3. Verify accepted signal has immutable prepared obligation, initial completion/errors are truthful, and RPCs reject clients.
4. Enable bounded recovery and monitor pending/terminal/oldest age.
5. Verify Camera pending transitions progress only after materialized acknowledgement.
6. Only then claim durability active for new accepted signals.

Old Backend is schema-compatible but creates NULL legacy obligations and retains old independent writes. A mixed fleet is not fully durable. Existing incomplete legacy signals and corresponding Camera obligations need separately authorized reconciliation; they are not silently upgraded/replayed. Rollback disables recovery/new ingestion code but retains prepared obligations/schema; never drop processing JSON to clear a backlog. No migration was deployed in this task.

## Scope and verdict

Files: new migration, `materialization.ts`, Core receive integration, bounded worker/startup, Camera acknowledgement, SQL suite, materialization RPC fixture, updated 14E functional test, package test entry, deprecated legacy method comments, and this report. No Edge changes; no awareness scoring/current-read, Camera/Edge authority, device authority or physical executor edits.

Final A closes the new-signal canonical persistence/materialization obligation locally, within the tested transactional/idempotent guarantees. Production activation still requires rollout and enabled recovery; legacy incomplete rows are explicitly not repaired by this slice. Broader incident concurrency remains Final B. No push/deploy and no Final B implementation.
