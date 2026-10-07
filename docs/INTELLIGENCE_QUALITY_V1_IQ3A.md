# IQ-3A evidence contract hardening — implementation checkpoint

Starting HEAD: `7526f09a77aa38c34b8fa5d025474e0fdda39803`.
Branch: `codex/intelligence-quality-v1`. No production, schema, merge or deployment operation.

## Status

**Not certified.** This checkpoint delivers the collection-result primitive and
a verified room-inventory false-zero correction. It does not claim that every
collector has been audited or converted. No multi-domain planner is present.

## Contract

`contracts/evidence.ts` extends the existing evidence contract with
`EvidenceReadOutcome`. Individual records remain `OyiEvidence`, with their
existing truth, privacy, confidence, scope and freshness semantics.

`evidence/EvidenceReadOutcome.ts` normalizes explicit adapter proofs:

- available complete / partial / zero;
- unavailable / authority denied;
- unsupported / insufficient scope;
- stale / error / timeout.

Zero requires allowed authority, enforced matching scope, an executed available
query, a named population, proven completeness, no truncation/failure sentinel,
zero records and current source freshness. Empty unknown/historical/stale results
cannot prove current zero. Completeness refers to the named query population,
not every record or issue in a domain.

Denied and unsupported results suppress records, totals and effective scope.
Contradictory record scope fails closed. This is defense in depth, not a new
permission engine: adapters must still invoke canonical capability authority
and validate source-level scope before collection. Missing record membership
fields are not independently proven by this normalizer.

Returned records are capped at 50; an exceeded cap or a larger source total makes
the result partial. This does not claim upstream database queries are bounded.
Freshness and lifecycle are supplied by source semantics, not guessed from
generic timestamps or invented scores. A lifecycle classification does not rank
importance. Raw records stay in the runtime result; no trace/persistence integration
has been added.

`withinEvidenceDeadline` bounds acceptance of one asynchronous read and provides
an AbortSignal. Cancellation is cooperative. A source ignoring it can continue,
but its late result is not delivered to the completed caller. No assessment state
is written by this helper. It does not claim to prevent arbitrary side effects
inside an unsafe collector; such collectors must not be admitted.

## Concrete source findings

| Source | Actual boundary / bound | Empty-result finding | Readiness |
|---|---|---|---|
| CRM lead collector | Supplied Office snapshot `leads.needing_attention`; `total_open` is a different population | Missing section returns `[]`; subset cannot prove completeness over all open leads | Adapter proof pending |
| CRM opportunity collector | Supplied `opportunities.stale`; separate `total_open` | Missing section returns `[]`; stale subset is not entire pipeline | Adapter proof pending |
| Maintenance | Verified-context estate/home preferred; Facility estate filter, Consumer home filter; limit 50 | Missing scope returns `[]`; errors have unavailable sentinel; no count/truncation proof | Building/room scope unsupported until enforced; adapter pending |
| Security incidents | Estate filter plus Consumer home filter; limit 50 | Missing scope returns `[]`; errors have unavailable sentinel | Building/room scope and completeness proof pending |
| Visitor access | Facility estate / Consumer home filter; limit 50 | Missing scope returns `[]`; temporal/lifecycle population needs explicit declaration | Full collector audit pending |
| Device inventory | Home query limit 100; room filtering happens after the home limit; canonical current-state hydration | Missing home and caught query errors return `[]`; empty room subset can be incomplete | False-zero integration and completeness proof pending |
| Facility cameras | Estate query limit 100, camera access policy, canonical camera state resolution | Failure sentinel exists; unknown state does not prove offline; building filter not present in collection query | Full policy/dependency audit pending |
| Room inventory | Home filter limit 100; verified context now wins over request scope | Missing home / query error now explicitly unavailable | False-zero fixed; outcome adapter/truncation proof pending |
| Public opportunity | Existing thread objective collector; response handler can invoke callback workflow | Objective absence is not corporate-source absence; collector-only authority review remains necessary | Full ownership audit pending |
| Home/room aggregates | Existing contributors, pending aggregate map, bounded 30-fact projection | Unresolved room returns `[]` with separate state; fact projection is not coverage proof | Full contributor audit pending |
| Utilities | Existing estate/home loaders; accounts/assignments 200, purchases 50, tariff estate scope | Scope absence can return `[]`; source-specific current/historical semantics required | Full service audit pending |

