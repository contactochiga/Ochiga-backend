# IQ-11F — approved OpenAI shadow experiment: execution access checkpoint

2026-10-14, Africa/Lagos. Verified clean local and live remote HEAD `7074f7ae720c53d48d7c7f62ac2cbb2e7639a1c4`, branch `codex/intelligence-quality-v1`, origin `git@github.com:contactochiga/Ochiga-backend.git`.

## Decision and current result

The user has approved **one cumulative USD 50 maximum in OpenAI API charges**, shared by GPT-5.4 Mini and GPT-5.4, for synthetic-only shadow qualification. Spending approval is no longer a blocker. Anthropic/Gemini remain inactive, with no fallback or transfer. The provider-neutral architecture remains the design; this is its OpenAI-only qualification arm, not a reversal to an OpenAI-only Core.

**Execution is blocked before paid calls.** A fresh safe presence check found no OpenAI key/project in this process environment and no non-template `.env` credential file in this worktree. There is no available OpenAI credential-provisioning tool in this session. No global/keychain/other-worktree secret search was performed. Authentication, project model access, funded billing and actual data-processing settings cannot be established from the available configuration.

No provider API calls were made, no candidates were generated, no qualification corpus was executed and no independent scores exist. API charges incurred through this request: **USD 0**. Remaining approved experiment budget: **USD 50**. This is not a statement about unrelated OpenAI account usage. Public documentation retrieval is not paid inference.

The new authorization and access artifacts are additive. Historical preparation plans and results remain unchanged, including their earlier zero-authorization state. Do not treat those historical approvals as the current authorization or rewrite frozen evidence to update it.

## Model identifiers and current documented pricing

| Model | Exact documented snapshot | Standard input / 1M tokens | Output / 1M tokens |
|---|---|---:|---:|
| GPT-5.4 Mini | `gpt-5.4-mini-2026-03-17` | USD 0.75 | USD 4.50 |
| GPT-5.4 | `gpt-5.4-2026-03-05` | USD 2.50 | USD 15.00 |

Verified in official [Mini documentation](https://developers.openai.com/api/docs/models/gpt-5.4-mini) and [GPT-5.4 documentation](https://developers.openai.com/api/docs/models/gpt-5.4) on 2026-10-14. Both document structured outputs and reasoning effort `none`. Documentation is not proof of this project's access. No moving alias or replacement model is authorized. Regional processing incurs a documented uplift; account-specific charges remain unverified. Refresh pricing before execution if this checkpoint becomes stale.

Preserve complete-input cap 4,096 tokens (instructions + schema + packet), output cap 1,024, hard deadline 3 seconds, p95 target 1.5 seconds, concurrency one, zero automatic retries, standard service tier and reasoning `none`. At 840 requests per arm, the full-cap base token estimate is USD 6.4512 Mini + USD 21.504 Full = **USD 27.9552**. This excludes additional canaries, paid authoring/grading, surcharges and taxes; it is not an all-in billing quote or a guarantee of completion within budget.

## Processing requirements still to resolve

Proposed request: foreground text-only Responses API, `store: false`, no tools, no background/streaming, no provider conversation state, no training-sharing opt-in, reviewed synthetic packets only. Choose and verify the experiment project and permitted region. Explicitly confirm whether documented standard abuse-monitoring retention is acceptable or whether an approved ZDR arrangement is required. `store: false` does not by itself establish ZDR; project sharing and retention settings must be checked. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

Provision a project-scoped credential through secure local environment/configuration, **not chat or a committed file**. Identify the approved project and provide owner verification of billing/model access and retention/sharing configuration, or enable an approved read-only administrative route. No billing, key or project-policy change has been made here.

## Mandatory runner gate — not yet implemented for live use

The existing gateway models budget policy with inert offline replies. It is **not** a durable live spending limiter and cannot be promoted by changing an approval boolean. Before any paid canary or qualification call, implement and fault-test the approved experiment runner with:

1. A single durable experiment ledger shared across both models and every paid setup/authoring/grading attempt. A restart, a new arm or a new output directory must not reset the USD 50 authorization. Use exclusive ownership/locking and fail closed on missing, corrupt or conflicting ledger state.
2. Complete-input token measurement and approved all-in upper prices. No optimistic cache discounts or omission of billed reasoning. Unknown price, tokenizer, fee or applicable surcharge blocks execution.
3. Persist and fsync the exact-ID attempt plus worst-case charge reservation **before network dispatch**. Deny dispatch whenever settled charges + outstanding reservations + the next conservative reservation would exceed the cap. Dashboard alerts are not enforcement.
4. Bound output server-side and enforce a client deadline. Disable SDK/network automatic retries. A timeout or lost receipt may still be billed: retain the reservation and halt for reconciliation, never assume zero or silently resend.
5. Settle from verified typed usage and approved rates; include all failures and paid canaries. Journal receipts and perform IQ-11C exact-ID final reconciliation without replaying test turns. Distinguish usage-derived cost from final provider billing; do not claim invoice-exact costs without provider reconciliation.
6. Keep candidates outside canonical decisions. No model output may select tools, grant authority, override cancellation/hazards, send a user response or execute an action. Both live arms stay OpenAI-only; no fallback provider or production imports.

These are preserved acceptance requirements, not a claim that a live runner exists. Pending access/configuration, no transport was wired in this checkpoint.

## Independent qualification remains frozen in scope

Reuse the IQ-11E protocol and provider-neutral architecture requirements: at least 80 primary multi-turn journeys per worker, at least two scored turns per journey, plus 100 paraphrase and 100 operation-flip companions. Minimum 840 scored requests per model / 1,680 combined. Independent authors must not inspect implementation phrase rules or prior sealed failures; two blinded graders per worker and separate adjudication of disagreements plus at least 20% of agreements. Model outputs must not feed subsequent context. Freeze corpus, expectations, schema, prompts, ordering and hashes before first contact. No old sealed corpus replay.

Keep all existing quality, safety and operational thresholds. Budget failure, transport failure and unavailable evidence remain explicit, not deleted from denominators. This remains interpretation shadow qualification, not overall Oyi intelligence certification. Independent authoring, corpus freeze, grader allocation, schema canaries and live trace reconciliation have **not yet occurred**.

## Validation and scope

This checkpoint changes only this document and two new JSON artifacts. Runtime, gateway implementation, previous evidence, dependencies, credentials and billing remain unchanged. Existing offline checks passed: gateway **89/89**, IQ-11F **25/25**, IQ-11E **91/91**; generated outputs were redirected to temporary storage. Authorization/access JSON and arithmetic checks: **11/11**. Historical-file preservation passed, with no diff to existing tracked files. Diff and changed-file secret-pattern checks are required before commit. Offline checks are not new provider results. No production build or physical execution is needed for these additive evidence files.

## Next required input

Secure experiment credentials/project access and verified billing/data-processing configuration are required before paid execution can proceed. The USD 50 budget approval is already recorded and does not need to be granted again. After access is resolved, finish and test the durable runner, commission the independent corpus, pass preflight and perform the approved first-contact comparison within the same cumulative budget.

**IQ-11F OPENAI SHADOW QUALIFICATION BLOCKED — PROJECT ACCESS AND DATA-PROCESSING VERIFICATION REQUIRED**
