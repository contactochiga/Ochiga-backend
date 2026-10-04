# IQ-2C — objective-layer closure

## Scope and frozen evidence

Branch: `codex/intelligence-quality-v1`.
Starting HEAD: `aeed6f69643792b1553b5ac6fd7030dd8ebafd4e`.
Tested runtime HEAD: `95d7fc59aa7ba7b2cba2878bda32f8430a0e4e25`.

**IQ-2 CONVERSATIONAL OBJECTIVE CERTIFIED — IQ-3 APPROVAL REQUIRED**

This certifies the objective layer, not overall intelligence quality. No
IQ-3 work has started. Overall cognitive certification remains outstanding.

## Final results

| Measure | Before | After |
|---|---:|---:|
| Frozen closure gaps | 18 | **0** |
| IQRC-004 objective layer handled/bounded | 29/38 | **38/38** |
| IQRC-006 objective layer handled/bounded | 65/74 | **74/74** |
| Targeted turns failing only downstream | 93 | **109** |
| Full IQ PASS / FAIL / BLOCKED | 47 / 228 / 5 | **51 / 224 / 5** |
| Observed unresolved P0 / P1 / P2 | 0 / 214 / 14 | **0 / 210 / 14** |

All 280 turns persisted and correlated to durable traces. IQRC-006 includes
one legitimate explicit capability-discovery turn; it does not need an
assessment objective. Objective metadata is not itself a PASS criterion.

The four individually reviewed full-envelope improvements are OSA-004:2,7
(corrected location and summary) and CON-008:5,6 (return to corrected room
and identify that room). The other objective-layer closures remain full
FAILs where evidence/judgment/initiative is still missing. Historical
seven-dimension scores remain labelled prior scores rather than being
silently rescored.

| Worker | PASS | FAIL | BLOCKED |
|---|---:|---:|---:|
| Oma | 7 | 61 | 2 |
| Osa | 12 | 58 | 0 |
| Facility | 17 | 51 | 2 |
| Consumer | 15 | 54 | 1 |

| Validation | Final result |
|---|---|
| Exact 18 closure checkpoints in complete canonical journeys | 18 PASS |
| Objective-language, correction, return and scope suite | 44 parser cases + 70 live turns PASS; additional pure assertions PASS |
| Frozen Wave 11 | 131 PASS / 1 unchanged `utilities.usage.read` FAIL / 0 BLOCKED |
| IQ-1 safety | 10 journeys / 44 turns PASS; zero forbidden executions; one intended isolated test-sink invocation |
| Existing regression matrix | 19 PASS / 4 unchanged FAIL |
| Typecheck / build | PASS / PASS |
| Diff checks / changed-file credential-pattern scan | PASS / no findings |

The four broader FAILs are phase-C reload, multigang, correction and durable
continuation. Their assertion text matches controls at
`45e89d299956fdd041f70f5937dbcc750a35aa6b`; they were not relabelled PASS.
The passing matrix covers semantic/capability, persistence, context/memory,
authority/privacy, security/adversarial, action/workflow, device truth,
public qualification, knowledge and One-Core boundaries.

An intermediate Wave 11 run exposed an additional maintenance-return
regression. It was fixed and the complete relevant matrix rerun; the final
result above has only the original utilities failure. Zero recognized
assessment/advice turns returned a capability catalogue. Prior whole-envelope
PASS answers remained unchanged.

The exact 18-item closure set was extracted and committed before runtime
changes in `artifacts/intelligence-quality-v1-iq2c-closure-corpus.json`.
It contains each prompt, objective, subject, assessment, expected envelope,
observed deficiency, trace, shared mechanism and canonical owner. Historical
raw result-set snapshots were not present in IQ-2B's artifact; the freeze
explicitly records that limitation rather than inventing them.