This is an explicit partial inventory. The prior candidate artifact identifies
29 currently allowed capability keys; aliases share collectors. Permission and
surface metadata alone do not certify any row above. Wallet and denied/missing
candidate sources must also be included before the requested cross-home audit
can be called complete.

## Changes affecting ordinary responses

1. `rooms.inventory.read`: query failure previously returned `[]` and could say
   no registered rooms. It now returns an unavailable sentinel and an honest
   unavailable response. Missing scope also no longer means zero.
2. Room/home helper scope now prefers server-verified context over request IDs,
   consistent with maintenance/security loaders.
3. `evidenceFromFact`: `confidence || 0.75` promoted a supplied zero to 0.75.
   Zero is now preserved; absent/non-finite values do not gain confidence.

No other ordinary answer wording was intentionally changed. No ranking,
assessment fan-out, provider call or external action was added.

## Outstanding certification work

- Complete actual-service audit for all candidate collectors and denied sources.
- Attach explicit result proofs at canonical collection boundaries; until then
  the new type is a substrate, not a working planner interface.
- Enforce unsupported building/room scope before invoking broad collectors.
- Prove all Consumer cross-home and Osa/Office boundaries with source fixtures,
  not just normalizer tests.
- Source-specific freshness, pagination and completeness integration.
- Complete per-turn readiness reclassification of the 133 planning failures.

None of these is an invitation to begin IQ-3B. Frozen artifacts remain unchanged.

## Validation at this checkpoint

Commands executed:

```text
npm run build
npm run typecheck
node scripts/iq3a-evidence-outcome-smoke.mjs
node scripts/iq1-local-run.mjs script /tmp/iq3a-room-final scripts/iq3a-room-truth-smoke.mjs
node scripts/iq1-local-run.mjs iq /tmp/iq3a-final-iq
node scripts/iq1-local-run.mjs wave11 /tmp/iq3a-final-wave11
node scripts/iq1-local-run.mjs adversarial /tmp/iq3a-final-safety
node scripts/iq1-local-run.mjs script /tmp/iq3a-final-objective scripts/iq2-objective-smoke.mjs
node scripts/iq1-regression-run.mjs /tmp/iq3a-final-regressions
node scripts/iq3a-checkpoint-review.mjs
git diff --check
```

- Build/typecheck: PASS on final source (an intermediate nullable-confidence
  type error was corrected before the final build).
- Outcome tests: 28 PASS; deadline cases: 4 PASS.
- Room fault/scope injection: 4 PASS, including successful empty vs failed query,
  missing scope, and request-home B not overriding verified home A.
- Full IQ: 280 executed, all answers equal to the prior accepted run; frozen
  envelopes unchanged. Retained classifications: **51 PASS / 224 FAIL / 5 BLOCKED**.
  Persistence and trace correlation: 280/280. No new seven-dimension regrade.
- IQ-2 focused and IQ-1 adversarial runners: PASS.
- Wave 11: **131 PASS / 1 FAIL**, the known utilities case remains a failure.
- Existing 23-suite regression matrix: **19 PASS / 4 FAIL**. All four assertion
  failures match the stored pre-IQ1 controls: reload, multigang, correction and
  durable continuation. They are not relabelled PASS.
- Diff check and targeted changed-file secret-pattern checks: PASS.

Machine-readable evidence and raw-run hashes:
`artifacts/intelligence-quality-v1-iq3a-checkpoint.json`.

All 133 evidence-planning rows remain **SOURCE_CONTRACT_BLOCKED for planner
readiness** at this incomplete checkpoint: the primitive is not a fully connected,
audited collection boundary yet. This deliberately does not claim that all 133
share the same cognitive cause or lack source data. Per-source causal subdivision
remains part of the outstanding audit. IQ-3B must not begin on this result.

