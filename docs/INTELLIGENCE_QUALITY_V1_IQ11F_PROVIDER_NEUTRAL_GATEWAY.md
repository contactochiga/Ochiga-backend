# IQ-11F architecture decision — provider-neutral interpretation gateway

Decision date: 2026-10-14. Starting local and remote HEAD verified clean: `e8c74aed00e613270a393aa633aa410253d9962e`, branch `codex/intelligence-quality-v1`, origin `git@github.com:contactochiga/Ochiga-backend.git`.

**Status: architecture and offline mocks prepared; no live integration, provider qualification or runtime adoption. Overall intelligence is NOT CERTIFIED.**

## Explicit change from the historical baseline

The OpenAI-only IQ-11F experiment is now a **historical preparation baseline**, not the final provider architecture. Its plan, schemas, access audit, test output, protocol and approved-provider history remain byte-identical. This decision is additive: it does not revise scores, rewrite old approvals or silently expand OpenAI's approval into permission to transfer data to Anthropic or Google.

The earlier two OpenAI snapshots remain historical candidates, not qualified models. Claude/Gemini exact models and API versions remain unselected. The historical USD 50 proposal was never spending approval and does not automatically fund a larger experiment. Currently authorized spend: **USD 0**. No credentials, billing settings or provider environment variables are changed or activated.

## Audit and reuse

| Existing owner | Reuse / boundary |
|---|---|
| IQ-11E `contract.mjs` | One canonical candidate schema derived from SemanticFrame/AnswerTarget, minimized packet, scoped references, expiry and deterministic candidate validation |
| IQ-11E `harness.mjs` | Unchanged pure deterministic parser baseline, exact-ID recorded receipt comparison, structural grading, corpus composition and quality gates |
| IQ-11F preparation | Lessons from fixed settings, synthetic minimization, cost reservation, closed-schema normalization and no-adoption contract; old artifacts remain historical |
| IQ-11B / IQ-10A | Effective authority, requested/retrieved scope, hazard continuity and terminal cancellation remain Core-owned |
| IQ-11C / IQ-10B | Canonical request journal, persistence, safe durable receipts and exact-ID reconciliation remain the future E2E integration owners |
| Capability registry / orchestrator | Unchanged; the provider registry is NOT a capability registry or another orchestrator |

The old OpenAI request-builder is not used to choose other providers. New vendor-neutral serialization starts from the same IQ-11E schema, without duplicating semantic enums or interpretation rules. No Core source or dependencies change.

## One boundary, three independently testable adapters

```text
Canonical packet + trusted experiment route
  → recipient approval / scope / budget / deadline checks
  → provider adapter (wire description + response normalization only)
  → unchanged IQ-11E candidate validation
  → shadow comparison and structural receipt

Canonical deterministic interpreter and governance remain unchanged throughout.
```

`scripts/iq11f-gateway/adapter-contract.d.ts` defines the single adapter interface:

- `id`, `version`, `mode`, `protocol`: trusted registration metadata.
- `describe(packet, exactModel, limits)`: provider wire description, always `sendable: false` in this slice.
- `normalize(recordedBody, exactModel)`: a candidate or a closed terminal status plus typed usage. No tool selection, authority, context retrieval, key lookup, execution or adoption methods.

`AdapterRegistry` explicitly registers reviewed adapters. Duplicate/unknown entries fail closed. A future compatible provider must implement this same interface, pass the same tests, have a reviewed protocol/model/profile, and receive separate approval. Runtime/model text cannot register adapters, choose a URL, supply an SDK or override policy. No provider SDK or network transport is installed.

The `OfflineGateway` accepts **inert mock replies only**, with virtual elapsed times. There is deliberately no injected network function. This is an executable design model, not a production gateway. Registry, circuit, memo and budget state are ephemeral test state, not new conversation memory or durable production systems.

## Adapter design and normalization

| Adapter | Wire design | Candidate extraction and failures |
|---|---|---|
| OpenAI GPT | Responses; `text.format` JSON schema; no tools, foreground, `store: false`, reasoning `none` | Completed exact-model response, one `output_text` item; separate refusal/incomplete/unexpected output; no reasoning/tool blocks accepted |
| Anthropic Claude | Messages; `system` + one user packet; `output_config.format` JSON schema; bounded `max_tokens`, no tools or streaming | Exact-model `message`, `end_turn`, one text block; `refusal` and `max_tokens` stay terminal, tool/thinking/extra blocks are not interpreted as a candidate |
| Google Gemini | Explicit unqualified `generateContent` compatibility profile with JSON schema, one candidate and bounded output | Exact `modelVersion`, one `STOP` candidate with one plain text part; prompt/safety blocks, `MAX_TOKENS`, function calls and multiple candidates remain distinct failures |

