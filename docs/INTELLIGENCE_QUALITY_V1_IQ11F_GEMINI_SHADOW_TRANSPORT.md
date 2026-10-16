# IQ-11F Gemini shadow transport — offline implementation, live blocked

Date: 2026-10-16. Starting local and remote HEAD: `ecc53e7cb4a62507e41899a7913d4aa0e387e63e`, branch `codex/intelligence-quality-v1`, origin `git@github.com:contactochiga/Ochiga-backend.git`.

The existing untracked `intelligence-quality-v1-iq11f-gemini-connection-canary.json` is preserved unchanged. No Core runtime, provider configuration, credentials, billing, historical preparation artifacts, certification evidence or other repositories are changed. This is not independent intelligence certification.

## Verified access versus unproven ownership

`GEMINI_API_KEY` is present. A read-only authenticated GET of `v1beta/models/gemini-3.1-flash-lite` returned HTTP 200 with:

- name: `models/gemini-3.1-flash-lite`;
- version: `3.1-flash-lite-05-2026`;
- input/output model limits: 1,048,576 / 65,536;
- methods: generateContent, countTokens, createCachedContent, batchGenerateContent.

Only generateContent is implemented in this transport. The metadata call generated no model output. Authentication and model visibility do **not** establish project ownership, project quota, free inference eligibility or server schema acceptance.

The previous read-only AI Studio inspection displayed project `gen-lang-client-0748205572` as Free tier, with Flash-Lite 3.1 limits 15 RPM, 250,000 input TPM and 500 RPD. Those are observations about the displayed project, not proof that this environment key belongs to it. No exact key/project binding has been obtained. No new billing assertion is made here.

Google's documented [keys.lookupKey](https://docs.cloud.google.com/api-keys/docs/reference/rest/v2/keys/lookupKey) returns the parent project number and key resource, but requires authorized OAuth access and `apikeys.keys.lookup`. No Google OAuth token or application-credentials configuration is available in this execution environment. The API key itself is not that IAM authorization. We did not reveal a key in the browser or place it in a lookup URL. No ownership lookup was attempted with invented credentials.

**Live inference remains blocked.** The selected *provisional transport profile* is `gemini-3.1-flash-lite` with the catalog version above. It is not a claim of verified approved-project access or an immutable snapshot endpoint.

## Reuse and isolation

`scripts/iq11f-gateway/gemini-shadow.mjs` adds a transport beside the existing gateway adapters. It uses the existing registry's Gemini adapter for serialization and normalization, the existing IQ-11E packet and candidate validators, and the same schema derived from SemanticFrame/AnswerTarget. No second semantic contract, interpreter, capability registry, action engine or conversation store is introduced.

The offline simulator and all three existing adapters stay unchanged. There is no CLI, automatic execution, environment-key lookup or import from production `src`. The transport accepts an explicitly supplied key and trusted experiment approval, never provider-selected tools or routes. The default is blocked. The preflight-closure review additionally removed ambient fetch and rejects explicit selection of global fetch: caller approval flags alone cannot dispatch a live request. Only trusted injected test transport functions run now; these are arbitrary test code, not a sandbox against malicious JavaScript. A future approved runner must independently verify evidence before any explicit live wiring. No actual live approval manifest is created by this change. Anthropic and OpenAI are not called; OpenAI's separate $50 approval is unchanged.

Candidates are returned only for shadow grading and always carry `adopted: false` and `canonical_decision_changed: false`. A baseline hash is retained; there is no callback into Core execution. The canonical validator enforces scope references, cancellation, hazard and denial locks, but passing this validator does not prove the candidate semantically correct or confer authority. Core remains the owner of all execution decisions.

## Admission contract

An operator-generated preflight approval must establish, for the exact key, project, model and request:

1. Verified key ownership with evidence, bound to an in-memory credential digest. Never store the raw key.
2. Free tier, billing disabled, available free quota and zero input/output prices. A dashboard alert, visible free project or arbitrary empty permission array is insufficient.
3. Explicit one-canary approval, synthetic-content review, recipient/data-processing approval, and exact packet, wire-body and schema hashes.
4. A full-input token upper bound <=4,096 including system instructions, schema and framing, with independently reviewed evidence. Content-only counts or character estimates cannot satisfy this requirement.
5. Exact model/version, 1,024 output tokens, 3,000 ms deadline, one inference attempt, no tools and no fallback.
6. A preflight validity window of at most five minutes; nonexpired packet/entity facts; no credential embedded in the packet.

These are trusted preflight **inputs**, not claims that this module independently authenticates Google IAM or billing. Test approvals are explicitly synthetic mocks, not reusable live proofs. Changing these booleans by hand without verifying the evidence would violate this contract. There is no safe spending guarantee based only on an API key. If billing status could change during dispatch or the full input bound cannot be established, do not issue approval.