| Shared mechanism | Closure IDs | Count |
|---|---|---:|
| Assessment erased during an intervening turn | OMA-009:4,5; CON-003:5,7; CON-008:6,7 | 6 |
| Inconsistent subject/operand/label precedence | OMA-008:5; FAC-005:5; FAC-010:5,7 | 4 |
| Public correction fails to supersede facts | OSA-004:7 | 1 |
| Requirement purpose lost behind a domain name | OMA-006:4,5; OSA-003:6; FAC-007:6; FAC-008:7; CON-009:7 | 6 |
| Counterfactual evidence question misclassified | OMA-003:6 | 1 |
| Total | No downstream-only turn added to this set | 18 |

## Corrections and ownership

### Domain return and subject precedence

The existing `conversation_assessment` contract gains only a `suspended`
flag and a bounded `requirement_purpose` discriminator. It still uses the
existing canonical persistence writer and 30-minute TTL. No per-surface
memory, new context store, retrieval planner or orchestrator was added.

Precedence is now:

1. Cancellation/confirmation/action governance remains first. Cancellation
   clears the assessment; a mutation attempt cannot preserve its selected
   action target or derived-result pointer.
2. Explicit current-turn correction or named subject takes precedence over
   an old subject. Scope changes invalidate incompatible target/claim links.
3. An explicit return or appropriate anaphoric follow-up may resume a paused
   read-only assessment. A generic fresh question does not blindly resume
   the last narrow assessment.
4. A legitimate domain-return read remains on its existing authorized
   capability path. A named-room assessment retains its conversation label
   rather than substituting a raw room list.
5. Existing authorized result-set references may identify comparison
   *domains*. They do not establish a ranked/compared candidate set. Missing
   candidates are clarified, not fabricated.
6. A display label never grants scope. Explicit estate-wide scope clears an
   obsolete building label.

The suspended object stores no action directive and grants no authority.
Its expiration is not extended by an intervening retrieval. This change
preserves the single existing assessment across a temporary interruption;
it is not a new stack of autonomous objectives.

### Funding and consumer continuity

An intervening attempted commitment no longer erases the funding question.
Target links are removed, while read-only subject context survives for an
authority/advice follow-up. Unbound financing information remains unverified
and is retained during target clarification. No reassessment calculation
or execution is performed.

Utility-causality context survives a wallet lookup and its anaphoric return.
The corrected Study subject survives wallet retrieval and an explicit room
return. A newly explicit room subject still takes precedence over an earlier
utility subject. Cancellation cannot restore a device intent through this
read-only context.

### Public correction semantics

`correctedPublicFacts` extends the existing public opportunity contract.
Correction grammar replaces the active location, area or ownership-status
value while preserving the same opportunity. Location replacement checks
that the rejected location matches the prior active value. A corrected area
may inherit its already-known unit. Family ownership is an unverified
caller assertion, not title/representation authority. No-sale constraints
remain preserved by the existing qualification logic.

Live tests prove location, numeric area, family ownership and no-sale
continuity through a summary. Superseded facts remain in immutable message
history, not simultaneously active in `known_facts`.

### Comparison and stale labels

The visitor-versus-maintenance comparison retains both domain operands from
the current authorized result and the explicit question. It asks which
items to compare when no candidate set exists. No ranking is manufactured.
Reply advice retains the CRM/draft subject rather than allowing an incidental
financing constraint to replace it. A missing draft target is explicitly
unconfirmed and cannot become a recipient or send authorization.

### Sensitive requirements

Existing eligible read-capability metadata still supplies evidence domains.
The additional purpose discriminator explains the relevant missing class:

- ownership: authoritative assignment/ownership or representation status;
- privacy: authorized scope and consent/ownership status, not private contents;
- safety: current incident/device observability and authorized procedure;
- handoff: an authorized maintenance/support route and its permitted scope;
- counterfactual: evidence that could resolve a blocker, not an assertion
  that a new fact or recommendation already exists.

