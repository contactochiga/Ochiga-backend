# IQ-11E — frozen provider-neutral qualification preparation

Preparation only, 2026-10-13 (Africa/Lagos). Verified clean local and live origin `d51bcaa88677e62d4b8218ae60ea0c137973e441`, `codex/intelligence-quality-v1`, `contactochiga/Ochiga-backend`. IQ-11D is not certified; its rejected patch remains rejected. No provider is selected or configured. No model calls, production data, runtime adoption, database tests, merge, deployment or Initiative are authorized.

## Lessons and experiment boundary

Reviewed IQ-11D evaluation and interpretation qualification proposal. Its targeted gains did not generalize; overly broad subject replacement and factual-lookup precedence regressed context. Its exact-enum scorer also rejected legitimate alternative answer shapes. This preparation must not call those structural scores end-to-end intelligence scores.

The only proposed future output is a **non-authoritative projection** of existing `SemanticFrame` and `AnswerTarget`, held in a qualification envelope. It is never a second parser output adopted by Core. Existing `SemanticFrameParser`, conceptBridge, followUpResolver/resultSetContext and IQ-10C entities remain canonical. The offline harness invokes the unchanged parser on synthetic input and compares it with recorded shadow candidates. It imports no orchestrator, database, provider SDK, capability executor or runtime configuration. There is no live transport plug-in or callable provider hook.

## Minimum candidate contract

The generated JSON schema is `artifacts/intelligence-quality-v1-iq11e-candidate.schema.json`. Closed canonical enum values are extracted from the TypeScript type declarations, not manually renamed (in particular SUMMARY is not DETAIL, and action proposal is not action-result truth). Schema source hashes are frozen in the preparation report.

Envelope: version, request ID, context epoch, input hash, outcome (`interpreted`, `clarify`, `unsupported`), uncertainty (explicit reason and field names), reference bindings and evidence spans. These are experiment annotations, not new persistent conversation state.

SemanticFrame projection: `cognitiveObjective`, `domain`, `operation`, `mutationIntent`, `temporalScope`, and an AnswerTarget projection. AnswerTarget: `response_intent`, `quantity`, `subject_scope`, `object`, `facet`, `top_n`, `state_concept`, `yes_no`, `requested_fields`, `qualifier_tokens`, `negated_qualifiers`, `hypothetical_process`, `confirmation_kind`. `top_n` is bounded to 1–50 or null; an unsupported larger request must be explicitly limited, never silently truncated. The projection deliberately excludes raw/normalized text, invented numeric confidence, generated rationale, permissions, tools, capability keys, action IDs, execution state, provider verification and final prose.

Bindings use only opaque entity tokens already supplied in the bounded input, with canonical reference kinds. A discourse annotation distinguishes new subject, same-subject facet, correction, material fact, return, selection and comparison. It is graded as an annotation; it does not modify the existing context contract. New entities may be indicated through the current utterance and explicit uncertainty; a model may not invent a canonical entity ID. Unsupported temporal or multipart meaning must remain explicit rather than squeezed into a false singular frame. Multiple independently scored turns/clauses must retain parent linkage; full multipart projection is deferred, not implied by this minimum schema.

## Validation and deterministic ownership

1. Reject unknown keys at every level, invalid enums/types, non-finite numbers, over-limit byte/text/array sizes, duplicate references and malformed timestamps. Reject rather than silently truncate.
2. Match request ID, input hash and context epoch exactly. Revalidate all reference tokens against current worker/scope, visibility, expiry and withdrawn state. References never confer authority. Other-person requests remain expressible as requested scope; they do not authorize supplying another person's records.
3. Require grounded text spans to be in the current approved utterance. Require requested fields to belong to the trusted advertised facet set. No free-form tool or capability selection.
4. Enforce structural speech-act consistency: hypothetical process, past action-result, clarification, refusal and advice cannot simultaneously claim mutation; device-power commands require mutation; cancellation cannot represent fresh positive mutation. Objective and target combinations must be coherent, with explicit permitted alternatives. Never treat this validator as proof that the interpretation matches the utterance: independent human/isolated grading remains necessary.
5. A cancellation or hazard signal from deterministic Core cannot be cleared by a candidate. A cancelled workflow reference cannot authorize a new command. A new command requires a fresh target and fresh normal governance. Adversarial fixture locks test these non-interference properties; they are not a replacement safety policy.
6. Authority, privacy/disclosure, evidence eligibility, IQ-11B hazard continuity, terminal cancellation, confirmation, execution and physical verification remain exclusively in existing deterministic owners. Even a valid candidate is **shadow only** and has no adoption method.

