# Wave 7 — Decision & Planning Convergence — Slice 7 — Lead/Opportunity Identity Resolution

Status: COMPLETE. Local commit only, not pushed, not deployed. This is the seventh and final ordered slice of the accepted Wave 7 roadmap.
Baseline: Backend `b1dc656` (Wave 7F, Slice 6). Office: `ochiga-office`, branch `communications/handoff-accept-production-fix`, HEAD `b4a3a8f`, tracking `origin/communications/handoff-accept-production-fix`, 1 commit ahead of `origin/codex/office-extraction` (the repository's actual integration/default branch). Slice 0 audit: `docs/WAVE7_DECISION_PLANNING_AUTHORITY_AUDIT.md` §17–18, §37 roadmap row 7.

## 0. What this slice is, and is not

The Slice 0 audit found Backend's live commercial-goal path to be lead-only, with a dead `opportunity_id` field scattered across three places and a read-only reflection of a real Office `opportunity.id` nowhere cross-referenced. This slice's job was to determine, from evidence in both repositories, whether "Opportunity" is a real, necessary identity distinct from Lead — and if so, converge Backend's Decision/Goal machinery to use it, narrowly, without a schema migration, without redesigning OMA/OSA, and without Core becoming a second CRM. It found that **Opportunity already exists as a real table in Office**, correctly creates non-colliding rows for simultaneous pursuits, but that Backend was entirely blind to it — and that Office's own surrounding lifecycle (stage transitions, proposals, human handoff) has not yet converged around it either. This slice closes the Backend-side blindness only; it does not touch Office.

## 1. Baseline verification

- Backend: `git rev-parse HEAD` before work began: `b1dc656cdb71ba35dd4dc589e8ae67fc6143561a` — matches expected exactly. `git rev-list --left-right --count origin/main...HEAD`: `0  6` (6 ahead, 0 behind). Working tree: the same protected pre-existing noise verified in every prior slice.
- Office: resolved repository path `/Users/ochigaidoko/ochiga-office` (not under `Documents/`). Current branch `communications/handoff-accept-production-fix`, HEAD `b4a3a8f` ("Fix production handoff Accept 400"). `git remote show origin` reports `HEAD branch: codex/office-extraction` — the actual default/integration branch, matching this programme's own established workflow precedent. Working tree: one untracked `supabase/` directory (local CLI artifact, unrelated). **Office was read-only throughout this slice — zero files modified, zero commits made in that repository.**

## 2. Wave 7 record re-read

Re-read `WAVE7_DECISION_PLANNING_AUTHORITY_AUDIT.md` §17–18 (its own literal text, not a paraphrase) and the Slice 1–6 convergence records. Reconstructed, by direct source inspection (not memory): `Decision.entity_type`/`entity_id` (`src/contracts/decision.ts:48,86`, unrestricted `string`, no CHECK constraint — confirmed via the migration, `supabase/migrations/20260925100000_wave7_slice5_canonical_decision.sql:23`); `attachGoalToDecision()` (Decision→Goal lineage, Slice 5, additive-only); `GoalRuntime.linked_crm_records: Record<string, unknown>` (`src/contracts/goal.ts:205`, free-form); `GoalTargetEntities` (Slice 6 added `estate_id`/`home_id`/`device_id`, all optional — the exact precedent this slice's own `opportunity_id` field follows); `officeMaterialEventAdapter.ts`'s `activateDevelopmentRelationshipGoal()`/`recordDevelopmentJvDecision()` (the JV pipeline, Slice 5's first real Decision producer); `relationshipCommunicationPolicyForJv()` (untouched by this slice).

## 3. Office commercial identity — inventory (from a full read-only Office-repo audit)

| Object | Table | PK | Purpose | Live/Dead |
|---|---|---|---|---|
| Lead | `leads` | uuid | one person's relationship record across all channels; email-then-phone dedup, application-layer only, no DB unique index | LIVE (core) |
| Contact | `crm_contacts` | uuid | one person, CRM-canonical; email-only dedup (`upsertContactIdentity`) | LIVE |
| Organization | `crm_organizations` | uuid | one company/account; case-insensitive-name dedup | LIVE |
| **Opportunity** | `crm_opportunities` | uuid | one bounded commercial pursuit; `contact_id`/`organization_id`/`lead_id` FKs, `business_unit`/`inquiry_type`/`pipeline`/`stage`/`status`/`owner`/`source`/`metadata jsonb` | **LIVE (create+read); no PATCH route exists anywhere — stage is set once at creation and never transitions** |
| crm_activities | `crm_activities` | uuid | universal timeline; carries `opportunity_id` among 7 other object refs | LIVE |
| crm_tasks | `crm_tasks` | uuid | actionable follow-ups; carries `opportunity_id`, governed status machine | LIVE |
| office_projects | `office_projects` | text | internal development/deployment project; `linked_opportunity_id` FK | LIVE |
| office_development_projects | `office_development_projects` | text | public-website marketing showcase | LIVE but **zero FK to leads/contacts/opportunities** — commercially disjoint |
| office_portfolio_entries | `office_portfolio_entries` | text | deployed/customer building | LIVE, no contact/lead FK |
| office_private/partnership_relationships | (2 tables) | text | business-unit-specific relationships; `opportunity_id` FK | LIVE, full `STATUS_TRANSITIONS` machine |
| proposals | `proposals` | uuid | priced commercial document | LIVE, **`lead_id` only — no `opportunity_id`/`contact_id` column exists** |
| office_handoffs | `office_handoffs` | text | human takeover; `lead_id` keyed on the live JV path, `crm_opportunity_ref` column exists but is **never populated** by `requestHandoffForLead` | LIVE |
| deployment_projects / partners | (2 tables) | uuid | pre-CRM-convergence legacy | Not confirmed reachable from any current route |

**A real Opportunity table exists and is the live authority for pursuit-level identity** — this alone rules out verdict A.

## 4. Opportunity field inventory (exhaustive trace, Office + Backend)

| Occurrence | Classification |
|---|---|
| `crm_opportunities` table (`db/lead-agents-schema.sql:107`) | **LIVE_AUTHORITY** |
| `office-intake.js::runOfficeIntakeCrm` (creates a row per qualifying intake, no dedup against existing open opportunities) | **LIVE_AUTHORITY (creator)** |
| `crm_activities.opportunity_id`, `crm_tasks.opportunity_id`, `office_projects.linked_opportunity_id`, `office_private/partnership_relationships.opportunity_id` | **LIVE_REFERENCE** |
| `leads.opportunity_id` column | **DEAD** — not in `normalize-lead.js`'s `PATCH_FIELDS` allowlist, no write path sets it anywhere |
| `office_handoffs.crm_opportunity_ref` (JV path) | **PLACEHOLDER** — column exists, `requestHandoffForLead` never populates it |
| `crm.create_opportunity` / `crm.qualify_opportunity` (Office conversational actions) | **DEAD relative to `crm_opportunities`** — both only patch the Lead's own `status`/`commercial_stage`, confirmed by the action handler's own audit comment: "never creates an office_opportunities row" |
| Backend `src/contracts/corporateIntelligence.ts:68` `crm_opportunity_ref` (a different, `CorporateIntelligence`-scoped type) | **PLACEHOLDER** — declared, never populated at any write site |
| Backend `src/contracts/inboundCommunicationEvent.ts:36` `related_opportunity_id` | **DEAD** — hardcoded `null` at its one write site (`officeExport.ts:2358`, WhatsApp inbound webhook) |
| Backend `src/services/officeTaskBridgeService.ts:23` `opportunityId` param | **DEAD** — declared, never populated at either of its two call sites (`goalEvaluator.ts:99,192`) |
| Backend `src/oyi-core/capabilities/OfficeCorporateCapabilityModules.ts:339` `crmOpportunitiesReadModule` | **LIVE_REFERENCE (read-only)** — reflects `operational_snapshot.opportunities`, a summary Office itself computes and attaches; Backend never queries `crm_opportunities` directly (no DB connection to Office's store) |
| Backend `src/contracts/corporateIntelligence.ts:625` `operational_snapshot.opportunities` | **LIVE_REFERENCE (read-only)**, `{id, name, stage, days_since_activity, owner}` — a genuine but summary-only reflection |
| **NEW (this slice)** `src/contracts/corporateIntelligence.ts` `crm.opportunity_id` | **NEW WIRE FIELD** — required-nullable, mirrors `lead_id`'s own shape; honestly `null` until Office chooses to populate it |

## 5. Multi-opportunity proof (mandatory, Office-side, before this slice's own change)

Traced the landowner-with-three-pursuits scenario against real code: **Opportunity creation itself does not collide** — `runOfficeIntakeCrm` creates a fresh `crm_opportunities` row per qualifying submission, each with its own `stage`/`business_unit`/`metadata.development`. But two real collisions exist downstream, both **still present today, both out of this slice's scope to fix** (Office-side application logic, not schema, not Core):
1. **Proposals collide** — `proposals` has no `opportunity_id` column; `office.js:renderOpportunityDetail` resolves related proposals by `lead_id`, so every proposal for the person appears on every one of their opportunities' detail pages.
2. **Human handoff collides** — `findActiveHandoffForLead` dedups purely on `lead_id` + non-declined status; a second site's handoff request silently reuses the first site's already-active handoff record, even across different business units.

## 6. Property-interest scenario

No generic "Property"/"Listing" table exists. Two property enquiries from the same buyer do produce two separate `crm_opportunities` rows (undeduped creation), but pricing/demos/proposals are Lead-scoped (`proposals.lead_id`, `demos.lead_id`), so they remain visually indistinguishable between the two properties. Unresolved at the Office layer; not a Backend/Core concern.

## 7. Development-site scenario (traced end-to-end through the material-event pipeline)

Backend's real JV pipeline (`officeMaterialEventAdapter.ts::activateDevelopmentRelationshipGoal`), **before this slice**, deduped a new goal purely via `goalRuntime.findActiveForLead(leadId)` — confirmed by direct source read. For a landowner with two simultaneous JV sites (two real, distinct `crm_opportunities` rows, two real material events, same `lead_id`), the second site's `development_enquiry_received` event would find the first site's still-active Goal and **silently skip creating any goal for the second site** — a genuine, code-verified violation of this slice's own mandatory §26 requirement, not a hypothesis. This is the concrete defect Section 9 below fixes.

## 8. Identity-layer decision

CONTACT, ORGANIZATION, and OPPORTUNITY are all real, distinct, already-live identities in Office — not adopted speculatively, proven by schema + non-colliding creation behavior (§3, §5). GOAL (Backend) is confirmed, again, to be a different concept from OPPORTUNITY: Opportunity is Office's durable commercial system-of-record object ("what pursuit exists"); Goal is Core's autonomous objective runtime ("what is Oyi doing about it right now"). This slice does not conflate them — a Goal's `target_entities.opportunity_id` is a reference, never a redefinition.

## 9. Verdict

**B — OPPORTUNITY IS NEEDED AND ALREADY PARTIALLY IMPLEMENTED.**

Not A: the Lead object cannot represent simultaneous distinct pursuits on its own (§5, §7) — a real, separate Opportunity identity is necessary and already exists to fill that gap.
Not C: `crm_opportunities` is a real, live-authority table today, not missing.
B, specifically because: the identity object is real and correctly created, but (a) Backend/Core was completely blind to it (no wire field, no Decision/Goal targeting, no dedup), and (b) Office's own surrounding lifecycle (PATCH route, proposals, human handoff) has not converged around it either.

## 10. Implementation gate result

Per §21's own instruction for verdict B: "identify the smallest convergence changes; if they require no migration, implement narrowly." **This slice's Backend-side convergence requires zero schema migration** — `oyi_decisions.entity_type` is already an unrestricted `text` column (no CHECK constraint), and `oyi_goals.target_entities`/`linked_crm_records` are already `jsonb`. The narrow convergence was therefore implemented directly (not stopped-and-proposed), scoped to Backend only:

1. `src/contracts/corporateIntelligence.ts` — `CorporateMaterialEvent.crm` gains `opportunity_id: string | null` (required-nullable, matching `lead_id`'s own shape).
2. `src/routes/officeExport.ts` — the one construction site for this literal now reads `opportunity_id: safeText(crm.opportunity_id) || null` off the incoming JSON body. Honest: if Office is not yet sending this field, it is always `null`, never fabricated.
3. `src/contracts/goal.ts` — `GoalTargetEntities.opportunity_id?: string | null` (optional, additive, mirrors Slice 6's `estate_id`/`home_id`/`device_id` precedent exactly).
4. `src/services/goalRuntime/GoalRuntime.ts` — new `findActiveForOpportunity(opportunityId)`, mirroring `findActiveForLead`/`findActiveForDevice` exactly (real jsonb `@>` containment query, client-side terminal-status filter).
5. `src/oyi-core/ingress/officeMaterialEventAdapter.ts`:
   - `recordDevelopmentJvDecision()`: when `event.crm?.opportunity_id` is present, the Decision now targets `entity_type: "office_opportunity"`, `entity_id: opportunityId` instead of `office_lead`/`leadId`. Absent → byte-identical to pre-Slice-7 behavior.
   - `activateDevelopmentRelationshipGoal()`: dedup switches to `goalRuntime.findActiveForOpportunity(opportunityId)` when an opportunity id is known, else falls back to the exact prior `findActiveForLead(leadId)` check. `target_entities.opportunity_id` and `linked_crm_records.opportunity_id` are populated when known.
6. No changes anywhere else — `humanInterventionView.ts`, `lifecycleStage.ts`, `goalEvaluator.ts`, `goalScheduler.ts`, `DecisionStore.ts`, `officeTaskBridgeService.ts` (§16), and every Office file are untouched.

**This fixes §7's proven defect the moment Office populates `crm.opportunity_id` on a material event, with zero Office code changes required for Backend's side to be correct** — and zero regression for every event that does not carry one.

## 11. No proposed migration

None. See §10.

## 12. Decision relationship

Confirmed via §10.5: when Office supplies an opportunity id, the Decision now targets it directly (`entity_type: "office_opportunity"`), per this slice's own §13 instruction ("future commercial Decisions should generally target Opportunity where the decision concerns the pursuit"). No historical Decision row was rewritten — this is forward-only, applying only to Decisions created after this change, for events that carry the new field.

## 13. Goal relationship

`GoalRuntime.findActiveForOpportunity()` is the concrete, narrow answer to this slice's own §14 question — implemented, not deferred, because it required no migration. Lead compatibility is fully preserved: `findActiveForLead` is unmodified, still the fallback for every event without an opportunity id, and one Goal never silently absorbs a second, independent pursuit for the same lead now that opportunity-scoped dedup exists.

## 14. Communication relationship

Unmodified — `CommunicationRuntime`, `linked_communication_threads`, and thread ownership remain exactly as Slice 1–6 left them. A Goal's communication thread is still keyed by channel identity (`whatsapp:<phone>`), independent of which opportunity produced it; this slice does not change that, and does not need to — two goals for two opportunities of the same lead each carry their own `linked_communication_threads` value already (proven in the smoke, §17).

## 15. Task relationship

`officeTaskBridgeService.ts`'s `opportunityId` parameter remains **deliberately unwired** in this slice, per its own explicit §16 instruction ("do not converge Tasks generally"). This is a disclosed, intentional gap, not an oversight — the parameter is now demonstrably meaningful (Office's `crm_tasks.opportunity_id` is a real, live-referenced column), so a future, narrow follow-up could wire it the same way `target_entities.opportunity_id` was wired here, but that is out of this slice's scope.

## 16. Document/proposal relationship

Not touched — `proposals.lead_id`-only scoping (§5) is a real Office-side gap this slice does not fix (it requires an Office schema/route change, explicitly out of scope for a Backend-only, no-Office-touch pass). Documented here as remaining Office convergence work (§20).

## 17. Human-handoff relationship

Not touched. `requestOfficeHandoff()`'s outbound payload (`OfficeHandoffRequestInput`) still carries only `lead_id`/`business_unit`/`requested_capability`/`reason`/`priority` — no `opportunity_id` field was added to it, because Office's own `requestHandoffForLead()` route handler does not read or use one (confirmed by the Office audit: `createOrUpdateHandoff` only ever sets `lead_id, business_unit, requested_capability, reason, priority, status`). Adding a field Office cannot yet consume would be dead code, not a real fix — the actual fix (opportunity-scoped handoff dedup) is Office-side application logic, explicitly deferred (§20).

## 18. OMA implication

Validated against code, not designed fresh: Office's own intake path (`runOfficeIntakeCrm`) already performs "Contact → interest → create Opportunity" exactly as this slice's own §19 anticipated — this is existing Office behavior, not something OMA needs to newly learn. No OMA prompt/knowledge changes were made.

## 19. OSA implication

Also validated, not redesigned: Backend's Decision/Goal pipeline, as of this slice, now operates against Opportunity context when Office supplies it (§10.5) — the concrete mechanism a future OSA-owned "commercial progression" concept would consume. No OSA prompt/knowledge changes were made; this slice only ensured the plumbing underneath is honest.

## 20. Remaining Office convergence work (disclosed, not built here)

1. No PATCH/update route exists for `crm_opportunities` — stage is frozen at creation forever (§3). A future Office slice should add one, governed the same way `crm_tasks`/`office_projects` already are (`FIELD_POLICY`, `STATUS_TRANSITIONS`).
2. `proposals` has no `opportunity_id` column — cross-deal proposal contamination for a multi-opportunity contact is real today (§5, §16).
3. `office_handoffs`'s JV path never populates `crm_opportunity_ref` — a second, simultaneous site's handoff request silently reuses the first site's handoff (§5, §17). This is the same underlying defect §7/§10 fixed on the Decision/Goal side; the Office-side handoff-routing half of it remains open.
4. `leads.opportunity_id` and Backend's `corporateIntelligence.ts::crm_opportunity_ref`/`inboundCommunicationEvent.ts::related_opportunity_id`/`officeTaskBridgeService.ts::opportunityId` are all still dead fields — candidates for formal retirement in a future slice, left alone here per this slice's own "do not rewrite historical Decisions / do not converge Tasks generally" scoping.
5. `office_development_projects` (public marketing) remains commercially disjoint from the CRM pipeline — by design, not a gap this program needs to close.

None of these require Core changes — per §24, Office remains the commercial system of record and owns fixing them.

## 21. Cross-repository ownership (confirmed, not redesigned)

Office owns commercial truth (the real `crm_opportunities` row, its stage, its lifecycle). Core owns intelligence/Decision/Goal (this slice's own `entity_type: "office_opportunity"` targeting is a reference, never a shadow copy of Opportunity's own fields — Backend does not store `stage`/`pipeline`/`owner`). CommunicationRuntime continues to own channel execution, untouched. **Core did not become a second CRM** — no new Opportunity-shaped table was created in Backend; `oyi_decisions`/`oyi_goals` only gained the ability to carry a foreign reference id, exactly as they already do for `lead_id`.

## 22. End-to-end target trace

| Link | Status |
|---|---|
| Inbound enquiry → Contact resolution | LIVE (Office) |
| → Organization resolution | LIVE (Office) |
| → Opportunity resolution | LIVE (Office, undeduped creation — §5) |
| → Office material event | **NOW CARRIES opportunity_id** (this slice, §10.2) — previously MISSING |
| → Core awareness/context | Unaffected (canonical signal ingress keys off `event.subject`/`idempotency_key`, not `crm.*` — untouched) |
| → Decision | **NOW OPPORTUNITY-TARGETED when known** (this slice, §10.5) — previously always lead-targeted |
| → Goal | **NOW OPPORTUNITY-SCOPED DEDUP when known** (this slice, §10.5) — previously always lead-scoped dedup (the proven collision, §7) |
| → Communication | Unaffected |
| → inbound reply → same Opportunity | Partially — the Goal itself is opportunity-scoped now, but reply-wake (`findGoalsWatchingThread`) is still thread-keyed, not opportunity-keyed; sufficient for this slice's scope since a Goal already carries its own opportunity identity once created |
| → Goal wake → next Decision | Unaffected mechanism, now operating on opportunity-scoped Goals when applicable |
| → human handoff if needed | **STILL LEAD-SCOPED, STILL COLLIDES** (§17, §20.3) — the one link this slice could not close without an Office-side change |

## 23. Same-person/different-deal proof (mandatory, Section 26)

Proven directly against the real, compiled, post-change code (`scripts/wave7-slice7-lead-opportunity-identity-resolution-smoke.mjs`): the same lead (`lead-tare`) with two independent opportunities (`opp-site-a`, `opp-site-b`) produces **two separate goals** (previously would have produced one, silently dropping the second — §7), **two separate Decisions** each correctly `entity_type: "office_opportunity"` targeted at its own opportunity id, and each goal's `target_entities.opportunity_id`/`linked_crm_records` correctly scoped to its own pursuit while both correctly still reference the shared `lead_id`. A genuine retry of the *same* opportunity's event still dedups to exactly one goal and one Decision (idempotency preserved, not weakened).

## 24. Privacy/authority

No access was widened. The new `opportunity_id` field is descriptive identity only, exactly like `lead_id` already was — no new column carries a role/permission, no new route was added, and the existing `x-office-api-key`-gated bridge (`officeMaterialEventAdapter.ts`'s inbound side, `officeTaskBridgeService`/`officeHandoffBridge`'s outbound side) is the only path this data ever travels. No public arbitrary Opportunity lookup exists or was added.

## 25. Performance

No N+1 introduced. `findActiveForOpportunity` is a single jsonb containment query, identical shape/cost to `findActiveForLead`/`findActiveForDevice`. Proven at the scale this slice's own scenario requires (2 simultaneous opportunities, 1 retry) in the smoke; the query shape itself was already proven flat under 1/10/50/100 scaling for its siblings in Slice 6 (identical implementation pattern, not re-tested here since nothing about the query's cost profile changed).

## 26. Wave 5/6 freeze

Zero files under physical execution, awareness, state, privacy, or materialization were touched — confirmed via `git status --short`. Representative Wave 5/6 smokes re-run as regression (§30).

## 27. Wave 7 Slice 1–6 regression

All re-run: Slice 1 (`wave7-slice1-recommendation-authority`), Slice 2 (functional+SQL), Slice 3 (103/103, unmodified), Slice 4 (25/25, unmodified), Slice 5 (functional+SQL, unmodified), Slice 6 (functional+SQL, unmodified), `goal-runtime`, and the Oyi Communications Convergence Slice 1/2 smokes (the original JV golden-path tests, which exercise `activateDevelopmentRelationshipGoal` with **no** `opportunity_id` on their fixtures — the exact backward-compatibility case this slice's own change must not break). Results in §29.

## 28. Files changed

- `src/contracts/corporateIntelligence.ts` (modified — `crm.opportunity_id`)
- `src/routes/officeExport.ts` (modified — reads `crm.opportunity_id` off the wire)
- `src/contracts/goal.ts` (modified — `GoalTargetEntities.opportunity_id`)
- `src/services/goalRuntime/GoalRuntime.ts` (modified — `findActiveForOpportunity`)
- `src/oyi-core/ingress/officeMaterialEventAdapter.ts` (modified — opportunity-aware Decision targeting + Goal dedup)
- `scripts/wave7-slice7-lead-opportunity-identity-resolution-smoke.mjs` (new)
- `package.json` (one new script entry)
- `docs/WAVE7_SLICE7_LEAD_OPPORTUNITY_IDENTITY_RESOLUTION.md` (new, this file)

No Office file touched. No migration file created.

## 29. Migrations

None. See §11.

## 30. Tests/results

- `npm run typecheck` — clean.
- `npm run build` — clean.
- `smoke:wave7-slice7-lead-opportunity-identity-resolution` — 7/7 passed (backward compatibility, the mandatory two-opportunity proof, retry-dedup, `linked_crm_records`, `decisionKey` non-collision, `findActiveForOpportunity` query shape).
- Full regression battery (28 scripts: new Slice 7 smoke, Slice 1–6 Wave 7 smokes, `goal-runtime`, Oyi Communications Convergence Slice 1/2, representative Wave 5/6, Office/conversation/privacy smokes) — results below.

## 31. Environment failures

Identical to every prior slice's own report, unrelated to this slice's changes: `smoke:oyi-office-intelligence-convergence`'s 2-assertion idempotency-store failure, and any `OYI_LOCAL_SUPABASE_SERVICE_ROLE_KEY`-dependent Wave 5 smokes included in the battery.

## 32. Newly discovered gaps

Catalogued in full in §20 (Office-side: no Opportunity PATCH route, proposal cross-contamination, handoff collision, several dead fields) — none require Core changes; all are Office's to fix per §21's ownership model.

## 33. Commit SHA

Recorded in the final report delivered in this same turn.

## 34. Whether Slice 7 is COMPLETE

Yes, for the Backend-side, no-migration convergence this slice's own gate authorized. The Office-side lifecycle completion items (§20) are explicitly out of scope and documented as future, Office-owned work — not a partial or abandoned implementation of this slice's own mandate.

## 35. Whether all seven Slice 0 roadmap items are now complete

Yes — Slices 1 through 7 of the accepted Wave 7 roadmap (`docs/WAVE7_DECISION_PLANNING_AUTHORITY_AUDIT.md` §37) are all committed: Recommendation Authority, Identity Chain Repair, Lifecycle Vocabulary Normalization, Human-in-the-Loop Unification View, Canonical Decision Object, GoalRuntime Domain Generalization, and this slice, Lead/Opportunity Identity Resolution.

## 36. Whether Wave 7 is ready for FINAL CLOSURE AUDIT

Yes, on the roadmap's own terms — all seven ordered items are complete. Whether to actually run that closure audit is a decision for the user, not assumed here.
