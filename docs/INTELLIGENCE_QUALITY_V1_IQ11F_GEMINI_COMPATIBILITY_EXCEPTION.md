# IQ-11F single-request Gemini compatibility exception

Implementation starting HEAD: `861d8b45c84e80bfe155bd67b941d588a528ad56`.

## Status and ownership

This is an experimental, synthetic-only compatibility path, not production interpretation, a new gateway, or intelligence certification. No inference is dispatched by this change. Final owner approval is absent. The approved exception design permits preparing this path; it is not authority to run the packet.

The ordinary **4,096-input-token qualification gate remains unchanged and unresolved**. The previous 496/496 count-only results are preserved, not promoted into complete accounting evidence. Compatibility explicitly requires `full_request_verified: false`, `upper_bound: null`, and `qualification_gate: 4096`; claiming 496 as a verified upper bound is rejected.

## Exact binding

`artifacts/intelligence-quality-v1-iq11f-gemini-compatibility-canary.json` contains the refreshed fictional packet and exact hashes. `scripts/iq11f-gateway/gemini-compatibility-policy.mjs` pins its packet, generation body and canonical schema hashes. Caller-supplied replacement packets cannot be admitted merely by approving new hashes.

- Project: `gen-lang-client-0748205572`.
- Model: `gemini-3.1-flash-lite`.
- Expected response version: `3.1-flash-lite-05-2026`, previously observed catalog metadata, not an immutable model endpoint. A different response version fails validation.
- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent`.
- Experiment: `iq11f-gemini-schema-compatibility-001`.
- Approval ID: `IQ11F-GEMINI-COMPATIBILITY-001`.
- Exception: `UNVERIFIED_INPUT_ACCOUNTING_COMPATIBILITY_ONLY`.
- Canonical schema is unchanged. No tools, grounding, caching, files, streaming or business records.
- Request remains one candidate, `maxOutputTokens: 1024`, minimal thinking and `includeThoughts: false`.

The final approval must bind these identities and the exact manifest hashes, with a maximum five-minute validity window. Existing context freshness also requires packet time within five minutes of dispatch, and unexpired entities/facts. An expired packet must not be silently refreshed: review new hashes and obtain owner approval again. Refresh never resets the experiment ledger or grants a second attempt.

## Admission and final approval

`runGeminiCompatibility` reuses the ordinary experimental transport, normalization, canonical candidate validation, timeout, bounded response reader and durable receipt mechanism. A private shared execution function distinguishes the two admission paths. The normal path still requires genuine complete-input proof.

The compatibility approval requires all existing project/model/credential binding, ownership, billing, quota, synthetic review and data-processing attestations, plus:

- `compatibility_canary_approved: true` and `live_canary_approved: false`.
- Exact exception type, experiment ID, approval ID, hashes and safe owner-approval evidence hash.
- Explicit acceptance of unverified input for compatibility only, Google Free-tier processing, external billing enforcement and uncertain remote completion after cancellation.
- `counts_toward_certification: false`, `allow_retries: false`, one request, no tools/fallback, zero paid budget, output 1,024 and deadline 3,000 ms.

These are **trusted operator attestations**, not independent proof of human approval or Google's current account state. A caller who controls arbitrary JavaScript can fabricate attestations or supply arbitrary transport code; this is not a sandbox. No model output or conversation packet can grant approval. A future approved operator must independently verify the evidence before constructing the approval in memory. Never persist the credential or its digest in receipts.

There is no CLI, automatic environment-key lookup or ambient network path. Missing transport or direct ambient `globalThis.fetch` is blocked. An explicitly reviewed transport may be injected only after final owner approval; tests inject network-free mocks. No live adapter or production activation is enabled here.

## One attempt, deadlines and receipts

Compatibility uses a fixed ledger at `artifacts/iq11f-gemini-compatibility-receipts/gemini-canary.jsonl`; public callers cannot override its directory. Reservation uses exclusive creation and fsync before dispatch, with 0600 file/0700 directory permissions. Pending, failed, timed-out, malformed or successful receipts all consume the same slot. Do not delete or move it to retry. This enforces one attempt in the designated checkout; moving to another checkout/host is not an authorized new allowance and filesystem access is a trusted operator boundary.

Approval is rechecked immediately before sending. Three seconds covers transport and response reception, with abort and immutable late-result discard. Synchronous filesystem stalls cannot be forcibly interrupted; a pre-dispatch deadline check prevents starting after a stall. A local abort does not guarantee remote cancellation or refund.

Receipts contain exact correlation hashes, approval ID, experiment classification, safe status, reported usage and timing. No prompt, synthetic facts, provider payload, credential, raw error or reasoning is persisted in receipts. Reconciliation compares exact identifiers and refuses promotion into `valid_shadow`.

- Pending without a terminal record: uncertain completion, no replay.
- Failed initial reservation: no dispatch.
- Failed terminal write: no success claim or returned candidate; preserve slot for investigation.
- Response bound: 65,536 bytes.
- Provider errors: safe classifications; no retries or fallback.
- Missing/inconsistent input, candidate or thinking usage: `accounting_uncertain`, not success.
- Reported input above 4,096 or combined candidate/thinking output above 1,024: `token_bound_violation`.

The input exception waives only prior proof, not the ordinary qualification requirement or the reported-usage acceptance ceiling. Post-response detection cannot prevent prior consumption, and reported input below 4,096 does not establish full accounting.

## Results cannot control Core

A valid response is `compatible_unqualified`, never `valid_shadow`. Results and receipts always carry `input_accounting_verified: false` and `counts_toward_certification: false`. The public compatibility method returns no candidate even on success and accepts no execution callbacks. Authority, requested scope, cancellation, hazard and other canonical validation locks are preserved. The baseline is fingerprinted before asynchronous work and never modified. No Core/business service is invoked.

Success means only that this one response passed the existing schema/semantic validators and reported-usage checks. It is not complete token accounting, intelligence certification, physical execution, or authorization for another request. Existing strict validation can reject otherwise legitimate provider signatures/version changes; report that as compatibility evidence rather than loosening the contract during the run.

## External billing and data-processing evidence

Reviewed official sources on 2026-10-16:

- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing): the selected model's Free-tier standard input and output, including thinking, are free of charge.
- [Gemini terms](https://ai.google.dev/gemini-api/terms): applicable unpaid-service input/output may be used for improvement and human review; no zero-retention promise. Do not send personal, confidential or sensitive information.

Earlier owner-controlled full-key comparison and UI evidence associated the key with the approved Free-tier project. This implementation review did not independently refresh Google account billing/quota state. Before a live approval, reverify project association, no attached billing account, current model eligibility and available quota. Fail closed on unknown state. Never enable billing. The separate OpenAI $50 authorization is untouched.

Local code enforces fixed request content, one attempt, no optional paid tools/services, zero-budget attestations, response limits and rejection behavior. Google enforces actual pricing, quota, model-side token limits, processing/retention and remote cancellation. Local counters and deadlines cannot independently guarantee Google's billing behavior. Owner approval must explicitly acknowledge that dependency without granting paid expenditure.

## Tests and rollback

The new offline suite uses only fake credentials, virtual wall time and filesystem-redirection into temporary test ledgers; the real experiment slot remains unused. It covers approval/hash/scope changes, ordinary-gate preservation, no ambient dispatch, duplicate/concurrent attempts, uncertain receipts, safe provider errors, malformed/oversize responses, accounting uncertainty, safety locks and real three-second timeout/late completion.

Run the new suite plus the existing 270 offline checks. The evidence report records final counts and source hashes. No production runtime changes are necessary.

Rollback is default-disabled dispatch, preserving the consumed reservation and deterministic baseline. Do not erase receipts or replay uncertain requests. Data already received by Google cannot be recalled locally.
