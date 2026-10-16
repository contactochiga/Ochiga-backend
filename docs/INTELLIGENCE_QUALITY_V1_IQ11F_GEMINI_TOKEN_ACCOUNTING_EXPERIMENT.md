# IQ-11F Gemini count-only schema experiment

## Scope and preflight

Starting HEAD: `113e1274362055b77989ff85d6d5469476a82e94`, branch `codex/intelligence-quality-v1`.
Owner authorized at most two no-charge count-only requests, not inference.
The existing three untracked verification artifacts were preserved and are not part of this commit.

Project: `gen-lang-client-0748205572`. The prior owner-controlled masked local full-key comparison succeeded. Project association and Free-tier status are supported by the owner's project-key selection and UI evidence; no new billing administration or credential logging occurred.

Google's [Count Tokens guide](https://firebase.google.com/docs/ai-logic/count-tokens) explicitly states that Count Tokens API calls have no charge and lists the selected model as supported. Both requests used the same documented [count-only REST endpoint](https://ai.google.dev/api/tokens), not a content-generation endpoint. No billing change was made. Zero monetary charge is based on that published API policy, not a separately observed invoice.

## Controlled requests and results

Exact endpoint model: `gemini-3.1-flash-lite`. Count responses do not establish an immutable inference model version.
Request A used the existing synthetic canary unchanged, including system instruction, contents, generation configuration and canonical response JSON schema. Request B was a deep copy with only `generateContentRequest.generationConfig.responseJsonSchema` deleted. This did not change the canonical schema or inference transport.

| Request | Start (UTC, 2026-10-16) | HTTP | Count | Elapsed |
| --- | --- | --- | --- | --- |
| A: complete | 15:17:35.282 | 200 | 496 | 737 ms |
| B: schema omitted | 15:17:36.020 | 200 | 496 | 175 ms |

A SHA-256 of exact serialized request: `0588c7f0247bf9161b74698ce68970fb377d0a772dace9ef04d53e85dbe90866`.

B SHA-256 of exact serialized request: `6147e52453dfef97c15a72ef111e7c1085cb942aa0b1c7ef93039f1490182127`.

Both responses reported TEXT modality count 496. Full sanitized receipts, finish timestamps and hashes are in `artifacts/intelligence-quality-v1-iq11f-gemini-token-accounting-experiment.json`. No credential, raw provider error, request contents or generated answer is recorded there.

## Interpretation and limits

Observed A minus B: **0 tokens**. The count endpoint did not expose a schema-dependent increment. This observation is not proof that schema processing is free of input tokens during inference, nor proof of complete internal-framing coverage. Google separately documents that [response schemas count toward the input limit](https://firebase.google.com/docs/ai-logic/generate-structured-output).

496 is numerically below 4,096, but a verified complete-input upper bound remains unavailable. Neither characters/4, serialized byte size, nor the model's larger context window establishes the required conservative bound. No arbitrary margin is added. Provider-side schema preprocessing and framing remain unbounded by the evidence collected here.

The existing limits remain 4,096 input tokens, 1,024 combined output/thinking tokens and a three-second inference deadline. Count requests were also bounded to three seconds each. Exactly two count requests were attempted, with no retries, fallback, tools, inference, physical execution or production activation. No further request is authorized by this experiment.

## Validation and decision

270 offline checks passed: Gemini transport 65; gateway 89; inherited IQ-11F 25; inherited IQ-11E 91. No runtime, canonical-schema, authority, cancellation, hazard or action-governance changes were made.

The accounting experiment is measured; complete-input certification remains blocked. Next requirement is a provider-documented accounting relation or independently justified model-specific upper bound covering schema processing and relevant framing. Refreshing the synthetic packet later changes its hash and invalidates direct reuse of these exact-request counts. Separate approval is required for any inference.

**IQ-11F ACCOUNTING STILL BLOCKED**