These are **designed adapters exercised with mocks**, not claims of server acceptance. Current Google documentation exposes newer formatting APIs and deprecates some legacy fields; the compatibility profile is intentionally labelled unqualified. Select and freeze the Gemini API/model/schema version before a live canary; do not silently switch to Interactions or Vertex because a request fails. Anthropic thinking support and Gemini thinking controls are model-specific and must be explicitly fixed after model selection. No model is silently selected from examples in documentation.

Official design references: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), [Gemini generateContent reference](https://ai.google.dev/api/generate-content). Reviewed 2026-10-14. The tests are not a substitute for vendor compatibility qualification.

Wire schemas preserve every field, enum, required key and closed object from the canonical schema. Provider-unsupported restrictions are omitted only from wire schemas, never from local validation. Anthropic's wire profile conservatively omits numeric/string/array bounds; Gemini omits regex patterns; all keep canonical local enforcement. Server schema complexity, nullable types and token overhead need an approved canary. If a provider cannot express the minimum contract, report unsupported—do not weaken Core validation.

No JSON fence stripping, prose extraction, fabricated missing fields or repair call. Refusal, malformed/oversized JSON, unknown enum, wrong model, cross-scope reference, expired entity, stale epoch, extra tools, truncated output and contradictory speech acts cannot become success. The wrapper is bounded to 64 KiB and the candidate to 8 KiB. Schemas contain public contract vocabulary only, not per-user facts or private enum values.

## Deterministic ownership and provider-off operation

Selection is from a trusted preregistered experiment manifest, never natural-language output. A candidate remains non-authoritative after passing schema validation. Core still revalidates current actor/resource scope, capability eligibility and evidence availability, then applies hazards, cancellation, confirmation and execution governance. References never grant permission; user statements remain unverified facts, not canonical record writes.

The unchanged deterministic interpreter remains the provider-off baseline. When no route is selected, the simulator returns its unchanged baseline hash without an adapter attempt. Invalid/unavailable candidates do not replace it. This does **not** assert that all baseline cognition is correct or certified. A future adoption proposal must define safe clarification/limitation behavior when neither interpretation is adequate, without evading Core safety gates. Adoption is outside this decision.

## Selection, fallback and recipient isolation

Each live profile will require exact provider/model/API version, approved endpoint/region/account reference, policy version/expiry, permissible worker/scope/data classes, minimization contract, tokenizer, limits, prices and human approval. Credentials stay in provider-specific secure storage, never the packet or registry. The offline profiles use conspicuously synthetic IDs, fictional prices and `offline_mock_only`; they authorize no paid call.

Default cross-provider fallback is **disabled**. One recipient's approval is not another's. A separately tested fallback policy may contain one additional recipient, only for transient transport/availability failures, within the original overall deadline and reserved budget. It must separately approve the destination and transfer for the same packet hash, scope, worker and policy. Rebuild the destination packet from canonical minimized context; never forward the previous provider's raw output or hidden reasoning. If approval/visibility/expiry changes, stop and revalidate. An Osa packet can never receive Office content. This preparation rejects all non-synthetic packets; private-context transfer is not enabled even with mock approval flags.

Never retry/fallback to escape refusal, safety denial, invalid candidate, unknown scope, contradictory intent, missing receipt or uncertain billing. In independent scored arms, fallback remains disabled even if later approved for availability testing: each provider must own its failures. Report fallback experiments separately, never count a fallback provider's success as the primary provider's accuracy.

## Deadlines, circuit breaking and idempotency

Proposed common caps remain input 4,096 tokens (complete prompt+schema+context), output 1,024, packet 12 KiB, candidate 8 KiB, per-attempt <=3,000 ms and **overall <=3,000 ms**, p95 target <=1,500 ms, concurrency one, automatic retries zero. Different tokenizers must count identical semantic input independently; never shrink content for only one arm to fit. Over-limit or unmeasured input blocks the attempt. These limits require feasibility review before corpus freeze, not post-failure relaxation.

Offline circuit proposal: three consecutive transport/timeout or invalid-candidate failures open a provider/model/policy/scope-local circuit for 30 seconds. One half-open probe is allowed after cooldown in the sequential simulator; success closes it. Open circuits return the baseline without a probe. Live concurrency locking, wall-clock timers, AbortSignal, HTTP cancellation and cross-process circuit storage are **not implemented or certified** here. In-flight work may still be billable after a client deadline. Late content is discarded and cannot overwrite an immutable completed result.

Exact request ID + packet hash + context epoch + route/policy/locks bind retries. Identical duplicate delivery returns the recorded result without another attempt/reservation; a changed packet, lock or profile conflicts. Revoked recipient policy is checked before returning cached shadow results. This is not exactly-once execution and not a persistence implementation. Future durable deduplication belongs in IQ-11C; no physical execution exists here.

## Token and cost accounting

Normalize usage without equating vendor field names:

- OpenAI: reported output total already includes reasoning; do not add reasoning tokens twice.
- Claude: input total includes fresh input plus cache-read and cache-creation input. Missing buckets stay unknown, not zero. Model-specific output/thinking billing must be reviewed.
- Gemini compatibility profile: response candidate and thought tokens are summed for bounded output accounting; prompt count includes its cached subset. Missing counts remain unknown.

Preserve typed cache/reasoning components where supplied, alongside aggregate billable bounds. No cache discounts assumed. Each price profile needs dated, currency-specific upper rates that cover **all** billable input/cache creation and output/thinking, plus model/tier/region overhead and taxes as applicable. Unsupported separate fees, unknown prices or unmeasured tokens block spending. Mock integer-microdollar arithmetic is fictional test data, not current vendor pricing.

Reserve the worst-case amount before an attempt. Settle only a complete bounded usage receipt; unknown/missing/over-limit usage retains the entire reservation and blocks further simulated attempts pending reconciliation. A trusted runner's proven not-accepted outcome may release a reservation; an error string or model assertion is not proof. Timeout/late completion never means zero cost. A future live ledger must durably reserve atomically, reconcile every attempt and block after uncertain charges. The test ledger is in-memory and must not be used as a real spend limiter.

The prior $50 proposal must be re-costed for three providers (or four model arms if both OpenAI candidates remain). No aggregate estimate is supplied with unknown Claude/Gemini models/prices. Review dated [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) and [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) at approval time, including paid authoring/grading, canaries and setup. Credentials/billing and paid inference remain untouched.

## Provider-specific approval checklist

| Provider | Required credential/account review | Required data-processing review | Pricing/model gate |
|---|---|---|---|
| OpenAI | Dedicated experiment project/key reference, scoped model access and funded quota; no values in artifacts | Actual project training-sharing settings, retention/ZDR eligibility, storage/cache exceptions, region and subprocessors; `store: false` alone is not zero retention | Historical snapshots may be proposed again; refresh dated prices, token accounting, exact model permissions and schema canary |
| Anthropic | Dedicated workspace/key reference and explicitly selected direct/cloud endpoint; do not treat Bedrock/Vertex access as identical approval | Exact model/feature retention, organization/workspace controls, schema caching, region, training/deletion and any model-specific exceptions | Exact Claude snapshot and API version unselected; input/cache creation/read/output/thinking rates and schema complexity qualification required |
| Google | Explicit choice of Gemini Developer API versus Vertex AI; project/key or service-account reference, billing/tier and model access | Paid/unpaid terms differ; approve service/tier, training/human-review use, retention, residency and caching. No fallback into unpaid quota | Exact Gemini version and API/schema profile unselected; prompt/cache/thought/output and any tier/region prices required |
| Future provider | New explicit registry entry plus scoped credentials and endpoint review | Independent legal/security/data-transfer approval; no assumed compatibility from an OpenAI-shaped API | Exact model, versioned adapter, tokenizer, bounded pricing and identical qualification gates |

Current documentation contains model/feature-specific retention exceptions; do not infer approval from vendor branding. [Anthropic retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) requires model-specific review. [Gemini terms](https://ai.google.dev/gemini-api/terms) distinguish paid and unpaid services, including data use. Refer to the historical OpenAI data-control sources without treating that policy review as approval for another provider. No production/private packet is eligible in this phase.

`artifacts/intelligence-quality-v1-iq11f-gateway-approvals.json` records all unapproved fields as null, zero authorized spend and no approved transfer edges. It is a review checklist, not runtime configuration. No credential presence probe, billing API or authenticated provider endpoint is used by new gateway code. Inherited historical tests include their existing local boolean-only access fixture; their generated output is isolated and not republished as a fresh access certification.

## Independent multi-provider qualification

Reuse IQ-11E's independent protocol and unchanged thresholds, not historical utterances. At least 80 multi-turn primary journeys per worker, >=2 scored turns each, 100 paraphrase and 100 operation-flip companions: >=840 scored requests per model. Three selected model arms require >=2,520 scored requests; retaining both historical OpenAI arms gives four arms / >=3,360, plus separately counted setup/canaries. Deterministic baseline has no inference charge.

Authors must not see implementation rules, exposed development/certification utterances, old failures or model outputs. Commission fresh isolated authors and disclose same-model/procedural limitations. Freeze corpus, valid semantic alternatives, fixture authority/context sequence, schemas, provider/model/API/tokenizer versions, prompts, effort settings, order, limits, costs and hashes before first contact. Two graders per worker blinded to provider, independent adjudicator for disagreements and >=20% of agreements. No new independent corpus is authored by the maintainer mock suite.

All providers receive the same approved synthetic task/context packet and common instruction; only vendor wire framing differs. Preserve sequence within journeys, counterbalance arm order with a frozen schedule, and do not feed model candidates into later context. Record provider tokenization differences and cold schema overhead. This is shadow interpretation qualification, not autonomous conversation or overall intelligence certification. Use separate labels for missing capability, correct clarification, refusal, incomplete answer, provider failure and unsafe interpretation.

Retain overall >=85%, each worker >=80%, sufficiently sampled intent >=75%, paraphrase >=80%, operation-flip >=75%, zero P0; retain stricter IQ-11E structural gates (per-worker dimensions >=90%, joint primary >=85%, flips >=80%, ambiguity/safety 100%, clarification precision/recall >=90%). PARTIAL is not PASS. Report every worker and intent separately. Compare paired disagreements and journey-clustered uncertainty, usefulness, refusal rates, latency and complete cost. Do not select a winner if none passes. Do not lower thresholds or replace unavailable provider results with a fallback answer.

Future shadow execution must first pass IQ-11C preflight, journal every canonical/provider attempt, keep failure receipts, and reconcile exact IDs durably without replaying turns. Trace contains structural IDs/hashes/status/usage/timing only, not raw packets, private evidence, response text, secrets or internal reasoning. Candidates may be held separately as synthetic evaluation artifacts; they are not trace content. Provider correlation is distinct from conversation persistence.

## Implementation scope, tests and remaining work

New files live only under `scripts/iq11f-gateway/`, new `iq11f-gateway-*` artifacts and this document. Three independent vendor adapters share one registry/interface and local candidate validator. Offline tests cover all four surfaces, normalization equality, schema preservation, provider-off baseline, cancellation/hazard/denial locks, scope transfer, refusal/no-fallback, unknown pricing/usage, reservation caps, virtual circuit states, duplicate/revoked requests, deadlines, late discard, raw-output privacy and future registration. Historical IQ-11F/IQ-11E suites run with generated artifacts redirected to unique temporary directories; historical file hashes are compared to the starting commit.

Tests validate the mock policy model and contracts only. They do not measure vendor accuracy, real timeouts/AbortSignal, provider latency/cost/retention, schema server acceptance, live tokenizers, concurrent distributed circuit behavior, durable budget journals or IQ-11C end-to-end storage. Overall intelligence and multi-gang workflow exclusions are unchanged. No runtime code, secrets, billing or provider settings are changed.

Validation on the preparation tree: **89/89 new offline gateway checks, 25/25 inherited IQ-11F checks and 91/91 inherited IQ-11E checks passed**. JavaScript syntax checks and the adapter declaration typecheck passed. These are contract/mock results, not live-provider or independent intelligence scores. The generated results artifact records source/schema hashes and byte-preservation checks for the historical preparation files. Production build and live integration suites are not rerun because no production source, dependencies or execution path changed.

Next approval stage:

1. Review this architecture and select exact OpenAI/Claude/Gemini models, service/API versions and data-processing policies.
2. Approve scoped credentials/projects, retention/region, tokenizers, all-in prices and a recomputed combined budget; current authority to spend remains zero.
3. Separately approve implementing live **shadow-only** transports, durable reservation/reconciliation and execution-isolated preflight. No runtime adoption implied.
4. Commission fresh independent corpus/graders, freeze hashes/settings and explicitly approve synthetic compatibility canaries and the first-contact run.
5. Review per-provider qualification before considering any Core adoption proposal.

**OYI PROVIDER-NEUTRAL GATEWAY PREPARED — MULTI-PROVIDER QUALIFICATION APPROVAL REQUIRED**