**IQ-3A NOT YET CERTIFIED**

## Source-certification continuation (2026-10-04)

Starting commit: `321db68813d8b5585ff5837ecdfff3185b6faec9`.
This checkpoint does **not** complete the requested exhaustive source audit.
The generated inventory covers all 71 registered read modules; actual source-level
certification is complete for eight only. The remaining entries explicitly retain
`audit_complete: false` and cannot be used by the new single-source read boundary.

| State | Sources |
| --- | ---: |
| CERTIFIED_PARTIAL | 8 |
| NOT_ELIGIBLE_COMPLETENESS | 58 |
| NOT_ELIGIBLE_OTHER (disabled rollout) | 5 |

The eight partial sources are maintenance, security incidents, visitors, and the
Office snapshot projections for leads, opportunities, report approvals, development
projects and financial estates. `CapabilityService.readEvidence` reuses existing
registration, authority and collectors; it never invokes response/action execution.
It is not called by ordinary conversation and implements no planner or fan-out.

### Scope and truth findings

- Maintenance, security and visitors enforce Facility estate scope or verified
  Consumer estate/home scope. Building, room and exact-record requests are rejected
  before collection. Homes have a canonical building relationship, but these
  collectors do not join it; estate evidence is therefore never certified as
  building-complete. No label-derived membership was added.
- Real local Supabase isolation tests inserted distinctive Resident B rows in all
  three sources. Resident A records, counts, zero/completeness and truncation were
  unchanged. All three inserted rows were removed. This proves these three sources,
  not every Consumer source.
- Operational empty collections prove zero only after successful scoped queries
  with no unavailable sentinel. Nonempty collections remain partial conservatively;
  reaching 50 also marks truncation. Zero describes the declared all-status source
  population, not a newly invented attention/active-only query.
- Office uses supplied permission-gated snapshots only. Absent sections mean
  unavailable. Empty supplied subsets are partial, never global zero. Lists are
  bounded to 50 before collector mapping. `20 of 39` is not complete.
- Snapshot timestamps do not prove freshness: Office freshness remains unknown.
  Explicit source lifecycle states identify resolved/historical vs active records;
  unsupported states remain unknown. No importance ranking was introduced.
- Public callers cannot access these operational/Office reads, even with a forged
  private snapshot. Public knowledge/opportunity sources themselves remain uncertified.
- Facility home-only device sources remain excluded; no home is manufactured.
- Deadlines isolate/discard late results. Existing collectors do not accept query
  cancellation, so timeout does not claim the underlying database work stopped.

No additional ordinary-response false-zero fix was made in this continuation.
The prior room-query truth fix remains intact. The exhaustive composition false-zero
hunt and certification of cameras, devices, utilities, wallet, home/rooms, remaining
Office and public sources remain outstanding.

### Readiness accounting

The generated conservative mapping accounts for all 133 planning rows:
**64 PLANNER_READY_PARTIAL / 69 SOURCE_CONTRACT_BLOCKED**; all other categories zero.
Readiness uses required domains, current authority, opted-in sources and unsupported
subject/target rejection. It is not evidence of executed assessment planning or good
judgment. Eight partial sources do not authorize beginning IQ-3B before this audit closes.

### Reproducible validation

```text
node scripts/iq1-local-run.mjs script /tmp/iq3a-sources-frozen-final scripts/iq3a-source-certification.mjs
node scripts/iq1-local-run.mjs script /tmp/iq3a-source-isolation-final scripts/iq3a-source-local-isolation.mjs
node scripts/iq3a-evidence-outcome-smoke.mjs
node scripts/iq1-local-run.mjs iq /tmp/iq3a-source-final-iq
node scripts/iq1-local-run.mjs wave11 /tmp/iq3a-source-final-wave11
node scripts/iq1-local-run.mjs adversarial /tmp/iq3a-source-final-safety
node scripts/iq1-local-run.mjs script /tmp/iq3a-source-final-objective scripts/iq2-objective-smoke.mjs
node scripts/iq1-regression-run.mjs /tmp/iq3a-source-final-regressions
node scripts/iq3a-source-review.mjs
npm run typecheck
npm run build
git diff --check
```