The [countTokens API](https://ai.google.dev/api/tokens) accepts a full generateContentRequest. Before a canary, separately qualify its coverage of this schema and all framing; do not assume a prompt-only count includes everything. No countTokens request was sent in this task. The canonical schema is not weakened to fit a guessed budget.

## Wire and accounting

- Fixed Google Developer API HTTPS endpoint, POST, API key only in `x-goog-api-key`, redirects rejected.
- Existing closed JSON candidate schema, one user packet, one system instruction, one candidate. No tools, file uploads, grounding, URL context, caching, streaming, SDK automatic continuation or repair calls.
- `thinkingLevel: minimal`, `includeThoughts: false`; minimal is **not** a promise of zero thinking.
- Google's [thinking documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en) describes the output maximum as including thought tokens. Normalize candidate + thought counts; require exact nonnegative usage and a consistent total. Missing thought counts remain unknown, never silently zero. Reject token overruns.
- Request-side input bound <=4,096; response-side input count checked against that proof. Combined output cap 1,024. Raw response stream <=64 KiB, candidate <=8 KiB; all canonical local restrictions remain mandatory.
- Exact response model version required. The existing strict adapter intentionally rejects unexpected parts, tools and thought-signature fields. Real server schema/response compatibility is still unqualified. A canary may expose an incompatibility; it must fail closed, not strip/repair unknown content or retry another API/model.
- Safe error classes only; never return/log raw provider error bodies, credentials, private content or reasoning. HTTP refusal, quota exhaustion, unavailable provider, incomplete output, malformed output and accounting uncertainty are not success.
- Zero price is an admission prerequisite, not inferred from observed token usage. Receipts explicitly mark billed cost **unverified**; a locally accepted response is not an invoice. No inference occurred, so this task incurred no inference charges.

## Deadline, duplicates and durable receipts

Use direct fetch with AbortController and one 3,000 ms deadline covering preparation, request and streamed body reception/normalization. Local synchronous filesystem operations cannot be interrupted like network I/O; elapsed checks prevent sending after an exhausted deadline. There is no retry, fallback or automatic continuation. Abort is not proof Google stopped processing a request. Late work cannot alter the returned result or journal.

Reuse IQ-11C's append + fsync journal discipline for **experiment request receipts**, not a production trace/conversation store. The protected run directory contains one exclusive `gemini-canary.jsonl`, created with mode 0600. The slot is reserved durably before dispatch; concurrent calls and process restarts cannot consume it again. Operators must not delete it or select another directory to retry uncertain completion. No real receipt directory was created during this task; tests use isolated temporary directories.

Records contain exact request ID/epoch, packet/body/baseline hashes, provider/model, timing, safe status and usage only. No packet text, aliases, key, full approval or raw response. Final reconciliation checks exact identifiers, not answer text. A pending-only/malformed journal is uncertain and blocks replay. A completed failure receipt is accounted for, not a successful shadow result. A final write/fsync failure returns `receipt_write_failed` and no candidate; it requires reconciliation, not a success assertion. A normal disk read is not a power-loss durability test.

This is one local canary, not distributed quota enforcement or a general experiment scheduler. Future multi-request qualification still requires IQ-11C environment preflight, attempt accounting and durable Core trace reconciliation; these offline transport tests do not establish live Core correlation.

## Offline validation and readiness

Run `node scripts/iq11f-gateway/gemini-shadow-tests.mjs`. The tests prohibit ambient network use, use fake credentials and mock preflight proofs, and cover all four surfaces, authority locks, freshness, zero-cost admission, token/schema/model validation, provider errors, bounded response size, durable reservation, exact-ID reconciliation, disk failure, concurrency, caller mutation and a real three-second timeout/late completion. No independent intelligence score is claimed.

Run the existing gateway suite with generated report/schema outputs redirected to temporary files so frozen evidence remains unchanged. It includes all 25 IQ-11F and 91 IQ-11E preparation checks. Existing production code and dependency files remain untouched.

Final offline result: **59/59 shadow transport, 89/89 gateway, 25/25 IQ-11F and 91/91 IQ-11E checks pass (264 total)**. JavaScript syntax checks and the existing adapter declaration typecheck pass. The first test run identified a receipt-directory error being misclassified as a duplicate reservation; the reservation error classification was corrected and the unchanged test passes. This is not a live-provider result. No full production build or live Core/database regression was needed or claimed for these scripts-only additions.

Remaining blockers before one controlled live request:

1. Prove this exact key belongs to `gen-lang-client-0748205572` through approved read-only Google project/key administration, without exposing the key.
2. Bind current free-tier/billing-disabled/quota evidence to that key and model; resolve the external billing-change risk.
3. Establish full wire-input token accounting, including schema overhead, within the unchanged 4,096 cap.
4. Approve the refreshed synthetic packet, data-processing policy and single canary explicitly. Server acceptance and response normalization will be measured by that canary, not presumed beforehand.

**Transport offline-tested; canary blocked. No inference, production activation, merge or deployment.**

## Preflight closure review — 2026-10-16

The four previously uncommitted transport files were recovered at the same local/remote starting SHA. The earlier connection-canary JSON and historical 59-test transport report remain byte-identical. This section and a separate preflight-closure artifact report the review; they do not rewrite historical results or assert that previously missing evidence existed.

### Security review

No credential values, provider error bodies or customer records are logged or committed. The only credential use in the transport is the fixed Google endpoint's request header; there is no key query parameter, key discovery or runtime import. No arbitrary model/provider/endpoint, tools, fallback, inference retry or execution callback is accepted from the synthetic packet. Core validators and deterministic authority, cancellation, hazard and action ownership are unchanged.

The original transport relied on trusted caller approval assertions and evidence hashes. Those assertions are not an independent Google ownership/billing verifier and must never be manufactured to unblock a canary. The review closed default network dispatch (including directly injected ambient fetch); mock approvals cannot activate it. Trusted injected mock functions remain test-only. This is not a cryptographic permission system or proof against an operator replacing the code. No real live runner, canary approval or automatic paid path is added.

### Fresh read-only UI evidence

- Projects: `gen-lang-client-0748205572`, Default Gemini Project, Free tier, Set up billing visible.
- Billing: **No billing account** displayed in the signed-in AI Studio session.
- Project-specific rate-limit page: Gemini 3.1 Flash Lite, 15 RPM / 250,000 input TPM / 500 RPD. Displayed peak usage is zero over 28 days, with a stated 15-minute reporting lag. This is not an instantaneous quota reservation.
- Environment: Gemini key present; Google OAuth access-token variables, ADC environment configuration and the standard local ADC file absent. No IAM key lookup was attempted. Successful earlier model metadata requests remain model visibility evidence only.

The UI account/project is not yet cryptographically or administratively bound to the environment key. Therefore these observations cannot set the transport's `ownership_verified` or key-bound billing/quota approval to true.

### Full request accounting: byte-complete, tokens unverified

`gemini-token-preflight.mjs` constructs a **non-sending** full `countTokens` request containing `generateContentRequest.model`, the exact existing systemInstruction, contents and generationConfig (including responseJsonSchema and thinking configuration). It binds the count request to the wire-body, schema and packet hashes. It does not count only the utterance, omit schema, shrink the semantic contract, use chars/4, invent a tokenizer or infer tokens from bytes.

For the preserved synthetic canary packet:

| Component | Exact bytes |
|---|---:|
| System-instruction JSON | 670 |
| Contents JSON, including the complete synthetic packet | 1,185 |
| Generation configuration JSON | 5,373 |
| Outer wire JSON keys/separators | 54 |
| Total generation request body | **7,282** |
| Schema alone (subset of generation configuration) | 5,201 |
| Instruction text alone (subset of system instruction) | 647 |
| User payload text alone (subset of contents) | 1,030 |
| Full countTokens request body including model/wrapper | 7,348 |

These are exact **byte** measurements, not token counts. Gemini's internal framing and the schema's effective tokenization remain unknown. Measured input tokens and the safe full-input upper bound are therefore explicitly null. The unchanged 4,096 input / 1,024 combined output-and-thinking caps have not been demonstrated satisfiable. The preserved packet has historical timestamps; refresh/review/hash it and repeat preflight before any future canary.

The [countTokens reference](https://ai.google.dev/api/tokens) accepts the full generateContentRequest, but the reviewed text does not establish exact coverage of responseJsonSchema and every provider-internal framing token. The current [billing FAQ](https://ai.google.dev/gemini-api/docs/billing) explicitly says **GetTokens** is not billed; this review does not silently equate that name to the selected legacy `models.countTokens` route without verifying applicability. With ownership still unknown and a strict $0 limit, no tokenization API call was made. Complete verified **token** accounting is an outstanding blocker, not a completed acceptance item.

### Exact outstanding owner actions

1. A project administrator must use approved read-only IAM access to verify the **exact environment key**, obtain its parent project/key resource, and resolve the parent project number to `gen-lang-client-0748205572`. Google's documented `keys.lookupKey` requires OAuth and `apikeys.keys.lookup`. Alternatively the administrator can perform this locally and retain sanitized verifiable evidence. Do not paste the key into chat, commit it, print it, place it in a shell command argument or expose it in request logs. Do not create credentials or widen permissions as an implicit part of this task.
2. Bind the currently observed Free tier/no-billing/quota evidence to that verified key, and confirm the project will not be moved to paid billing during the single approved request.
3. Obtain authoritative confirmation that the chosen count-only endpoint is $0 and covers the full schema/instruction/framing population, then measure this exact refreshed request without inference. If it omits a component, obtain a supported bound for that component. Record the exact request/model/hash and prove <=4,096 input tokens. Do not raise the cap or claim a byte estimate is a token proof.
4. Review the synthetic packet and free-tier data-processing policy, then separately authorize the single live canary and its explicit transport wiring. No such approval is issued here.

Final closure validation: **270/270 checks pass** — all original 264 plus six added tests for ambient-network closure and full count-request preparation/accounting. All test traffic is mocked; provider inference, countTokens and paid requests in this closure turn: **zero**. No Core runtime/dependency changes or production activation. Project ownership and complete token proof remain blockers.
