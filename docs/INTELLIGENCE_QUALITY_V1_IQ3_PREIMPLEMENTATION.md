# IQ-3 pre-implementation evidence checkpoint

Starting branch: `codex/intelligence-quality-v1`.
Starting HEAD: `bdcbeb8776df0f8cc4dbb13c8c2a0f346d33c691`.
Date: 2026-10-04. **IQ-3 is not certified. No planner has been implemented.**

## Verified evidence

The committed IQ-2C artifact and its hash-verified raw execution agree on 280
turns: 51 PASS, 224 FAIL, 5 BLOCKED; 280 persisted and trace-correlated. The
frozen expectations and all earlier artifacts are unchanged. This is analysis
of the existing execution, not a new behavioural run.

`artifacts/intelligence-quality-v1-iq3-preimplementation-audit.json` joins every
failed/blocked turn to its current answer, assessment, trace, returned fact
references and current registered capability metadata. It includes 78 registry
entries and evaluates candidate authority using the original synthetic actor
role and fixture context. These checks do not execute collectors or establish
request-specific scope eligibility.

## Fresh observed failure boundaries

| Primary observed boundary | FAIL turns |
|---|---:|
| Evidence planning | 133 |
| Evidence retrieval / source eligibility | 6 |
| Evidence selection | 5 |
| Reasoning / judgment | 8 |
| Prioritization | 2 |
| Reassessment | 1 |
| Initiative | 22 |
| Response composition | 11 |
| Reference continuity | 7 |
| Workflow / action explanation | 2 |
| Other: interpretation, supplied-fact attachment, ordinary selection | 27 |
| **Total** | **224** |

The 27 Other records are individually enumerated, not hidden in an unexplained
bucket. They include unrecognized supplied facts, public catalogue routing and
wallet-balance requests routed to transaction history. They cannot be fixed
merely by increasing the number of evidence reads.

These are observed stop boundaries, **not a proof of exclusive causal ownership**.
The evidence-planning category requires an active assessment, missing current
fresh fact domains and an explicit `evidence_needed` terminal state (plus one
individually reviewed suspended-context response). Judgment labels do not assert
that domain presence establishes sufficient evidence. Every record preserves
that uncertainty. The 5 fixture-blocked records remain separate and unchanged.

## IQ-3 candidate mapping

Of the 109 IQ-2 downstream-only turns, 100 have an active assessment with required
domains absent from the current fresh returned facts:

| Surface | Investigation candidates |
|---|---:|
| Office / Oma | 40 |
| Public / Osa | 3 |
| Facility | 31 |
| Consumer | 26 |

This is an investigation set, not 100 guaranteed fixes. A domain may have been
returned in an earlier turn; that does not establish that reusable evidence is
available now. Conversely, a current fact does not prove complete coverage.
The artifact records both context-claimed availability and actual current fact
domains, missing domains, matching read modules, rollout, operations, surface,
permission and scope requirements, and fixture `canUse()` results.

## Existing owners and limitations

1. `conversationAssessmentContext.ts` represents the objective, subject and
   evidence requirements, using the existing 30-minute TTL. Requirement metadata
   currently does not load evidence or certify completeness.
2. `ConversationOrchestrator.ts` normally resolves one module, calls `resolve`,
   collects its evidence, checks `assertEvidenceAllowed`, then builds its response.
   Its bounded assessment branch may terminate before that collection path.
3. `CapabilityService.ts` already owns capability eligibility and authority.
   Its privacy check does not independently verify every returned record's
   home/building membership; collectors and governed context remain essential.
4. `OyiEvidence` already supplies source, object, freshness, truth, privacy,
   permissions, authorized scope, confidence and payload. Reuse this contract;
   do not invent a parallel evidence or confidence model.
5. `canonicalConversationPersistence.ts` remains the sole thread-state writer.
   Its available-domain calculation must not overwrite future plan completeness
   with the weaker rule that one fact exists in that domain.

### Collector findings to resolve before fan-out

- Office collectors consume the permission-gated `operational_snapshot` supplied
  by Office. They do not query Office's database from Backend. Null sections mean
  unavailable, not zero. A planner cannot manufacture missing snapshot sections.
- Several device read capabilities allow the Facility surface but require a home
  scope. A Facility estate assessment cannot ignore that requirement.
- `maintenanceEvidence.ts` filters Facility reads by estate, not building. Its
  `currentScope` carries estate/home but no building. An assessment restricted to
  a building must not invoke this as though building scope were enforced. Until a
  collector can enforce that scope, the plan must report scope restriction.
- Maintenance returns `[]` when prerequisite scope is absent. Therefore collector
  output `[]` alone cannot prove AVAILABLE_ZERO_RESULTS. Precondition checks are
  required before collection.
- The capability interface has no cancellation signal or collection deadline.
  A promise timeout bounds the caller's wait but does not cancel the underlying
  read. Any implementation must state and test that distinction instead of
  claiming hard cancellation.
- Read-response construction is not equivalent to pure evidence collection.
  Public opportunity response handling can enter handoff behaviour. Assessment
  gathering must not call draft/execute/handoff paths merely because a module
  supplies evidence.

## Implementation boundary still to complete

Use existing CapabilityService/registry for deterministic selection, existing
collectors for reads, existing OyiEvidence for normalization, and existing
assessment metadata/persistence for references and plan outcomes. Before adding
fan-out, finish collector eligibility/zero-result/scope review. Do not resolve an
unsafe collector by widening authority or silently dropping scope constraints.

No ranking, provider call, multi-domain execution, cache, trace-schema change or
new subsystem was added at this checkpoint. No production operation occurred.

## Checks performed

- Certified starting HEAD and clean remote alignment verified.
- `npm run build`: PASS on unchanged runtime.
- Existing local-only launcher verified loopback fixture and frozen hashes.
- Diagnostic script: PASS; no collector or canonical conversation executed.
- No new 280-turn, Wave 11, safety, performance or privacy certification run yet.

The implementation and full requested validation remain outstanding. The scope
findings above are engineering requirements within IQ-3, not a request to begin
IQ-4 or to broaden production authority.

**IQ-3 NOT YET CERTIFIED**