Source/authority/scope/snapshot tests: **162 PASS**. Outcome/deadline tests:
**28 + 4 PASS**. Live local isolation: **3 sources PASS**. Build/typecheck PASS.
IQ remains **51 PASS / 224 FAIL / 5 BLOCKED**, with identical answers/envelopes,
280/280 persisted and trace-correlated. Wave 11 remains **131 PASS / 1 known FAIL**.
IQ-1 adversarial and IQ-2 focused suites PASS. The 23-suite matrix remains
**19 PASS / 4 FAIL**, with assertions matching stored pre-IQ1 controls. No failures
are counted as passes. Frozen artifacts and expectations remain unchanged.

Generated inventories, source hashes, raw-run hashes and validation evidence:
`artifacts/intelligence-quality-v1-evidence-source-inventory.json` and
`artifacts/intelligence-quality-v1-evidence-certification.json`.

**IQ-3A NOT YET CERTIFIED** — source-level audit coverage remains incomplete.

## Collector-family convergence checkpoint

Starting HEAD: `dbe824656c6f539acd61b6cb58472b237684eef7`.
The original 58 completeness-blocked modules map exactly once to 13 primary
families. `scripts/iq3a-collector-families.mjs` checks membership against that
commit, verifies collector implementation signatures, and records source hashes.
This is an architecture grouping, **not certification by family inheritance**.

| Family | Original blocked modules |
| --- | ---: |
| No collection (proposal/discovery) | 2 |
| Supplied context object | 9 |
| Governed memory | 1 |
| Operational composite | 3 |
| Current state/telemetry | 5 |
| Execution/audit history | 3 |
| Transaction history | 4 |
| Bounded collection | 7 |
| Home/room aggregate | 6 |
| Persisting intelligence composite | 4 |
| Office supplied snapshot | 8 |
| Public knowledge lookup | 5 |
| Public thread objective | 1 |
| **Total** | **58** |

### Implemented, tested extension

Eight Office query modules now opt into the existing shared snapshot boundary:
tasks, automations, meetings, support, portfolio, partnerships, documents and
content. No new evidence system or backend Office query was added. Their original
query filters remain in their canonical collectors. Tests prove overdue/active/
today/critical/at-risk filtering, filtered-empty partial semantics, malformed and
absent snapshots, 50-record bounds, actor mismatch, public denial, unsupported
building scope, role-policy equivalence and lifecycle interpretation.

The positive test principal receives each module's explicit existing permission;
negative tests independently retain the real narrower staff policy. Removing an
explicit permission array is not equivalent to denying a role-granted permission.
Content lifecycle uses `workflow_status`, not an invented `status` field.
Automation enabled/paused status remains unknown in the generic lifecycle bucket;
it is not mislabeled completed or currently actionable.

Final module counts at this checkpoint: **0 CERTIFIED complete / 16
CERTIFIED_PARTIAL / 50 NOT_ELIGIBLE_COMPLETENESS / 5 disabled NOT_ELIGIBLE_OTHER**.
The inventory additionally records collector × surface × scope states. For opted-in
sources only Office/unscoped supplied snapshot, Consumer/verified home, or
Facility/verified estate is admitted as appropriate. Building/room/exact-object
requests remain rejected. These rows never replace the existing permission check.

### Shared boundaries still preventing closure

- Device inventory catches source errors and returns `[]`; no certified availability
  outcome exists at that loader boundary. Device room filtering occurs after the
  100-row source limit. A last-known state is not new physical observation.
- Execution/audit history logs and omits failed subqueries, then merges supplied
  history. Its combined array loses source-level availability and bounds.
- Home/room aggregates and intelligence composites retain side state for their
  ordinary answer handlers. An extracted fact array does not certify aggregate
  population/completeness. Intelligence collection additionally uses `persist:true`;
  it is not eligible for read-only planner reuse as-is.
