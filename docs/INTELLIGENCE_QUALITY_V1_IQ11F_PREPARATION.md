# IQ-11F — OpenAI paired interpretation qualification preparation

Frozen proposal date: 2026-10-14. Provider choice **OpenAI is approved**. Paid inference, the proposed USD 50 cap, project/data-processing settings and production adoption **are not approved**. No model call is made in this preparation.

## Repository and contract boundary

Starting local/live remote: `b9b85423bafcbce8964b2926bf00db33730b7a1b`, branch `codex/intelligence-quality-v1`, origin `git@github.com:contactochiga/Ochiga-backend.git`. Worktree was clean. Existing IQ-11E files and sealed evaluation artifacts are unchanged.

The existing IQ-11E SemanticFrame/AnswerTarget candidate, packet and local validation remain authoritative for this experiment. No competing parser, context store, authority engine, evidence loader or execution path is added. IQ-11D remains not certified; neither a valid JSON object nor a shadow-model win certifies Oyi intelligence.

Core retains authority/privacy, scoped evidence eligibility, hazard admission/continuity, terminal cancellation, confirmation and physical execution. A model supplies a candidate interpretation only. It cannot call capabilities, invent entity IDs, retrieve more evidence, clear a denial or cancellation, or claim physical verification. No candidate is fed back into Core decisions in this phase.

## Frozen model comparison

Use the exact user-requested models, pinned to documented snapshots, not moving aliases:

| Arm | Exact model identifier | Standard input USD / 1M tokens | Output USD / 1M tokens |
|---|---|---:|---:|
| Mini | `gpt-5.4-mini-2026-03-17` | 0.75 | 4.50 |
| Full | `gpt-5.4-2026-03-05` | 2.50 | 15.00 |

Both document Structured Outputs and `reasoning.effort: none`. These facts establish documented support, not this project's access or measured performance. Sources checked 2026-10-14: [Mini model](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [GPT-5.4 model](https://developers.openai.com/api/docs/models/gpt-5.4).

Freeze the same prompt, candidate schema, minimized packet and settings for both arms. Proposed transport: foreground Responses API, standard `service_tier: default`, reasoning `none`, text-only strict JSON schema, `store: false`, no tools, no background work, no streaming, no server conversation state or `previous_response_id`. Do not request chain-of-thought. No alternative model/provider or reasoning-effort fallback. Failure to access a snapshot blocks that arm; do not silently substitute.

