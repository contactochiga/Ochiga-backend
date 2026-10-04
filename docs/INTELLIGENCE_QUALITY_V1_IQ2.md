# IQ-2 — conversational objective and assessment recognition

## Scope and starting point

Branch: `codex/intelligence-quality-v1`.
Starting IQ-1 head: `50151a2f6706bc9aebf99513b09f406d48ee8401`.
Runtime candidate: `bad9882d94f5d73bcbd1be904bf4d8a3b1de95e8`.

No production, schema, migration, provider, dependency, merge or deployment changes. No IQ-3 evidence fan-out or IQ-4 ranking engine. Frozen IQ baseline, diagnostic artifacts, envelopes and Wave 11 corpus are unchanged.

## Verified interpretation defect

The existing SemanticFrame described domain, operation, mutation intent, entities and references, but not the cognitive job. `deviceOperation()` treated generic `why` as device diagnosis. Lexical domain selection considered rejected vocabulary before an `I mean` correction. `reject` could make a conversational meaning correction look like a mutation. Advisory questions mentioning power operations could become positive device instructions.

ConversationOrchestrator tried generic result-set follow-ups before retaining an assessment objective. Office active context retains record/domain identity, not an assessment; public opportunity state retains qualification facts, not general cross-surface cognition. The business fallback advertised capabilities when no ordinary capability matched. Consequently a prioritization question could receive a catalogue, followed by an ordinal bound to an older CRM list.

## Minimal contract and persistence

The existing SemanticFrame now has optional `cognitiveObjective` and `capabilityInquiry` fields. Objectives are `retrieve`, `summarize`, `assess`, `prioritize`, `compare`, `explain`, `advise`, `reassess`. These are NOT domains, capability keys, permissions or execution directives.

The existing parser owns recognition. No second parser, registry, orchestrator or model runtime was introduced. Hypothetical/advisory power questions do not create mutation intent; explicit polite power requests retain normal action governance. Meaning corrections remain clarification, while IQ-1 cancellation remains a terminal veto.

`conversation_assessment` uses the existing thread metadata and sole canonical persistence writer. Fields:

- objective: current cognitive move;
- surface and domain: conversational scope, not an access grant;
- question: current substantive assessment question, retained for explanation/reassessment;
- status: pending/evidence-needed vocabulary;
- optional result_set_id: pointer only to an actual current result emitted by existing prioritization or bounded Home/Facility assessment;
- optional pending_information: at most 1,000 characters of an unverified, unbound user claim; retained while clarifying its subject, never promoted to operational evidence;
- created_at, updated_at, expires_at: **30-minute TTL**, matching existing short-lived public context.

No new fact store, ranking formula, materiality weights, durable goal, DecisionRecord or memory system. Unresolved user claims are not promoted into verified facts. Their original turns remain in canonical conversation history. Ambiguous project claims trigger clarification instead of attaching financing to a stale lead. The minimal pending-information field was required because history alone did not preserve the active clarification obligation across a subject reply.

Thread ownership admission still runs before context access. The loader additionally checks actor and surface and rejects expired state. Explicit retrieval, mutation, cancellation or capability inquiry clears the assessment pointer. Scope correction updates it. It does not authorize any evidence access.

## Precedence and bounded response

1. Canonical identity/ownership and authority resolution.
2. Existing confirmation/cancellation/workflow authority. An advice question cannot answer a pending device-target clarification.
3. Existing communication, action and goal paths.
4. Assessment continuity before unrelated raw-list ordinals.
5. Existing derived-result references and bounded domain explanations remain usable.
6. Ordinary capability selection/evidence/response, or an honest non-executing assessment-pending terminal response.

The guard does not replace existing bounded assessment: public qualification uses the existing public opportunity capability; Home/Facility overview, selected-object explanation, anomalies and recommendations remain with their existing owners. Current anomalies are explicitly distinguished from a proven historical comparison. Existing Office overview retrieval is preserved, not expanded.

Explicit capability inquiries remain supported. Recognized assessment/advice questions cannot enter capability advertising merely because their semantic operation has no registry key. The terminal result is unavailable evidence/assessment, not a fabricated successful ranking or a new capability.

## Files and test boundaries

Runtime: `contracts/semanticFrame.ts`, `interpretation/SemanticFrameParser.ts`, `context/conversationAssessmentContext.ts`, `orchestration/ConversationOrchestrator.ts`, `persistence/canonicalConversationPersistence.ts`, `capabilities/PublicOpportunityCapabilityModule.ts`, `capabilities/ReadCapabilityModules.ts`, all under `src/oyi-core`.

Focused test: `scripts/iq2-objective-smoke.mjs`. It uses the existing isolated Wave 11 identity/world and actual canonical runtime. Loopback-only egress; device execution forbidden. Tests cover 21 parser distinctions, all four surfaces, a real stale CRM-list collision, scope correction, live metadata expiry, actor mismatch, domain switch and advisory questions during device clarification followed by cancellation. The original IQ and Wave 11 harnesses are not replaced.

## Validation and review

See the companion `artifacts/intelligence-quality-v1-iq2-results.json` for exact counts, candidate answers, trace correlation, root-cause accounting and limitations. Recognition is scored separately from satisfying the original cognitive envelope. A truthful pending assessment does not automatically become a benchmark PASS.

Commands use the existing IQ-1 isolated launcher (local credentials only in process):