These are requirement descriptions, not new capabilities, queries, policy
decisions or promises of successful reporting. Responses do not ask for
credentials or unnecessary personal information.

## OMA-001

The original production-derived journey retains business attention,
prioritization, explanation, unverified financing information and reassessment
in sequence. No capability catalogue replaces the assessment. No old lead
ordinal substitutes for an unestablished priority set. Financing is clarified
when no project target is sufficiently resolved. High-quality ranking is
still downstream, not claimed as delivered by IQ-2C.

## Verification method

The unchanged 280-turn runner executes complete journeys so all 18 closure
checkpoints have real preceding context. `scripts/iq2c-review.mjs` asserts
their objective, subject, retained facts, requirement purpose and bounded
response from those executions. It is an evidence analyzer, not a second
behavioural harness.

The existing focused suite now includes 44 parser cases, 70 live canonical
turns, and pure TTL/correction/subject assertions. Its changed assertions
describe the intentionally restored paused context; the frozen IQ/Wave 11
corpus and expectations were not edited.

The existing isolated Supabase launcher verifies the loopback fixture,
rejects production targeting and keeps credentials out of output. No schema
or production change was needed. The focused suite does not claim durable
trace coverage where a trace key is absent; the full IQ suite does.

Commands and exact run hashes are recorded with the final result artifact:

```sh
npm run typecheck
npm run build
node scripts/iq1-local-run.mjs script /tmp/iq2c-final2-focused scripts/iq2-objective-smoke.mjs
node scripts/iq1-local-run.mjs iq /tmp/iq2c-verified-iq
node scripts/iq1-local-run.mjs wave11 /tmp/iq2c-final2-wave11
node scripts/iq1-local-run.mjs adversarial /tmp/iq2c-verified-safety
node scripts/iq1-regression-run.mjs /tmp/iq2c-verified-regressions
node scripts/iq2c-review.mjs /tmp/iq2c-verified-iq.json /tmp/iq2c-final2-focused.json /tmp/iq2c-verified-safety.json /tmp/iq2c-final2-wave11.json /tmp/iq2c-verified-regressions.json
git diff --check
```

These are the exact executed commands. Use fresh output prefixes on any
future rerun because the approved runner refuses overwrites. No skipped or
blocked test is counted as PASS.

## Files changed

Runtime:

- `src/oyi-core/context/conversationAssessmentContext.ts`
- `src/oyi-core/context/publicOpportunityObjective.ts`
- `src/oyi-core/interpretation/SemanticFrameParser.ts`
- `src/oyi-core/orchestration/ConversationOrchestrator.ts`
- `src/oyi-core/capabilities/PublicOpportunityCapabilityModule.ts`

Tests/evidence:

- `scripts/iq2-objective-smoke.mjs`
- `scripts/iq2c-freeze.mjs`
- `scripts/iq2c-review.mjs`
- `artifacts/intelligence-quality-v1-iq2c-closure-corpus.json`
- `artifacts/intelligence-quality-v1-iq2c-results.json`
- this report.

No dependency, provider configuration, capability registry, migration,
production environment, frozen baseline or frozen expectation was changed.

## Commits and approval boundary

- `b11c4b22ed50492c4e040b5e07bd6328896d56e7`: pre-edit 18-gap freeze.
- `32e6835e5c4f89c17cb0f93138fbff6537906955`: shared mechanism fixes and tests.
- `95d7fc59aa7ba7b2cba2878bda32f8430a0e4e25`: governed domain-return regression fix.
- The following evidence-only commit contains this report and final review.

The frozen 280-turn baseline, original diagnostics, IQ-2B result, Wave 11
corpus and the new 18-item pre-fix set remain unchanged. Source hashes and
raw run hashes are in the final machine-readable artifact. No merge,
deployment, production operation or IQ-3 implementation was performed.

**IQ-2 CONVERSATIONAL OBJECTIVE CERTIFIED — IQ-3 APPROVAL REQUIRED**