The existing IQ-11E local schema is preserved byte-for-byte. A generated provider-wire schema adds explicit enum types, converts `const` to a singleton typed enum, and omits schema annotations and transport-unqualified length/uniqueness keywords. It does not rename or remove candidate fields. Local IQ-11E validation still enforces every original limit, uniqueness rule and semantic constraint. Reject invalid/refused/incomplete output; do not repair it into a passing response. Server acceptance is unproven until an explicitly approved synthetic canary. [Structured Outputs subset and refusal handling](https://developers.openai.com/api/docs/guides/structured-outputs).

## Frozen limits and operational gates

| Setting | Both arms |
|---|---|
| Total input | <=4,096 tokens, including instructions, packet, schema and API overhead |
| Output | <=1,024 total output tokens, including any billed reasoning |
| Minimized packet / candidate | <=12 KiB / <=8 KiB; all IQ-11E field limits retained |
| Reasoning | `none`; do not silently raise effort to rescue failures |
| Deadline / p95 target | 3,000 ms / <=1,500 ms per interpretation attempt |
| Concurrency / automatic retry | 1 / 0 |
| First-output schema validity | >=99% per arm |
| Availability / timeout | >=99% / <=1% per arm |
| Safety / privacy violations | Zero |

Latency targets are qualification criteria, not claims of model speed. Include connection/setup/schema cold-start latency and report p50/p95/max, end-to-end versus provider timings, deadline misses, rate-limit/refusal/incomplete responses, and cost per attempted and successfully interpreted turn. Report cached-token counts but reserve at uncached prices. Failed or late requests remain in denominators and may still be billable.

A pinned tokenizer/version and complete request token accounting must be approved and tested before execution. A maximum-sized IQ-11E packet plus schema may exceed 4,096 tokens: block it rather than silently truncating. Review corpus feasibility before sealing; any limit change requires a new preregistered protocol version, never post-outcome tuning.

## Proposed combined budget: USD 50, not yet authorized

At 840 requests **per model**, each using the full 4,096-input / 1,024-output cap:

| Arm | Maximum token estimate per request | 840-request estimate |
|---|---:|---:|
| Mini | $0.007680 | $6.4512 |
| Full | $0.025600 | $21.5040 |
| Combined | — | **$27.9552** |

This calculation uses the cited standard prices, with no cached-input discount. It excludes tax/regional uplifts and additional setup or canary calls; it is not an invoice guarantee. The $22.0448 nominal remainder is contingency, **not authorization for more runs**. Longer journeys, canaries, setup, paid authorship/grading, failures, timeouts, late completions and reruns must all fit the same explicitly approved cap. Planned volume must be recalculated and frozen before any call. No reduced corpus or threshold to fit a budget.

Future transport must reserve worst-case per-request spend durably before sending, release only proven unused reservation after reconciled usage, retain full reservations for uncertain/late billing, and stop on unknown price or usage. Include approved tax/region treatment. Require a dedicated experiment project with no unrelated spend and project-owner confirmation of funding/quota. The local reservation ledger is separate from provider budget alerts: alerts do not themselves stop requests. Do not change account limits here. [Spend alerts versus enforcement](https://developers.openai.com/api/docs/guides/terraform/rate-limits-and-spend).

`estimateBudget` is an offline calculator, **not a durable enforcement ledger**. Authorized spend remains **USD 0**. There is no executable inference transport in this commit.

## Data processing — explicit approval still required

Only curator-reviewed synthetic packets are eligible: current utterance, minimal relevant prior excerpts, opaque worker/scope/entity tokens and necessary synthetic facts with provenance/expiry. Preserve IQ-11E field bounds, exclusions and current reference validation. No production prompts, identifiers, customer/employee records, contacts, secrets, provider payloads or private Office facts in Osa packets. No extra retrieval. Canonical scope and disclosure restrictions constrain any future exporter. Local pattern checks are defense in depth, not proof of de-identification.

Proposed `store: false` is **not** a promise of zero provider retention. OpenAI documents no API training by default unless opted in, standard abuse-monitoring retention up to 30 days, and separate eligibility/settings for Zero Data Retention; caching and other endpoint exceptions need review. Confirm actual project settings, data-sharing opt-ins, retention requirements, processing region, deletion and subprocessors before approval. No Files, Conversations, Batch or hosted Evals API is proposed. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

Approve either documented standard retention for synthetic-only material, or a separately verified ZDR configuration; do not assume ZDR is enabled. `api.openai.com` is only the proposed endpoint, not proof of a residency guarantee. No regional endpoint is chosen without review. Record approval reference, approved project, policy version/date and exceptions without committing credentials or billing identifiers.

## Credential and billing verification

The scoped read-only presence audit found no `OPENAI_API_KEY`, project identifier, organization/admin key or custom OpenAI endpoint in the current process. The worktree root contains only `.env.example`, not a local credential file. No key values, prefixes, fingerprints or billing identifiers were output. Other worktrees, global credential stores and keychains were not searched.

Therefore authentication, snapshot permissions, available project credit/quota and actual retention settings are **NOT VERIFIED**. Absence in this scope does not mean the organization lacks an OpenAI account. No authenticated API request or paid probe was attempted. See `intelligence-quality-v1-iq11f-access-check.json` for the dated boolean-only evidence.

After secure credential provisioning, use a non-inference read such as the documented [retrieve-model endpoint](https://developers.openai.com/api/reference/resources/models/methods/retrieve) for each exact snapshot, with the explicitly approved project. Never log authorization headers or response bodies containing private administrative data; retain only safe status classes. A successful model lookup proves neither paid quota nor billing readiness. A project owner must separately verify funded billing, project limits/model access and data controls in the official console or approved read-only administrative interface. Do not create keys, change billing, fetch broad organization usage, or run a paid test merely to infer credit. Do not send credentials in chat.

## Independent paired evaluation protocol

Retain the IQ-11E conservative minimum: 80 primary multi-turn journeys per worker, >=2 scored turns each (320 journeys / >=640 primary turns), plus >=100 paraphrases and >=100 operation flips, balanced 25 each per worker. At least 840 scored model requests per arm / 1,680 combined; setup separately accounted. No new independent corpus is authored in this preparation.

Authors must be isolated from implementation rules, sealed IQ-9B/IQ-10F utterances, prior failed examples and model answers. Supply only bounded synthetic product/capability/authority facts. Record author isolation and provenance. Two independent graders per worker, blinded to model identity; separate adjudicator for disagreements and >=20% of agreed verdicts, stratified by worker/intent/safety. A maintainer-generated fixture is not blinded evidence.

Before first contact, commit/hash corpus, packet sequence, expectations/valid alternatives, fixture authority, context transitions, prompt, schema, exact runtime source, model IDs, settings, counterbalanced arm order and grading assignment. Within a journey keep chronological order; counterbalance model order by a frozen seeded schedule. No extra retries, prompt changes or selective reruns after seeing failures. No graded candidate is fed into the next packet: both arms receive the same frozen authorized context at each step. This measures shadow interpretation with supplied context, not candidate-driven end-to-end conversation intelligence. Test canonical restoration independently; promotion requires a separate approved E2E qualification.

Compare three arms: unchanged deterministic parser, Mini shadow, Full shadow. Mark context fields unsupported by the pure parser baseline explicitly; do not claim it exercised full orchestrator reference restoration. Use the existing IQ-11E grader for structural facets and independent grading for reference, uncertainty, clarification usefulness and whole-journey semantics. No output/prose plausibility credit, no PARTIAL-as-PASS, no dropping unavailable/invalid/timed-out cases.

Preserve existing gates: overall primary >=85%, each worker >=80%, each sufficiently sampled intent (>=10) >=75%, paraphrase >=80%, operation flips >=75%, zero P0. Retain stricter IQ-11E/IQ-11D gates: each worker's objective/subject/reference/operation/answer-target >=90%, joint primary >=85%, flips >=80%, ambiguity and safety controls 100%, clarification precision/recall >=90% per worker. Journey PASS requires all required turns PASS. Report IQ-9A development gates separately; no result here replaces independent overall certification.

Report each arm separately and paired disagreements, worker-level regressions, confidence intervals clustered by journey, refusal/clarification rates, complete versus partial answers and latency/cost. Select neither model from price or aggregate score alone. If neither passes, recommend neither. Budget, transport or schema failures are visible qualification outcomes, not evidence of cognitive success.

## Trace, failure and execution isolation

Before future live shadow work, extend the existing IQ-11C experiment runner—not Core execution—with paired arm IDs, fsynced attempt/reservation journals, deadlines, safe provider request receipts and exact-ID reconciliation. Reuse IQ-11E `compareRecorded` and local candidate validation. Missing/late receipts stay missing/uncertain, never successful by assumption. Rejections stay rejected; no replay to fill evidence. Reconcile every baseline save/trace separately from the model receipt; no expectation that a model-only shadow response is a user conversation save.

Keep only approved structural metadata in trace: opaque IDs, source/schema/prompt/packet hashes, model snapshot, outcome/validation class, timing, token usage and accounting state. Synthetic raw candidates remain separate restricted experiment evidence, never general runtime traces. Detect candidate injection, cross-scope aliases, stale contexts, cancellation/hazard conflicts, schema refusal, incomplete output, network/timeout and unknown billing without executing actions. No physical devices, emails or customer contact.

## Preparation implementation and validation

New files only: this protocol/report, frozen JSON plan, `scripts/iq11f/prepare.mjs` (pure description/schema/budget functions), `access-check.mjs` (local boolean-only presence audit), `offline-tests.mjs`, and generated IQ-11F schema/access/results artifacts. No SDK, environment, dependency, runtime, IQ-11E or sealed artifact modification.

Offline tests check fixed identities/limits, inherited contract hashes, schema mapping, unsupported keywords, scope/privacy/cancellation/hazard controls, paired settings, budget arithmetic, zero authorization, safe credential reporting, non-interference and no transport imports. The full IQ-11E 91-check suite is rerun with generated outputs redirected to a unique temporary directory, preserving its committed evidence. Preparation tests are not model accuracy results. Generated IQ-11F results record exact counts and hashes; no server schema, real latency, cost, availability, billing or durable trace claim is made.

Preparation validation: **25 IQ-11F checks PASS / 0 FAIL**, including the inherited **91 IQ-11E checks PASS / 0 FAIL**. JavaScript syntax checks pass. Diff and credential-pattern review cover only the eight new IQ-11F preparation files. No existing tracked file is changed. These results authorize neither spending nor production use.

## Required approvals and blockers

1. Explicit **USD 50 combined maximum** approval and all-in accounting/tax treatment; currently USD 0 authorized.
2. Explicit data-processing choice, project/region, retention and sharing configuration approval.
3. Secure project credential provisioning; read-only authentication/model checks and owner-confirmed billing/quota.
4. Approved tokenizer/complete-input accounting and reviewed shadow transport with durable budget ledger/IQ-11C reconciliation.
5. Independent authors/grading allocation, fresh corpus/hash freeze, schema canary plan within the same budget.

OpenAI selection and preparation are complete. Paid comparison is **blocked pending approvals and access**, not started. No model preference or accuracy result exists yet. No production adoption, merge, deployment or Initiative is authorized.
