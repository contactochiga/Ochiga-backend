# Wave 7 — Decision & Planning Convergence — Slice 4 — Human-in-the-Loop Unification View

Status: COMPLETE. Local commit only, not pushed, not deployed.
Baseline: `84e70de` (Wave 7C, Slice 3 — lifecycle vocabulary normalization). Slice 0 audit: `docs/WAVE7_DECISION_PLANNING_AUTHORITY_AUDIT.md` §37 roadmap row 4, and §31–34's own "Human-in-the-loop consistency" finding.

## 0. What this slice is, and is not

This slice builds `loadHumanInterventionObligations()`, a read-only projection that answers "what currently needs a human, from what the caller is already authorized to see" across four real, existing human-intervention mechanisms. It is explicitly **not**: a universal approval workflow; a rename or merge of any domain's own intervention lifecycle; the canonical Decision object; a GoalRuntime generalization; a second writer of any kind. Every action a human takes in response to an obligation this view surfaces — approve, reject, confirm, cancel — still routes through that source's own existing endpoint/service, completely unchanged by this slice.

## 1. Baseline verification

- `git rev-parse HEAD` before work began: `84e70de8a790f69c730fb1d8825fb0341a0f4675` (`84e70de`) — matches expected exactly.
- `origin/main` at that time: 3 ahead / 0 behind (Slices 1–3's commits remain local-only, unpushed).
- Working tree showed exactly the same protected, pre-existing, unrelated noise present at every prior verification in this programme.
- Re-read the Slice 0 audit's own §37 roadmap row 4 text directly from source: *"Human-in-the-loop unification view: a queryable projection normalizing `automation_approvals`, `GovernedActionProposal`, and `oyi_goals.status='needs_human'` into one shape for UI/notification purposes, without changing underlying storage."* This matches the task prompt's own framing exactly — no discrepancy to resolve. The audit's separate §31–34 section independently names these same three as "three structurally different representations of 'waiting on a human,' no shared schema or vocabulary" — the ground truth this slice unifies at the read layer only.

## 2. Human-intervention source inventory

Search performed for: approval/approve/reject/confirm/handoff/takeover/assigned/review/manual/human/AI pause/escalation/requires_approval/pending_approval/awaiting/proposed/policy denial/override, across Facility, Office, GoalRuntime, conversation, communication, and physical-action confirmation.

| Source | Real? | Durable/queryable today? | Included |
|---|---|---|---|
| Facility `automation_approvals` (`status='pending_approval'`) | Real, real table | Yes — `facilityAutomationService.ts::listAutomationApprovals(estateId, status?)`, estate-scoped, already the real function behind `GET /automation/approvals` | **Yes** |
| Office `GovernedActionProposal` (`status='pending'`) | Real, JSONB in `oyi_conversation_threads.metadata` | Yes, but **only** via `officeActionProposal.ts::loadPendingOfficeActionProposal(threadId, actorId)` — no broader listing function exists anywhere in this codebase | **Yes** (thread-scoped) |
| `oyi_goals.status='needs_human'` | Real, real table, real writers (`goalEvaluator.ts:144,161,272`) | Yes, via `GoalRuntime.ts::listForActor(actorId, undefined, ['needs_human'])` — but **only** for goals with a non-null `requesting_actor_id` | **Yes** (actor-scoped, with a disclosed gap — §19) |
| `OyiWorkflow` (`oyi_conversation_workflows`, status in `awaiting_approval`/`ready_for_review`/`awaiting_clarification`) | Real, real table, real terminal/active constants (`WorkflowRepository.ts:13-14`) | Yes, but **only** via `WorkflowRepository::getActive(threadId, actorId)` — same narrow shape as the Office proposal source | **Yes** (thread-scoped) — a 4th real source beyond the audit's named 3, found by this slice's own broader search (§16) |
| Office handoff (`officeHandoffBridge.ts::requestOfficeHandoff()`) | Real outbound call | **No** — Backend never persists or re-reads the response; it is a one-shot fire call, Office is sole authority afterward | **No** (§13, disclosed) |
| Office `crm_tasks` | Real, but a separate Supabase project | **No** — Backend has no direct database access and no bridge read-list function exists (confirmed by explicit in-source comment, `governedAction.ts:8-10`) | **No** (§18, disclosed) |
| Communication AI-takeover (`CommunicationFailureReason.human_takeover_active`) | Declared in the type | **No** — zero writers anywhere in this codebase; not a real, observable state today | **No** (§16, disclosed) |
| Facility maintenance work (`maintenance_requests`) | Real | Yes, but is ordinary assigned work, not a decision/input gate | **No** (§15, explicitly excluded per this slice's own "don't convert work into approval" instruction) |
| Physical device-command confirmation (Wave 5) | Real, frozen | Yes, via existing Wave-5-owned authority | **No new gate created** — see §17 |

## 3. Intervention taxonomy

Four categories, each derived from a real, distinct mechanism found in source — not the suggested default list (AUTHORIZATION / CONFIRMATION / OWNERSHIP_HANDOFF / MANUAL_REVIEW / TASK-WORK_OBLIGATION / COMMUNICATION_TAKEOVER / POLICY_EXCEPTION) adopted blindly:

| Type | Meaning | Real evidence |
|---|---|---|
| `AUTHORIZATION` | A specific automation execution requires sign-off before it proceeds | `automation_approvals.status='pending_approval'` |
| `CONFIRMATION` | A specific proposed mutation/action awaits a yes/no from the actor who initiated it | `GovernedActionProposal.status='pending'`; `OyiWorkflow.status` in `awaiting_approval`/`ready_for_review` |
| `INPUT_REQUIRED` | The system cannot even form a proposal without more information from a human | `OyiWorkflow.status='awaiting_clarification'` |
| `ESCALATION` | An automated process (a Goal's own decision loop) hit a condition it cannot resolve itself and now needs a human to decide what happens next — nothing proposed awaits a yes/no | `oyi_goals.status='needs_human'`, real writers: stop-condition match, exhausted attempts, negative reply (`goalEvaluator.ts:144,161,272`) |

`OWNERSHIP_HANDOFF`/`COMMUNICATION_TAKEOVER` were considered and rejected: the one real candidate literal (`human_takeover_active`) has zero writers anywhere (§16). `TASK/WORK_OBLIGATION` was considered and rejected: Office tasks are unreachable from Backend (§18); Facility maintenance is real work, not a decision gate (§15). `POLICY_EXCEPTION` was considered and rejected: no mechanism was found where a system waits for a human to grant a policy exception — `facilityAutomationService.ts:605`'s `policy_no_longer_permits_execution` is an automatic system rejection, not something awaiting a human.

For each real mechanism, per the task's own required format:

- **automation_approval** — WHAT: a detected automation needs execution sign-off. WHY: the resolved execution level requires approval (or a human operator proposed it directly). WHO: any authenticated user of the estate (no additional role/permission gate exists beyond `requireAuth` + matching `estate_id` — confirmed by reading `facility.routes.ts:329-341`). WHAT object waits: the `automation_approvals` row itself (`plan_snapshot` frozen at proposal time). If nobody acts: `expireOverdueApprovals()` lazily flips it to `expired` past its own `expires_at`, on the next list/decide call. What resumes: the frozen `plan_snapshot` executes via the existing approve endpoint, or nothing (reject/expire).
- **conversation_proposal** — WHAT: a conversational mutation request awaits confirmation. WHY: `confirmation_required` was true for this operation's risk tier. WHO: only the exact `actor_id`/`thread_id` that created it (both checked). WHAT object waits: the `pending_action_proposal` JSONB inside that one `oyi_conversation_threads` row. If nobody acts: `expires_at` (10-minute TTL) lapses; `usablePendingProposal()` then returns null on the next read — no separate expiry sweep exists, it's a pure read-time check. What resumes: `ConversationOrchestrator.ts`'s existing confirm/cancel turn handling.
- **goal_escalation** — WHAT: a Goal's automated pursuit hit a wall. WHY: one of stop-condition match / max attempts reached / negative reply (the three real `needs_human` writers). WHO: `requesting_actor_id` if non-null; otherwise genuinely unknown (see §19 — not fabricated). WHAT object waits: the `oyi_goals` row itself, `next_evaluation_at` cleared so the scheduler never revisits it. If nobody acts: it waits forever — there is no expiry mechanism for `needs_human` goals (a disclosed gap, not invented here). What resumes: whatever conversational/manual flow a human uses to advance or close the goal (outside this slice's scope to trace further).
- **workflow (awaiting_approval/ready_for_review/awaiting_clarification)** — WHAT: a conversational device-action turn needs confirmation or missing input. WHY: `WorkflowStateMachine`'s own transition rules (Slice 3-inventoried, unchanged). WHO: `actor_id` on the row. WHAT object waits: the `oyi_conversation_workflows` row. If nobody acts: `expires_at` on the row (when set) governs; not independently re-verified beyond what Slice 3 already inventoried. What resumes: `WorkflowService.ts`'s existing transition handling.

## 4. Fragmentation proof

Two pieces of direct, real evidence (not manufactured):

1. **No function anywhere in this codebase answers "what currently needs a human from me" across even two of these four sources**, let alone all four. Each source's own consumer (Facility's `/automation/approvals` route, `ConversationOrchestrator.ts`'s proposal-load calls, `ConversationOrchestrator.ts:1817`'s single-goal status message, `WorkflowService.ts`'s own turn handling) only ever reads its own one source, for one specific scope, inline. There is no shared vocabulary, no shared identity shape, no shared read path — exactly the "genuinely inconsistent representations, not just naming differences" the Slice 0 audit itself already concluded (§31–34).
2. **The query surfaces themselves are asymmetric in a way that was only found by actually reading the code**, not assumed: `automation_approvals` and `oyi_goals` both support a genuine broad list (by estate, by actor, respectively), but `GovernedActionProposal` and `OyiWorkflow` support **only** a single-thread, single-actor lookup — there is no function in this codebase that can answer "list every pending conversation proposal" or "list every workflow awaiting clarification," at any scope, today. This is a real architectural constraint this slice's projection must honestly respect (§21), not something to paper over with a new broad query this slice was not asked to build.

This is a visibility/projection problem, not a write-authority problem — every source already correctly enforces its own write authority; nothing here proposes touching that.

## 5. Domain authorities preserved

Zero files under `services/facilityAutomationService.ts`, `services/goalRuntime/*`, `oyi-core/context/officeActionProposal.ts`, `oyi-core/workflows/*` were modified by this slice — confirmed by `git status --short` after implementation (§32). This module only *calls* their existing, already-exported read functions.

## 6. Projection contract

`src/oyi-core/presentation/humanInterventionView.ts`:

```ts
type HumanInterventionObligation = {
  id: string;                    // `${source_type}:${source_id}`
  source_type: "automation_approval" | "conversation_proposal" | "goal_escalation" | "workflow";
  source_id: string;
  intervention_type: "AUTHORIZATION" | "CONFIRMATION" | "INPUT_REQUIRED" | "ESCALATION";
  native_status: string;
  normalized_stage: LifecycleStageResult;  // Slice 3's normalizeLifecycleStage(), reused verbatim
  title: string;
  reason: string | null;
  created_at: string;
  due_at: string | null;
  actor: { id: string | null; estate_id: string | null };
  required_role: string | null;
  required_permission: string | null;
  lineage: { canonical_signal_key: string | null };
  scope: { estate_id: string | null; thread_id: string | null };
};
```

`required_role`/`required_permission` are `null` for every source today because none of the four real read/decide paths declared one beyond generic auth+scope matching (verified by reading each route/function, not assumed — §10). Fields whose source could not be proven were left out entirely rather than populated with a guess — no `assignee`, `priority`, or `resume_action` field exists in this contract because no source honestly provides one (see §10, §19).

`loadHumanInterventionObligations(query)` takes three independent, optional scopes (`estateId`, `goalActorId`, `thread: {threadId, actorId}`), one per queryable shape, and only queries the sources for which a scope was actually supplied — the caller proves its own authority for each scope exactly the way every existing authorized route already does (§9).

## 7. Stable identity

`id = "${source_type}:${source_id}"`, where `source_id` is always the authoritative source's own real primary identifier (`automation_approvals.id`, `GovernedActionProposal.proposal_id`, `oyi_goals.id`, `OyiWorkflow.workflow_id`) — never minted, never re-derived, never hashed. Re-reading the same obligation twice yields the same `id` because the underlying row's own id is stable.

## 8. Lifecycle stage reuse

`normalizeLifecycleStage()` is imported directly from `./lifecycleStage` (Slice 3, unmodified) and called once per obligation with the correct `objectType` (`automation_approval`, `conversation_proposal`, `goal`, `workflow` — all four already had real mapping tables in Slice 3). No second mapper was written. `native_status` and `normalized_stage` are both exposed side by side on every obligation, per the task's explicit instruction to preserve both rather than replace one with the other.

**Discovered gap in Slice 3's own coverage (not fixed here — Slice 3 is frozen):** reading `contracts/governedAction.ts` in full during this slice's research surfaced that `OfficeActionProposalStatus` actually has **9** declared values (`pending, confirmed, cancelled, expired, superseded, executed, execution_failed, verification_failed, verified`), not the 6 Slice 3's own inventory and `CONVERSATION_PROPOSAL_STATUS_MAP` recorded. The 3 missing literals (`execution_failed`, `verification_failed`, `verified`) will honestly resolve to `unknown` via Slice 3's own mapper today, which is the correct behavior for an unmapped literal — but the mapper's *coverage* is incomplete. Per this slice's explicit "Slice 3 is frozen" instruction, this is disclosed here rather than patched.

## 9. Authority / privacy

The view never widens visibility. Each source's obligations are only ever loaded when the caller supplies that source's own real scope:
- `estateId` → the exact same scope `GET /automation/approvals` already requires (`req.user.estate_id`, `requireAuth`).
- `goalActorId` → the exact same scope `GoalRuntime.listForActor()` already enforces (`.eq("requesting_actor_id", actorId)`).
- `thread: {threadId, actorId}` → the exact same actor/thread match `loadStoredProposal()` and `WorkflowRepository.getActive()` already enforce (`user_id === actorId`, `actor_id === actorId`).

No "executive sees everything" mode was invented — no evidence was found anywhere in this codebase of an existing policy granting any role blanket visibility across estates/actors, so none is added here. A caller wanting a broader view must supply broader real scopes it is independently authorized to hold (e.g. an operator's own `estate_id`), not a new bypass this module invents.

## 10. Who-can-act semantics

`required_role`/`required_permission` are `null` for all four sources, honestly, because none of the real decide/confirm paths declares one beyond auth+scope (verified directly: the Facility approve/reject routes check only `requireAuth` + matching `estate_id`, no `requirePermission` call found). `actor.id` is populated only where the source itself names one: `conversation_proposal.actor_id`, `goal_escalation.requesting_actor_id` (which is honestly `null` for material-event-created goals — not fabricated), `workflow.actor_id`. `automation_approval.actor.id` is `null` — the row itself has no "assignee," only `estate_id` scope; any estate member may decide it, per the real route.

## 11. Human waiting vs. human ownership

`human_takeover_active` — the one real candidate for "a human has already taken ownership" — was investigated and found to have **zero writers anywhere in this codebase** (a grep for the literal found only its own type declaration). Office's `lead_channel_states.ai_paused`/`human_status` is the actual authoritative source per the in-source comment at `communication.ts:161-166`, and Backend has no durable, re-queryable read of it — only a reactive send-failure discovery, not a listable state. This slice therefore represents **zero** "human has taken ownership" obligations — not because none exist in reality, but because Backend genuinely cannot observe them today. This is disclosed, not silently worked around by treating a failed-send reason as if it were a queryable object.

## 12. Approval vs. confirmation distinction

Preserved as two of the four `intervention_type` values (`AUTHORIZATION` vs. `CONFIRMATION`) rather than flattened into one "needs human" bucket — `automation_approval` (a manager-tier sign-off gate on an automation) and `conversation_proposal`/`workflow` (a yes/no confirmation from the same actor who initiated the action) are never assigned the same `intervention_type`.

## 13. Handoff disposition

Office's handoff outcome (`officeHandoffBridge.ts::requestOfficeHandoff()`) remains entirely PARALLEL and entirely out of this view. Confirmed by full-file read: it is a one-shot outbound HTTP call; its response (`status`, `routing_status`, both untyped opaque strings) is never persisted anywhere in Backend and never read again. There is no durable Backend-side record to project. Documented here as a genuine, disclosed capability gap for future Wave 7 work, not fabricated with an invented "handoff obligation" object.

## 14. Office commercial human intervention

Audited: development/JV handoff and commercial escalation both route through `oyi_goals.status='needs_human'` (GoalRuntime is already the canonical mechanism for Office's commercial follow-up communications per the Slice 0 audit's own §38) — these ARE represented, as `ESCALATION` obligations with real `canonical_signal_key` lineage back to the originating material-event signal when one exists. Staff assignment / commercial approval / proposal-negotiation escalation beyond what already flows through GoalRuntime or the Office handoff bridge were not found to have any other Backend-observable representation. Office's own autonomy was not touched or redesigned; this slice only proves a future executive/operator view CAN see "this commercial opportunity needs a human" via the goal_escalation source.

## 15. Facility human intervention

`automation_approvals` included as `AUTHORIZATION`. Maintenance work deliberately excluded — confirmed via `maintenanceTransition.ts`/`maintenance.controller.ts` (already read in Slice 3's own research) that maintenance requests are ordinary assigned work with a free-text status, not a decision/input gate; converting it into "approval" would misrepresent it. Security/operator review: no distinct durable "awaiting operator review" mechanism was found beyond what's already covered by `automation_approvals` and `OyiWorkflow`.

## 16. Conversation human intervention

`GovernedActionProposal` (durable, real table-backed JSONB, TTL'd) and `OyiWorkflow` (durable, real dedicated table) are both included — both are genuinely durable, current obligations, not transient UI state (both survive across turns and are read from Supabase, not held only in a response object). Human takeover (`human_takeover_active`) investigated and found non-durable/unobservable (§11). Unsupported/high-risk escalation: `OyiWorkflow`'s own terminal `unsupported`/`permission_restricted` states (Slice 3-inventoried) are terminal, not active obligations — they were already resolved by the time they reach that status, so correctly excluded from an "active obligations" view.

## 17. Physical-action confirmation disposition

No physical-action confirmation gate was added, modified, or duplicated. `DeviceCommandAuthority.ts`, `executeDeviceCommandForActor`, `devices.power.control`, the execution ledger, and verification were not touched (confirmed by `git status --short`, §32). `OyiWorkflow`'s `awaiting_approval` status (when it represents a device-action confirmation) is projected exactly as the existing workflow record already represents it — this view adds no new gate, it only reads the existing one.

## 18. Task inclusion rules

Office `crm_tasks`: excluded. Backend has no direct database access to Office's separate Supabase project (confirmed by explicit in-source comment, `governedAction.ts:8-10`) and no bridge function exists anywhere that lists tasks broadly (only mutation/status-transition bridge functions were found, e.g. `TASK_STATUS_TRANSITIONS`). Facility maintenance: excluded per §15 (real work, not a decision gate). No machine task, scheduler job, or retry is represented anywhere in this view — none of the four included sources represent those; they were never a candidate.

## 19. Resolution / disappearance behavior

No second completion state is kept anywhere in this module. Every call to `loadHumanInterventionObligations()` re-queries the four live sources fresh; an approved/rejected/expired automation approval, a confirmed/cancelled/expired proposal, a goal that has moved off `needs_human`, or a workflow that has moved off its three active-and-human-waiting statuses simply does not appear in the next call's results — because the underlying real query (`status = 'pending_approval'`, `status === 'pending'`, `statuses: ['needs_human']`, the three workflow status checks) already excludes it. Proven directly in the smoke's scenario B.

**Disclosed gap:** goals with a `null` `requesting_actor_id` (system/material-event-created — real, confirmed via `officeMaterialEventAdapter.ts:192`) that reach `needs_human` are **not reachable by any actor** through `GoalRuntime.listForActor()`, because that query filters `.eq("requesting_actor_id", actorId)`, which never matches `null` rows for any non-null `actorId` argument. This means such a goal could sit in `needs_human` indefinitely, invisible to this projection (and, in fact, invisible to `listForActor` under ANY existing caller today — this is not a limitation this slice introduced, it is a pre-existing gap this slice's research surfaced). Not fixed here (would require a new GoalRuntime query method, out of this slice's read-only-composition scope) — recorded as a genuine, real finding for whoever owns GoalRuntime next.

## 20. Write/action routing

No writer was added. `loadHumanInterventionObligations()` performs only `SELECT`-shaped real calls; every one of the four wrapped functions (`listAutomationApprovals`, `goalRuntime.listForActor`, `loadPendingOfficeActionProposal`, `WorkflowRepository.getActive`) is itself already read-only. There is no `approveHumanIntervention(id)` or any generic action function anywhere in this slice's code — a caller wanting to act on an obligation must go to that obligation's `source_type`'s own existing endpoint (`POST /automation/approvals/:id/approve`, the conversation confirm turn, etc.), using `source_id` to identify which row.

## 21. First consumer

**Not wired.** No safe existing consumer was found that could adopt this view without either (a) touching Wave-6-frozen executive-briefing code, or (b) inventing a new broad query capability this slice was not asked to build (see §4's asymmetric-query-surface finding — two of the four sources cannot even be listed broadly today). Per this slice's own explicit permission, it ships as a tested, documented shared read service only. No dashboard was built.

## 22. Query strategy / performance

Each of the four sources is loaded with exactly one bounded call shape per query (automation_approvals makes 2 real calls total per invocation — the existing lazy `expireOverdueApprovals()` sweep plus the list select, both already part of `listAutomationApprovals()` today, not added by this slice; the other three each make exactly 1 call). None scale with the number of rows returned — proven at 1/10/50/100 fixture rows in the smoke (`callCounts.automation_approvals` stays at exactly 2 regardless of row count). No N+1 pattern exists anywhere in this module because it never iterates rows to issue further per-row queries.

## 23. Partial source failure behavior

`HumanInterventionResult.complete` is `true` only if every source actually queried reported success; a failed source contributes zero obligations and is recorded in `sources[]` with `ok:false` and the real error text — the caller must not treat an empty-but-`complete:false` result as "nothing needs attention" (proven in the smoke's scenario G).

**Disclosed asymmetry:** this honesty is only as good as what the underlying wrapped function itself exposes. `listAutomationApprovals()` and `WorkflowRepository.getActive()` both genuinely `throw` on a real Supabase error, so this module's `ok:false` reporting is fully honest for those two sources (proven in the smoke). `GoalRuntime.listForActor()` and `loadStoredProposal()` (inside `loadPendingOfficeActionProposal()`) **both already catch their own errors internally and return an empty result (`[]`/`null`) instead of throwing** — meaning this module cannot currently distinguish "genuinely zero obligations" from "the query failed" for the `goal_escalation` and `conversation_proposal` sources specifically. This is a real, disclosed limitation inherited from the existing domain read surfaces, not fixed here (fixing it would mean modifying `GoalRuntime.ts`/`officeActionProposal.ts`, which this slice's job is to read from, not alter).

## 24. Dedup behavior

None performed. The four sources are independent domains (Facility automation vs. Office conversation vs. GoalRuntime vs. the device-action workflow machine) with no stable cross-reference found anywhere proving any two rows describe the same real-world obligation — `automation_approvals` has no `canonical_signal_key`/goal/recommendation reference at all (confirmed by reading its full schema, §2); `GovernedActionProposal` and `OyiWorkflow` likewise carry no cross-source identity. Only `oyi_goals` carries real lineage (`canonical_signal_key`, from Slice 2), and nothing else in this view shares that lineage to merge against. Proven in the smoke: four obligations from four sources remain four, never merged.

## 25. Lineage

`lineage.canonical_signal_key` is populated, honestly, only for `goal_escalation` obligations (the only source with real Slice-2 lineage). It is `null` for the other three sources — not fabricated, because none of their schemas (verified directly by reading each) carries a goal/recommendation/plan/signal cross-reference.

## 26. Slice 3 regression

`smoke:wave7-slice3-lifecycle-vocabulary` re-run clean (see §34 regression log). `lifecycleStage.ts` was not modified by this slice (confirmed by `git status --short`).

## 27. Slice 1/2 regression

`smoke:wave7-slice1-recommendation-authority`, `smoke:wave7-slice2-identity-chain-repair`, `smoke:wave7-slice2-identity-chain-repair-sql` re-run clean (see §34 regression log).

## 28. Wave 5 freeze proof

No file under `DeviceCommandAuthority.ts`, `executeDeviceCommandForActor`, `devices.power.control`'s capability handler, `executionLedger.ts`, or `verificationService.ts` was touched — confirmed by `git status --short`. Representative Wave 5 smokes re-run clean (§34).

## 29. Wave 6 freeze proof

No file under any canonical awareness/current-state/privacy/freshness/materialization-durability/Camera-Edge authority module was touched — confirmed by `git status --short`. Representative Wave 6 smokes re-run clean (§34).

## 30. End-to-end scenarios

All 7 (A–G) proven in `scripts/wave7-slice4-human-intervention-view-smoke.mjs`:
- **A** — a pending automation approval appears exactly once.
- **B** — an approved/rejected automation (excluded by the real source's own status filter) disappears; no second completion state was kept to contradict it.
- **C** — a commercial goal escalation appears with real `canonical_signal_key` provenance.
- **D** — AI-takeover is never represented as an approval (no real source exists for it — proven by asserting no `intervention_type` ever contains "TAKEOVER").
- **E** — a durable, current conversation proposal is included; a non-pending (already-confirmed) one is not.
- **F** — a cross-estate query only ever passes the caller's own supplied `estateId` through to the real, already-estate-filtered source call.
- **G** — a fully failed source reports `complete:false`, never a false "nothing needs attention."

## 31. Same-class search

No other "needs human attention" aggregator was found anywhere in this codebase — the closest candidates were the same single-source, single-scope read functions this module itself wraps (`listAutomationApprovals`, `loadPendingOfficeActionProposal`, `WorkflowRepository.getActive`, `GoalRuntime.listForActor`), each classified `DOMAIN_SPECIFIC` (real, correct, narrow, unchanged by this slice) rather than `CANONICAL_VIEW`/`PARALLEL_VIEW`/`LEGACY`/`GAP`. `buildExecutiveBriefing()` (Slice 3's own finding, `executive.ts:212`) reads recommendations/plans only, never any of these four intervention sources — classified `GAP` (a real future candidate for adopting this projection, not touched here per §21).

## 32. Files changed

- `src/oyi-core/presentation/humanInterventionView.ts` (new)
- `scripts/wave7-slice4-human-intervention-view-smoke.mjs` (new)
- `docs/WAVE7_SLICE4_HUMAN_IN_THE_LOOP_UNIFICATION_VIEW.md` (new, this file)
- `package.json` (one new script entry)

No other file touched — verified via `git status --short` showing exactly these four plus the same pre-existing, protected, unrelated noise present at baseline (§1).

## 33. Migrations

None. None needed. `loadHumanInterventionObligations()` has no persistence of its own — it is a pure read-time composition over four existing tables/stores, exactly as the roadmap's own row 4 anticipated ("without changing underlying storage").

## 34. Tests / results

- `npm run typecheck` — clean.
- `npm run build` — clean.
- `npm run smoke:wave7-slice4-human-intervention-view` — 25/25 checks passed (mocked `supabaseAdmin`, following the same established pattern as `wave7-slice1-recommendation-authority-smoke.mjs`, since this module has no pure-function seam — it composes four real Supabase-backed functions rather than duplicating their logic).
- `smoke:wave7-slice3-lifecycle-vocabulary`, `smoke:wave7-slice1-recommendation-authority`, `smoke:wave7-slice2-identity-chain-repair(-sql)` — re-run clean.
- Representative Wave 5/6 regression, `goal-runtime`, `oyi-conversation`, `oyi-core-privacy`, `office-internal-surface`, `office-automations-bridge`, `conversation-thread-lifecycle`, `resident-device-privacy`, `consumer-facility-scope-privacy` — re-run; results and any pre-existing/environmental failures recorded in §35, matching the same categories already documented in Slices 1–3's own reports.
- Real PostgreSQL was not used for this slice's own new code — `loadHumanInterventionObligations()` has no direct database dependency of its own (it calls existing functions that do); mocking `supabaseAdmin` at the same seam Slice 1's smoke already established was the correct, precedented choice, not a shortcut.

## 35. Environment failures

Same three pre-existing `OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY`-dependent Wave 5 smokes and the same pre-existing `oyi-office-intelligence-convergence` two-assertion failure already documented in Slices 1–3's own reports are expected to recur here for the same environmental reasons (confirmed unrelated to this slice's files by content, not merely by assumption — see the regression log for exact output).

## 36. Newly discovered gaps

1. Slice 3's `CONVERSATION_PROPOSAL_STATUS_MAP` is missing 3 real declared literals (`execution_failed`, `verification_failed`, `verified`) — §8, not fixed here (Slice 3 frozen).
2. Two of the four intervention sources (`GovernedActionProposal`, `OyiWorkflow`) have no broad listing capability anywhere in this codebase — only single-thread/actor lookups exist — §4, §21.
3. `GoalRuntime.listForActor()` and `loadPendingOfficeActionProposal()` both swallow their own query errors internally, limiting this view's partial-failure honesty for those two sources specifically — §23.
4. Goals with `requesting_actor_id: null` that reach `needs_human` are unreachable by any actor through the existing `listForActor()` query — §19.
5. Office handoff and Office `crm_tasks` remain entirely unobservable from Backend after the fact — §13, §18.
6. Communication AI-takeover (`human_takeover_active`) is a declared-but-dead literal with no real writer anywhere — §11, §16.

## 37. Commit SHA

Recorded in §39 of the final report delivered in this same turn.

## 38–40. Convergence status

Human-in-the-Loop Unification View: **CONVERGED** for the four real, evidenced sources this slice found. Slice 5 (per the Slice 0 audit's own §37 roadmap row 5) may begin only when explicitly requested — its exact name/objective: **"`Decision` object introduction: additive table modeled on `automation_approvals`' existing shape, generalized to `entity_type`/`entity_id` for any domain, coexisting with (not replacing) the Facility table initially."** Not started here, per this slice's own explicit stop condition.
