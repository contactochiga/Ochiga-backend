# IQ-10A — Scope, cancellation and hazard safety

## Decision

**IQ-10A SAFETY INVARIANTS CERTIFIED — IQ-10B APPROVAL REQUIRED**

This is targeted certification of the six diagnosed safety mechanisms, not
overall intelligence quality, independent IQ-9B recertification, multi-gang
control certification or approval to release to production. No merge, deployment,
production access, schema migration, provider change or IQ-10B–F work occurred.

## Starting state and frozen contract

- Worktree: `/Users/ochigaidoko/Documents/oyi-intelligence-quality`.
- Branch: `codex/intelligence-quality-v1`.
- Clean starting local and GitHub HEAD: `6b10df3a1922c6308e21a4be59b29e4df2383544`.
- Origin: `git@github.com:contactochiga/Ochiga-backend.git`.
- Contract committed **before runtime edits**: `f11dc5b7de6a7db40848638ff06144e131595dd8`.
- Contract: `docs/INTELLIGENCE_QUALITY_V1_IQ10A_SAFETY_CONTRACT.md`.
- Machine evidence: `artifacts/intelligence-quality-v1-iq10a-certification.json`.

The IQ-9C forensic findings were used to define invariant families. No sealed
IQ-9B run was replayed or rescored. New scenarios use different phrasing and
synthetic dwelling/device references. Existing approved Wave 11 entities supply
positive controls. No physical-device executor was used.

## Implemented boundaries

### Requested, authorized, retrieved and presented scope

`scopeProvenance.ts` is a pure answer-boundary check, not another authority
engine. It consumes the existing SemanticFrame and authenticated actor/OIS
scope. Eligibility and permissions remain in CapabilityService/canUse.

- Explicit incompatible dwelling references and non-own household requests
  terminate before evidence routing or equivalent Office fallback.
- Office/public household-wallet questions cannot become Office portfolio
  balances. A separate authorized Office financial request still works.
- Consumer requests cannot silently become the current resident's own records
  when the requested household is different or unverified.
- Actual evidence-envelope scope is carried to canonical response context;
  mismatched evidence is withheld, including its identifiers/counts.
- Planner contributions retain their collector's effective scope, not a copy
  of requested scope. Denied/unavailable contributions do not supply provenance.
- Existing result-set metadata carries original source scopes through filter,
  ordinal and priority continuations. The sole canonical persistence writer
  prevents subsequently attached facts/result sets from reviving denied data.
- Authenticated resident-memory scope remains valid without an OIS selection;
  request-supplied scope is never used as its authority.

No private evidence or prompt fields were added to Intelligence Trace.
No parallel persistence, registry, orchestrator or action engine was introduced.

### Terminal cancellation

The existing semantic withdrawal contract no longer uses short device-name or
token-count limits to recognize explicit cancel/abort/revoke/withdraw/retract
or negated commands. Hyphen expansion cannot change command polarity.

Cancellation still passes through the existing workflow/action services and
their terminal state machines. Compound withdrawal is processed before a
separate request. Old confirmations, target answers and topic returns cannot
revive the cancelled action. A fresh explicit request creates a different
action requiring new confirmation. Existing optimistic state transitions and
authority gates remain intact.

Negative personal preferences and restrictions on claiming/promising completion
are distinguished from withdrawing an action. This preserves Osa qualification
and callback-truth controls while broadening device withdrawal recognition.

### Hazard admission

Hazard history is derived server-side from the already-authorized conversation
history read. It is not client authority or a new memory store. Forced-entry
recognition now covers the general force/entry-object relationship.

Before workflow continuation, clarification or a new mutation proposal, Core
checks current and retained hazard reports. Incompatible pending device intent
is cancelled through the existing services; an ordinary energizing request
does not survive merely because a warning was appended. Failure to restore
safety history fails closed for device admission.

Hazards do not expire just because an assessment TTL passes or a different topic
is discussed. A later less-restrictive report cannot erase an earlier gas risk.
There is deliberately no unverified "hazard resolved" transition. This is
conservative conversation-scoped behavior, not a claim of physical observation.

Explicit power-off under electrical/fire risk may reach the existing governed
path; target, authority and separate confirmation remain mandatory. Gas,
intrusion and water reports do not grant an electrical-control exemption.

## Coverage of the six diagnosed P0 mechanisms

| Mechanism | Frozen forensic cases | New invariant coverage |
|---|---|---|
| Denied population substituted by another readable population | Oma-P046; Consumer-P047/P049 | Household/surface matrices across wallet, maintenance, visitors and devices; unknown identifiers, named owner, retrieved-scope mismatch; own-scope/Office positives |
| Named and compound cancellation leaves executable intent | Consumer-P065/F022 | Long/hyphenated names, pending clarification and confirmation, repeated approval, topic return, multipart read remainder, fresh distinct action; IQ-1 reload/failed-action controls |
| Warning appended after hazardous action admission | Consumer-P067 | Sparking, smoke, overheating, forced entry and water; pending proposal invalidation; approval/target continuations; gas-risk retention; protective-action confirmation boundary |

Coverage is mechanism-level. The frozen IQ-9B findings and their original scores
were not rewritten to claim pass promotions.

## Validation results

