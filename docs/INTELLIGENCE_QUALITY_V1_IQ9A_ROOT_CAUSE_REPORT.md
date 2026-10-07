# IQ-9A — Root-cause report (read-only audit, frozen before implementation)

Starting HEAD `c5b1b953cf375b40ee6243272f4d3c4a602282e3`. Sources: the 15 P0 rows and the failing ACTION_SAFETY / CANCELLATION / SUBMISSION rows of the sealed IQ-8F evidence, traced through the whole final-response path (semantic frame -> AnswerTarget -> capability resolution -> authority -> execution -> ResultEnvelope -> projector / specialised owners -> final text). The IQ-8F corpus is sealed evidence: no rule below is keyed to any of its utterances.

## 1. Unsupported judgment and fabricated ranking (7 P0 rows, Facility and Consumer)
Responsible component: `evidence/judgment` deterministic path (`dominance.ts` declared qualitative order over recorded lifecycle / importance / time-pressure) reached through `oyi.assessment.evidence_plan`; wording from `response/targetedJudgment.ts` and `judgment/compose.ts`.
Finding: the ordering itself is the certified IQ-4 deterministic judgment (typed operational records, ties preserved, nothing scored). It is NOT invented. The defect is the final text: it presents the ordering as an answer to value-laden asks ("which is worse", "greater concern", "matters more") without stating that it is only an ordering of recorded status and priority, and `Facility`/`Consumer` answers say "comes first" with no basis sentence. Missing invariant: a judgment statement must carry its basis and must not assert importance beyond the recorded fields. The business-record (provider-required) path already refuses to rank; that stays.

## 2. Claims of action execution without evidence (1 P0 + failing ACTION_SAFETY rows)
Components: `answerTarget.ts` (`youDid` accepts only `you` / `anything` / `oyi` as the agent, so "has anybody emailed..." is not an ACTION_RESULT), `projector.ts` (YES_NO default `rows.length ? "Yes — N records"`: a "Yes" from the mere presence of unrelated records), `SemanticFrameParser` (operation stays `device.power.*` for "did you switch it off", so the power-control capability is selected and re-proposes the command), `actionTruth.ts` (`Yes — N commands were sent` for any attempted status including failed / timed-out / unobservable).
Missing invariants: (a) a past-tense question about an action or communication is an ACTION_RESULT for any agent and its operation must not remain a command; (b) a YES must be licensed by a record predicate (existence, a state, a named fact), never by unrelated records; (c) "sent" / "done" claims are per canonical status: only a confirmed result supports "did it".

## 3. Visitor permission mistaken for arrival (1 P0)
Components: `projector.ts` (permission-only guard fires only when the state concept is arrived/departed; "at the house" is not in the state lexicon) and the YES default above.
Missing invariant: a permission-only record can answer permission questions (active / valid / expired / how many) and nothing about presence, arrival, departure or location, whatever words express it.

## 4. Handoff or contact reported complete without a receipt (1 P0 + failing SUBMISSION rows)
Components: same YES default; `ACTION_RESULT` detection missing "told / informed / notified / alerted" as communication verbs; receipts (`office_handoff_*`) exist only in the capability's own result metadata, they are not readable on a later turn.
Missing invariant: a communication or handoff is complete only with a canonical receipt readable by the answerer; otherwise the answer is "no record that it was sent / I can't confirm".

## 5. Cross-person and cross-scope private-data disclosure (5 contested P0 rows)
Components: `conceptBridge` / `answerTarget` have no notion of WHOSE data is requested; `CapabilityService.resolve` selects `wallet.balance.read` / `wallet.transactions.read` on domain + facet alone and the capability answers with the actor's own record.
Missing invariant: the requested subject scope (own home / another person / estate-wide) is resolved before a private capability runs; a request for any scope other than the actor's own is denied at the authority boundary and never substituted with the actor's own data. Claimed roles in chat never widen scope.

## 6. Incorrect cancellation / withdrawal (8 of 10 CANCELLATION rows failed; no P0)
Components: Office and public surfaces have no "nothing pending" owner (a cancel falls to the capability-menu / unsupported fallback); withdrawal of a standing rule ("forget that rule") is read as an action cancel; "scratch that, don't touch it" after an unexecuted request reaches the unsupported fallback; "skip the confirmation step" is not recognised as a bypass request.
Missing invariants: explicit withdrawal always yields a cancellation statement (nothing was sent or changed; nothing is pending) on every surface, before capability matching; a withdrawn standing rule is acknowledged as lifted; a request to skip confirmation is refused; no cancelled intent may be re-executed from context (unchanged: pending proposals are only cleared, never created, by a cancel).

## Enforcement boundaries chosen
Authority boundary (`CapabilityService.resolve`, subject scope); response-truth boundary (`projector` YES licence + permission-only guard + status-aware action truth); target contract (`answerTarget`: agent-general ACTION_RESULT, subject scope, existence flag, cancel / constraint withdrawal, bypass refusal); judgment wording (`targetedJudgment` basis statement). No new authority system.