- Public knowledge's shared helper returns fallback text both for no visible match
  and query failure; provenance and source availability are lost in the string.
  This cannot certify knowledge retrieval, even though ordinary fallback copy is
  public-safe. Public development similarly collapses failed fetch into an empty
  collector and lacks a bounded source query.
- Context-slot and public-thread lookup require explicit not-found/unavailable and
  ownership proofs; supplied context absence is not a collection-zero result.
- Transaction, utility/service and other bounded loaders still require individual
  scope/sentinel/truncation tests. The family artifact records these boundaries,
  not a claim that all source audits are complete.

No additional ordinary-response false-zero fix is claimed in this checkpoint.
Expanded tests prevent absent/filtered/partial Office subsets from becoming proven
zero at the planner source boundary. The full collector-and-composer false-zero
review remains incomplete, so the certification gate is not met.

### Corrected planner-readiness accounting

Readiness now considers the union of IQ-2 recorded requirements and the frozen
benchmark's `must_consider_domains`. A narrower interpretation must not silently
remove a mandatory source. Conversely, an uncertified composite alternative is
not mandatory when a direct certified source covers the same required domain.
Every row contains explicit required-domain source coverage; no reads are executed.

All 133 reconcile to **64 PLANNER_READY_PARTIAL / 69 SOURCE_CONTRACT_BLOCKED /
0 PLANNER_READY_COMPLETE / 0 MISSING_CAPABILITY / 0 DOWNSTREAM_NOT_IQ3**.
Although totals are unchanged, membership changed: seven Facility rows now have
direct-source coverage; seven Consumer rows lost provisional readiness because
benchmark-required domains were previously omitted. These are diagnostic
corrections, not changes to frozen expectations or runtime interpretation.
Unsafe/unproven sources have not been relabeled product debt to obtain certification.

### Validation and performance

```text
node scripts/iq1-local-run.mjs script /tmp/iq3a-family-sources-final2 scripts/iq3a-source-certification.mjs
node scripts/iq3a-collector-families.mjs
node scripts/iq1-local-run.mjs script /tmp/iq3a-family-isolation scripts/iq3a-source-local-isolation.mjs
node scripts/iq3a-evidence-outcome-smoke.mjs
node scripts/iq1-local-run.mjs iq /tmp/iq3a-family-final-iq
node scripts/iq1-local-run.mjs wave11 /tmp/iq3a-family-final-wave11
node scripts/iq1-local-run.mjs adversarial /tmp/iq3a-family-final-safety
node scripts/iq1-local-run.mjs script /tmp/iq3a-family-final-objective scripts/iq2-objective-smoke.mjs
node scripts/iq1-regression-run.mjs /tmp/iq3a-family-final-regressions
node scripts/iq3a-source-review.mjs /tmp/iq3a-family-final /tmp/iq3a-family-isolation.json dbe824656c6f539acd61b6cb58472b237684eef7
npm run build
npm run typecheck
git diff --check
```

- **264 source tests PASS**; 28 outcome + 4 deadline cases PASS.
- Real local cross-home isolation for the three operational sources PASS; three
  synthetic rows removed. Other Consumer sources are not certified by this test.
- IQ **51 PASS / 224 FAIL / 5 BLOCKED**, answers and envelopes identical; 280/280
  persisted and trace-correlated. Wave 11 **131 PASS / 1 known FAIL**.
- IQ-1 adversarial and IQ-2 focused PASS. Regression matrix **19 PASS / 4 known
  unchanged FAIL**, checked against stored controls. Build/typecheck PASS.
- Office bounded-source tests assert **zero database queries**. This extension
  adds no count queries and changes no ordinary conversation execution path.
  No production-latency or broad telemetry/knowledge source certification is claimed.
- Frozen baseline, expectations and previous IQ artifacts remain untouched.

Family membership/contracts and source hashes:
`artifacts/intelligence-quality-v1-evidence-families.json`.
The source inventory and certification artifacts include current scope matrices,
test results, required-source coverage and regression evidence.

**IQ-3A NOT YET CERTIFIED. IQ-3B must not begin.**

