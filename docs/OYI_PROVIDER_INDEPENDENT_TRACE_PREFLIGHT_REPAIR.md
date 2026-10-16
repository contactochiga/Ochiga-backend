# Provider-independent qualification — targeted trace preflight repair

2026-10-16. **Trace preflight repaired; independently authored provider-off
qualification may be prepared.** This is not intelligence certification or
production approval. Do not execute an independent corpus without its authorship,
fixture/rubric seal and a fresh successful preflight.

## Verified boundary and preservation

Starting local and live remote HEAD:
`1d10c992566169d48b30158df2cc681d27abf3eb`, branch
`codex/intelligence-quality-v1`, origin
`git@github.com:contactochiga/Ochiga-backend.git`.
Worktree: `/Users/ochigaidoko/Documents/oyi-intelligence-quality`.
The starting runtime source tree was
`18f722732807544ca459c4a984a5206a8251c470`, identical to IQ-11C commit
`2984e9205708ab0e4d109377ac6877b6b2ef7855`.

Pre-existing modified owner trust/tests and untracked enrollment, signing,
provider preparation and qualification documents remain untouched and unstaged.
The previous 31/32 run is preserved byte-for-byte inside the new evidence archive:
JSON SHA-256 `524f76f9000b76e16a6d14dd5c507a04ff09173d83a163e6807a7f4e7aec4637`;
attempt journal SHA-256 `f29445da9b0c7d06f0098e835917cc1833be5595e3dce64dfbbf4fd3f2dedd58`.
It remains a failed preflight. No historical grade or expected outcome changed.

The running Docker fixture is labeled `wave11-behavioural-fixture`; the existing
launcher verifies loopback port 55421 and exactly one `Wave 11 Test Estate`.
No worktree .env is permitted. Child environments receive only the local fixture
credential, not OpenAI, Anthropic or Gemini credentials. The existing setup
restricts fetch to loopback and traps device execution. Fixture hash before/after
both full runs: `50bcfde2183310157f2017d715edfd44e8ca78852a399d65ccbe2c6ee6b8c488`.
No schema, Docker configuration, billing, reservation or provider changes.

## Demonstrated cause versus historical uncertainty

The save-failure test injects a non-transient `23514` persistence failure. Core
honestly returns unsaved while the independent trace writer saves and verifies
its trace. Exact-ID reconciliation repeatedly observes this intentionally absent
message pair. Missing saves remain pending for bounded polling, so late durable
completion can still be discovered.

Two implementation defects were reproduced before modification:

1. A completed negative lookup was overwritten by a subsequent unavailable poll.
   The unavailable row begins with empty/default evidence fields. The merge loop
   preserved prior evidence only for `reconciliation_deadline`, not
   `lookup_unavailable`. A late poll hitting the deadline could therefore erase
   an earlier observed missing-save/verified-trace result.
2. A deadline-aborted query can return a flattened client error without a usable
   error name/code. The reconciliation reader classified that as `unknown`, even
   though its own AbortSignal had fired. The installed PostgREST client source
   confirms the error is flattened; the existing trace writer already checks its
   abort signal for this reason.

Controlled before-fix tests reproduced both exact failure shapes. A separate
outage-after-success control reproduced the overwrite without a timeout. Six
instrumented local save-failure requests passed before the correction, consistent
with intermittency; their per-query observations are retained. The baseline new
suite was 10 PASS / 4 FAIL: three failure-shape/retention assertions plus one new
failure-counter assertion. Four further controls were added, not relaxed.

**The original run did not capture its per-poll sequence.** Its exact 502 ms
lookup error cannot retrospectively be proven to be a particular abort, network
interruption or database error. Later successful inspection alone is not the
root-cause proof. The correction is justified by the demonstrated polling and
classification defects, not a claim that the original database was unavailable.

## Small correction in the existing owner

Only runtime file changed:
`src/oyi-core/observability/conversationTraceReconciliation.ts`.

- Use the reader's actual deadline signal to classify abort-related failures;
  never infer timeout from a private error message.
- Retain a **previously completed negative lookup** if a subsequent poll fails.
  Retention applies only to missing trace, uncertain delivery and missing save.
- Expose latest lookup error, last observed error, failure/attempt counts and the
  elapsed time of the last completed lookup. Retained evidence is an earlier
  observation, not a claim that the failed latest query succeeded.
- If no complete lookup exists, keep `lookup_unavailable`; never infer absence.
- A later complete lookup replaces the earlier observation normally.
- All retained negative classifications remain `ready=false`. Timeout, permission
  failure, incomplete query, wrong correlation and noncooperative clients cannot
  manufacture certification readiness.