```sh
npm run typecheck
npm run build
node scripts/iq1-local-run.mjs script /tmp/iq2-exact-focused scripts/iq2-objective-smoke.mjs
node scripts/iq1-local-run.mjs wave11 /tmp/iq2-exact-wave11
node scripts/iq1-local-run.mjs iq /tmp/iq2-exact-iq
node scripts/iq1-local-run.mjs adversarial /tmp/iq2-exact-safety
node scripts/iq1-regression-run.mjs /tmp/iq2-exact-regressions
node scripts/iq2-review.mjs /tmp/iq2-exact-iq.json /tmp/iq2-exact-focused.json /tmp/iq2-exact-safety.json /tmp/iq2-exact-wave11.json /tmp/iq2-exact-regressions.json
git diff --check
```

## Production-derived Oma journey

1. The attention question is `assess`; the existing authorized Office overview remains available. An ineligible Consumer/global recommendation match no longer redefines it as a request outside Office.
2. The three-item question is `prioritize`; it receives an honest pending assessment, not a capability catalogue. No fabricated ranking is created.
3. The ordinal comparison is `explain` on the active assessment; without an established ranked set it asks which item, not an unrelated older lead.
4. Financing is retained as unverified pending information. It asks which project rather than binding the Chairman's claim to a stale record.
5. The priority-change question is `reassess`; it does not pretend that a recommendation was recalculated.

These are phase-specific improvements, not completion of the frozen executive-judgment envelope. No whole-envelope failure is upgraded merely for acknowledging the job.

## Review standard and remaining boundary

### Exact-source validation

| Check | PASS | FAIL | BLOCKED |
|---|---:|---:|---:|
| Frozen IQ 40 journeys / 280 turns, before IQ-2 | 46 | 229 | 5 |
| Same IQ corpus, after IQ-2 | 46 | 229 | 5 |
| Wave 11 frozen 132 turns | 131 | 1 | 0 |
| Focused IQ-2 live turns | 23 | 0 | 0 |
| IQ-1 adversarial live turns (10 journeys) | 44 | 0 | 0 |
| Existing regression suites | 19 | 4 | 0 |

Additionally: 21 parser distinctions PASS; typecheck PASS; build PASS. IQ persistence **280/280**, trace correlation **280/280**. No physical execution attempt in the IQ-1 safety run; its separately isolated positive test sink remains supported. The four failing workflow suites (reload, multigang, correction, durable continuation) have assertions identical to clean-control head `45e89d299956fdd041f70f5937dbcc750a35aa6b`; they remain FAIL, not PASS. The Wave 11 failure is the unchanged `consumer-wallet` electricity-usage evidence case.

| Worker | PASS | FAIL | BLOCKED |
|---|---:|---:|---:|
| Oma | 7 | 61 | 2 |
| Osa | 10 | 60 | 0 |
| Facility | 17 | 51 | 2 |
| Consumer | 12 | 57 | 1 |

112 answers changed from IQ-1, with **zero additional complete-envelope passes**. Remaining severity: **0 P0 / 215 P1 / 14 P2**. This is conservative answer review, not an automatic score awarded for metadata or HTTP success. The five blocked turns remain their original fixture limitations.

### Original root-cause groups

| Frozen primary group | Original FAIL | Now PASS | Still FAIL | Objective recorded in candidate response |
|---|---:|---:|---:|---:|
| IQRC-004 | 38 | 0 | 38 | 27 |
| IQRC-006 | 74 | 0 | 74 | 48 |

The response-based triage below reconciles all 112 primary members. It identifies a next diagnostic boundary, **not** proof that the named future fix alone will cure the turn. Missing objective metadata is not silently treated as successful recognition.

| Remaining diagnostic boundary | IQRC-004 | IQRC-006 |
|---|---:|---:|
| Interpretation/objective continuity not established | 11 | 26 |
| Evidence selection/coverage | 3 | 17 |
| Judgment/comparison | 8 | 9 |
| Derived-result continuity | 2 | 0 |
| Fact update/reassessment | 3 | 0 |
| Initiative/specific next move | 11 | 22 |

No failure is relabelled communication-only to justify certification. No downstream whole-envelope PASS is claimed outside the two targeted root causes either. Per-turn answers, frames, traces, frozen envelopes, prior scores and triage labels are in the candidate JSON.

The candidate-only reviewer retains the frozen envelopes and reviews changed responses conservatively. Previous seven-dimension scores are labelled provenance, not newly calibrated scores. The two changed previously passing ordinal/reference turns in OMA-005 remain safe clarification passes: turn 2 did not establish a two-item recommendation, so the frozen allowance for materially ambiguous targets applies. That is not a claim that recommendation continuity now succeeds.

There is still an in-scope IQ-2 gap: the minimum recognition/state contract does not reliably prevent topic-inadequate bounded answers or preserve every natural follow-up. For example, a Facility question about what stale telemetry means can still receive maintenance/security counts. Broad questions also receive generic evidence-needed replies without a specific useful evidence request. These cannot all be deferred to IQ-3 as if interpretation were complete.

Existing owners are reused; new architecture is limited to optional fields on SemanticFrame and ephemeral thread metadata. Technical debt is the remaining objective-aware routing/continuity boundary and improving the specificity of honest limitations. No new provider, subsystem or authority exists. IQ-3 and IQ-4 have not begun.

Final decision: **IQ-2 NOT YET CERTIFIED**. This is not an overall intelligence certification.
