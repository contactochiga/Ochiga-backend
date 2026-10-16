# Provider-independent Core qualification — baseline and readiness

2026-10-16. **Qualification not started: infrastructure preflight blocked.**
Gemini remains on HOLD. No provider inference, paid API request, billing change,
authorization change, reservation change, runtime edit, merge or deployment.

## Verified baseline

Worktree `/Users/ochigaidoko/Documents/oyi-intelligence-quality`;
branch `codex/intelligence-quality-v1`; origin
`git@github.com:contactochiga/Ochiga-backend.git`.
Local and live remote HEAD both
`1d10c992566169d48b30158df2cc681d27abf3eb`.
Last runtime source change: IQ-11C,
`2984e9205708ab0e4d109377ac6877b6b2ef7855`.
HEAD and that commit have identical source tree
`18f722732807544ca459c4a984a5206a8251c470`;
no intervening differences in src, package/lock files or migrations.

The worktree was **not clean**: two tracked owner-authorization/trust changes
and existing untracked IQ-11F enrollment, signing, manifest and preparation
files were present. They were not staged, overwritten or committed here.
IQ-11D's runtime experiment was rejected and reverted. Later provider preparation
is not a new generalization implementation.

## Historical evidence, not new scores

- IQ-9A: 150/160 development PASS; not independent certification.
- IQ-9B: 71/320 independent primary PASS; durable trace capture invalid.
- IQ-10F: 64/320 PASS, 68 PARTIAL, 188 FAIL; four scored P0 and two additional
  setup occurrences. 1,285 calls, 1,283 saved, 1,282 captured correlations.
- IQ-11A separated actual hazards/scope defects from a fixture/runtime effective
  authority mismatch. Frozen grades remain unchanged.
- IQ-11B targeted safety/effective-authority protections and IQ-11C capture
  reliability passed their targeted scenarios. They do not certify broad language.
- IQ-11D was NOT certified. Its candidate regressed context and was reverted.
- IQ-11E is preparation, not an independent end-to-end result.

IQ-11A's historical 256 non-PASS primary classifications: objective 34;
subject/scope 59; continuity 99; routing 2; evidence 5; judgment admission 15;
answer targeting 21; composition 20; evaluation/fixture 1. Zero primary diagnoses
in action governance/product-debt do not certify those areas. These are exposed
historical diagnoses, not fresh results or guaranteed repair promotions.

Oma's main patterns were subject/reference and facet loss; Osa's entity admission
and fact continuity; Facility's stale assessment and scope/operational predicates;
Consumer's topic/reference switching and historical-versus-physical state. Shared
owners remain SemanticFrameParser/conceptBridge, plannerAdmission, existing entity
and result-set context, AnswerTarget and projector. No second intelligence engine
is proposed.

## New readiness results

Build PASS. IQ-11B structural controls **22/22 PASS** under the local launcher.
An initial direct invocation failed to initialize because no Supabase URL was
provided; this was setup failure, not a safety verdict. The correctly isolated
invocation then passed.

The first launcher attempt stopped before invoking Core: the temporary fixture
directory had lost its `supabase/config.toml`. The CLI looked for
`supabase_db_oyi-wave11-supabase-fixture`, while the running container label is
`wave11-behavioural-fixture`. Restored only a minimal local locator file with that
verified project ID. No credentials in the file; no restart, database change,
migration or production configuration change. The launcher then verified the
single synthetic `Wave 11 Test Estate` at loopback port 55421.

The unchanged IQ-11C reliability suite: **31 PASS / 1 FAIL**, 29 journaled
attempts, zero physical executor attempts. Preflight `ready=false`, failed gate
`failure_injection`. The failing check was
`save-failure-independent-of-successful-trace`: its 500 ms reconciliation returned
`lookup_unavailable` / error class `unknown` after 502 ms, instead of
`missing_expected_save`.

Exact affected IDs:

- Request `e5b32e09-e960-4430-8750-4f027b7f40d6`
- Thread `2ed4bebf-ad73-47f7-8ddf-393c8163364d`
- Trace `feac93c4-7467-4f38-bed4-e9199764e6f2`

The response honestly reported unsaved; its trace receipt was `saved_verified`.
The same run's final reconciliation returned `missing_expected_save`. A separate
read-only exact-ID local SQL count confirmed **0 messages / 1 trace**. No replay
or backfill occurred. This does not establish a missing durable trace or an
unintended save loss: the save failure was injected. The immediate lookup cause
remains unproven; timing near the deadline is not proof of a transport cause.

All 29 attempted outcomes were captured in 59 journal entries. Mixed injected
batch final accounting: 26 durable pairs associated with attempts; 21 verified
traces; 16 saved/correlated, 1 rejected/correlated, 1 late trace recovered,
4 missing traces, 4 uncertain trace deliveries, 1 missing expected save,
1 durable pair with unconfirmed save, 1 unexpected multipart message set.
Faults are deliberately present and **not** successful persistence. Duplicate
delivery shares its existing pair. Final mixed-batch `ready=false` is expected;
the failed preflight assertion is not.

Observed response latency across these fault controls: mean 76.66 ms, p50 57 ms,
p95 204 ms, max 266 ms. This excludes asynchronous drain/final reconciliation
and is neither independent conversational performance nor a production SLO.

## Qualification status and next bounded work

No new independent corpus, scores, severity findings, paraphrase/flip rates or
worker quality results are claimed. No sealed IQ-9B/IQ-10F replay. Broad
preservation was not rerun after the preflight block. Historical Wave 11 132/132,
frozen-280 preservation and 53/58 broad-suite results remain historical only.
Five workflow suite exclusions remain reload, multi-gang, correction, durable
continuation and owned-workflow aggregate; multi-gang release claims remain barred.

1. **First prerequisite: bounded reconciliation diagnostics.** Use existing
   conversationTraceReconciliation and IQ-11C test owners. Determine why a known
   missing-save result becomes lookup-unavailable at the bounded poll deadline;
   distinguish initial query failure, last-poll overwrite, scheduling and unknown
   error classification. Preserve raw failure and no false readiness. Do not
   simply lengthen deadlines or soften assertions to hide it. Acceptance: new
   synthetic delayed/error controls retain honest structural evidence and all
   required preflight gates pass; outage/missing evidence still block. Runtime
   changes require a separate remediation decision.
2. **Independent qualification:** use the adjacent pre-authoring protocol and
   IQ-11E minima. Commission fresh authors/graders only with required permission;
   freeze validated fixture/specification, questions, rubric and hashes before
   first contact. The commissioning permission request remains unanswered.
3. **After valid fresh results:** group demonstrated failures by discourse/subject
   binding, entity/fact/reference admission, requested-facet projection and
   governed judgment. Prefer one bounded owner-level slice at a time, with
   positive controls, no phrase patches and no provider dependency. Current
   historical evidence favors explicit subject/operation transition ownership,
   but does not justify claiming any new score improvement.

Supabase skill guidance informed the isolated local-fixture checks. No production
Supabase access or schema modification. Runtime remains unchanged. This report
and protocol are new preparation artifacts, not a completed qualification.
