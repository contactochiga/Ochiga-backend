# IQ-11F: preparation before exact-hash approval

Scope: synthetic Gemini compatibility experiment only. No inference dispatched by
this repair; no runtime/Core changes, new provider, billing changes or ledger reset.
Starting local/remote HEAD: `335d531dc90d2d4610096afb460dee1fa836c7c4`.
Existing dirty files and historical evidence are preserved. No commit/push is
required by this workflow-repair request.

## Why the prior approval expired

The prior packet and proposed approval clock both started at
2026-10-16T16:36:04.795Z and expired at 16:41:04.795Z. The saved preparation
report says only 238 seconds remained after its checks: approximately 62 seconds
of the window had already been used before handoff. Those checks included the
354 offline tests, contract/secret checks, preservation checks, typecheck and
diff check. There is no per-check timing record for that prior run; attributing
exact durations to individual tests or browser operations would be speculation.

At 16:39:53.322Z the subsequent attempt had checked expiry, hashes, credential
availability and ledger absence, leaving about 71 seconds. Conversation context
compaction then intervened. At 16:41:04.790Z only 5 milliseconds remained; the
16:41:10.930Z check confirmed expiry and no durable reservation. No inference
was sent. The record does not demonstrate that Google read-only checks consumed
the final 71 seconds. Human handoff, tool/context overhead and starting the clock
before preparation finished were the demonstrated workflow problem.

There are TWO existing five-minute guards: approval validity and packet `now`
freshness. Both remain. The entity/fact expiries also remain enforced. Moving
only the approval timestamp would be insufficient and would not authorize an
expired packet. No timestamp is refreshed after authorization.

## Stage A — preparation, before asking for approval

1. Verify branch/HEAD and preserve unrelated work and previous packets.
2. Review synthetic contents, canonical schema, transport and exception limits.
3. Run offline gateway/security/expiry/duplicate/uncertain-receipt tests, static
   checks and secret scans. Keep generated historical reports unchanged.
4. Verify read-only Google billing/quota navigation is available. Establish the
   owner-controlled full-key-to-project binding securely; a key presence check or
   self-hash is NOT that proof. Never persist the key or its in-memory digest.
5. Prepare the final operator dispatch invocation and evidence fields in advance.
   No tests, code review, package installation or transport construction belongs
   in the final dispatch turn.
6. Only at the end, refresh the fictional packet, pin its hashes, and seal its
   exact serialized request bytes with `sealPreparedCanary`. Record the review
   and source hashes. Run the fast binding checks and publish the hash promptly.
   Sealing is neither approval nor reservation. It cannot send a network request.

The packet still expires five minutes after its frozen `now`. If owner turnaround
exceeds that deadline, stop; a new preparation and exact-hash approval are needed.
No new approval may extend packet freshness. This repair reduces avoidable delay;
it cannot guarantee human turnaround or Google UI availability within five minutes.

## Stage B — final dispatch checks only, after explicit approval

Trusted operator inputs: sealed bundle, explicit exact-hash owner authorization
with its genuine timestamp, fresh Google evidence, current credential binding,
unchanged deterministic baseline and governance locks. Do not backdate approval,
claim old Google evidence was just observed, or synthesize a positive key match.

Use `verified_at_ms` for the actual owner authorization time (not packet-build
time). Set expiry to the earlier of authorization + 300,000 ms and the sealed
packet deadline. Preserve all risk acceptances in the existing approval contract.
No helper in this change creates an owner authorization or activates live fetch.

`dispatchPreparedCanary` performs these final checks:

- Exact packet/body/schema hashes and saved byte string; reviewed source fingerprint.
- Approval ID/project/model, explicit owner evidence, five-minute validity, packet
  and fact freshness. Delayed verification cannot renew these clocks.
- Credential matches the current verified project-bound credential in memory;
  full-key/project evidence is required, not merely a locally computed digest.
- Read-only billing/quota evidence observed after authorization, current within
  five minutes: Free tier, no linked billing account, billing disabled, positive
  model-specific quota headroom. Google's dashboard lag remains an external
  limitation, not a locally reserved quota or an independently proved bill.
- Both ordinary and compatibility request ledgers unused. Any existing journal,
  incomplete receipt, dangling symlink or unreadable state blocks; never reset.

Then it calls the existing reviewed compatibility transport with `wireBody`.
Canonical recomputation verifies equality only; transmission uses the sealed
bytes, without refreshing the packet, schema, instructions or timestamps.
The existing exclusive durable reservation and immediate pre-send expiry check
remain the final safeguards. Concurrent requests still compete for one slot.

No ambient fetch is enabled. A separately approved live invocation must inject
the reviewed fetch transport explicitly. The module never reads credentials from
the environment and never writes approval secrets. Failures before reservation
do not consume the slot; any reservation/uncertain completion prevents reuse.

## Unchanged limits and boundaries

Project `gen-lang-client-0414833380`; model `gemini-3.1-flash-lite`; fixed experiment
and approval identifiers. Zero authorized paid expenditure. Output plus thinking
cap 1,024; three-second transport deadline; 65,536-byte response bound; one attempt;
no retries, fallback, tools or execution callbacks. Five-minute approval AND
packet freshness. Input qualification gate 4,096 remains UNRESOLVED. Compatibility
success never counts toward intelligence certification. OpenAI authorization is
unaffected. Google billing enforcement, quota reporting and remote cancellation
remain external dependencies; a local timeout cannot prove remote cancellation.

## Verification

107 compatibility/workflow checks, 65 shadow checks, 89 gateway checks, 25 inherited
IQ-11F checks and 91 inherited IQ-11E checks: **377 PASS / 0 FAIL**. The 23 added
checks cover exact-byte reuse, preparation without authority/reservation, expiry,
extended/early approvals, delayed verification, stale/future billing proof,
linked billing, exhausted/unknown quota, changed credentials/project/body/context,
changed code, raised packet expiry, late owner approval, duplicate attempts,
uncertain receipt preservation and direct transport byte mismatch. Existing tests
continue to cover timeout/late completion and concurrent reservation.

Fresh run timings: compatibility 4,059 ms, shadow 3,753 ms, gateway plus inherited
4,331 ms (offline mocks, not provider latency). Adapter typecheck, JavaScript
syntax and diff checks passed. See the separate sanitized workflow evidence for
secret scan and final packet binding checks. No inference, token-count or model
API calls; all test provider calls were mocks and real reservation remained absent.

## Final preparation follow-up

The owner subsequently requested review, commit and push before a fresh sealing.
The complete 377 checks were rerun successfully; sanitized results and current
read-only project observations are in
`artifacts/intelligence-quality-v1-iq11f-gemini-workflow-release-review.json`.
This does not renew any historical authorization. The workflow commit preserves
the previous sealed packet as expired historical preparation. A fresh explicitly
requested packet is sealed only after release review and push; its final hash
and deadline are separate, and require new owner approval plus fresh final checks.
No automated renewal or inference is part of either preparation step.