## Data-minimization contract

This phase accepts **curated synthetic packets only**. A boolean assertion alone is not real-world DLP: fixture review/provenance is required. Input construction rejects unknown fields and secret-shaped strings as defense in depth, not as a guarantee of de-identification.

Permitted future input, after approval: sanitized current utterance; worker/surface; opaque scope token; fixed current time for temporal interpretation; at most four relevant prior user/assistant excerpts; at most eight authorized relevant entity tokens with synthetic/approved display aliases; at most four necessary facts per entity with caller-supplied/recorded provenance and expiry; existing objective, unresolved reference and deterministic safety/disclosure signals where necessary. No full history or automatic retrieval.

Current offline packet limits: utterance 2,000 characters; four prior excerpts of 500 characters each; eight entities; four fact entries per entity, values <=160 characters; whole packet <=12 KiB; candidate <=8 KiB; <=8 bindings/spans/requested fields. Qualification metadata uses opaque identifiers. No actor IDs, database IDs, email/telephone, exact real address, contact details, financial transaction payloads, documents, credentials, raw provider payloads or hidden reasoning are permitted.

Osa receives public/supplied opportunity facts only. Office-private facts are rejected from public packets even if domain names overlap. Consumer entities must match the authorized home token. Facility entities must match the exact authorized scope token; building must not silently become estate. Office receives only pre-authorized minimal conversation facts, never a new Backend query. Authority/visibility changes create a new context epoch and invalidate old candidate bindings. Expired/withdrawn records cannot bind as active targets. Withheld fields are excluded before packet construction, not merely hidden in the answer. Historical withdrawn references require a separately approved read-only historical contract; this minimum harness rejects them conservatively.

The future live exporter is **not implemented**. It must prove effective policy from canonical owners, apply approved redaction and consent/data-processing rules, and pass adversarial privacy review. The offline harness is not that exporter.

## Independent corpus requirements (not authored in this preparation)

- Interpret the requested minimum conservatively: at least 320 primary multi-turn **journeys**, 80 per worker, each containing at least two scored turns. This is at least 640 primary scored turns. Include longer journeys and restoration boundaries. A journey passes only if all required scored turns pass; report turn-level results separately.
- At least 100 paraphrase companions and 100 operation-flip companions, at least 25 of each per worker, each with its frozen parent context. Minimum 520 case objects / 840 scored turns; setup turns are separately recorded and cannot inflate denominators. The composition checker consumes scored-turn rows and verifies 80 distinct two-or-more-turn primary journeys per worker.
- Authors must not read implementation, regexes, IQ-9A/IQ-9B/IQ-10F/IQ-11D questions/answers, failures or grading. Provide only reviewed capability/authority/synthetic-fact specifications. Record authorship, access declaration and tooling/context isolation. Same-model procedural independence must be disclosed.
- New subject/facet, operation versus entity correction, multiple entities, selective withdrawal, negated filters, topic return, authority changes, hazard continuation, confirmation and provider-off limitations are required classes—not supplied benchmark utterances.
- Author semantic expectations use existing vocabulary and explicit acceptable alternatives. Separate semantic objective from answer shape and action request from execution result. A schema-review panel validates expectations before corpus freeze without seeing runtime outputs. It may not broaden alternatives after execution.
- Freeze protocol, runtime SHA, fixture/authority/time snapshots, schema, corpus and hashes before first contact. No failure-driven reruns promoted as independent evidence. Changed experiments require new corpus and distinct provenance.
- Two independent graders per worker and a separate adjudicator for disagreements plus at least 20% of agreements, stratified by worker/intent/safety. Grade complete evidence-backed responses in the later E2E stage, not keywords. PASS/PARTIAL/FAIL/INFRASTRUCTURE_BLOCKED; PARTIAL is not PASS. Unavailable capability is not successful execution. Honest refusal/clarification only passes where justified.

## Frozen quality gates

Preserve independent certification gates: primary overall >=85%; each worker >=80%; each intent sampled at least ten times >=75%; successful paraphrase pairs >=80%; operation flips >=75%; zero P0. Unsampled/undersampled intent strata are unqualified, not presumed passed. Infrastructure-blocked cases remain visible and block valid certification when required evidence is missing; no denominator pruning.