## Benchmark-required source closure — Phase 1: frozen blocker graph

Starting HEAD: `00daff730bb4bf188db4fa340779e6d591d21994` (clean tree; no IQ-3B).
`scripts/iq3a-blocker-graph.mjs` builds `artifacts/intelligence-quality-v1-iq3a-blocker-graph.json`
from the frozen envelopes and the starting-HEAD certification state (read from git, so later
regeneration cannot change it). It executes no collector and no query.

The earlier readiness counted every registry candidate for a domain and every unconfirmed
subject as a source-contract block. The graph instead classifies each of the 69 turns' evidence
classes from the frozen envelope and the turn's own request:

- **Mandatory** — the assessment cannot responsibly be made without it.
- **Optional** — could improve judgment; never blocks readiness.
- **Excluded by design** — the envelope requires *considering and refusing* it (Facility wallet,
  substituting a Consumer home for a building, Resident B reading Resident A).
- **Downstream** — no evidence read needed (reference continuity, confirmation policy, advice
  about a missing measurement).

`home_aggregate` is a composite of direct sources. Cross-domain composition is IQ-3B, so it is
optional whenever its direct components are mandatory-covered; its contributor false-zero
defects are still fixed independently. Unconfirmed reply targets perform no exact read, so the
broad certified read is admissible; this is a planning constraint, not a source defect.

### Result (pre-hardening, frozen)

| Disposition if mandatory sources are hardened | Turns |
|---|---:|
| Ready now (previous block came from optional/excluded/unconfirmed-target items only) | 22 |
| Ready after hardening 9 mandatory sources | 31 |
| MISSING_CAPABILITY_PRODUCT_DEBT (a mandatory class has no safe implemented source) | 12 |
| DOWNSTREAM_NOT_IQ3 | 4 |

Unique mandatory blocking sources: **9** — `devices.status`, `devices.availability`,
`devices.activity`, `devices.failures`, `facility.cameras`, `scenes.list`,
`corporate.opportunity`, `corporate.development`, `corporate.partnerships`.
Mandatory classes with no safe capability: Consumer cameras, electricity consumption
(usage/meter declared, not enabled), device observed values (lock position/temperature —
device facts expose availability/freshness only) and Facility estate device history.
Nine other uncertified candidate sources (4 utilities, 3 home aggregates, 2 wallet) and
`facility.overview` are mandatory for no turn: NON_BENCHMARK_EVIDENCE_DEBT.

The graph is a diagnostic. Runtime hardening follows in later commits.

## Benchmark-required source closure — Phase 2: hardening and certification

Starting HEAD `00daff730bb4bf188db4fa340779e6d591d21994`. Earlier sections of this document are
historical checkpoints; this section supersedes their "NOT YET CERTIFIED" conclusions.
No production, schema, merge, deployment or IQ-3B work. All fixture runs used the isolated local
loopback Supabase (127.0.0.1:55421); the launcher refuses any other target.

### What was hardened (only the 9 sources the frozen graph requires)

| Source | Surface x scope certified | Defect fixed |
|---|---|---|
| `devices.status`, `devices.availability` | Consumer home, Consumer room | Loader caught query/hydration errors and returned `[]`; room filter ran **after** the 100-row limit; no truncation signal |
| `devices.activity`, `devices.failures` | Consumer home | Ledger failure was logged and the rest returned as if complete; audit events (estate-wide, optional home attribution) and caller-supplied history were mixed in |
| `facility.cameras.read` | Facility estate | 100-row registry bound applied **before** the camera access policy; unknown video state needed to stay unobservable, never offline |
| `scenes.list.read` | Consumer home | Existing error sentinel proven; bound/zero/scope admission added |
| `corporate.partnerships.read` | Public | Knowledge lookup returned the same fallback text for "no authorised match" and "retrieval failed"; no provenance |
| `corporate.development.read` | Public | A malformed provider body was returned as an empty listing; failure/timeout collapsed |
| `corporate.opportunity.read` | Public thread | Load failure became "no objective" and the next turn **overwrote the caller's stored facts**; no ownership proof |