No query, poll limit, deadline, concurrency, retry, save logic, trace-writer logic,
authority check or success-class whitelist was weakened. No additional queries
were added. Metadata is structural only; no raw errors, content or credentials.
No interpreter, orchestration, gateway, evidence or action-governance changes.

## Verification

| Check | Observed result |
|---|---:|
| New regression/diagnostic controls | **18/18 PASS** |
| Unchanged IQ-11C full run 1 | **32/32 PASS; preflight ready** |
| Unchanged IQ-11C full run 2, fresh request IDs | **32/32 PASS; preflight ready** |
| IQ-10B persistence/reliability | **25/25 PASS** |
| IQ-11B structural safety/authority | **22/22 PASS** |
| IQ-11B base live safety | **22/22 PASS** |
| IQ-11B extended live safety (includes base) | **25/25 PASS** |
| Intelligence authority smoke | **22 checks PASS** |
| Programme-4 authority/privacy closure | **13 checks PASS** |
| IQ-10B trace contract | **10 projection checks + contract checks PASS** |
| IQ-10B trace export/privacy/live controls | **11/11 PASS** |
| Build / typecheck / new-script syntax / diff | **PASS** |

The new controls include initial outage versus previously observed absence,
deadline abort, partial query failure, correlation mismatch, late durable save,
recovery after outage, noncooperative clients, 20 concurrent deadline attempts,
privacy and six affected local save-failure cases. Each local affected case
independently reconciled zero messages and one verified trace, remaining blocked
as an intentionally failed save. No original request was replayed or backfilled.

Each full IQ-11C run journals 29 attempts and captures all 29 outcomes. It includes
correct ownership rejection, concurrent requests, duplicate deliveries, delayed
trace completion, lost acknowledgements, missing trace and multipart failure.
Each run has 26 attempt-associated durable pairs and 21 verified traces. The
mixed injected batch correctly remains **not ready**: 16 saved/correlated,
1 rejected/correlated, 1 late recovery, 4 missing traces, 4 uncertain trace
deliveries, 1 missing save, 1 unconfirmed save with durable pair, 1 invalid
multipart set. Passing preflight means these failures were correctly detected;
it does not call injected storage failures successful delivery.

### Genuine additional legacy failures, retained

Two extra smokes failed and were independently rerun with the starting
reconciliation module loaded in memory. No checkout or reset was used; all other
source files were unchanged. Both failures are identical on the starting code:

- `conversation-foundation-smoke`: 8 checks pass, then a source-regex assertion
  expects the obsolete `verifyCanonicalCurrentTurnPersistence(...)` call. The
  unchanged canonical persistence uses its atomic RPC contract. The assertion
  was not changed and the rest of that smoke did not execute.
- `oyi-core-convergence-smoke`: 16 pass, one fails at “lifecycle duplicate is
  rejected before side-effect publication” (`false !== true`). This remains a
  pre-existing lifecycle-control limitation; no broad One-Core certification is
  claimed or repaired here.

These are additional observed legacy results, not an excuse to hide failures.
The five earlier historical workflow exclusions remain separate and were not
rerun or repaired in this bounded slice. Multi-gang remains excluded from release
claims. No frozen 280, IQ-9B or IQ-10F corpus was executed in this repair.

## Evidence, performance and remaining limits

`artifacts/oyi-provider-independent-trace-preflight-repair.json` contains machine
results and a gzip/base64 archive of 15 original capture/journal/manifest files,
with per-file and uncompressed-bundle SHA-256 checks. Raw archived captures are
synthetic test evidence, not production data. Archive generation checks for
credential patterns before compression. The original failed run is unchanged.

The reader retains the same exact-ID reads and bounded polling; added work is
per-attempt counters and retained observation metadata. Full mixed-batch final
reconciliation elapsed 252 ms and 254 ms under its existing 250 ms deadline,
including local scheduling overhead. These are not production SLO measurements.

Supabase skill guidance kept validation on the isolated local fixture. Current
changelog was inspected; hosted TLS changes do not apply to this loopback HTTP
test. Abort handling was checked against the installed client implementation.
No production database changes or new SDK dependency.

Limitations: genuine outages can still block future preflight; no durable outbox
or exactly-once physical execution claim is added. Earlier negative observations
must be interpreted with their recorded time and latest lookup-error fields.
Original per-poll timing remains unknown. Fresh independent authorship, fixture
review, protocol/corpus freeze and a successful run-time preflight remain required.
Gemini remains on HOLD. Overall Oyi intelligence remains NOT CERTIFIED.

## Delivery

Commit only this repair's runtime file, three new scripts, this report and its
machine evidence. Existing qualification preparation and owner-authorization work
remain unstaged. Final commit and live remote equality are reported after push.

**OYI CORE TRACE PREFLIGHT REPAIRED — INDEPENDENT QUALIFICATION READY**
