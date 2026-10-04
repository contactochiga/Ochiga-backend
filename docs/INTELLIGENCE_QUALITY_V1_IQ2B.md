# IQ-2B — objective completion and natural continuity

## Scope and decision

Starting branch: `codex/intelligence-quality-v1`.
Starting HEAD: `74b892f73a4dacf6332900462994c1cac38b09a8`.
Runtime candidate: `d0a7fd8e0f303437619b21363a46de5ab4498b45`.

**IQ-2 NOT YET CERTIFIED.** Recognition improved, but recognition is not
equivalent to correct subject continuity or a useful evidence requirement.
The candidate review preserves 18 objective-layer deficiencies instead of
classifying every response carrying an objective as an IQ-3 problem.

No IQ-3 work, evidence fan-out, ranking engine, provider call, production
change, migration, merge or deployment was performed. The existing IQ
runner and frozen 280-turn envelopes and Wave 11 corpus were not edited.

## Pre-edit review

All 112 primary IQRC-004/006 turns were reviewed before runtime edits.
The committed evidence is
`artifacts/intelligence-quality-v1-iq2b-prefixed-gap-map.json`.

| Category | Meaning | IQRC-004 | IQRC-006 | Total |
|---|---|---:|---:|---:|
| A | Objective not recognized | 10 | 26 | 36 |
| B | Wrong objective type | 0 | 0 | 0 |
| C | Wrong topic | 3 | 6 | 9 |
| D | Follow-up lost | 2 | 1 | 3 |
| E | Generic evidence requirement | 21 | 36 | 57 |
| F | Correctly bounded; downstream limitation | 2 | 5 | 7 |

Category F is not an IQ-2 failure. Pre-edit objective metadata coverage was
27/38 and 48/74; those counts were never treated as semantic correctness.

## Final results

| Measure | Before | After |
|---|---:|---:|
| Full IQ PASS / FAIL / BLOCKED | 46 / 229 / 5 | 47 / 228 / 5 |
| Observed unresolved P0 / P1 / P2 | 0 / 215 / 14 | 0 / 214 / 14 |
| IQRC-004 objective metadata | 27 / 38 | 38 / 38 |
| IQRC-006 objective metadata | 48 / 74 | 73 / 74 |
| IQRC-004 correctly bounded/handled | 2 / 38 | 29 / 38 |
| IQRC-006 correctly bounded/handled | 5 / 74 | 65 / 74 |

The remaining IQRC-006 turn without objective metadata is intentional:
CON-009:6 explicitly asks what can be accessed in the resident's own home.
Scoped capability discovery now answers that question and is the single new
whole-envelope PASS. Wallet retrieval is improved but still does not explain
spending versus physical consumption, so it was **not** upgraded to PASS.

Of the 94 handled/bounded targeted turns, 93 still fail their full envelope
for downstream evidence execution/selection, judgment, derived-result,
reassessment or initiative demands. One fully passes. The other 18 retain
IQ-2 defects. Post-review categories: A=0, B=1, C=4, D=7, E=6, F=94.

| Surface | Full PASS | FAIL | BLOCKED | Targeted objective handled / total |
|---|---:|---:|---:|---:|
| Oma / Office | 7 | 61 | 2 | 34 / 40 |
| Osa / Public | 10 | 60 | 0 | 2 / 4 |
| Facility | 17 | 51 | 2 | 32 / 37 |
| Consumer | 13 | 56 | 1 | 26 / 31 |

All 280 IQ turns persisted and correlated to durable traces. No accepted
turn disappeared, and no physical/external execution occurred in the IQ run.

| Validation | Result |
|---|---|
| Focused objective tests | PASS: 44 parser cases, 63 live canonical turns, plus pure state/TTL assertions |
| Frozen IQ | 47 PASS / 228 FAIL / 5 fixture-BLOCKED |
| Frozen Wave 11 | 131 PASS / 1 unchanged utilities FAIL / 0 BLOCKED |
| IQ-1 adversarial safety | PASS: 10 journeys / 44 turns; zero forbidden execution attempts; one intended isolated sink invocation |
| Existing regression matrix | 19 PASS / 4 unchanged FAIL; assertion-equivalent controls verified |
| Typecheck / build | PASS / PASS |
| Diff whitespace / changed-file credential-pattern scan | PASS / no credential findings |