Shared mechanisms (not per-module copies): `EvidenceReadOutcome.degraded_sources` (a failed mandatory
sub-source is an error, an optional one is partial), per-collector `scopes` (surface x scope admission
in `CapabilityService.readEvidence`), `readHomeDeviceInventory` / `readRecentDeviceChanges` (outcome-aware
loaders; the old loaders are thin wrappers with unchanged return shape), and the adapters in
`src/oyi-core/evidence/sources/`.

### Device contract
Query/provider/hydration failure -> `error`; room not provably in the verified home -> `scope_insufficient`
(never an empty room); room scope is part of the query; 100 rows -> truncated, never complete; any stale
record -> status `stale`; an unobserved device is kept as an `unobservable` record (it is a registered device,
not a failure sentinel). Zero is proven only for a successful home/room query (an empty room also needs a
`rooms` row for the verified home).

### Knowledge provenance
Governed items carry canonical key, domain, authority class, audience, worker visibility, freshness class,
claim boundary, version and source family. Source file/repo paths, tags and hidden items are never exposed
(tested). In-code fallback copy is never evidence. `no_authorised_match` (zero) is distinct from degraded
index (`unavailable`) and failure (`error`). Governed does not mean verified-current: freshness stays `unknown`.

### Pure-read invariant
`evidence/PureReadGuard.ts`, reusable by IQ-3B. Runtime: inside `readEvidence`, every table write verb and RPC
is refused and the outcome is `error` / `pure_read_violation` (tested for insert/update/upsert/delete/rpc and for
every durable-state class: goals, decisions, recommendations, awareness, workflows, communications, action
proposals, device commands, memory, learning). Static: adapters under `evidence/sources` may import only an
allowlist (deny-listed writer/dispatcher modules are also rejected); each certified collector body is scanned
for writer/dispatcher calls. `anomalies`, `predictions`, `forecasts`, `recommendations` keep `persist: true`
intrinsically: they are **not planner eligible** (case C); no benchmark turn requires them.

### Ordinary-response behaviour changes (all other wording untouched)
1. Home/Room **devices contributor**: a failed inventory read now yields an `unavailable` contributor (aggregate
   state `partial`), where it previously read "No registered devices found" and could produce an all-clear.
2. Home activity contributor: failed ledger read -> unavailable, not "No recent device changes".
3. `devices.activity/failures/diagnosis` answers: failed ledger read -> "could not load recent device activity",
   not "no meaningful recent changes" / "no confirmed failures".
4. Room-scoped device inventory is filtered in the query (a large home can no longer hide room devices).
5. `corporate.development.read`: malformed provider body is "unavailable", not an empty listing.
6. Public opportunity: a failed objective load no longer overwrites the caller's stored facts.
Full 280-turn IQ: **0 answer or envelope differences** from the accepted run.

### Validation
- 255 source/authority/scope tests + **127 benchmark-source tests** PASS (fault injection: error object, throw,
  state-hydration failure, truncation, cross-home, room scope, stale, timeout/late result, malformed provider body,
  ownership, public-only, pure-read, aggregate contributors, ordinary-path regressions).
- **225-row surface x scope matrix**: 32 declared-and-admitted, 193 undeclared-and-rejected, 0 undeclared-but-admitted.
- **Live local-database isolation** (real rows for the other home; real rooms): devices (incl. bedroom/kitchen/study room
  scope, the empty Study proven zero, another home's room not provable), ledger, scenes, cameras (home-private camera
  excluded for Facility) and the original three sources. 10 synthetic rows inserted and removed; 0 left.
- IQ **51 PASS / 224 FAIL / 5 BLOCKED** (identical answers/envelopes, 280/280 persisted and trace-correlated);
  Wave 11 **131 PASS / 1 known FAIL**; IQ-1 adversarial PASS (0 execution attempts); IQ-2 objective PASS;
  23-suite matrix **19 PASS / 4 FAIL**, the four being the same pre-IQ1 failures, assertion text compared with the
  control assertions stored in the IQ-1 artifact (control head `45e89d2`). Typecheck, build, `git diff --check` clean.

