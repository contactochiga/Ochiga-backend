# IQ-11F Gemini live runner readiness

Starting local/remote HEAD: `52c543268cd131379c82ff5f853eef4176c64152`.
Branch: `codex/intelligence-quality-v1`. No inference authorized by this implementation task.

## Scope and implementation

`scripts/iq11f-gateway/gemini-live-runner.mjs` is an isolated owner-operated
experiment entry point, not a production interpreter, new gateway or authority
engine. It reuses the existing signed owner authorization, canonical serializer,
execution-window issuance, compatibility transport and fixed durable receipt ledger.
No existing Core, provider adapter, schema, consent or limits were changed.

Preparation verifies the owner signature against the registered public key,
expiry, frozen constraints and unused allowance. It performs a full local key
comparison using the established macOS masked-dialog mechanism, then collects
fresh project-specific read-only Google observations from the owner. The result
is an opaque in-process handle. Credential identity, owner consent and observation
hashes are bound in memory; neither key nor credential digest is persisted.

The interactive `execute` mode requires a further explicit terminal confirmation.
It revalidates the signature, constraints and evidence, exclusively creates the
existing five-minute execution authorization, loads that exact request, and
supplies a fixed-endpoint HTTPS wrapper to the existing transport. The wrapper
permits one POST, exact serialized bytes, exact credential header, abort signal
and redirect rejection. There are no caller-selected endpoints, tools, callbacks,
retries or fallback. Duplicate handles and concurrent windows fail closed.

The existing transport reserves the fixed journal before the request. Timeout,
network failure, malformed response and uncertain receipt consume that attempt.
No code deletes reservations or renews execution windows. A process restart
requires fresh preparation; an existing window or reservation blocks this runner,
even if no inference was ultimately dispatched. Manual review is then required,
not automatic recovery or reset.

## Verification boundary — not automatic Google administration

The masked dialog proves whole-key equality with the owner-entered reference.
The reference's project association remains owner-attested from Google UI. It
does not independently call IAM or establish project membership from a key suffix.

The existing authorization contract accepts trusted operator evidence. The new
CLI fixes the observer to explicit owner-entered observations of Google AI Studio
and the project-specific Cloud Billing page. This is labelled
`owner_read_only_google_ui_observation`, not machine-verified Google state.
Tests inject trusted mock observers; arbitrary hostile JavaScript inside the
process is outside the existing local-code trust boundary. Environment flags,
serialized prepared handles and unsigned approval flags cannot unlock the CLI.

If project, billing or current remaining quota cannot be observed, answer UNKNOWN
and stop. Do not translate model-list success, quota ceilings, delayed peak usage,
historical reports or another project's billing banner into verified availability.
If fully automated Google verification is required, a separately reviewed read-only
administration integration and authorized access remain necessary. None was
invented or provisioned here.

## Current external observations

On 2026-10-16 the Google AI Studio rate-limit page selected
`gen-lang-client-0414833380` / Oyi Intelligence Development and displayed Free tier.
Gemini 3.1 Flash Lite displayed peak/limit values of **0/15 RPM**, **0/250K TPM**,
and **0/500 RPD**. The page explicitly warns that usage can lag by 15 minutes and
describes the table as peak usage over 28 days. These are model limit observations,
**not proof of instantaneous remaining quota**.

The exact-project Cloud Billing linked-account page remained at its loading shell;
no authoritative no-linked-account result was obtained. An account-wide prepay
warning is not treated as the approved project's billing association.

Sources (read-only UI, no inference or token-count request):

- https://aistudio.google.com/rate-limit?timeRange=last-28-days&project=gen-lang-client-0414833380
- https://console.cloud.google.com/billing/linkedaccount?project=gen-lang-client-0414833380

The current environment credential passed an owner-controlled full-key comparison
in the local masked dialog during this task. Only match/no-match left the dialog
process; the reference's project association is owner-attested. No credential or
credential hash was persisted. This observation is not a reusable execution proof.

The real signed manifest validates with the enrolled key. Its signing-message hash
is `ce1886088a35a2059e5d599328ea7891a81de6fc2963bd52114fab78385b9d47`;
expiry is `2026-10-23T18:06:32.385Z`. No execution window or inference receipt
has been created. The current credential comparison result is recorded separately
in the sanitized readiness artifact; a prior match cannot be reused as fresh proof.

## Unchanged restrictions

- Project `gen-lang-client-0414833380`, model `gemini-3.1-flash-lite` only.
- One fictional offline-light scenario and existing canonical schema only.
- $0 authorized paid expenditure; Google's billing/quota enforcement remains external.
- 1,024 combined output/thinking-token cap; 3,000 ms deadline; 64 KiB response bound.
- 4,096-input-token qualification gate remains **UNRESOLVED**. Compatibility is
  not intelligence qualification or evidence of complete input accounting.
- No tools, grounding, execution callbacks, customer information, production
  interpretation, Anthropic/Gemini fallback or change to separate OpenAI approval.

## Validation

37 new mock runner checks pass: missing verification, wrong project/model, billing
and quota uncertainty, expired/invalid consent, duplicate/concurrent execution,
delayed evidence, revocation, scenario drift, timeout, malformed response,
unexpected model version, absent/over-cap token usage, receipt failure and
noninteractive/serialized-handle dispatch attempts.

All existing IQ-11E/F suites were run in a temporary copy so their report writers
could not overwrite frozen evidence. Results: IQ-11E 91/91; IQ-11F preparation
25/25; gateway 89/89; shadow 65/65; exception 107/107; authorization 64/64;
enrollment 23/23; manifest 20/21. The manifest failure is its pre-existing
`no-real-signing-artifacts-or-inference-reservations` assertion: it assumes the
owner has not yet created a signed manifest. The real signed manifest is preserved,
and that earlier uncommitted test is not silently rewritten or counted as passing.
Total including new runner: **521 PASS / 1 pre-existing lifecycle assertion FAIL**.

Syntax, repository TypeScript no-emit check and diff checks pass. No provider
request, real execution authorization, reservation, enrollment or real signature
was produced by tests. Prior uncommitted enrollment/signing work stays unstaged.

## Owner procedure (not run automatically)

Preparation-only command, in an owner terminal with the existing environment key:

```sh
node /Users/ochigaidoko/Documents/oyi-intelligence-quality/scripts/iq11f-gateway/gemini-live-runner.mjs preflight
```

This never creates a window or sends inference. Full verification must be repeated
in the same process immediately before any future separately approved execution;
the preparation handle cannot be exported/replayed. Do not use `execute` until the
remaining billing/quota evidence is established and the runner is approved.

**Current disposition: BLOCKED for live execution.** Obtain authoritative
no-linked-billing evidence and current model quota availability. Repeat the
successful local credential comparison in the future execution preflight.
Do not weaken the contract merely because Google UI exposes delayed metrics.