Also retain the stricter IQ-11D structural qualification gates: each worker objective, subject, reference, operation and answer-target correctness >=90%; primary joint >=85%; successful paraphrase pairs and operation flips >=80%; ambiguity controls and safety invariants 100%. Grade exact operations, negation/qualifiers and bindings, not merely mutation flags. Preserve IQ-9A development >=90% overall/positive, >=80% each category separately. Development familiarity is not independent certification.

Clarification precision and recall >=90% per worker on preregistered resolvable/ambiguous strata; unnecessary clarification counts against useful-answer coverage. Report refusal/abstention rates separately. No safety violation or adoption of an invalid candidate is acceptable. No claimed numerical confidence without a separately qualified calibration contract.

## Operational gates and approval

Hard offline gates: 100% closed-schema enforcement; zero invalid adoption; no network or execution; exact request/input/epoch correlation; late/duplicate/conflicting responses never change the baseline; all cases receive terminal receipts; no raw content in structural event output.

Proposed future operational targets, **requiring approval before live execution**: >=99% first-response schema validity; >=99% provider availability; <=1% timeout rate across the complete minimum 840 scored requests; p95 interpretation latency <=1,500 ms; hard per-attempt deadline 3,000 ms; zero automatic retry by default. Quality failures are not retried. Any availability fallback remains a separate measured outcome, not model success. Tight deadlines may be changed only before corpus generation/execution with rationale; defaults are not proven provider feasibility.

Proposed limits: <=4,096 input tokens and <=1,024 output tokens plus the stricter byte limits; approved tokenizer/version required. No silent context truncation. Token accounting includes failures/retries and any provider-billed reasoning tokens. Reserve worst-case cost before each call; stop before the remaining budget cannot cover that reservation. Unknown price/usage blocks further calls. **Approved budget now: zero. Experiment maximum: unset.** No provider SDK or spending path exists here.

Provider selection matrix (all cells require explicit approval; no recommendation or current vendor claims):

| Requirement | Candidate A | Candidate B | Required evidence |
|---|---|---|---|
| Provider/legal processor, endpoint, region | Unselected | Unselected | Approved organization and region; no arbitrary endpoint from model output |
| Exact model/version/snapshot | Unselected | Unselected | Immutable/versioned identity; change restarts qualification |
| Data processing / training use / subprocessors | Unapproved | Unapproved | Contractual policy and security review |
| Retention / deletion / abuse monitoring / residency | Unapproved | Unapproved | Required retention duration and verified exceptions; zero-retention requirement must be explicitly decided |
| Input/output/tokenizer limits | Proposed above | Proposed above | Verified structured-output support and limit enforcement |
| Deadline / concurrency / retries | Proposed 3s / 1 / 0 | Proposed 3s / 1 / 0 | Operational approval, cancellation and late-billing semantics |
| Price schedule / currency / max spend | Unset; $0 authorized | Unset; $0 authorized | Dated prices, all billable tokens, hard total and per-request reservation |
| Availability/fallback/trace controls | Unqualified | Unqualified | Fault tests, receipt accounting, no unapproved failover provider |

## Trace and staged qualification

Offline receipts are local test artifacts, **not durable IQ-11C traces**. They record opaque request IDs, input hashes, candidate hash, lifecycle/error class and elapsed time only. Responses, facts and utterances are absent from structural events. Recorded candidates remain separate synthetic fixtures. Loss/conflict/missing candidate is explicit, never success. The harness cannot claim database persistence or physical exactly-once delivery.

Before any later E2E qualification: IQ-11C schema/persistence/effective-authority/execution-isolation preflight; fsynced attempted-request journal; durable receipts; exact-ID final reconciliation; no text matching or replay to fill gaps. Current frozen baseline and historical workflow exclusions remain unchanged. The future live adapter and IQ-11C E2E runner connection are separate approved work—not silently simulated here.

## Preparation acceptance

Pass offline schema drift/closed-field tests, synthetic minimization/privacy fixtures, scoped-reference/expiry controls, speech-act contradictions, baseline non-interference, recorded timeout/unavailable/error/late/duplicate handling, grader alternative/coverage gates and deterministic repeatability. Verify no change to src, dependency/configuration files or previous artifacts. Commit preparation files only. Readiness means ready for **provider selection and experiment design review**, not ready to call a model or certify intelligence.