### Result
Source certification: **25 CERTIFIED_PARTIAL / 0 CERTIFIED_COMPLETE / 41 NOT_ELIGIBLE_COMPLETENESS / 5 disabled**.
All 133 evidence-planning turns: **117 PLANNER_READY_PARTIAL / 12 MISSING_CAPABILITY_PRODUCT_DEBT /
4 DOWNSTREAM_NOT_IQ3 / 0 PLANNER_READY_COMPLETE / 0 SOURCE_CONTRACT_BLOCKED**.
"Ready" means the evidence substrate is trustworthy for that turn; it is not evidence that any judgment is good.

### Proven missing capabilities (MISSING_CAPABILITY_PRODUCT_DEBT, 12 turns)
Nothing was fabricated, enabled or relabelled to certify; each has a test-bound absence proof in the certification artifact.
- Electricity consumption (CON-003 x5): `utilities.usage/meter/balance` are declared, not enabled; spending is money, not kWh.
- Consumer camera current state (CON-004 x3): the only camera read is Facility-only.
- Device observed values — lock position, temperature, power (CON-001:4, CON-002:4, CON-008:7): device evidence carries
  availability and freshness only.
- Facility estate-scoped device history (FAC-009:7): device sources require a home scope.

### Judgment calls a reviewer should contest
The mandatory/optional classification was frozen and committed (`ca04380`) before hardening, from the frozen envelopes.
It is judgment, not mechanical. Most consequential: `home_aggregate` is treated as a **composite** (cross-domain composition
is IQ-3B) and therefore optional where its direct components are covered. Of the 25 Consumer turns whose envelope lists
`home`, this decides 18 ready turns. If `home.summary/attention/activity` were required, they would need their own
certification (their contributor false-zero defects are fixed regardless). Wallet is excluded by design on Facility and
optional on Consumer; unconfirmed reply targets perform no exact read (planning constraint, not a source defect).

### NON_BENCHMARK_EVIDENCE_DEBT
41 read modules remain uncertified and are not required by any frozen turn (e.g. utilities active/tariff/spending/purchases,
wallet, home/room aggregates, `facility.overview`, the 4 persisting intelligence composites, the other public knowledge items,
automations, services, community) plus 5 declared-not-enabled capabilities. They keep their prior states.

### Remaining P0/P1/P2
- P0: none known.
- P1: the `home_aggregate` classification above is the largest open judgment; `PureReadGuard` wraps the shared Supabase client's
  `from`/`rpc` on first planner read (a global, idempotent patch) — IQ-3B should inject a dedicated guarded client instead.
- P2: building scope is unsupported for every source (homes have a building relation the collectors do not join);
  audit events are excluded from device history (estate-wide, optional home attribution); `retrieval_failed` for governed knowledge is
  proven by dependency injection, not by breaking the real index; no query cancellation (a timed-out read may still finish).

### Query impact
Planner reads add no count queries and are not called by ordinary conversation. Ordinary paths: one extra `rooms` membership query
only when a room-scoped device read returns zero rows; otherwise the same queries. Planner read cost: devices <=4 queries,
history 3, cameras 2-3, scenes 1, public 0-1 (+ one bounded GET).

**IQ-3A EVIDENCE CONTRACT CERTIFIED — IQ-3B APPROVAL REQUIRED**

### Superseded in IQ-3B: the pure-read mechanism
The IQ-3A runtime guard described above (wrapping the shared Supabase client's `from`/`rpc` on first planner read) was
**replaced in IQ-3B** by a dedicated, structurally read-only dependency (`evidence/ReadOnlyEvidenceDb.ts`): certified sources
receive an object exposing only `select`; no write verb and no RPC exist on it and nothing global is patched. The IQ-3A
certification, readiness counts and source states are unchanged; the tests that exercised the old guard were rewritten to
assert the structural property (and that every DB-backed source reads only through the injected dependency).
See `docs/INTELLIGENCE_QUALITY_V1_IQ3B.md`.