The 23-suite matrix includes semantic/capability, terminal persistence,
authority/privacy, adversarial/security, workflow/action, device truth,
public qualification, context/reference/memory, knowledge and One-Core guards.
No skipped suite is counted as PASS.

There were no capability-catalogue responses among the recognized assessment,
advice, explanation, comparison, prioritization or reassessment records.
Focused active-assessment stale-list collision tests pass, including the
OMA-001 ordinal. This is **not** a claim of zero domain-return defects:
CON-008 still demonstrates the residual issue documented below.

## Implementation

### Recognition and subject

The existing `SemanticFrameParser` recognizes grammatical families for:
epistemic/evidence audits; implicit routine assessment; comparative and
counterfactual modal questions; advice and delegation; summary/brief requests;
reassessment; causal questions; negative factual statements; and explicit
capability/information discovery. The parser still separates the cognitive
job from the evidence domain and mutation intent.

An existential negative statement such as a missing feasibility study is
information, not a reject/confirm command. Imperative cancellation stays on
the IQ-1 path. A feasibility study is not labelled as a room.

The existing assessment context now describes subject domains and an optional
user-supplied subject label. A building label does **not** establish building
authorization. Subject names use existing domain vocabulary, not invented
capabilities. Explicit corrections clear incompatible targets and assertions.

### Ephemeral context, not a new memory system

The existing `conversation_assessment` thread metadata remains the sole
assessment representation. The existing canonical persistence writer owns
its write lifecycle. TTL remains 30 minutes. Context references cannot gain
freshness merely by repeatedly renewing conversational TTL.

Fields added within that existing context:

- `subject_domains`, `subject_label`;
- `required_evidence_domains`, `available_evidence_domains`,
  `missing_evidence_domains`, `restricted_evidence_domains`;
- `target_ref` for an already-selected same-scope object;
- `material_information` with `source: user_assertion`, never verified truth.

Existing `pending_information` retains an unbound claim when no sufficiently
confident target exists. No raw evidence is stored in this contract.

### Continuity and precedence

Natural anaphoric follow-ups include why/how come, ordinals, pronouns,
definite issue/project references, and terse continuations such as “So?”,
“Still?” and “Then what?”. Active assessment precedes an older unranked list.
Selected-object explanations must use a fresh, authorized, same-subject
result set. Missing derived rankings produce clarification rather than a
fabricated ordinal target.

Explicit retrieval, capability discovery, cancellation and mutations retain
their existing precedence. This conservative clearing behavior still loses
some read-only assessment continuity after intervening turns; it is recorded
as residual IQ-2 debt below, not hidden as downstream judgment work.

### Evidence requirements and bounded responses

Requirements are derived from **eligible existing read-capability metadata**
and the current subject. Listing a requirement never invokes a collector or
handler, grants permission, widens scope, or claims the evidence was loaded.
Available domains mean context references/facts are present, not that those
facts completely prove an assessment. Restricted or unavailable subjects
are stated honestly.

Existing authorized Home/Facility and public qualification responses remain
available when topic-appropriate. General assessment/advice is not routed to
capability advertising. Explicit “what can you do/access/share?” remains
legitimate discovery. This distinction is covered by focused tests.

The remaining weak point is specificity below domain level: for example,
“opportunity evidence” is not a sufficient requirement for a question about
sharing another person's private documents.

## IQ-EVAL-OMA-001

1. Office attention is recognized as assessment. The existing authorized
   Office overview returns bounded leads, opportunity, report and development
   facts. The assessment subject is business attention.
2. The top-three request is prioritization over that scope. It states the
   specific domain requirements and does not advertise capabilities or invent
   a ranking.
3. Explanation stays with the assessment. An unestablished second ranked item
   is clarified, not taken from the older CRM list.
4. The financing statement is retained as unverified pending information.
   Without a selected project it requests target clarification, not an
   invented binding or verified financing claim.
5. Reassessment stays attached to the same assessment. No completed ranking
   or materiality calculation is claimed.

This passes the bounded objective-chain checks, not the frozen journey's
complete executive-judgment envelope.

## Remaining objective-layer failures

