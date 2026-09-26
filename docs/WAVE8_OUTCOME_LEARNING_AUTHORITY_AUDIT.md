# Wave 8 — Outcome & Learning Convergence — Slice 0 — Authority Audit

STATUS: READ-ONLY AUDIT. UNCOMMITTED. No source, test, or migration file was modified anywhere in either repository to produce this document.

Backend baseline: `f894140` (Wave 7 production checkpoint). Office: read-only throughout.

## 0. What this slice found, in one sentence

Oyi can prove an action was *attempted* and, for device commands, whether the *device* reached the commanded state — but nowhere in the codebase does anything independently re-check reality later and conclude "the thing we were actually trying to accomplish happened," and the one real evidence-driven learning proposal mechanism that exists (prediction confidence calibration) is provably disconnected at both ends: nothing promotes its proposals, and nothing would consume a promoted value if one existed.

## 1. Baselines

**Backend**: branch `main`, HEAD `f89414045c11d539f46d8eb1a25d7929ed1e6e17` (`f894140`) — matches the stated production baseline exactly, confirmed via `git fetch` + `git rev-list --left-right --count origin/main...HEAD` = `0 0`. `f894140` is trivially its own ancestor. Staged: none. Unstaged: the same two protected, pre-existing files carried through this entire programme (`scripts/pilot-import.mjs`, `src/routes/me.routes.ts`). Untracked: the same protected noise (aider artifacts, `opencode.json`, `pilot/luna-residences/`, prior audit docs, 5 `*_LOCAL_TEST_*.sql` migrations, plus this file) — none created or touched beyond this new audit doc.

**Office**: `/Users/ochigaidoko/ochiga-office`, branch `communications/handoff-accept-production-fix`, HEAD `b4a3a8f`, tracking `origin/communications/handoff-accept-production-fix`. Working tree: one untracked, unrelated `supabase/` directory. **Read-only for this entire audit** — confirmed by every research fork explicitly, zero writes.

## 2. The Wave 8 question

After Oyi decides and acts: what actually happened, did the intended outcome occur, how certain are we, why did it succeed or fail, what feedback was received, and what should change in future reasoning? This audit's job was to determine, from evidence, how much of this the current architecture can already answer — not to build the answer.

## 3. Semantic layers, locked

| Layer | Definition | Confirmed distinct in code? |
|---|---|---|
| EXECUTION | An action attempt occurred | Yes — `ai_execution_ledger` |
| VERIFICATION | Evidence about whether the action took effect | Yes — `physical_effect_status`, `verifyDeviceAction` |
| OUTCOME | Observed real-world consequence relevant to the Decision/Goal | **No canonical object exists** — see §24 |
| GOAL RESULT | Whether the desired objective was achieved | Exists as a status, but is workflow completion, not outcome — see §6 |
| FEEDBACK | Human/system evaluation of usefulness/correctness/result | Exists (`intelligence_feedback`, resident ratings) — see §10, §17 |
| EVALUATION | Comparison of intended vs. observed result | Exists narrowly, for 3 prediction types only — see §25 |
| LEARNING | Durable change proposed/applied to future reasoning | Proposal half real; application half unreachable — see §11, §26 |
| ADAPTATION | Actual modification of future system behavior | **Does not happen anywhere today** — see §26 |

These are not collapsed anywhere in the codebase in a way this audit found dangerous (no execution result is mislabeled as a goal result, no channel delivery is mislabeled as a commercial win) — but several layers above OUTCOME simply have no implementation, which is different from being conflated.

## 4. Exhaustive outcome inventory (summary — full detail in §§7–22)

Grepped repository-wide for every term the task listed. Every real hit resolves into one of the modules documented in detail below; no additional undiscovered outcome/learning mechanism was found beyond what §§5–22 catalogue. Two migrations anchor almost everything: `20260728143000_oyi_core_convergence_canonical_storage.sql` (`operational_recommendations`, `operational_insights`, `operational_plans`, `intelligence_feedback`, `operational_incidents`) and `20260814090000_oyi_learning_parameters.sql` (`oyi_learning_parameters`).

## 5. Execution-result authority

`ai_execution_ledger` (`src/services/deviceCommandExecutionStore.ts`) — `CommandLifecycleStatus` (12 values: `requested → validated → accepted_for_processing → dispatching → provider_accepted/provider_rejected → awaiting_state_confirmation → state_confirmed/state_mismatch/confirmation_timed_out → failed/cancelled`) plus `CommandPhysicalEffectStatus` (`confirmed | inferred | unknown | not_observable | contradicted`).

