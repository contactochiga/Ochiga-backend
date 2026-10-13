# IQ-11E qualification preparation

**Ready for provider-selection and budget review; not approved for model calls or runtime adoption. Overall intelligence remains NOT CERTIFIED.**

## Verified state and scope

Started clean on `codex/intelligence-quality-v1` at `d51bcaa88677e62d4b8218ae60ea0c137973e441`; live origin matched. Origin: `git@github.com:contactochiga/Ochiga-backend.git`. Worktree: `/Users/ochigaidoko/Documents/oyi-intelligence-quality`. Only new IQ-11E docs, scripts and artifacts are delivered. Runtime, dependencies, environment/provider configuration and existing evidence are unchanged. Final pushed SHA is supplied in the delivery message.

Reviewed the IQ-11D proposal and evaluation, including the rejected candidate, frozen structural scoring limitations and failed preflight. No sealed corpus was loaded, replayed or used to tune interpretation. No runtime correction was reinstated.

## Delivered contracts

`INTELLIGENCE_QUALITY_V1_IQ11E_PROTOCOL.md` freezes:

Protocol file SHA-256: `4c3ebd07c7f1207a2566683e653f224ce2fdf4c7de09c062871de2d12ea24923`.

- Minimum **non-authoritative** SemanticFrame/AnswerTarget projection, with closed canonical enums extracted from existing TypeScript declarations, typed facets/qualifiers and explicit uncertainty.
- Exact request/input-hash/context-epoch binding; known, current scoped entity tokens; no arbitrary tools, capabilities, permission grants, physical-verification claims or executable state.
- Structural speech-act checks, bounded fields, explicit clarification/unsupported outcomes and no silent truncation. These checks do not prove that a candidate understands the utterance; semantic grading remains separate.
- Deterministic ownership of authority, disclosure/privacy, evidence eligibility, hazard admission/continuity, cancellation terminality, confirmation and execution. Shadow candidates have **no adoption API**.
- Synthetic-only minimization profile and future exporter requirements. Osa/Office separation and exact home/building scope are tested. Input provenance and relevance require review; the harness is not a production redactor or authorization engine.

The packet's permitted data is current approved synthetic text, a small relevant history, opaque scoped entity aliases and necessary expiring facts with provenance. Secrets, contact details, real identifiers, raw records, arbitrary context fields and unrelated private data are excluded. Automatic key-shaped-string checks are defense in depth, not a claim that a regex proves de-identification.

## Offline harness

Files under `scripts/iq11e/` are experiment tooling only:

| File | Responsibility |
|---|---|
| `contract.mjs` | Generate canonical-enum schema; validate packet/candidate bounds, scopes, references, uncertainty and structural consistency |
| `harness.mjs` | Invoke unchanged pure parser from an allowlisted source graph; compare inert recorded candidates; exact-ID receipt accounting; explicit alternative expectations and frozen quality-gate calculations |
| `fixtures.mjs` | Small maintainer-authored synthetic harness controls; not an independent evaluation corpus |
| `run-offline.mjs` | Read local synthetic fixtures and pre-recorded candidate JSON; fsync attempted/completed/final journal; refuse output overwrite; never contact a provider |
| `offline-tests.mjs` | Contract, fixture, non-interference, composition, gate and CLI tests; generate schemas/results |

Run the tests from the repository root:

```sh
node scripts/iq11e/offline-tests.mjs
```

The recorded-candidate CLI accepts:

```sh
node scripts/iq11e/run-offline.mjs synthetic-fixture.json recorded-replies.json /tmp/iq11e-unique-run
```

Fixture root: `version: 1`, `synthetic_only: true`, `reviewed_for_minimization: true`, and `cases`. Each case contains a schema-valid `packet`, optional reviewed `locks`, and optional frozen `expectation.alternatives`. Receipt input is a JSON array of `{request_id, input_hash, context_epoch, status, elapsed_ms, candidate}`. Status is `ok`, `timeout`, `unavailable` or `error`. Receipt timing/identity must be recorded by the trusted runner, never asserted by a model. See the CLI test for a complete executable example generated in a unique temporary directory.

Outputs are an exclusive-create `.json` report and fsynced `-journal.jsonl`. Exit 0 means all recorded candidates passed structural validation/correlation; **it does not mean semantic or intelligence certification**. Exit 2 denotes missing, invalid, conflicting, failed or late shadow evidence. Malformed fixtures fail closed. No provider SDK, HTTP client, live transport callback or runtime adoption hook is installed.

The parser baseline executes only the allowlisted pure source graph, with a fixed fixture clock and no Node/network imports in that graph. The VM is for trusted repository code, not an untrusted-code sandbox. Candidate content is JSON data, never evaluated code. Baseline objects are hash-checked for non-interference.

