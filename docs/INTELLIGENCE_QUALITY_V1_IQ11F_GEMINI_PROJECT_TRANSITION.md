# IQ-11F Gemini development project transition

Observed 16 October 2026. Starting HEAD: `0324cc6c87d744add1a005362d8e28eeb6d6ff0c`.

## Current development target

Oyi Intelligence Development: `gen-lang-client-0414833380`.
The experimental transport's project allowlist now targets this project, retaining
`gemini-3.1-flash-lite`, its existing response-version check and every limit.
This is a target configuration change, not a live approval or a credential change.

Google AI Studio shows Free tier. Google Cloud's linked-account page for this
exact project says it has no billing account. No billing was linked or enabled.
Paid-tier eligibility was not evaluated and is not authorized by this task.

The selected project's Gemini 3.1 Flash Lite quota view shows 15 RPM, 250,000
TPM and 500 RPD, with displayed peak usage zero. The dashboard warns that usage
can lag by 15 minutes: this is observed headroom, not a reservation or guarantee.

## Credential and model evidence

The environment credential is available. One authenticated, read-only models
GET returned HTTP 200 and Flash model metadata, including the unchanged selected
model. No count, generate, batch, cache, live-audio or inference request was made.
Model listing does not establish the credential's project or model-specific quota.

Google Cloud lists one available Gemini-restricted key under the new project.
Browser inspection did not reveal or copy its value. AI Studio's
all-project key-list attempt reported permission denied; Cloud metadata was
accessible separately. Metadata alone does not prove full-key equality.

**Owner-controlled full-key comparison succeeded.** The owner entered the existing
key from this project in the previously approved local macOS masked dialog.
The dialog process compared the entire input with its inherited GEMINI_API_KEY,
in memory, and returned only FULL_KEY_MATCH. No key, key digest, raw input or
clipboard content was logged or persisted. No network request was made for the
comparison. The project selection was owner-attested and corroborated by the
read-only project/key metadata; this is not an administrative key-lookup proof.
The sanitized result is in the separate new-project-key-verification artifact;
the earlier project's comparison evidence is unchanged.

## Approval and historical preservation

`artifacts/intelligence-quality-v1-iq11f-gemini-development-approval.json` is the
new current disabled approval template. Ownership verification records the local
comparison, with a hash of that sanitized evidence (not of either credential).
Both live approval flags remain false, the credential digest and request hashes
remain null, and no validity window is issued. UI billing/quota observations are
recorded separately from an executable short-lived approval. Billing and model
quota were re-observed during this verification; their dashboard lag still applies.

Old-project results, count experiments, key-comparison evidence, approval drafts,
and the existing expired packet/hash binding are preserved as historical or
pending prior work. They are not relabeled as evidence for the new project.
An old-project approval fails the transport's project check. The original fixed
compatibility ledger path and single-attempt allowance are unchanged; changing
projects never creates another attempt.

The 4,096-input-token qualification gate remains unresolved. The 496-token
measurement is not full accounting proof. Output including thinking stays capped
at 1,024, deadline at three seconds, response at 65,536 bytes, Gemini paid budget
at $0, with no retry, fallback, tools or execution callback. OpenAI's separate
$50 ceiling is unaffected. No gateway, schema or One-Core governance is replaced.

## Validation and next step

354 offline checks passed: 84 compatibility, 65 shadow, 89 gateway, 25 inherited
IQ-11F and 91 IQ-11E. Adapter typecheck, syntax and diff checks passed. Three new
controls prove the current target, rejection of historical-project approvals,
and no dispatch from the disabled template even after project verification.

Next: refresh the expired synthetic packet, recheck billing/quota, bind the exact
credential in memory and obtain final exact-hash authorization with the existing
short validity window. Until then: no inference and no request reservation.
The prior uncommitted packet refresh and its policy hashes remain untouched and
are not included in this project-transition commit. Tests are also run against a
temporary source snapshot using the committed packet/hash pair before delivery.