The machine-readable post-review contains every one of the 112 turns, its
answer, trace ID, before/after category, actual context and review reason.

| Category | Remaining IDs (journey suffix:turn) |
|---|---|
| B | OMA-003:6 — counterfactual evidence question becomes present reassessment |
| C | OMA-008:5; FAC-005:5; FAC-010:5,7 — reply subject, comparison operand, or obsolete building label |
| D | OMA-009:4,5; OSA-004:7; CON-003:5,7; CON-008:6,7 — lost funding/utility/room continuity or public correction |
| E | OMA-006:4,5; OSA-003:6; FAC-007:6; FAC-008:7; CON-009:7 — ownership, privacy, safety or handoff requirement too generic |

No A remains in the targeted subset. There are 94 correctly bounded/handled
turns and 18 residual objective-layer failures. Correctly bounded does not
mean the requested business/operational judgment was completed.

In addition, CON-008:5 (outside the two primary root-cause groups) still
returns wallet state on “go back to the hot room”. The following room turn
now asks honest clarification rather than returning a stale room list, but
the full domain-return journey is **not** certified.

## Validation and reproducibility

The existing local launcher verifies the isolated fixture at loopback port
55421, rejects production targets, supplies local credentials without
printing them, and restricts network access. No production credential or
provider was used. Full IQ records are persisted and durable-trace correlated;
the focused tests do not claim durable trace coverage when no trace key is
configured.

Commands used:

```sh
npm run typecheck
npm run build
node scripts/iq1-local-run.mjs script /tmp/iq2b-verified-focused scripts/iq2-objective-smoke.mjs
node scripts/iq1-local-run.mjs iq /tmp/iq2b-verified-iq
node scripts/iq1-local-run.mjs wave11 /tmp/iq2b-verified-wave11
node scripts/iq1-local-run.mjs adversarial /tmp/iq2b-verified-safety
node scripts/iq1-regression-run.mjs /tmp/iq2b-verified-regressions
node scripts/iq2b-review.mjs /tmp/iq2b-verified-iq.json /tmp/iq2b-verified-focused.json /tmp/iq2b-verified-safety.json /tmp/iq2b-verified-wave11.json /tmp/iq2b-verified-regressions.json
git diff --check
```

Detailed exact totals and source hashes are in
`artifacts/intelligence-quality-v1-iq2b-results.json`. The review script is an
artifact analyzer, not a replacement harness. Prior seven-dimension scores
remain labelled prior scores, not fabricated new grading.

The four broader workflow suite failures must remain FAIL even when their
assertions match controls at `45e89d299956fdd041f70f5937dbcc750a35aa6b`:
phase-C reload, multigang, correction, and durable continuation. The known
Wave 11 utilities failure also remains FAIL, not BLOCKED or PASS.

## Files and provenance

Runtime files:

- `src/oyi-core/interpretation/SemanticFrameParser.ts`
- `src/oyi-core/context/conversationAssessmentContext.ts`
- `src/oyi-core/orchestration/ConversationOrchestrator.ts`
- `src/oyi-core/persistence/canonicalConversationPersistence.ts`
- `src/oyi-core/capabilities/PublicOpportunityCapabilityModule.ts`
- `src/oyi-core/capabilities/ReadCapabilityModules.ts`

Test/diagnostic files:

- `scripts/iq2-objective-smoke.mjs`
- `scripts/iq2b-gap-map.mjs`
- `scripts/iq2b-review.mjs`
- the two new IQ2B artifact files and this report.

Logical commits: `becc5f0` pre-edit evidence; `22b2fe8` governed requirements
and continuity; `1113b1a` causal subject handling; `2dc9c64` declarative
negation/stale explanation fence; `d0a7fd8` scoped labels and discovery.

Frozen baseline SHA-256:
`edd8914212a3661691ebb0046153f8d65b6081c7f5c1e63a4f36e45c0dba667d`.
The baseline, root-cause/failure-map artifacts and Wave 11 corpus were also
byte-compared with the starting commit. Frozen expectations were not changed.

## Approval boundary

Do not begin IQ-3 on the basis of improved recognition coverage. The residual
objective subject/correction/requirement defects above still prevent IQ-2
certification. No new architectural subsystem was introduced.

**IQ-2 NOT YET CERTIFIED**