Full reference binding and conversation restoration are **not** simulated by passing a prior-text flag to the parser. Packet context is validated for candidate bindings; the baseline parser has its existing current-text/active-assessment interface. Future E2E qualification must use the real canonical context/orchestrator path and IQ-11C receipts. The current tooling does not claim that integration already exists.

## Offline test results

Final suite: **91 PASS / 0 FAIL**. Eight deterministic parser snapshots across all four surfaces were repeatable. They are execution controls, not eight graded intelligence successes.

Coverage includes unknown/nested/prototype keys, closed vocabulary, oversized fields, invalid dates/ranges, stale epochs, unknown/expired/withdrawn references, cross-home/surface/public-private fixtures, withheld facets, explicit uncertainty, contradictory speech acts, cancellation/hazard/denial locks, no canonical mutation, recorded errors/unavailability/timeouts, late discard, lost/conflicting/duplicate receipts, structural-log privacy, exact-operation/facet grading, alternative expectations, corpus minima, weak-worker/PARTIAL/P0 gate rejection and journal/overwrite behavior.

During preparation, a malformed-date test initially expected the inner `pattern` diagnostic while the nullable schema returned `anyOf`. The assertion was corrected to the actual schema error while retaining rejection. No intelligence expectation or certification verdict was changed.

Canonical source fingerprints and generated schema hashes are in `artifacts/intelligence-quality-v1-iq11e-offline-results.json`. JavaScript syntax checks pass. Runtime/configuration diff and changed-file secret checks are verified before commit. No broad runtime/DB regression run was performed: this request permits only offline contract, fixture and harness tests.

## Frozen independent evaluation requirements

No independent corpus is authored in this slice. The protocol conservatively requires **80 primary multi-turn journeys per worker**, at least two scored turns each: 320 journeys / at least 640 primary turns. Add at least 100 paraphrase and 100 operation-flip companions, balanced 25 each per worker, with frozen parent context. Minimum 520 case objects / 840 scored turns. Setup turns are separately counted.

Authors must be isolated from source rules, previous utterances, results and failure examples. Expectations use reviewed canonical vocabulary and explicit valid alternatives, frozen before execution. Two independent graders per worker plus adjudication of disputes and at least 20% of agreements. Same-model procedural authorship must be disclosed. A maintainer fixture generator or independence checkbox is not proof of genuine independent authorship.

Preserved gates: overall >=85%; each worker >=80%; each sufficiently sampled intent >=75%; paraphrase >=80%; operation flips >=75%; zero P0. Stricter retained IQ-11D gates also apply: per-worker semantic dimensions >=90%, primary joint >=85%, operation flips >=80%, ambiguity/safety 100%. Journey success requires all required turns to pass. PARTIAL is not PASS. Infrastructure blocks cannot disappear from denominators. Clarification precision/recall >=90% per worker; abstention and useful-answer coverage reported separately. IQ-9A development thresholds remain separate.

## Operational and provider approvals

The provider-neutral matrix is in the protocol; the inactive checklist is `artifacts/intelligence-quality-v1-iq11e-provider-approval.template.json`.

No provider/model is selected. Before any call, approve provider and exact model/version, endpoint/region, data-processing/training/subprocessor policy, retention/deletion/residency requirements, input/output/tokenizer limits, timeout/retry/concurrency, dated prices/currency, maximum experiment spend and worst-case cost reservation. Unknown cost must stop execution. There is no unapproved fallback provider.

Proposals requiring approval: p95 <=1,500 ms; deadline 3,000 ms; concurrency 1; no automatic retries; input <=4,096 tokens / 12 KiB; output <=1,024 tokens / 8 KiB; schema validity and availability >=99%; timeout rate <=1%. These are targets, not measured provider capabilities. **Currently authorized spend: zero; maximum experiment budget: unset.**

## Trace integrity and remaining blockers

Offline artifacts are not durable runtime traces. No database save, trace persistence, provider availability, real timeout cancellation or billing behavior was exercised. Later E2E qualification must pass IQ-11C preflight, journal every attempt, capture canonical receipts and reconcile exact IDs to durable messages/traces. Missing evidence blocks qualification; no replay/backfill to manufacture success.

Before live qualification:

1. Human approval of provider/model, processing policy and budget/operational limits.
2. Reviewed live shadow-only transport and minimized-context exporter; neither exists here.
3. Independently authored corpus, rubric review and sealed hashes; graders/adjudicator assigned.
4. IQ-11C E2E connection and execution-isolated fixture qualification.
5. Measured provider schema, availability, latency, billed-token/cost, retention and privacy behavior.

No existing historical workflow exclusion is lifted. IQ-11D and overall intelligence remain not certified. Preparation is complete for selection review, not for unapproved execution.

**IQ-11E QUALIFICATION PREPARATION COMPLETE — PROVIDER AND BUDGET APPROVAL REQUIRED**
