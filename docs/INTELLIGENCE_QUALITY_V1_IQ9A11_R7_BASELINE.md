# IQ-9A11 R7 — response-completeness baseline (frozen before runtime changes)

Start HEAD `7c74c2aff9a264cf3e020a50df13259829052525` (= origin, clean). Scored artifact: `artifacts/intelligence-quality-v1-iq9a10-scored.json` (R6 end state, frozen rubric, two graders, success = both). Dev suite: **124/160 (0.775)**; positive controls 57/80 (0.713); negative controls 67/80 (0.838); P0 0. Frozen expectations are unchanged.

## 36 failing items by root cause (item → missing element → earliest causal boundary → component)

**A. Evidence returned by the capability, dropped before/at projection**
- 023 device names (Living Light, AC, Kitchen Light, Bedroom Light) → availability answer builder summarises counts only → `presentation/conversationAnswerPresentation.ts` (device inventory text).
- 034, 044, 016, 160 visitor active/inactive per record, "permission not presence" → visitor read prose/projector hedges or omits → `domains/visitors/visitorPassState.ts`, `response/projector.ts`.
- 054 wallet balance NGN 12,500 beside history; 128 overdue task + meeting omitted from "urgent attention" → R3 clause envelope / office summary → `CapabilityResponseAdapter.shapeReadAnswer`, office attention read.
- 091 opens "Yes" for a "is there a record" question; 092 omits recorded request statuses beside the handoff-truth lead; 139 priority buried behind an unrelated limitation → `projector.ts`, `ConversationOrchestrator` direct answers.

**B. Planner / evidence-plan boilerplate where a typed read exists**
- 043, 107 (visitor counts contradict record), 087, 095, 103, 111 (wallet amount comparison), 056, 125 → `oyi.assessment.evidence_plan` / ranking limitation reached instead of the typed read → planner admission / `targetedJudgment`.

**C. Unverified-safety replies lacking recorded facts and a safe next step**
- 114, 115, 117, 118, 120, 126 → hazard direct-answer text is generic → `ConversationOrchestrator.tryAnswerTargeted` hazard branch.

**D. Referent resolution (R4/R6 scope, not completeness)**
- 131, 137, 149, 156.

**E. Surface limitation wording**
- 045 (Office: no presence data), 075 (alert-sent question unaddressed), 068 (no recorded facts).

**F. Public Osa**
- 030 (acknowledgement omits JV, missing items, first look), 096 (recap omits title status), 159 (denies held details after a handoff question).

Earlier R3 cases 034 and 054 are in group A and are revisited in R7.
