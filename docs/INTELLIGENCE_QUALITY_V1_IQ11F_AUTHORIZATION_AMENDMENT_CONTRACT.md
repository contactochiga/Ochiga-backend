# IQ-11F authorization amendment — frozen before implementation

Baseline: `63422a87a4662135b8578092bbc63d4fb3c89c91`, branch
`codex/intelligence-quality-v1`. Local and remote agree. Four pre-existing
untracked evidence files remain out of scope and must remain byte-identical.

## Problem and separation

Human approval currently binds a timestamp-bearing packet already subject to a
five-minute freshness window. Preparation and human response consume that same
window. Rebuilding the packet changes its hash and invalidates approval. Operator
booleans and an approval-evidence hash are attestations, not independently
verifiable proof of owner consent.

A. Durable owner authorization is a signed, purpose-bound statement authorizing
one execution-window issuance for one fictional experiment. It does not expire
after five minutes: the owner supplies explicit issue/expiry dates (maximum 30
days). It never authorizes arbitrary requests or production adoption.

B. After that authorization is verified and all fresh execution checks pass,
issue exactly one durable five-minute execution record immediately before a
future dispatch. Bind exact reconstructed bytes, schema, constraints, owner
authorization digest and times. Human approval is not required again for the
permitted timestamp refresh. Expired execution records cannot be renewed.

## Owner trust and scope

Use Ed25519 verification against a fixed, separately reviewed owner public-key
trust file. No key or trust-anchor override via environment, call arguments,
approval JSON or model output. No signing key is generated/enrolled for the real
owner by this implementation. Mock test keys are ephemeral and test-only.
Until the owner public key is enrolled through a separately approved change and
the owner signs the exact manifest, real issuance is blocked. Repository code
and trust-anchor integrity remain the deployment trust boundary; this is not a
sandbox against an administrator replacing executable code or deleting storage.

Signed claims use a versioned, closed-field canonical encoding and bind owner
key identity, unique authorization ID, issue/expiry dates, approval ID
`IQ11F-GEMINI-COMPATIBILITY-001` and the complete frozen experiment-constraint
digest. Reject malformed signatures, unknown fields, mismatched keys, wrong
purpose, missing approval, future issue dates, expiry and tampering. A caller
cannot manufacture approval with boolean flags or a self-generated public key.

Frozen constraints include project `gen-lang-client-0414833380`, provider Gemini,
model `gemini-3.1-flash-lite`, expected response model version, the complete
fictional offline-light packet apart from the listed timestamps, instructions,
schema, generation configuration, endpoint semantics and all safety limits.
Schema SHA-256 must remain
`45bef064beadba0002b060d36b681eab0a8e6c14ccd174ec98d62e37730cb3e3`.

## Exact refresh allowance

Only `packet.now`, `packet.entities[0].expires_at`, and
`packet.entities[0].facts[0].expires_at` / `facts[1].expires_at` may refresh.
`now` equals execution issuance time. Each expiry equals that time + 30 minutes,
matching the existing fictional fact lifetime. No changes to entity counts,
identifiers, scope, utterance, facts, provenance, instructions, schema or limits.
Derived packet/body hashes are reconstructed deterministically, not editable
semantic fields. Any other change requires new reviewed constraints and owner
approval. Normal qualification remains unresolved; the exception cannot mint
input-accounting proof or certification credit.

## Issuance, dispatch and durable state

Fresh credential/project proof and current Free-tier, no-linked-billing and
model quota evidence are required before issuance and rechecked at dispatch.
Credential or credential digest must not be persisted. Read-only operator
evidence remains trusted observation, explicitly distinct from signed owner
consent. Google reporting lag/external billing enforcement remain limitations.

An exclusive fixed execution-record file (`wx`, fsync, restrictive permissions)
prevents repeated or concurrent window issuance, even after process restart or
expiry. It is separate from, and cannot replace/reset, the existing ONE durable
inference reservation. Persist the owner signature and exact synthetic packet
with the execution record so a restarted process verifies the same window and
bytes. No renewal API or ledger deletion/reset operation is supplied. An expired
or damaged execution record blocks; recovery needs separate owner review, not
an operator retry or automatic second authorization.

All compatibility dispatch entry points must require the new verified owner and
execution record. Legacy flags/evidence hashes alone cannot reach even an
explicitly injected transport. Keep old evidence and old admission-unit tests;
update transport fixtures to provide mock signed authorization, never a live
bypass. Preserve the existing fixed inference reservation, final pre-send expiry
check, deadline, immutable late-result behavior and safe durable receipts.

Fresh checks failing before issuance create no authorization window. Any issued
window cannot be reissued. Once inference is reserved, timeout/error/uncertainty
consumes the one attempt. No retry, fallback, tools, grounding, device execution,
execution callbacks, business/customer data, production activation or Core
adoption. Preserve $0 authorized spend, 1,024 combined output/thinking cap,
3-second deadline, 65,536-byte response bound and unresolved 4,096-input gate.

## Frozen validation gates

All new offline checks must pass with zero live provider calls: expired execution,
repeated/concurrent issuance and dispatch, changed hashes/timestamps/scenario/
schema/project/model/limits, credential mismatch, unknown billing/quota,
existing/uncertain inference reservation, process restart, tampered/unsigned/
self-signed owner authorization, automatic renewal and unauthorized network
dispatch. Include positive signed mock controls. Network is replaced by throwing
or controlled mocks; all storage redirected to isolated temporary directories.

Run all inherited IQ-11E/F gateway, adapter, compatibility and exception tests,
syntax/type/diff/secret checks. No canonical Core code or frozen certification
artifacts change. No inference, merge, deployment or production configuration.
Completion means amendment implementation ready for owner approval, NOT owner
authorization issued, live transport qualified or intelligence certified.
