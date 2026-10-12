# IQ-10F capture-integrity findings (no replay or repair)

Runtime remains `46efdbbae5ad3090c389cf9ddc799f15e00e68e3`.
The preflight passed before authoring and again before every worker run. The
first-contact files and their hashes are immutable. No record has been backfilled.

## Proven durable trace loss

Facility scored companion `IQ10F-FACILITY-F09`:

- Request ID `4b698c6b-1bc2-45c7-9433-0fa846f205ad`.
- Thread `23bb3dfe-afe3-4ad2-b6ae-e2406987cdfd`.
- Receipt trace ID `c599f990-83b1-48d8-a3c7-a3cae3e989b1`.
- Conversation save is true, and both exact-request message rows exist.
- Receipt reports `failed / trace_write_failed`.
- Initial query and later read-only exact-ID reconciliation found no trace row.
- The structural log records the failure at 2026-10-11T09:33:52.554Z.

The recorder's existing bounded retry uses the same UUID. Its safe error
projection does not retain the original transport/database cause. Inspected
local Postgres/PostgREST logs supplied no matching cause. Thus loss is proven;
socket outage, schema defect or database rejection is NOT established. Passing
schema preflight and later reliability tests do not retroactively repair it.

## Two ownership rejections: distinguish capture gap from missing writes

`CONSUMER-J10-T07` and `CONSUMER-P25` deliberately change to Resident B while
referencing Resident A's thread. Both throw `conversation_access_denied` before
conversation admission. No message pair is saved; that is the correct ownership
boundary, not a failed attempt to save an authorized turn.

The unchanged orchestrator has a finally trace writer even for exceptions, but
only attaches its receipt when a response object exists. The harness therefore
did not receive either rejection's trace UUID. Its per-process HMAC key was
ephemeral and not retained. These traces are **uncorrelated**, not proven absent.
The audit JSON's empty `reconciled_trace` array for these two cases represents
no exact-ID query being possible, not a database proof of zero rows. This note
corrects that interpretation without rewriting the immutable capture/audit.
Do not correlate by answer text or guess a trace using only timestamps.

This is an evidence-capture limitation distinct from the Facility failed write.
Any future certification harness needs an approved canonical error-correlation
capture path before another run. That is a recommendation, not an implementation
or permission to replay this corpus.

## Counts

All four captures: 1,285 attempted calls = 520 scored + 765 setup. 1,283 returned
answers were saved with 2,566 exact message rows. 1,282 returned turns have
durable trace correlation. Two ownership rejections have no response/message
pair and no captured trace correlation. One returned, saved Facility turn has
a proven failed trace write. No duplicate persistence receipt or physical-device
executor attempt was recorded.

Scored only: 520 attempted; 518 returned/saved; 517 trace-correlated; two
ownership rejections; one proven trace loss. No case is silently removed from
the denominator. Quality grading can remain diagnostic but cannot override
the frozen integrity gate.

## Decision consequence

IQ-10F certification integrity is BLOCKED. Scores, if independently completed,
are diagnostic observations from the preserved run, not a valid certification.
Do not manufacture a zero-P0 finding before all safety reviews are complete.
Infrastructure repairs require separate authorization. This corpus is now
exposed and may not be rerun as a new independent first-contact evaluation.
