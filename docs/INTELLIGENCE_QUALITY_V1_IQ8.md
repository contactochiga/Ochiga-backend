# Intelligence Quality V1 — IQ-8 Answer Targeting & Response Intent

Status: **IQ-8 NOT YET CERTIFIED.** Branch `codex/intelligence-quality-v1`. No merge, no deploy, Initiative not started.

## What was built
- `response/answerTarget.ts`: derives a **response intent** (LIST, COUNT, STATUS, SUMMARY, DIRECT_ANSWER, ASSESSMENT, RANKING, COMPARISON, EXPLANATION, YES_NO_WITH_REASON, ADVICE, NEXT_STEP, SAFETY_RISK, REFUSAL, LIMITATION, CONFIRMATION_STATE, ACTION_RESULT, CLARIFICATION, CAPABILITY_DISCOVERY) from speech-act structure and the IQ-7 objective. Objective (the thinking job) and response intent (the answer shape) are separate. The target carries subject tokens, top-N, quantity, yes/no kind (state / inference / capability / change / advice / action_result), compared sides, qualifiers, safety relevance, `must_answer`, `must_not_substitute`. Pure, no storage, no provider call.
- Composition sites (all Core-level, each keeps the original structured answer as supporting evidence):
  - `evidence/judgment/compose.ts` + `response/targetedJudgment.ts`: judgment answers lead with yes/no/unknown, the supported reason, the comparison, the ordering limitation, the safety conclusion/uncertainty or the list, then a separated "Supporting evidence" section.
  - `capabilities/CapabilityResponseAdapter.ts` + `response/targetedRetrieval.ts`: plain read capabilities (leads, opportunities, reports, tasks, maintenance, visitors, wallet, security, facility overview) lead with the items (list), the number (count), the status or a yes/no; their own sentence follows as "Supporting detail".
  - `response/limitationTarget.ts`: a generic "no capability" / menu / bare denial becomes the specific limitation for what was asked, or a refusal for attribution and authority probes.
  - `response/targetedPublic.ts`: Osa leads (no promise / commitment, enough-for-a-first-look, what is still needed, what was shared, lease-vs-JV limit).
  - Orchestrator: a standing constraint is acknowledged as in force, "did you change anything?" is answered from the thread's own action records, an unverified safety report is surfaced as unverified. None executes anything or creates durable state.
  - Reassessment: "Does that change your priority?" leads with Yes / No and surfaces an unverified safety report first.
- Small routing/vocabulary generalisations that answer targeting depends on: domain-vocabulary fallback for unclassified turns, maintenance for "leak/ticket/<device> issue", approval/sign-off reports, `balance` not routed to transactions, a state-concept lexicon (open / resolved / stale / overdue / arrived / departed).

## Evidence
| Gate (frozen before suite C) | Result |
|---|---|
| Candidate set (84 turns, frozen before any behavioural change): lead meets expected target | 64/83 graded (0.771) — gate 0.70 met (self-graded) |
| Frozen 280: 69 PASS preserved | yes; 111 answers changed (90 FAIL, 21 PASS); 20 of the 21 PASS turns keep all their content; the 21st replaced an irrelevant capability menu by an explicit refusal; no promotion claimed |
| Boilerplate-style leads | 162 → 76; four-paragraph templates 123 → 61; capability-menu/unsupported leads 10 → 5 |
| Wave 11 | 132 PASS / 0 FAIL (the earlier single known failure now passes) |
| IQ-1..IQ-7 | all pass (4 `oyi-workflow-*` suites fail identically at the IQ-6 baseline); IQ-7 DEV 0.983 / safety 1.0; closure suite 1.0; objective parity 0 changes; e2e 45/45; guard 0 |
| Performance | derivation 17 µs; derivation + targeted lead p95 71 µs; no extra provider call |
| **Held-out answer-shape gate: overall ≥ 0.85 on a fresh suite, first contact** | **NOT MET. Suite C 0.639; suites D, E, F (written after C) 0.672 each** |

The held-out suites were authored by the implementer. Suite A (68 items) was frozen before the work and measured 0.191 at baseline; suites A and B were then developed against and reach 0.94 / 0.92 (contaminated). Each fresh suite (C, D, E, F) scored 0.64–0.67 on first contact, and ~0.82–0.90 only after being developed against. The consistent first-contact gap is routing/vocabulary breadth (wording the lexical capability routing does not recognise), not the answer shapes themselves.

## Remaining failures (post-IQ8, frozen 280, FAIL turns)
Answer-target lead now met but status unchanged pending independent envelope review 64; ANSWER_TARGETING lead still not met 21; UNDERSTANDING 19 (routing / state lost); INITIATIVE 41; LIVE_PROVIDER_REQUIRED 17; CONTEXT 16; EVALUATOR_MISMATCH 12; ACTION_JUDGMENT 8; DRAFTING_WORKFLOW 3; COMMUNICATION 3; EVIDENCE 1; MISSING_CAPABILITY 1. Provider, Initiative, action-judgment and product-capability debt were not touched.

## What certification still needs
A fresh, independently authored held-out answer-shape suite (not by the implementer) meeting the frozen 0.85 gate, plus independent review of the 64 self-graded candidate leads. The likeliest lever is generalising capability routing (`classifyDomain` / `supports`) from the IQ-7 domain vocabulary instead of hand-listed phrases.