Truthfully answerable: requested (yes), authorized (no — that's upstream `DeviceCommandAuthority`, not recorded here), dispatched (yes), provider acknowledged (yes), verified (yes, via `physical_effect_status: "confirmed"`), failed (yes), timed out (yes, `confirmation_timed_out`), unknown (yes, honestly, via `unknown`/`not_observable` for IR/provider-ack-only devices).

**Truth ends at `physical_effect_status: "confirmed"`** — the ledger has an opinion on whether the device reached the commanded state and nothing more. `intelligence-core/verificationService.ts::verifyDeviceAction` consumes this same ledger and only ever returns `pending|verified|failed|timeout` — confirmed by direct read: no field or return value in either file references a Goal, Decision, or business objective. "Device turned off successfully" is exactly as far as this system goes; it has no opinion on whether an energy-saving Goal was served.

## 6. Verification authority

Same boundary as §5 — verification answers "did the device do what we told it," nothing more. No independent verification authority exists above the device-command level (e.g., nothing verifies "was the camera investigation actually resolved" as a distinct concept from "did a device command succeed").

## 7. Goal-result behavior

`goalEvaluator.ts::evaluateGoal()` sets `status: "completed"` at exactly four points, none of which constitute a real-world outcome check:
1. `success_condition.type === "reply_received"` + any inbound reply exists → completed (a reply happened, not that anything was achieved).
2. `success_condition.type === "positive_reply"` + sentiment classifier says positive → completed (a heuristic classification, not a verified result).
3. Plan array exhausted with no explicit success condition ever matched → completed ("Plan finished with no explicit success condition met" — pure workflow exhaustion).
4. Last plan step's own dispatch (`outcome.ok`) succeeded and no steps remain → completed — for a `device_action` step this is the exact same Wave 5 ledger result from §5, never an independent Wave 6 canonical-state re-check.

**Goal completion is workflow completion, not a genuine outcome authority.** No code path in `goalEvaluator.ts` queries Wave 6 canonical state, an Opportunity stage, or any external evidence to confirm the underlying objective was actually achieved.

## 8. Decision-outcome behavior

`oyi_decisions`' full column list (`decision_key, entity_type, entity_id, action_type, title, reason, status, requires_human, selected_by, authority_mode, policy_source, canonical_signal_key, recommendation_key, goal_id, plan_id, incident_id, awareness_key, superseded_by, metadata, created_at, updated_at, decided_at, closed_at`) contains no result, outcome, effectiveness, or feedback field. `status` is a selection-lifecycle state, not an outcome. `goal_id` is a lineage pointer, not a stored result.

**Answer: no, the system cannot currently ask "was Decision D-123 a good decision?" and derive an authoritative answer.** The only path to any evidence is a manual join through `goal_id` into `oyi_goals`, whose own "completion" is itself workflow completion (§7), not outcome truth.

## 9. Recommendation-outcome behavior

`operational_recommendations` has a real `outcome jsonb` column, but it is written in exactly two narrow, automatic senses: a human dismissed it (`recordFeedback()`, feedback_type ∈ {dismissed, not_useful, false_positive}), or the underlying incident resolved for any reason (`materialized_after_incident_recovery` / `resolved_by_signal` — the recommendation becoming moot, not evidence its advice worked). `accepted_by` exists as a column but has zero writers anywhere in the codebase.

**"Recommendation accepted" and "recommendation proved effective" are cleanly distinguishable — because the second concept does not exist at all.** Neither `outcome` write path constitutes causal effectiveness evidence.

## 10. Insight/Plan outcome behavior

`operational_insights`: has `confidence`, `status` (default `open`), `superseded_at` (real supersession) — no `result`/`resolution`/`outcome`/`feedback`/`effectiveness` column, and no update path beyond the bulk-materialization insert and the incident-resolution cascade's status flip.

`operational_plans`: has `approval_state`, `rollback_plan`, `status` (default `planned`) — same absence of any result/resolution/outcome/effectiveness field, same lack of any update path beyond the initial materialization insert.

**Neither object stores outcome, resolution, or effectiveness.**

## 11. intelligence_feedback assessment

Schema: `id, object_type, object_id, feedback_type, actor_id, reason, outcome_metadata jsonb, created_at` — generic, durable, indexed on `(object_type, feedback_type, object_id)`, no CHECK constraint on `feedback_type` (accepts any string).

Writers: `canonicalIntelligenceStore.recordFeedback()` (the generic path, reachable via the real, authenticated `POST /runtime/feedback` route) and `outcomeEvaluation.ts::persistOutcome()` (writes directly, `object_type: "oyi_prediction"`, `feedback_type: "outcome_evaluation"`).

Readers: **exactly one real consumer exists in the entire codebase** — `outcomeEvaluation.ts::summarizeEvaluatedPredictions[ByType]()`, which only ever reads the `outcome_evaluation` subset. The recommendation-dismissal subset (`dismissed`/`not_useful`/`false_positive`) is written and cross-updates `operational_recommendations.status/outcome` once, then is never aggregated or read again by anything.

**Classification: PARTIAL.** Real infrastructure, real writers, one real reader driving one real downstream consumer (§25/§26) — but most of what the table captures (the dismissal-feedback subset) terminates after a single write, never feeding anything back.

## 12. Learning-parameter assessment

`oyi_learning_parameters`: scoped (estate/home or global), versioned, bounded, 4-stage rollout (`observe → shadow → reviewed → enabled`). Real example: `prediction.device_reliability_risk.confidence_calibration`, bounded `[0,1]`, seeded at neutral `0.5`.

`assertLearnableParameter()` enforces a hard boundary in code (not merely convention): a forbidden-name regex blocks anything matching `permission|rls|access.control|financial.authority|confirmation.requirement|security.policy|safety.constraint|allowed.action.type|risk_class|authority`, and an allow-list restricts names to 7 namespace prefixes (`anomaly.`, `prediction.`, `forecast.`, `recommendation.`, `ranking.`, `notification.cooldown.`, `notification.suppression.`). This check runs on both read and promote paths.

`proposeLearningParameterAdjustment()` writes only `proposed_value`, never `current_value`. `promoteLearningParameter()` is the *only* function that can move `proposed_value → current_value`, and **has zero callers anywhere in the repository** — grepped exhaustively; every match is its own definition or a comment explaining it is deliberately never invoked. Separately, `getLearningParameter()` (the read function) has exactly one caller in the entire codebase: `learningProposalPass.ts` itself, seeding its own proposal. **No detector, ranking algorithm, or any other reasoning code anywhere reads `current_value` to influence its own behavior** — even in the hypothetical where a human manually promoted a value today, nothing would notice.

**Verdict, stated plainly: this is genuine, evidence-driven, well-governed proposal infrastructure — not a learning loop.** Proposals are generated from real evidence and durably stored; nothing promotes them, and nothing would consume a promotion if one occurred. The word "learning" in the filenames does not yet correspond to any actual effect on future reasoning.

## 13. Prediction-learning assessment

`docs/architecture/OYI_PREDICTION_LEARNING_MODEL.md` was read in full and cross-checked line-by-line against live code — **the document is accurate and self-aware**, explicitly documenting its own gap ("no automated evaluation loop yet proposes adjustments from real outcome data," "no automatic learning promotion") in terms that match independent grepping exactly. No discrepancy between documented design and live code was found.

Live trace (`outcomeEvaluation.ts`): `evaluateOpenPredictions()` re-queries `ochiga_intelligence_predictions` for open rows ≥24h old, and for exactly 3 prediction types with real evaluators (`device_reliability_risk`, `maintenance_sla_risk`, `automation_failure_risk`) independently re-derives `realized|not_realized|partial|unobservable` from freshly-queried current evidence (never from "was the recommendation clicked" — explicitly avoided). Results persist to `intelligence_feedback` and the source prediction closes. `summarizeEvaluatedPredictionsByType()` aggregates into an accuracy ratio, which `learningProposalPass.ts` proposes (never applies) as a confidence-calibration parameter.

**The calibration loop is open, not closed: evidence → evaluation → proposal, full stop.** Confidence is set at prediction time and evaluated later, but the calibration signal never feeds back into whatever originally computed a prediction's confidence.

## 14. Automation outcomes

Facility Automation: `applyVerificationOutcome()` sets `automation_approvals.status` to `succeeded`/`verification_failed` from the same Wave 5 ledger/`verifyDeviceAction` chain as §5 — device-level physical verification only. Its own code comment is explicit: *"No target entity to verify — execution result is authoritative"* — i.e., when there's nothing to check, dispatch success alone is the ceiling. **No field anywhere records whether the underlying problem the automation was responding to was actually resolved.** Consumer automation (`scenes.ts`) shares the same ceiling for any device-touching path; no separate business-outcome field was found.

## 15. Incident-resolution behavior

`operational_incidents`: `status` (default `open`), `resolved_at`, `evidence jsonb`, `current_summary` — no `resolution_reason` field, no FK to Decision/Goal.

Resolution mechanism: `incidentCorrelation.ts::isRecovery()` — a **text-pattern match on a new inbound signal's own metadata** (`/recovered|recovery|online|restored|resolved|healthy/`), run by the same single-signal correlation pipeline that created the incident — not an independent state re-check. When recovery is detected, the originating `operational_recommendations` row is also updated (`status: "resolved"`, `outcome: {resolved_by_signal: signal.id}`) — a real cross-link, but the payload is only a signal-id reference, not a semantic judgment.

`oyi_decisions.incident_id`: nullable, no FK, and **nothing anywhere in the repository currently writes it.** Schema-possible, unused in practice — same for any Decision→Goal→Incident lineage.

## 16. Current-state-as-outcome-evidence — CRITICAL, CONFIRMED MISSING

This is the audit's central negative finding. Searched explicitly for code that (a) records a Decision/Goal's intended target state, (b) later re-queries Wave 6 canonical current-state for that same entity, (c) compares the two and writes a conclusion.

**No such mechanism exists anywhere.** What exists instead, and exactly where it stops: the device path's `expected_state`/`observed_state` comparison lives only inside `ai_execution_ledger` — a same-transaction, provider-driven confirmation, not a later, independent query against Wave 6's own `CanonicalAwarenessReadService`/`DeviceCurrentStateAuthority`. The camera/incident path's `isRecovery()` infers resolution from a *new signal's own self-reported text*, not from re-querying `CameraCurrentStateAuthority` for the same camera and comparing against what the original Decision targeted. No table anywhere stores a "target state" as a distinct, later-comparable field tied to a Decision or Goal id — `Goal.target_entities` records identity, never a target *state*.

Both of the task's own worked examples — "device turned off → later state read confirms off" and "camera investigated → later CameraCurrentState reads healthy" — are **currently unproven by any code path**. This is stated as fact, not invented as a design gap to fill.

## 17. Temporal/causal limitations

Correlation-capable fields that exist: `operational_signals.correlation_id`/`execution_id`/`canonical_signal_key`, `oyi_decisions`'s full lineage set, `ai_execution_ledger.correlation_id`. **None are used for later causal cross-referencing.** `canonical_signal_key` and the ledger's `correlation_id`/`idempotency_key` are used exclusively for replay-idempotency/dedup throughout Wave 7 — never for "did event B happen because of action A." `isRecovery()` (§15) is the one place resolution logic runs, and it uses pure temporal-adjacent pattern matching on a new signal's own content, with zero reference to any correlation/execution/Decision/Goal id from the original triggering event.

**The current architecture cannot distinguish "state changed because of our action" from "state changed independently, coincidentally afterward."** This is a genuine, unaddressed gap.

## 18. Human-feedback inventory

| Mechanism | Repo | Classification |
|---|---|---|
| `intelligence_feedback` (generic) | Backend | OTHER (typed by caller-supplied `feedback_type`) |
| `maintenance_requests.resident_rating`/`.resident_feedback` | Backend | SATISFACTION |
| `maintenance_requests.verified_by_resident` | Backend | **OUTCOME** (factual confirmation, not a rating — confirmed as a separate column, not conflated with `resident_rating`) |
| `facility_incidents.verified_at`/`.verified_by`/`.evidence` | Backend | OUTCOME (staff-verified evidence) |
| Office `support` collection `resolution_notes` | Office | CORRECTNESS/OUTCOME (server-required before a case can close) |
| Office `crm_activities` | Office | OTHER (audit-trail log, not a rating mechanism) |

No demo/proposal/meeting satisfaction mechanism exists anywhere in Office. No conflation was found in Backend between subjective satisfaction and factual outcome fields — they are genuinely separate columns wherever both exist.

## 19. Office commercial outcomes

`crm_opportunities.stage`: frozen at `intake_received`, no PATCH route exists — unchanged from the Slice 7 finding, re-confirmed fresh.

**Real, previously-unconfirmed finding**: a proposal PATCH route (`PATCH /api/lead-agents/admin/proposals/:id`) exists, and both creation and this route share identical cascade logic — when a proposal resolves to `accepted`/`declined`, the code writes `commercial_stage: "won"|"lost"`, `status: "closed"|"lost"`, `lost_reason: "proposal_declined"` **onto the Lead, not the Proposal and not the Opportunity.** `commercial-ops.js` defines a real, used `PIPELINE_STAGES` enum (`new, contacted, qualified, discovery_scheduled, site_visit_scheduled, proposal_sent, negotiation, commercial_approved, won, lost`). Office does have real won/lost vocabulary — it is just attached to the wrong identity layer under the multi-opportunity model Slice 7 established (one Lead can have several simultaneous Opportunities; a single won/lost flag on the Lead cannot say which one).

Demos: `status` set at creation (`pending`/`confirmed`) — **no PATCH/update route exists at all**; a demo can never be marked completed/no-show/rescheduled via any live route.

`office_handoffs`: nothing records what happened after acceptance.

**Integrity finding**: the admin dashboard's "Conversions" statistic (`office-data.js`) is populated by **hardcoded literal values (34, 22, 14), not any real query over leads/opportunities.** This is display data presented as a real metric while being fabricated — a distinct and more serious finding than "no tracking exists."

## 20. Communication outcomes

`CommunicationOutcome` (channel/transport truth: `sent, delivered, read, replied, failed, bounced, blocked, opted_out, unreachable, unknown` for messages; `ringing, answered, no_answer, busy, failed, completed, voicemail, follow_up_required, unknown` for calls) is explicitly, self-documentedly separate in code from `InboundReplyOutcome` (business-meaning classification of a reply: `interested, not_interested, positive_reply, meeting_request, complaint, ...`) — the contract file's own comment states the distinction verbatim. Confirmed no conflation: separate types, separate producers, separate consumers.

**Important nuance**: `InboundReplyOutcome` values like `"interested"` are still only a reply *classification*, not a confirmed commercial outcome — no code path upgrades an `InboundReplyOutcome` into an Office-side won/lost determination. A delivered WhatsApp is not a sales outcome, and neither, currently, is a classified-positive reply.

## 21. Device outcome path

Decision (turn device off) → Execution (`ai_execution_ledger`, §5) → Verification (`physical_effect_status: confirmed`, §6) → **[MISSING LINK]** → Goal result. The Goal's own "completed" status (§7) is set directly from the execution dispatch result, not from an independent Wave 6 state re-check (§16). No step in this chain ever asks "was the underlying objective (e.g., energy saving) actually served" — only "did the device do what we said."

## 22. Camera outcome path

Decision (restore camera acquisition) → Goal → action/task → **[MISSING LINK — no code re-queries `CameraCurrentStateAuthority` for this camera and compares against the Decision's own target]** → result. `isRecovery()`'s text-pattern matching on a *new* signal is the closest existing proxy, and it is neither targeted at the specific Decision/Goal nor a genuine before/after comparison.

## 23. Decision → Outcome lineage matrix (the central Wave 8 matrix)

| Link | Status | Evidence |
|---|---|---|
| Decision | CANONICAL | `oyi_decisions`, Wave 7 Slice 5 |
| → Goal | CANONICAL (when populated) | `Decision.goal_id`, `attachGoalToDecision()` |
| → Plan/Step | CANONICAL | `Goal.plan` (`GoalPlanStep[]`) |
| → Action | CANONICAL | `executeRegisteredAction()` |
| → Execution | CANONICAL | `ai_execution_ledger` |
| → Verification | CANONICAL, narrow | `physical_effect_status`; device-only, no business-level verification exists |
| → State (independent, later re-check) | **MISSING** | §16 — no code path re-queries Wave 6 canonical state against a stored target and compares |
| → Outcome | **MISSING** | No object, no derived value, no query answers this (§24) |

## 24. Outcome-object verdict

**No canonical Outcome object exists anywhere in this codebase today.** The nearest outcome-like objects are: `operational_recommendations.outcome` (narrow, two automatic senses only, §9), `intelligence_feedback` with `feedback_type='outcome_evaluation'` (real, but scoped only to predictions, §11), and `ai_execution_ledger.physical_effect_status` (real, but scoped only to device commands, §5). None of these is general-purpose, none spans Decision/Goal broadly, and none is queryable as "the outcome of X."

**This audit does not decide whether Wave 8 needs a new canonical Outcome table or a derived evaluation over existing evidence — that decision belongs to a later slice**, per this audit's own explicit instruction. The evidence gathered here (three narrow, non-overlapping outcome-adjacent mechanisms, one genuine evaluation precedent to generalize from — §25) should inform that later decision, not preempt it.

## 25. Evaluation authority

`outcomeEvaluation.ts` is a genuine, real evaluator — but only for 3 prediction types, comparing a stored prediction against freshly re-queried evidence and producing `realized|not_realized|partial|unobservable`. This is the **one real precedent** in the entire codebase for "compare expected vs. observed and produce a judgment." No canonical evaluator exists for Decision, Goal, Recommendation, or Automation outcomes broadly — **MISSING** outside this one narrow domain.

## 26. Actual learning loops

Traced every real code path where an observed result could change future behavior:

| Loop | Input evidence | Change proposed | Approval | Persistence | Application | Rollback |
|---|---|---|---|---|---|---|
| Prediction confidence calibration | Real (`realized`/`not_realized` counts, ≥20 sample threshold) | Real (`proposed_value`) | **Defined but zero callers** | Real (`oyi_learning_parameters` row) | **Never happens** | Unexercised (version increments only on promotion) |
| Recommendation dismissal feedback | Real (`intelligence_feedback` writes) | None | N/A | Real (single status flip on the recommendation) | **Never read again by anything** | N/A |

**No true closed learning loop exists in this codebase today.** The single strongest candidate (prediction calibration) is real and evidence-driven on the input side, and provably dead on the output side — this is stated plainly, not softened.

## 27. Automatic vs. human-approved learning

| Mechanism | Classification |
|---|---|
| Learning-parameter proposal (`proposeLearningParameterAdjustment`) | ADVISORY_ONLY (writes a proposal, never a live value) |
| Learning-parameter promotion (`promoteLearningParameter`) | HUMAN_APPROVAL_REQUIRED by design, but **NOT_ACTUALLY_APPLIED** — unreachable, zero callers |
| Recommendation dismissal → recommendation status update | AUTOMATIC_SAFE (a real-time, single-record status flip, not a durable behavior change) |
| Any physical/commercial/pricing/policy/security parameter | Not learnable at all — hard-blocked by `assertLearnableParameter`'s forbidden-name pattern, §28 |

No mechanism anywhere silently widens authority — confirmed directly.

## 28. Learning safety boundary

`assertLearnableParameter()` (`learningParameters.ts`) is the enforced boundary, not a convention: a forbidden-name regex rejects any parameter matching `permission|rls|row.level.security|access.control|financial.authority|wallet.limit|confirmation.requirement|security.policy|safety.constraint|allowed.action.type|risk_class|authority`, checked on both read and promote. An allow-list additionally restricts every learnable name to 7 real prefixes (`anomaly.`, `prediction.`, `forecast.`, `recommendation.`, `ranking.`, `notification.cooldown.`, `notification.suppression.`) — nothing outside those namespaces can even be *created* as a learning parameter. `DeviceCommandAuthority`, permission tables, privacy rules, commercial pricing, approval thresholds, security policy, and provider credentials have zero code path connecting them to `oyi_learning_parameters` or any learning/feedback mechanism found in this audit. **Current protections are real, enforced in code, and — combined with `promoteLearningParameter`'s total unreachability (§12) — mean there is currently no path by which learning could widen authority even accidentally.**

## 29. ML/model-training finding

Reconfirmed: grepped for `tensorflow|pytorch|scikit|model\.fit|train_model|gradient|neural|sklearn|xgboost|\.h5|onnx` across the entire `src/` tree — **zero matches.** Wave 6's prior finding of no ML training in Backend is reconfirmed unchanged. Every "learning" mechanism in this codebase is application-level parameter tuning (proposed values, evidence thresholds), never model training.

## 30. Wave 9 (memory) dependencies

Not converged here, per instruction — identified only:
- `intelligence_feedback.reason` (free text) and `outcome_metadata` (jsonb) currently accumulate human-readable explanation with no structured retrieval — a Wave 9 knowledge candidate.
- `operational_insights`/`operational_recommendations`'s `evidence`/`reason` fields are similarly free-text accumulations, not structured memory.
- Conversation history and `intelligence_feedback` both currently write independently, with no shared identity — a future Wave 9 convergence question, not addressed here.

## 31. Feedback → knowledge boundary (documented, not implemented)

The boundary Wave 9 will need to design: a single feedback/outcome event (e.g., "this prediction was realized") is **evaluation-scoped** the first time it happens (it updates one prediction's own outcome); it becomes a **learning parameter** candidate once enough same-type evidence accumulates (≥20 samples, exactly as `learningProposalPass.ts` already gates it) and the pattern is about *calibrating a numeric value*; it becomes **knowledge** (Wave 9 territory) when the pattern is about a *durable fact or generalization* not reducible to a bounded numeric parameter (e.g., "Camera X in Building B is chronically unreliable in humid weather" is knowledge, not a calibration value). This audit does not implement any of this — it only names the three destinations so Wave 9 does not have to rediscover the distinction from scratch.

## 32. Observability / auditability

Oyi can currently explain: what Decision was made (`oyi_decisions`, full lineage columns), what Goal was pursued (`oyi_goals`), what action happened (`ai_execution_ledger`), and — narrowly — why a prediction was judged realized/not_realized (`outcomeEvaluation.ts`'s `notes` field, human-readable). **Oyi cannot currently explain**: whether a Decision's real-world objective was achieved (§16), why a Goal was judged "successful" beyond workflow completion (§7), what learning was proposed as a result of any given outcome beyond the 3 prediction types (§26), or whether any proposed learning was ever applied (never, §12). The audit trail is strong up through Execution/Verification and weak or absent from Outcome onward.

## 33. Multi-domain outcome matrix

| Domain | Decision lineage | Execution result | Verification | Observed state | Goal result | Human feedback | Outcome authority | Learning use |
|---|---|---|---|---|---|---|---|---|
| Device | CANONICAL (via GoalRuntime device_action) | CANONICAL | CANONICAL (device-level) | Wave 6 canonical state exists but not cross-checked (§16) | Workflow-only | None | MISSING | None |
| Camera | PARTIAL (no live Decision producer, §Wave7 audit) | N/A (mostly non-device) | N/A | Wave 6 `CameraCurrentStateAuthority` exists, uncross-checked | N/A | None | MISSING | None |
| Facility Automation | DOMAIN_SPECIFIC (`automation_approvals`, not `oyi_decisions`) | CANONICAL (device-level) | CANONICAL (device-level) | Not cross-checked to business outcome | N/A (automation, not Goal) | None | MISSING | None |
| Maintenance | DOMAIN_SPECIFIC (`maintenance_requests`, no Decision link) | CANONICAL (`completed_at`) | CANONICAL (`verified_at`, separate from completion) | N/A | N/A | CANONICAL (`resident_rating`/`verified_by_resident`, genuinely separated) | PARTIAL (verified_by_resident is real outcome evidence, but not linked to any Decision/Goal) | None |
| Visitor/Security | DOMAIN_SPECIFIC | CANONICAL (`entered`, gated behind `approved`) | Shallow (state-gate only) | N/A | N/A | None | PARTIAL (the approve→entered gate is real, minimal outcome proof) | None |
| Consumer | Same as Device | Same as Device | Same as Device | Same as Device | Workflow-only | None | MISSING | None |
| Office/CRM | PARTIAL (Slice 7 opportunity-aware Decision, JV only) | N/A | N/A | N/A | N/A | PARTIAL (Office `support` resolution_notes only) | PARTIAL, misattributed (Lead-level won/lost, not Opportunity-level, §19) | None |
| Communication | N/A (channel, not Decision-owning) | CANONICAL (`CommunicationOutcome`) | N/A | N/A | Feeds Goal success_condition (§7) | None | MISSING (channel outcome ≠ commercial outcome) | None |
| GoalRuntime | CANONICAL | Consumes Device/Communication execution | Consumes Device verification | Not cross-checked (§16) | Workflow-completion only (§7) | None | MISSING | None |

## 34. Duplicate-authority matrix

| Concept | Classification |
|---|---|
| Outcome | MISSING (no canonical object; three narrow, non-overlapping proxies) |
| Evaluation | STRONG_CANDIDATE (`outcomeEvaluation.ts`, real pattern, narrow scope — generalize, don't duplicate) |
| Feedback | PARALLEL-but-not-competing (`intelligence_feedback` generic + `maintenance_requests` resident fields + Office `resolution_notes`, each domain-appropriate, none claiming to be canonical over the others) |
| Learning Proposal | CANONICAL (`oyi_learning_parameters` proposal half, real and singular) |
| Learning Parameter | CANONICAL (same table), but functionally DOMAIN_SPECIFIC (only prediction-confidence values exist today) |
| Adaptation | MISSING (nothing ever applies a proposal) |
| Goal Result | STRONG_CANDIDATE for future Outcome authority, currently workflow-only |
| Execution Result | CANONICAL (`ai_execution_ledger`), correctly scoped to device commands only |

No two systems in this codebase claim to be the canonical Outcome/Evaluation/Learning authority simultaneously — the risk this audit was asked to rule out (semantic collapse / duplicate authority) is **not present**. The risk that *is* present is absence, not duplication.

## 35. End-to-end scenarios

**A. Device action succeeds and state confirms target.** Ledger reaches `physical_effect_status: confirmed`. Oyi knows: the device reached the commanded state. Oyi can prove: the same-transaction confirmation. Oyi cannot prove: that this served any Goal's real objective (no later independent check, §16). Nothing learns.

**B. Device provider acknowledges but state never confirms.** Ledger reaches `provider_accepted` with `physical_effect_status: unknown`/`not_observable`. Oyi knows: dispatch succeeded, effect unconfirmed. Oyi can prove: the honest uncertainty itself (this is a genuine strength — it does not fabricate confirmation). Oyi cannot prove: whether the device actually changed state. Nothing learns.

**C. Camera degraded → intervention → camera healthy.** Oyi knows: an incident existed and later closed (via `isRecovery()`'s text-pattern match on a *new* signal). Oyi cannot prove: that the intervention (vs. an unrelated coincidence) caused the recovery, nor that any Decision targeting this camera was fulfilled (§16, §22). Nothing learns.

**D. Maintenance marked complete but resident says unresolved.** Real, distinct fields exist for this exact scenario: `completed_at` (staff says done) vs. `verified_by_resident` (resident's own confirmation) — genuinely separate, §21. Oyi CAN represent this disagreement today; nothing currently reads the disagreement to change future maintenance dispatch/prioritization. Partial capability, no learning.

**E. Commercial follow-up delivered but Opportunity does not progress.** Oyi knows: `CommunicationOutcome: delivered`. Oyi cannot prove: anything about the Opportunity, because `crm_opportunities.stage` never transitions (§19) and no Decision/Goal is linked back to it beyond creation. Nothing learns.

**F. Commercial follow-up → reply → meeting → Opportunity progresses.** Oyi can classify the reply (`InboundReplyOutcome`) and can wake the Goal. Oyi cannot durably record "Opportunity progressed" because Opportunity stage is frozen (§19) — the only real progression mechanism found (proposal accept/decline → Lead `commercial_stage`) is Lead-scoped, not Opportunity-scoped, and ambiguous under the multi-opportunity model. Nothing learns.

**G. Goal exhausts attempts and needs human.** Real, honest: `attempts_completed >= max_attempts` → `blocked`; a device-actor/authority failure → `needs_human` (Wave 7 Slice 6). Surfaced via `HumanInterventionView`. This is a genuine strength of the current architecture — failure is never hidden or silently retried into fabricated success.

**H. Recommendation repeatedly rejected by humans.** Each rejection writes real `intelligence_feedback` (`feedback_type: dismissed`) and flips that one recommendation's own `status`/`outcome`. **Nothing aggregates repeated rejections of the same recommendation type to suppress or down-rank future similar recommendations** — confirmed by §11/§26: no reader of the dismissal-feedback subset exists anywhere. Nothing learns.

## 36. Proposed canonical Wave 8 architecture (design only — not implemented)

Based strictly on the evidence above, prefer existing strong authorities over new tables:

- **Outcome**: not a new standalone table. Propose a *derived evaluation* pattern, generalizing `outcomeEvaluation.ts`'s own proven shape (re-query current truth from the authority that already owns it — Wave 6 state, Office Opportunity stage, maintenance verification — compare against a stored target, write the conclusion to the existing `intelligence_feedback` table with a new, disciplined `feedback_type` family, e.g. `decision_outcome_evaluation`/`goal_outcome_evaluation`) rather than inventing a parallel Outcome object that would compete with `intelligence_feedback`'s existing, narrow-but-real role.
- **Evaluation**: a small number of new, narrowly-scoped evaluator functions (one per domain: device/state, camera/state, maintenance/resident-confirmation, commercial/Opportunity-stage) mirroring `outcomeEvaluation.ts`'s exact pattern — never a single generic "evaluate everything" function, since each domain's ground truth lives in a different existing authority (Wave 6, Office, maintenance).
- **Feedback**: keep `intelligence_feedback` as the single generic sink; do not create a second feedback table. Add a required, disciplined read-back for the dismissal-feedback subset (closing the loop §11 found broken) rather than a new object.
- **Learning**: keep `oyi_learning_parameters` and its proposal mechanism as-is (it is correctly designed and correctly narrow); the actual Wave 8 work here is (a) building the *first* real consumer of `current_value` for at least one namespace, and (b) deciding, with explicit human governance design, how `promoteLearningParameter` actually gets invoked (a reviewed admin action, not automatic).
- **Adaptation**: intentionally the narrowest layer — only ever a live-value read of an `enabled`-stage `oyi_learning_parameters` row, never a code change, never a permission/pricing/security change (§28's boundary must be preserved, not merely inherited).

Relationship to existing objects: Decision and Goal remain exactly as Wave 7 left them (Decision = selected course of action; Goal = pursuit runtime) — Outcome evaluation reads them, never writes them retroactively (§40). Recommendation remains advisory; its `outcome` column's two existing write paths are preserved, extended (not replaced) with the closed-loop dismissal aggregation from §11.

## 37. Proposed Wave 8 slices (ordered roadmap — not implemented)

1. **Slice 1 — Device/State Outcome Evaluator**: close the §16 gap for the device domain only (the narrowest, most evidence-supported case: Wave 6 `DeviceCurrentStateAuthority` already exists and is trustworthy). WEIGHT: MEDIUM. DEPENDENCIES: Wave 6 state authority, Wave 7 GoalRuntime. MIGRATION LIKELIHOOD: low (extend `intelligence_feedback` usage, possibly one new indexed `feedback_type`). RISK: low (read-only evaluator, no execution-path change). FROZEN SYSTEMS TO PROTECT: `DeviceCommandAuthority`, `ai_execution_ledger`, Wave 6 state authorities — read-only consumers only.
2. **Slice 2 — Recommendation Dismissal Feedback Loop**: close the §11/§26(H) gap — aggregate repeated dismissals of the same recommendation type/reason and surface it (read-only, advisory) without auto-suppressing anything. WEIGHT: SMALL. DEPENDENCIES: `intelligence_feedback`. MIGRATION LIKELIHOOD: none. RISK: low. FROZEN SYSTEMS TO PROTECT: `operational_recommendations`' own generation logic — this slice reads dismissal history, never mutates generation behavior automatically.
3. **Slice 3 — Goal Outcome vs. Workflow Completion Separation**: introduce an explicit, additive distinction on `Goal` between "workflow completed" (existing) and "outcome confirmed" (new, populated only when a Slice-1-style evaluator ran and agreed) — without changing what `status: "completed"` already means, to avoid breaking any existing consumer. WEIGHT: MEDIUM. DEPENDENCIES: Slice 1. MIGRATION LIKELIHOOD: likely (one additive nullable field/table). RISK: medium (touches GoalRuntime, a frozen-since-Wave-7 system) — requires the same care Wave 7's own slices used. FROZEN SYSTEMS TO PROTECT: `GoalRuntime`/`goalEvaluator.ts`'s existing completion semantics must not change for any existing consumer.
4. **Slice 4 — Commercial Outcome Evaluator (Office, narrow)**: the Opportunity-stage evaluator — but ONLY after Office itself gains a real Opportunity-stage PATCH mechanism (currently absent, §19, an Office-owned prerequisite this Backend session cannot build). WEIGHT: LARGE. DEPENDENCIES: an Office-side change outside this repo's control. MIGRATION LIKELIHOOD: none on Backend side (references only). RISK: high if attempted before the Office prerequisite exists — would have nothing real to evaluate. FROZEN SYSTEMS TO PROTECT: Office remains sole commercial system of record (Wave 7 Slice 7's own boundary).
5. **Slice 5 — Learning Parameter Consumer (first real application)**: build exactly one real reader of `oyi_learning_parameters.current_value` (the prediction-confidence namespace already has real evidence flowing into it) plus an explicit, human-gated promotion trigger (a real admin action calling `promoteLearningParameter`, with audit logging). WEIGHT: MEDIUM. DEPENDENCIES: none beyond existing `learningParameters.ts`. MIGRATION LIKELIHOOD: none (table already exists). RISK: medium — this is the first time a learning value ever influences live behavior; requires its own dedicated proof (shadow-mode comparison before `enabled`). FROZEN SYSTEMS TO PROTECT: `assertLearnableParameter`'s forbidden-name boundary must remain untouched and unexpanded.
6. **Slice 6 — Camera/Maintenance/Visitor Outcome Evaluators**: extend Slice 1's pattern to the remaining domains with real ground-truth authorities (`CameraCurrentStateAuthority`, `maintenance_requests.verified_by_resident`, visitor `entered` gate). WEIGHT: MEDIUM. DEPENDENCIES: Slice 1 (shared pattern). MIGRATION LIKELIHOOD: low. RISK: low. FROZEN SYSTEMS TO PROTECT: same as Slice 1, per-domain.

## 38. Wave 9 dependencies (explicitly deferred, not pulled into Wave 8)

Structured knowledge extraction from `intelligence_feedback.reason`/`outcome_metadata` free text; any shared identity between conversation history and outcome/feedback events; generalization from repeated outcome evidence into durable facts (§31's third destination) — all explicitly Wave 9's to design, not touched here.

## 39. Office / OMA / OSA implication (no agent changes made)

A converged Outcome/Learning Core would eventually let OMA/OSA understand follow-up effectiveness, demo effectiveness, qualification outcomes, proposal outcomes, conversion, loss reasons, and human-takeover outcomes **by querying the same generalized evaluator pattern (§36) scoped to Office's own authorities** (Opportunity stage once real, Proposal outcome, Demo outcome once a PATCH route exists) — never by building a private, parallel sales-learning system inside Backend. Backend would remain the evaluator/learning *infrastructure* owner; Office would remain the commercial *truth* owner, exactly as Wave 7 Slice 7 already established. This is architecturally consistent with everything found in this audit — no redesign implied, only extension of the existing ownership boundary.

## 40. Safety invariants preserved (verified, not merely asserted)

- **Wave 5 (authority/execution)**: no evaluator proposed here reads or writes `DeviceCommandAuthority`, the ledger's authorization fields, or any execution-authority table — confirmed by design in §36 (evaluators are read-only consumers of Wave 6/Office truth, never Wave 5 writers).
- **Wave 6 (truth/state)**: every proposed evaluator only *reads* canonical state; none proposes writing to any Wave 6 authority.
- **Wave 7 (Decision/Goal)**: §37 Slice 3 explicitly requires existing completion semantics to remain unchanged for current consumers — outcome confirmation is proposed as an *additive* signal, never a redefinition of `status: "completed"`.
- **No rewriting factual history**: every proposed mechanism is evaluate-and-append (write a new `intelligence_feedback` row, or an additive Goal field) — nothing in §36/§37 proposes mutating an existing Decision, Execution, or Goal record's own historical fields.
- **No permission widening**: `assertLearnableParameter`'s boundary (§28) is explicitly preserved untouched in §37 Slice 5, the one slice that touches live behavior.
- **No reinterpreting failure as success**: every scenario in §35 that ends honestly in doubt or failure (B, C partial, G) is preserved as-is; the proposed architecture adds evaluation *on top of* these honest states, never overwrites them with an inferred success.

## 41. Representative regression result

`npm run typecheck` — clean. `npm run build` — clean. Representative battery (10 items): `wave5-slice1-facility-automation-device-authority`, `wave5-slice2-facility-automation-system-authority`, `wave6-final-a-materialization`, `wave6-final-b-core-state-integrity`, `wave6-slice2-canonical-awareness`, `wave7-slice5-canonical-decision` (functional + SQL), `wave7-slice6-goalruntime-domain-generalization` (functional + SQL), `goal-runtime` — **10/10 passed.** No test was modified to achieve this; nothing in this session touched source.

## 42. Newly discovered risks

1. Office's "Conversions" dashboard statistic is fabricated display data (hardcoded literals), not a real query — a data-integrity/trust issue independent of Wave 8, worth flagging to Office's own maintainers regardless of when Wave 8 implementation begins.
2. `promoteLearningParameter`'s total unreachability means the "learning" system, as shipped, currently provides zero functional benefit despite real engineering investment — worth knowing before any stakeholder assumes calibration is already happening.
3. `maintenance_requests`'s lack of server-enforced sequencing (§21) means the resident-facing fields (`resident_rating`, `verified_by_resident`) could theoretically be set before real staff completion — a latent data-quality risk for any future evaluator built on top of them (Slice 6 should account for this, not assume clean sequencing).
4. The proposal/dismissal feedback loop (§11, §35 scenario H) silently discards signal today — every rejected recommendation is a wasted learning opportunity currently evaporating unread.

## 43. Whether understanding is sufficient to begin Wave 8 implementation

**Yes.** This audit found no ambiguity blocking a first implementation slice: the gap (§16, current-state-as-outcome-evidence) is precisely located, the one real precedent to generalize from (`outcomeEvaluation.ts`, §25) is fully understood, the safety boundary to preserve (§28, §40) is concretely verified, and a narrow, low-risk first slice (§37 Slice 1 or Slice 2) is ready to be proposed for explicit authorization. Nothing in this audit was invented — every claim above is grounded in a specific file, table, or grep result, cross-verified across three independent research passes plus direct verification.
