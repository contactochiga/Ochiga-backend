# IQ-11F authorization amendment — implementation and validation

Starting local/remote HEAD: `63422a87a4662135b8578092bbc63d4fb3c89c91`.
Contract committed before code: `c11d5486c51c8ae1e8a026f5d70100bcd4276f92`.

## Architecture and status

The existing Gemini compatibility transport remains the only dispatch path.
Its canonical serializer moved unchanged to `gemini-request.mjs` to share it
with experiment authorization without a circular dependency. Existing imports
remain supported. No `src`/Core, gateway registry or production provider change.

`gemini-owner-authorization.mjs` verifies an Ed25519 owner signature against the
fixed reviewed trust file. Caller-supplied keys, boolean approvals, hashes of
alleged consent and self-signed untrusted approvals cannot authorize dispatch.
The signed owner claim binds the complete constraint digest, purpose, experiment,
owner key identity, unique authorization ID and owner-selected validity (at most
30 days). Its validity is separate from the five-minute execution window.

Constraints SHA-256:
`69f7db264ac0a83639abc5d5ef0322dc2d85158416eb543c5d8743f71c9d6a63`.
It binds the project/model, fictional offline-light scenario, canonical schema,
instructions/configuration via normalized serialized body hash, and all limits.
The normalized reference date is a comparison fixture, never a live dispatch.

**Owner trust is deliberately unenrolled.** The unsigned signing-request artifact
is a preparation template, not owner authorization. No real owner signing key,
authorization, execution window or inference reservation was created. Prior chat
approvals are not silently transformed into cryptographic signatures.

## Exactly permitted refresh fields

- `packet.now`: execution issuance time.
- `packet.entities[0].expires_at`: issuance + 30 minutes.
- `packet.entities[0].facts[0].expires_at`: same expiry.
- `packet.entities[0].facts[1].expires_at`: same expiry.

Everything else must equal the signed scenario. Schema, instructions, packet
identifiers, fact values/provenance, scopes and limits cannot change. Derived
packet/body hashes are recomputed, not independently edited.

## Future operator sequence — not executed here

1. Obtain separately approved owner public-key enrollment and a valid owner-signed
   manifest covering the complete reviewed constraints. Keep the private key out
   of Oyi, repository, provider requests and chat.
2. Complete all offline preparation before issuance. Securely reverify the actual
   credential/project binding and read current Free-tier/no-linked-billing/quota
   evidence. These are trusted operator observations, not claims the signature
   independently proves. Keep credential and digest in memory only.
3. `issueGeminiExecution(owner, verification, apiKey)` validates those observations,
   owner consent and both inference ledgers. It deterministically refreshes only
   the four timestamps and persists one exact packet/byte string and five-minute
   record in `artifacts/iq11f-gemini-execution-authorization/execution.json`.
   No network call occurs. Expiry is the earlier of issuance + 5 minutes and
   owner authorization expiry. Exclusive creation plus fsync prevents reissuance.
4. `loadGeminiExecution(verification, apiKey)` revalidates signature, exact bytes,
   limits, clock, allowance and fresh observations, then constructs the existing
   transport approval in memory. It never refreshes or renews the packet. After a
   process restart, it resumes the same durable window or rejects it if expired.
5. Pass the returned packet, wireBody and approval with baseline/locks/apiKey into
   the reviewed `runGeminiCompatibility`, with an explicitly approved transport.
   Ambient fetch remains disabled. Both initial admission and immediate pre-send
   admission require the owner/execution proof. Existing historical boolean-only
   compatibility admission cannot reach dispatch. The original exclusive
   inference journal still reserves before transmission; concurrent callers get
   at most one request. Receipt correlation now includes owner and execution
   authorization hashes without storing credential evidence or private keys.

Any existing/uncertain record blocks reissuance. No reset, renewal or delete API.
A failed issuance write remains consumed/uncertain, never automatically repaired.
An expired unused execution window requires a separate owner-reviewed recovery
decision; changing an authorization ID cannot reopen the fixed slot. A timeout
or uncertain inference consumes the existing one-request allowance permanently.

## Validation

**440 PASS / 0 FAIL**, all offline:

| Suite | Pass | Wall time |
| --- | ---: | ---: |
| New owner/execution amendment | 63 | 4,734 ms |
| Compatibility/approval workflow | 107 | 4,967 ms |
| Gemini shadow transport | 65 | 3,758 ms |
| Gateway | 89 | 4,043 ms including inherited suites |
| Inherited IQ-11F | 25 | Included above |
| Inherited IQ-11E | 91 | Included above |

New tests include signature/claims tampering, unknown signer, absent approval,
arbitrary-key injection, durable consent waiting one hour before window issuance,
permitted refresh only, changed schema/scenario/timestamps/hash/project/model/
caps, credential mismatch, billing/quota uncertainty, stale/future observations,
legacy flag bypass, expiry, repeated IDs, concurrent issuance/dispatch, existing
ordinary and compatibility reservations, uncertain storage, restart in a separate
Node process, receipt correlation, timeout/late completion and ambient-network
rejection. Mock keys are generated only within isolated test processes; no real
key or API credential is read by these suites. Tests redirect all authorization
and reservation writes outside the real worktree. Existing historical artifacts
are not regenerated in place.

Syntax, adapter typecheck, diff and secret checks passed. No inference or count
API calls. No real execution record or inference journal exists. No performance
claim about a live provider follows from these mock timings.

## Limitations and approval required

- Live issuance is blocked until the owner public key is separately enrolled and
  the owner signs the reviewed manifest. This task implements approval machinery,
  not permission to send the compatibility request.
- Trust-anchor, code and fixed local journal integrity are security prerequisites.
  This is not a distributed ledger or protection against an administrator editing
  trusted code, replacing trust files, deleting storage or copying the experiment
  to another host. No supported API performs those operations.
- Google billing/quota and credential ownership evidence still require authorized
  verification. Quota displays can lag; external billing enforcement and remote
  completion after a local timeout cannot be guaranteed by these local checks.
- Five-minute execution expiry cannot be automatically renewed. No recovery/reset
  workflow has been authorized or implemented.
- The 4,096-token qualification gate remains unresolved. The exception is only
  schema compatibility, not intelligence qualification. Preserve $0 paid spend,
  1,024 combined output/thinking, 3 seconds, 64 KiB, no tools/grounding, retries,
  fallback, callbacks, physical execution, production data or Core adoption.

Conclusion: amendment ready for owner review and trust enrollment approval. No
merge, deployment, production activation or autonomous Initiative work.