| Gate | Result |
|---|---|
| New pure invariant cases | **49/49 PASS** |
| New isolated canonical safety scenarios | **33/33 PASS**, 70 conversational turns |
| Physical execution attempts in new scenarios | **0** |
| New observed P0 findings | **0** |
| IQ-1 cancellation/handoff/positive-control journeys | **10/10 PASS**; 0 physical attempts, one explicitly isolated in-process execution sink |
| Existing regression matrix | **53 passing suite outcomes; 5 known failing suite outcomes**, detailed below |
| IQ-7 held-out action/safety | **89/89 action; 19/19 safety** |
| IQ-7 held-out end-to-end | **45/45 PASS**, no menu/private acknowledgement leaks, 0 executions |
| Frozen 280 | **280 executed; 280 persisted; 277 unchanged answers; 3 reviewed scope-denial corrections** |
| Source provenance on frozen-280 factual responses | Every response carrying facts has retrieved source scope |
| Wave 11 unchanged structured corpus | **132/132 PASS**, 0 FAIL, 0 BLOCKED |
| Typecheck/build | PASS |
| Diff whitespace and changed-file secret checks | PASS |

The 280 corpus is a preservation check, **not 280 cognitive passes**. Its quality
grades were not regenerated using old annotations. The three changed answers are
OMA-009:6, CON-009:1 and CON-009:3: explicit denial replaces an unrelated-scope or
unavailable-source answer. No factual disclosure or execution was introduced.
All other answers are identical to a fresh archived starting-runtime control in
the same isolated world. The machine artifact contains before/after text.

IQ-7's other known parser misses remain: objective 219/226, subject 76/79, fact
65/66, follow-up 70/72. These match the preceding preservation report.

### Historical workflow exclusions

The four original reload, multi-gang, target-correction and durable-continuation
smokes retain their historical fixture failures. The separate ownership-corrected
diagnostic passes three cases and still fails target correction. Assertions were
not weakened. Its aggregate failing suite is the fifth failing suite outcome.
**Multi-gang remains excluded from release claims.** No new workflow safety
regression was observed; these are not converted into passes.

### Discovered test/implementation issues during this slice

- The first scope implementation rejected legitimate actor-scoped retained
  memory without OIS selection. Fixed; memory/privacy smoke passes again.
- Extending withdrawal recognition initially treated a prohibition on claiming
  callback completion as cancellation. Fixed at governing-verb semantics;
  the prior frozen answer is preserved in the final comparison.
- A new provenance test initially expected an actual device filter answer for
  an existing unsupported follow-up. That was an invalid evidence assertion,
  not permission to fix unrelated routing. The utterance remains in the test:
  unsupported returns no invented scope; an additional actual ordinal follow-up
  proves retained source scope. The failed intermediate run remains recorded in
  the artifact, together with the successful focused recheck. No frozen
  expectation changed.
- Early parallel fixture runs were discarded as final preservation evidence.
  Final control/candidate captures and regression fixture mutations ran in
  sequence. Old scripts' report writes are redirected to `/tmp`; all pre-existing
  docs/artifacts/scripts were checked byte-for-byte against the starting commit.

## Performance and remaining limits

Fresh archived control versus final candidate: p50 **126 → 91 ms**, p95
**279 → 157 ms**, mean **145 → 99 ms** per frozen turn. This is a local observation,
not a claimed speedup; warm caches and host load are uncontrolled. Hazard
continuity reuses the existing bounded history query. No provider calls or new
per-record queries were added.

Durable trace correlation remains **0/280** because the existing local fixture
schema lacks the planner-admission fields identified in IQ-9C. Conversation
persistence is separately proven at 280/280. No migration was run to conceal
the trace limitation; observability reliability remains for a separately
approved slice.

General language coverage and all underlying intelligence-quality failures are
not certified here. Unsupported filtering and historical workflow correction
remain product debt. Protective-action testing proves admission/confirmation,
not hardware effectiveness. No unobservable physical condition is certified safe.

## Reproduction and files

Use distinct output prefixes; never point these tools at production:

```sh
npm run build
npm run typecheck
node scripts/iq10a-invariants.mjs
node scripts/iq1-local-run.mjs script /tmp/UNIQUE-reg scripts/iq10a-regressions.mjs
node scripts/iq1-local-run.mjs script /tmp/UNIQUE-control scripts/iq10a-control280.mjs
node scripts/iq1-local-run.mjs iq /tmp/UNIQUE-candidate
node scripts/iq1-local-run.mjs wave11 /tmp/UNIQUE-wave11
node scripts/iq1-local-run.mjs script /tmp/UNIQUE-safety scripts/iq10a-safety-live.mjs
git diff --check
```

The machine report includes every suite outcome, source hashes, all new synthetic
turns, three preservation deltas and the IQ-1/IQ-7/workflow results.

Runtime files changed:

- `src/oyi-core/response/scopeProvenance.ts` (new).
- `src/oyi-core/response/answerTarget.ts`.
- `src/oyi-core/interpretation/semanticObjective.ts`.
- `src/oyi-core/orchestration/ConversationOrchestrator.ts`.
- `src/oyi-core/capabilities/CapabilityResponseAdapter.ts`.
- `src/oyi-core/contracts/conversation.ts` and `canonicalConversation.ts`.
- `src/oyi-core/evidence/planner/types.ts` and `bundle.ts`.
- `src/oyi-core/context/resultSetContext.ts`.
- `src/oyi-core/persistence/canonicalConversationPersistence.ts`.

New test tooling: `scripts/iq10a-invariants.mjs`, `iq10a-safety-live.mjs`,
`iq10a-regressions.mjs`, `iq10a-artifact-isolation.mjs`, `iq10a-control280.mjs`.
New documents/artifacts are this report, the frozen contract, and the machine
certification record. No other repositories or frozen benchmark files changed.

IQ-10B may proceed **only after separate user approval**. Nothing in this report
authorizes merging, deploying or beginning Initiative.
